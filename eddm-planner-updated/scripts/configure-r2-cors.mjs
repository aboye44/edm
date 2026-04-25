// One-shot script: install CORS rules on the mpa-eddm-artwork R2 bucket.
//
// Cloudflare R2 needs explicit CORS rules to allow cross-origin browser PUTs
// from the EDDM v2 planner. Without these, Step 2's presigned PUT will be
// blocked by the browser at the preflight stage.
//
// Run once after creating the bucket. Re-running is safe — `wrangler r2
// bucket cors set` overwrites the rule set with the values in r2-cors.json.
//
// IMPORTANT: this script delegates to `wrangler` because the production R2
// API token (Object Read & Write scope) cannot manage bucket-level CORS.
// PutBucketCors requires Admin Read & Write scope, which we don't expose to
// the runtime — wrangler authenticates with the user's OAuth session
// (`wrangler login`), which has the necessary admin permissions.
//
// If this fails with "not logged in", run `npx wrangler login` first.
//
// Usage:
//   node eddm-planner-updated/scripts/configure-r2-cors.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORS_JSON = path.join(__dirname, 'r2-cors.json');
const BUCKET = 'mpa-eddm-artwork';
const ACCOUNT_ID = '086f4cd0916e56a48c7e0d583ea7700c'; // Alec@mailpro.org's Account

if (!existsSync(CORS_JSON)) {
  console.error('[r2-cors] CORS rules file not found at', CORS_JSON);
  process.exit(1);
}

console.log('[r2-cors] Bucket:', BUCKET);
console.log('[r2-cors] Rules file:', CORS_JSON);
console.log('[r2-cors] Rules:', readFileSync(CORS_JSON, 'utf8'));

const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID };

// Run `wrangler r2 bucket cors set` via npx so we don't need wrangler installed
// as a project dep (it's a one-shot dev tool, not a runtime dep).
const args = ['wrangler', 'r2', 'bucket', 'cors', 'set', BUCKET, '--file', CORS_JSON, '--force'];
console.log('[r2-cors] Running: npx', args.join(' '));

const result = spawnSync('npx', args, { stdio: 'inherit', env, shell: true });

if (result.status !== 0) {
  console.error('[r2-cors] wrangler exited with code', result.status);
  process.exit(result.status || 1);
}

// List back to confirm.
console.log('\n[r2-cors] Verifying live rules...');
spawnSync('npx', ['wrangler', 'r2', 'bucket', 'cors', 'list', BUCKET], {
  stdio: 'inherit',
  env,
  shell: true,
});

console.log('\n[r2-cors] CORS configured successfully.');
