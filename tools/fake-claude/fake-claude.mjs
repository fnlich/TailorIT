#!/usr/bin/env node
// Placeholder for the deterministic `claude` CLI stand-in used by tests (AI_CLI_BIN). Work package F4 replaces it
// with the full version (argv contract checks, stream-json scenarios, fault modes).
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('0.0.0 (fake-claude)\n');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'fake' }) + '\n');
  process.exit(0);
}
process.stderr.write('fake-claude: scenario support not implemented yet\n');
process.exit(1);
