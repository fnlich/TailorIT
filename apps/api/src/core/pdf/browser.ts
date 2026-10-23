import { statSync } from 'node:fs';
import path from 'node:path';

// Which Chrome renders PDFs and screenshots. The installed browser is used (Puppeteer's own download is often blocked
// on Windows): CHROME_PATH when set, else the first installed Chrome or Edge in the usual places.

export interface BrowserLocation {
  executablePath: string;
  source: 'CHROME_PATH' | 'installed';
  label: string;
  /** False only for a CHROME_PATH that points nowhere (honoured anyway, and reported). */
  exists: boolean;
}

export interface BrowserLookup {
  /** CHROME_PATH from the config. */
  configuredPath: string | null;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  isFile: (candidate: string) => boolean;
}

export const MISSING_BROWSER_MESSAGE =
  'PDF export needs Google Chrome or Microsoft Edge. Install one, or set CHROME_PATH in .env.';

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function defaultBrowserLookup(configuredPath: string | null): BrowserLookup {
  return { configuredPath, platform: process.platform, env: process.env, isFile };
}

export interface BrowserCandidate {
  label: string;
  path: string;
}

const labelled = (label: string, paths: string[]): BrowserCandidate[] => paths.map((p) => ({ label, path: p }));

/** Candidate executables in preference order: Chrome before Edge, system-wide before per-user. */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): BrowserCandidate[] {
  if (platform === 'win32') {
    // Windows separators whatever the host, so the list is right (and testable) everywhere.
    const programFiles = env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const chrome = (root: string) => path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
    const edge = (root: string) => path.win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    return [
      ...labelled('Google Chrome', [...new Set([programFiles, programFilesX86])].map(chrome)),
      ...labelled('Google Chrome', env.LOCALAPPDATA ? [chrome(env.LOCALAPPDATA)] : []),
      ...labelled('Microsoft Edge', [...new Set([programFilesX86, programFiles])].map(edge)),
    ];
  }
  if (platform === 'darwin') {
    const dirs = ['/Applications', ...(env.HOME ? [path.posix.join(env.HOME, 'Applications')] : [])];
    const app = (bundle: string, binary: string) =>
      dirs.map((dir) => path.posix.join(dir, `${bundle}.app`, 'Contents', 'MacOS', binary));
    return [
      ...labelled('Google Chrome', app('Google Chrome', 'Google Chrome')),
      ...labelled('Chromium', app('Chromium', 'Chromium')),
      ...labelled('Microsoft Edge', app('Microsoft Edge', 'Microsoft Edge')),
    ];
  }
  const chrome = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome'];
  return [
    ...labelled('Google Chrome', chrome),
    ...labelled('Chromium', ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']),
    ...labelled('Microsoft Edge', ['/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge']),
  ];
}

/**
 * The browser to launch, or null when none is installed. An explicit CHROME_PATH always wins, even when the file is
 * missing: quietly rendering with some other browser would hide the operator's mistake.
 */
export function locateBrowser(lookup: BrowserLookup): BrowserLocation | null {
  if (lookup.configuredPath) {
    return {
      executablePath: lookup.configuredPath,
      source: 'CHROME_PATH',
      label: 'the browser in CHROME_PATH',
      exists: lookup.isFile(lookup.configuredPath),
    };
  }
  for (const candidate of browserCandidates(lookup.platform, lookup.env)) {
    if (lookup.isFile(candidate.path)) {
      return { executablePath: candidate.path, source: 'installed', label: candidate.label, exists: true };
    }
  }
  return null;
}
