import type { SourceAdapter, SourceKind } from '../types';
import { ashbyAdapter } from './ashby';
import { ftLakeAdapter } from './ftLake';
import { greenhouseAdapter } from './greenhouse';
import { leverAdapter } from './lever';
import { seedAdapter } from './seed';
import { csvAdapter, jsonAdapter } from './tabular';

/** One adapter per source kind. */
export const ADAPTERS: Record<SourceKind, SourceAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  csv: csvAdapter,
  json: jsonAdapter,
  ft_lake: ftLakeAdapter,
  seed: seedAdapter,
};
