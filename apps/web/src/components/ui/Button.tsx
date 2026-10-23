'use client';

import { Button as BaseButton } from '@base-ui/react/button';
import { clsx } from 'clsx';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive'
  | 'destructive-soft'
  | 'destructive-outline'
  | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold ' +
  'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out-soft ' +
  'disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 ' +
  '[&_svg]:shrink-0';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-500 active:bg-[#0a7c95]',
  secondary: 'bg-chip text-foreground hover:bg-[#e3e3e3] active:bg-[#dcdcdc]',
  outline:
    'border border-control-outline bg-surface text-foreground shadow-control hover:border-control-hover hover:bg-[#fafafa] active:bg-surface-low',
  ghost: 'text-foreground hover:bg-hover active:bg-black/[0.08]',
  destructive: 'bg-destructive text-white hover:bg-[#e2302f] active:bg-[#cf2a29]',
  'destructive-soft': 'bg-destructive-container text-[#c62a29] hover:bg-[#f8d5d5] active:bg-[#f3c9c9]',
  'destructive-outline':
    'border border-[#f3c2c2] bg-surface text-[#c62a29] shadow-control hover:bg-destructive-container active:bg-[#f8d5d5]',
  link: 'h-auto px-0 text-primary-ink underline-offset-4 hover:underline',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-8 text-sm',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** The kit's button classes, for a Link or a Base UI trigger that must look like a Button. */
export function buttonClasses({ variant = 'primary', size = 'md', fullWidth, className }: ButtonStyleOptions = {}) {
  return clsx(BASE, variant === 'link' ? 'text-sm' : SIZES[size], VARIANTS[variant], fullWidth && 'w-full', className);
}

export interface ButtonProps
  extends Omit<ComponentPropsWithoutRef<typeof BaseButton>, 'className'>,
    Omit<ButtonStyleOptions, 'className'> {
  className?: string;
  /** Shows a spinner, disables the button and keeps its width. */
  loading?: boolean;
  /** An icon before the label (16 px). */
  icon?: ReactNode;
  /** An icon after the label (e.g. a caret). */
  trailingIcon?: ReactNode;
}

/**
 * Simplify's button: `h-9 px-4 text-sm`, radius 10. Variants primary (#14a1c0), secondary (#ebebeb), outline
 * (#dfdfdf border + control shadow), ghost, destructive(-soft/-outline) and link; sizes sm / md / lg.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, fullWidth, className, loading = false, icon, trailingIcon, disabled, children, type, ...rest },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon}
      {children}
      {trailingIcon}
    </BaseButton>
  );
});
