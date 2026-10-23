'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { UploadSimpleIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';

export const LETTER_UPLOAD_ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** "a.pdf" / "b.docx" are what letters and templates accept (Simplify: "Unsupported file type"). */
export function isLetterUpload(file: File): boolean {
  return /\.(pdf|docx)$/i.test(file.name);
}

/**
 * Simplify's outline "Upload" button: picks a .pdf or .docx, sends it, then hands the created document over (the tab
 * opens it in the editor). Errors are toasts with the server's sentence.
 */
export function UploadButton({
  upload,
  onUploaded,
  label = 'Upload',
}: {
  upload: (file: File) => Promise<{ id: string }>;
  onUploaded: (created: { id: string }) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const send = async (file: File) => {
    if (!isLetterUpload(file)) {
      toast.error('Unsupported file type', 'Please upload a PDF or DOCX file.');
      return;
    }
    setBusy(true);
    try {
      onUploaded(await upload(file));
    } catch (error) {
      toast.error('Upload failed', userMessage(error, 'Could not read file.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" icon={<UploadSimpleIcon size={16} />} loading={busy} onClick={() => input.current?.click()}>
        {busy ? 'Uploading...' : label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={LETTER_UPLOAD_ACCEPT}
        hidden
        data-letter-upload=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void send(file);
        }}
      />
    </>
  );
}
