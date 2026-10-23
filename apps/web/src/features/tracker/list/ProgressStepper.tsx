import { clsx } from 'clsx';
import type { StepperModel, StepperTone } from '@tailorit/shared';

const TONE: Record<StepperTone, { ring: string; dot: string; line: string }> = {
  default: { ring: 'bg-primary-container', dot: 'bg-primary-ink', line: 'bg-primary-container' },
  success: { ring: 'bg-success-container', dot: 'bg-success', line: 'bg-success-container' },
  muted: { ring: 'bg-muted', dot: 'bg-subtle-foreground', line: 'bg-muted' },
};

/**
 * The list row's stepper, laid out as Simplify's (screenshot 7): the dots spread from edge to edge with 4 px
 * connectors between them, each label centred 8 px above its 24 px dot and the date ("10/22/26") 8 px below. Reached
 * dots are a #08758c centre in a #ccf6ff ring, the rest white with a #d7d7d7 border; Offer/Accepted turn it green and
 * Rejected/Withdrawn/Ghosted grey. (The kit Stepper centres equal-width steps with 12 px gaps, which makes the row
 * 15 px taller than Simplify's and leaves the last dot far from the Status button.)
 */
export function ProgressStepper({ model, label, className }: { model: StepperModel; label: string; className?: string }) {
  const colors = TONE[model.tone];
  return (
    <ol aria-label={label} className={clsx('flex items-center px-5 py-6', className)}>
      {model.steps.map((step, index) => {
        const next = model.steps[index + 1];
        return (
          <li key={step.status} className={clsx('relative flex items-center', next && 'flex-1')}>
            {/* The labels hang off this border-less box, so bordered and filled dots line them up alike. */}
            <span className="relative flex size-6 shrink-0">
              <span className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 text-xs leading-4 whitespace-nowrap text-foreground">
                {step.label}
              </span>
              <span
                aria-hidden="true"
                className={clsx(
                  'flex size-6 items-center justify-center rounded-full',
                  step.reached ? colors.ring : 'border-2 border-control-strong bg-surface',
                )}
              >
                {step.reached && <span className={clsx('size-3.5 rounded-full', colors.dot)} />}
              </span>
              {step.dateLabel && (
                <span className="absolute top-full left-1/2 mt-2 -translate-x-1/2 text-xs leading-4 whitespace-nowrap text-foreground">
                  {step.dateLabel}
                </span>
              )}
              <span className="sr-only">{step.reached ? ', reached' : ', not reached'}</span>
            </span>
            {next && (
              <span aria-hidden="true" className={clsx('h-1 flex-1', step.reached && next.reached ? colors.line : 'bg-border')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
