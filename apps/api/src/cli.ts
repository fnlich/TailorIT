// Command-line entry for API maintenance scripts (db:migrate, seed:demo, ...). Commands are added by F3 and J1.
const command = process.argv[2];

if (!command) {
  console.error('usage: tsx src/cli.ts <command>');
  process.exit(2);
}

console.error(`Unknown command: ${command}`);
process.exit(2);
