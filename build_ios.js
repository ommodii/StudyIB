/**
 * build_ios.js
 * ─────────────────────────────────────────────────────────────────
 * Builds the iOS/Capacitor web bundle into www/.
 *
 * What it does:
 *  1. Cleans www/
 *  2. Copies all data + logic JS files
 *  3. Copies the mobile-specific HTML, CSS, and app.mobile.js from src/mobile/
 *     (renaming index.html → www/index.html so Capacitor picks it up)
 *  4. Copies atom.js, gamification.js, radar_chart.js (unchanged logic)
 *  5. Copies atom.css (used by the note-taking component)
 *  6. Copies Content/ folder (PDFs)
 *
 * Desktop files (index.html, index.css) are NOT copied — this bundle
 * is iOS-only and won't affect the Electron/web desktop build.
 *
 * Usage:
 *   node build_ios.js
 *   npx cap sync ios
 *   npx cap open ios
 * ─────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

const rootDir   = __dirname;
const mobileDir = path.join(rootDir, 'src', 'mobile');
const destDir   = path.join(rootDir, 'www');

/* ── Shared data / logic files (from project root) ── */
const rootFiles = [
  'atom.js',
  'gamification.js',
  'radar_chart.js',
  'data.js',
  'practice_data.js',
  'chemistry_data.js',
  'chemistry_practice_data.js',
  'alevel_data.js',
  'boundaries_data.js',
  'atom.css',              // note-taking component stylesheet
  'index.css',            // content-component styles (dojo-*, nav-item, pdf-card, etc.)
                          // loaded by mobile/index.html AFTER mobile.css so layout rules are overridden
];

/* ── Mobile-specific files (from src/mobile/) ── */
const mobileFiles = [
  { src: 'index.html',      dest: 'index.html'      },
  { src: 'mobile.css',      dest: 'mobile.css'      },
  { src: 'app.mobile.js',   dest: 'app.mobile.js'   },
];

/* ── Folders from root to copy verbatim ── */
const foldersToCopy = ['Content'];

/* ── Helpers ── */
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyFolder(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyFolder(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/* ── Main ── */
console.log('\n🔨  Building iOS Capacitor bundle → www/\n');

// 1. Clean output directory
if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true });
  console.log('   Cleaned www/');
}
fs.mkdirSync(destDir, { recursive: true });

// 2. Root shared files
let ok = 0, warn = 0;
for (const file of rootFiles) {
  const src  = path.join(rootDir, file);
  const dest = path.join(destDir, file);
  if (fs.existsSync(src)) {
    copyFile(src, dest);
    console.log(`   ✓  ${file}`);
    ok++;
  } else {
    console.warn(`   ⚠  Not found (skipped): ${file}`);
    warn++;
  }
}

// 3. Mobile-specific files
for (const { src: srcName, dest: destName } of mobileFiles) {
  const src  = path.join(mobileDir, srcName);
  const dest = path.join(destDir, destName);
  if (fs.existsSync(src)) {
    copyFile(src, dest);
    console.log(`   ✓  src/mobile/${srcName}  →  www/${destName}`);
    ok++;
  } else {
    console.warn(`   ⚠  Not found (skipped): src/mobile/${srcName}`);
    warn++;
  }
}

// 4. Content folder (PDFs / assets)
for (const folder of foldersToCopy) {
  const src  = path.join(rootDir, folder);
  const dest = path.join(destDir, folder);
  if (fs.existsSync(src)) {
    copyFolder(src, dest);
    console.log(`   ✓  ${folder}/  (folder)`);
    ok++;
  } else {
    console.warn(`   ⚠  Folder not found (skipped): ${folder}`);
    warn++;
  }
}

console.log(`\n✅  iOS build complete!  ${ok} items copied, ${warn} warnings.`);
console.log('   Output: www/');
console.log('\n   Next steps:');
console.log('     npx cap sync ios');
console.log('     npx cap open ios\n');
