const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const contentRoot = path.join(projectRoot, 'Content');
const bucket = process.env.STUDYIB_R2_BUCKET || 'studyib-content';
const concurrency = Math.max(1, Number(process.env.STUDYIB_UPLOAD_CONCURRENCY || 4));
const globalModules = path.join(process.env.APPDATA, 'npm', 'node_modules');
const wranglerCli = path.join(globalModules, 'wrangler', 'bin', 'wrangler.js');

if (!fs.existsSync(contentRoot)) {
    throw new Error(`Content directory not found: ${contentRoot}`);
}

if (!fs.existsSync(wranglerCli)) {
    throw new Error(`Global Wrangler CLI not found: ${wranglerCli}`);
}

function collectFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collectFiles(fullPath));
        else if (entry.isFile()) files.push(fullPath);
    }
    return files;
}

function contentTypeFor(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.pdf') return 'application/pdf';
    if (extension === '.json') return 'application/json';
    return 'application/octet-stream';
}

function upload(filePath) {
    const relativePath = path.relative(contentRoot, filePath).split(path.sep).join('/');
    const objectPath = `${bucket}/Content/${relativePath}`;
    const args = [
        wranglerCli,
        'r2', 'object', 'put', objectPath,
        '--file', filePath,
        '--content-type', contentTypeFor(filePath),
        '--cache-control', 'public, max-age=86400',
        '--remote'
    ];

    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            cwd: projectRoot,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`Upload failed for ${relativePath}\n${output}`));
        });
    });
}

async function main() {
    const files = collectFiles(contentRoot);
    let nextIndex = 0;
    let completed = 0;
    let failed = 0;
    const startedAt = Date.now();

    console.log(`Uploading ${files.length} files to ${bucket}/Content with concurrency ${concurrency}...`);

    async function worker() {
        while (true) {
            const index = nextIndex++;
            if (index >= files.length) return;
            try {
                await upload(files[index]);
                completed++;
                if (completed % 25 === 0 || completed === files.length) {
                    const elapsedMinutes = (Date.now() - startedAt) / 60000;
                    const rate = completed / Math.max(elapsedMinutes, 0.01);
                    const eta = (files.length - completed) / Math.max(rate, 0.01);
                    console.log(`Progress: ${completed}/${files.length} files; ETA ${eta.toFixed(1)} min`);
                }
            } catch (error) {
                failed++;
                console.error(error.message);
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (failed > 0) {
        throw new Error(`Upload finished with ${failed} failed file(s). Re-run the script to retry.`);
    }

    console.log(`Upload complete: ${completed}/${files.length} files.`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
