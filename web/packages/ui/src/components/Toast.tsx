import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';
import type { BadgeTone } from './Badge';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: Extract<BadgeTone, 'success' | 'warning' | 'danger' | 'neutral'>;
  durationMs?: number;
}

interface ToastRecord extends ToastInput {
  id: string;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneClasses: Record<NonNullable<ToastInput['tone']>, string> = {
  neutral: 'border-mg-border',
  success: 'border-mg-success',
  warning: 'border-mg-warning',
  danger: 'border-mg-danger',
};

/** App-wide toast host. Wrap the SPA root once (see apps/spa/src/App.tsx). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, ...input }]);
      const duration = input.durationMs ?? 5000;
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={cn(
                'bg-mg-surface rounded-md border-l-4 p-3 shadow-md',
                toneClasses[t.tone ?? 'neutral'],
              )}
            >
              <p className="text-mg-text text-sm font-medium">{t.title}</p>
              {t.description ? <p className="text-mg-text-muted text-sm">{t.description}</p> : null}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
