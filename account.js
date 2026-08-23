(function initializeStudyIBAccountModule() {
    'use strict';

    const config = window.STUDYIB_CONFIG || {};
    const LOCAL_PROGRESS_KEY = 'science_qbank_topic_question_progress';
    const LOCAL_GAME_KEY = 'science_qbank_gamification_state';
    const QUEUE_KEY = 'studyib_cloud_operation_queue_v1';
    const DATASET_VERSION = config.datasetVersion || '2026-08-22-expanded-topicals-v1';
    const SUBJECT_LABELS = {
        physics: 'Physics',
        chemistry: 'Chemistry',
        biology: 'Biology',
        math: 'Mathematics AA',
        math_ai: 'Mathematics AI',
        economics: 'Economics',
        business: 'Business Management',
        computer_science: 'Computer Science'
    };

    const escapeHtml = value => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    const localDate = () => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    };

    const makeId = prefix => `${prefix}:${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

    function readJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
        catch (_) { return fallback; }
    }

    function emit(name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    class StudyIBAccountService {
        constructor() {
            this.client = null;
            this.session = null;
            this.user = null;
            this.snapshot = null;
            this.ready = false;
            this.syncing = false;
            this.lastError = '';
            this.importAvailable = false;
            this.boundOnline = () => this.flushQueue();
        }

        get signedIn() { return Boolean(this.session && this.user); }

        async init() {
            if (!config.supabaseUrl || !config.supabasePublishableKey || !window.supabase?.createClient) {
                this.ready = true;
                this.lastError = 'Cloud accounts are temporarily unavailable.';
                emit('studyib:account-ready', { service: this });
                return;
            }

            this.client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    storageKey: 'studyib-auth-session'
                }
            });

            this.client.auth.onAuthStateChange((event, session) => {
                setTimeout(() => this.handleSession(session, event), 0);
            });

            const { data, error } = await this.client.auth.getSession();
            if (error) this.lastError = error.message;
            await this.handleSession(data?.session || null, 'INITIAL_SESSION');
            this.ready = true;
            window.addEventListener('online', this.boundOnline);
            emit('studyib:account-ready', { service: this });
        }

        async handleSession(session, event) {
            const previousUser = this.user?.id;
            this.session = session || null;
            this.user = session?.user || null;
            if (!this.user) {
                this.snapshot = null;
                this.importAvailable = false;
                this.updateSidebarProfile();
                emit('studyib:auth-changed', { signedIn: false, event });
                return;
            }

            try {
                await this.refreshSnapshot();
                this.checkLocalImportOffer();
                await this.flushQueue();
                this.lastError = '';
            } catch (error) {
                this.lastError = error.message || 'Could not load cloud progress.';
            }
            this.updateSidebarProfile();
            emit('studyib:auth-changed', { signedIn: true, event, user: this.user, isNewSession: previousUser !== this.user.id });
        }

        async refreshSnapshot() {
            if (!this.signedIn) return null;
            this.syncing = true;
            emit('studyib:sync-state', { syncing: true });
            try {
                const { data, error } = await this.client.rpc('get_account_snapshot');
                if (error) throw error;
                this.snapshot = data || null;
                this.hydrateLocalCache();
                emit('studyib:account-snapshot', { snapshot: this.snapshot });
                this.updateSidebarProfile();
                return this.snapshot;
            } finally {
                this.syncing = false;
                emit('studyib:sync-state', { syncing: false });
            }
        }

        hydrateLocalCache() {
            if (!this.snapshot) return;
            const completed = (this.snapshot.question_progress || [])
                .filter(item => item.completed_at)
                .map(item => item.question_id);
            localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify({
                version: DATASET_VERSION,
                completed,
                migratedAt: new Date().toISOString(),
                cloudSyncedAt: new Date().toISOString()
            }));
            if (window.gamification?.applyCloudSnapshot) window.gamification.applyCloudSnapshot(this.snapshot);
            const appearance = this.snapshot.settings?.appearance;
            if (appearance) this.applyAppearance(appearance, false);
            this.applyReducedMotion(Boolean(this.snapshot.settings?.reduced_motion), false);
        }

        getLocalImportPayload() {
            const progress = readJson(LOCAL_PROGRESS_KEY, {});
            const game = readJson(LOCAL_GAME_KEY, {});
            return {
                completed: Array.isArray(progress.completed) ? progress.completed : [],
                xp: Number(game.xp) || 0,
                coins: Number(game.dpPoints ?? game.dojoCoins) || 0,
                purchasedThemes: Array.isArray(game.purchasedThemes) ? game.purchasedThemes : [],
                purchasedPets: Array.isArray(game.purchasedPets) ? game.purchasedPets : [],
                purchasedTitles: Array.isArray(game.purchasedTitles) ? game.purchasedTitles.map(value => {
                    const match = (window.STUDYIB_SHOP_ITEMS?.titles || []).find(item => item.name === value || item.id === value);
                    return match?.id || value;
                }) : [],
                activeTheme: game.activeTheme || 'default',
                activePet: game.activePet || 'none',
                activeTitle: (() => {
                    const value = game.activeTitle || 'IB Student';
                    const match = (window.STUDYIB_SHOP_ITEMS?.titles || []).find(item => item.name === value || item.id === value);
                    return match?.id || value;
                })()
            };
        }

        hasMeaningfulLocalProgress() {
            const data = this.getLocalImportPayload();
            return data.completed.length > 0 || data.xp > 0 || data.purchasedThemes.length > 0 || data.purchasedPets.length > 0 || data.purchasedTitles.length > 0;
        }

        checkLocalImportOffer() {
            const declined = localStorage.getItem(`studyib_import_declined:${this.user.id}`) === 'true';
            this.importAvailable = !this.snapshot?.local_import && !declined && this.hasMeaningfulLocalProgress();
            if (this.importAvailable) emit('studyib:local-import-available', { user: this.user });
        }

        async importLocalProgress() {
            if (!this.signedIn) throw new Error('Sign in before importing progress.');
            const payload = this.getLocalImportPayload();
            const serialized = JSON.stringify({ version: DATASET_VERSION, payload });
            let importKey = makeId('local');
            if (typeof crypto !== 'undefined' && crypto.subtle) {
                const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
                importKey = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
            }
            const { data, error } = await this.client.rpc('import_local_progress', {
                p_import_key: importKey,
                p_dataset_version: DATASET_VERSION,
                p_payload: payload
            });
            if (error) throw error;
            this.importAvailable = false;
            await this.refreshSnapshot();
            return data;
        }

        declineLocalImport() {
            if (this.user) localStorage.setItem(`studyib_import_declined:${this.user.id}`, 'true');
            this.importAvailable = false;
        }

        async signInWithGoogle() {
            if (!this.client) throw new Error('Cloud accounts are unavailable.');
            const { data, error } = await this.client.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${location.origin}${location.pathname}` }
            });
            if (error) throw error;
            return data;
        }

        async sendMagicLink(email) {
            if (!this.client) throw new Error('Cloud accounts are unavailable.');
            if (!/^\S+@\S+\.\S+$/.test(String(email || '').trim())) throw new Error('Enter a valid email address.');
            const { error } = await this.client.auth.signInWithOtp({
                email: String(email).trim(),
                options: { emailRedirectTo: `${location.origin}${location.pathname}`, shouldCreateUser: true }
            });
            if (error) throw error;
        }

        async signOut() {
            if (!this.client) return;
            const { error } = await this.client.auth.signOut({ scope: 'local' });
            if (error) throw error;
            this.session = null; this.user = null; this.snapshot = null;
            this.updateSidebarProfile();
        }

        async updateProfile(displayName) {
            if (!this.signedIn) throw new Error('Sign in first.');
            const safeName = String(displayName || '').trim().slice(0, 80);
            if (!safeName) throw new Error('Display name cannot be empty.');
            const { error } = await this.client.from('profiles').update({ display_name: safeName, updated_at: new Date().toISOString() }).eq('id', this.user.id);
            if (error) throw error;
            await this.refreshSnapshot();
        }

        async updateSettings(values) {
            if (!this.signedIn) throw new Error('Sign in first.');
            const allowed = {};
            ['appearance', 'reduced_motion', 'sound_enabled', 'timezone', 'locale'].forEach(key => {
                if (Object.prototype.hasOwnProperty.call(values, key)) allowed[key] = values[key];
            });

            // Apply visual preferences immediately. Cloud persistence happens
            // afterwards so a slow request cannot make the control feel broken.
            if (allowed.appearance) this.applyAppearance(allowed.appearance, false);
            if (Object.prototype.hasOwnProperty.call(allowed, 'reduced_motion')) {
                this.applyReducedMotion(Boolean(allowed.reduced_motion), false);
            }

            allowed.updated_at = new Date().toISOString();
            const { error } = await this.client.from('user_settings').upsert({
                user_id: this.user.id,
                ...allowed
            }, { onConflict: 'user_id' });
            if (error) throw error;
            await this.refreshSnapshot();
        }

        applyAppearance(mode, persist = true) {
            const normalized = ['dark', 'light', 'system'].includes(mode) ? mode : 'dark';
            const resolved = normalized === 'system' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : normalized === 'system' ? 'dark' : normalized;
            document.documentElement.setAttribute('data-theme', resolved);
            document.documentElement.setAttribute('data-appearance', normalized);
            localStorage.setItem('theme', normalized);
            if (persist && this.signedIn) this.updateSettings({ appearance: normalized }).catch(error => this.notify(error.message, 'error'));
        }

        applyReducedMotion(enabled, persist = true) {
            const normalized = Boolean(enabled);
            document.documentElement.setAttribute('data-reduced-motion', String(normalized));
            localStorage.setItem('studyib_reduced_motion', String(normalized));
            if (persist && this.signedIn) this.updateSettings({ reduced_motion: normalized }).catch(error => this.notify(error.message, 'error'));
        }

        queueOperation(type, payload, key) {
            const queue = readJson(QUEUE_KEY, []);
            const next = queue.filter(item => item.key !== key);
            next.push({ type, payload, key, queuedAt: new Date().toISOString() });
            localStorage.setItem(QUEUE_KEY, JSON.stringify(next.slice(-250)));
            emit('studyib:sync-state', { offline: true, queued: next.length });
        }

        async flushQueue() {
            if (!this.signedIn || !navigator.onLine) return;
            const queue = readJson(QUEUE_KEY, []);
            if (!queue.length) return;
            const remaining = [];
            for (const item of queue) {
                try { await this.runOperation(item.type, item.payload, false); }
                catch (_) { remaining.push(item); }
            }
            localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
            if (remaining.length !== queue.length) await this.refreshSnapshot();
        }

        async runOperation(type, payload, allowQueue = true) {
            if (!this.signedIn) return null;
            let call;
            if (type === 'question') call = this.client.rpc('set_question_completion', payload);
            else if (type === 'mock') call = this.client.rpc('record_mock_result', payload);
            else if (type === 'reward') call = this.client.rpc('record_study_reward', payload);
            else throw new Error('Unknown cloud operation.');
            const { data, error } = await call;
            if (error) {
                if (allowQueue && (!navigator.onLine || /fetch|network|timeout/i.test(error.message || ''))) {
                    this.queueOperation(type, payload, `${type}:${payload.p_question_id || payload.p_client_event_id || `${payload.p_event_type}:${payload.p_source_id}`}`);
                    return { queued: true };
                }
                throw error;
            }
            await this.refreshSnapshot();
            this.reactToReward(data, type);
            return data;
        }

        setQuestionCompletion(questionId, subject, completed) {
            return this.runOperation('question', { p_question_id: questionId, p_subject: subject, p_completed: Boolean(completed), p_local_date: localDate() });
        }

        recordMockResult(result) {
            return this.runOperation('mock', {
                p_client_event_id: result.clientEventId,
                p_subject: result.subject,
                p_paper_type: result.paperType || 'mixed',
                p_total_questions: result.totalQuestions,
                p_completed_questions: result.completedQuestions,
                p_score_percent: result.scorePercent,
                p_duration_seconds: result.durationSeconds || 0,
                p_topic_ids: result.topicIds || [],
                p_local_date: localDate()
            });
        }

        recordStudyReward(eventType, sourceId, subject) {
            return this.runOperation('reward', { p_event_type: eventType, p_source_id: sourceId, p_subject: subject || null, p_local_date: localDate() });
        }

        async purchaseCosmetic(itemId) {
            if (!this.signedIn) { this.openPanel('Sign in to purchase and sync collectibles.'); return null; }
            const { data, error } = await this.client.rpc('purchase_cosmetic', { p_item_id: itemId });
            if (error) throw error;
            await this.refreshSnapshot();
            return data;
        }

        async equipCosmetic(type, itemId) {
            if (!this.signedIn) { this.openPanel('Sign in to equip and sync collectibles.'); return null; }
            const { data, error } = await this.client.rpc('equip_cosmetic', { p_item_type: type, p_item_id: itemId });
            if (error) throw error;
            await this.refreshSnapshot();
            return data;
        }

        async updatePetPreferences(preferences) {
            if (!this.signedIn) { this.openPanel('Sign in to save pet settings across devices.'); return null; }
            const { data, error } = await this.client.rpc('update_pet_preferences', {
                p_size: preferences.size,
                p_position: preferences.position || { x: null, y: null },
                p_animations: preferences.animations !== false,
                p_draggable: preferences.draggable !== false
            });
            if (error) throw error;
            await this.refreshSnapshot();
            return data;
        }

        reactToReward(data, source) {
            if (!data || data.duplicate || data.queued) return;
            if (Number(data.xp_awarded) > 0) emit('studyib:progress-reaction', { type: source, xp: Number(data.xp_awarded) });
            const achievements = Array.isArray(data.achievements) ? data.achievements : [];
            achievements.forEach(id => emit('studyib:progress-reaction', { type: 'achievement', achievement: id }));
        }

        async exportData() {
            if (!this.signedIn) throw new Error('Sign in to export account data.');
            const tableNames = ['study_sessions', 'progression_events'];
            const extra = {};
            for (const table of tableNames) {
                const { data, error } = await this.client.from(table).select('*').order('created_at', { ascending: false });
                if (error) throw error;
                extra[table] = data;
            }
            const payload = { exported_at: new Date().toISOString(), user_id: this.user.id, snapshot: this.snapshot, ...extra };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `studyib-account-${localDate()}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        }

        async deleteAccount() {
            if (!this.signedIn) return;
            const { error } = await this.client.rpc('delete_my_account');
            if (error) throw error;
            await this.client.auth.signOut({ scope: 'local' }).catch(() => {});
            this.session = null; this.user = null; this.snapshot = null;
            this.notify('Your cloud account and synced data were deleted.', 'success');
        }

        updateSidebarProfile() {
            const name = document.getElementById('sidebarProfileName');
            const title = document.getElementById('profileTitleLabel');
            const avatar = document.getElementById('sidebarProfileAvatar');
            if (!name || !title || !avatar) return;
            if (!this.signedIn) {
                name.textContent = 'Guest'; title.textContent = 'Progress stays on this device'; avatar.textContent = 'G';
                avatar.style.backgroundImage = '';
                return;
            }
            const profile = this.snapshot?.profile || {};
            const display = profile.display_name || this.user.user_metadata?.full_name || this.user.email?.split('@')[0] || 'IB Student';
            name.textContent = display;
            title.textContent = this.snapshot?.cosmetics?.equipped_title || `Level ${this.snapshot?.progression?.level || 1}`;
            avatar.textContent = display.slice(0, 2).toUpperCase();
            const avatarUrl = profile.avatar_url || this.user.user_metadata?.avatar_url;
            avatar.style.backgroundImage = avatarUrl ? `url("${String(avatarUrl).replace(/"/g, '')}")` : '';
        }

        notify(message, type = 'info') {
            if (window.gamification?.showNotification) window.gamification.showNotification(message);
            else emit('studyib:notice', { message, type });
        }

        openPanel(message = '') {
            const modal = document.getElementById('accountModal');
            if (!modal) return;
            this.renderPanel(message);
            modal.classList.remove('hidden');
            document.body.classList.add('modal-open');
            setTimeout(() => modal.querySelector('button, input, select')?.focus(), 0);
        }

        closePanel() {
            document.getElementById('accountModal')?.classList.add('hidden');
            document.body.classList.remove('modal-open');
            document.getElementById('accountBtn')?.focus();
        }

        renderPanel(message = '') {
            const body = document.getElementById('accountModalBody');
            if (!body) return;
            if (!this.signedIn) {
                body.innerHTML = `
                    <section class="account-guest stack">
                        ${message ? `<div class="alert"><div aria-hidden="true">i</div><div><div class="alert-title">Account feature</div><p class="alert-description">${escapeHtml(message)}</p></div></div>` : ''}
                        <div class="account-benefits card">
                            <h4>Study freely. Sign in when you want syncing.</h4>
                            <p>Browsing, questions, mock tests, and guest progress remain available without an account.</p>
                            <ul><li>Sync progress across devices</li><li>Unlock achievements and persistent levels</li><li>Keep themes, pets, and inventory in your account</li></ul>
                        </div>
                        <div class="account-guest-preferences card">
                            <label class="field"><span class="field-label">Appearance</span><select class="select" id="accountGuestAppearance"><option value="dark" ${document.documentElement.dataset.appearance === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${document.documentElement.dataset.appearance === 'light' ? 'selected' : ''}>Light</option><option value="system" ${document.documentElement.dataset.appearance === 'system' ? 'selected' : ''}>Use device setting</option></select></label>
                            <label class="account-check"><input type="checkbox" id="accountGuestReducedMotion" ${document.documentElement.dataset.reducedMotion === 'true' ? 'checked' : ''}><span>Reduce interface motion</span></label>
                            <p class="field-description">Guest preferences stay on this device.</p>
                        </div>
                        <button type="button" class="button button-primary account-google-btn" id="accountGoogleBtn"><span aria-hidden="true">G</span> Continue with Google</button>
                        <div class="separator account-or"><span>or</span></div>
                        <form id="accountEmailForm" class="stack stack-sm">
                            <label class="field-label" for="accountEmail">Continue with Email (Magic Link)</label>
                            <div class="account-email-row"><input class="input" id="accountEmail" type="email" autocomplete="email" placeholder="you@example.com" required><button class="button button-outline" type="submit">Send link</button></div>
                            <p class="field-description">No password. We send a one-time sign-in link.</p>
                        </form>
                        <p class="account-status" id="accountAuthStatus" role="status">${escapeHtml(this.lastError)}</p>
                    </section>`;
                this.bindGuestPanel();
                return;
            }

            const snapshot = this.snapshot || {};
            const progress = snapshot.progression || {};
            const profile = snapshot.profile || {};
            const cosmetics = snapshot.cosmetics || {};
            const nextXp = window.gamification?.getXpNeededForLevel(Math.min(45, (progress.level || 1) + 1)) || 120;
            const levelXp = window.gamification?.getXpNeededForLevel(progress.level || 1) || 0;
            const percent = Math.max(0, Math.min(100, Math.round(((progress.xp || 0) - levelXp) / Math.max(1, nextXp - levelXp) * 100)));
            const stats = Object.fromEntries((snapshot.subject_statistics || []).map(item => [item.subject, item]));
            const achievements = snapshot.achievements || [];
            const pet = (snapshot.pets || []).find(item => item.pet_id === cosmetics.equipped_pet);
            body.innerHTML = `
                <section class="account-profile stack">
                    ${this.importAvailable ? `<div class="account-import-card alert"><div aria-hidden="true">↥</div><div><div class="alert-title">Bring your guest progress with you?</div><p class="alert-description">Import current questions, eligible XP, and locally owned collectibles once. Nothing on this device will be erased.</p><div class="cluster account-import-actions"><button class="button button-primary button-sm" id="accountImportBtn">Import progress</button><button class="button button-ghost button-sm" id="accountImportSkip">Not now</button></div></div></div>` : ''}
                    <div class="account-identity">
                        <div class="account-avatar-large">${escapeHtml((profile.display_name || this.user.email || 'IB').slice(0, 2).toUpperCase())}</div>
                        <div><span class="account-kicker">Cloud profile</span><h4>${escapeHtml(profile.display_name || this.user.email?.split('@')[0] || 'IB Student')}</h4><p>${escapeHtml(this.user.email || '')}</p></div>
                    </div>
                    <div class="account-level-card card">
                        <div class="cluster cluster-between"><strong>Level ${progress.level || 1}</strong><span>${Number(progress.xp || 0).toLocaleString()} XP</span></div>
                        <div class="progress"><div class="progress-bar" style="width:${percent}%"></div></div>
                        <div class="account-metric-grid"><div><strong>${Number(progress.coins || 0).toLocaleString()}</strong><span>Coins</span></div><div><strong>${progress.streak_count || 0}</strong><span>Day streak</span></div><div><strong>${progress.total_questions_completed || 0}</strong><span>Questions</span></div><div><strong>${progress.total_mock_tests || 0}</strong><span>Mocks</span></div></div>
                    </div>
                    <section><div class="account-section-heading"><h5>Subject progress</h5></div><div class="account-subject-grid">${Object.keys(SUBJECT_LABELS).map(id => `<div class="account-subject-stat"><span>${SUBJECT_LABELS[id]}</span><strong>${stats[id]?.questions_completed || 0}</strong><small>questions completed</small></div>`).join('')}</div></section>
                    <section><div class="account-section-heading"><h5>Achievements</h5><span>${achievements.length} unlocked</span></div><div class="account-achievement-list">${achievements.length ? achievements.slice(0, 8).map(item => `<div class="account-achievement"><span aria-hidden="true">★</span><div><strong>${escapeHtml(item.definition?.name || item.achievement_id)}</strong><small>${escapeHtml(item.definition?.description || '')}</small></div></div>`).join('') : '<div class="empty-state account-empty"><h3>Your first achievement is close</h3><p>Complete a question to begin.</p></div>'}</div></section>
                    <section class="account-settings card">
                        <div class="account-section-heading"><h5>Profile & settings</h5></div>
                        <label class="field"><span class="field-label">Display name</span><div class="account-email-row"><input class="input" id="accountDisplayName" maxlength="80" value="${escapeHtml(profile.display_name || '')}"><button class="button button-outline" id="accountSaveName">Save</button></div></label>
                        <label class="field"><span class="field-label">Appearance</span><select class="select" id="accountAppearance"><option value="dark" ${snapshot.settings?.appearance === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${snapshot.settings?.appearance === 'light' ? 'selected' : ''}>Light</option><option value="system" ${snapshot.settings?.appearance === 'system' ? 'selected' : ''}>Use device setting</option></select></label>
                        <label class="account-check"><input type="checkbox" id="accountReducedMotion" ${snapshot.settings?.reduced_motion ? 'checked' : ''}><span>Reduce interface motion</span></label>
                        <div class="account-pet-settings ${cosmetics.equipped_pet === 'none' ? 'is-disabled' : ''}"><div class="cluster cluster-between"><span class="field-label">Equipped pet</span><strong>${escapeHtml(cosmetics.equipped_pet === 'none' ? 'None' : cosmetics.equipped_pet)}</strong></div>${pet ? `<small>Friendship level ${pet.friendship_level || 1} · ${pet.friendship_xp || 0} XP</small>` : ''}<label class="field"><span class="field-label">Pet size</span><input type="range" id="accountPetSize" min="0.6" max="1.8" step="0.05" value="${cosmetics.pet_size || 1}" ${cosmetics.equipped_pet === 'none' ? 'disabled' : ''}></label><label class="account-check"><input type="checkbox" id="accountPetAnimations" ${cosmetics.pet_animations !== false ? 'checked' : ''}><span>Pet reactions and idle animation</span></label><label class="account-check"><input type="checkbox" id="accountPetDraggable" ${cosmetics.pet_draggable !== false ? 'checked' : ''}><span>Allow repositioning on desktop</span></label><button class="button button-outline button-sm" id="accountSavePet" ${cosmetics.equipped_pet === 'none' ? 'disabled' : ''}>Save pet settings</button></div>
                    </section>
                    <div class="account-actions-grid"><button class="button button-outline" id="accountExportBtn">Export my data</button><button class="button button-ghost" id="accountLogoutBtn">Log out</button><button class="button button-destructive" id="accountDeleteBtn">Delete account</button></div>
                    <p class="account-status" id="accountAuthStatus" role="status">${escapeHtml(this.lastError)}</p>
                </section>`;
            this.bindProfilePanel();
        }

        bindGuestPanel() {
            document.getElementById('accountGuestAppearance')?.addEventListener('change', event => this.applyAppearance(event.target.value, false));
            document.getElementById('accountGuestReducedMotion')?.addEventListener('change', event => this.applyReducedMotion(event.target.checked, false));
            document.getElementById('accountGoogleBtn')?.addEventListener('click', async event => {
                event.currentTarget.disabled = true;
                try { await this.signInWithGoogle(); }
                catch (error) { this.setPanelStatus(error.message, true); event.currentTarget.disabled = false; }
            });
            document.getElementById('accountEmailForm')?.addEventListener('submit', async event => {
                event.preventDefault();
                const button = event.currentTarget.querySelector('button'); button.disabled = true;
                try { await this.sendMagicLink(document.getElementById('accountEmail').value); this.setPanelStatus('Check your email for the one-time sign-in link.'); }
                catch (error) { this.setPanelStatus(error.message, true); }
                finally { button.disabled = false; }
            });
        }

        bindProfilePanel() {
            document.getElementById('accountImportBtn')?.addEventListener('click', async event => {
                event.currentTarget.disabled = true;
                try { const result = await this.importLocalProgress(); this.notify(`Imported ${result.questions || 0} questions and ${result.items || 0} collectibles.`); this.renderPanel(); }
                catch (error) { this.setPanelStatus(error.message, true); event.currentTarget.disabled = false; }
            });
            document.getElementById('accountImportSkip')?.addEventListener('click', () => { this.declineLocalImport(); this.renderPanel(); });
            document.getElementById('accountSaveName')?.addEventListener('click', async () => {
                try { await this.updateProfile(document.getElementById('accountDisplayName').value); this.renderPanel(); }
                catch (error) { this.setPanelStatus(error.message, true); }
            });
            document.getElementById('accountAppearance')?.addEventListener('change', event => this.updateSettings({ appearance: event.target.value }).then(() => this.renderPanel()).catch(error => this.setPanelStatus(error.message, true)));
            document.getElementById('accountReducedMotion')?.addEventListener('change', event => this.updateSettings({ reduced_motion: event.target.checked }).catch(error => this.setPanelStatus(error.message, true)));
            document.getElementById('accountSavePet')?.addEventListener('click', async () => {
                try { await this.updatePetPreferences({ size: Number(document.getElementById('accountPetSize').value), position: this.snapshot?.cosmetics?.pet_position, animations: document.getElementById('accountPetAnimations').checked, draggable: document.getElementById('accountPetDraggable').checked }); this.notify('Pet settings saved.'); this.renderPanel(); }
                catch (error) { this.setPanelStatus(error.message, true); }
            });
            document.getElementById('accountExportBtn')?.addEventListener('click', () => this.exportData().catch(error => this.setPanelStatus(error.message, true)));
            document.getElementById('accountLogoutBtn')?.addEventListener('click', () => this.signOut().then(() => { this.renderPanel(); this.notify('Logged out. Guest mode is still available.'); }).catch(error => this.setPanelStatus(error.message, true)));
            document.getElementById('accountDeleteBtn')?.addEventListener('click', async () => {
                if (!confirm('Permanently delete your account and all synced StudyIB data? Your local guest data will remain on this device.')) return;
                try { await this.deleteAccount(); this.closePanel(); }
                catch (error) { this.setPanelStatus(error.message, true); }
            });
        }

        setPanelStatus(message, isError = false) {
            const status = document.getElementById('accountAuthStatus');
            if (!status) return;
            status.textContent = message; status.classList.toggle('is-error', isError);
        }
    }

    const account = new StudyIBAccountService();
    window.studyIBAccount = account;
    window.openStudyIBAccount = message => account.openPanel(message);

    function bindAccountShell() {
        account.applyReducedMotion(localStorage.getItem('studyib_reduced_motion') === 'true', false);
        document.getElementById('accountBtn')?.addEventListener('click', () => account.openPanel());
        document.getElementById('closeAccountBtn')?.addEventListener('click', () => account.closePanel());
        document.getElementById('accountModal')?.addEventListener('click', event => { if (event.target.id === 'accountModal') account.closePanel(); });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !document.getElementById('accountModal')?.classList.contains('hidden')) account.closePanel();
        });
        account.updateSidebarProfile();
        account.init().catch(error => { account.lastError = error.message; account.ready = true; emit('studyib:account-ready', { service: account }); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAccountShell, { once: true });
    else bindAccountShell();
})();
