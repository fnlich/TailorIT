'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

/**
 * The preview at the size it prints, scrolled rather than scaled: for reading it (or pinching it on a phone). Escape,
 * Close and a press outside the page close it.
 */
export function FullSizeViewer({
  open,
  onOpenChange,
  html,
  widthPx,
  heightPx,
  templateName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  html: string;
  widthPx: number;
  heightPx: number;
  templateName: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/70 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <BaseDialog.Popup
          aria-label="Resume preview at full size"
          className="fixed inset-0 z-50 flex flex-col outline-none transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0"
        >
          <div className="flex h-[63px] shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4 sm:px-6">
            <div className="flex min-w-0 flex-col">
              <BaseDialog.Title className="truncate text-[15px] leading-5 font-semibold text-foreground">Resume preview</BaseDialog.Title>
              <BaseDialog.Description className="truncate text-[13px] leading-5 text-muted-foreground">
                {templateName} at the size it prints
              </BaseDialog.Description>
            </div>
            <BaseDialog.Close render={<Button variant="outline" size="sm" />}>Close</BaseDialog.Close>
          </div>
          <div
            className="min-h-0 flex-1 overflow-auto p-4 sm:p-8"
            onClick={(event) => {
              if (event.target === event.currentTarget) onOpenChange(false);
            }}
          >
            <iframe
              srcDoc={html}
              sandbox="allow-same-origin"
              scrolling="no"
              title="Resume preview at full size"
              className="mx-auto block border-0 bg-white shadow-dialog"
              style={{ width: widthPx, height: heightPx }}
            />
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </Dialog>
  );
}
