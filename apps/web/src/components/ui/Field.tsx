'use client';

import { clsx } from 'clsx';
import { createContext, useContext, useId, type ReactNode } from 'react';

/*
 * A labelled form row. Controls inside (Input, Textarea, Select, Combobox) pick up the id, aria-describedby and
 * aria-invalid from context, so a field reads:
 *   <Field label="Email address" error={fieldError}><Input type="email" … /></Field>
 */

interface FieldContextValue {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
  labelId: string;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** id / aria-* for a control inside a Field (explicit props win). Empty outside a Field. */
export function useFieldControl(props: {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}) {
  const field = useContext(FieldContext);
  return {
    id: props.id ?? field?.controlId,
    'aria-describedby': props['aria-describedby'] ?? field?.describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field?.invalid ? true : undefined),
    labelId: field?.labelId,
  };
}

export interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  /** A short line under the control. */
  hint?: ReactNode;
  /** A validation sentence; marks the control invalid. */
  error?: ReactNode;
  /** Shown after the label: "Required" asterisk or "(optional)". */
  required?: boolean;
  optional?: boolean;
  /** The label sits beside the control (checkbox/switch rows) instead of above. */
  inline?: boolean;
  className?: string;
  id?: string;
}

export function Field({ label, children, hint, error, required, optional, inline, className, id }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `field-${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  const labelId = `${controlId}-label`;

  return (
    <FieldContext.Provider value={{ controlId, describedBy, invalid: Boolean(error), labelId }}>
      <div className={clsx(inline ? 'flex items-center gap-2.5' : 'flex flex-col gap-1.5', className)}>
        {!inline && <FieldLabel id={labelId} htmlFor={controlId} required={required} optional={optional}>{label}</FieldLabel>}
        {children}
        {inline && (
          <FieldLabel id={labelId} htmlFor={controlId} required={required} optional={optional} weight="normal">
            {label}
          </FieldLabel>
        )}
        {error ? (
          <p id={errorId} className="text-[13px] leading-5 text-[#c62a29]">
            {error}
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-[13px] leading-5 text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export function FieldLabel({
  children,
  htmlFor,
  id,
  required,
  optional,
  weight = 'medium',
  className,
}: {
  children: ReactNode;
  htmlFor?: string;
  id?: string;
  required?: boolean;
  optional?: boolean;
  weight?: 'medium' | 'normal';
  className?: string;
}) {
  return (
    <label
      id={id}
      htmlFor={htmlFor}
      className={clsx('text-sm leading-5 text-foreground', weight === 'medium' ? 'font-medium' : 'font-normal', className)}
    >
      {children}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-[#c62a29]">
          *
        </span>
      )}
      {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
    </label>
  );
}
