/**
 * IB Science QBank — Gamification & Progression System
 * Core logic matching the loop, retention, and progression hooks of RevisionDojo.
 */

// --- Database Schema (TypeScript Type Reference) ---
/**
 * interface GamificationState {
 *   xp: number;
 *   level: number; // 1 to 45
 *   dpPoints: number; // Diploma Programme Points
 *   streak: number;
 *   lastActiveDate: string; // YYYY-MM-DD
 *   streakShields: number;
 *   energy: number;
 *   maxEnergy: number;
 *   lastReplenishedTime: number; // timestamp ms
 *   completedBosses: string[]; // list of boss filepaths beaten
 *   purchasedThemes: string[]; // list of bought theme IDs
 *   purchasedTitles: string[]; // list of bought title IDs
 *   purchasedPets: string[]; // list of bought pet IDs
 *   activeTheme: string; // 'default' or a purchased theme ID
 *   activeTitle: string; // custom title
 *   activePet: string; // 'none' or a purchased pet ID
 *   claimedRewards: Record<string, { xp: number; dp: number }>; // idempotent reward ledger
 * }
 */

const DEFAULT_GAMIFICATION_STATE = {
    xp: 0,
    level: 1,
    dpPoints: 50, // Starter DP Points
    streak: 0,
    lastActiveDate: '',
    streakShields: 1, // Start with 1 protection shield
    energy: 20,
    maxEnergy: 20,
    lastReplenishedTime: Date.now(),
    completedBosses: [],
    purchasedThemes: [],
    purchasedTitles: [],
    purchasedPets: [],
    activeTheme: 'default',
    activeTitle: 'IB Student',
    activePet: 'none',
    petSize: 1,
    petPosition: { x: null, y: null },
    petAnimations: true,
    petDraggable: true,
    claimedRewards: {}
};

const SHOP_ITEMS = {
    themes: [
        { id: 'galaxy', name: 'Event Horizon', cost: 300, description: 'A drifting starfield, orbiting dust, and deep-space violet surfaces.', preview: 'galaxy', badge: 'Animated' },
        { id: 'nordic', name: 'Polar Aurora', cost: 240, description: 'Slow aurora ribbons over cool arctic glass surfaces.', preview: 'aurora', badge: 'Animated' },
        { id: 'cyberpunk', name: 'Neon Grid', cost: 260, description: 'A moving perspective grid with electric magenta highlights.', preview: 'grid', badge: 'Animated' },
        { id: 'retro', name: 'Terminal Matrix', cost: 180, description: 'Green phosphor accents with a restrained scanning-line texture.', preview: 'matrix', badge: 'Animated' },
        { id: 'gold', name: 'Solar Flare', cost: 220, description: 'Warm solar gradients and a subtle moving corona.', preview: 'solar', badge: 'Animated' }
    ],
    titles: [
        { id: 'survivor', name: 'IB Survivor', cost: 50, description: 'For those braving the diploma core' },
        { id: 'conqueror', name: 'Syllabus Conqueror', cost: 150, description: 'Earned by topic perfectionists' },
        { id: 'elite', name: '7-Score Elite', cost: 300, description: 'The absolute pinnacle of IB scores' },
        { id: 'quantum', name: 'Quantum Overlord', cost: 500, description: 'Ultimate science command mastery' }
    ],
    pets: [
        { id: 'orbit', name: 'Orbit', cost: 120, description: 'A curious satellite that circles while you study.', color: '#818cf8' },
        { id: 'quark', name: 'Quark Fox', cost: 220, description: 'A tiny particle fox with far too much energy.', color: '#fb7185' },
        { id: 'axi', name: 'Astro Axolotl', cost: 280, description: 'A zero-gravity study buddy from the cosmic pond.', color: '#2dd4bf' },
        { id: 'comet', name: 'Comet Cat', cost: 340, description: 'A stellar cat that leaves a soft comet trail.', color: '#fbbf24' }
    ]
};
window.STUDYIB_SHOP_ITEMS = SHOP_ITEMS;

class GamificationManager {
    constructor() {
        this.state = this.loadState();
        this.recalculateEnergy();
        this.checkStreakInactivity();
        this.applyActiveTheme();
        this.initShopListeners();
    }

    loadState() {
        const saved = localStorage.getItem('science_qbank_gamification_state');
        if (saved) {
            try {
                // Fallback for legacy state keys (e.g. dojoCoins -> dpPoints)
                const parsed = JSON.parse(saved);
                if (parsed.dojoCoins !== undefined && parsed.dpPoints === undefined) {
                    parsed.dpPoints = parsed.dojoCoins;
                    delete parsed.dojoCoins;
                }
                const state = { ...DEFAULT_GAMIFICATION_STATE, ...parsed };
                state.purchasedThemes = Array.isArray(state.purchasedThemes) ? state.purchasedThemes : [];
                state.purchasedTitles = Array.isArray(state.purchasedTitles) ? state.purchasedTitles : [];
                state.purchasedPets = Array.isArray(state.purchasedPets) ? state.purchasedPets : [];
                state.claimedRewards = state.claimedRewards && typeof state.claimedRewards === 'object'
                    ? state.claimedRewards
                    : {};
                return state;
            } catch (e) {
                console.error("Failed to parse gamification state, resetting", e);
            }
        }
        return { ...DEFAULT_GAMIFICATION_STATE };
    }

    saveState() {
        localStorage.setItem('science_qbank_gamification_state', JSON.stringify(this.state));
        this.updateUI();
    }

    // --- LEVEL CALCULATION ENGINE (1–45 scale) ---
    getXpNeededForLevel(level) {
        if (level <= 1) return 0;
        if (level > 45) level = 45;
        
        // Compound scaling modeling real IB grade progression difficulty
        let exponent = 1.45;
        if (level > 24) exponent = 1.75; // Standard passing -> moderate
        if (level > 37) exponent = 2.15; // Moderate -> elite 38-45 range
        
        return Math.floor(120 * Math.pow(level - 1, exponent));
    }

    getLevelFromXp(xp) {
        let level = 1;
        while (level < 45 && xp >= this.getXpNeededForLevel(level + 1)) {
            level++;
        }
        return level;
    }

    addXp(amount, reason = "") {
        const oldLevel = this.state.level;
        this.state.xp += amount;
        this.state.level = this.getLevelFromXp(this.state.xp);
        
        this.addDpPoints(Math.floor(amount / 5)); // Reward DP Points proportional to XP
        this.recordActiveToday();
        this.saveState();

        if (this.state.level > oldLevel) {
            this.showNotification(`Level Up! You reached IB Score Level ${this.state.level}! 🎉`);
        } else if (reason) {
            this.showNotification(`+${amount} XP: ${reason}`);
        }
    }

    awardRewardOnce(rewardId, xp, bonusDp = 0, reason = "") {
        if (window.studyIBAccount?.signedIn) {
            if (/^(question|mock):/.test(rewardId)) return false;
            const match = String(rewardId || '').match(/^(annotation|markscheme|timer|daily|blitz):(.*)$/);
            if (match) {
                window.studyIBAccount.recordStudyReward(match[1], match[2], window.currentStudyIBSubject || null)
                    .catch(error => this.showNotification(error.message || 'Progress will sync when the connection returns.'));
                return true;
            }
            return false;
        }
        if (!rewardId || this.state.claimedRewards[rewardId]) return false;

        const xpAmount = Math.max(0, Math.floor(Number(xp) || 0));
        const directDp = Math.max(0, Math.floor(Number(bonusDp) || 0));
        const xpDp = Math.floor(xpAmount / 5);
        const oldLevel = this.state.level;

        this.state.claimedRewards[rewardId] = { xp: xpAmount, dp: directDp + xpDp };
        this.state.xp += xpAmount;
        this.state.dpPoints += directDp + xpDp;
        this.state.level = this.getLevelFromXp(this.state.xp);
        this.recordActiveToday();
        this.saveState();

        if (this.state.level > oldLevel) {
            this.showNotification(`Level Up! You reached IB Score Level ${this.state.level}!`);
        } else if (reason) {
            this.showNotification(`+${xpAmount} XP${directDp ? ` · +${directDp} DP` : ''}: ${reason}`);
        }
        return true;
    }

    revokeReward(rewardId, reason = "") {
        if (window.studyIBAccount?.signedIn) return false;
        const reward = this.state.claimedRewards[rewardId];
        if (!reward) return false;

        this.state.xp = Math.max(0, this.state.xp - (Number(reward.xp) || 0));
        this.state.dpPoints = Math.max(0, this.state.dpPoints - (Number(reward.dp) || 0));
        this.state.level = this.getLevelFromXp(this.state.xp);
        delete this.state.claimedRewards[rewardId];
        this.saveState();
        if (reason) this.showNotification(`Reward removed: ${reason}`);
        return true;
    }

    removeXp(amount, reason = "") {
        const oldLevel = this.state.level;
        this.state.xp = Math.max(0, this.state.xp - amount);
        this.state.level = this.getLevelFromXp(this.state.xp);
        
        this.state.dpPoints = Math.max(0, this.state.dpPoints - Math.floor(amount / 5));
        this.saveState();

        this.showNotification(`-${amount} XP: ${reason}`);
    }

    // --- ENERGY RECHARGE SYSTEM ---
    recalculateEnergy() {
        const now = Date.now();
        const rechargeInterval = 30 * 60 * 1000; // 30 minutes per unit recharge
        
        if (this.state.energy >= this.state.maxEnergy) {
            this.state.lastReplenishedTime = now;
            return;
        }

        const elapsed = now - this.state.lastReplenishedTime;
        const generated = Math.floor(elapsed / rechargeInterval);

        if (generated > 0) {
            this.state.energy = Math.min(this.state.maxEnergy, this.state.energy + generated);
            this.state.lastReplenishedTime = this.state.lastReplenishedTime + (generated * rechargeInterval);
        }
    }

    consumeEnergy(amount) {
        this.recalculateEnergy();
        if (this.state.energy < amount) {
            this.showNotification("Not enough Energy! Recharges 1 unit every 30 mins.");
            return false;
        }
        this.state.energy -= amount;
        this.saveState();
        return true;
    }

    getEnergyRechargeCountdown() {
        if (this.state.energy >= this.state.maxEnergy) return "Full";
        
        const now = Date.now();
        const rechargeInterval = 30 * 60 * 1000;
        const elapsed = now - this.state.lastReplenishedTime;
        const remainingMs = rechargeInterval - (elapsed % rechargeInterval);
        
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        return `+1 in ${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // --- HIGH-STAKES STREAK & SHIELDS ---
    getFormattedDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    recordActiveToday() {
        const todayStr = this.getFormattedDate(new Date());
        if (this.state.lastActiveDate === todayStr) return; // Already recorded today

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = this.getFormattedDate(yesterday);

        if (this.state.lastActiveDate === yesterdayStr || this.state.lastActiveDate === '') {
            // Maintained streak!
            this.state.streak++;
            this.showNotification(`Streak Active! Day ${this.state.streak} 🔥`);
        } else {
            this.state.streak = 1;
        }

        this.state.lastActiveDate = todayStr;
        this.saveState();
    }

    checkStreakInactivity() {
        if (this.state.lastActiveDate === '') return;

        const today = new Date();
        const todayStr = this.getFormattedDate(today);
        if (this.state.lastActiveDate === todayStr) return;

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = this.getFormattedDate(yesterday);

        if (this.state.lastActiveDate !== yesterdayStr) {
            // Inactivity detected
            if (this.state.streakShields > 0) {
                this.state.streakShields--;
                this.state.lastActiveDate = yesterdayStr;
                this.saveState();
                this.showNotification("Streak Protected! 🛡️ A Streak Shield was consumed to save your streak!");
            } else {
                this.state.streak = 0;
                this.saveState();
            }
        }
    }

    buyStreakShield() {
        const cost = 50; // Shield cost in DP Points
        if (this.state.dpPoints < cost) {
            this.showNotification("Not enough DP Points! Solve more questions to earn points.");
            return;
        }
        this.state.dpPoints -= cost;
        this.state.streakShields++;
        this.saveState();
        this.showNotification("Streak Shield Purchased! 🛡️ Streak safe from calendar day inactivity.");
    }

    addDpPoints(amount) {
        this.state.dpPoints += amount;
    }

    // --- BOSS BATTLES SYSTEM ---
    isBossDefeated(filepath) {
        return this.state.completedBosses.includes(filepath);
    }

    defeatBoss(filepath, topicName) {
        if (this.isBossDefeated(filepath)) return;
        this.state.completedBosses.push(filepath);
        this.awardRewardOnce(`boss:${filepath}`, 150, 0, `Defeated Boss in ${topicName}!`);
        this.saveState();
    }

    undefeatBoss(filepath, topicName) {
        const idx = this.state.completedBosses.indexOf(filepath);
        if (idx > -1) {
            this.state.completedBosses.splice(idx, 1);
            this.revokeReward(`boss:${filepath}`, `Uncompleted Boss in ${topicName}`);
        }
    }

    // --- COSMETIC SHOP LOGIC ---
    applyActiveTheme() {
        const htmlRoot = document.documentElement;
        if (this.state.activeTheme && this.state.activeTheme !== 'default') {
            htmlRoot.setAttribute('data-theme-accent', this.state.activeTheme);
        } else {
            htmlRoot.removeAttribute('data-theme-accent');
        }

        let scene = document.getElementById('cosmeticScene');
        if (!scene) {
            scene = document.createElement('div');
            scene.id = 'cosmeticScene';
            scene.setAttribute('aria-hidden', 'true');
            document.body.prepend(scene);
        }
        scene.className = `cosmetic-scene cosmetic-scene-${this.state.activeTheme || 'default'}`;
        this.applyProfileCosmetics();
    }

    getPetSvg(petId, decorative = false) {
        const pet = SHOP_ITEMS.pets.find(item => item.id === petId);
        const label = decorative ? ' aria-hidden="true"' : ` aria-label="${pet ? pet.name : 'Study pet'}"`;
        const common = `viewBox="0 0 96 96" role="img"${label}`;
        const pets = {
            orbit: `<svg ${common}><circle cx="48" cy="48" r="17" fill="currentColor" opacity=".22"/><circle cx="48" cy="48" r="11" fill="currentColor"/><path d="M16 48c8-14 56-22 66-4S34 72 16 48Z" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="77" cy="39" r="5" fill="#fff"/></svg>`,
            quark: `<svg ${common}><path d="M27 34 19 14l24 13h10l24-13-8 20c8 7 12 16 12 27 0 16-14 26-33 26S15 77 15 61c0-11 4-20 12-27Z" fill="currentColor"/><path d="M34 58h2M60 58h2" stroke="#09090b" stroke-width="6" stroke-linecap="round"/><path d="m42 69 6 4 6-4" fill="none" stroke="#09090b" stroke-width="3" stroke-linecap="round"/></svg>`,
            axi: `<svg ${common}><path d="M22 40 9 28l5 23-5 17 20-7M74 40l13-12-5 23 5 17-20-7" fill="currentColor" opacity=".7"/><rect x="20" y="25" width="56" height="55" rx="27" fill="currentColor"/><circle cx="38" cy="51" r="4" fill="#09090b"/><circle cx="58" cy="51" r="4" fill="#09090b"/><path d="M39 65c6 4 12 4 18 0" fill="none" stroke="#09090b" stroke-width="3" stroke-linecap="round"/></svg>`,
            comet: `<svg ${common}><path d="M8 72c20-4 24-24 38-37 11-10 26-10 39-6-12 2-20 8-24 18 15-6 24 2 27 15-8-6-16-6-24-1-11 8-18 24-36 22-8-1-15-5-20-11Z" fill="currentColor" opacity=".35"/><path d="M31 52 27 27l19 14c7-3 14-3 21 0l18-14-4 25c5 6 7 12 7 19 0 13-14 21-30 21S28 84 28 71c0-7 1-13 3-19Z" fill="currentColor"/><circle cx="48" cy="65" r="4" fill="#09090b"/><circle cx="68" cy="65" r="4" fill="#09090b"/></svg>`
        };
        return pets[petId] || '';
    }

    applyProfileCosmetics() {
        const titleLabel = document.getElementById('profileTitleLabel');
        if (titleLabel) titleLabel.textContent = this.state.activeTitle || 'IB Student';

        let companion = document.getElementById('activePetCompanion');
        if (this.state.activePet && this.state.activePet !== 'none') {
            const pet = SHOP_ITEMS.pets.find(item => item.id === this.state.activePet);
            if (!companion) {
                companion = document.createElement('div');
                companion.id = 'activePetCompanion';
                companion.className = 'active-pet-companion';
                document.body.appendChild(companion);
            }
            companion.style.setProperty('--pet-color', pet ? pet.color : '#818cf8');
            companion.style.setProperty('--pet-scale', String(Math.max(0.6, Math.min(1.8, Number(this.state.petSize) || 1))));
            companion.classList.toggle('pet-motion-disabled', this.state.petAnimations === false);
            companion.classList.toggle('pet-draggable', this.state.petDraggable !== false);
            companion.innerHTML = this.getPetSvg(this.state.activePet);
            companion.title = pet ? pet.name : 'Study pet';
            const position = this.state.petPosition || {};
            if (Number.isFinite(position.x) && Number.isFinite(position.y)) {
                companion.style.left = `${Math.max(8, position.x)}px`;
                companion.style.top = `${Math.max(8, position.y)}px`;
                companion.style.right = 'auto';
                companion.style.bottom = 'auto';
            } else {
                companion.style.left = '';
                companion.style.top = '';
                companion.style.right = '';
                companion.style.bottom = '';
            }
            this.bindPetInteractions(companion);
        } else if (companion) {
            companion.remove();
        }
    }

    buyOrEquipTheme(itemId) {
        if (window.studyIBAccount?.signedIn) {
            const owned = itemId === 'default' || this.state.purchasedThemes.includes(itemId);
            const action = owned ? window.studyIBAccount.equipCosmetic('theme', itemId) : window.studyIBAccount.purchaseCosmetic(itemId).then(() => window.studyIBAccount.equipCosmetic('theme', itemId));
            action.then(() => { this.renderShop(); this.showNotification(owned ? 'Theme equipped.' : 'Theme purchased and equipped.'); }).catch(error => this.showNotification(error.message));
            return;
        }
        if (itemId !== 'default' && !this.state.purchasedThemes.includes(itemId)) {
            window.openStudyIBAccount?.('Sign in to purchase themes and keep them across devices.');
            return;
        }
        if (itemId === 'default') {
            this.state.activeTheme = 'default';
            this.applyActiveTheme();
            this.saveState();
            this.renderShop();
            return;
        }

        const theme = SHOP_ITEMS.themes.find(t => t.id === itemId);
        if (!theme) return;

        if (this.state.purchasedThemes.includes(itemId)) {
            // Already owned, equip it!
            this.state.activeTheme = itemId;
            this.applyActiveTheme();
            this.saveState();
            this.renderShop();
            this.showNotification(`Equipped ${theme.name} Theme!`);
        } else {
            // Buy it!
            if (this.state.dpPoints < theme.cost) {
                this.showNotification("Not enough DP Points!");
                return;
            }
            this.state.dpPoints -= theme.cost;
            this.state.purchasedThemes.push(itemId);
            this.state.activeTheme = itemId;
            this.applyActiveTheme();
            this.saveState();
            this.renderShop();
            this.showNotification(`Purchased & Equipped ${theme.name} Theme!`);
        }
    }

    buyOrEquipTitle(itemId) {
        if (window.studyIBAccount?.signedIn) {
            const title = SHOP_ITEMS.titles.find(item => item.id === itemId);
            const owned = itemId === 'default' || this.state.purchasedTitles.includes(itemId) || (title && this.state.purchasedTitles.includes(title.name));
            const serverId = itemId === 'default' ? 'IB Student' : itemId;
            const action = owned ? window.studyIBAccount.equipCosmetic('title', serverId) : window.studyIBAccount.purchaseCosmetic(itemId).then(() => window.studyIBAccount.equipCosmetic('title', itemId));
            action.then(() => { this.renderShop(); this.showNotification(owned ? 'Title equipped.' : 'Title purchased and equipped.'); }).catch(error => this.showNotification(error.message));
            return;
        }
        const localTitle = SHOP_ITEMS.titles.find(item => item.id === itemId);
        if (itemId !== 'default' && !this.state.purchasedTitles.includes(itemId) && !this.state.purchasedTitles.includes(localTitle?.name)) {
            window.openStudyIBAccount?.('Sign in to purchase profile titles and keep them across devices.');
            return;
        }
        if (itemId === 'default') {
            this.state.activeTitle = 'IB Student';
            this.applyProfileCosmetics();
            this.saveState();
            this.renderShop();
            return;
        }
        const title = SHOP_ITEMS.titles.find(t => t.id === itemId);
        if (!title) return;

        if (this.state.purchasedTitles.includes(title.name)) {
            // Already owned, equip it!
            this.state.activeTitle = title.name;
            this.applyProfileCosmetics();
            this.saveState();
            this.renderShop();
            this.showNotification(`Equipped title: ${title.name}!`);
        } else {
            // Buy it!
            if (this.state.dpPoints < title.cost) {
                this.showNotification("Not enough DP Points!");
                return;
            }
            this.state.dpPoints -= title.cost;
            this.state.purchasedTitles.push(title.name);
            this.state.activeTitle = title.name;
            this.applyProfileCosmetics();
            this.saveState();
            this.renderShop();
            this.showNotification(`Purchased & Equipped title: ${title.name}!`);
        }
    }

    buyOrEquipPet(itemId) {
        if (window.studyIBAccount?.signedIn) {
            const owned = itemId === 'none' || this.state.purchasedPets.includes(itemId);
            const action = owned ? window.studyIBAccount.equipCosmetic('pet', itemId) : window.studyIBAccount.purchaseCosmetic(itemId).then(() => window.studyIBAccount.equipCosmetic('pet', itemId));
            action.then(() => { this.renderShop(); this.showNotification(owned ? 'Companion equipped.' : 'Companion purchased and equipped.'); }).catch(error => this.showNotification(error.message));
            return;
        }
        if (itemId !== 'none' && !this.state.purchasedPets.includes(itemId)) {
            window.openStudyIBAccount?.('Sign in to purchase companions and grow their friendship through real study activity.');
            return;
        }
        if (itemId === 'none') {
            this.state.activePet = 'none';
            this.applyProfileCosmetics();
            this.saveState();
            this.renderShop();
            return;
        }

        const pet = SHOP_ITEMS.pets.find(item => item.id === itemId);
        if (!pet) return;

        if (!this.state.purchasedPets.includes(itemId)) {
            if (this.state.dpPoints < pet.cost) {
                this.showNotification('Not enough DP Points!');
                return;
            }
            this.state.dpPoints -= pet.cost;
            this.state.purchasedPets.push(itemId);
        }

        this.state.activePet = itemId;
        this.applyProfileCosmetics();
        this.saveState();
        this.renderShop();
        this.showNotification(`Equipped ${pet.name}!`);
    }

    initShopListeners() {
        const shopBtn = document.getElementById('shopBtn');
        const closeShopBtn = document.getElementById('closeShopBtn');
        const shopModal = document.getElementById('shopModal');

        if (shopBtn && shopModal) {
            shopBtn.addEventListener('click', event => {
                event.preventDefault();
                event.stopImmediatePropagation();
                const sidebar = document.querySelector('.sidebar');
                const backdrop = document.getElementById('sidebarBackdrop');
                if (sidebar) sidebar.classList.remove('open');
                if (backdrop) backdrop.classList.remove('active');
                shopModal.classList.remove('hidden');
                this.renderShop();
            });
        }

        if (closeShopBtn && shopModal) {
            closeShopBtn.addEventListener('click', () => {
                shopModal.classList.add('hidden');
            });
        }

        // Tab toggles
        const tabBtns = document.querySelectorAll('.shop-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-selected', 'true');
                this.renderShop();
            });
        });
    }

    renderShop() {
        const container = document.getElementById('shopItemsContainer');
        const balanceEl = document.getElementById('shopBalance');
        if (!container || !balanceEl) return;

        balanceEl.textContent = this.state.dpPoints;

        const activeTabBtn = document.querySelector('.shop-tab-btn.active');
        const activeTab = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'themes';

        let html = '';
        if (activeTab === 'themes') {
            const themes = [
                { id: 'default', name: 'Subject Standard', cost: 0, description: 'The clean subject-aware design with no animated environment.', preview: 'default', badge: 'Included' },
                ...SHOP_ITEMS.themes
            ];
            html = themes.map(theme => {
                const owned = theme.id === 'default' || this.state.purchasedThemes.includes(theme.id);
                const equipped = this.state.activeTheme === theme.id;
                return `
                    <article class="shop-collectible-card">
                        <div class="shop-theme-preview shop-theme-preview-${theme.preview}" aria-hidden="true"><span></span><i></i></div>
                        <div class="shop-collectible-copy">
                            <div class="shop-item-title-row"><h4>${theme.name}</h4><span>${theme.badge}</span></div>
                            <p>${theme.description}</p>
                        </div>
                        <button type="button" class="shop-buy-btn ${equipped ? 'active-cosmetic' : ''}" data-shop-type="theme" data-shop-item="${theme.id}" ${equipped ? 'aria-pressed="true"' : ''}>
                            ${equipped ? 'Equipped' : owned ? 'Equip' : `${theme.cost} DP`}
                        </button>
                    </article>
                `;
            }).join('');
        } else if (activeTab === 'pets') {
            const pets = [{ id: 'none', name: 'No companion', cost: 0, description: 'Keep the workspace companion-free.', color: '#71717a' }, ...SHOP_ITEMS.pets];
            html = pets.map(pet => {
                const owned = pet.id === 'none' || this.state.purchasedPets.includes(pet.id);
                const equipped = this.state.activePet === pet.id;
                return `
                    <article class="shop-collectible-card shop-pet-card" style="--pet-color:${pet.color}">
                        <div class="shop-pet-preview" aria-hidden="true">${pet.id === 'none' ? '<span class="shop-no-pet">—</span>' : this.getPetSvg(pet.id, true)}</div>
                        <div class="shop-collectible-copy"><h4>${pet.name}</h4><p>${pet.description}</p></div>
                        <button type="button" class="shop-buy-btn ${equipped ? 'active-cosmetic' : ''}" data-shop-type="pet" data-shop-item="${pet.id}" ${equipped ? 'aria-pressed="true"' : ''}>
                            ${equipped ? 'Equipped' : owned ? 'Equip' : `${pet.cost} DP`}
                        </button>
                    </article>
                `;
            }).join('');
        } else {
            const titles = [{ id: 'default', name: 'IB Student', cost: 0, description: 'The standard candidate profile title.' }, ...SHOP_ITEMS.titles];
            html = titles.map(title => {
                const owned = title.id === 'default' || this.state.purchasedTitles.includes(title.id) || this.state.purchasedTitles.includes(title.name);
                const equipped = this.state.activeTitle === title.name;
                return `
                    <article class="shop-collectible-card shop-title-card">
                        <div class="shop-title-preview" aria-hidden="true"><span>PI</span><strong>${title.name}</strong></div>
                        <div class="shop-collectible-copy"><h4>${title.name}</h4><p>${title.description}</p></div>
                        <button type="button" class="shop-buy-btn ${equipped ? 'active-cosmetic' : ''}" data-shop-type="title" data-shop-item="${title.id}" ${equipped ? 'aria-pressed="true"' : ''}>
                            ${equipped ? 'Equipped' : owned ? 'Equip' : `${title.cost} DP`}
                        </button>
                    </article>
                `;
            }).join('');
        }

        container.innerHTML = html;
        container.querySelectorAll('[data-shop-item]').forEach(button => {
            button.addEventListener('click', () => {
                const type = button.dataset.shopType;
                const itemId = button.dataset.shopItem;
                if (type === 'theme') this.buyOrEquipTheme(itemId);
                if (type === 'pet') this.buyOrEquipPet(itemId);
                if (type === 'title') this.buyOrEquipTitle(itemId);
            });
        });
    }

    applyCloudSnapshot(snapshot) {
        if (!snapshot?.progression) return;
        const inventory = snapshot.inventory || [];
        const cosmetics = snapshot.cosmetics || {};
        const getOwned = type => inventory.filter(entry => entry.item?.item_type === type).map(entry => entry.item_id);
        this.state.xp = Number(snapshot.progression.xp) || 0;
        this.state.level = Number(snapshot.progression.level) || this.getLevelFromXp(this.state.xp);
        this.state.dpPoints = Number(snapshot.progression.coins) || 0;
        this.state.streak = Number(snapshot.progression.streak_count) || 0;
        this.state.lastActiveDate = snapshot.progression.last_activity_date || '';
        this.state.purchasedThemes = getOwned('theme');
        this.state.purchasedPets = getOwned('pet');
        this.state.purchasedTitles = getOwned('title');
        this.state.activeTheme = cosmetics.equipped_theme || 'default';
        this.state.activePet = cosmetics.equipped_pet || 'none';
        const activeTitle = cosmetics.equipped_title || 'IB Student';
        this.state.activeTitle = SHOP_ITEMS.titles.find(item => item.id === activeTitle)?.name || activeTitle;
        this.state.petSize = Number(cosmetics.pet_size) || 1;
        this.state.petPosition = cosmetics.pet_position || { x: null, y: null };
        this.state.petAnimations = cosmetics.pet_animations !== false;
        this.state.petDraggable = cosmetics.pet_draggable !== false;
        this.saveState();
        this.applyActiveTheme();
        this.renderShop();
    }

    bindPetInteractions(companion) {
        if (companion.dataset.bound === 'true') return;
        companion.dataset.bound = 'true';
        companion.addEventListener('click', () => {
            companion.classList.remove('pet-react-click');
            void companion.offsetWidth;
            companion.classList.add('pet-react-click');
        });
        let drag = null;
        companion.addEventListener('pointerdown', event => {
            if (this.state.petDraggable === false || matchMedia('(max-width: 768px)').matches || event.button !== 0) return;
            const rect = companion.getBoundingClientRect();
            drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
            companion.setPointerCapture(event.pointerId);
            companion.classList.add('is-dragging');
        });
        companion.addEventListener('pointermove', event => {
            if (!drag) return;
            const x = Math.max(8, Math.min(innerWidth - companion.offsetWidth - 8, event.clientX - drag.dx));
            const y = Math.max(8, Math.min(innerHeight - companion.offsetHeight - 8, event.clientY - drag.dy));
            companion.style.left = `${x}px`; companion.style.top = `${y}px`; companion.style.right = 'auto'; companion.style.bottom = 'auto';
        });
        companion.addEventListener('pointerup', event => {
            if (!drag) return;
            drag = null; companion.releasePointerCapture(event.pointerId); companion.classList.remove('is-dragging');
            this.state.petPosition = { x: Math.round(companion.offsetLeft), y: Math.round(companion.offsetTop) };
            this.saveState();
            if (window.studyIBAccount?.signedIn) window.studyIBAccount.updatePetPreferences({ size: this.state.petSize, position: this.state.petPosition, animations: this.state.petAnimations, draggable: this.state.petDraggable }).catch(error => this.showNotification(error.message));
        });
    }

    react(type) {
        const companion = document.getElementById('activePetCompanion');
        if (!companion || this.state.petAnimations === false) return;
        companion.classList.remove('pet-react-xp', 'pet-react-complete', 'pet-react-achievement', 'pet-react-mock');
        void companion.offsetWidth;
        companion.classList.add(type === 'achievement' ? 'pet-react-achievement' : type === 'mock' ? 'pet-react-mock' : type === 'question' ? 'pet-react-complete' : 'pet-react-xp');
    }

    // --- NOTIFICATION UTILITY ---
    showNotification(message) {
        const toast = document.createElement('div');
        toast.className = 'gamification-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // --- UI RENDER SYSTEM ---
    updateUI() {
        const container = document.getElementById('gamificationWidget');
        if (!container) return;

        const currentXp = this.state.xp;
        const currentLvlXp = this.getXpNeededForLevel(this.state.level);
        const nextLvlXp = this.getXpNeededForLevel(this.state.level + 1);
        const levelRange = nextLvlXp - currentLvlXp;
        const xpProgress = Math.max(0, currentXp - currentLvlXp);
        const xpPercent = Math.min(100, Math.round((xpProgress / levelRange) * 100));

        container.innerHTML = `
            <div class="gamification-panel">
                <!-- Level Widget -->
                <div class="game-level-row">
                    <div class="game-level-badge">LVL ${this.state.level}</div>
                    <div class="game-xp-info">
                        <span class="game-xp-label">${this.state.activeTitle || 'IB STUDENT'}</span>
                        <span class="game-xp-val">${currentXp} / ${nextLvlXp} XP</span>
                    </div>
                </div>
                <div class="game-progress-track">
                    <div class="game-progress-bar" style="width: ${xpPercent}%"></div>
                </div>

                <!-- Metrics grid -->
                <div class="game-metrics-grid">
                    <!-- Energy Indicator -->
                    <div class="game-metric-item" title="Energy: Required for AI Help & grading">
                        <div class="game-metric-header">
                            <span class="game-metric-icon">⚡</span>
                            <span class="game-metric-value">${this.state.energy}/${this.state.maxEnergy}</span>
                        </div>
                        <span class="game-metric-sub">${this.getEnergyRechargeCountdown()}</span>
                    </div>

                    <!-- Streak Tracker -->
                    <div class="game-metric-item" title="Daily Streak: Solve 1 question daily">
                        <div class="game-metric-header">
                            <span class="game-metric-icon">🔥</span>
                            <span class="game-metric-value">${this.state.streak} Days</span>
                        </div>
                        <span class="game-metric-sub">Active Streak</span>
                    </div>

                    <!-- DP Points -->
                    <div class="game-metric-item" title="DP Points: Earned from study and spent in Shop">
                        <div class="game-metric-header">
                            <span class="game-metric-icon">🪙</span>
                            <span class="game-metric-value">${this.state.dpPoints}</span>
                        </div>
                        <span class="game-metric-sub">DP Points</span>
                    </div>

                    <!-- Streak Shield Protection -->
                    <div class="game-metric-item clickable" id="buyShieldBtn" title="Streak Shields: Click to buy for 50 DP Points">
                        <div class="game-metric-header">
                            <span class="game-metric-icon">🛡️</span>
                            <span class="game-metric-value">${this.state.streakShields}</span>
                        </div>
                        <span class="game-metric-sub">Buy Shield</span>
                    </div>
                </div>
            </div>
        `;

        const buyShieldBtn = document.getElementById('buyShieldBtn');
        if (buyShieldBtn) {
            buyShieldBtn.addEventListener('click', () => {
                this.buyStreakShield();
            });
        }
    }
}

// Global hook
window.gamification = null;
function initializeGamification() {
    if (window.gamification) return;
    window.gamification = new GamificationManager();
    window.gamification.updateUI();
    window.addEventListener('studyib:progress-reaction', event => window.gamification?.react(event.detail?.type));

    // Dynamically update countdown timer every 10 seconds
    setInterval(() => {
        if (window.gamification) {
            window.gamification.recalculateEnergy();
            window.gamification.updateUI();
        }
    }, 10000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeGamification, { once: true });
} else {
    initializeGamification();
}
