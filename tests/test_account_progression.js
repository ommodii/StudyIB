const assert = require('assert');
const fs = require('fs');

const accountSource = fs.readFileSync('account.js', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8');
const cssSource = fs.readFileSync('index.css', 'utf8');
const schemaSource = fs.readFileSync('supabase/migrations/20260729133715_account_progression_v2.sql', 'utf8');
const catalogSource = fs.readFileSync('supabase/migrations/20260729141722_question_catalog_hardening.sql', 'utf8');
const guardsSource = fs.readFileSync('supabase/migrations/20260729153100_progression_abuse_guards.sql', 'utf8');
const cascadeSource = fs.readFileSync('supabase/migrations/20260729161500_auth_user_cascade_hardening.sql', 'utf8');
const settingsUpsertSource = fs.readFileSync('supabase/migrations/20260729164600_user_settings_upsert.sql', 'utf8');

for (const table of [
    'profiles', 'user_settings', 'progression_accounts', 'study_sessions',
    'question_progress', 'mock_test_results', 'subject_statistics',
    'progression_events', 'user_achievements', 'user_inventory',
    'user_cosmetics', 'pet_progress', 'local_imports'
]) {
    assert.match(schemaSource, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
}

assert.match(schemaSource, /unique\s*\(user_id,\s*event_key\)/i, 'progression events must be idempotent');
assert.match(schemaSource, /on conflict\s*\(user_id,\s*event_key\) do nothing/i, 'reward inserts must ignore duplicates');
assert.match(catalogSource, /validate_question_catalog_before_write/i, 'question progress must validate the current dataset');
assert.match(guardsSource, /v_rewarded_today\s*<\s*3/i, 'mock rewards need a daily server cap');
assert.match(guardsSource, /v_rewarded_today\s*<\s*3\s+and\s+p_duration_seconds\s*>=\s*30/i, 'short mock attempts must save without granting rewards');
assert.match(cascadeSource, /profiles_id_fkey[\s\S]*on delete cascade/i, 'profile records must cascade during account deletion');
assert.match(cascadeSource, /user_profiles_user_id_fkey[\s\S]*on delete cascade/i, 'legacy profile records must cascade during account deletion');
assert.match(settingsUpsertSource, /user_settings_insert_own[\s\S]*auth\.uid\(\)[\s\S]*user_id/i, 'settings upsert must only insert the signed-in user row');

assert.match(accountSource, /signInWithOAuth\([\s\S]*provider:\s*'google'/, 'Google OAuth must be available');
assert.match(accountSource, /signInWithOtp/, 'email magic-link authentication must be available');
assert.match(accountSource, /import_local_progress/, 'local progress must have a one-time import path');
assert.match(accountSource, /LOCAL_GAME_KEY\s*=\s*'science_qbank_gamification_state'/, 'guest progress must remain importable');
assert.match(accountSource, /const game = readJson\(LOCAL_GAME_KEY, \{\}\)/, 'local gamification data must feed the import payload');
assert.match(accountSource, /delete_my_account/, 'account deletion must use the server-side function');
assert.match(accountSource, /accountGuestAppearance/, 'light mode must remain available to guests');
assert.match(accountSource, /data-reduced-motion/, 'saved reduced-motion settings must affect the document');
assert.match(accountSource, /from\('user_settings'\)\.upsert/, 'signed-in settings must create or update the settings row');
assert.match(accountSource, /this\.applyAppearance\(allowed\.appearance, false\)/, 'signed-in appearance changes must apply immediately');
assert.match(appSource, /adaptViewerScaleToWindow/, 'paper viewer must adapt its scale when a desktop window is resized');
assert.match(appSource, /cancelActivePdfRender/, 'overlapping PDF zoom renders must be cancelled');
assert.match(appSource, /perPageLayerBudget/, 'nearby PDF pages must receive a high-resolution per-page canvas budget');
assert.match(appSource, /Math\.max\(window\.devicePixelRatio \|\| 1, 1\.5\)/, 'PDF pages must be supersampled on standard-density displays');
assert.match(appSource, /new IntersectionObserver/, 'PDF pages must render lazily around the visible viewport');
assert.match(appSource, /releaseUnannotatedPage/, 'offscreen unannotated PDF canvases must be released to bound memory use');
assert.match(appSource, /pdfContainer\.replaceChildren\(fragment\)/, 'a zoom render must preserve the working paper until its replacement is ready');
assert.match(appSource, /Math\.min\(3\.0, currentScale \+ 0\.25\)/, 'PDF zoom must not exceed its safe maximum');
assert.match(cssSource, /@media \(max-width: 1180px\)/, 'paper viewer must enter its focused layout before becoming cramped');
assert.doesNotMatch(accountSource, /service[_-]?role/i, 'service-role credentials must never appear in the client');

console.log('Account progression contract test passed: RLS, idempotency, anti-abuse, optional auth, and import hooks are present.');
