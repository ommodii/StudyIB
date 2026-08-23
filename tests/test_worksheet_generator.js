const assert = require('assert');
const {
    parsePageCount,
    estimateQuestionDifficulty,
    matchesDifficulty,
    normalizeWorksheetPageText,
    shouldKeepWorksheetPage,
    flattenSubjectData,
    selectRandomQuestions
} = require('../worksheet_generator.js');

assert.strictEqual(parsePageCount('6-6'), 1, 'single source page should count as one');
assert.strictEqual(parsePageCount('6-8'), 3, 'inclusive source-page range should be counted');
assert.strictEqual(parsePageCount(undefined), 1, 'missing metadata should have a conservative one-page estimate');

assert.strictEqual(estimateQuestionDifficulty({ pages: '2-2', paper_type: 'P1' }), 1, 'one-page Paper 1 question should be quick');
assert.strictEqual(estimateQuestionDifficulty({ pages: '2-3', paper_type: 'P2' }), 4, 'multi-page structured response should be extended');
assert.strictEqual(estimateQuestionDifficulty({ pages: '2-5', paper_type: 'P1' }), 5, 'long questions should remain extended regardless of paper');
assert(matchesDifficulty({ pages: '1-1', paper_type: 'P1' }, 1), 'quick filter should include short Paper 1 questions');
assert(!matchesDifficulty({ pages: '1-4', paper_type: 'P2' }, 1), 'quick filter should exclude long questions');

assert.strictEqual(normalizeWorksheetPageText('– 19 –   8825–6707'), '', 'page numbers and exam codes should not count as question content');
assert.strictEqual(shouldKeepWorksheetPage({ width: 595, height: 72, text: '– 19 – 8825–6707' }), false, 'thin footer-only crop strips should be rejected');
assert.strictEqual(shouldKeepWorksheetPage({ width: 595, height: 155, text: '35. An alternating current generator rotates 300 times. A. 2 Hz B. 3 Hz C. 4 Hz D. 5 Hz' }), true, 'short real MCQ slices must be retained');
assert.strictEqual(shouldKeepWorksheetPage({ width: 595, height: 842, text: '' }), true, 'full-size diagram or image pages must be retained conservatively');

const fixture = {
    'Theme A': {
        'A.1 Motion': [
            { filepath: 'q1.pdf', pages: '1-1', paper_type: 'P1' },
            { filepath: 'q2.pdf', pages: '2-3', paper_type: 'P2' }
        ],
        'A.2 Forces': [
            { filepath: 'q1.pdf', pages: '1-1', paper_type: 'P1' },
            { filepath: 'q3.pdf', pages: '4-4', paper_type: 'P2' }
        ]
    }
};

const allTopics = new Set(['Theme A\u241fA.1 Motion', 'Theme A\u241fA.2 Forces']);
const mixedPool = flattenSubjectData(fixture, allTopics, 3);
assert.strictEqual(mixedPool.length, 3, 'questions classified into multiple topics must be deduplicated by filepath');

const oneTopicPool = flattenSubjectData(fixture, new Set(['Theme A\u241fA.2 Forces']), 3);
assert.deepStrictEqual(oneTopicPool.map(question => question.filepath).sort(), ['q1.pdf', 'q3.pdf'], 'topic filtering should be exact');

const quickPool = flattenSubjectData(fixture, allTopics, 1);
assert.deepStrictEqual(quickPool.map(question => question.filepath), ['q1.pdf'], 'difficulty preference should filter the pool');

const deterministicRandom = () => 0.25;
const selected = selectRandomQuestions(mixedPool, 3, deterministicRandom);
assert.strictEqual(selected.length, 3, 'requested questions should be selected when available');
assert.strictEqual(new Set(selected.map(question => question.filepath)).size, 3, 'random selection must not duplicate questions');
assert.strictEqual(selectRandomQuestions(mixedPool, 20, deterministicRandom).length, 3, 'selection should cap at the available pool');

console.log('Worksheet generator tests passed.');
