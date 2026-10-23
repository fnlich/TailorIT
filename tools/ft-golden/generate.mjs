#!/usr/bin/env node
/* global process, console, Buffer, URL */
// Golden renders of free_tailor's OWN compiled render code, for packages/render's parity tests.
//
//   node tools/ft-golden/generate.mjs            (npm run golden:ft)
//
// free_tailor (F:\Develop\free_tailor, override with FT_ROOT) is read-only: this script never builds, installs or
// writes anything there. It loads `backend/dist/generators/pdfGenerator.js` (already compiled) with DB_DIR forced to
// TailorIT's .cache\ft-golden-db, behind a tripwire: while free_tailor's code is loaded, any file write outside that
// directory, any child process and any network call throws and aborts the run. Afterwards it checks that
// free_tailor's working tree and dist are exactly as they were.
//
// For each template x fixture x case it calls `generateResumeDraftPreviewHTML(resume, template)` (the editor's draft
// preview, untailored) and writes one brotli-compressed JSON bundle per template, plus manifest.json, under
// packages/render/test/golden/ft/.
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CACHE_DB = path.join(REPO, '.cache', 'ft-golden-db');
const FT_ROOT = path.resolve(process.env.FT_ROOT || 'F:\\Develop\\free_tailor');
const FT_DIST = path.join(FT_ROOT, 'backend', 'dist');
const FT_GENERATOR = path.join(FT_DIST, 'generators', 'pdfGenerator.js');
const TEMPLATES_DIR = path.join(REPO, 'apps', 'api', 'static', 'resume-templates');
const SKILLS_FILE = path.join(REPO, 'apps', 'api', 'static', 'skills', 'skills.json');
const FIXTURES_DIR = path.join(REPO, 'packages', 'render', 'test', 'fixtures');
const OUT_DIR = path.join(REPO, 'packages', 'render', 'test', 'golden', 'ft');

function fail(message) {
  console.error(`ft-golden: ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------------------------------- 1. before anything loads

process.env.DB_DIR = CACHE_DB;
if (path.resolve(process.env.DB_DIR) !== CACHE_DB) fail(`DB_DIR is ${process.env.DB_DIR}, expected ${CACHE_DB}`);
delete process.env.TAILOR_STATIC_DIR; // free_tailor reads its own static/ (identical data)
if (!fs.existsSync(FT_GENERATOR)) {
  fail(`${FT_GENERATOR} does not exist. Build free_tailor yourself if you must; this script never builds it.`);
}

const git = (...args) =>
  childProcess.execFileSync('git', ['-C', FT_ROOT, '--no-optional-locks', ...args], { encoding: 'utf8' }).trim();
const ftCommit = git('rev-parse', 'HEAD');
const ftStatusBefore = git('status', '--porcelain');
const distStatBefore = fs.statSync(FT_GENERATOR);

/** The newest mtime in a tree (to show the dist is newer than every source file it was built from). */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else if (entry.name.endsWith('.ts')) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}
const sourceNewest = newestMtime(path.join(FT_ROOT, 'backend', 'src'));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// ------------------------------------------------------------------------------------------------- 2. tripwire

const violations = [];
const restorers = [];
const inCache = (target) => {
  if (typeof target !== 'string' && !(target instanceof URL) && !Buffer.isBuffer(target)) return false;
  const resolved = path.resolve(target instanceof URL ? fileURLToPath(target) : String(target));
  const relative = path.relative(CACHE_DB, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
function trip(what) {
  violations.push(what);
  throw new Error(`ft-golden tripwire: ${what}`);
}
function patch(owner, name, guard) {
  const original = owner[name];
  if (typeof original !== 'function') return;
  owner[name] = function patched(...args) {
    guard(args);
    return original.apply(this, args);
  };
  restorers.push(() => {
    owner[name] = original;
  });
}
const writesTo = (name) => (args) => {
  if (!inCache(args[0])) trip(`fs.${name}(${String(args[0])})`);
};
const writesBoth = (name) => (args) => {
  if (!inCache(args[0]) || !inCache(args[1])) trip(`fs.${name}(${String(args[0])}, ${String(args[1])})`);
};
const opensForWrite = (name) => (args) => {
  const flags = typeof args[1] === 'string' ? args[1] : typeof args[1] === 'number' ? args[1] : 'r';
  const writing = typeof flags === 'number' ? (flags & 3) !== 0 || (flags & 64) !== 0 : /[wa+]/.test(flags);
  if (writing && !inCache(args[0])) trip(`fs.${name}(${String(args[0])}, ${flags})`);
};
function installTripwire() {
  for (const name of ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'mkdirSync', 'mkdir', 'rmSync', 'rm',
    'rmdirSync', 'rmdir', 'unlinkSync', 'unlink', 'truncateSync', 'truncate', 'utimesSync', 'utimes', 'chmodSync', 'chmod',
    'mkdtempSync', 'mkdtemp', 'createWriteStream']) {
    patch(fs, name, writesTo(name));
  }
  for (const name of ['renameSync', 'rename', 'copyFileSync', 'copyFile', 'cpSync', 'cp', 'symlinkSync', 'symlink', 'linkSync', 'link']) {
    patch(fs, name, writesBoth(name));
  }
  patch(fs, 'openSync', opensForWrite('openSync'));
  patch(fs, 'open', opensForWrite('open'));
  for (const name of ['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink', 'truncate', 'mkdtemp']) {
    patch(fs.promises, name, writesTo(`promises.${name}`));
  }
  for (const name of ['rename', 'copyFile', 'cp', 'symlink', 'link']) patch(fs.promises, name, writesBoth(`promises.${name}`));
  patch(fs.promises, 'open', opensForWrite('promises.open'));
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    patch(childProcess, name, (args) => trip(`child_process.${name}(${String(args[0])})`));
  }
  for (const name of ['connect', 'createConnection']) patch(net, name, () => trip(`net.${name}`));
  patch(net.Socket.prototype, 'connect', () => trip('net.Socket.connect'));
  for (const name of ['request', 'get']) {
    patch(http, name, () => trip(`http.${name}`));
    patch(https, name, () => trip(`https.${name}`));
  }
  patch(dns, 'lookup', () => trip('dns.lookup'));
  if (typeof globalThis.fetch === 'function') {
    const original = globalThis.fetch;
    globalThis.fetch = () => trip('fetch');
    restorers.push(() => {
      globalThis.fetch = original;
    });
  }
}
function removeTripwire() {
  for (const restore of restorers.reverse()) restore();
}

// ------------------------------------------------------------------------------------ 3. inputs (read only)

const templateFiles = fs.readdirSync(TEMPLATES_DIR).filter((name) => name.endsWith('.json')).sort();
const templates = templateFiles.map((file) => JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8')));
// TailorIT's own synthetic templates (markup that reaches locator paths the 26 do not): extra cases.
const SYNTHETIC_DIR = path.join(FIXTURES_DIR, 'templates');
const syntheticFiles = fs.readdirSync(SYNTHETIC_DIR).filter((name) => name.endsWith('.json')).sort();
const synthetic = syntheticFiles.map((file) => JSON.parse(fs.readFileSync(path.join(SYNTHETIC_DIR, file), 'utf8')));
const fixtureNames = ['minimal', 'classic-six', 'all-kinds', 'two-page', 'unicode-links', 'skills'];
const fixtures = Object.fromEntries(
  fixtureNames.map((name) => [name, JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), 'utf8'))]),
);

// ------------------------------------------------------------------------------------ 4. free_tailor's code

const consoleWarn = console.warn;
const consoleLog = console.log;
const ftMessages = [];
installTripwire();
let ft;
let cases;
const outputs = new Map();
try {
  console.warn = (...args) => ftMessages.push(args.map(String).join(' '));
  console.log = (...args) => ftMessages.push(args.map(String).join(' '));
  const requireFt = createRequire(FT_GENERATOR);
  ft = {
    generator: requireFt(FT_GENERATOR),
    templateImport: requireFt(path.join(FT_DIST, 'services', 'templateImport.js')),
    catalogue: requireFt(path.join(FT_DIST, 'config', 'sectionCatalogue.js')),
    handlebarsVersion: requireFt('handlebars').VERSION,
  };
  if (typeof ft.generator.generateResumeDraftPreviewHTML !== 'function') {
    throw new Error('free_tailor dist has no generateResumeDraftPreviewHTML');
  }

  // The cases (the test rebuilds each document from these fields; see packages/render/test/golden.test.ts).
  const SWITCHES = [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ];
  cases = [];
  for (const template of templates) {
    const caps = ft.templateImport.inferTemplateCapabilities(template.htmlContent);
    const native = ft.templateImport.inferTemplateNativeSectionOrder(template.htmlContent);
    const add = (fixture, layout, softSkills, strengths, order, noCategories = false) => {
      const base = fixtures[fixture];
      const document = { ...base, resumeSettings: { technicalSkillsLayout: layout, includeSoftSkills: softSkills, includeStrengths: strengths } };
      if (noCategories) delete document.skillCategories;
      let sectionOrder = null;
      if (order === 'reversed') {
        sectionOrder = ft.catalogue.effectiveSectionOrder(undefined, native, ft.catalogue.presenceOf(document)).reverse();
      }
      const id = [fixture, layout, `soft=${softSkills ? 1 : 0}`, `strengths=${strengths ? 1 : 0}`, order, ...(noCategories ? ['nocategories'] : [])].join('|');
      cases.push({ template: template.id, id, fixture, layout, softSkills, strengths, order, sectionOrder, noCategories });
    };
    for (const fixture of fixtureNames) {
      const own = fixtures[fixture].resumeSettings;
      for (const layout of ['categorized', 'flat']) {
        for (const order of ['native', 'reversed']) add(fixture, layout, own.includeSoftSkills, own.includeStrengths, order);
      }
    }
    for (const fixture of ['classic-six', 'all-kinds']) {
      const own = fixtures[fixture].resumeSettings;
      for (const [softSkills, strengths] of SWITCHES) {
        if (softSkills === own.includeSoftSkills && strengths === own.includeStrengths) continue;
        if ((softSkills && !caps.supportsSoftSkills) || (strengths && !caps.supportsStrengths)) continue;
        for (const order of fixture === 'classic-six' ? ['native', 'reversed'] : ['native']) {
          add(fixture, 'categorized', softSkills, strengths, order);
        }
      }
    }
    for (const layout of ['categorized', 'flat']) add('skills', layout, true, false, 'native', true);
  }
  for (const template of synthetic) {
    const caps = ft.templateImport.inferTemplateCapabilities(template.htmlContent);
    const native = ft.templateImport.inferTemplateNativeSectionOrder(template.htmlContent);
    for (const fixture of ['classic-six', 'all-kinds', 'skills', 'unicode-links']) {
      for (const layout of ['categorized', 'flat']) {
        for (const [softSkills, strengths] of SWITCHES) {
          if ((softSkills && !caps.supportsSoftSkills) || (strengths && !caps.supportsStrengths)) continue;
          for (const order of ['native', 'reversed']) {
            const document = { ...fixtures[fixture], resumeSettings: { technicalSkillsLayout: layout, includeSoftSkills: softSkills, includeStrengths: strengths } };
            const sectionOrder =
              order === 'reversed'
                ? ft.catalogue.effectiveSectionOrder(undefined, native, ft.catalogue.presenceOf(document)).reverse()
                : null;
            const id = [fixture, layout, `soft=${softSkills ? 1 : 0}`, `strengths=${strengths ? 1 : 0}`, order].join('|');
            cases.push({ template: template.id, synthetic: true, id, fixture, layout, softSkills, strengths, order, sectionOrder, noCategories: false });
          }
        }
      }
    }
  }

  // Render.
  const byId = new Map([...templates, ...synthetic].map((template) => [template.id, template]));
  for (const item of cases) {
    const template = byId.get(item.template);
    const document = {
      ...fixtures[item.fixture],
      resumeSettings: { technicalSkillsLayout: item.layout, includeSoftSkills: item.softSkills, includeStrengths: item.strengths },
    };
    if (item.noCategories) delete document.skillCategories;
    if (item.sectionOrder) document.sectionOrder = item.sectionOrder;
    // TailorIT prints `contact.website` (the portfolio link, policed like it); free_tailor has no such field, so it
    // is handed the value TailorIT derives, computed by free_tailor's own link rule.
    const prepared = ft.generator.prepareResumeRenderData(document);
    const ftResume = { ...document, contact: { ...document.contact, website: prepared.contact.portfolio ?? '' } };
    const preview = ft.generator.generateResumeDraftPreviewHTML(ftResume, template);
    item.page = preview.page;
    item.sha256 = sha256(preview.html);
    if (!outputs.has(item.template)) outputs.set(item.template, {});
    outputs.get(item.template)[item.id] = preview.html;
  }
} catch (error) {
  removeTripwire();
  console.warn = consoleWarn;
  console.log = consoleLog;
  fail(`${error instanceof Error ? error.stack : String(error)}${violations.length ? `\nviolations: ${violations.join('; ')}` : ''}`);
} finally {
  removeTripwire();
  console.warn = consoleWarn;
  console.log = consoleLog;
}

if (violations.length) fail(`free_tailor tried to: ${violations.join('; ')}`);

// --------------------------------------------------------------------------------- 5. free_tailor untouched

const ftStatusAfter = git('status', '--porcelain');
const distStatAfter = fs.statSync(FT_GENERATOR);
if (ftStatusAfter !== ftStatusBefore) fail('free_tailor working tree changed during the run');
if (distStatAfter.mtimeMs !== distStatBefore.mtimeMs) fail('free_tailor dist changed during the run');

// ------------------------------------------------------------------------------------------------- 6. write

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const file of fs.readdirSync(OUT_DIR)) if (file.endsWith('.json.br')) fs.rmSync(path.join(OUT_DIR, file));
let rawBytes = 0;
let packedBytes = 0;
for (const [templateId, htmlByCase] of outputs) {
  const json = Buffer.from(JSON.stringify({ template: templateId, cases: htmlByCase }));
  const packed = zlib.brotliCompressSync(json, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length,
    },
  });
  rawBytes += json.length;
  packedBytes += packed.length;
  fs.writeFileSync(path.join(OUT_DIR, `${templateId}.json.br`), packed);
}
const manifest = {
  generator: 'tools/ft-golden/generate.mjs',
  generatedAt: new Date().toISOString(),
  freeTailor: {
    root: FT_ROOT,
    commit: ftCommit,
    workingTreeClean: ftStatusBefore === '',
    function: 'backend/dist/generators/pdfGenerator.js generateResumeDraftPreviewHTML',
    distMtime: new Date(distStatBefore.mtimeMs).toISOString(),
    newestSourceMtime: new Date(sourceNewest).toISOString(),
    distNewerThanSources: distStatBefore.mtimeMs >= sourceNewest,
    handlebars: ft.handlebarsVersion,
  },
  node: process.version,
  inputs: {
    templates: Object.fromEntries(templateFiles.map((file) => [file, sha256(fs.readFileSync(path.join(TEMPLATES_DIR, file)))])),
    syntheticTemplates: Object.fromEntries(
      syntheticFiles.map((file) => [file, sha256(fs.readFileSync(path.join(SYNTHETIC_DIR, file)))]),
    ),
    skills: sha256(fs.readFileSync(SKILLS_FILE)),
    fixtures: Object.fromEntries(fixtureNames.map((name) => [name, sha256(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`)))])),
  },
  compare: 'HTML equal after collapsing whitespace between tags and normalising CSS inside <style> elements',
  freeTailorMessages: [...new Set(ftMessages)].filter((line) => line.includes('[templates]')),
  cases,
};
// Readable but compact: the header pretty-printed, one case per line.
const { cases: _cases, ...header } = manifest;
const headerJson = JSON.stringify(header, null, 2).replace(/\n}$/, '');
const caseLines = cases.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${headerJson},\n  "cases": [\n${caseLines}\n  ]\n}\n`);
console.log(
  `ft-golden: ${cases.length} cases over ${outputs.size} templates (free_tailor ${ftCommit.slice(0, 7)}, dist ` +
    `${manifest.freeTailor.distMtime}); ${(rawBytes / 1e6).toFixed(1)} MB of HTML packed into ${(packedBytes / 1e3).toFixed(0)} KB.`,
);
