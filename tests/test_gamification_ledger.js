const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const storage = new Map();
const makeElement = () => ({
    id: '',
    className: '',
    innerHTML: '',
    title: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    style: { setProperty() {} },
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    prepend() {},
    remove() {},
    addEventListener() {},
    querySelectorAll() { return []; }
});

const context = {
    console,
    Date,
    JSON,
    Math,
    localStorage: {
        getItem(key) { return storage.has(key) ? storage.get(key) : null; },
        setItem(key, value) { storage.set(key, String(value)); }
    },
    document: {
        documentElement: makeElement(),
        body: makeElement(),
        createElement: makeElement,
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {}
    },
    window: { addEventListener() {}, dispatchEvent() {} },
    setTimeout() {},
    setInterval() {}
};

vm.createContext(context);
vm.runInContext(
    `${fs.readFileSync('gamification.js', 'utf8')}\nthis.TestGamificationManager = GamificationManager;`,
    context
);

const manager = new context.TestGamificationManager();
assert.equal(manager.state.xp, 0);
assert.equal(manager.state.dpPoints, 50);
assert.equal(manager.awardRewardOnce('markscheme:test-question', 20), true);
assert.equal(manager.awardRewardOnce('markscheme:test-question', 20), false);
assert.equal(manager.state.xp, 20);
assert.equal(manager.state.dpPoints, 54);
assert.equal(manager.revokeReward('markscheme:test-question'), true);
assert.equal(manager.revokeReward('markscheme:test-question'), false);
assert.equal(manager.state.xp, 0);
assert.equal(manager.state.dpPoints, 50);

const restored = new context.TestGamificationManager();
assert.equal(restored.awardRewardOnce('daily:physics:2026-07-28', 50, 15), true);
assert.equal(restored.awardRewardOnce('daily:physics:2026-07-28', 50, 15), false);
assert.equal(restored.state.xp, 50);
assert.equal(restored.state.dpPoints, 75);

console.log('Reward ledger test passed: duplicate claims and reversals are idempotent.');
