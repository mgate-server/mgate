import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
}

export function Card({ className, title, actions, children, ...rest }: CardProps) {
  return (
    <div
      className={cn('border-mg-border bg-mg-surface rounded-lg border p-4 shadow-sm', className)}
      {...rest}
    >
      {title || actions ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h3 className="text-mg-text text-sm font-semibold">{title}</h3> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}
