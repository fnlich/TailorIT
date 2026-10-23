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
- Schema: `migrations/0001_init.sql` is complete. Avoid new migrations; if one is unavoidable, use your package's range
  (R1 01xx, C 02xx, T 03xx, J1 04xx, J2 05xx, I 06xx), write it once, correctly — an applied migration that changes
  later refuses startup.

### Shared services (`deps.services`, all optional at the type level)
- **AI** (`src/ai/index.ts`): `requireAi(deps)` → `AiService`. Register a handler for your kind in your feature's
  `services` hook: `requireAi(deps).registerHandler(kind, (input, { runPrompt, signal, userId }) => runPrompt(module, input))`.
  Routes validate, then `sendAccepted(res, requireAi(deps).enqueue({ kind, userId, input }))` → `202 { taskId }`; the
  page polls `GET /api/ai/tasks/:id`. Prompt modules (`PromptModule`: kind, version, system, user, output zod schema) live
  in your feature. Model/effort come from `.env` per kind. Fake CLI scenario for your kind:
  `tools/fake-claude/scenarios/<kind>.json` (the parsed output value) — see `tools/fake-claude/scenarios/README.md`.
- **Files** (`src/core/files`): `getFileStore(deps)` → `save({userId, purpose, buffer, originalName, accept?})` (checks
  magic bytes and size; PDF/DOCX), `read`, `remove`, `saveThumbnail`, `readThumbnail`, `setPageCount`, `pathOf`;
  `uploadSingle(field)` multer middleware (memory, capped at UPLOAD_MAX_MB).
- **PDF/screenshots** (`src/core/pdf`): `getPdfService(deps)` → `printPdf(html, {format:'A4'|'Letter', margin?,
  preferCSSPageSize?})`, `screenshotPng(html, {width, height, clip?})`. JavaScript is off and every non-`data:` request is
  blocked: embed fonts/images as data URIs. Tests and CLI commands that render must `await getPdfService(deps).close()`.
- **Mail/auth** (`src/core/auth`, `src/core/mail`): sessions, accounts (`getAccount`), admin promotion.

### Tests
- Vitest + supertest. `createTestContext()` (`test/helpers.ts`): in-memory migrated DB, temp DATA_DIR, frozen clock
  (`TEST_NOW` = 2026-10-22T12:00Z, `ctx.setNow`), fake Claude CLI, all features. Call `ctx.cleanup()` in `afterEach`.
- `signIn(ctx, email, {admin?, name?})` (`test/auth-helpers.ts`) → `{agent, account, cookie}`.
- Mutating requests: `.set('Origin', ORIGIN)`.
- AI: `await requireAi(ctx.deps).waitFor(taskId)`; failures via `vi.stubEnv('FAKE_CLAUDE_MODE', 'stall'|'auth'|...)`.

## Shared contracts (`packages/shared`)
zod schemas + types + pure functions used by both apps (browser-safe: no Node APIs, no JSON imports). Import from
`@tailorit/shared` or a feature subpath `@tailorit/shared/<folder>`. Change a contract only in the package that owns
it, and keep both sides in step.

## Work packages and file ownership
Each package owns specific folders (see its brief). Never edit files outside your ownership; if another package's
file needs a change, say so in your report. Never run `npm install` (every dependency is installed) or git commands
that change state; the orchestrator commits. When typecheck reports errors only in files you don't own, another
package is mid-edit: ignore them.
