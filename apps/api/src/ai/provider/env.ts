// The environment a `claude` child gets: the server's own, minus what would change who pays or which session answers.

const DROPPED = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'MAX_THINKING_TOKENS']);

/**
 * - `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`: the CLI prefers a key over the subscription and bills every call.
 * - `CLAUDECODE` and `CLAUDE_*` (set when the server itself runs inside Claude Code): the child would join the parent
 *   session. `CLAUDE_CONFIG_DIR` stays: it is where the operator's sign-in lives.
 * - `MAX_THINKING_TOKENS`: an operator's shell setting must not make this server answer differently.
 * Names are compared case-insensitively, as Windows resolves them.
 */
export function buildChildEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (DROPPED.has(upper)) continue;
    if (upper.startsWith('CLAUDE_') && upper !== 'CLAUDE_CONFIG_DIR') continue;
    child[name] = value;
  }
  return child;
}
