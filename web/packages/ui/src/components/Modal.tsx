import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
  showCloseButton?: boolean;
}

const sizeClasses: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  full: 'max-w-[95vw]',
};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  size = 'lg',
  showCloseButton = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-hidden animate-in fade-in duration-150">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'border-mg-border bg-mg-surface relative z-10 w-full rounded-xl border shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)] overflow-hidden',
          sizeClasses[size] || 'max-w-lg',
          className,
        )}
      >
        {title ? (
          <div className="flex items-center justify-between border-b border-mg-border px-5 py-3.5 shrink-0 bg-mg-surface-raised/40">
            <h2 className="text-mg-text text-base sm:text-lg font-semibold truncate pr-2">{title}</h2>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-raised rounded-lg p-1.5 transition-colors focus:outline-none focus:ring-1 focus:ring-mg-primary"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}
          </div>
        ) : showCloseButton ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-raised rounded-lg p-1.5 transition-colors focus:outline-none z-20"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        ) : null}

        <div className="text-mg-text text-sm flex-1 overflow-y-auto min-h-0 p-5 overscroll-contain">
          {children}
        </div>

        {footer ? (
          <div className="border-t border-mg-border px-5 py-3 shrink-0 bg-mg-surface-raised/40 flex justify-end gap-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
