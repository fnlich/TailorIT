# fake-claude scenarios

`tools/fake-claude/fake-claude.mjs` stands in for the `claude` CLI in API tests and `verify:e2e`
(`AI_CLI_BIN=tools/fake-claude/fake-claude.mjs`). For each `-p` call it finds the `[feature:<kind>]` tag that
`runPrompt` appends to every system prompt and answers with this folder's scenario for that kind.

## Files

One file per prompt kind (`resume_import`, `entry_bullets`, `job_analysis`, `cover_letter`, `template_fill`, and
`echo` for the admin AI test). Each work package adds the files for its own kinds.

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
