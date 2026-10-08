import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-mg-primary text-mg-primary-fg shadow-xs hover:bg-mg-primary-hover active:scale-[0.98]',
  secondary:
    'bg-mg-surface text-mg-text border border-mg-border shadow-2xs hover:bg-mg-border/50 active:bg-mg-border/70',
  outline:
    'bg-transparent text-mg-text border border-mg-border hover:bg-mg-border/30 active:bg-mg-border/50',
  danger: 'bg-mg-danger text-mg-danger-fg shadow-xs hover:opacity-90 active:scale-[0.98]',
  ghost: 'bg-transparent text-mg-text hover:bg-mg-border/40 active:bg-mg-border/60',
};

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs rounded',
  sm: 'h-8 px-3 text-xs rounded-md',
  md: 'h-9 px-4 text-sm rounded-md',
  lg: 'h-11 px-6 text-base rounded-lg',
  icon: 'h-9 w-9 p-0 rounded-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    isLoading = false,
    loading = false,
    disabled,
    children,
    ...rest
  },
  ref,
) {
  const isBusy = isLoading || loading;
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || isBusy}
      aria-busy={isBusy || undefined}
      className={cn(
        'inline-flex cursor-pointer select-none items-center justify-center gap-2 font-medium transition-all',
        'focus-visible:ring-mg-focus-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {isBusy ? (
        <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
});
