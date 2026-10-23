'use client';

import { Button as BaseButton } from '@base-ui/react/button';
import { clsx } from 'clsx';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Tooltip, type TooltipSide } from './Tooltip';

export type IconButtonVariant = 'ghost' | 'outline' | 'plain' | 'secondary';
export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'text-muted-foreground hover:bg-hover hover:text-foreground data-popup-open:bg-hover data-popup-open:text-foreground',
  plain: 'text-muted-foreground hover:text-foreground',
  // Simplify's round toolbar buttons (filters, clear) next to the pills.
  outline:
    'border border-border bg-surface text-foreground shadow-soft hover:border-control-hover hover:bg-[#fafafa] data-popup-open:border-control-hover',
  secondary: 'bg-chip text-foreground hover:bg-[#e3e3e3]',
};

const SIZES: Record<IconButtonSize, string> = { xs: 'size-7', sm: 'size-8', md: 'size-9', lg: 'size-10' };

export interface IconButtonProps extends Omit<ComponentPropsWithoutRef<typeof BaseButton>, 'className' | 'children'> {
  /** The accessible name (and the tooltip unless `tooltip` says otherwise). */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  shape?: 'square' | 'round';
  /** `false` hides the tooltip; a node replaces its text. Defaults to the label. */
  tooltip?: ReactNode | false;
  tooltipSide?: TooltipSide;
  className?: string;
}

/** An icon-only button with an accessible name and a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', shape = 'square', tooltip, tooltipSide, className, type, ...rest },
  ref,
) {
  const button = (
    <BaseButton
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center transition-[background-color,color,border-color] duration-150',
        'disabled:pointer-events-none disabled:opacity-40 data-disabled:pointer-events-none data-disabled:opacity-40',
        shape === 'round' ? 'rounded-full' : 'rounded-control',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
    </BaseButton>
  );
  if (tooltip === false) return button;
  return (
    <Tooltip content={tooltip ?? label} side={tooltipSide}>
      {button}
    </Tooltip>
  );
});
