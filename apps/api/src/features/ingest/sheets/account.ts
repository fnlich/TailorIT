import { createHash, createPrivateKey } from 'node:crypto';
import { readFileSync, statSync, type Stats } from 'node:fs';
import type { SheetAccount } from '@tailorit/shared';

// The Google service account key of the Sheet import (GOOGLE_SERVICE_ACCOUNT_KEY_FILE, by default
// <repo>/service-account-key.json, git-ignored). It is read only when needed and cached by modification time and
// size, so a key saved while the server runs is picked up without a restart. Nothing here ever puts the private key,
// its id or any token into a message, a log line or an answer: problems name the file and the field, never its text.

/** Read-only access to spreadsheets: the import never writes to Google. */
export const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** A key file is about 2.4 KB; anything much larger is not one. */
export const MAX_KEY_FILE_BYTES = 64 * 1024;

/** A service account key, parsed. `privateKey` and `privateKeyId` never leave the Google client. */
export interface ServiceAccountKey {
  clientEmail: string;
  projectId: string | null;
  privateKeyId: string | null;
  privateKey: string;
}

export type KeyFileState =
  | { ok: true; keyFile: string; key: ServiceAccountKey; /** Changes when the key does; holds no key text. */ fingerprint: string }
  | { ok: false; keyFile: string; problem: string };

const problems = {
  missing: (keyFile: string) =>
    `There is no Google service account key at ${keyFile}. Save the key there (no restart needed), or set GOOGLE_SERVICE_ACCOUNT_KEY_FILE in .env and restart the API.`,
  unreadable: (keyFile: string, code: string) => `TailorIT cannot read ${keyFile} (${code}). Check the file's permissions.`,
  tooLarge: (keyFile: string) => `The file at ${keyFile} is too large to be a key file.`,
  notJson: (keyFile: string) =>
    `The file at ${keyFile} is not a JSON key. In the Google Cloud console open IAM & Admin > Service accounts, pick the account, then Keys > Add key > Create new key > JSON, and save that file here.`,
  wrongType: (keyFile: string, type: string) =>
    `The file at ${keyFile} is ${type}, not a service account key. Download a JSON key of a service account.`,
  missingFields: (keyFile: string) =>
    `The key file at ${keyFile} has no client_email or private_key. Download a new JSON key of the service account.`,
  badKey: (keyFile: string) => `The private key in ${keyFile} cannot be read. Download a new JSON key of the service account.`,
};

/** The text of a key file whatever encoding Windows saved it in (PowerShell 5.1 writes UTF-16). */
function decode(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');
  return buffer.toString('utf8').replace(/^\ufeff/, '');
}

const codeOf = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'unknown error';

/** True when `text` is an RSA private key Node can load (the key Google signs RS256 with). */
function loadsAsRsaKey(text: string): boolean {
  try {
    return createPrivateKey(text).asymmetricKeyType === 'rsa';
  } catch {
    return false;
  }
}

/** "tailor-resume@tailor-resume-builder-493112.iam.gserviceaccount.com" belongs to project tailor-resume-builder-493112. */
function projectOfEmail(email: string): string | null {
  return /@([a-z][a-z0-9-]{4,61}[a-z0-9])\.iam\.gserviceaccount\.com$/i.exec(email)?.[1] ?? null;
}

/** Reads and checks the key file. Never throws; a problem is a sentence that names the file, never its contents. */
export function readKeyFile(keyFile: string, stat?: Stats): KeyFileState {
  const fail = (problem: string): KeyFileState => ({ ok: false, keyFile, problem });
  let info = stat;
  if (!info) {
    try {
      info = statSync(keyFile);
    } catch (error) {
      const code = codeOf(error);
      return fail(code === 'ENOENT' || code === 'ENOTDIR' ? problems.missing(keyFile) : problems.unreadable(keyFile, code));
    }
  }
  if (info.isDirectory()) return fail(problems.unreadable(keyFile, 'EISDIR'));
  if (info.size > MAX_KEY_FILE_BYTES) return fail(problems.tooLarge(keyFile));
  let text: string;
  try {
    text = decode(readFileSync(keyFile));
  } catch (error) {
    const code = codeOf(error);
    return fail(code === 'ENOENT' ? problems.missing(keyFile) : problems.unreadable(keyFile, code));
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail(problems.notJson(keyFile));
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(problems.notJson(keyFile));
  const json = data as Record<string, unknown>;
  if (json.type !== undefined && json.type !== 'service_account') {
    const type = typeof json.type === 'string' && /^[a-z_]{1,40}$/i.test(json.type) ? `a "${json.type}" credential` : 'another kind of credential';
    return fail(problems.wrongType(keyFile, type));
  }
  const clientEmail = typeof json.client_email === 'string' ? json.client_email.trim() : '';
  let privateKey = typeof json.private_key === 'string' ? json.private_key : '';
  if (!clientEmail || !privateKey.trim()) return fail(problems.missingFields(keyFile));
  if (!loadsAsRsaKey(privateKey)) {
    // A key pasted through a tool that kept "\n" as two characters.
    const unescaped = privateKey.includes('\\n') && !privateKey.includes('\n') ? privateKey.replace(/\\n/g, '\n') : null;
    if (!unescaped || !loadsAsRsaKey(unescaped)) return fail(problems.badKey(keyFile));
    privateKey = unescaped;
  }
  const projectId = typeof json.project_id === 'string' && json.project_id.trim() ? json.project_id.trim() : projectOfEmail(clientEmail);
  const privateKeyId = typeof json.private_key_id === 'string' && json.private_key_id.trim() ? json.private_key_id.trim() : null;
  const fingerprint = createHash('sha256').update(`${clientEmail}\n${privateKeyId ?? ''}\n${privateKey}`).digest('hex').slice(0, 24);
  return { ok: true, keyFile, key: { clientEmail, projectId, privateKeyId, privateKey }, fingerprint };
}

/**
 * The key file as of now: read again only when its modification time or size changed, so a key saved (or fixed)
 * while the server runs is used at once. Changing GOOGLE_SERVICE_ACCOUNT_KEY_FILE itself needs a restart.
 */
export function createKeyFileReader(keyFile: string): () => KeyFileState {
  let cached: { mtimeMs: number; size: number; state: KeyFileState } | null = null;
  return () => {
    let info: Stats;
    try {
      info = statSync(keyFile);
    } catch {
      cached = null;
      return readKeyFile(keyFile);
    }
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.state;
    const state = readKeyFile(keyFile, info);
    cached = { mtimeMs: info.mtimeMs, size: info.size, state };
    return state;
  };
}

/** The account as admins see it: the address to share sheets with, never any key material. */
export function toSheetAccount(state: KeyFileState): SheetAccount {
  return state.ok
    ? { configured: true, clientEmail: state.key.clientEmail, projectId: state.key.projectId, keyFile: state.keyFile, problem: null }
    : { configured: false, clientEmail: null, projectId: null, keyFile: state.keyFile, problem: state.problem };
}
