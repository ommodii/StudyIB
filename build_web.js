const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const destDir = path.join(__dirname, 'www');

// Files to copy
const filesToCopy = [
    'index.html',
    'config.js',
    'app.js',
    'atom.js',
    'gamification.js',
    'radar_chart.js',
    'boundaries_data.js',
    'data.js',
    'chemistry_data.js',
    'biology_data.js',
    'math_data.js',
    'practice_data.js',
    'chemistry_practice_data.js',
    'index.css',
    'atom.css',
    '_headers'
];

const foldersToCopy = [
    'styles'
];

function copyFileSync(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

function copyFolderSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyFolderSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Clean destDir
if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
}
fs.mkdirSync(destDir, { recursive: true });

console.log("Building web assets for Capacitor...");

for (let file of filesToCopy) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (fs.existsSync(src)) {
        copyFileSync(src, dest);
        console.log(`Copied ${file}`);
    } else {
        console.warn(`Warning: file not found: ${file}`);
    }
}

for (let folder of foldersToCopy) {
    const src = path.join(srcDir, folder);
    const dest = path.join(destDir, folder);
    if (fs.existsSync(src)) {
        copyFolderSync(src, dest);
        console.log(`Copied directory ${folder}`);
    } else {
        console.warn(`Warning: folder not found: ${folder}`);
    }
}

console.log("Web build completed successfully! Output directory: www/");
