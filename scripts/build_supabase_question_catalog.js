const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'topic_question_data.js');
const outputDir = path.join(root, 'generated', 'supabase_question_catalog');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
const practiceData = vm.runInContext('topicQuestionPracticeData', context);
const metadata = vm.runInContext('topicQuestionBankMetadata', context);
const subjectArgIndex = process.argv.indexOf('--subject');
const subjectFilter = subjectArgIndex >= 0 ? process.argv[subjectArgIndex + 1] : null;

const records = new Map();
for (const [subject, categories] of Object.entries(practiceData || {})) {
    if (subjectFilter && subject !== subjectFilter) continue;
    for (const subtopics of Object.values(categories || {})) {
        for (const [topicId, questions] of Object.entries(subtopics || {})) {
            for (const question of questions || []) {
                const questionId = question.filepath || question.qp_path;
                if (!questionId) continue;
                records.set(questionId, {
                    question_id: questionId,
                    dataset_version: metadata.version,
                    subject,
                    topic_id: topicId,
                    paper_type: question.paper_type || 'UNKNOWN'
                });
            }
        }
    }
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const all = [...records.values()].sort((a, b) => a.question_id.localeCompare(b.question_id));
// Keep each statement below MCP/query transport limits.
const batchSize = 60;
const quote = value => `'${String(value).replace(/'/g, "''")}'`;
if (subjectFilter) {
    fs.writeFileSync(
        path.join(outputDir, 'deactivate_previous.sql'),
        `update public.question_catalog set active=false where subject=${quote(subjectFilter)} and dataset_version<>${quote(metadata.version)};\n`
    );
}
for (let offset = 0; offset < all.length; offset += batchSize) {
    const batch = all.slice(offset, offset + batchSize);
    const values = batch.map(item => `(${quote(item.question_id)},${quote(item.dataset_version)},${quote(item.subject)},${quote(item.topic_id)},${quote(item.paper_type)},true)`).join(',\n');
    const sql = `insert into public.question_catalog(question_id,dataset_version,subject,topic_id,paper_type,active) values\n${values}\non conflict(question_id) do update set dataset_version=excluded.dataset_version,subject=excluded.subject,topic_id=excluded.topic_id,paper_type=excluded.paper_type,active=true;\n`;
    fs.writeFileSync(path.join(outputDir, `batch_${String(offset / batchSize + 1).padStart(3, '0')}.sql`), sql);
}

fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({ dataset_version: metadata.version, question_count: all.length, batch_count: Math.ceil(all.length / batchSize) }, null, 2));
console.log(JSON.stringify({ dataset_version: metadata.version, subject: subjectFilter || 'all', question_count: all.length, batch_count: Math.ceil(all.length / batchSize), output_dir: outputDir }));
