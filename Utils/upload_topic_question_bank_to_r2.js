const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'output', 'local_topic_questions', 'production', 'web', 'upload_manifest.json');
const statePath = path.join(projectRoot, 'output', 'local_topic_questions', 'production', 'web', 'upload_state.json');
const wranglerCandidates = [
    path.join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js')
];
const wranglerCli = wranglerCandidates.find(candidate => fs.existsSync(candidate));
const concurrency = Math.max(1, Number(process.env.STUDYIB_UPLOAD_CONCURRENCY || 6));
const maxAttempts = Math.max(1, Number(process.env.STUDYIB_UPLOAD_MAX_ATTEMPTS || 8));

if (!fs.existsSync(manifestPath)) throw new Error(`Upload manifest not found: ${manifestPath}`);
if (!wranglerCli) throw new Error(`Wrangler CLI not found in: ${wranglerCandidates.join(', ')}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const completed = new Set(
    fs.existsSync(statePath)
        ? JSON.parse(fs.readFileSync(statePath, 'utf8')).completed || []
        : []
);
const files = manifest.files.filter(file => !completed.has(file.object_key));

function persistState() {
    const temporary = `${statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({
        version: manifest.version,
        completed: [...completed].sort(),
        updated_at: new Date().toISOString()
    }, null, 2));
    fs.renameSync(temporary, statePath);
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function uploadOnce(file) {
    const args = [
        wranglerCli, 'r2', 'object', 'put', `${manifest.bucket}/${file.object_key}`,
        '--file', file.local_path,
        '--content-type', file.content_type,
        '--cache-control', 'public, max-age=31536000, immutable',
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
        child.on('close', code => code === 0 ? resolve() : reject(new Error(output.trim())));
    });
}

async function upload(file) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await uploadOnce(file);
            return;
        } catch (error) {
            lastError = error;
            if (attempt === maxAttempts) break;
            await wait(Math.min(30000, 1000 * (2 ** (attempt - 1))));
        }
    }
    throw new Error(`${file.object_key}: ${lastError.message}`);
}

async function main() {
    console.log(`Uploading ${files.length} remaining objects (${completed.size} already complete) to ${manifest.bucket}/${manifest.prefix}`);
    let next = 0;
    let uploaded = 0;
    const failures = [];
    const started = Date.now();

    async function worker() {
        while (true) {
            const index = next++;
            if (index >= files.length) return;
            const file = files[index];
            try {
                await upload(file);
                completed.add(file.object_key);
                uploaded++;
                if (uploaded % 20 === 0 || uploaded === files.length) {
                    persistState();
                }
                if (uploaded % 100 === 0 || uploaded === files.length) {
                    const minutes = Math.max((Date.now() - started) / 60000, 0.01);
                    const rate = uploaded / minutes;
                    const eta = (files.length - uploaded) / Math.max(rate, 0.01);
                    console.log(`Progress ${uploaded}/${files.length}; ${rate.toFixed(1)} objects/min; ETA ${eta.toFixed(1)} min`);
                }
            } catch (error) {
                failures.push(error.message);
                console.error(error.message);
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
    persistState();
    if (failures.length) throw new Error(`${failures.length} upload(s) failed. Re-run to resume.`);
    console.log(`Upload complete: ${uploaded} new objects, ${completed.size}/${manifest.object_count} total.`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
