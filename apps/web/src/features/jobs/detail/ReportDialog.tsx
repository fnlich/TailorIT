'use client';

import { JOB_REPORT_REASONS, JOB_REPORT_REASON_LABEL, type JobReportReason } from '@tailorit/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Textarea } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { RadioGroup } from '@/components/ui/RadioGroup';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';
import { useReportJob } from '../hooks';

const REASONS = JOB_REPORT_REASONS.map((reason) => ({ value: reason, label: JOB_REPORT_REASON_LABEL[reason] }));
const MAX_DETAILS = 2000;

/** The flag button's dialog: why the posting is wrong, plus optional details, for the admin console. */
export function ReportDialog({
  jobId,
  jobTitle,
  open,
  onOpenChange,
}: {
  jobId: number;
  jobTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const report = useReportJob();
  const [reason, setReason] = useState<JobReportReason | null>(null);
  const [details, setDetails] = useState('');

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setReason(null);
      setDetails('');
      report.reset();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!reason) return;
    report.mutate(
      { jobId, body: { reason, details: details.trim() } },
      {
        onSuccess: () => {
          close(false);
          toast.success('Thanks for the report', 'We will take a look at this job.');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title="Report this job" description={`What is wrong with "${jobTitle}"?`} size="md">
        <form onSubmit={submit} className="mt-5 flex flex-col gap-5">
          <RadioGroup aria-label="Reason" options={REASONS} value={reason} onValueChange={setReason} />
          <Field label="Details" optional>
            <Textarea
              value={details}
              maxLength={MAX_DETAILS}
              rows={3}
              placeholder="Anything that helps us check it"
              onChange={(event) => setDetails(event.target.value)}
            />
          </Field>
          {report.isError && <Notice tone="error">{userMessage(report.error)}</Notice>}
          <DialogFooter flush>
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!reason} loading={report.isPending}>
              Report job
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
