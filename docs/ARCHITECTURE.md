# TailorIT — Simplify-style job app, built from scratch

## Context

`F:\Develop\TailorIT` is empty. The goal is a new job-seeker web app that looks and behaves like **Simplify** (simplify.jobs). Its header has three destinations:

- **Jobs**: Simplify's job search, including its job analysis.
- **Job Tracker**: Simplify's tracker.
- **Documents**: Resumes, Cover Letters and Cover Letter Templates.

The **Login page** and the **"new resume" logic** (create and edit a resume from scratch, not the job-tailoring pipeline) follow `free_tailor` v4.2. That is the local clone `F:\Develop\free_tailor`, branch v5.0 == v4.2, commit 4112e8e. **TailorIT is written from scratch.** free_tailor is a reference to read; it is never copied or forked. The only exceptions are the data files approved below.

**Sources of truth.** S = `C:\Users\Kelvin\AppData\Local\Temp\claude\f--Develop-TailorIT\3e5e2405-8333-495c-b973-a88d115cb0dc`.

- **UI:** the user's 7 screenshots of logged-in Simplify (`S\images\1.png`–`7.png`) and `S\scratchpad\research\screenshots-spec.md` (sampled hex colours). Screenshots beat every other source.
- **free_tailor logic:**
  - `S\scratchpad\research\ft-resume-new.md`: new-resume flow, Resume document, API, render pipeline, prompts.
  - `S\scratchpad\research\ft-resume-views.md`: thumbnail and list views, plus the generic layer for cover letters.
- **Simplify served assets** (read-only, untrusted): `S\scratchpad\simplify_raw\simplify-{design,jobs,tracker,documents}\`.
- **Step 0 of implementation** copies all research into `TailorIT\docs\research\`. This includes the Explore findings for tracker, documents, design, jobs and auth, which exist only in this session. The scratchpad is temporary.

## Decisions (user, 2026-10-22)

| Topic | Decision |
|---|---|
| Stack | Same as free_tailor, written fresh. Next.js 16.3.8 + React 19.2 + Tailwind 4 web; Express 4 + TypeScript + better-sqlite3 API; npm-workspaces monorepo with a shared package |
| AI | **Local Claude CLI**: the server spawns the signed-in `claude`. No API key. |
| AI model | Default **`claude-sonnet-5-5`**, set in `.env` (`AI_CLI_MODEL`), with per-feature overrides (`AI_MODEL_<FEATURE>`) |
| Job sources | **All four:** public ATS boards (Greenhouse, Lever, Ashby), CSV/JSON import, the free_tailor Job Data Lake (read-only), demo seed |
| Templates and skills | Reuse free_tailor's 26 resume-template JSON files and `skills.json` **as data files only** |
| Login | free_tailor's passwordless sign-in: a Google button plus a 6-digit email code. No passwords and no sign-up screen. Restyled to Simplify. |
| "Tailor my resume" | **Hidden.** The job-analysis card shows the keyword match only, and tailoring is out of scope. |

**Out of scope:**
- Simplify's Matches, Services, Refer, Partners, Question Response, Simplify+ upsells, referrals and dark mode.
- free_tailor's profiles (persons), subscriptions, credits, reporters, Google Sheets, bid assistant, calendar and orders.

## Issues to know before building (you asked to be told)

1. **The Claude CLI as the AI backend.**
   - One personal subscription seat serves every user's requests. That is fine for personal or self-hosted use. A multi-user public service running on one subscription likely breaks Anthropic's terms, and it will hit usage windows.
   - Mitigations:
     - Concurrency is capped (4 interactive, 1 background).
     - Calls stop the moment the CLI reports API-key billing.
     - The provider sits behind an interface, so an API-key provider can be added later.
2. **Job-analysis volume.** A daily ATS poll can add thousands of postings, but the CLI handles roughly 100–180 analyses an hour on its background slot.
   - Every job gets a **free deterministic analysis** at ingest (requirements bullets and keywords from the skills vocabulary).
   - **AI analysis runs lazily**, the first time anyone opens the job. Warm-up is off by default.
   - `AI_MODEL_JOB_ANALYSIS` can point at a cheaper model.
3. **Simplify's font, "Circular Std", is commercial** (Lineto). **Figtree** (OFL) ships instead. A licensed Circular is a one-line swap.
4. **Brand and trade dress.**
   - We reproduce Simplify's layout, colours and generic UI copy.
   - We never use its logo, wordmark, "Simplify+" upsells or its system cover-letter texts. TailorIT writes its own starter templates.
   - A near-identical look is fine for private use. Review it before any public launch.
5. **ATS boards.** All three endpoints are public, unauthenticated and live; shapes were verified on 2026-10-22.
   - Polling is daily, against an admin-curated board list, at 1 request/s per host with a contact User-Agent. Apply always links to the original posting.
   - Greenhouse pay ranges need one extra request per **new** job.
6. **free_tailor's Job Data Lake** keeps **one row per company + job field**, not one per posting. It has no location, original post date or active flag.
   - It is a **live WAL database**. We open it read-only (`query_only`) for short snapshot reads and never write to it.
7. **Login configuration.**
   - Reuse free_tailor's `GOOGLE_CLIENT_ID` and SMTP values. **Add `http://localhost:3100`** as an authorized JavaScript origin on that Google OAuth client.
   - With neither Google nor SMTP configured, nobody can sign in. In development, codes are printed to the API console instead.
8. **The template contract is large.** The 26 reused templates depend on free_tailor's render rules (about 2,000 lines of HTML/Handlebars logic).
   - Re-implementing them is staged (A, then B) and checked against about 600 golden renders produced by free_tailor's **own compiled code**. That code runs from TailorIT with a scratch database, so free_tailor is never touched.
   - The 7 "ATS" templates have no extra-sections hook, so projects and similar sections don't print on them. The editor says so.
9. **Windows quirks inherited from free_tailor:**
   - npm scripts run in `cmd.exe`, so no `${VAR:-x}` syntax.
   - PowerShell writes a UTF-16 `.env`.
   - Turbopack's `next dev` can crash with 0xC0000005 (fall back to webpack).
   - Stale `.next/dev` types.
   - The better-sqlite3 native ABI.
   - `.cmd` shims need a resolver.
   - The Chrome download may be blocked. We use the installed Chrome via `CHROME_PATH`.
10. **Next's `/api` rewrite proxy times out at 30 s**, while CLI calls can take up to 300 s. Every AI call is therefore an **async task**: the API answers `202 {taskId}` and the page polls. Uploads are capped at 5 MB, under the proxy's 10 MB body limit.
11. **Paper size.** The reused templates are A4 (except one, Letter), so resumes print A4. Cover letters default to **US Letter**, as Simplify does. DOCX export is a simple layout, not a copy of the template.
12. **Unknowns on Simplify's side**, held on their server: the full template-variable list, their system templates and their CSV export columns. TailorIT defines its own (listed below).
13. **Git.** `TailorIT` is not a repository.
    - The build runs `git init` (local only; no remote, no push) and commits at each work-package boundary.
    - Your 7 screenshots are stored in `e2e/reference/` and **git-ignored**, because they contain your resume names.

## Environment (verified 2026-10-22)

- **Claude CLI:** `claude` 2.1.263 is signed in (claude.ai, **Max**), with every flag the provider uses present.
- **Browsers:** Chrome and Edge are installed.
- **Node toolchain:** Node 24.19, npm 11.17, git 2.55.
- **free_tailor's `.env`:** has `GOOGLE_CLIENT_ID`, `SMTP_*` and `ADMIN_EMAILS`. Copy the values into TailorIT's `.env`, which is never committed.
- **free_tailor's lake DB:** `%LOCALAPPDATA%\free_tailor\db\free_tailor.db` (WAL).
- **Live ATS boards:** Greenhouse `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`, Lever `api.lever.co/v0/postings/{site}?mode=json`, Ashby `api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true`.
- **Templates:** none of the 26 references external fonts or URLs; they use system fonts only. Blocking the network during PDF rendering is therefore safe.

## Architecture

```
Browser ──► Next.js web :3100 ──(rewrite /api/*, cookie same-origin)──► Express API :4100
                                                     ├─ SQLite  %LOCALAPPDATA%\TailorIT\tailorit.db (WAL)
                                                     ├─ files   %LOCALAPPDATA%\TailorIT\files\ (uploads, thumbnails)
                                                     ├─ Puppeteer → installed Chrome (PDF, screenshots)
                                                     ├─ ai_tasks queue → ClaudeCliProvider → `claude -p …`
                                                     └─ ingestion scheduler (croner) → ATS / CSV-JSON / ft lake / seed
```

```
TailorIT/
├─ package.json (workspaces apps/*, packages/*; engines node ">=24.11 <25") .npmrc (save-exact) .gitattributes
├─ .env.example  tsconfig.base.json  vitest.workspace.ts  playwright.config.ts
├─ scripts/   dev.mjs env.mjs(UTF-16 aware) next-launch.mjs(Turbopack fallback) doctor.mjs install-browser.mjs
├─ packages/shared/src/{core,auth,resume,letters,jobs,tracker,match,ai,admin}  zod DTOs, enums, pure rules, taxonomy
├─ packages/render/src/{templates,gate,markup,locator,document,skills} + test/{fixtures,golden}
├─ apps/api/src/{index,app}.ts config/ core/{db,http,auth,files,pdf} ai/ features/<feature>/
│   ├─ migrations/0001_init.sql …
│   └─ static/{resume-templates/*.json(26), skills/skills.json, taxonomy/ft-job-fields.json,
│              letter-templates/*.json, fonts/*.woff2 (OFL), seed/*.json, sample-resume.json}
├─ apps/web/src/{proxy.ts, styles/globals.css, components/{ui,shell}, lib/{api,query,format,storage},
│               app/(auth)/login, app/(app)/{jobs,tracker,documents,settings},
│               app/(editor)/{resumes,cover-letter,cover-letter-template}, features/<area>/}
├─ tools/{fake-claude, ft-golden, ats-fixtures}   e2e/{specs, visual, reference(gitignored)}   docs/{research, ARCHITECTURE.md}
```

**Configuration notes**

- Internal packages are source-only. The web app consumes them via `transpilePackages`; the API runs them with `tsx` in dev and bundles them with `tsup` for prod.
- `next.config.ts`: rewrites `/api/:path*` to `API_INTERNAL_URL`; `experimental.proxyTimeout = 120000`; `turbopack.root` = the monorepo root; `turbopackFileSystemCacheForBuild: false` and `agentRules: false` (both per free_tailor).
- The API sets `trust proxy = loopback` and checks `Origin === APP_ORIGIN` on every mutating request.
- Root scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `test:e2e`, `shots`, `golden:ft`, `db:migrate`, `seed:demo`, `doctor`, and `verify` (= typecheck + lint + test). All are Node launchers, not shell syntax.
- **Migrations** are numbered `.sql` files, forward-only and checksummed in `schema_migrations`. Version ranges are reserved per package (R1 01xx, C 02xx, T 03xx, J1 04xx, J2 05xx, I 06xx).
- **`.env` groups:**
  - Core: `APP_ORIGIN=http://localhost:3100`, `WEB_PORT=3100`, `API_PORT=4100`, `API_INTERNAL_URL`, `DATA_DIR`.
  - Auth: `SESSION_TTL_DAYS`, `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`, `SMTP_*`, `CONTACT_EMAIL`, `AUTH_DEV_LOG_CODES`, `AUTH_DEV_FIXED_CODE`.
  - AI: `AI_CLI_BIN`, `AI_CLI_MODEL=claude-sonnet-5-5`, `AI_CLI_EFFORT=low`, `AI_CLI_CONCURRENCY=4`, `AI_CLI_BACKGROUND_SLOTS=1`, `AI_CLI_TIMEOUT_MS=300000`, `AI_CLI_FIRST_EVENT_MS=30000`, `AI_MODEL_{RESUME_IMPORT,BULLETS,JOB_ANALYSIS,COVER_LETTER,TEMPLATE_FILL}`, `AI_EFFORT_<FEATURE>`, `AI_JOB_ANALYSIS=lazy`, `AI_JOB_ANALYSIS_WARMUP_PER_HOUR=0`.
  - Render: `CHROME_PATH`, `PDF_RENDER_TIMEOUT_MS`, `PDF_MAX_CONCURRENCY=2`, `UPLOAD_MAX_MB=5`.
  - Ingest: `INGEST_ENABLED`, `INGEST_DAILY_AT=03:30`, `INGEST_USER_AGENT`, `FT_LAKE_DB_PATH`, `FT_LAKE_MAX_AGE_DAYS=45`.
  - Dev: `SEED_DEMO`.

**Libraries** (exact versions confirmed at install)

| Concern | Choice |
|---|---|
| Web | next 16.3.8, react / react-dom 19.2.x, tailwindcss + @tailwindcss/postcss 4.x, typescript 5.9 |
| Primitives | @base-ui/react 1.x (Simplify uses Base UI): Menu with submenus, ContextMenu, Combobox, Select, Slider, Dialog/Sheet, Toast |
| Icons | @phosphor-icons/react (regular and fill weights of the same glyph: heart, bookmark, check-circle) |
| Font | Figtree via next/font/google (stand-in for Circular Std) |
| Data | @tanstack/react-query 5 (infinite lists, optimistic drag-and-drop, task polling) |
| Editors and visuals | @tiptap/react + starter-kit 3.x, @dnd-kit/core + sortable, @nivo/sankey + html-to-image, react-day-picker, canvas-confetti, papaparse |
| API | express 4.21, multer 2, helmet, express-rate-limit, sanitize-html, croner, zod 4, handlebars 4.7, better-sqlite3 12, google-auth-library 11, nodemailer |
| Files | puppeteer 24 (installed Chrome), pdf-parse 2 (text + first-page PNG), mammoth (DOCX in), @turbodocx/html-to-docx (DOCX out) |
| Tests | vitest, supertest, @playwright/test (channel `chrome`), pixelmatch + pngjs, tsx, tsup |

## Feature design

### 1. Login and session (free_tailor's sign-in, Simplify styling)

**Route.** `/login` has no shell. `proxy.ts` sends anyone without the session cookie to `/login?next=`, and a 401 from any call does the same.

**Layout.** A centred column:
- Brand row: TailorIT logo (40 px) and wordmark.
- Card (`max-w-md`, radius 16, soft shadow):
  - Heading **"Sign in"**, with subtitle "TailorIT keeps your resumes to your own account."
  - Google Identity button (`outline`, `large`, width 320, `signin_with`).
  - An **"or"** divider.
- Below the card: **"Trouble signing in? Contact admin"**, a mailto to `CONTACT_EMAIL`.

**Flow and states.**
- Email step: **"Email address"** (placeholder `you@example.com`), then the button **"Email me a code"** (shows "Sending..." while busy).
- Code step: **"Six-digit code"** (`one-time-code`, centred, letter-spaced, placeholder `000000`), then **"Sign in"** (shows "Checking...").
- **"Use a different address"** goes back. The info notice shows the server's message, e.g. "A six-digit code is on its way to {email}. It expires in 10 minutes.".
- Other states:
  - Loading.
  - Unreachable.
  - Unavailable: "Sign-in isn't available right now. Please contact your administrator."
  - Disabled account, shown as its own card.
  - Google only, email only, or both.
- There is no theme toggle.

**API.** Errors and copy follow free_tailor's verbatim:
- `GET /auth/options`
- `POST /auth/google {credential}`, which verifies the ID token for this audience and requires `email_verified`.
- `POST /auth/email/request {email}`, with a 60 s cooldown (429).
- `POST /auth/email/verify {email, code}`
- `GET /auth/me`, which returns `{account|null}` and never a 401.
- `POST /auth/logout`

**Security.** These are free_tailor's rules plus two hardening changes.
- Login code:
  - `randomInt` 6 digits, stored as a sha256 hash.
  - 10-minute TTL and 5 attempts.
  - One live code per address, compared with `timingSafeEqual`.
  - The email is sent before the code is stored.
- Session:
  - 32 random bytes, stored as a sha256 hash, in an `httpOnly`, `SameSite=Lax` cookie `ti_session` (Secure on https).
  - Fixed 30-day TTL.
- Accounts are created on the first proven sign-in. Addresses in `ADMIN_EMAILS` are promoted at sign-in and at startup.
- **Changes from free_tailor:** the session is cookie-only, with no localStorage bearer token, because the app is same-origin. Auth routes are rate-limited per IP.

**Dev and tests.** `AUTH_DEV_LOG_CODES` prints codes to the API console when SMTP is missing (outside production only). `AUTH_DEV_FIXED_CODE` gives tests a fixed code.

**Reference.** free_tailor `frontend/src/components/auth/{SignInPanel,AuthGate,AccountMenu}.tsx`, `contexts/AuthContext.tsx`, `backend/src/routes/auth.ts`, `services/auth/{authService,google,mailer}.ts`, `database/userRepository.ts:241-389,567-746`.

### 2. Shell, header, design system

**Tokens** (Tailwind 4 `@theme` in `globals.css`; light only):

| Group | Values |
|---|---|
| Colours | primary `#14a1c0` (backgrounds), primary-ink `#08758c` (all text, border and outline "primary", the filled heart, stepper dots, focus ring), primary-container `#ccf6ff`, canvas `#fcfcfc`, surface `#fff`, surface-low `#f8f8f8`, border `#e8e8e8`, foreground `#191919`, muted `#7d7d7d`, subtle `#a1a1a1`, control-strong `#d7d7d7`, chip `#ebebeb`, sky `#e9f6ff`/`#016094`, success `#02a558`/`#d6f9e9`, destructive `#f53b3a`/`#fbe5e5`, warning `#f58e3a`, amber `#f8f4e5`/`#913f0c`, avatar `#3ec0de`, improve-card `#def9ff`/`#d4f7ff` |
| Radii | control 10, surface 16, popup 14, menu 10, menu row 6, pills full |
| Shadows | soft, control, menu, popover and dialog, with the exact values from Simplify's CSS |
| Segmented track | 4% black, with a white active pill |

**Kit** (`components/ui`, Base UI wrappers):
- Button (`h-9 px-4 text-sm font-medium`; variants primary, secondary, outline, ghost, destructive, link), IconButton
- Input (`h-9`, border `#e6e6e6`, focus border `#969696`), SearchPill, Select, creatable Combobox, Checkbox, Switch, Radio, Slider
- Badge (`rounded-full px-2 py-0.5 text-xs`), Chip, FilterPill (count badge or up/down caret), SegmentedControl, UnderlineTabs
- Menu (with submenus), ContextMenu, Popover, Dialog, Sheet (`max-w-3xl` / `max-w-7xl`), Tooltip, Toast
- LetterAvatar, Spinner, Skeleton, EmptyState, DatePickerPopover, Stepper, ConfirmDialog

**Header** (`AppHeader`):
- White, 62 px tall, with a bottom border `#e8e8e8`.
- TailorIT logo, then nav **Jobs | Job Tracker | Documents** (16 px, muted).
- The **active item** is a full-height `#e8e8e8` block with `#191919` text and a 2–3 px `#191919` bottom bar.
- Right side: a 40 px `#3ec0de` initials avatar (radius 10, white bold text) plus a caret, opening an account menu (name and email, Settings, Admin for admins, Log out).
- **No placeholder icons** for features TailorIT doesn't have.

**Editor screens** use the 62 px `EditorBar`: logo › Documents › {name}, with inline rename, a save-status line and the screen's actions.

### 3. Documents (`/documents?tab=resumes|cover-letters|templates`)

**Page.**
- Heading **"My Documents"** and subtitle "Manage and tailor all of your job search documents here!".
- Three action cards (white, radius 16, 40 px icon tile in `#ccf6ff`, "+" at the right):
  - **New Resume**: "Build a resume from a template"
  - **New Cover Letter**: "Create and customize with AI"
  - **New Template**: "Create a reusable cover letter template"
- Underline tabs **Resumes | Cover Letters | Templates**.

**Generic layer** (`features/documents/core`, following ft-resume-views §12):
- `DocumentCollection`: toolbar, a view toggle persisted per tab in localStorage, search status line, empty states.
- `DocumentList`: `cards` variant (free_tailor rows) or `table` variant (Simplify).
- `DocumentCard`.
- `DocumentThumb`:
  - Lazy loading via IntersectionObserver with a 300 px margin.
  - Module-level LRU of 48, keyed `kind:id:updatedAt`, with in-flight requests de-duplicated.
  - An `iframe srcDoc sandbox=""` scaled by `transform`, or an `<img>` for upload PNGs.
- `PageThumb` (takes the page size), `NewTile`, an ARIA `ActionMenu`, `RenameDialog`, `BulkDeleteDialog`.

| Tab | Views | Toolbar | Row/card content | Menu |
|---|---|---|---|---|
| **Resumes** (free_tailor's views, restyled) | **Thumbnail grid**: `repeat(auto-fill,minmax(13.75rem,1fr))`, 2-up at 640 px or narrower, a dashed "New resume" tile first. **List**: free_tailor columns **Resume (+badges) \| Name on resume \| Template \| Edited \| ⋮**, plus checkboxes for bulk delete | Search ("1 of 3 resumes match."), source filter **All / Created / Uploaded**, **Upload** (PDF/DOC/DOCX ≤5 MB, optional "Make an editable copy" via AI import), view toggle | First-page thumbnail; label (custom title, else free_tailor's label rule); "Edited 6 hours ago · {template}"; badges ★ **Default**, **Uploaded**, **PDF/DOCX** | Edit (View for uploads), Rename ("Change resume name": Keep it / Change), Duplicate, Set as default, Download PDF, Download Word, Download JSON, Make editable copy (uploads), Delete (styled confirm) |
| **Cover Letters** (Simplify style + thumbnails) | **Table** (Simplify): checkbox, Name + badge **Generated/Uploaded**, Created, Last Edited ("-" until a content edit), Actions = ✎ Edit + More ⌄. **Thumbnail grid**: letter first-page cards | "{n} selected" (bulk Delete: "Delete Cover Letters" / "Delete Bulk"), **Upload** (.pdf/.docx → text → editor), Search | — | View (preview dialog), Rename, Download PDF, Download Word, Delete |
| **Templates** (Simplify, list only) | Table: Name + **System Default** badge + an 80-character text preview, Created, Last Edited, Actions | "{n} selected" (system rows can't be selected), Upload, Search | — | Duplicate ("{name} (Copy)"), Delete (disabled for system templates) |

**Empty-state copy** (Simplify):
- "Create your first resume!" / "Get started with a polished resume that highlights your skills and experience."
- "Create your first cover letter!" / "Get started with a personalized cover letter that highlights your qualifications."
- "Create your first template!" / "Get started by creating a reusable cover letter template with dynamic placeholders."
- No matches: "Oops! No matching {resumes|cover letters|templates} found."

**Resume ownership.** Resumes belong to the user; there are no profiles. `users.default_resume_id` defaults to the first resume and drives the job match and cover letters.

### 4. Resume builder (free_tailor "new resume" logic) and render engine

**Flow** (fresh code following ft-resume-new §2):

1. **`/resumes/new`: template chooser.**
   - Heading "Start building a resume", subtitle "Choose a design you like. You can customize or switch it later.".
   - Filter pills: All Templates / Simple / Modern / Creative / ATS.
   - **Import existing resume** menu: Resume PDF (AI) / Resume JSON file.
   - Template cards with a "Preview" hover.
   - Details dialog: **Grouped/Plain** switch, features list, **Use this template**, previous/next.
2. **`/resumes/new?template=&layout=`: "Import your existing resume" dialog.**
   - Subtitle "Start faster by prefilling your resume content.".
   - Buttons: **Import resume** / **Start from blank**, without emoji.
3. **Editor (`/resumes/new…` and `/resumes/[id]`).**
   - EditorBar, plus **Content | Customize** tabs, save state ("Unsaved changes" / "No changes yet" / "Nothing entered yet") and **Create Resume / Save Resume**.
   - Content tab:
     - Header card leading to the **Name and contact details** panel.
     - Section cards for the 15 kinds plus ≤10 custom sections. Cards are collapsed by default and can be dragged (dnd-kit), moved up/down and removed.
     - Entry editors with the catalogue's fields.
     - **Write with AI / Improve with AI** for experience, projects and volunteering (optional note ≤300 characters, Undo).
     - **Add content** dialog.
   - Customize tab: **Template** card and **Layout** card (Grouped/Plain, "Use the template's order"). free_tailor's tailor-only Generation and Keywords cards are dropped.
   - **Live preview**:
     - Server HTML in double-buffered iframes.
     - Debounce: 400 ms while typing, 0 ms for discrete changes; sequence numbers drop stale responses.
     - Page-break markers, the "Full size" viewer, a status of Up to date / Updating / Not updated, and the sample notice.
   - Leaving with unsaved changes asks for confirmation. Saving returns to `/documents?tab=resumes`.
   - Copy that mentions tailoring is rewritten.

**Resume document.** Same shape as free_tailor's `Resume`, minus profile and tailoring settings:
- `name, title, totalYearsExperience?, preferredTemplate, resumeSettings{technicalSkillsLayout, includeSoftSkills, includeStrengths}, contact{phone,email,location,linkedin,github,portfolio}, summary`
- Lists: `experience[], strengths[], skills[], skillCategories?, softSkills?, education[], certifications?, projects?, languages?, awards?, publications?, volunteering?, courses?, interests?, references?, customSections?`
- `sectionOrder?`

The normalizer lives in shared, following ft rules:
- An omitted field keeps its stored value; a list given in full replaces the stored list.
- Strings are trimmed.
- Caps: 50 entries per list, 10 custom sections, 50 × 100 characters for chips.
- Skills invariant: every grouped skill is also in `skills`.

**Render engine** (`packages/render`; contract detail in Appendix B):
- The 26 template JSON files are copied verbatim as data.
- Handlebars uses `each`/`if`/`else` and the helper `join`; `formatDate` is an identity helper.
- The engine re-implements, fresh, free_tailor's:
  - template description: `supportsSoftSkills/Strengths`, `printsSections`, `nativeSectionOrder`, and the page box from `@page`;
  - render data and the skills render gate (`hardSkills`/`skills` lines, Grouped/Plain);
  - compile-time markup normalization: the extra-sections macro, the soft-skills/strengths switches, reordering within columns, "Hard Skills"→"Technical Skills", skill-loop rewrites, the `xs-style` baseline, empty guards and the find fallback ladder;
  - an LRU compile cache (128);
  - post-render fixes;
  - preview chrome with a CSP meta tag and `{page:{widthPx,heightPx,contentHeightPx}}`.
- **PDF**: the same document rendered by Puppeteer, with **JavaScript disabled and every non-`data:` request blocked**, written to a Buffer. A4 with template margins; one shared browser running ≤2 pages.
- **DOCX**: one simple layout, labelled "Word (simple layout)".
- **Stage A** uses marker-based section finding and gives exact parity on the 19 built-ins. **Stage B** adds the loop heuristics and gives parity on all 26.
- **Goldens:** `tools/ft-golden` requires free_tailor's compiled `backend/dist` read-only, with `DB_DIR` forced to `TailorIT\.cache` (asserted). It renders 6 fixtures × 26 templates × layout × switches × order (about 600 cases), compared by markup, pixel diff (≤0.1%) and PDF page count.
- **Skills:** `skills.json` (1,492 hard / 1,247 soft) is loaded in memory and overlaid with per-user `user_skills`. Nothing is written to a shared library.

### 5. Cover letters and templates

**Creating a letter.**
- `/cover-letter/new[?applicationId=]` creates **"Cover Letter {M/D/YYYY}"** and opens `/cover-letter/[id]`.
- An empty letter opens **"Generate a Tailored Cover Letter"** automatically. Its tabs:
  - **Job Details**: "Select a job from tracker" (fills the fields below), Company Name (ex. Google), Job Title (ex. Software Engineer), Job Description.
  - **Template**: "None (generate without template)" plus the templates, with a preview.
  - **Custom Prompt**: "Paste in an existing cover letter OR provide some context…", plus **Load an example**.
- **✨ Generate** shows a staged loader: "Analyzing job description...", "Extracting key skills and requirements...", "Generating your tailored cover letter...".
- Generation uses the **default resume**. If there is none, the dialog explains and links to Documents.

**Generating.**
- **No template:** AI writes 3–4 body paragraphs. free_tailor's rules apply (first person, facts only from the resume, banned words, no em dashes), plus the **job description**. The server wraps them as: centred H1 name, centred "phone | email | linkedin", "Dear Hiring Manager,", the paragraphs, "Sincerely,", name.
- **With a template:** Profile, Dynamic and Structural variables are substituted deterministically. One AI call returns `{values}` for the AI variables, using the template's **Copilot AI Prompt** and the custom prompt as context. Anything left unresolved stays as `{{VAR}}`.

**Editor** (TipTap):
- Toolbar: font select (Times New Roman default, Helvetica, Courier, Open Sans, Roboto, Lato, Poppins, Arimo, Work Sans, Roboto Mono), B U I, link, H1–3, 4 alignments, quote, bullet list, numbered list, undo/redo, ✨ Generate.
- Paper placeholder "Dear Hiring Manager...".
- **Autosave after 1 s** ("Saving…" / "Saved just now").
- Amber banner "Almost there - fill in these details to finish your letter", with chips that open **"Replace placeholder"** (replaces every copy).
- ☰ menu: Export to PDF, Import from PDF/DOCX, New cover letter, Delete. Plus an **Export Cover Letter** button.
- Letters print on **US Letter**. Fonts are bundled locally (OFL woff2 inlined as `data:`) because the print browser has no network.

**Template editor** (`/cover-letter-template/[id]`):
- New templates are named "Template {datetime}". Rename requires ≥3 characters ("Template name must be at least 3 characters long"). An ⓘ tooltip explains the name.
- **✨ Copilot AI Prompt** dialog (≤1000 characters, with a counter).
- **Insert variable...**: grouped and searchable, each with a label and a description.
- **Base from template...**: replaces the content immediately, with a confirm only when the editor is non-empty.
- **Variable chips:**
  - An atomic, draggable inline node: radius 4, padding `1px 6px`, `.85em`, weight 500, `#e9f6ff`/`#016094`.
  - Typing or pasting `{{UPPER_SNAKE}}` turns into a chip automatically.
  - Stored as the literal `{{NAME}}`.
- **System templates** are read-only and can be duplicated.

**Variable registry** (TailorIT's own, in shared):

| Group | Variables |
|---|---|
| Profile | `USER_FULL_NAME`, `USER_FIRST_NAME`, `USER_LAST_NAME`, `USER_EMAIL`, `USER_PHONE`, `USER_LOCATION`, `USER_LINKEDIN`, `USER_PORTFOLIO`, `USER_TITLE` |
| Dynamic | `COMPANY_NAME`, `JOB_TITLE`, `HIRING_MANAGER` (default "Hiring Manager"), `TODAY_DATE` |
| Structural | `SALUTATION`, `SIGN_OFF`, `CONTACT_LINE` |
| AI-generated | `FULL_COVER_LETTER`, `COVER_LETTER_BODY`, `COMPANY_APPEAL`, `ROLE_FIT`, `CANDIDATE_STRENGTHS`, `SKILL_HIGHLIGHT` |

**Starter templates**: about 6, our own text: Classic Professional, Creative Industry, Software Engineering, Career Change, Internship / New Grad, Short & Direct.

### 6. Job Tracker (`/tracker?view=board|list|chart&tab=active|archived&app=<id>`)

**Statuses** (code, label, icon):

| Code | Label | Icon |
|---|---|---|
| 1 | Saved | bookmark |
| 2 | Applied | paper plane |
| 11 | Screen | file search |
| 12 | Interviewing (the list stepper says "Interview") | chats |
| 13 | Offer | envelope-open |
| 21 | Withdrawn | undo |
| 22 | Ghosted | chat-slash |
| 23 | Rejected | x-circle |
| 24 | Accepted | confetti |

Archived is the `archived_at` field, not a status.

**Status rules** (pure, in shared):
- Creating an application adds a Saved event.
- Moving above Applied auto-adds an Applied event.
- Moving to status S removes the events above S.
- A terminal status removes the other terminal statuses.
- The current status is the highest event; each event has its own editable date.

**Top bar.**
- **Active (N) | Archived (N)**. Archived forces List view.
- **+ Add application**.
- Search **"Search for roles or companies"** (500 ms debounce, server-side).
- **Board | List | Chart**.
- **Options ⇕**: a 240 px menu, opening on hover.
  - **Filters**: Applied from/until (calendar), Job type, Status (picking a status switches to List).
  - **View options**: Show only favorites, Visible columns (N), Sort by (Tracked Date / Created Date / Title, ascending or descending).
  - **Actions**:
    - Manage jobs: select mode with bulk Archive / Unarchive / Delete / Update Status.
    - Import CSV wizard: file → header row → map columns (Position Title*, Company*; optional Location, Job Type, Status, Notes, Job Posting Link, Application Date; Custom value) → preview → map status values → import.
    - Export CSV.
    - Archive all applications.
- Active-filter chips with "Clear all filters".

**Board.**
- Columns are 320 px. Column visibility is **forced** (Saved, Applied, Interviewing, Offer, Rejected), **shown only when non-empty** (Screen, Withdrawn, Ghosted, Accepted) or **hidden** (eye-slash "Hide column"), persisted in localStorage.
- Column header: icon, name and count.
- Card:
  - 32 px logo or letter avatar, company, heart ("Add to favorites"), ⋯ "Application actions".
  - Title (semibold, 2-line clamp), pin + location, divider, "Added Oct 22".
- **⋯ menu** (also opened by right-click and a 500 ms long-press): Open application, View job posting, Move to › (statuses), Archive/Restore.
- dnd-kit drag between columns: optimistic, with rollback on error. The hover target reads "Drop application here".
- Columns load 25 cards per page, with "Load more applications".
- Empty column: "No applications" / "Move applications into {status}.".

**List.** Row cards with a heart, a 64 px logo, the title, company and location, then the **stepper**:
- Steps Saved–Applied–Screen–Interview–Offer, plus a sixth step for a terminal status.
- 24 px dots: done = `#08758c` inside a `#ccf6ff` ring, todo = white with a `#d7d7d7` border.
- Dates in M/D/YY. Offer or Accepted turns the stepper green; a terminal status turns it grey.
- A **Status ⌄** select at the end of each row.
- Empty states: "Add your first job application!" / "No more endless spreadsheets, keep track of everything in one place."; "Oops! No matching applications found." / "Please update your search criteria and try again."

**Chart.**
- **"Application flow"**: a Nivo Sankey (Applied #4a86e8, Screen #5E97B7, Interviewing #47C1AD, Offer #8BC34A, Withdrawn #FFA07A, Ghosted #DDA0DD, Rejected #FF6B6B, Accepted #4CAF50) with draggable nodes, "Reset chart positions" and "Export chart as PNG".
- **Insights** cards:
  - Application activity: total, most active day, per day/week/month.
  - Conversion funnel: Applied→Screening, Screening→Interview, Interview→Offer.
  - Response & follow-up: average response time, ghost rate, longest wait.
- Empty: "No applications to chart yet" / "Track an application to see its path from applied to offer."

**Add Application** is a right-side Sheet (`max-w-3xl`) headed "Add Application":
- Fields: Position Title*, Company* (creatable), Location, Job Type* (Internship/Full-Time/Part-Time), Job Status (default Applied), Resume used (default resume).
- Buttons: Cancel / Add. Saving opens the detail view in edit mode.

**Detail** is a right-side Sheet (`max-w-7xl`):
- Header: logo, title with a pencil, company. Buttons: Apply (when Saved and there is a URL), Favorite, Archive, Delete. The delete confirm uses Simplify's copy.
- Tabs:
  - **Overview**: location, salary range + period, job type, "View Job Posting ↗", description. The edit form has currency, min, max, pay period, URL and a rich-text description.
  - **Documents**: link a resume or cover letter; **Generate cover letter** goes to `/cover-letter/new?applicationId=`.
  - **Resume Score**: keyword match against the description.
  - **Questions**: "Application Questions" with Add Question.
  - **Email**: static follow-up templates (P2).
- Right column:
  - **Application Status** combobox and a vertical timeline with date popovers ("Add date", no future dates).
  - **Notes**: rich text that autosaves after 500 ms ("Add notes, reminders, or contacts for this job").
- Confetti plays on Offer or Accepted.

### 7. Jobs (`/jobs?jobId=…&filters`)

**Toolbar.** Search pill **"Find your dream role"**; pills **Location ⇕ | Job Type [n] | Experience Level ⇕ | Category [n]**; **All filters**, a bookmark (save search) and ✕ (clear all).

**All filters:**
- Last updated: 24h / week / month.
- Job type: Internship, Full-Time, Part-Time, Contract.
- Experience level: Entry Level/New Grad, Junior, Mid Level, Senior, Expert or higher.
- Category and subcategory (searchable facets).
- Leadership: IC or Manager.
- Work arrangement: Remote, Hybrid, In Person.
- Location: place text, or "Remote in {country}".
- Minimum salary: $0–400k slider with a pay period.
- H1B, Industry, Company size, Company, Clearance, and Hide applied jobs.

A filter only appears when the data has values for it.

**List panel.**
- Header: "Found N jobs"; sort **Most relevant / Recently posted / Recently updated / Highest salary**.
- 21 jobs per page with infinite scroll. The first job is auto-selected and the URL keeps the state.
- Card: logo, title, company, "City, ST, Country (+N more) · Hybrid|In Person|Remote", salary ("$120k - $150k/yr"), relative date, bookmark. The selected card is `#ccf6ff`.
- Empty: "No matching jobs found".

**Detail panel.**
- Sticky header: **Overview | Company** (scroll anchors), **"Applied M/D/YY"** chip, **Already Applied?**, **Save / Saved**, **Apply** (opens the posting, then asks "Did you apply?", which records Applied) or **INACTIVE**.
- Company row: logo, name, tagline; icons for hide (job or company), share (copy link) and flag (report).
- H1 title; chips for job type and the live status:
  - "Posted on {date}" when inactive or posted within 7 days;
  - otherwise "Updated on {date}" when updated within 7 days;
  - otherwise "Confirmed live in the last 24 hours".
- **Facts grid**: salary ("No salary listed"), experience level, location (+N), work arrangement, category / subcategory.
  - The experience level carries a **match icon**: a green check "Your experience level matches…" against your Settings preferences, or amber info "This job asks for… / You're looking for…", or nothing when no preferences are set.
- **About the job**: **Summary | Full posting**. Summary shows Requirements / Responsibilities / Desired Qualifications; Full posting shows sanitized HTML.
- **Company** section: about plus whatever stats exist.

**Job analysis card** (right rail, **"Improve your resume"**):
- Background `#def9ff`, border `#d4f7ff`, a target icon.
- **"X out of Y required keywords found"**.
- Chips: matched first (check-circle, tint), then missing (plain). They collapse to 2 rows, with "Show N more" / "Show less".
- With no default resume: "Add a resume" / "Upload or create a resume and we'll score it against this job's keywords.".
- **No Tailor button.**

**Matching** (pure, in shared; free_tailor `termPattern` semantics):
- Job keywords are `high` + `low` groups of alternative spellings.
- The resume evidence text comes from the default resume, or from the extracted text of an uploaded file.
- A group is matched when any spelling hits under the boundary rules (handles C++, Node.js, CI/CD); terms of two characters or fewer are case-sensitive.

**Saved and applied state** comes from the tracker:
- Save creates or updates an application with status Saved, linked by `job_id`.
- The Applied chip appears when an Applied event exists.
- "Hide applied jobs" filters on that state.

### 8. Job ingestion (one pipeline, six adapters)

| Adapter | Source | Mapping |
|---|---|---|
| greenhouse | `boards-api…/boards/{token}/jobs?content=true` (verified: id, title, absolute_url, location.name, updated_at, first_published, content, departments, offices, metadata) | Decode and sanitize `content`. Pay ranges via `/jobs/{id}?pay_transparency=true`, for new jobs only, ≤50 per run. |
| lever | `api.lever.co/v0/postings/{site}?mode=json&skip&limit=100`; EU host `api.eu.lever.co` (verified: text, categories{commitment, location, team, allLocations}, workplaceType, country, createdAt, hostedUrl, applyUrl, description, `lists[]`, additional) | `lists[]` sections become Requirements/Responsibilities with no AI needed. Salary when present. |
| ashby | `api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` (verified: id, title, department, team, employmentType, location, secondaryLocations, publishedAt, isListed, isRemote, workplaceType, address, jobUrl, applyUrl, descriptionHtml, compensation.compensationTiers[].components) | Skip `isListed=false`. Salary from the Salary component (min, max, currency, interval). |
| csv/json | Admin upload → preview → column mapping | Auto-detects free_tailor's sheet headers (Date, NO(DATE), Company, Job Title, Job Link, Job Description) |
| ft_lake | better-sqlite3 `{readonly, fileMustExist}` + `query_only`, short read transaction | `job_lake` LEFT JOIN `job_analyses`:<br>• `job_type` → arrangement<br>• `job_field_id` → category (via `taxonomy/ft-job-fields.json`)<br>• seniority → levels<br>• salary as-is<br>• location derived from the analysis filter's region/state<br>• the stored analysis becomes `source='ft_lake'` (mustInclude → high keywords) |
| seed | `static/seed/*.json` | About 15 fictional companies and about 120 postings with clear sections |

**Normalization** (pure, unit-tested):
- **Locations**: split multiple locations; tables of US states, Canadian provinces and countries; recognize remote phrasing.
- **Arrangement and employment type**: structured fields first, then the title and text.
- **Experience levels**: title tokens plus "N+ years" (0–1 entry, 2–3 junior, 3–5 mid, 5–8 senior, 8+ expert).
- **Category**: TailorIT's own taxonomy of about 18 parent categories. Software subcategories come from free_tailor's 103 job fields; for example `site-reliability-engineering` → "DevOps & Infrastructure / Site Reliability Engineering".
- **Salary**: parse ranges, annualize, and convert with a static FX table into `salary_annual_usd_*` for the slider and sort.

**Dedupe and deactivation.**
- Unique key `(source, source_job_id)`; across sources, `link_key` or `(company, normalized title, content_hash)`.
- Field precedence: ATS > CSV/JSON > lake > seed. FTS is written in the same transaction.
- croner runs it daily; there is also a manual "Run now".
- Only a **successful, complete** fetch marks missing postings: `missing_since` is set, and a job whose links are all missing becomes inactive. A failed fetch deactivates nothing.

**Admin** (`/settings/admin/sources`): sources (add a board token or site/name, the lake path), Run now, run history and errors, a jobs CSV/JSON import, reports, and AI health.

### 9. AI layer (`apps/api/src/ai`)

**`ClaudeCliProvider`** (about 400 lines, fresh; reference: free_tailor `services/ai/providers/claudeCli/*`):
- **argv**: `claude -p --output-format stream-json --include-partial-messages --verbose --model <m> --effort <e> --tools "" --safe-mode --strict-mcp-config --disable-slash-commands --permission-prompts none --no-session-persistence --system-prompt <sys>`. The user message goes on stdin.
- **Spawning**: the `.cmd` shim is resolved to its real target; never `shell: true`; `windowsHide`.
- **Environment**: strip `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDECODE`, `CLAUDE_*` (except `CLAUDE_CONFIG_DIR`) and `MAX_THINKING_TOKENS`. The working directory is an empty `DATA_DIR\claude-cli-work`.
- **Stream handling**:
  - A Buffer-based NDJSON reducer handles `system/init`, `api_retry`, text deltas and `result`.
  - **Abort if `apiKeySource` is not `none`.**
  - Deadline 300 s; first-event stall 30 s, which holds the feature for 10 minutes.
  - On timeout, Windows uses `taskkill /T /F`.
- **Errors** are classified as auth, rateLimited, modelUnavailable, timeout, stalled, malformed and so on, then mapped to `ai_unavailable` / `ai_failed` with human-readable messages.
- **Health** comes from `claude --version` and `claude auth status`, cached for 60 s and shown in the admin UI.

**Queue.**
- Every AI endpoint returns `202 {taskId}`; the web polls `GET /ai/tasks/:id` via `useAiTask`.
- The worker runs a priority semaphore: 4 interactive slots and 1 background slot, background only when nothing interactive is waiting.
- Tasks are de-duplicated by key. Each user may have at most 2 queued/running tasks per kind (409 `ai_busy`). Tasks left running at startup are marked `interrupted`.

**`runPrompt(module, input)`**:
- The system prompt is the module text plus a JSON-sentinel instruction.
- Parsing: free_tailor-style `extractJSON` (sentinels → code fence → whole text → balanced scan → safe repairs), then zod `safeParse`.
- **One** retry, quoting the zod issues.
- Model is `AI_MODEL_<FEATURE> || AI_CLI_MODEL` (default `claude-sonnet-5-5`); effort the same way.

| Prompt module | Output |
|---|---|
| `resume_import` | A Resume document. Rules: "copy, never infer". Text from pdf-parse/mammoth, ≤60k characters; under 50 characters is refused. |
| `entry_bullets` | `{bullets: 1–8 × ≤300 chars}`, Write or Improve; banned words; no em dashes |
| `job_analysis` | `{summary{requirements[],responsibilities[],desiredQualifications[]}, keywords{high,low:[{term,synonyms[]}]}, experienceLevels[], leadership, minYears, category, workArrangement, employmentType, salary, sponsorsH1b, requiresClearance, degree}`. Only keywords present in the posting are kept; capped at 15 + 15. |
| `cover_letter` | `{paragraphs: 3–4}` from resume evidence, job (including the description), template prompt and custom prompt |
| `template_fill` | `{values: Record<VAR,string>}` for the AI variables in the template |

**Job-analysis policy.**
1. **At ingest, always deterministic**: headings and lists, the vocabulary scan, levels and category rules.
2. **AI lazily, on the first detail view**, de-duplicated by content hash. The UI shows the deterministic version with a quiet "Refining…" and swaps when ready.
3. **Optional throttled warm-up**, off by default.
4. **free_tailor lake analyses are reused.**

## Data model (SQLite; full DDL in Appendix A)

| Area | Tables |
|---|---|
| Auth | `users` (role user/admin, `default_resume_id`), `user_sessions`, `login_codes`, `user_preferences` (experience levels, job types, arrangements, categories, locations, min salary, contact fields for letter variables) |
| Documents | `stored_files`, `resumes` (kind built/uploaded, `data` JSON, `file_id`, `extracted_text`, `last_edited_at`), `user_skills`, `cover_letters` (`origin`, `content_html`/`text`, font, job/application/template links, `last_edited_at`), `cover_letter_templates` (system/user, `ai_prompt` ≤1000) |
| Jobs | `companies`, `jobs` (+ `jobs_fts` FTS5, `job_locations`), `job_analyses` (deterministic/ft_lake/ai), `job_sources`, `ingest_runs`, `job_source_links`, `user_job_state`, `user_hidden_companies`, `job_reports`, `saved_searches` |
| Tracker | `applications` (denormalized `current_status`, `favorite`, `archived_at`, `resume_id`, `cover_letter_id`, `notes_html`, `tracked_on`), `application_status_events` (one per status, `occurred_on`), `application_questions` |
| AI and system | `ai_tasks`, `app_settings`, `schema_migrations` |

## API surface (`/api`; errors `{error:{code,message,fields?,retryAfterSeconds?,requestId}}`; lists `{items,total?,nextCursor?}`)

| Group | Endpoints |
|---|---|
| Auth/me | `GET /auth/options`<br>`POST /auth/google`, `POST /auth/email/request`, `POST /auth/email/verify`<br>`GET /auth/me`, `POST /auth/logout`<br>`PATCH /me`, `GET/PUT /me/preferences`, `PUT /me/default-resume`<br>`GET /health` |
| Resumes | `GET /resumes?source=`, `POST /resumes`<br>`GET/PUT/PATCH/DELETE /resumes/:id`<br>`POST /resumes/:id/duplicate`, `POST /resumes/bulk-delete`<br>`POST /resumes/upload` (`?parse=1`), `POST /resumes/import-json`, `POST /resumes/:id/parse` (202)<br>`POST /resumes/preview`, `GET /resumes/:id/thumbnail`, `GET /resumes/:id/export?format=pdf\|docx`, `GET /resumes/:id/file` |
| Resume support | `GET /resume-templates` (light list), `GET /resume-templates/:id/preview`<br>`GET/POST /skills`<br>`POST /ai/resume-bullets` (202) |
| Cover letters | `GET/POST /cover-letters`<br>`GET/PATCH/DELETE /cover-letters/:id`, `POST /cover-letters/bulk-delete`<br>`POST /cover-letters/upload`, `POST /cover-letters/:id/import`<br>`POST /cover-letters/:id/generate` (202)<br>`GET /cover-letters/:id/preview`, `GET /cover-letters/:id/export` |
| Letter templates | `GET/POST /cover-letter-templates`<br>`GET/PATCH/DELETE /cover-letter-templates/:id` (system → 403)<br>`POST /cover-letter-templates/:id/duplicate`, `/cover-letter-templates/upload`, `/cover-letter-templates/bulk-delete` |
| Jobs | `GET /jobs` (all filters; `sort=relevant\|posted\|updated\|salary`; cursor; 21 per page)<br>`GET /jobs/:id`, `GET /jobs/:id/analysis`, `GET /jobs/:id/match`<br>`POST/DELETE /jobs/:id/hide`, `POST /companies/:id/hide`, `POST /jobs/:id/report`<br>`GET /jobs/facets/*`<br>`GET/POST/DELETE /saved-searches` |
| Tracker | `GET /applications/board`, `GET /applications`, `GET /applications/counts`<br>`POST /applications` (accepts `jobId`)<br>`GET/PATCH/DELETE /applications/:id`<br>`PUT /applications/:id/status`, `PUT/DELETE /applications/:id/events/:status`<br>`POST /applications/:id/{archive,restore}`, `POST /applications/bulk`, `POST /applications/archive-all`<br>`GET /applications/export.csv`, `POST /applications/import`<br>`GET /applications/sankey`, `GET /applications/insights`<br>CRUD `/applications/:id/questions` |
| AI, files | `GET/DELETE /ai/tasks/:id`<br>`GET /files/:id`, `GET /files/:id/thumbnail` |
| Admin | `/admin/sources` CRUD + `POST /admin/sources/:id/run`, `GET /admin/runs`<br>`POST /admin/import/jobs/preview`, `POST /admin/import/jobs`<br>`POST /admin/sources/ft-lake/test`<br>`GET/PATCH /admin/reports`<br>`GET /admin/ai/health`, `POST /admin/ai/test`<br>`GET/PATCH /admin/users` |

## Execution plan (ultracode: one workflow per phase, adversarial review per package)

**Step 0 (me, directly).**
- Persist the research into `docs/research/` and this plan into `docs/ARCHITECTURE.md`.
- Copy the screenshots to `e2e/reference/` (gitignored).
- `git init`, plus a `.gitignore` covering `.env`, `node_modules`, `.next`, `.cache` and `e2e/reference`.
- Save the decisions to memory.

**Foundation** (sequential; F3–F5 run in parallel after F2):

| Package | Owns | Accept when |
|---|---|---|
| F1 Scaffold | Root config, `scripts/**`, `tools/fake-claude`, every workspace `package.json` with **all** dependencies installed up front, e2e config | `npm i` works on Windows/Node 24; `npm run dev` starts both apps; `verify` is green; `doctor` reports |
| F2 Contracts | `packages/shared/**`: zod DTOs for every endpoint; enums and taxonomy; section catalogue plus order helpers; Resume normalizer; status rules; column visibility; sankey/insights calculators; CSV status map; variable registry with `substitute` and `findPlaceholders`; matcher; location/salary parsers; formatters | ≥150 unit tests |
| F3 API core | `apps/api` core, `0001_init.sql`, auth/me, a stub router per feature, files (magic-byte checks), PDF pool, rate limits, Origin check, error middleware | supertest auth suite; others' rows return 404; the cookie works through the Next proxy |
| F4 AI core | provider, queue, `runPrompt`, `extractJSON`, health, `/ai/tasks`, admin AI | Unit tests (argv, env, reducer, classifier, extractJSON, semaphore). Fake-CLI integration: success, bad-JSON-then-retry, auth error, stall, rate limit, API-key abort |
| F5 Web foundation | Tokens and `globals.css`, the UI kit, header shell, `/login`, `proxy.ts`, settings (profile and preferences), the generic documents layer + `DocumentsPage`, stub mounts for every route | Login matches the spec; header computed-style checks pass; the document layer works on fake data |

**Parallel packages** (separate git worktrees; disjoint file ownership; merged in order R1 → R2 → C → T → J1 → J2):

| Package | Scope | Accept when |
|---|---|---|
| R1 Render + resume API (+R1b) | `packages/render`, resume / template / skills / render features, `resume_import` and `entry_bullets` prompts, `tools/ft-golden` | Stage A goldens pass (R1b: all 26); PDF/DOCX export works; the JS-off and blocked-request tests pass; uploads store the file, thumbnail and extracted text |
| R2 Resume editor + Resumes tab | Editor, chooser, preview, Resumes tab (thumbnail and list) | e2e: chooser → editor → create → card appears; all 15 kinds + custom; drag to reorder; Grouped/Plain; switches; AI bullets + Undo; menu actions; upload + editable copy |
| C Letters + templates | API and web for cover letters and templates, both prompts, starter templates, Cover Letters tab (table + grid), Templates tab | e2e: generate without and with a template → banner → replace → autosave → PDF; chip insert/typed/dragged and stored as `{{X}}`; system templates read-only and duplicable |
| T Tracker | `applications` API and web, board/list/chart, sheets, Options, CSV, insights | Every tracker behaviour above is covered by e2e plus rule unit tests |
| J1 Ingestion + analysis | Adapters, normalization, scheduler, analysis service, `job_analysis` prompt, seed, taxonomy, admin sources/reports | Fixture tests per adapter; ≥40 location and ≥25 salary cases; dedupe/deactivation; the lake import runs on a **copy**, and the original file's mtime and size are asserted unchanged |
| J2 Jobs browse + match | Jobs API (FTS5, filters, sort, cursor), match, saved searches, Jobs page | e2e: search, every filter, sort, infinite scroll, URL state, live chip, facts and level match, Summary/Full posting, analysis card states, hide/report/share |

**Integration (I)**: cross-feature glue only.
- Jobs ↔ Tracker: save, apply, the Applied chip, "Hide applied jobs".
- The application detail's Documents and Resume Score tabs.
- Cover letter from a tracker job.
- The default resume everywhere.
- `seed:demo`, the full e2e run, the visual pass, and the README/runbook.

**Review gate per package.** An adversarial review workflow (correctness, security, Simplify fidelity against the screenshots, free_tailor behavioural parity). Fixes land before the merge.

**Checkpoints where I report back to you**:
1. After Foundation: login and header screenshots.
2. After the parallel packages: page screenshots beside Simplify's.
3. Final.

## Verification

- **Gates**: `npm run verify` (typecheck, lint, Vitest unit/API, render goldens) for every package. `verify:e2e`: build, start with a temp `DATA_DIR`, `AI_CLI_BIN=tools/fake-claude/fake-claude.mjs` and `AUTH_DEV_FIXED_CODE`, then run Playwright.
- **Fake `claude`** (a Node script):
  - Answers `--version` and `auth status` and asserts the argv contract.
  - Emits realistic stream-json, choosing a canned scenario from a `[feature:x]` tag.
  - Fault modes: `stall`, `auth`, `ratelimit`, `badjson-once`, `apikey`.
- **Real CLI smoke test** (your Max seat, `claude-sonnet-5-5`): one real call each for resume import, bullets, job analysis, a cover letter, and a template fill.
- **Visual harness** (`npm run shots`):
  - Playwright at **1567×889**, seeded demo data, a frozen clock (`SEED_NOW=2026-10-22T12:00Z`).
  - Captures views matching screenshots 1–7 and writes side-by-side composites with `e2e/reference`.
  - **Gate = computed-style assertions**: header 62 px and its border, active nav block, segmented tracks, card radius 16 / border / shadow, selected job `#ccf6ff`, chips, stepper dots, table header `#f8f8f8`, Default badge, variable chips.
- **Manual end-to-end on Windows**:
  1. `npm run dev` → sign in with a code.
  2. Build a resume → download the PDF.
  3. Generate a letter.
  4. Track and drag an application.
  5. Run a Greenhouse source → open a job → see the keyword card.
  6. Import from the free_tailor lake.
- **Seed**: a demo user (prefers Senior), two built resumes, one uploaded PDF, three letters, six system and two user templates, about 120 jobs, and 30 applications spread over three months across all statuses.

## free_tailor reference map (read; never copy)

| Area | Files (F:\Develop\free_tailor\…) |
|---|---|
| Login | `frontend/src/components/auth/{SignInPanel,AuthGate,AccountMenu}.tsx`, `contexts/AuthContext.tsx`, `lib/auth.ts`; `backend/src/routes/auth.ts`, `middleware/auth.ts`, `services/auth/{authService,google,mailer}.ts`, `database/userRepository.ts`, `config/adminIdentity.ts` |
| New resume | `frontend/src/app/admin/resumes/{new,[id]}/page.tsx`, `components/resume/*`, `lib/{resumeDraft,sectionCatalogue,previewPane,resumeGallery,upload}.ts`; `backend/src/routes/resumes.ts`, `services/{resumeDocument,resumeImport,entryBullets,sampleResume,templateChoice,templateImport}.ts`, `types/resume.ts`, `config/sectionCatalogue.ts`, `static/prompts/{extract-profile-from-resume,write-entry-bullets}.json` |
| Views | `components/resume/{ResumeCards,PageThumb,ActionMenu}.tsx`, `components/profiles/{ViewToggle,SearchBox,focusAfterRemoval}.tsx`, `resumePages.module.css`, `profiles.module.css`, `lib/profileDashboard.ts` |
| Render | `backend/src/generators/{pdfGenerator,sectionLocator,extraSectionsMarkup,plainSkillsMarkup,docxGenerator}.ts`, `services/{extraSections,skillGroups}.ts`, `database/skillsDatabase.ts`, `static/templates/*.json`, `static/skills/skills.json` |
| AI | `backend/src/services/ai/providers/claudeCli/{argv,env,events,index,health,classify}.ts`, `services/ai/{promptExecution,promptAssembly}.ts`, `utils/json.ts` |
| Jobs | `backend/src/services/jobLake/*`, `database/{sqlite,jobLakeRepository}.ts`, `services/jobAnalysis/{identity,gate,facts}.ts`, `services/{resumeKeywords,reviseCoverage}.ts`, `config/{jobFields,industries,conceptTools}.ts`, `static/prompts/analyze-job-description.json` |
| Letters | `static/prompts/generate-cover-letter.json`, `generators/coverLetterGenerator.ts` |
| Windows | `frontend/scripts/{next,nextLaunch}.mjs`, `scripts/{checkInstall,installCheck}.mjs`, `backend/scripts/installBrowser.js`, `backend/src/config/env.ts`, CLAUDE.md:14-245 |

---

## Appendix A — DDL (`0001_init.sql`; WAL, `foreign_keys=ON`, `busy_timeout=5000`; ISO UTC text times; event dates `YYYY-MM-DD`)

```sql
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT, checksum TEXT, applied_at TEXT);
CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)), updated_at TEXT);
CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT, google_sub TEXT UNIQUE, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN('user','admin')),
  default_resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL, disabled_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_sign_in_at TEXT);
CREATE TABLE user_sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT, user_agent TEXT, ip TEXT);
CREATE TABLE login_codes(email TEXT PRIMARY KEY COLLATE NOCASE, code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE user_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  experience_levels TEXT NOT NULL DEFAULT '[]', job_types TEXT NOT NULL DEFAULT '[]', work_arrangements TEXT NOT NULL DEFAULT '[]',
  categories TEXT NOT NULL DEFAULT '[]', locations TEXT NOT NULL DEFAULT '[]', min_salary INTEGER,
  phone TEXT, linkedin_url TEXT, location TEXT, portfolio_url TEXT, updated_at TEXT NOT NULL);
CREATE TABLE stored_files(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN('resume','letter_import','template_import','job_import')), original_name TEXT NOT NULL,
  mime TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, storage_path TEXT NOT NULL, thumb_path TEXT,
  page_count INTEGER, created_at TEXT NOT NULL);
CREATE TABLE resumes(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('built','uploaded')), title TEXT, template_id TEXT,
  data TEXT CHECK(data IS NULL OR json_valid(data)), file_id TEXT REFERENCES stored_files(id) ON DELETE SET NULL,
  extracted_text TEXT, source_resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_edited_at TEXT);
CREATE TABLE user_skills(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, skill_key TEXT NOT NULL, skill TEXT NOT NULL,
  category TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, skill_key));
CREATE TABLE cover_letters(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN('blank','generated','uploaded')), content_html TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '', font_family TEXT NOT NULL DEFAULT 'Times New Roman',
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL, job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL DEFAULT '', job_title TEXT NOT NULL DEFAULT '', job_description TEXT NOT NULL DEFAULT '',
  template_id TEXT REFERENCES cover_letter_templates(id) ON DELETE SET NULL, resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  custom_prompt TEXT NOT NULL DEFAULT '', file_id TEXT REFERENCES stored_files(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_edited_at TEXT);
CREATE TABLE cover_letter_templates(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  is_system INTEGER NOT NULL DEFAULT 0, system_key TEXT UNIQUE, name TEXT NOT NULL, content_html TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '', ai_prompt TEXT NOT NULL DEFAULT '' CHECK(length(ai_prompt)<=1000),
  origin TEXT NOT NULL DEFAULT 'blank' CHECK(origin IN('blank','uploaded','duplicated','system')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_edited_at TEXT,
  CHECK((is_system=1 AND user_id IS NULL) OR (is_system=0 AND user_id IS NOT NULL)));
CREATE TABLE companies(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, website TEXT,
  logo_path TEXT, tagline TEXT, about TEXT, size_bucket TEXT, stage TEXT, funding TEXT, headquarters TEXT, founded_year INTEGER,
  industry TEXT, links TEXT NOT NULL DEFAULT '[]', sponsors_h1b INTEGER, created_at TEXT, updated_at TEXT);
CREATE TABLE job_sources(id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN('greenhouse','lever','ashby','csv','json','ft_lake','seed')), name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config)), company_id INTEGER REFERENCES companies(id),
  enabled INTEGER NOT NULL DEFAULT 1, schedule TEXT NOT NULL DEFAULT 'daily', deactivate_missing INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT, last_success_at TEXT, last_status TEXT, created_at TEXT, updated_at TEXT, UNIQUE(kind, name));
CREATE TABLE ingest_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK(trigger IN('schedule','manual','upload','startup')),
  status TEXT NOT NULL CHECK(status IN('running','succeeded','failed','partial')), started_at TEXT NOT NULL, finished_at TEXT,
  fetched INTEGER DEFAULT 0, created INTEGER DEFAULT 0, updated INTEGER DEFAULT 0, unchanged INTEGER DEFAULT 0,
  deactivated INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, error TEXT, log TEXT);
CREATE TABLE job_analyses(id INTEGER PRIMARY KEY AUTOINCREMENT, content_hash TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN('deterministic','ft_lake','ai')), version INTEGER NOT NULL, model TEXT, prompt_hash TEXT,
  requirements TEXT NOT NULL DEFAULT '[]', responsibilities TEXT NOT NULL DEFAULT '[]', desired TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '{"high":[],"low":[]}' CHECK(json_valid(keywords)), experience_levels TEXT NOT NULL DEFAULT '[]',
  leadership TEXT, min_years INTEGER, category_id TEXT, subcategory_ids TEXT NOT NULL DEFAULT '[]', extras TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, UNIQUE(content_hash, source, version));
CREATE TABLE jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(id), title TEXT NOT NULL,
  description_html TEXT NOT NULL DEFAULT '', description_text TEXT NOT NULL DEFAULT '', apply_url TEXT NOT NULL DEFAULT '',
  link_key TEXT, content_hash TEXT NOT NULL,
  employment_type TEXT CHECK(employment_type IN('internship','full_time','part_time','contract')),
  work_arrangement TEXT CHECK(work_arrangement IN('remote','hybrid','onsite')), experience_levels TEXT NOT NULL DEFAULT '[]',
  leadership TEXT CHECK(leadership IN('ic','manager')), category_id TEXT, subcategory_ids TEXT NOT NULL DEFAULT '[]',
  salary_min REAL, salary_max REAL, salary_currency TEXT, salary_period TEXT CHECK(salary_period IN('year','month','week','day','hour')),
  salary_annual_usd_min REAL, salary_annual_usd_max REAL, salary_raw TEXT, sponsors_h1b INTEGER, requires_clearance INTEGER,
  degree TEXT, industry TEXT, locations_text TEXT NOT NULL DEFAULT '', primary_location TEXT NOT NULL DEFAULT '',
  location_count INTEGER NOT NULL DEFAULT 0, posted_at TEXT, source_updated_at TEXT, last_verified_at TEXT,
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, closed_at TEXT,
  analysis_id INTEGER REFERENCES job_analyses(id) ON DELETE SET NULL, view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE job_locations(job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, position INTEGER NOT NULL, raw TEXT NOT NULL,
  city TEXT, region TEXT, country_code TEXT, is_remote INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(job_id, position));
CREATE TABLE job_source_links(source_id INTEGER NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE, source_job_id TEXT NOT NULL,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, source_hash TEXT NOT NULL, first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL, missing_since TEXT, PRIMARY KEY(source_id, source_job_id));
CREATE VIRTUAL TABLE jobs_fts USING fts5(title, company_name, locations_text, description_text, content='', contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2', prefix='2 3');
CREATE TABLE user_job_state(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, hidden_at TEXT, viewed_at TEXT, PRIMARY KEY(user_id, job_id));
CREATE TABLE user_hidden_companies(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, created_at TEXT, PRIMARY KEY(user_id, company_id));
CREATE TABLE job_reports(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN('inactive','spam','inaccurate','duplicate','other')), details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved','dismissed')), created_at TEXT NOT NULL,
  resolved_at TEXT, resolved_by TEXT);
CREATE TABLE saved_searches(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  query TEXT NOT NULL CHECK(json_valid(query)), created_at TEXT NOT NULL);
CREATE TABLE applications(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL, company_id INTEGER REFERENCES companies(id), title TEXT NOT NULL,
  company_name TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL CHECK(employment_type IN('internship','full_time','part_time','contract')),
  posting_url TEXT NOT NULL DEFAULT '', description_html TEXT NOT NULL DEFAULT '', salary_min REAL, salary_max REAL,
  salary_currency TEXT, salary_period TEXT, current_status INTEGER NOT NULL DEFAULT 1, favorite INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT, resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  cover_letter_id TEXT REFERENCES cover_letters(id) ON DELETE SET NULL, notes_html TEXT NOT NULL DEFAULT '',
  tracked_on TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE application_status_events(application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status INTEGER NOT NULL CHECK(status IN(1,2,11,12,13,21,22,23,24)), occurred_on TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(application_id, status));
CREATE TABLE application_questions(id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT);
CREATE TABLE ai_tasks(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('resume_import','entry_bullets','job_analysis','cover_letter','template_fill')),
  status TEXT NOT NULL CHECK(status IN('queued','running','succeeded','failed','cancelled')), priority INTEGER NOT NULL DEFAULT 0,
  input TEXT NOT NULL CHECK(json_valid(input)), result TEXT, error_code TEXT, error_message TEXT, model TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, dedupe_key TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
-- indexes: sessions(user_id),(expires_at); resumes(user_id,updated_at DESC); cover_letters(user_id,updated_at DESC);
-- cover_letter_templates(user_id,updated_at DESC); ingest_runs(source_id,started_at DESC); jobs(active,posted_at DESC),
-- (active,source_updated_at DESC),(active,salary_annual_usd_max DESC),(active,category_id),(company_id,active),(content_hash),
-- UNIQUE jobs(link_key) WHERE link_key IS NOT NULL; job_locations(country_code,region,city); job_source_links(job_id);
-- UNIQUE applications(user_id,job_id) WHERE job_id IS NOT NULL; applications(user_id,archived_at,current_status,tracked_on DESC);
-- ai_tasks(status,priority DESC,created_at); UNIQUE ai_tasks(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN('queued','running')
```

## Appendix B — Render-engine contract (free_tailor file:line references)

1. **Describe the template at load.**
   - `supportsSoftSkills/Strengths`: the regex `\{\{[#\w\s]*softSkills\b` / `strengths\b` (`templateImport.ts:118-127`).
   - `printsSections` (`:138-156`).
   - `nativeSectionOrder` (`sectionLocator.ts:610-629`).
   - Page box from `@page` (`pdfGenerator.ts:126-248`): A4 794×1123; fallback margin 0.4/0.5/0.3/0.5 in; `mediaScale = min(1, 794/w, 1123/h)` with vertical centring.
2. **`resumeForTemplate`**: a switch that is on, on a template without that section, counts as off (`resumeDocument.ts:253-271`).
3. **Render data, untailored branch only** (`pdfGenerator.ts:1538-1600`):
   - `prepareExtraSectionData` (`extraSections.ts:94-228`): dates, `linkHref`/`linkText`, `subline`/`contactLine`, `customSections` + `customSectionsByKey`.
   - Contact links (`:1084-1131`); TailorIT adds `contact.website = portfolio`.
   - `sanitizeTitleForATS` (`:1039-1061`).
   - Experience descriptions clamped to 1,200 characters (`:667-709`).
   - **Skills gate** (`applySkillsLimit`, `:991-1037`):
     - Grouped = the author's categories (`:843-889`), else library grouping in `HARD_SKILL_CATEGORIES` order.
     - Plain = one headless group.
     - `hardSkills = skills = renderSkillLines(groups)` (`:901-906`).
     - `softSkills`/`strengths` emptied when their switch is off.
     - Category inference fallback (`:733-757`).
4. **Markup normalization, in order** (`:1335-1356`):
   1. Expand the `{{> extra-sections …}}` macro (`extraSectionsMarkup.ts:31-169`).
   2. Guard or strip the soft-skills/strengths sections (`:1217-1247`, via `sectionLocator.findSections` + `withGuards`).
   3. When a `sectionOrder` is stored, reorder within each parent by `sectionSortKey` (`sectionCatalogue.ts:219-222`); revert if the result no longer parses (`pdfGenerator.ts:1379-1433`).
   4. Replace "Hard Skills" with "Technical Skills".
   5. Grouped: `rewritePerItemSkillLoops` (`:1256-1310`). Plain: `fitPlainSkillGroups` (`plainSkillsMarkup.ts:43-122`).
   6. Inject the `xs-style` baseline (`extraSectionsMarkup.ts:182-209`).
   7. `guardEmptyCategoryHeadings`, then `guardEmptyDescriptions` (`pdfGenerator.ts:1466-1509`).
   8. Find fallback ladder: all → marked → none (`:1649-1673`).
5. **Compile**: Handlebars with `join` and identity `formatDate` (`:640-647`); LRU 128 keyed by `layout|soft|strengths|order|customKeys|markup` (`:1675-1700`).
6. **After render**: `rewriteLinkedInAnchorDisplay` (`:1133-1153`), then `enforceSkillCategoryLineBreaks` (`:1178-1208`).
7. **Document**:
   - Prepend `<style>{cssContent}</style>`.
   - Preview: CSP meta right after the doctype (`:1942-1962`) plus `previewPageChrome` (`:1840-1902`). Returns `page{widthPx,heightPx,contentHeightPx}` (`:1988-2001`).
   - PDF: no chrome, JavaScript off, network blocked.
8. **Locator.**
   - Stage A: class-token and `data-section` finders, `findClosingTag`, guards, generated-block comments, ancestors/parent key (`sectionLocator.ts:114-275,557-600`).
   - Stage B: loop heuristics (`:68-93,210-239,302-482`).
9. **Preview semantics**: `buildPreviewResume` (`resumeDocument.ts:779-843`) plus `withSampleDefaults` (`sampleResume.ts:262-394`), using TailorIT's **own** sample person (`static/sample-resume.json`).
