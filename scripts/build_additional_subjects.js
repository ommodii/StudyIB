const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION = '2026-08-22-additional-subjects-v1';
const PREFIX = `Content/CurriculumPapers/${VERSION}`;
const OUTPUT_DIR = path.join(ROOT, 'output', 'additional_subjects', 'web');

const SUBJECTS = {
    business: {
        source: 'Business_management_HL',
        label: 'Business Management HL',
        minYear: 2016,
        maxYear: 2022
    },
    economics: {
        source: 'Economics_HL',
        label: 'Economics HL',
        minYear: 2013,
        maxYear: 2022
    },
    math_ai: {
        source: 'Mathematics_applications_and_interpretation_HL',
        label: 'Math AI HL',
        minYear: 2021,
        maxYear: 2022
    }
};

const EXCLUDED_LANGUAGE = /(?:^|[_\s])(french|spanish|german)(?:[_\s.]|$)/i;

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(fullPath) : [fullPath];
    });
}

function slug(value) {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

function parseSession(directoryName) {
    const match = directoryName.match(/^(\d{4})\s+(May|November)\s+Examination Session$/i);
    if (!match) return null;
    return { year: Number(match[1]), session: match[2][0].toUpperCase() + match[2].slice(1).toLowerCase() };
}

function paperLabel(filename) {
    if (/case_study/i.test(filename)) return 'Paper 1 Case Study';
    const paper = filename.match(/paper_(\d+[A-Z]?)/i)?.[1]?.toUpperCase() || 'Unknown';
    const timezone = filename.match(/TZ(\d)/i)?.[1];
    return `Paper ${paper} HL${timezone ? ` · TZ${timezone}` : ''}`;
}

function objectKey(subjectId, year, session, filename) {
    return `${PREFIX}/${subjectId}/${year}/${session.toLowerCase()}/${slug(filename)}`;
}

const fullPapers = {};
const uploadFiles = [];
const audit = {};

for (const [subjectId, config] of Object.entries(SUBJECTS)) {
    const sourceRoot = path.join(ROOT, 'Content', config.source);
    if (!fs.existsSync(sourceRoot)) throw new Error(`Missing source directory: ${sourceRoot}`);

    const subjectData = {};
    const includedAssets = [];
    const excludedAssets = [];
    const unmatchedQuestionPapers = [];

    for (const sessionDir of fs.readdirSync(sourceRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
        const parsed = parseSession(sessionDir.name);
        if (!parsed) continue;

        const files = walk(path.join(sourceRoot, sessionDir.name))
            .filter(file => /\.pdf$/i.test(file))
            .sort((a, b) => a.localeCompare(b));

        for (const file of files) {
            const filename = path.basename(file);
            const inCurriculumWindow = parsed.year >= config.minYear && parsed.year <= config.maxYear;
            if (!inCurriculumWindow || EXCLUDED_LANGUAGE.test(filename)) {
                excludedAssets.push(path.relative(ROOT, file));
                continue;
            }
            includedAssets.push(file);
        }

        const eligible = files.filter(file => {
            const name = path.basename(file);
            return parsed.year >= config.minYear && parsed.year <= config.maxYear && !EXCLUDED_LANGUAGE.test(name);
        });
        const eligibleByName = new Map(eligible.map(file => [path.basename(file).toLowerCase(), file]));
        const entries = [];

        for (const qpPath of eligible.filter(file => !/_markscheme\.pdf$/i.test(file) && !/case_study.*_markscheme\.pdf$/i.test(file))) {
            const qpName = path.basename(qpPath);
            const isCaseStudy = /case_study/i.test(qpName);
            const msName = qpName.replace(/\.pdf$/i, '_markscheme.pdf');
            const msPath = isCaseStudy ? null : eligibleByName.get(msName.toLowerCase()) || null;
            if (!isCaseStudy && !msPath) unmatchedQuestionPapers.push(path.relative(ROOT, qpPath));

            entries.push({
                name: paperLabel(qpName),
                qp_path: objectKey(subjectId, parsed.year, parsed.session, qpName),
                ms_path: msPath ? objectKey(subjectId, parsed.year, parsed.session, path.basename(msPath)) : null,
                resource_type: isCaseStudy ? 'case_study' : 'question_paper'
            });
        }

        if (entries.length) {
            entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            subjectData[String(parsed.year)] ||= {};
            subjectData[String(parsed.year)][parsed.session] = entries;
        }
    }

    for (const localPath of includedAssets) {
        const relativeToSubject = path.relative(sourceRoot, localPath);
        const sessionInfo = parseSession(relativeToSubject.split(path.sep)[0]);
        const key = objectKey(subjectId, sessionInfo.year, sessionInfo.session, path.basename(localPath));
        const stat = fs.statSync(localPath);
        uploadFiles.push({
            local_path: localPath,
            object_key: key,
            size: stat.size,
            sha256: hashFile(localPath),
            content_type: 'application/pdf'
        });
    }

    fullPapers[subjectId] = subjectData;
    audit[subjectId] = {
        label: config.label,
        curriculum_years: `${config.minYear}-${config.maxYear}`,
        included_assets: includedAssets.length,
        website_entries: Object.values(subjectData).reduce((sum, sessions) => sum + Object.values(sessions).reduce((n, entries) => n + entries.length, 0), 0),
        unmatched_question_papers: unmatchedQuestionPapers,
        excluded_assets: excludedAssets.length
    };
}

uploadFiles.sort((a, b) => a.object_key.localeCompare(b.object_key));
if (new Set(uploadFiles.map(file => file.object_key)).size !== uploadFiles.length) {
    throw new Error('Duplicate R2 object keys detected.');
}

const metadata = {
    version: VERSION,
    prefix: PREFIX,
    generated_at: new Date().toISOString(),
    policy: 'Current and immediately previous curriculum only; English-language HL resources.',
    subjects: audit
};

const js = [
    `const additionalSubjectPaperMetadata = ${JSON.stringify(metadata)};`,
    `const additionalSubjectFullPapersData = ${JSON.stringify(fullPapers)};`,
    'const additionalSubjectSyllabusData = { business: {}, economics: {}, math_ai: {} };',
    'const additionalSubjectPracticeData = { business: {}, economics: {}, math_ai: {} };',
    ''
].join('\n');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'additional_subjects_data.js'), js);
fs.writeFileSync(path.join(OUTPUT_DIR, 'upload_manifest.json'), JSON.stringify({
    version: VERSION,
    prefix: PREFIX,
    bucket: 'studyib-content',
    object_count: uploadFiles.length,
    total_bytes: uploadFiles.reduce((sum, file) => sum + file.size, 0),
    files: uploadFiles
}, null, 2));
fs.writeFileSync(path.join(OUTPUT_DIR, 'audit.json'), JSON.stringify(metadata, null, 2));

console.log(JSON.stringify({
    version: VERSION,
    objects: uploadFiles.length,
    bytes: uploadFiles.reduce((sum, file) => sum + file.size, 0),
    subjects: audit
}, null, 2));
