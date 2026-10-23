import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface StepperStep {
  key: string;
  label: ReactNode;
  /** Reached steps draw the filled dot and a tinted connector towards the next reached step. */
  reached: boolean;
  /** A line under the dot, e.g. the date reached ("10/22/26"). */
  caption?: ReactNode;
}

export type StepperTone = 'primary' | 'success' | 'muted';

const TONE: Record<StepperTone, { ring: string; dot: string; line: string }> = {
  primary: { ring: 'bg-primary-container', dot: 'bg-primary-ink', line: 'bg-primary-container' },
  success: { ring: 'bg-success-container', dot: 'bg-success', line: 'bg-success-container' },
  muted: { ring: 'bg-muted', dot: 'bg-subtle-foreground', line: 'bg-muted' },
};

/**
 * Simplify's horizontal progress stepper (tracker list rows): label above each 24 px dot, the date below; reached
 * dots are a #08758c centre in a #ccf6ff ring, the rest white with a #d7d7d7 border, joined by 4 px connectors.
 * `tone` turns it green (Offer/Accepted) or grey (Rejected/Withdrawn/Ghosted).
 */
export function Stepper({
  steps,
  tone = 'primary',
  'aria-label': ariaLabel,
  className,
}: {
  steps: readonly StepperStep[];
  tone?: StepperTone;
  'aria-label': string;
  className?: string;
}) {
  const colors = TONE[tone];
  return (
    // Full width unless the caller sizes it (no class merging: a width in `className` replaces the default).
    <ol aria-label={ariaLabel} className={clsx('flex items-start', className ?? 'w-full')}>
      {steps.map((step, index) => {
        const next = steps[index + 1];
        return (
          <li key={step.key} className="relative flex min-w-0 flex-1 flex-col items-center">
            <span className="mb-3 text-xs leading-4 whitespace-nowrap text-foreground">{step.label}</span>
            <span className="relative flex h-6 w-full items-center justify-center">
              {next && (
                <span
                  aria-hidden="true"
                  className={clsx(
                    'absolute top-1/2 left-1/2 h-1 w-full -translate-y-1/2',
                    step.reached && next.reached ? colors.line : 'bg-border',
                  )}
                />
              )}
              <span
                aria-hidden="true"
                className={clsx(
                  'relative z-[1] flex size-6 items-center justify-center rounded-full',
                  step.reached ? colors.ring : 'border-2 border-control-strong bg-surface',
                )}
              >
                {step.reached && <span className={clsx('size-3.5 rounded-full', colors.dot)} />}
              </span>
            </span>
            <span className="mt-3 min-h-4 text-xs leading-4 whitespace-nowrap text-foreground">{step.caption}</span>
            <span className="sr-only">{step.reached ? ', reached' : ', not reached'}</span>
          </li>
        );
      })}
    </ol>
  );
}
