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
 *   activeTheme: string; // 'default' or a purchased theme ID
 *   activeTitle: string; // custom title
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
    activeTheme: 'default',
    activeTitle: 'IB Student'
};

const SHOP_ITEMS = {
    themes: [
        { id: 'retro', name: 'Retro Terminal', cost: 150, description: 'Classic green phosphor aesthetic' },
        { id: 'cyberpunk', name: 'Neon Cyberpunk', cost: 250, description: 'Cyber pink and purple glow' },
        { id: 'nordic', name: 'Nordic Ice', cost: 200, description: 'Cool frosty blue scheme' },
        { id: 'gold', name: 'Golden Ivory', cost: 350, description: 'Sleek premium champagne gold' }
    ],
    titles: [
        { id: 'survivor', name: 'IB Survivor', cost: 50, description: 'For those braving the diploma core' },
        { id: 'conqueror', name: 'Syllabus Conqueror', cost: 150, description: 'Earned by topic perfectionists' },
        { id: 'elite', name: '7-Score Elite', cost: 300, description: 'The absolute pinnacle of IB scores' },
        { id: 'quantum', name: 'Quantum Overlord', cost: 500, description: 'Ultimate science command mastery' }
    ]
};

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
                return { ...DEFAULT_GAMIFICATION_STATE, ...parsed };
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
        return date.toISOString().split('T')[0];
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
        this.addXp(150, `Defeated Boss in ${topicName}! 👑`);
        this.saveState();
    }

    undefeatBoss(filepath, topicName) {
        const idx = this.state.completedBosses.indexOf(filepath);
        if (idx > -1) {
            this.state.completedBosses.splice(idx, 1);
            this.removeXp(150, `Uncompleted Boss in ${topicName} 👑`);
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
    }

    buyOrEquipTheme(itemId) {
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
        const title = SHOP_ITEMS.titles.find(t => t.id === itemId);
        if (!title) return;

        if (this.state.purchasedTitles.includes(title.name)) {
            // Already owned, equip it!
            this.state.activeTitle = title.name;
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
            this.saveState();
            this.renderShop();
            this.showNotification(`Purchased & Equipped title: ${title.name}!`);
        }
    }

    initShopListeners() {
        const shopBtn = document.getElementById('shopBtn');
        const closeShopBtn = document.getElementById('closeShopBtn');
        const shopModal = document.getElementById('shopModal');

        if (shopBtn && shopModal) {
            shopBtn.addEventListener('click', () => {
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
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
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
            // Include Default option
            const defaultEquipped = this.state.activeTheme === 'default';
            html += `
                <div class="shop-item-card">
                    <div class="shop-item-info">
                        <span class="shop-item-name">Default Accent</span>
                        <span class="shop-item-desc">Use subject-specific Physics Blue & Chemistry Green</span>
                    </div>
                    <div class="shop-item-action">
                        <button class="shop-buy-btn ${defaultEquipped ? 'active-cosmetic' : ''}" onclick="window.gamification.buyOrEquipTheme('default')">
                            ${defaultEquipped ? 'Active' : 'Equip'}
                        </button>
                    </div>
                </div>
            `;

            SHOP_ITEMS.themes.forEach(theme => {
                const owned = this.state.purchasedThemes.includes(theme.id);
                const equipped = this.state.activeTheme === theme.id;
                
                html += `
                    <div class="shop-item-card">
                        <div class="shop-item-info">
                            <span class="shop-item-name">${theme.name}</span>
                            <span class="shop-item-desc">${theme.description}</span>
                        </div>
                        <div class="shop-item-action">
                            <button class="shop-buy-btn ${equipped ? 'active-cosmetic' : owned ? '' : ''}" onclick="window.gamification.buyOrEquipTheme('${theme.id}')">
                                ${equipped ? 'Active' : owned ? 'Equip' : `${theme.cost} DP 🪙`}
                            </button>
                        </div>
                    </div>
                `;
            });
        } else {
            SHOP_ITEMS.titles.forEach(title => {
                const owned = this.state.purchasedTitles.includes(title.name);
                const equipped = this.state.activeTitle === title.name;
                
                html += `
                    <div class="shop-item-card">
                        <div class="shop-item-info">
                            <span class="shop-item-name">${title.name}</span>
                            <span class="shop-item-desc">${title.description}</span>
                        </div>
                        <div class="shop-item-action">
                            <button class="shop-buy-btn ${equipped ? 'active-cosmetic' : owned ? '' : ''}" onclick="window.gamification.buyOrEquipTitle('${title.id}')">
                                ${equipped ? 'Active' : owned ? 'Equip' : `${title.cost} DP 🪙`}
                            </button>
                        </div>
                    </div>
                `;
            });
        }

        container.innerHTML = html;
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
document.addEventListener('DOMContentLoaded', () => {
    window.gamification = new GamificationManager();
    window.gamification.updateUI();

    // Dynamically update countdown timer every 10 seconds
    setInterval(() => {
        if (window.gamification) {
            window.gamification.recalculateEnergy();
            window.gamification.updateUI();
        }
    }, 10000);
});
