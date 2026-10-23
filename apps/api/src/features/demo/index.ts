import { STATUS_INFO, type ApplicationStatus } from '@tailorit/shared';
import type { AppDeps } from '../../core/context';
import type { Feature } from '../../core/feature';
import { DEMO_EMAIL } from './content';
import { DemoSeedError, describeStatusCounts, seedDemo, type DemoSeedOptions } from './seed';

// The demo data set (work package I): `npm run seed:demo [-- --email you@example.com] [-- --refresh]`.

const USAGE = `Usage: npm run seed:demo [-- [--email <address>] [--refresh] [--no-pdf]]

  Loads the demo jobs and fills an account with a demo data set: preferences, two built resumes and an uploaded
  PDF, thirty tracked applications, three cover letters and two templates. No AI is used.

  --email <address>  Fill this account instead of ${DEMO_EMAIL} (created when it does not exist). Only the seeded
                     rows are touched: preferences and the default resume are set only when the account has none.
  --refresh          Remove what the seed wrote before and write it again (and re-date the demo jobs).
  --no-pdf           Skip the uploaded PDF resume (it needs Chrome or Edge).`;

/** Reads `--email <a>` / `--email=<a>`, `--refresh`, `--no-pdf`; null for `--help`. Throws on anything else. */
export function parseSeedDemoArgs(args: readonly string[]): DemoSeedOptions | null {
  const options: DemoSeedOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') return null;
    if (arg === '--refresh') options.refresh = true;
    else if (arg === '--no-pdf') options.pdf = false;
    else if (arg === '--email') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new DemoSeedError('--email needs an address, e.g. --email you@example.com');
      options.email = value;
      index += 1;
    } else if (arg.startsWith('--email=')) options.email = arg.slice('--email='.length);
    else throw new DemoSeedError(`Unknown option "${arg}".`);
  }
  return options;
}

async function runSeedDemo(deps: AppDeps, args: string[]): Promise<void> {
  let options: DemoSeedOptions | null;
  try {
    options = parseSeedDemoArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (!options) {
    console.log(USAGE);
    return;
  }
  try {
    const result = await seedDemo(deps, options);
    const { jobs } = result;
    console.log(
      `Demo jobs: ${jobs.status}. ${jobs.fetched} postings: ${jobs.created} new, ${jobs.updated} updated, ` +
        `${jobs.unchanged} unchanged, ${jobs.failed} failed.`,
    );
    const who = `${result.email}${result.accountCreated ? ' (new account)' : ''}`;
    if (result.alreadySeeded) {
      console.log(
        `${who} already has the demo data (seeded ${result.seededAt}). Run with --refresh to rebuild it.`,
      );
      return;
    }
    const labels = Object.fromEntries(
      Object.entries(STATUS_INFO).map(([code, info]) => [Number(code), info.label]),
    ) as Record<ApplicationStatus, string>;
    const apps = result.applications;
    console.log(`Demo account: ${who}`);
    console.log(
      `  Resumes: ${result.resumes.built} built + ${result.resumes.uploaded} uploaded PDF` +
        `${result.resumes.defaultLabel ? `; default: ${result.resumes.defaultLabel}` : ''}`,
    );
    if (result.uploadSkipped) console.log(`  The uploaded PDF resume was not made: ${result.uploadSkipped}.`);
    console.log(
      `  Applications: ${apps.total} (${describeStatusCounts(apps.byStatus, labels)}); ${apps.fromJobBoard} from the job board, ` +
        `${apps.favorites} favorites, ${apps.archived} archived, ${apps.withNotes} with notes, ${apps.withQuestions} with questions` +
        `${apps.skipped ? `; ${apps.skipped} left out (already tracked)` : ''}`,
    );
    console.log(`  Cover letters: ${result.coverLetters}; templates of their own: ${result.templates}`);
    const { auth } = deps.config;
    const how = auth.smtp
      ? 'the six-digit code is emailed to that address'
      : auth.devLogCodes
        ? 'the six-digit code is printed in the API console (no SMTP is configured)'
        : 'configure SMTP (or AUTH_DEV_LOG_CODES in development) to receive the code';
    console.log(`Sign in at ${deps.config.appOrigin} as ${result.email}: ${how}.`);
  } catch (error) {
    if (error instanceof DemoSeedError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    // The PDF service started a browser for the uploaded resume: close it, or the command would not exit.
    await deps.services.pdf?.close().catch(() => undefined);
  }
}

export const demoFeature: Feature = {
  name: 'demo',
  commands: {
    'seed:demo': runSeedDemo,
  },
};
