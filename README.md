# TailorIT

A self-hosted job-search workspace that looks and works like [Simplify](https://simplify.jobs): **Jobs**, a **Job
Tracker** and **Documents** (resumes, cover letters, cover letter templates). Sign-in and the resume builder follow
free_tailor v4.2: passwordless sign-in (a Google button and six-digit email codes) and its "new resume" flow with 26
print-ready templates. The AI features run through **your own signed-in `claude` CLI**; there is no API key.

TailorIT is not affiliated with Simplify. It reproduces Simplify's layout, colours and generic wording for private
use, never its logo, wordmark or upsells; review the look before any public launch (see `docs/ARCHITECTURE.md`,
"Issues").

| Area | What you get |
|---|---|
| **Jobs** | Full-text search, Simplify's filters (job type, experience level, category, work arrangement, place or "Remote in", minimum salary, H1B, industry, company size, company, clearance, last updated, hide applied), four sorts, saved searches, and **Save all**: up to 100 of the jobs your filters match, saved in the order the list shows them, each with its best-matched resume (Undo un-saves them). The detail shows the live chip, the facts grid with an experience-level check against your preferences and the years the posting asks for, Summary / Full posting with the posting's soft skills, certifications and industries, the company, and the **Improve Your Resume** card: how many of the posting's keywords your resume has (a saved job's linked resume, else your default one; the card says which). Save and Apply go straight into the tracker. |
| **Job Tracker** | Board with drag and drop, list with Simplify's progress stepper, chart (application flow and insights), the Options menu (filters, favorites, visible columns, sort, manage jobs, CSV import/export, **Build resumes (zip)**, archive all) and the application detail (posting, documents, resume score, questions, status timeline, notes). Each job you save gets its **best-matched resume** ("Best match" in the Documents tab until you pick one, "Chosen by you"; a picker ranked by fit, and "Let TailorIT choose"). **Build resumes (zip)** downloads `{Company}/{Role}/{First_Last}_resume.{pdf,docx}` for every Saved application, or for the ones selected in Manage jobs. |
| **Documents** | Resumes (thumbnail grid and list; template chooser, editor with live preview, PDF / Word / JSON download; upload one file or up to 50 at once, with an optional AI "editable copy" for a single file; the **profile TailorIT reads from each resume**: main and soft skills, roles, certifications, industries and years of experience, as "8 yrs · React, TypeScript, Node.js +9" and under Skills and details; uploaded files are kept exactly as uploaded), Cover Letters (table and grid; AI generation with or without a template; editor with `{{VARIABLE}}` chips; PDF / Word export), Templates (six starters plus your own). |
| **Admin** | `/settings/admin`: job sources, ingest runs, job import (a CSV or JSON file, or one tab of a **Google Sheet**, read once), reports, AI health, users. |

## Requirements

- **Node 24** (`engines: >=24.11 <25`) and npm 11.
- **Windows 11, macOS or Linux.** Windows comes first: every npm script is a Node launcher, so nothing depends on a
  POSIX shell.
- **Chrome or Microsoft Edge** for PDF export, resume thumbnails of Word uploads and the demo's uploaded PDF. An
  installed browser is found automatically; otherwise set `CHROME_PATH` or run `npm run setup:browser`.
- **The `claude` CLI, signed in with a Claude subscription** (`npm i -g @anthropic-ai/claude-code`, then
  `claude auth login`). TailorIT runs `claude -p` as a child process for: importing a resume file into an editable
  resume, reading each uploaded resume (skills, roles, dates), Write / Improve with AI bullets, job analysis, cover
  letters and template fills. Things to know:
  - No API key is used. If the CLI reports API-key billing, the call is stopped.
  - Claude analyses **every job added** to TailorIT once, in the background: see "How much Claude TailorIT uses"
    below.
  - One subscription seat serves **every** user of your installation and is subject to its usage windows. That suits
    personal or self-hosted use; a public multi-user service running on one subscription likely breaks Anthropic's
    terms.
  - Calls are queued (4 interactive at a time, 1 background slot) and can take up to 5 minutes; the pages show
    progress while they run. Without the CLI everything else still works, including the deterministic job analysis.

## Setup

```sh
npm install
copy .env.example .env      # macOS / Linux: cp .env.example .env
npm run doctor              # checks Node, SQLite (FTS5), Chrome/Edge, the claude CLI and sign-in settings
```

Then edit `.env` (one file feeds both apps; a UTF-16 file saved by PowerShell is fine):

- `ADMIN_EMAILS`: addresses that become administrators (at sign-in and at every start).
- Sign-in: SMTP for email codes (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)
  and/or Google (`GOOGLE_CLIENT_ID`). `CONTACT_EMAIL` is the "Contact admin" link on the sign-in page.
- `DATA_DIR`: where the database (`tailorit.db`, SQLite in WAL mode), uploads and caches live. Default
  `%LOCALAPPDATA%\TailorIT` on Windows, `~/.local/share/tailorit` elsewhere.

## Running

```sh
npm run dev                 # web http://localhost:3100, API http://127.0.0.1:4100 (reached through /api)
```

Open **http://localhost:3100** and sign in. There are no passwords and no sign-up: an account is created the first
time someone proves an address.

- **Email code**: enter your address, then the six-digit code. With SMTP configured the code is emailed. In
  development without SMTP (`AUTH_DEV_LOG_CODES=true`, the default) the API prints it in the console instead.
- **Google**: set `GOOGLE_CLIENT_ID` (a Google Identity Services OAuth client id; no secret is needed) and add
  `http://localhost:3100` (your `APP_ORIGIN`) to the client's **Authorized JavaScript origins**. Without a client id
  the Google button is not shown.
- With neither SMTP, Google nor development code logging, nobody can sign in.

## Demo data

```sh
npm run seed:demo                              # the demo account demo@tailorit.dev ("Alex Rivera")
npm run seed:demo -- --email you@example.com   # fill your own account instead (created when needed)
npm run seed:demo -- --refresh                 # rebuild the seeded data (and re-date the demo jobs)
```

`seed:demo` loads the demo jobs (129 postings from 15 fictional companies, idempotent) and fills the account without
calling any AI: job preferences (Senior and Mid, full-time, remote or hybrid) and contact details; two built resumes
on different templates that together use all fifteen section kinds, plus an uploaded PDF printed from one of them
(skipped with a note when no Chrome/Edge is found, or with `--no-pdf`), the first set as default; 30 tracked
applications over the last three months in every status (some from the job board, some added by hand, favorites,
archived ones, notes and questions); three cover letters (a generated one, one filled from a starter template, an
uploaded Word file) and two templates of their own.

Running it again changes nothing. `--refresh` removes what the seed wrote and writes it again; for the demo address
that is the whole account. With `--email`, only seeded rows are touched: your preferences and default resume are set
only when you have none. Sign in as the account with an email code as above.

Other seeds: `npm run seed:jobs` (only the demo jobs) and `SEED_DEMO=true` (the demo jobs on the first start of an
empty database).

## Job sources

Administrators manage jobs at **/settings/admin**:

- **Sources**: Greenhouse (board token), Lever (site, global or EU), Ashby (job board name), the free_tailor Job Data
  Lake (read-only; `FT_LAKE_DB_PATH`, default `%LOCALAPPDATA%\free_tailor\db\free_tailor.db`; rows older than
  `FT_LAKE_MAX_AGE_DAYS` come in inactive) and the demo jobs. Test a board before adding it; Run now; enable or disable.
- **Schedule**: with `INGEST_ENABLED=true` every enabled source runs daily at `INGEST_DAILY_AT` (24 h,
  `INGEST_TIMEZONE` or server time), one request per second per host, identified by `INGEST_USER_AGENT` (put a
  contact address in it). Only a complete, successful fetch closes postings that disappeared.
- **Import jobs**: a CSV or JSON file, previewed and mapped column by column (free_tailor's sheet headers are
  recognised), or one tab of a Google Sheet (below).
- **Runs** (history and logs), **Reports** (jobs people reported), **AI** (CLI health and a test call), **Users**.

Apply always links to the original posting.

## Google Sheet import

Administrators can import postings from one tab of a Google Sheet at a time: **Admin › Import jobs › Google Sheet**.
It is a one-time, read-only import. TailorIT reads the tab when you import it and keeps a copy; it never writes to the
sheet, and never reads it again on its own.

Set up once:

1. In the [Google Cloud console](https://console.cloud.google.com/), pick or create a project and **turn on the Google
   Sheets API** for it (APIs & Services › Library › Google Sheets API › Enable).
2. Create a **service account** (IAM & Admin › Service accounts), then on its Keys tab **Add key › Create new key ›
   JSON**. The browser downloads the JSON key.
3. Save the key as **`service-account-key.json` in the repository root**. Git ignores that name (and
   `*.service-account.json`); never commit a key. To keep it elsewhere, set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` to its
   path (a relative path is read from the repository root; write Windows paths without quotes) and restart the API. A
   key saved at that path while the server runs is picked up without a restart.
4. Run `npm run doctor`: it checks the key and prints the address to share sheets with (the key's `client_email`).

Then, for each sheet:

1. In Google Sheets, click **Share** and add the service account's address as a **Viewer**. Admin › Import jobs ›
   Google Sheet shows the address, with Copy.
2. Paste the sheet's link, pick the tab and the header row, check the column mapping (the same as for a file), then
   **Import**. With no tab in the link, the newest tab named for a day is shown first (free_tailor's sheets add one a
   day); such a tab can give every row its date as the posted date.
3. The tab becomes a source, shown as "Google Sheet" under Sources. **Import the sheet again** reads it once more and
   updates that source.

Good to know: each import covers one tab (free_tailor's day tabs are imported one at a time), up to 10,000 rows.
Formula errors such as `#REF!` come in blank. A link cell that shows a label instead of the address (a `HYPERLINK()`
reading "Apply") cannot be a job link: that row is refused with a message. Problems are told in plain words: a sheet
not shared with the service account, the Sheets API turned off (with the link to turn it on), a computer clock that is
off, a deleted key.

## AI configuration

| Setting | Default | Meaning |
|---|---|---|
| `AI_ENABLED` | `true` | `false` turns every AI feature off. |
| `AI_CLI_BIN` | `claude` | The CLI to run (a name on PATH or a path; the npm `.cmd` shim is resolved). |
| `AI_CLI_MODEL` | `claude-sonnet-5-5` | The model for every feature, unless overridden below. `AI_CLI_FALLBACK_MODEL` is optional. |
| `AI_CLI_EFFORT` | `low` | The effort level for every feature, unless overridden below. |
| `AI_MODEL_<FEATURE>`, `AI_EFFORT_<FEATURE>` | empty | Per feature: `RESUME_IMPORT`, `BULLETS`, `JOB_ANALYSIS`, `COVER_LETTER`, `TEMPLATE_FILL`, `RESUME_ANALYSIS`. |
| `AI_CLI_CONCURRENCY`, `AI_CLI_BACKGROUND_SLOTS` | `4`, `1` | Calls at once, and how many of them background work may use. |
| `AI_CLI_TIMEOUT_MS`, `AI_CLI_FIRST_EVENT_MS` | `300000`, `30000` | The deadline of a call, and how long the CLI may stay silent at the start. |
| `AI_JOB_ANALYSIS` | `ingest` | Every job gets a free rule-based analysis the moment it is added. `ingest`: then Claude analyses each added job once, in the background, newest first (jobs from before an upgrade last); opening or saving a job never asks it. `saved`: the same, for saved jobs only. `lazy`: the first time anyone opens the job (the page shows "Refining..." and swaps it in). `off`: the rule-based analysis only. |
| `AI_JOB_ANALYSIS_PER_HOUR` | `0` | The most job analyses the background queue starts in an hour (0 = no cap). |
| `AI_JOB_ANALYSIS_WARMUP_PER_HOUR` | `0` | `lazy` only: background AI analyses per hour for jobs not opened yet (0 = off). |
| `AI_RESUME_ANALYSIS` | `auto` | `auto`: Claude also reads each uploaded resume once, after its instant rule-based reading (the file itself is never changed). `off`: the rule-based reading only. |
| `AI_RESUME_ANALYSIS_PER_HOUR` | `20` | The most resume readings started in an hour (0 = no cap). |

Every AI request is a background task: the API answers `202 {taskId}` and the page polls it, so the web server's `/api` proxy
timeout (120 s) never cuts a long call short.

**How much Claude TailorIT uses.**

- With the default `AI_JOB_ANALYSIS=ingest`, Claude analyses **every job added** to TailorIT once (each posting text
  once), on the single background slot: roughly 100 to 180 an hour, newest first. A large intake (a busy board, a big
  import) leaves a backlog of older jobs that drains as the slot allows; until then a job shows its rule-based
  analysis.
- Each uploaded resume is read by Claude once as well, before any job analysis, at most 20 an hour by default. Built
  resumes are structured already and are not sent.
- Saving a job, Save all, opening a job, choosing a resume and building the resume zip **never add AI work**: the
  best-matched resume is picked from what TailorIT has read already.
- Background work waits while the subscription's usage window is nearly used up, or while AI is held after an error,
  so people's own requests (imports, bullets, letters) keep their room.
- To use less: `AI_JOB_ANALYSIS_PER_HOUR` caps the job queue; `AI_JOB_ANALYSIS=saved`, `lazy` or `off` analyses fewer
  jobs; `AI_RESUME_ANALYSIS=off` keeps uploads to the rule-based reading; `AI_MODEL_JOB_ANALYSIS` can name a cheaper
  model.
- Admin › AI shows the CLI's health and the model each feature uses, and can make a test call. Its **Background work**
  card shows the backlog: the jobs and uploaded resumes still waiting for Claude (with those backing off, given up or
  failed), the resume matches to update, and whether background work is running or paused (until when, and why). It
  reads the database every 30 seconds while the tab is open and never calls Claude. The API's log also says when a
  background queue rests or reaches its hourly cap.

## Upgrading from the first release

The new migrations run by themselves on the next start. After it: Saved applications of a job get their best-matched
resume within seconds (a resume you linked before stays yours); Claude analyses newly added jobs first and the older
ones as the background slot allows; each scheduled job source rewrites its jobs once on its next run, which reads
their work arrangement more strictly (CSV, JSON and demo jobs keep the old reading until those sources are run again).

## Production

```sh
npm run build               # API bundled with tsup (apps/api/dist), web with next build
npm start                   # both apps with NODE_ENV=production: web on WEB_PORT, API on API_PORT
```

In production the development sign-in helpers (`AUTH_DEV_LOG_CODES`, `AUTH_DEV_FIXED_CODE`) are ignored, so configure
SMTP or Google. Set `APP_ORIGIN` to the address people open (the API refuses changes from any other origin), and put
HTTPS in front of it for anything beyond your own machine.

The web server listens on this machine only (`WEB_HOST=localhost`, in development and production alike). To serve
other machines, put a reverse proxy in front of it, or set `WEB_HOST=0.0.0.0` to listen on every network interface;
never combine `0.0.0.0` with `AUTH_DEV_FIXED_CODE`.

## Tests

| Command | What |
|---|---|
| `npm run verify` | typecheck + lint + Vitest (unit, API and render-parity tests). |
| `npx vitest run --project <shared\|render\|api\|web> [file]` | Focused Vitest runs (from the repository root). |
| `npm run test:e2e` | Playwright user flows (installed Chrome) against a running dev server at `E2E_BASE_URL` (default `http://localhost:3100`). Start that server with the fake CLI and a fixed code: `AI_CLI_BIN=tools/fake-claude/fake-claude.mjs` and `AUTH_DEV_FIXED_CODE=000000`, preferably with its own `DATA_DIR`. |
| `npm run shots` | Visual captures at 1567×889 into `e2e/artifacts/`. `e2e/visual/compare.spec.ts` needs `npm run seed:demo` first and writes side-by-side composites with your own Simplify screenshots in `e2e/reference/simplify-1..7.png` (git-ignored). |
| `npm run golden:ft` | Regenerates the render-parity goldens from free_tailor's own compiled renderer (needs the free_tailor clone). |

## Troubleshooting

- **`.env` written by PowerShell** is UTF-16: that is fine, the launchers and the API decode it.
- **`next dev` crashes on Windows** with 0xC0000005 (a native Turbopack crash): the launcher restarts it with webpack
  once by itself; to skip Turbopack altogether run `npm run dev:webpack`.
- **No PDF export** ("needs Google Chrome or Microsoft Edge"): install one, set `CHROME_PATH` to its executable, or run
  `npm run setup:browser`, which downloads Chrome into `DATA_DIR\browsers` and prints the `CHROME_PATH` line to add.
- **Port already in use** (3100 or 4100): stop the other process (Windows: `netstat -ano | findstr :3100`, then
  `taskkill /PID <pid> /T /F`) or change `WEB_PORT` / `API_PORT` together with `APP_ORIGIN` and `API_INTERNAL_URL`.
- **AI requests fail**: run `npm run doctor`; sign the CLI in with `claude auth login`; set `AI_CLI_BIN` to the full
  path when `claude` is not on the server's PATH. Admin › AI shows the CLI's health and can make a test call.
- **No sign-in code arrives**: check the `SMTP_*` settings (port 465 is implicit TLS); in development, leave SMTP
  empty to have codes printed by the API.
- **better-sqlite3 fails to load** after changing Node versions: reinstall dependencies with Node 24.
- **Odd TypeScript errors about `.next` types** after switching branches: delete `apps/web/.next`.

## Project layout

```
apps/web/          Next.js 16 + React 19 + Tailwind 4: app routes, features/<area>/, components/{ui,shell}
apps/api/          Express 4 + better-sqlite3: src/core (db, auth, files, pdf), src/ai (Claude CLI provider, queue),
                   src/features/<feature>/ (one folder per feature), migrations/, static/ (templates, skills, seed)
packages/shared/   zod contracts and pure rules both apps use (statuses, matching, parsers, letter variables)
packages/render/   the resume render engine (free_tailor's template contract, PDF/preview/DOCX documents)
scripts/           Node launchers: dev, start, doctor, setup:browser, the .env loader
tools/             fake-claude (the CLI test double), ft-golden (parity goldens), ats-fixtures
e2e/               Playwright: specs/ (flows), visual/ (captures), reference/ (your screenshots, git-ignored)
docs/              ARCHITECTURE.md, DEVELOPMENT.md, research/
```

## Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): decisions, design per feature, data model, API surface, and what was
  built differently from the plan ("As built").
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): conventions for working on the code.
- [docs/research/](docs/research/): Simplify's UI from the screenshots, and free_tailor's behaviour.
