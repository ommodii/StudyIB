const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const manifestPath = path.resolve(process.argv[2] || 'output/local_topic_questions/production/web/upload_manifest.json');
const concurrency = Math.max(1, Number(process.argv[3] || 8));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = manifest.files || [];
const wranglerPath = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!fs.existsSync(wranglerPath)) {
    throw new Error(`Global Wrangler executable not found at ${wranglerPath}`);
}
let cursor = 0;
let completed = 0;
const failures = [];

function upload(file, attempt = 1) {
    return new Promise((resolve) => {
        const args = [
            'wrangler', 'r2', 'object', 'put', `${manifest.bucket}/${file.object_key}`,
            '--file', file.local_path,
            '--content-type', file.content_type,
            '--cache-control', 'public, max-age=31536000, immutable',
            '--remote', '--force'
        ];
        const child = spawn(process.execPath, [wranglerPath, ...args.slice(1)], {
            cwd: path.resolve(__dirname, '..'),
            stdio: ['ignore', 'ignore', 'pipe'],
            shell: false
        });
        let error = '';
        child.stderr.on('data', chunk => { error += chunk.toString(); });
        child.on('close', code => {
            if (code === 0) return resolve(true);
            if (attempt < 3) return resolve(upload(file, attempt + 1));
            failures.push({ object_key: file.object_key, error: error.trim() || `exit ${code}` });
            process.stderr.write(`Failed ${file.object_key}: ${(error.trim() || `exit ${code}`).slice(0, 500)}\n`);
            resolve(false);
        });
    });
}

async function worker() {
    while (cursor < files.length) {
        const file = files[cursor++];
        await upload(file);
        completed++;
        if (completed % 50 === 0 || completed === files.length) {
            process.stdout.write(`Uploaded ${completed}/${files.length}\n`);
        }
    }
}

Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker)).then(() => {
    if (failures.length) {
        process.stderr.write(JSON.stringify({ failures }, null, 2) + '\n');
        process.exitCode = 1;
        return;
    }
    process.stdout.write(`R2 upload complete: ${files.length} objects (${manifest.total_bytes} bytes)\n`);
});
