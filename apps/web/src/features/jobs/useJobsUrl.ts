'use client';

import type { JobsQuery } from '@tailorit/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { jobsHref, readJobsUrl, type JobsUrlState } from './url';

export interface JobsUrlApi extends JobsUrlState {
  /** Replaces the filters (the selection resets: the first job of the new list is opened). */
  setQuery: (query: JobsQuery) => void;
  /** Changes some filters, starting from the latest ones (so quick successive clicks all count). */
  updateQuery: (patch: Partial<JobsQuery>) => void;
  /** Opens a job in the detail panel, keeping the filters. */
  selectJob: (jobId: number | null) => void;
}

/** The page state in the address bar, and the ways to change it (history is replaced, not pushed). */
export function useJobsUrl(): JobsUrlApi {
  const router = useRouter();
  const params = useSearchParams();
  const state = useMemo(() => readJobsUrl(params), [params]);

  // Until the router has applied a change, further changes build on the pending state, not the stale one.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  const go = useCallback(
    (next: JobsUrlState) => {
      latest.current = next;
      router.replace(jobsHref(next.query, next.jobId), { scroll: false });
    },
    [router],
  );

  const setQuery = useCallback((query: JobsQuery) => go({ query, jobId: null }), [go]);
  const updateQuery = useCallback(
    (patch: Partial<JobsQuery>) => go({ query: { ...latest.current.query, ...patch, cursor: undefined }, jobId: null }),
    [go],
  );
  const selectJob = useCallback((jobId: number | null) => go({ query: latest.current.query, jobId }), [go]);

  return { ...state, setQuery, updateQuery, selectJob };
}
