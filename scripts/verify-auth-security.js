'use strict';

/**
 * Security contract checks for authentication and cloud synchronization.
 * These checks guard the Supabase Auth identity boundary and authenticated
 * cloud-session behavior.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const auth = read('auth-antigravity.js');
const cloud = read('cloud-sync.js');
const backend = read('backend/api/auth_sync.py');
const main = read('backend/main.py');
const index = read('index.html');
const supabase = read('supabase-auth.js');

const checks = [
  ['Supabase public configuration is backend-supplied', /supabase_publishable_key/.test(main) && /public-config/.test(supabase)],
  ['Google login uses Supabase OAuth', /signInWithOAuth/.test(supabase) && /provider:\s*['"]google['"]/.test(supabase)],
  ['OAuth redirect is configurable', /supabase_redirect_url/.test(supabase) && /SUPABASE_REDIRECT_URL/.test(main)],
  ['Backend verifies Supabase JWTs', /PyJWKClient|SUPABASE_JWT_SECRET/.test(backend) && /audience=['"]authenticated['"]/.test(backend)],
  ['Backend derives identity from verified subject', /claims\[['"]sub['"]\]/.test(backend) && /UserAccount\.id == subject/.test(backend)],
  ['Cloud sync requires bearer authentication', /HTTPBearer|HTTPAuthorizationCredentials/.test(backend) && /Depends\(get_current_user\)/.test(backend)],
  ['Cloud sync rejects an email different from the authenticated user', /not authorized|does not match|email.*token|token.*email/i.test(backend)],
  ['Backend CORS is not wildcard with credentials', !/allow_origins\s*=\s*\[\s*["']\*["']\s*\][\s\S]{0,120}allow_credentials\s*=\s*True/.test(main)],
  ['Login failure does not grant access', !/catch\s*\([^)]*\)[\s\S]{0,400}localStorage\.setItem\(['"]skylark_logged_in['"],\s*['"]true['"]/.test(auth)],
  ['Sync export does not include frontend secrets', !/settings:\s*window\.SKYLARK_CONFIG/.test(cloud)],
  ['Sync token import requires an authenticated matching account', /Sign in before importing cloud data/.test(cloud) && /does not match the signed-in account/.test(cloud)],
  ['Legacy custom auth endpoints are removed', !/auth\/(register|login|google|refresh|logout)/.test(backend)],
  ['Frontend does not manually persist access tokens', !/sessionStorage\.setItem\(SESSION_TOKEN_KEY/.test(cloud) && /getAccessToken/.test(cloud)],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}`); failed++; }
}

if (failed) {
  console.error(`${failed} auth security check(s) failed.`);
  process.exit(1);
}
console.log('All auth security checks passed.');
