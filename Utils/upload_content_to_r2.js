const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const contentRoot = path.join(projectRoot, 'Content');
const bucket = process.env.STUDYIB_R2_BUCKET || 'studyib-content';
const concurrency = Math.max(1, Number(process.env.STUDYIB_UPLOAD_CONCURRENCY || 4));
const retryFailedUploads = process.argv.includes('--retry-failed');
const requestedPaths = process.argv.slice(2).filter(value => value !== '--retry-failed');
const globalModules = path.join(process.env.APPDATA, 'npm', 'node_modules');
const wranglerCli = path.join(globalModules, 'wrangler', 'bin', 'wrangler.js');
const wranglerLogDir = path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'logs');
const maxAttempts = Math.max(1, Number(process.env.STUDYIB_UPLOAD_MAX_ATTEMPTS || 6));

if (!fs.existsSync(contentRoot)) {
    throw new Error(`Content directory not found: ${contentRoot}`);
}

if (!fs.existsSync(wranglerCli)) {
    throw new Error(`Global Wrangler CLI not found: ${wranglerCli}`);
}

function collectFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collectFiles(fullPath));
        else if (entry.isFile()) files.push(fullPath);
    }
    return files;
}

function resolveUploadRoots() {
    if (requestedPaths.length === 0) return [contentRoot];

    return requestedPaths.map(requestedPath => {
        const resolvedPath = path.resolve(contentRoot, requestedPath);
        const relativePath = path.relative(contentRoot, resolvedPath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            throw new Error(`Upload path must stay inside Content: ${requestedPath}`);
        }
        if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
            throw new Error(`Upload directory not found: ${resolvedPath}`);
        }
        return resolvedPath;
    });
}

function collectRateLimitedFiles() {
    if (!fs.existsSync(wranglerLogDir)) {
        throw new Error(`Wrangler log directory not found: ${wranglerLogDir}`);
    }

    const files = new Set();
    for (const entry of fs.readdirSync(wranglerLogDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
        const log = fs.readFileSync(path.join(wranglerLogDir, entry.name), 'utf8');
        if (!log.includes('429: Too Many Requests')) continue;

        const match = log.match(/Creating object "(Content\/[^"]+)" in bucket/);
        if (!match) continue;
        const relativeObjectPath = match[1].slice('Content/'.length);
        const localPath = path.join(contentRoot, ...relativeObjectPath.split('/'));
        if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
            files.add(localPath);
        }
    }

    if (files.size === 0) {
        throw new Error('No locally available rate-limited uploads were found in Wrangler logs.');
    }
    return [...files];
}

function contentTypeFor(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.pdf') return 'application/pdf';
    if (extension === '.json') return 'application/json';
    return 'application/octet-stream';
}

function uploadOnce(filePath) {
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

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function upload(filePath) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await uploadOnce(filePath);
            return;
        } catch (error) {
            lastError = error;
            if (attempt === maxAttempts) break;
            const delay = Math.min(30000, 1000 * (2 ** (attempt - 1)));
            console.warn(`Retrying ${path.relative(contentRoot, filePath)} in ${delay / 1000}s (attempt ${attempt + 1}/${maxAttempts})...`);
            await wait(delay);
        }
    }
    throw lastError;
}

async function main() {
    const uploadRoots = retryFailedUploads ? [] : resolveUploadRoots();
    const files = retryFailedUploads
        ? collectRateLimitedFiles()
        : [...new Set(uploadRoots.flatMap(collectFiles))];
    let nextIndex = 0;
    let completed = 0;
    let failed = 0;
    const startedAt = Date.now();

    const labels = retryFailedUploads
        ? 'rate-limited files recorded in Wrangler logs'
        : uploadRoots.map(root => path.relative(contentRoot, root) || 'all Content').join(', ');
    console.log(`Uploading ${files.length} files from ${labels} to ${bucket}/Content with concurrency ${concurrency}...`);

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
