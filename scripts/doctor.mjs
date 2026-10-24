#!/usr/bin/env node
// `npm run doctor`: checks what TailorIT needs on this machine and says what to do about anything missing.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadRootEnv, readEnvText, repoRoot } from './env.mjs';
import { paint } from './proc.mjs';

loadRootEnv();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

// Node
const major = Number(process.versions.node.split('.')[0]);
check('Node 24', major === 24, `found ${process.versions.node}`);

// Dependencies + native module
try {
  const require = createRequire(join(repoRoot, 'apps', 'api', 'package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const fts = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS fts").get();
  db.close();
  check('better-sqlite3 loads', true, fts?.fts ? 'FTS5 available' : 'FTS5 missing!');
} catch (error) {
  check('better-sqlite3 loads', false, `${error.message.split('\n')[0]} -> run: npm install`);
}

// Chrome for PDF rendering
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chrome = chromeCandidates.find((p) => existsSync(p));
check('Chrome/Edge for PDF', Boolean(chrome), chrome ?? 'none found -> set CHROME_PATH or run: npm run setup:browser');

// Claude CLI (the AI provider)
const cli = process.env.AI_CLI_BIN || 'claude';
const shell = process.platform === 'win32';
const version = spawnSync(cli, ['--version'], { encoding: 'utf8', shell, windowsHide: true, timeout: 20_000 });
if (version.status !== 0) {
  check('claude CLI', false, 'not found -> npm i -g @anthropic-ai/claude-code, then: claude auth login');
} else {
  check('claude CLI', true, version.stdout.trim());
  const status = spawnSync(cli, ['auth', 'status'], { encoding: 'utf8', shell, windowsHide: true, timeout: 20_000 });
  let info = null;
  try {
    info = JSON.parse(status.stdout);
  } catch {
    /* not JSON */
  }
  check(
    'claude signed in (subscription)',
    Boolean(info?.loggedIn) && info?.authMethod !== 'api_key',
    info ? `loggedIn=${info.loggedIn} authMethod=${info.authMethod} plan=${info.subscriptionType ?? '?'}` : 'run: claude auth login',
  );
}
check('AI model', true, process.env.AI_CLI_MODEL || 'claude-sonnet-5-5 (default)');

// Sign-in configuration
const google = Boolean(process.env.GOOGLE_CLIENT_ID);
const smtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
check('.env present', existsSync(join(repoRoot, '.env')), 'copy .env.example to .env');
check('Google sign-in', google, google ? `authorize ${process.env.APP_ORIGIN || 'http://localhost:3100'} on the OAuth client` : 'GOOGLE_CLIENT_ID not set');
check(
  'Email codes (SMTP)',
  smtp || process.env.NODE_ENV !== 'production',
  smtp ? `${process.env.SMTP_HOST}` : 'SMTP not set: in development, codes are printed by the API',
);
check('Admin accounts', Boolean(process.env.ADMIN_EMAILS), process.env.ADMIN_EMAILS || 'ADMIN_EMAILS not set (no admin)');

// Google Sheet import (optional): the service account key is a JSON key and git ignores it. Only the key's
// client_email is ever printed.
const keySetting = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim();
const keyFile = keySetting ? resolve(repoRoot, keySetting) : join(repoRoot, 'service-account-key.json');
if (!existsSync(keyFile)) {
  check('Google Sheet import', true, `off (optional): no key at ${keyFile}`);
} else {
  let key = null;
  try {
    if (statSync(keyFile).size <= 64 * 1024) key = JSON.parse(readEnvText(keyFile));
  } catch {
    key = null;
  }
  const valid =
    key !== null &&
    typeof key === 'object' &&
    (key.type === undefined || key.type === 'service_account') &&
    typeof key.client_email === 'string' &&
    key.client_email.trim() !== '' &&
    typeof key.private_key === 'string' &&
    key.private_key.includes('PRIVATE KEY');
  check(
    'Google Sheet import',
    valid,
    valid ? `share sheets with ${key.client_email} (Viewer)` : `${keyFile} is not a service account JSON key -> download a JSON key of the service account`,
  );
  const inRepo = relative(repoRoot, keyFile);
  if (inRepo && !inRepo.startsWith('..') && !isAbsolute(inRepo)) {
    const path = inRepo.split(sep).join('/');
    const ignored = spawnSync('git', ['check-ignore', '-q', path], { cwd: repoRoot, windowsHide: true, timeout: 20_000 });
    if (ignored.error) check('Key file git-ignored', true, 'git not found');
    else if (ignored.status === 0) check('Key file git-ignored', true, path);
    else if (ignored.status === 1) check('Key file git-ignored', false, `${path} could be committed -> add it to .gitignore`);
    else check('Key file git-ignored', true, 'not a git checkout');
  }
}

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.log(`${r.ok ? paint('green', 'ok  ') : paint('red', 'FAIL')} ${r.name.padEnd(width)}  ${paint('gray', r.detail ?? '')}`);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
