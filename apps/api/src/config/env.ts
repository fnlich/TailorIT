import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { AI_FEATURE_ENV, AI_TASK_KINDS, type AiTaskKind } from '@tailorit/shared';
import { repoRoot } from '../core/paths';

// Reads the repository's single root `.env` (also decoded by scripts/env.mjs — change the two together: PowerShell
// 5.1 writes UTF-16, which must not be read as UTF-8) and turns process.env into a typed AppConfig.

function readEnvText(filePath: string): string {
  const buffer = readFileSync(filePath);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!;
    if (value.startsWith('"')) {
      const end = value.lastIndexOf('"');
      value = (end > 0 ? value.slice(1, end) : value.slice(1)).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else if (value.startsWith("'")) {
      const end = value.lastIndexOf("'");
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    out[key] = value;
  }
  return out;
}

/** Applies the root `.env` to process.env; variables already set win. Safe to call more than once. */
export function loadRootEnv(): void {
  const file = join(repoRoot(), '.env');
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnvText(readEnvText(file)))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : /^(1|true|yes|on)$/i.test(v.trim())));
const int = (fallback: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return fallback;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min) {
        ctx.addIssue({ code: 'custom', message: `must be an integer >= ${min}` });
        return z.NEVER;
      }
      return n;
    });
const optional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? null : v.trim()));
const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

function defaultDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'TailorIT');
  }
  return join(homedir(), '.local', 'share', 'tailorit');
}

function defaultLakePath(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'free_tailor', 'db', 'free_tailor.db');
  }
  return '/data/db/free_tailor.db';
}

/**
 * When Claude refines job analyses (AI_JOB_ANALYSIS): `ingest` = every added job, once, through a background backlog;
 * `saved` = only jobs someone saved; `lazy` = the first time a job is opened; `off` = never (rules only).
 */
export const JOB_ANALYSIS_MODES = ['ingest', 'saved', 'lazy', 'off'] as const;
export type JobAnalysisMode = (typeof JOB_ANALYSIS_MODES)[number];
/** Whether Claude reads each uploaded resume after its quick rule-based reading (AI_RESUME_ANALYSIS). */
export const RESUME_ANALYSIS_MODES = ['auto', 'off'] as const;
export type ResumeAnalysisMode = (typeof RESUME_ANALYSIS_MODES)[number];

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
  APP_ORIGIN: z.string().optional().default('http://localhost:3100'),
  API_PORT: int(4100, 1),
  DATA_DIR: optional,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),

  SESSION_TTL_DAYS: int(30, 1),
  ADMIN_EMAILS: list,
  CONTACT_EMAIL: optional,
  GOOGLE_CLIENT_ID: optional,
  SMTP_HOST: optional,
  SMTP_PORT: int(465, 1),
  SMTP_SECURE: optional,
  SMTP_USER: optional,
  SMTP_PASS: optional,
  SMTP_FROM: optional,
  AUTH_DEV_LOG_CODES: bool(true),
  AUTH_DEV_FIXED_CODE: optional,

  AI_ENABLED: bool(true),
  AI_CLI_BIN: z.string().optional().default('claude'),
  AI_CLI_MODEL: z.string().optional().default('claude-sonnet-5-5'),
  AI_CLI_EFFORT: z.string().optional().default('low'),
  AI_CLI_FALLBACK_MODEL: optional,
  AI_CLI_CONCURRENCY: int(4, 1),
  AI_CLI_BACKGROUND_SLOTS: int(1, 0),
  AI_CLI_TIMEOUT_MS: int(300_000, 1000),
  AI_CLI_FIRST_EVENT_MS: int(30_000, 1000),
  AI_JOB_ANALYSIS: z.enum(JOB_ANALYSIS_MODES).optional().default('lazy'),
  AI_JOB_ANALYSIS_WARMUP_PER_HOUR: int(0, 0),
  AI_JOB_ANALYSIS_PER_HOUR: int(0, 0),
  AI_RESUME_ANALYSIS: z.enum(RESUME_ANALYSIS_MODES).optional().default('auto'),
  AI_RESUME_ANALYSIS_PER_HOUR: int(20, 0),

  CHROME_PATH: optional,
  PDF_RENDER_TIMEOUT_MS: int(30_000, 1000),
  PDF_MAX_CONCURRENCY: int(2, 1),
  UPLOAD_MAX_MB: int(5, 1),

  INGEST_ENABLED: bool(true),
  INGEST_DAILY_AT: z
    .string()
    .optional()
    .default('03:30')
    .refine((v) => /^\d{1,2}:\d{2}$/.test(v), 'use HH:MM'),
  INGEST_TIMEZONE: optional,
  INGEST_HTTP_TIMEOUT_MS: int(30_000, 1000),
  INGEST_USER_AGENT: z.string().optional().default('TailorIT job ingest'),
  FT_LAKE_DB_PATH: optional,
  FT_LAKE_MAX_AGE_DAYS: int(45, 1),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: optional,

  SEED_DEMO: bool(false),
});

export type AiFeatureModels = Record<AiTaskKind, { model: string; effort: string }>;

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  appOrigin: string;
  apiPort: number;
  dataDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  auth: {
    sessionTtlDays: number;
    adminEmails: string[];
    contactEmail: string | null;
    googleClientId: string | null;
    smtp: { host: string; port: number; secure: boolean; user: string; pass: string; from: string } | null;
    /** Print codes to the console when SMTP is missing. Always false in production. */
    devLogCodes: boolean;
    /** Accept this code for any address. Always null in production. */
    devFixedCode: string | null;
  };
  ai: {
    enabled: boolean;
    cliBin: string;
    model: string;
    effort: string;
    fallbackModel: string | null;
    concurrency: number;
    backgroundSlots: number;
    timeoutMs: number;
    firstEventMs: number;
    features: AiFeatureModels;
    jobAnalysis: JobAnalysisMode;
    warmupPerHour: number;
    /** Background job analyses started per hour; 0 = no cap. */
    jobAnalysisPerHour: number;
    resumeAnalysis: ResumeAnalysisMode;
    /** Background resume readings started per hour; 0 = no cap. */
    resumeAnalysisPerHour: number;
  };
  render: { chromePath: string | null; pdfTimeoutMs: number; pdfMaxConcurrency: number };
  uploadMaxMb: number;
  ingest: {
    enabled: boolean;
    dailyAt: string;
    timezone: string | null;
    httpTimeoutMs: number;
    userAgent: string;
    ftLakeDbPath: string;
    ftLakeMaxAgeDays: number;
    /** The Google service account's JSON key for the Sheet import (read when needed; it may not exist). */
    googleServiceAccountKeyFile: string;
  };
  seedDemo: boolean;
}

/** Pure: builds the config from an environment map (tests pass their own). Throws a readable error on bad values. */
export function buildConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid configuration in .env:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const smtp =
    e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS
      ? {
          host: e.SMTP_HOST,
          port: e.SMTP_PORT,
          secure: e.SMTP_SECURE === null ? e.SMTP_PORT === 465 : /^(1|true|yes|on)$/i.test(e.SMTP_SECURE),
          user: e.SMTP_USER,
          pass: e.SMTP_PASS,
          from: e.SMTP_FROM ?? e.SMTP_USER,
        }
      : null;
  const fixed = e.AUTH_DEV_FIXED_CODE && /^\d{6}$/.test(e.AUTH_DEV_FIXED_CODE) ? e.AUTH_DEV_FIXED_CODE : null;

  const features = Object.fromEntries(
    AI_TASK_KINDS.map((kind) => {
      const name = AI_FEATURE_ENV[kind];
      const model = (env[`AI_MODEL_${name}`] ?? '').trim() || e.AI_CLI_MODEL;
      const effort = (env[`AI_EFFORT_${name}`] ?? '').trim() || e.AI_CLI_EFFORT;
      return [kind, { model, effort }];
    }),
  ) as AiFeatureModels;

  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    appOrigin: e.APP_ORIGIN.replace(/\/+$/, ''),
    apiPort: e.API_PORT,
    dataDir: e.DATA_DIR ?? defaultDataDir(),
    logLevel: e.LOG_LEVEL,
    auth: {
      sessionTtlDays: e.SESSION_TTL_DAYS,
      adminEmails: e.ADMIN_EMAILS,
      contactEmail: e.CONTACT_EMAIL,
      googleClientId: e.GOOGLE_CLIENT_ID,
      smtp,
      devLogCodes: !isProduction && e.AUTH_DEV_LOG_CODES,
      devFixedCode: isProduction ? null : fixed,
    },
    ai: {
      enabled: e.AI_ENABLED,
      cliBin: e.AI_CLI_BIN,
      model: e.AI_CLI_MODEL,
      effort: e.AI_CLI_EFFORT,
      fallbackModel: e.AI_CLI_FALLBACK_MODEL,
      concurrency: e.AI_CLI_CONCURRENCY,
      backgroundSlots: e.AI_CLI_BACKGROUND_SLOTS,
      timeoutMs: e.AI_CLI_TIMEOUT_MS,
      firstEventMs: e.AI_CLI_FIRST_EVENT_MS,
      features,
      jobAnalysis: e.AI_JOB_ANALYSIS,
      warmupPerHour: e.AI_JOB_ANALYSIS_WARMUP_PER_HOUR,
      jobAnalysisPerHour: e.AI_JOB_ANALYSIS_PER_HOUR,
      resumeAnalysis: e.AI_RESUME_ANALYSIS,
      resumeAnalysisPerHour: e.AI_RESUME_ANALYSIS_PER_HOUR,
    },
    render: {
      chromePath: e.CHROME_PATH,
      pdfTimeoutMs: e.PDF_RENDER_TIMEOUT_MS,
      pdfMaxConcurrency: e.PDF_MAX_CONCURRENCY,
    },
    uploadMaxMb: e.UPLOAD_MAX_MB,
    ingest: {
      enabled: e.INGEST_ENABLED,
      dailyAt: e.INGEST_DAILY_AT,
      timezone: e.INGEST_TIMEZONE,
      httpTimeoutMs: e.INGEST_HTTP_TIMEOUT_MS,
      userAgent: e.INGEST_USER_AGENT,
      ftLakeDbPath: e.FT_LAKE_DB_PATH ?? defaultLakePath(),
      ftLakeMaxAgeDays: e.FT_LAKE_MAX_AGE_DAYS,
      // A relative path is read from the repository root, where .env lives.
      googleServiceAccountKeyFile: e.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
        ? resolve(repoRoot(), e.GOOGLE_SERVICE_ACCOUNT_KEY_FILE)
        : join(repoRoot(), 'service-account-key.json'),
    },
    seedDemo: e.SEED_DEMO,
  };
}

let cached: AppConfig | null = null;

/** The process-wide config: loads the root `.env` once, then parses process.env. */
export function getConfig(): AppConfig {
  if (!cached) {
    loadRootEnv();
    cached = buildConfig(process.env);
  }
  return cached;
}
