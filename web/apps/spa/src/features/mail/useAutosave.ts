import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosavePhase = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveState {
  phase: AutosavePhase;
  savedAt: Date | null;
}

export interface UseAutosaveOptions {
  /** Persists the current form. Rejecting marks the form dirty again and flags `error`. */
  save: () => Promise<void>;
  intervalMs?: number;
}

export interface Autosave extends AutosaveState {
  /** Call after every user edit. */
  markDirty: () => void;
  /**
   * Waits for a running save and performs another one if edits are pending. Resolves `true`
   * when nothing unsaved remains, `false` if saving failed or autosave is switched off.
   */
  flush: () => Promise<boolean>;
  /** Waits for a save that is already running, without starting another. */
  settle: () => Promise<void>;
  /** Switches saving off (while sending; for good after a send or an explicit discard). */
  setDisabled: (disabled: boolean) => void;
  isDirty: () => boolean;
}

/**
 * Draft autosave: saves at most once at a time, every `intervalMs` while there are edits, when
 * the tab is hidden, and once more when the component unmounts ("leave"). Saves are serialised
 * because the server replaces the draft on every save and answers with a new id.
 */
export function useAutosave({ save, intervalMs = 10_000 }: UseAutosaveOptions): Autosave {
  const [state, setState] = useState<AutosaveState>({ phase: 'idle', savedAt: null });
  const dirtyRef = useRef(false);
  const disabledRef = useRef(false);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flush = useCallback(async (): Promise<boolean> => {
    for (;;) {
      const running = inflightRef.current;
      if (running) {
        if (!(await running)) return false;
        continue;
      }
      if (disabledRef.current) return false;
      if (!dirtyRef.current) return true;
      dirtyRef.current = false;
      setState((s) => ({ ...s, phase: 'saving' }));
      const p = (async () => {
        try {
          await saveRef.current();
          setState({ phase: 'saved', savedAt: new Date() });
          return true;
        } catch {
          dirtyRef.current = true;
          setState((s) => ({ ...s, phase: 'error' }));
          return false;
        }
      })();
      inflightRef.current = p;
      void p.then(() => {
        if (inflightRef.current === p) inflightRef.current = null;
      });
    }
  }, []);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setState((s) => (s.phase === 'saved' || s.phase === 'error' ? { ...s, phase: 'idle' } : s));
  }, []);

  const setDisabled = useCallback((disabled: boolean) => {
    disabledRef.current = disabled;
  }, []);

  const settle = useCallback(async () => {
    while (inflightRef.current) await inflightRef.current;
  }, []);

  const isDirty = useCallback(() => dirtyRef.current, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (dirtyRef.current && !inflightRef.current) void flush();
    }, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && dirtyRef.current) void flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      if (dirtyRef.current && !disabledRef.current) void flush();
    };
  }, [flush, intervalMs]);

  return { ...state, markDirty, flush, settle, setDisabled, isDirty };
}
