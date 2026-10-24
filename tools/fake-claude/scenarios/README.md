# fake-claude scenarios

`tools/fake-claude/fake-claude.mjs` stands in for the `claude` CLI in API tests and `verify:e2e`
(`AI_CLI_BIN=tools/fake-claude/fake-claude.mjs`). For each `-p` call it finds the `[feature:<kind>]` tag that
`runPrompt` appends to every system prompt and answers with this folder's scenario for that kind.

## Files

One file per prompt kind (`resume_import`, `entry_bullets`, `job_analysis`, `cover_letter`, `template_fill`,
`resume_analysis`, and `echo` for the admin AI test). Each work package adds the files for its own kinds.

- **`<kind>.json`**: the JSON value the fake model answers with. Make it pass your prompt module's `output` schema.
  The fake wraps it as the real model is told to:

  ```
  @@BEGIN_JSON@@
  { ...your value... }
  @@END_JSON@@
  ```

- **`<kind>.mjs`** (wins over `.json`): `export default (ctx) => value`, sync or async, for answers that depend on the
  input. `ctx` is `{ kind, system, user, model }`, where `user` is the whole stdin (the prompt module's `user()` text,
  plus the repair note on a retry). Return a value to have it wrapped as above, or a string to send that exact reply
  text (for example to test a malformed reply).

- No file for the kind: the answer is `{"ok":true}`.

`FAKE_CLAUDE_SCENARIOS=<dir>` reads scenarios from another directory (tests use a temporary one).

## The two readings

`job_analysis.mjs` and `resume_analysis.mjs` read their answer off the input in the prompt, so each job and each
upload gets its own. Like a real model now and then, both also slip in things the input never says, every time: the
tests check that TailorIT's grounding drops them.

- **`job_analysis.mjs`**: the posting's own bullets under its Requirements / Responsibilities / Nice-to-have
  headings, and the keywords of a small list the posting names. Since v2 it also answers `softSkills` (listed phrases
  that the requirement, duty and nice-to-have lines name), `terms` (the certifications and industries of small lists
  the posting names) and `requiredYears` (the first "N years of ... experience" line). Made up: a requirement, a
  keyword, a pay figure, one keyword twice, and the soft skill "Diplomacy" (a real entry of the soft-skill list that the
  posting never names). The grounding is `apps/api/src/features/job-analysis/ai.ts`.
- **`resume_analysis.mjs`** (v2): the resume text between the prompt's `<<<RESUME` and `RESUME>>>` markers: the name
  (the first line, when it reads as one), the roles (the headline, then the title on or above each date range), hard
  and soft skills, certifications and industries from small lists, each dated role, and an "N+ years of experience"
  the text states. Made up (exported as `INVENTED`): a hard skill, a soft skill, a role, a certification, an industry
  (plus "Gaming", a real industry, kept only when the text names it), a role with years the text does not have, and a
  total of 37 years when the text states none. The grounding is `finishResumeAnalysis` in
  `apps/api/src/features/resumes/analysis/prompt.ts`.

## Fault modes

Set `FAKE_CLAUDE_MODE` in the API's environment (the child inherits it):

| Mode | Behaviour |
|---|---|
| `stall` | No output at all until killed (the provider's first-event timer fires). |
| `auth` | `result` with `is_error: true`, status 401, "Please run /login"; `auth status` reports signed out. |
| `ratelimit` | A `rejected` `rate_limit_event`, then `result` with status 429. |
| `badjson-once` | The first call (per `FAKE_CLAUDE_STATE` key, counted in a file in the OS temp dir) answers malformed JSON; later calls answer normally. |
| `apikey` | `system/init` reports `apiKeySource: "ANTHROPIC_API_KEY"` (the provider must stop the call there); `auth status` reports an API-key sign-in. |
| `slow` | Answers after `FAKE_CLAUDE_SLOW_MS` (default 2000) ms, after `system/init`. |

`FAKE_CLAUDE_RECORD=<file>` appends one JSON line per call: argv, stdin, cwd, kind, model, pid and the NAMES of any
`ANTHROPIC_*` / `CLAUDE*` / `MAX_THINKING_TOKENS` variables the child received.

## Argv contract

`-p` calls must carry exactly the provider's flags (`apps/api/src/ai/provider/argv.ts`): `-p --output-format stream-json
--include-partial-messages --verbose --model <m> --effort <low|medium|high|xhigh|max> --tools "" --safe-mode
--strict-mcp-config --disable-slash-commands --permission-prompts none --no-session-persistence --system-prompt <text>`
and optionally `--fallback-model <m>`. A missing flag, an unknown one (such as `--bare`) or a positional prompt exits
with code 2 and a message on stderr. The prompt must arrive on stdin.
