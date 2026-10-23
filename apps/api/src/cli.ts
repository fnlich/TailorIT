// Maintenance commands: `npm run db:migrate`, `npm run seed:demo`, or `tsx src/cli.ts <command> [...args]`.
// Commands come from features (Feature.commands), so packages add theirs without editing this file.
import { setupServices } from './app';
import { createRuntimeDeps } from './deps';
import { FEATURES } from './features/index';

const BUILT_IN: Record<string, string> = {
  'db:migrate': 'Apply pending database migrations (also done on every API start).',
};

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const featureCommands = new Map<string, NonNullable<(typeof FEATURES)[number]['commands']>[string]>();
  for (const feature of FEATURES) {
    for (const [name, run] of Object.entries(feature.commands ?? {})) featureCommands.set(name, run);
  }

  if (!command || command === 'help') {
    console.log('Commands:');
    for (const [name, text] of Object.entries(BUILT_IN)) console.log(`  ${name.padEnd(18)} ${text}`);
    for (const name of featureCommands.keys()) console.log(`  ${name}`);
    return;
  }

  const deps = createRuntimeDeps(); // opening the database applies migrations
  try {
    if (command === 'db:migrate') {
      console.log('Database is up to date.');
      return;
    }
    const run = featureCommands.get(command);
    if (!run) {
      console.error(`Unknown command: ${command}. Run with "help" to list commands.`);
      process.exitCode = 2;
      return;
    }
    setupServices(deps);
    await run(deps, args);
  } finally {
    deps.db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
