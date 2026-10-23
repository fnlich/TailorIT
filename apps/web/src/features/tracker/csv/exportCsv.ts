'use client';

import type { TrackerTab } from '@tailorit/shared';
import { ApiError, UNREACHABLE_MESSAGE } from '@/lib/api';
import { filterQuery, type FilterState } from '../state';

/** "TailorIT_Tracked_Jobs_2026-10-22.csv" from the server's Content-Disposition, else a dated fallback. */
function fileNameOf(header: string | null): string {
  const match = /filename="?([^";]+)"?/i.exec(header ?? '');
  return match?.[1] ?? 'TailorIT_Tracked_Jobs.csv';
}

/**
 * "Export CSV": the server writes every application the current tab, search and filters select; the browser saves
 * the file under the name the server gives.
 */
export async function downloadExport(tab: TrackerTab, filters: FilterState, q: string): Promise<string> {
  const params = new URLSearchParams({ tab });
  for (const [key, value] of Object.entries(filterQuery(filters, q))) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  let response: Response;
  try {
    response = await fetch(`/api/applications/export.csv?${params.toString()}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError({ status: 0, code: 'internal', message: UNREACHABLE_MESSAGE });
  }
  if (!response.ok) {
    let message = 'We couldn’t export your applications. Please try again.';
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // Not JSON: keep the general sentence.
    }
    throw new ApiError({ status: response.status, code: response.status === 401 ? 'not_signed_in' : 'internal', message });
  }
  const name = fileNameOf(response.headers.get('Content-Disposition'));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
