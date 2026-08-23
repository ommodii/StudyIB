const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'additional_subjects_data.js'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(`${source}\nthis.data = additionalSubjectFullPapersData; this.metadata = additionalSubjectPaperMetadata;`, context);

const expectedYears = {
    business: ['2016', '2017', '2018', '2019', '2020', '2021', '2022'],
    economics: ['2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022'],
    math_ai: ['2021', '2022'],
    computer_science: ['2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022']
};
const expectedEntries = { business: 39, economics: 64, math_ai: 18, computer_science: 61 };

for (const [subject, years] of Object.entries(expectedYears)) {
    assert.deepStrictEqual(Object.keys(context.data[subject]), years);
    const entries = Object.values(context.data[subject]).flatMap(sessions => Object.values(sessions).flat());
    assert.strictEqual(entries.length, expectedEntries[subject]);
    assert(entries.every(entry => entry.qp_path.startsWith('Content/CurriculumPapers/2026-08-22-additional-subjects-v1/')));
    assert(entries.every(entry => !/(french|spanish|german)/i.test(`${entry.qp_path} ${entry.ms_path || ''}`)));
}

assert.strictEqual(context.metadata.subjects.economics.unmatched_question_papers.length, 1);
assert(/2018 May.+Economics_paper_2__HL\.pdf$/i.test(context.metadata.subjects.economics.unmatched_question_papers[0]));
assert.strictEqual(context.metadata.subjects.computer_science.unmatched_question_papers.length, 1);
assert(/2015 November.+Computer_science_paper_3_HL\.pdf$/i.test(
    context.metadata.subjects.computer_science.unmatched_question_papers[0]
));
console.log('Additional-subject curriculum and pairing checks passed.');
