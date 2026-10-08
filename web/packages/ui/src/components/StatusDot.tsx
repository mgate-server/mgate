import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'primary';

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  label?: string;
  pulse?: boolean;
}

const toneClasses: Record<StatusTone, string> = {
  success: 'bg-mg-success',
  warning: 'bg-mg-warning',
  danger: 'bg-mg-danger',
  neutral: 'bg-mg-text-muted',
  primary: 'bg-mg-primary',
};

/** A small colored dot for at-a-glance status (queue health, cert validity, session state). */
export function StatusDot({ tone, label, pulse = false, className, ...rest }: StatusDotProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)} {...rest}>
      <span className="relative inline-flex size-2.5">
        {pulse ? (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
              toneClasses[tone],
            )}
          />
        ) : null}
        <span className={cn('relative inline-flex size-2.5 rounded-full', toneClasses[tone])} />
      </span>
      {label ? <span className="text-mg-text text-sm">{label}</span> : null}
    </span>
  );
}
