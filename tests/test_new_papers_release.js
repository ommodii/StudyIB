const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(
    `${fs.readFileSync(path.join(root, 'new_papers_data.js'), 'utf8')}\n` +
    'this.metadata = newPaperMetadata; this.papers = newPaperFullPapersData;',
    context
);

assert.strictEqual(context.metadata.version, '2026-09-19-new-papers-v1');
assert.deepStrictEqual(Array.from(context.metadata.subjects.physics.years), [2023, 2024, 2025]);

const expectedQuestionPapers = {
    physics: 30,
    chemistry: 30,
    biology: 30,
    math: 29,
    math_ai: 27,
    economics: 24,
    business: 27,
    computer_science: 22
};

for (const [subject, expectedCount] of Object.entries(expectedQuestionPapers)) {
    const entries = Object.values(context.papers[subject])
        .flatMap(sessions => Object.values(sessions).flat())
        .filter(entry => entry.resource_type === 'question_paper');
    assert.strictEqual(entries.length, expectedCount, `${subject} question-paper count`);
    assert.strictEqual(new Set(entries.map(entry => entry.qp_path)).size, expectedCount, `${subject} unique paths`);
    const withoutMarkscheme = entries.filter(entry => !entry.ms_path);
    if (subject === 'business') {
        assert.strictEqual(withoutMarkscheme.length, 2, 'Business includes two official pre-release statements');
        assert(withoutMarkscheme.every(entry => entry.qp_path.includes('pre-released-statement')));
    } else {
        assert.strictEqual(withoutMarkscheme.length, 0, `${subject} papers must have markschemes`);
    }
    assert(entries.every(entry => entry.qp_path.startsWith(
        `Content/CurriculumPapers/2026-09-19-new-papers-v1/${subject}/`
    )));
}

const topicContext = vm.createContext({});
vm.runInContext(
    `${fs.readFileSync(path.join(root, 'topic_question_data.js'), 'utf8')}\n` +
    'this.practice = topicQuestionPracticeData;',
    topicContext
);
const newPrefix = 'Content/TopicQuestionBank/2026-09-19-new-papers-v1/';
const newQuestions = Object.values(topicContext.practice)
    .flatMap(categories => Object.values(categories))
    .flatMap(subtopics => Object.values(subtopics))
    .flat()
    .filter(question => question.filepath.startsWith(newPrefix));
assert.strictEqual(new Set(newQuestions.map(question => question.filepath)).size, 1730);

console.log('New-paper release checks passed.');
