import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-mg-text text-sm font-medium">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        className={cn(
          'border-mg-border bg-mg-surface text-mg-text h-10 rounded-md border px-3 text-sm',
          'placeholder:text-mg-text-muted',
          'focus-visible:ring-mg-focus-ring focus-visible:ring-2 focus-visible:outline-none',
          error && 'border-mg-danger',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-mg-danger text-sm">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-mg-text-muted text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
