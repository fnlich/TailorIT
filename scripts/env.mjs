// Loads the repository's single root `.env` for every launcher (and, through them, both apps).
//
// Windows PowerShell 5.1 writes UTF-16LE from `>` and `Set-Content`; read as UTF-8 such a file parses into keys full
// of NUL bytes and silently configures nothing. So the BOM decides the encoding. apps/api/src/config/env.ts parses the
// same file the same way; change the two together.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Reads a text file whatever encoding Windows wrote it in. */
export function readEnvText(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');
  }
  return buffer.toString('utf8').replace(/^﻿/, '');
}

/** `KEY=value` lines, `#` comments, optional `export `, single or double quotes (double quotes honour \n). */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rest] = match;
    let value = rest;
    if (value.startsWith('"')) {
      const end = value.lastIndexOf('"');
      value = (end > 0 ? value.slice(1, end) : value.slice(1)).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else if (value.startsWith("'")) {
      const end = value.lastIndexOf("'");
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    out[key] = value;
  }
  return out;
}

/** Applies the root `.env` to process.env. Variables already set in the environment win unless `override`. */
export function loadRootEnv({ override = false } = {}) {
  const file = join(repoRoot, '.env');
  if (!existsSync(file)) return {};
  const parsed = parseEnv(readEnvText(file));
  for (const [key, value] of Object.entries(parsed)) {
    if (override || process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}
