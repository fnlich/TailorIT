'use client';

import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { htmlToText } from '@tailorit/shared/format';
import {
  CoverLetterGenerateResultSchema,
  CUSTOM_PROMPT_EXAMPLE,
  CUSTOM_PROMPT_MAX,
  type CoverLetterDetail,
  type CoverLetterGenerateResult,
} from '@tailorit/shared/letters';
import { ApplicationDetailSchema, type ApplicationDetail, type ApplicationSummary } from '@tailorit/shared/tracker';
import { Button, buttonClasses } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input, Textarea } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { SegmentedControl, TabPanel } from '@/components/ui/SegmentedControl';
import { Spinner } from '@/components/ui/Spinner';
import { api, isApiError, userMessage } from '@/lib/api';
import { useAiTask } from '@/lib/useAiTask';
import { fetchTemplates, generateLetter, patchLetter, templateKeys } from '../letter-editor/data';
import { shortcutLabel } from '../letter-editor/html';
import { SparkleIcon } from '../letter-editor/icons';
import { useIsMac } from '../letter-editor/Toolbar';
import { JobPicker } from './JobPicker';
import { TemplatePreview } from './TemplatePreview';

/*
 * Simplify's "Generate a Tailored Cover Letter": Job Details (pick a tracked job or type company, title and
 * description), Template ("None (generate without template)" or one of the templates, with a readable preview) and
 * Custom Prompt, then ✨ Generate with the staged progress lines while the AI task runs. Over a letter that already
 * has text, Generate first asks whether to replace it.
 */

type Tab = 'job' | 'template' | 'prompt';

const NO_TEMPLATE = 'none';

export interface GenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  letter: CoverLetterDetail;
  /** The editor holds text: Generate asks "Replace the current letter?" before it starts. */
  replacesContent?: boolean;
  /** Called before the request: save what is typed, lock the editor. */
  onStart: () => Promise<void> | void;
  onDone: (result: CoverLetterGenerateResult | null) => void;
}

type GenerateKind = 'cover_letter' | 'template_fill';

export function GenerateDialog(props: GenerateDialogProps) {
  const { onDone, onOpenChange } = props;
  const [run, setRun] = useState<{ taskId: string; kind: GenerateKind } | null>(null);
  const task = useAiTask(run?.taskId ?? null, { kind: run?.kind });
  const running = run !== null && task.isRunning;
  const reported = useRef<string | null>(null);

  // The task's end, once: hand the letter to the editor and close, or unlock the editor (the form shows why).
  useEffect(() => {
    if (!run || reported.current === run.taskId) return;
    if (task.isSucceeded) {
      reported.current = run.taskId;
      const parsed = CoverLetterGenerateResultSchema.safeParse(task.task?.result);
      onDone(parsed.success ? parsed.data : null);
      onOpenChange(false);
    } else if (task.isFailed || task.status === 'cancelled') {
      reported.current = run.taskId;
      onDone(null);
    }
  }, [run, task.isSucceeded, task.isFailed, task.status, task.task, onDone, onOpenChange]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        // While the letter is being written the dialog stays (Cancel stops the task).
        if (!open && running) return;
        if (!open) setRun(null);
        onOpenChange(open);
      }}
    >
      {props.open && (
        <GenerateForm
          {...props}
          onOpenChange={(open) => {
            // Closing forgets a finished run, so reopening starts clean.
            if (!open) setRun(null);
            onOpenChange(open);
          }}
          running={running}
          progress={task.message}
          failure={run && task.isFailed ? (task.errorMessage ?? 'The cover letter could not be generated. Please try again.') : null}
          onTask={(taskId, kind) => setRun({ taskId, kind })}
          onCancel={() => void task.cancel()}
        />
      )}
    </Dialog>
  );
}

function GenerateForm({
  letter,
  replacesContent = false,
  onOpenChange,
  onStart,
  onDone,
  running,
  progress,
  failure,
  onTask,
  onCancel,
}: GenerateDialogProps & {
  running: boolean;
  progress: string | null;
  failure: string | null;
  onTask: (taskId: string, kind: GenerateKind) => void;
  onCancel: () => void;
}) {
  const ids = { company: useId(), title: useId(), description: useId(), picker: useId(), prompt: useId() };
  const [tab, setTab] = useState<Tab>('job');
  const [companyName, setCompanyName] = useState(letter.companyName);
  const [jobTitle, setJobTitle] = useState(letter.jobTitle);
  const [jobDescription, setJobDescription] = useState(letter.jobDescription);
  const [templateId, setTemplateId] = useState<string>(letter.templateId ?? NO_TEMPLATE);
  const [customPrompt, setCustomPrompt] = useState(letter.customPrompt);
  const [fieldErrors, setFieldErrors] = useState<{ companyName?: string; jobTitle?: string }>({});
  const [requestError, setRequestError] = useState<{ message: string; needsResume: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [pickedJob, setPickedJob] = useState<ApplicationSummary | null>(null);
  const companyInput = useRef<HTMLInputElement>(null);
  const isMac = useIsMac();

  const templates = useQuery({ queryKey: templateKeys.all, queryFn: fetchTemplates });
  const templateItems = templates.data?.items ?? [];
  const chosen = templateItems.find((template) => template.id === templateId) ?? null;
  const error = requestError ?? (failure ? { message: failure, needsResume: false } : null);

  // The tracked application the letter belongs to (made from the tracker, or picked before) shows in the picker.
  const linkedId = letter.applicationId;
  const linkedJob = useQuery({
    queryKey: ['cover-letter', 'linked-application', linkedId],
    queryFn: ({ signal }) =>
      api.get<ApplicationDetail>(`/api/applications/${encodeURIComponent(linkedId ?? '')}`, { schema: ApplicationDetailSchema, signal }),
    enabled: Boolean(linkedId),
    retry: false,
    staleTime: 60_000,
  });
  const job = pickedJob ?? (linkedId ? (linkedJob.data ?? null) : null);

  const pickJob = async (application: ApplicationSummary) => {
    setPickedJob(application);
    setCompanyName(application.companyName);
    setJobTitle(application.title);
    setFieldErrors({});
    void patchLetter(letter.id, { applicationId: application.id }).catch(() => undefined);
    try {
      const detail = await api.get<ApplicationDetail>(`/api/applications/${encodeURIComponent(application.id)}`, {
        schema: ApplicationDetailSchema,
      });
      setJobDescription(htmlToText(detail.descriptionHtml));
    } catch {
      // The title and company are enough to go on.
    }
  };

  /** Checks the required fields, then asks before replacing a letter that has text. */
  const generate = () => {
    const problems = {
      companyName: companyName.trim() ? undefined : 'Required',
      jobTitle: jobTitle.trim() ? undefined : 'Required',
    };
    setFieldErrors(problems);
    if (problems.companyName || problems.jobTitle) {
      setTab('job');
      return;
    }
    if (replacesContent) {
      setConfirmingReplace(true);
      return;
    }
    void start();
  };

  const start = async () => {
    setRequestError(null);
    setSending(true);
    try {
      await onStart();
      const accepted = await generateLetter(letter.id, {
        companyName: companyName.trim(),
        jobTitle: jobTitle.trim(),
        jobDescription,
        templateId: chosen ? chosen.id : null,
        customPrompt,
      });
      onTask(accepted.taskId, chosen ? 'template_fill' : 'cover_letter');
    } catch (caught) {
      const needsResume = isApiError(caught) && Boolean(caught.fields?.resume);
      setRequestError({ message: userMessage(caught, 'The cover letter could not be generated. Please try again.'), needsResume });
      onDone(null);
    } finally {
      setSending(false);
    }
  };

  const busy = sending || running;

  return (
    <DialogContent
      title="Generate a Tailored Cover Letter"
      description="Tell us about the job, and we will write a letter from your resume that fits it."
      size="xl"
      initialFocus={companyInput}
    >
      {busy ? (
        <div className="flex min-h-[430px] flex-col items-center justify-center gap-4 py-10 text-center" data-generate-progress="">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary-container text-primary-ink">
            <SparkleIcon size={24} weight="fill" />
          </span>
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-[15px] font-medium text-foreground">
            <Spinner size={16} />
            {progress ?? 'Analyzing job description...'}
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">This usually takes under a minute. Keep this window open.</p>
          {running && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* On a short screen the fields scroll between the title and the buttons, which stay in view. */}
          <div className="-mx-6 mt-4 min-h-0 flex-1 overflow-y-auto px-6 py-1">
            <SegmentedControl<Tab>
              aria-label="Generate options"
              items={[
                { value: 'job', label: 'Job Details' },
                { value: 'template', label: 'Template' },
                { value: 'prompt', label: 'Custom Prompt' },
              ]}
              value={tab}
              onValueChange={setTab}
            >
              <TabPanel value="job" className="mt-5 min-h-[370px]">
                <p className="text-sm text-muted-foreground">Add or edit the job information for this cover letter.</p>
                <div className="mt-4 flex flex-col gap-4">
                  <Field label="Select a job from tracker" id={ids.picker}>
                    <JobPicker id={ids.picker} selected={job} onPick={(application) => void pickJob(application)} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Company Name" required error={fieldErrors.companyName} id={ids.company}>
                      <Input
                        ref={companyInput}
                        value={companyName}
                        placeholder="ex. Google"
                        maxLength={200}
                        onChange={(event) => setCompanyName(event.target.value)}
                      />
                    </Field>
                    <Field label="Job Title" required error={fieldErrors.jobTitle} id={ids.title}>
                      <Input
                        value={jobTitle}
                        placeholder="ex. Software Engineer"
                        maxLength={200}
                        onChange={(event) => setJobTitle(event.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="Job Description" id={ids.description}>
                    <Textarea
                      value={jobDescription}
                      rows={7}
                      placeholder="Paste the job description here"
                      onChange={(event) => setJobDescription(event.target.value)}
                      className="max-h-72"
                    />
                  </Field>
                </div>
              </TabPanel>
              <TabPanel value="template" className="mt-5 min-h-[370px]">
                <p className="text-sm text-muted-foreground">Optionally select a template to generate your cover letter from.</p>
                <TemplateChoice
                  templates={templateItems}
                  loading={templates.isPending}
                  value={chosen ? chosen.id : NO_TEMPLATE}
                  onChange={setTemplateId}
                />
              </TabPanel>
              <TabPanel value="prompt" className="mt-5 min-h-[370px]">
                <p className="text-sm text-muted-foreground">Add additional context or instructions</p>
                <div className="mt-4 flex flex-col gap-2">
                  <Textarea
                    id={ids.prompt}
                    aria-label="Custom prompt"
                    value={customPrompt}
                    rows={8}
                    maxLength={CUSTOM_PROMPT_MAX}
                    placeholder="Paste in an existing cover letter OR provide some context for AI to expand upon..."
                    onChange={(event) => setCustomPrompt(event.target.value)}
                  />
                  <div>
                    <Button variant="link" onClick={() => setCustomPrompt(CUSTOM_PROMPT_EXAMPLE)}>
                      Load an example
                    </Button>
                  </div>
                </div>
              </TabPanel>
            </SegmentedControl>

            {error && (
              <Notice tone="error" className="mt-5">
                {error.message}
                {error.needsResume && (
                  <span className="mt-2 block">
                    <Link href="/documents?tab=resumes" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                      Go to Documents
                    </Link>
                  </span>
                )}
              </Notice>
            )}
          </div>

          <DialogFooter flush className="mt-5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button icon={<SparkleIcon size={16} weight="fill" />} onClick={generate} data-generate-submit="">
              Generate
            </Button>
          </DialogFooter>
        </>
      )}

      <ConfirmDialog
        open={confirmingReplace}
        onOpenChange={setConfirmingReplace}
        title="Replace the current letter?"
        description={`You can undo with ${shortcutLabel('Mod+Z', isMac)} or the toolbar's Undo button.`}
        confirmLabel="Replace"
        tone="primary"
        onConfirm={() => void start()}
      />
    </DialogContent>
  );
}

function TemplateChoice({
  templates,
  loading,
  value,
  onChange,
}: {
  templates: ReadonlyArray<{ id: string; name: string; isSystem: boolean }>;
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  const name = useId();
  const chosen = templates.find((template) => template.id === value) ?? null;
  const options = [{ id: NO_TEMPLATE, label: 'None (generate without template)' }].concat(
    templates.map((template) => ({ id: template.id, label: template.isSystem ? `${template.name} (Default)` : template.name })),
  );
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div role="radiogroup" aria-label="Template" className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1 sm:max-h-72">
        {loading ? (
          <Spinner size={16} label="Loading templates..." className="py-3" />
        ) : (
          options.map((option) => {
            const checked = option.id === value;
            return (
              <label
                key={option.id}
                className={clsx(
                  'flex cursor-pointer items-center gap-3 rounded-control border px-3 py-2.5 text-sm transition-colors',
                  checked ? 'border-primary bg-primary-50' : 'border-border hover:bg-hover',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.id}
                  checked={checked}
                  onChange={() => onChange(option.id)}
                  className="size-4 accent-[#14a1c0]"
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </label>
            );
          })
        )}
        {!loading && templates.length === 0 && (
          <p className="px-1 py-2 text-sm text-muted-foreground">No templates available. Create one from the Documents page.</p>
        )}
      </div>
      <TemplatePreview template={chosen} className="h-64 sm:h-72" />
    </div>
  );
}
