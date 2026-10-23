'use client';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Notice } from '@/components/ui/Notice';
import { userMessage } from '@/lib/api';

/**
 * Asked after Apply opens the posting in a new tab: "Did you apply?". Yes tracks the job as Applied today in the
 * Job Tracker; No leaves everything as it was.
 */
export function ApplyDialog({
  open,
  onOpenChange,
  company,
  title,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: string;
  title: string;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Did you apply?"
        description={`Let us know if you applied to ${title} at ${company}, and we'll track it in your Job Tracker.`}
        size="sm"
      >
        {error ? (
          <Notice tone="error" className="mt-4">
            {userMessage(error)}
          </Notice>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            No
          </Button>
          <Button onClick={onConfirm} loading={pending}>
            Yes, I applied
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
