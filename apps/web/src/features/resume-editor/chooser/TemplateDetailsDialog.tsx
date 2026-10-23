'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { TEMPLATE_CATEGORY_LABEL, TECHNICAL_SKILLS_LAYOUT_LABEL, templateFeatures, type TechnicalSkillsLayout } from '@tailorit/shared/resume';
import { clsx } from 'clsx';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PageThumb, ThumbLoading } from '@/features/documents/core';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { BACKDROP, Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { CaretLeftIcon, CaretRightIcon, CheckIcon, XIcon } from '@/components/ui/icons';
import { templatePreviewSrc, type TemplateInfo } from '../api';
import { neighboursOf } from '../gallery';

const LAYOUTS: readonly TechnicalSkillsLayout[] = ['categorized', 'flat'];

/**
 * A template's details: its page large on the left; on the right its name, description, a Grouped / Plain switch that
 * redraws the page in either Technical skills layout, what it does, and "Use this template" (never off: any resume may
 * use any template). Previous / Next and the arrow keys step through the templates the grid shows, keeping the layout;
 * the arrows do nothing while focus is on the switch (Right then Space there would start a resume on a template nobody
 * looked at).
 */
export function TemplateDetailsDialog({
  template,
  list,
  onStep,
  onClose,
  onUse,
}: {
  template: TemplateInfo;
  list: readonly TemplateInfo[];
  onStep: (id: string) => void;
  onClose: () => void;
  onUse: (template: TemplateInfo, layout: TechnicalSkillsLayout) => void;
}) {
  const [layout, setLayout] = useState<TechnicalSkillsLayout>('categorized');
  const useButton = useRef<HTMLButtonElement>(null);
  const layoutGroup = useRef<HTMLDivElement>(null);
  const { previous, next } = neighboursOf(list, template.id);

  // A step lands on the next template's Use this template (the action), without scrolling a phone down to it.
  useEffect(() => {
    useButton.current?.focus({ preventScroll: true });
  }, [template.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (layoutGroup.current?.contains(event.target as Node)) return;
    if (event.key === 'ArrowLeft' && previous) {
      event.preventDefault();
      onStep(previous.id);
    } else if (event.key === 'ArrowRight' && next) {
      event.preventDefault();
      onStep(next.id);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={BACKDROP} />
        <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 sm:p-6">
          <BaseDialog.Popup
            initialFocus={useButton}
            onKeyDown={onKeyDown}
            className={clsx(
              'relative grid max-h-full w-full max-w-[1040px] grid-cols-1 overflow-hidden rounded-surface bg-surface text-foreground shadow-dialog outline-none',
              'md:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]',
              'transition-[opacity,scale] duration-200 ease-out-soft data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:scale-[0.97] data-ending-style:opacity-0',
            )}
          >
            <div className="flex items-start justify-center overflow-y-auto bg-surface-low p-5 sm:p-8">
              <div className="w-full max-w-[440px] overflow-hidden rounded-[6px] bg-white shadow-popover ring-1 ring-black/[0.06]">
                <PageThumb
                  key={`${template.id}:${layout}`}
                  src={templatePreviewSrc(template.id, layout)}
                  title={`${template.name} preview, Technical skills ${TECHNICAL_SKILLS_LAYOUT_LABEL[layout]}`}
                  lazy={false}
                  placeholder={<ThumbLoading />}
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-col overflow-y-auto p-6 sm:p-8">
              <div className="flex flex-col gap-2 pr-10">
                <BaseDialog.Title className="text-2xl leading-8 font-bold tracking-[-0.01em] text-foreground">{template.name}</BaseDialog.Title>
                {template.category && (
                  <div>
                    <Badge tone="tint">{TEMPLATE_CATEGORY_LABEL[template.category]}</Badge>
                  </div>
                )}
              </div>
              {template.description ? (
                <BaseDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">{template.description}</BaseDialog.Description>
              ) : (
                <BaseDialog.Description className="sr-only">A resume template</BaseDialog.Description>
              )}

              <div className="mt-6 flex flex-col gap-2">
                <p aria-hidden="true" className="text-sm leading-5 font-semibold text-foreground">
                  Technical skills
                </p>
                <div ref={layoutGroup} role="group" aria-label="Technical skills" className="inline-flex h-9 self-start rounded-full bg-segment">
                  {LAYOUTS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={layout === value}
                      onClick={() => setLayout(value)}
                      className={clsx(
                        'inline-flex h-full items-center rounded-full border px-4 text-sm transition-colors duration-150 focus-visible:outline-offset-0',
                        layout === value
                          ? 'border-black/[0.06] bg-surface text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {TECHNICAL_SKILLS_LAYOUT_LABEL[value]}
                    </button>
                  ))}
                </div>
              </div>

              <ul className="mt-6 flex flex-col gap-2.5">
                {templateFeatures(template).map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm leading-5 text-foreground">
                    <span aria-hidden="true" className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary-container text-primary-ink">
                      <CheckIcon size={11} weight="bold" />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <Button ref={useButton} size="lg" fullWidth className="mt-8" onClick={() => onUse(template, layout)}>
                Use this template
              </Button>

              {(previous || next) && (
                <div className="mt-auto flex items-center gap-3 pt-6">
                  {previous && (
                    <Button variant="ghost" size="sm" icon={<CaretLeftIcon size={14} />} onClick={() => onStep(previous.id)} className="max-w-[48%]">
                      <span className="truncate">{previous.name}</span>
                    </Button>
                  )}
                  {next && (
                    <Button variant="ghost" size="sm" trailingIcon={<CaretRightIcon size={14} />} onClick={() => onStep(next.id)} className="ml-auto max-w-[48%]">
                      <span className="truncate">{next.name}</span>
                    </Button>
                  )}
                </div>
              )}
            </div>

            <BaseDialog.Close
              render={<IconButton label="Close" icon={<XIcon size={18} />} size="sm" tooltip={false} className="absolute top-4 right-4" />}
            />
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </Dialog>
  );
}
