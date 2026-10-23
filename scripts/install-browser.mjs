#!/usr/bin/env node
// `npm run setup:browser`: downloads Chrome for PDF rendering when no installed Chrome/Edge can be used.
// Most machines don't need it: the API uses CHROME_PATH or an installed Chrome/Edge first.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRootEnv, repoRoot } from './env.mjs';

loadRootEnv();
const dataDir =
  process.env.DATA_DIR ||
  (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'TailorIT')
    : join(homedir(), '.local', 'share', 'tailorit'));
const cacheDir = join(dataDir, 'browsers');

const require = createRequire(join(repoRoot, 'apps', 'api', 'package.json'));
const browsers = await import(pathToFileURL(require.resolve('@puppeteer/browsers')).href);
const platform = browsers.detectBrowserPlatform();
const buildId = await browsers.resolveBuildId(browsers.Browser.CHROME, platform, 'stable');
console.log(`Installing Chrome ${buildId} into ${cacheDir} ...`);
const installed = await browsers.install({ browser: browsers.Browser.CHROME, buildId, cacheDir });
console.log(`Done. Add to .env:\nCHROME_PATH=${installed.executablePath}`);
