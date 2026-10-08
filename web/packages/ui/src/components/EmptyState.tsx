import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-mg-border flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center',
        className,
      )}
    >
      <h3 className="text-mg-text text-base font-semibold">{title}</h3>
      {description ? <p className="text-mg-text-muted max-w-md text-sm">{description}</p> : null}
      {action}
    </div>
  );
}
