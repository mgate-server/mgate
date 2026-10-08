import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-mg-border/50 text-mg-text',
  primary: 'bg-mg-primary/15 text-mg-primary',
  success: 'bg-mg-success/15 text-mg-success',
  warning: 'bg-mg-warning/15 text-mg-warning',
  danger: 'bg-mg-danger/15 text-mg-danger',
};

export function Badge({ className, tone = 'neutral', children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
