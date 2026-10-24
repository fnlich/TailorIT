import {
  bestKnownYears,
  fitResumeInput,
  MIN_READABLE_RESUME_TEXT,
  prepareEvidence,
  prepareFitResume,
  resumeLabel,
  synonymKey,
  type FitResume,
  type FitResumeInput,
  type PreparedEvidence,
  type ResumeAnalysisData,
} from '@tailorit/shared';
import type { AppDeps } from '../../core/context';
import type { Db } from '../../core/db/connection';
import { currentResumeAnalyses, type StoredResumeAnalysis } from '../resumes/analysis/store';
import { evidenceTextOf, storedDocumentOf } from '../resumes/evidence';

// The account's resumes as the matcher reads them (work package WP5). Each resume is scored on the Jobs card's own
// text (`evidenceTextOf`), so the picker, the Jobs card and Resume Score always agree, plus what TailorIT read from it
// (WP3's stored readings). Readings are never computed here (the rules read a long upload in a few hundred ms): a
// resume not read yet is matched on its text alone, and its reading, when the backfill stores it, marks the account's
// choices due (trigger in migration 0301).
//
// An AI editable copy of one of the account's uploads that nobody has edited yet (source_resume_id is a live upload of
// the account, last_edited_at IS NULL) is left out of matching: the upload it was made from wins.
//
// Text is read from the database only when a resume's text may have changed (its stamp): the prepared evidence is kept
// in a cache sized in bytes, and two small facts per resume (its first lines, and whether it is readable) in another.

/** The prepared-evidence cache's budget: the text of every resume of most accounts (about 80 long uploads). */
export const EVIDENCE_CACHE_BYTES = 32 * 1024 * 1024;
/** Resumes whose small facts are kept. */
const FACTS_MAX = 20_000;
/**
 * The first non-empty lines kept of a resume's text: the scorer reads role words from the first lines of a resume that
 * lists no roles (it reads 6 today).
 */
const HEAD_LINES = 20;

/** A resume with no stored reading yet: scored on its text alone. */
const UNREAD: ResumeAnalysisData = {
  hardSkills: [],
  softSkills: [],
  keywords: { roles: [], certifications: [], domains: [] },
  experience: [],
  yearsStated: null,
  yearsStatedBasis: null,
  personName: null,
};

/**
 * What a resume's text is made of: its row's update time, the sizes of its document and extracted text, and the content
 * hash of its rules' reading. When it changes, its text may have; then the text is read and prepared again.
 */
const STAMP_SQL =
  "r.updated_at || '|' || ifnull(octet_length(r.data), -1) || '|' || ifnull(octet_length(r.extracted_text), -1) || '|' || " +
  "ifnull((SELECT d.content_hash FROM resume_analyses d WHERE d.resume_id = r.id AND d.source = 'deterministic'), '')";

/** 1 for an AI editable copy of one of the account's uploads that has never been edited. */
const UNEDITED_COPY_SQL = `CASE WHEN r.kind = 'built' AND r.last_edited_at IS NULL AND r.source_resume_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM resumes s WHERE s.id = r.source_resume_id AND s.user_id = r.user_id AND s.kind = 'uploaded')
  THEN 1 ELSE 0 END`;

/**
 * A fingerprint of everything an account's candidates are made of: its default resume, its resumes' stamps, titles,
 * edits and sources, its stored readings, and where its uploads are in Claude's backlog. Read after the event loop had
 * a turn; a different answer means read them again.
 */
const PROBE_SQL = `SELECT
  ifnull((SELECT default_resume_id FROM users WHERE id = @userId), '') || '#' ||
  (SELECT count(*) || ':' || ifnull(group_concat(r.id || '@' || ${STAMP_SQL} || '@' || ifnull(r.last_edited_at, '') || '@' ||
     ifnull(r.source_resume_id, '') || '@' || ifnull(r.title, ''), ';' ORDER BY r.id), '')
   FROM resumes r WHERE r.user_id = @userId) || '#' ||
  (SELECT count(*) || ':' || ifnull(group_concat(a.resume_id || '@' || a.source || '@' || a.version || '@' || a.content_hash ||
     '@' || a.created_at, ';' ORDER BY a.resume_id, a.source), '')
   FROM resume_analyses a JOIN resumes x ON x.id = a.resume_id WHERE x.user_id = @userId) || '#' ||
  (SELECT count(*) || ':' || ifnull(group_concat(b.resume_id || '@' || b.state || '@' || ifnull(b.task_id, ''), ';'
     ORDER BY b.resume_id), '')
   FROM resume_analysis_backlog b WHERE b.user_id = @userId) AS probe`;

// ---------------------------------------------------------------------------------------------------- caches

/** A least-recently-used map whose size is counted in bytes (each entry says about how many it holds). */
export class ByteLru<V> {
  private readonly entries = new Map<string, { value: V; bytes: number }>();
  private total = 0;

  constructor(readonly maxBytes: number) {}

  /** About how many bytes the entries hold. */
  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** Stores `value` as the most recent entry; the least recent ones go while the total is over the budget. */
  set(key: string, value: V, bytes: number): void {
    this.delete(key);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.total += bytes;
    for (const [oldest, entry] of this.entries) {
      if (this.total <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.total -= entry.bytes;
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.total -= entry.bytes;
  }
}

/** A resume's small facts: its first lines (role words for a resume that lists no roles) and whether it is readable. */
interface Facts {
  stamp: string;
  head: string;
  readable: boolean;
}

/** A resume's prepared evidence and, once scored, its scorer reading (for the input it was made from). */
interface EvidenceEntry {
  stamp: string;
  evidence: PreparedEvidence;
  fitKey: string | null;
  fit: FitResume | null;
}

/** The caches of one matcher (one per server: they are keyed by resume id). */
export interface MatchCaches {
  readonly evidence: ByteLru<EvidenceEntry>;
  readonly facts: Map<string, Facts>;
}

export function createMatchCaches(maxBytes = EVIDENCE_CACHE_BYTES): MatchCaches {
  return { evidence: new ByteLru<EvidenceEntry>(maxBytes), facts: new Map() };
}

// ---------------------------------------------------------------------------------------------------- the set

/** One resume of the account, ready to score. */
export interface Candidate {
  readonly id: string;
  readonly kind: 'built' | 'uploaded';
  readonly isDefault: boolean;
  /** COALESCE(last_edited_at, created_at): the newer wins a tie. */
  readonly editedAt: string;
  /** An unedited AI copy of one of the account's uploads: listed, never chosen. */
  readonly excluded: boolean;
  /** Claude is reading this upload now (its place may change). */
  readonly refining: boolean;
  /** What its text is made of (`STAMP_SQL`): the caches' key. */
  readonly stamp: string;
  /** The scorer's input: its reading, years today, and its first lines standing in for its text. */
  readonly input: FitResumeInput;
  /** Everything of `input` the scorer's reading of it depends on. */
  readonly fitKey: string;
  /** Synonym keys of its hard skills: the pre-rank's overlap with a job's keywords. */
  readonly hardKeys: ReadonlySet<string>;
}

export interface CandidateSet {
  readonly userId: string;
  /** `PROBE_SQL`'s answer when the set was read. */
  readonly probe: string;
  readonly defaultId: string | null;
  /** Every resume of the account, oldest first. */
  readonly all: readonly Candidate[];
  /** The resumes TailorIT may choose (unedited AI copies left out). */
  readonly eligible: readonly Candidate[];
  readonly byId: ReadonlyMap<string, Candidate>;
  /** The person's best known years (from any readable resume's dates or the editor's field), for unknown years. */
  readonly bestKnownYears: number | null;
}

/** A resume row as the set is read from it. */
export interface CandidateRow {
  id: string;
  kind: 'built' | 'uploaded';
  created_at: string;
  last_edited_at: string | null;
  stamp: string;
  excluded: number;
}

interface TextRow {
  kind: 'built' | 'uploaded';
  data: string | null;
  extracted_text: string | null;
  stamp: string;
}

/** The account's candidate fingerprint (`PROBE_SQL`). */
export function candidateProbe(db: Db, userId: string): string {
  return (db.prepare(PROBE_SQL).get({ userId }) as { probe: string }).probe;
}

/**
 * What an account's set is read from, at one moment: its fingerprint, its resume rows (no text) and its default
 * resume. The readings and texts are read after, a few at a time (`readingsOf`, `buildCandidate`).
 */
export function candidateSources(db: Db, userId: string): { probe: string; rows: CandidateRow[]; defaultId: string | null } {
  const probe = candidateProbe(db, userId);
  const rows = db
    .prepare(
      `SELECT r.id, r.kind, r.created_at, r.last_edited_at, ${STAMP_SQL} AS stamp, ${UNEDITED_COPY_SQL} AS excluded
       FROM resumes r WHERE r.user_id = ? ORDER BY r.created_at, r.id`,
    )
    .all(userId) as CandidateRow[];
  const user = db.prepare('SELECT default_resume_id FROM users WHERE id = ?').get(userId) as
    | { default_resume_id: string | null }
    | undefined;
  return { probe, rows, defaultId: user?.default_resume_id ?? null };
}

/**
 * The stored readings of some of the account's resumes (WP3's `currentResumeAnalyses`), never computed here: one
 * missing (or of another version) is left to the backfill worker, which it nudges.
 */
export function readingsOf(deps: AppDeps, userId: string, resumeIds: readonly string[]): Map<string, StoredResumeAnalysis> {
  return resumeIds.length > 0 ? currentResumeAnalyses(deps, userId, { computeLimit: 0, resumeIds }) : new Map();
}

/** A resume's evidence text and its stamp, read together (so the text is the one the stamp describes). */
function loadText(db: Db, userId: string, resumeId: string): { text: string; stamp: string } | null {
  const row = db
    .prepare(`SELECT r.kind, r.data, r.extracted_text, ${STAMP_SQL} AS stamp FROM resumes r WHERE r.id = ? AND r.user_id = ?`)
    .get(resumeId, userId) as TextRow | undefined;
  return row ? { text: evidenceTextOf(row), stamp: row.stamp } : null;
}

/** The first HEAD_LINES non-empty lines of a text, whitespace tidied as the scorer reads them. */
function headOf(text: string): string {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    lines.push(line);
    if (lines.length >= HEAD_LINES) break;
  }
  return lines.join('\n');
}

function remember(caches: MatchCaches, id: string, facts: Facts): void {
  caches.facts.delete(id);
  caches.facts.set(id, facts);
  if (caches.facts.size > FACTS_MAX) {
    const oldest = caches.facts.keys().next().value;
    if (oldest !== undefined) caches.facts.delete(oldest);
  }
}

/**
 * A resume's facts for `stamp`, reading its text when they are not known for it (the text is prepared for the
 * evidence cache then too, while the cache has room). Null when the resume is gone.
 */
function factsOf(db: Db, caches: MatchCaches, userId: string, id: string, stamp: string): Facts | null {
  const known = caches.facts.get(id);
  if (known && known.stamp === stamp) return known;
  const loaded = loadText(db, userId, id);
  if (!loaded) return null;
  const facts: Facts = {
    stamp: loaded.stamp,
    head: headOf(loaded.text),
    readable: loaded.text.trim().length >= MIN_READABLE_RESUME_TEXT,
  };
  remember(caches, id, facts);
  const cached = caches.evidence.get(id);
  if ((!cached || cached.stamp !== loaded.stamp) && caches.evidence.bytes + loaded.text.length * 4 <= caches.evidence.maxBytes) {
    const evidence = prepareEvidence(loaded.text);
    caches.evidence.set(id, { stamp: loaded.stamp, evidence, fitKey: null, fit: null }, evidence.bytes);
  }
  return facts;
}

function fitKeyOf(input: FitResumeInput): string {
  return JSON.stringify([
    input.isDefault,
    input.editedAt,
    input.readable,
    input.years,
    input.yearsBasis,
    input.hardSkills,
    input.softSkills,
    input.roles,
    input.certifications,
    input.domains,
    input.evidenceText,
  ]);
}

/**
 * One resume as a candidate (its text is read when its facts are not known for its stamp): its reading (`stored`,
 * else an empty one), its years today, its first lines standing in for its text, and its keys.
 */
export function buildCandidate(
  db: Db,
  caches: MatchCaches,
  userId: string,
  row: CandidateRow,
  defaultId: string | null,
  stored: StoredResumeAnalysis | undefined,
  now: Date,
): Candidate {
  const facts = factsOf(db, caches, userId, row.id, row.stamp) ?? { stamp: row.stamp, head: '', readable: false };
  const reading = stored?.data ?? UNREAD;
  const isDefault = row.id === defaultId;
  const editedAt = row.last_edited_at ?? row.created_at;
  const input: FitResumeInput = {
    ...fitResumeInput({ id: row.id, isDefault, editedAt, evidenceText: facts.head }, reading, now),
    // Whether the whole text is readable (the input carries only its first lines).
    readable: facts.readable,
  };
  return {
    id: row.id,
    kind: row.kind,
    isDefault,
    editedAt,
    excluded: row.excluded === 1,
    refining: stored?.refining ?? false,
    stamp: row.stamp,
    input,
    fitKey: fitKeyOf(input),
    hardKeys: new Set(input.hardSkills.map(synonymKey)),
  };
}

/** The set made of an account's candidates (read from `probe`'s moment on). */
export function candidateSetOf(
  userId: string,
  probe: string,
  defaultId: string | null,
  all: readonly Candidate[],
): CandidateSet {
  return {
    userId,
    probe,
    defaultId,
    all,
    eligible: all.filter((candidate) => !candidate.excluded),
    byId: new Map(all.map((candidate) => [candidate.id, candidate])),
    bestKnownYears: bestKnownYears(all.map((candidate) => candidate.input)),
  };
}

// ---------------------------------------------------------------------------------------------------- scoring

/**
 * A candidate's scorer reading: from the cache, else made now (its text read and prepared when the cache does not
 * hold it). The evidence is stored under the stamp it was read with.
 */
export function fitOf(db: Db, caches: MatchCaches, userId: string, candidate: Candidate): FitResume {
  let entry = caches.evidence.get(candidate.id);
  if (!entry || entry.stamp !== candidate.stamp) {
    const loaded = loadText(db, userId, candidate.id);
    // Gone since the set was read: it scores nothing (the set is read again before anything is written).
    if (!loaded) return prepareFitResume(candidate.input, prepareEvidence(''));
    entry = { stamp: loaded.stamp, evidence: prepareEvidence(loaded.text), fitKey: null, fit: null };
    caches.evidence.set(candidate.id, entry, entry.evidence.bytes);
    // Its text changed since the set was read: the evidence is kept under its own stamp, the reading is not.
    if (loaded.stamp !== candidate.stamp) return prepareFitResume(candidate.input, entry.evidence);
  }
  if (entry.fit && entry.fitKey === candidate.fitKey) return entry.fit;
  const fit = prepareFitResume(candidate.input, entry.evidence);
  caches.evidence.set(candidate.id, { stamp: entry.stamp, evidence: entry.evidence, fitKey: candidate.fitKey, fit }, fit.bytes);
  return fit;
}

// ---------------------------------------------------------------------------------------------------- labels

/** Each resume's label, by the Resumes tab's rule (a custom title, else the headline or name, else the file's name). */
export function resumeLabels(db: Db, userId: string): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT r.id, r.kind, r.title, r.data, f.original_name AS file_name FROM resumes r
       LEFT JOIN stored_files f ON f.id = r.file_id AND f.user_id = r.user_id WHERE r.user_id = ?`,
    )
    .all(userId) as Array<{ id: string; kind: 'built' | 'uploaded'; title: string | null; data: string | null; file_name: string | null }>;
  const labels = new Map<string, string>();
  for (const row of rows) {
    const custom = row.title?.trim() || null;
    const fileName = (row.file_name ?? '').replace(/\.(pdf|docx?)$/i, '').trim();
    labels.set(
      row.id,
      row.kind === 'built' ? resumeLabel(storedDocumentOf(row), custom) : custom || fileName || 'Uploaded resume',
    );
  }
  return labels;
}
