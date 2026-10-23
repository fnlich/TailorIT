import {
  CoverLetterBulkDeleteResponseSchema,
  CoverLetterDetailSchema,
  CoverLetterListResponseSchema,
  CoverLetterPreviewResponseSchema,
  LetterTemplateBulkDeleteResponseSchema,
  LetterTemplateDetailSchema,
  LetterTemplateListResponseSchema,
  type CoverLetterDetail,
  type CoverLetterSummary,
  type CoverLetterPreviewResponse,
  type GenerateCoverLetterBody,
  type LetterTemplateDetail,
  type LetterTemplateSummary,
  type PatchCoverLetterBody,
  type PatchLetterTemplateBody,
} from '@tailorit/shared/letters';
import { AiTaskAcceptedSchema } from '@tailorit/shared/ai';
import type { ListResponse } from '@tailorit/shared/core';
import { api, ApiError, type ApiRequestInit } from '@/lib/api';
import { fileNameFromDisposition } from './download';

/*
 * The cover-letter and template endpoints, shared by the editors and the Documents tabs, with their React Query keys.
 */

export const letterKeys = {
  all: ['cover-letters'] as const,
  detail: (id: string) => ['cover-letters', 'detail', id] as const,
};

export const templateKeys = {
  all: ['letter-templates'] as const,
  detail: (id: string) => ['letter-templates', 'detail', id] as const,
};

const enc = encodeURIComponent;
type Init = Omit<ApiRequestInit, 'body' | 'method'>;

// ---------------------------------------------------------------------------------------------- cover letters --

export const fetchLetters = () =>
  api.get<ListResponse<CoverLetterSummary>>('/api/cover-letters', { schema: CoverLetterListResponseSchema });

export const fetchLetter = (id: string) =>
  api.get<CoverLetterDetail>(`/api/cover-letters/${enc(id)}`, { schema: CoverLetterDetailSchema });

export const createLetter = (body: { applicationId?: string; jobId?: number; templateId?: string } = {}) =>
  api.post<CoverLetterDetail>('/api/cover-letters', body, { schema: CoverLetterDetailSchema });

export const patchLetter = (id: string, body: PatchCoverLetterBody, init?: Init) =>
  api.patch<CoverLetterDetail>(`/api/cover-letters/${enc(id)}`, body, { ...init, schema: CoverLetterDetailSchema });

export const deleteLetter = (id: string) => api.delete(`/api/cover-letters/${enc(id)}`);

export const bulkDeleteLetters = (ids: string[]) =>
  api.post<{ deleted: number }>('/api/cover-letters/bulk-delete', { ids }, { schema: CoverLetterBulkDeleteResponseSchema });

export const generateLetter = (id: string, body: GenerateCoverLetterBody) =>
  api.post<{ taskId: string }>(`/api/cover-letters/${enc(id)}/generate`, body, { schema: AiTaskAcceptedSchema });

export const fetchLetterPreview = (id: string) =>
  api.get<CoverLetterPreviewResponse>(`/api/cover-letters/${enc(id)}/preview`, { schema: CoverLetterPreviewResponseSchema });

export const letterExportPath = (id: string, format: 'pdf' | 'docx') => `/api/cover-letters/${enc(id)}/export?format=${format}`;

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export const uploadLetter = (file: File) =>
  api.post<CoverLetterDetail>('/api/cover-letters/upload', fileForm(file), { schema: CoverLetterDetailSchema });

export const importIntoLetter = (id: string, file: File) =>
  api.post<CoverLetterDetail>(`/api/cover-letters/${enc(id)}/import`, fileForm(file), { schema: CoverLetterDetailSchema });

// -------------------------------------------------------------------------------------------------- templates --

export const fetchTemplates = () =>
  api.get<ListResponse<LetterTemplateSummary>>('/api/cover-letter-templates', { schema: LetterTemplateListResponseSchema });

export const fetchTemplate = (id: string) =>
  api.get<LetterTemplateDetail>(`/api/cover-letter-templates/${enc(id)}`, { schema: LetterTemplateDetailSchema });

export const createTemplate = () =>
  api.post<LetterTemplateDetail>('/api/cover-letter-templates', {}, { schema: LetterTemplateDetailSchema });

export const patchTemplate = (id: string, body: PatchLetterTemplateBody, init?: Init) =>
  api.patch<LetterTemplateDetail>(`/api/cover-letter-templates/${enc(id)}`, body, { ...init, schema: LetterTemplateDetailSchema });

export const deleteTemplate = (id: string) => api.delete(`/api/cover-letter-templates/${enc(id)}`);

export const duplicateTemplate = (id: string) =>
  api.post<LetterTemplateDetail>(`/api/cover-letter-templates/${enc(id)}/duplicate`, {}, { schema: LetterTemplateDetailSchema });

export const bulkDeleteTemplates = (ids: string[]) =>
  api.post<{ deleted: number; skippedIds: string[] }>('/api/cover-letter-templates/bulk-delete', { ids }, {
    schema: LetterTemplateBulkDeleteResponseSchema,
  });

export const uploadTemplate = (file: File) =>
  api.post<LetterTemplateDetail>('/api/cover-letter-templates/upload', fileForm(file), { schema: LetterTemplateDetailSchema });

export const importIntoTemplate = (id: string, file: File) =>
  api.post<LetterTemplateDetail>(`/api/cover-letter-templates/${enc(id)}/import`, fileForm(file), {
    schema: LetterTemplateDetailSchema,
  });

export const fetchTemplatePreview = (id: string) =>
  api.get<CoverLetterPreviewResponse>(`/api/cover-letter-templates/${enc(id)}/preview`, {
    schema: CoverLetterPreviewResponseSchema,
  });

export const templateExportPath = (id: string, format: 'pdf' | 'docx') =>
  `/api/cover-letter-templates/${enc(id)}/export?format=${format}`;

// -------------------------------------------------------------------------------------------------- downloads --

/**
 * Downloads a file the API answers with Content-Disposition (exports), keeping the page where it is. A failure is
 * an ApiError carrying the server's sentence.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', headers: { Accept: '*/*' } });
  } catch {
    throw new ApiError({ status: 0, code: 'internal', message: "We can't reach the server right now. Please try again in a moment.", path });
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError({
      status: response.status,
      code: response.status === 503 ? 'browser_unavailable' : 'render_failed',
      message: data?.error?.message || 'The download did not work. Please try again.',
      path,
    });
  }
  const blob = await response.blob();
  const name = fileNameFromDisposition(response.headers.get('Content-Disposition')) ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
