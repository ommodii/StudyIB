const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const subjects = {
    biology: {
        papersDirectory: 'IB_Biology',
        topicsDirectory: 'Sorted_Topics_Biology',
        paperPrefix: /^Biology_/i,
        syllabusVariable: 'biologySyllabusData',
        papersVariable: 'biologyFullPapersData',
        outputFile: 'biology_data.js'
    },
    math: {
        papersDirectory: 'IB_Math',
        topicsDirectory: 'Sorted_Topics_Math',
        paperPrefix: /^Mathematics_/i,
        syllabusVariable: 'mathSyllabusData',
        papersVariable: 'mathFullPapersData',
        outputFile: 'math_data.js'
    }
};

function walkFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walkFiles(fullPath));
        else if (entry.isFile()) files.push(fullPath);
    }
    return files;
}

function relativeContentPath(filePath) {
    return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function titleCasePaperName(fileName, prefix) {
    const withoutExtension = fileName.replace(/\.pdf$/i, '').replace(prefix, '');
    return withoutExtension
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, character => character.toUpperCase());
}

function buildSyllabusData(topicsRoot) {
    const result = {};
    const pdfs = walkFiles(topicsRoot).filter(file => file.toLowerCase().endsWith('.pdf'));

    for (const filePath of pdfs) {
        const relativeParts = path.relative(topicsRoot, filePath).split(path.sep);
        if (relativeParts.length < 2) continue;

        const category = relativeParts[0];
        const filename = path.basename(filePath);
        const subtopic = filename.replace(/\.pdf$/i, '');
        result[category] ||= {};
        result[category][subtopic] ||= [];
        result[category][subtopic].push({
            filename,
            filepath: relativeContentPath(filePath)
        });
    }

    return Object.fromEntries(
        Object.keys(result)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map(category => [category, Object.fromEntries(
                Object.keys(result[category])
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                    .map(subtopic => [subtopic, result[category][subtopic]])
            )])
    );
}

function buildFullPapersData(papersRoot, paperPrefix) {
    const result = {};
    const sessionDirectories = fs.readdirSync(papersRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory());

    for (const directory of sessionDirectories) {
        const sessionMatch = directory.name.match(/^(\d{4})\s+(May|November)\s+Examination Session$/i);
        if (!sessionMatch) continue;

        const [, year, sessionName] = sessionMatch;
        const session = sessionName[0].toUpperCase() + sessionName.slice(1).toLowerCase();
        const sessionRoot = path.join(papersRoot, directory.name);
        const pdfs = walkFiles(sessionRoot).filter(file => {
            const lowerName = path.basename(file).toLowerCase();
            return lowerName.endsWith('.pdf') && !lowerName.includes('french') && !lowerName.includes('spanish');
        });
        const groups = new Map();

        for (const filePath of pdfs) {
            const filename = path.basename(filePath);
            const isMarkscheme = /_markscheme\.pdf$/i.test(filename);
            const key = filename.replace(/_markscheme(?=\.pdf$)/i, '').toLowerCase();
            if (!groups.has(key)) groups.set(key, { question: null, markscheme: null });
            const group = groups.get(key);
            if (isMarkscheme) group.markscheme = filePath;
            else group.question = filePath;
        }

        const papers = [...groups.values()]
            .filter(group => group.question)
            .map(group => ({
                name: titleCasePaperName(path.basename(group.question), paperPrefix),
                qp_path: relativeContentPath(group.question),
                ms_path: group.markscheme ? relativeContentPath(group.markscheme) : null
            }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        if (papers.length > 0) {
            result[year] ||= {};
            result[year][session] = papers;
        }
    }

    return Object.fromEntries(
        Object.keys(result)
            .sort((a, b) => Number(b) - Number(a))
            .map(year => [year, Object.fromEntries(
                ['May', 'November']
                    .filter(session => result[year][session])
                    .map(session => [session, result[year][session]])
            )])
    );
}

for (const [subjectId, config] of Object.entries(subjects)) {
    const papersRoot = path.join(projectRoot, 'Content', config.papersDirectory);
    const topicsRoot = path.join(projectRoot, 'Content', config.topicsDirectory);
    if (!fs.existsSync(papersRoot) || !fs.existsSync(topicsRoot)) {
        throw new Error(`Missing source directories for ${subjectId}`);
    }

    const syllabusData = buildSyllabusData(topicsRoot);
    const fullPapersData = buildFullPapersData(papersRoot, config.paperPrefix);
    const output = `const ${config.syllabusVariable} = ${JSON.stringify(syllabusData, null, 2)};\n\n` +
        `const ${config.papersVariable} = ${JSON.stringify(fullPapersData, null, 2)};\n`;
    fs.writeFileSync(path.join(projectRoot, config.outputFile), output, 'utf8');

    const topicCount = Object.values(syllabusData)
        .reduce((sum, subtopics) => sum + Object.keys(subtopics).length, 0);
    const paperCount = Object.values(fullPapersData)
        .reduce((yearSum, sessions) => yearSum + Object.values(sessions)
            .reduce((sessionSum, papers) => sessionSum + papers.length, 0), 0);
    console.log(`${subjectId}: ${topicCount} topical PDFs, ${paperCount} question papers`);
}
