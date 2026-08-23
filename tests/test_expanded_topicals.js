const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = {};
vm.createContext(context);
vm.runInContext(
    `${fs.readFileSync(path.join(root, 'topic_question_data.js'), 'utf8')}\n` +
    'this.syllabus = topicQuestionSyllabusData; this.practice = topicQuestionPracticeData; this.metadata = topicQuestionBankMetadata;',
    context
);

assert.strictEqual(context.metadata.version, '2026-08-23-computer-science-v1');
assert.strictEqual(context.metadata.question_count, 13279);

const expected = {
    math_ai: { topics: 78, uniqueQuestions: 154 },
    business: { topics: 37, uniqueQuestions: 153 },
    economics: { topics: 31, uniqueQuestions: 229 },
    computer_science: { topics: 8, uniqueQuestions: 390 }
};

for (const [subject, counts] of Object.entries(expected)) {
    const topicCount = Object.values(context.syllabus[subject]).reduce(
        (total, group) => total + Object.keys(group).length,
        0
    );
    const questions = Object.values(context.practice[subject])
        .flatMap(group => Object.values(group).flat());
    const uniqueQuestions = new Set(questions.map(question => question.filepath));

    assert.strictEqual(topicCount, counts.topics, `${subject} topic count`);
    assert.strictEqual(uniqueQuestions.size, counts.uniqueQuestions, `${subject} unique question count`);
    const questionBankVersion = subject === 'computer_science'
        ? '2026-08-23-computer-science-v1'
        : '2026-08-22-expanded-topicals-v1';
    assert(questions.every(question => question.filepath.startsWith(
        `Content/TopicQuestionBank/${questionBankVersion}/${subject}/questions/`
    )));
    assert(questions.every(question => question.full_paper_path.startsWith(
        `Content/CurriculumPapers/2026-08-22-additional-subjects-v1/${subject}/`
    )));
}

const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
for (const subject of Object.keys(expected)) {
    assert(appSource.includes(`syllabus: () => topicQuestionSyllabusData.${subject}`));
    assert(appSource.includes(`practice: () => topicQuestionPracticeData.${subject}`));
    assert(appSource.includes(`papers: () => additionalSubjectFullPapersData.${subject}`));
}

console.log('Expanded topical-bank integration checks passed.');
