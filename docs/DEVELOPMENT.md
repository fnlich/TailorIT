# Developing TailorIT

Conventions every work package follows. The architecture and the reasons behind it are in `ARCHITECTURE.md`; the
research (Simplify's UI, free_tailor's behaviour) is in `research/`.

## Ground rules

- **Written from scratch.** free_tailor (`F:\Develop\free_tailor`) is a read-only reference: read it for behaviour, flows,
  copy and API shapes; never modify it, never copy files or large blocks from it. Its 26 resume templates and
  `skills.json` are reused as data (`apps/api/static/`), with the owner's approval.
- **Simplify's look, not its brand.** Copy layout, behaviour, colours, type scale and generic UI wording. Never use
  Simplify's logo, wordmark, "Simplify+" upsells or its template texts. The user's screenshots
  (`e2e/reference/simplify-1..7.png`, git-ignored) and `research/screenshots-spec.md` are the visual truth.
- **Scope.** Header: Jobs, Job Tracker, Documents. No dark mode. No AI resume tailoring ("Tailor my resume" is hidden).
- **Windows first.** npm scripts run in cmd.exe: put logic in Node scripts, never POSIX shell syntax. Spawn `node <script>`
  rather than `.cmd` shims. Kill process trees with `taskkill /PID <pid> /T /F`.

## Commands (repo root)

| Command | What |
|---|---|
| `npm run dev` | API (tsx watch, :4100) + web (Next dev, :3100) with the root `.env`; `npm run dev:webpack` avoids Turbopack |
| `npm run verify` | typecheck + lint + unit/API tests (Vitest) |
| `npx vitest run --project <shared|render|api|web> [file]` | focused tests (always from the repo root) |
| `npm run build` / `npm start` | production build / serve |
| `npm run doctor` | checks Node, SQLite, Chrome, the `claude` CLI and sign-in config |
| `npm run db:migrate`, `npm run seed:demo` | maintenance commands (see `apps/api/src/cli.ts`) |

## API (`apps/api`)

### Features
Each feature lives in `src/features/<name>/` and registers itself in its own `index.ts` (`Feature` in
`src/core/feature.ts`): `services(deps)` creates shared services, `routes` mounts routers, `start(deps)` begins
background work (return a stop function), `commands` adds CLI commands. The central list `src/features/index.ts` and
`src/app.ts` never change when a feature grows.

### Requests and errors
- Routers: `Router()`, guard with `requireUser` / `requireAdmin` (`src/core/auth/guards.ts`), get the account with
  `userOf(req)`. Wrap async handlers in `asyncHandler`.
- Validate every body/query with `parseInput(schema, input)` (`src/core/http/validate.ts`), schemas from
  `@tailorit/shared`.
- Throw `AppError(code, sentence)` (`src/core/http/errors.ts`; helpers `notFound`, `validationFailed`, `conflict`,
  `forbidden`). The sentence is shown to the user as-is: say what happened and what to do.
- Rows that belong to someone else are `notFound` (never reveal existence). Always filter by `user_id` in SQL.
- Mutating requests from a browser must carry the app's Origin (enforced globally).

### Data
- `deps.db` is better-sqlite3 (synchronous). Use prepared statements; wrap multi-statement writes in
  `transaction(db, fn)` (`src/core/db/connection.ts`).
- Times: ISO UTC strings from `deps.now()` (`nowIso(deps)`; calendar dates `todayIso(deps)`). Never `new Date()` directly
  in logic: tests freeze the clock.
- IDs: `crypto.randomUUID()` for TEXT keys; INTEGER autoincrement for jobs/companies.
- Schema: `migrations/0001_init.sql` holds the first release's schema. Avoid new migrations; if one is unavoidable, use
  your package's range (R1 01xx, C 02xx, T 03xx, J1 04xx, J2 05xx, I 06xx), make it depend only on lower numbers, and
  write it once, correctly: an applied migration that changes later refuses startup.
- v2 added six, each in the range of the area it changes: `0002` (00xx, the foundation: rebuilds `ai_tasks` for the
  `resume_analysis` kind), `0101` (R1's 01xx: `resume_analyses` and Claude's backlog of uploads), `0301` (T's 03xx: the
  resume match columns) and `0401` to `0403` (J1's 04xx: the posting's facets, the job AI backlog's attempts and its
  index).
  `applications.resume_match_due = 1` asks the resume match worker to choose an application's resume again. Triggers
  in `0301` keep it current in the same transaction as the change that calls for it (a resume deleted, a resume
  reading written or changed, the default resume changed, a posting's text changed, a Claude or lake job analysis
  landed), and mark only applications TailorIT may choose for: of a job, Saved, not archived, origin `auto` or NULL.
  Writers that create or restore Saved applications set the flag themselves (a save whose choice is not ready,
  restoring, moving back to Saved; archiving or moving past Saved clears it): a new write path that does either must
  too. Spell out a partial index's condition in queries (`current_status = 1 AND archived_at IS NULL`), or SQLite does
  not use the index.

### Shared services (`deps.services`, all optional at the type level)
- **AI** (`src/ai/index.ts`): `requireAi(deps)` → `AiService`. Register a handler for your kind in your feature's
  `services` hook: `requireAi(deps).registerHandler(kind, (input, { runPrompt, signal, userId }) => runPrompt(module, input))`.
  Routes validate, then `sendAccepted(res, requireAi(deps).enqueue({ kind, userId, input }))` → `202 { taskId }`; the
  page polls `GET /api/ai/tasks/:id`. Prompt modules (`PromptModule`: kind, version, system, user, output zod schema) live
  in your feature. Model/effort come from `.env` per kind. Fake CLI scenario for your kind:
  `tools/fake-claude/scenarios/<kind>.json` (the parsed output value), or `<kind>.mjs` for an answer computed from
  the prompt — see `tools/fake-claude/scenarios/README.md`.
- **Files** (`src/core/files`): `getFileStore(deps)` → `save({userId, purpose, buffer, originalName, accept?})` (checks
  magic bytes and size; PDF/DOCX; refuses a DOCX that unpacks to too much), `read`, `remove`, `saveThumbnail`,
  `readThumbnail`, `setPageCount`, `pathOf`; `uploadSingle(field)` multer middleware (memory, capped at UPLOAD_MAX_MB).
  Read an uploaded file's contents only through `parsePdf` / `parseDocx` (`core/files/parse.ts`): they run pdf.js and
  mammoth in a short-lived child process with a small heap, a deadline and page/text caps. Never call pdf-parse or
  mammoth in the API process.
- **PDF/screenshots** (`src/core/pdf`): `getPdfService(deps)` → `printPdf(html, {format:'A4'|'Letter', margin?,
  preferCSSPageSize?})`, `screenshotPng(html, {width, height, clip?})`. JavaScript is off and every non-`data:` request is
  blocked: embed fonts/images as data URIs. Tests and CLI commands that render must `await getPdfService(deps).close()`.
- **Mail/auth** (`src/core/auth`, `src/core/mail`): sessions, accounts (`getAccount`), admin promotion.
- **Skill library** (`src/core/skills-vocabulary.ts`): `getSkillLibrary()` → `{hard, soft, vocabulary, spellings, byKey}`
  from `static/skills/skills.json` (read once). `hard` has one entry per skill; its `aliases` are the other spellings
  people write it as, and `spellings` lists every name and alias (an alias under its entry's heading and priority).
  Use `vocabulary` (the entries' names) for keyword extraction and matching: an alias must also be listed with its
  entry in `TERM_SYNONYMS` (`packages/shared/src/match/terms.ts`), which makes it the same keyword. Use `spellings`
  where a name is looked up (the render gate's headings, the skill picker). The file's README says how to edit it, and
  `test/skills-library.test.ts` checks the layout, the order and that nothing is listed twice.

### Tests
- Vitest + supertest. `createTestContext()` (`test/helpers.ts`): in-memory migrated DB, temp DATA_DIR, frozen clock
  (`TEST_NOW` = 2026-10-22T12:00Z, `ctx.setNow`), fake Claude CLI, all features. Call `ctx.cleanup()` in `afterEach`.
- `signIn(ctx, email, {admin?, name?})` (`test/auth-helpers.ts`) → `{agent, account, cookie}`.
- Mutating requests: `.set('Origin', ORIGIN)`.
- AI: `await requireAi(ctx.deps).waitFor(taskId)`; failures via `vi.stubEnv('FAKE_CLAUDE_MODE', 'stall'|'auth'|...)`.

## Web (`apps/web`)

- **Kit**: `@/components/ui` (Base UI + Simplify tokens): Button/IconButton/`buttonClasses()`, Field + Input/Textarea/
  Select/Combobox (creatable)/Checkbox (`onCheckedChange(checked, {shiftKey})`)/Switch/RadioGroup/Slider/RangeSlider,
  Badge/CountBadge/Chip/FilterPill/SegmentedControl/UnderlineTabs+TabPanel, Menu* (submenus, checkbox/radio items,
  `tone="danger"`), ContextMenu*, Popover*, Dialog*, Sheet* (right, `3xl`/`7xl`), Tooltip, `useToast()`, ConfirmDialog
  (async), DatePickerPopover, LetterAvatar, Spinner, Skeleton, EmptyState, Notice, Stepper. Icons:
  `@/components/ui/icons` (Phosphor; 16 px regular by default; `weight="fill"` for filled heart/bookmark/check).
  There is no tailwind-merge: pass `className` for layout only (margin, width), never colours or padding. Need a new
  primitive? Build it inside your feature folder; don't edit the kit (report the need instead).
- **Tokens** (`src/styles/globals.css`): `bg-primary` (#14a1c0) is for backgrounds; text/border "primary" is
  `primary-ink` (#08758c). Radii `rounded-control` 10 / `rounded-surface` 16 / `rounded-popup` 14 / `rounded-menu` 10;
  shadows `shadow-soft|control|menu|popover|dialog`; canvas `bg-canvas`, cards `bg-surface border`.
- **Shell**: `@/components/shell/AppHeader`, `EditorBar` (name, documentsHref, onRename, validateName, info, status,
  actions) for full-screen editors.
- **Data**: `api.get|post|put|patch|delete(path, {body, schema?})` from `@/lib/api` (same-origin `/api`, throws
  `ApiError` with code/message/fields; `userMessage(error)` for display). React Query is set up (`@/lib/query`).
  `useAuth()/useAccount()` from `@/lib/auth`. AI: `useAiTask(taskId, {kind})` (`@/lib/useAiTask`) polls and rotates the
  progress line. Redirect to /login happens automatically on `not_signed_in`.
- **Documents layer**: `@/features/documents/core` — DocumentCollection (table | cards variants, grid/list views,
  search, selection, bulk delete), DocumentCard, DocumentThumb (lazy, LRU, sandboxed `srcDoc` iframe or image),
  PageThumb, NewTile, ActionMenu, ViewToggle, SearchBox, RenameDialog, BulkDeleteDialog, cell helpers.
- **Feature code** lives in `src/features/<area>/`; route files in `src/app/**/page.tsx` stay thin and import a feature
  component. Placeholders to replace (keep export names): `features/documents/resumes/ResumesTab.tsx`,
  `features/resume-editor/ResumeEditorPage.tsx` ({resumeId|null}), `features/documents/cover-letters/CoverLettersTab.tsx`,
  `features/documents/templates/TemplatesTab.tsx`, `features/cover-letter-editor/CoverLetterEditorPage.tsx`
  (CoverLetterEditorPage {letterId}, NewCoverLetterPage), `features/template-editor/TemplateEditorPage.tsx`
  (TemplateEditorPage {templateId}, NewTemplatePage), `features/jobs/JobsPage.tsx`, `features/tracker/TrackerPage.tsx`,
  `features/settings/AdminPage.tsx`.
- **Checks**: `npx vitest run --project web` for pure logic (`src/**/*.test.ts`); Playwright specs in
  `e2e/specs/<package>.spec.ts` (channel `chrome`), visual captures in `e2e/visual/` writing to `e2e/artifacts/`
  (git-ignored). Compare against `e2e/reference/simplify-*.png` by looking at both images.

## Shared contracts (`packages/shared`)
zod schemas + types + pure functions used by both apps (browser-safe: no Node APIs, no JSON imports). Import from
`@tailorit/shared` or a feature subpath `@tailorit/shared/<folder>`. Change a contract only in the package that owns
it, and keep both sides in step.

## Work packages and file ownership
Each package owns specific folders (see its brief). Never edit files outside your ownership; if another package's
file needs a change, say so in your report. Never run `npm install` (every dependency is installed) or git commands
that change state; the orchestrator commits. When typecheck reports errors only in files you don't own, another
package is mid-edit: ignore them.
