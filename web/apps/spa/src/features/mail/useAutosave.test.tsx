import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './useAutosave';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves every interval, but only while there are edits', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ save, intervalMs: 10_000 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(save).not.toHaveBeenCalled();

    act(() => result.current.markDirty());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('saved');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never runs two saves at once and picks up edits made meanwhile', async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ save }));

    act(() => result.current.markDirty());
    let done = false;
    let flushing: Promise<boolean>;
    act(() => {
      flushing = result.current.flush();
      void flushing.then(() => (done = true));
    });
    expect(save).toHaveBeenCalledTimes(1);

    act(() => result.current.markDirty()); // edit while the first save is in flight
    let second: Promise<boolean>;
    act(() => {
      second = result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1); // still serialised

    await act(async () => {
      first.resolve();
      await flushing;
      await second;
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(done).toBe(true);
  });

  it('marks the form dirty again and reports failure when a save fails', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ save }));

    act(() => result.current.markDirty());
    let ok = true;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(false);
    expect(result.current.phase).toBe('error');
    expect(result.current.isDirty()).toBe(true);

    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(result.current.phase).toBe('saved');
  });

  it('saves once more when the form is left', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave({ save }));
    act(() => result.current.markDirty());
    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not save on leave after it was disabled (sent or discarded)', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave({ save }));
    act(() => result.current.markDirty());
    act(() => result.current.setDisabled(true));
    unmount();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(save).not.toHaveBeenCalled();
  });

  it('saves when the tab is hidden', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ save }));
    act(() => result.current.markDirty());
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('settle() waits for a running save without starting another', async () => {
    const running = deferred();
    const save = vi.fn().mockReturnValue(running.promise);
    const { result } = renderHook(() => useAutosave({ save }));
    act(() => result.current.markDirty());
    act(() => {
      void result.current.flush();
    });
    let settled = false;
    act(() => {
      void result.current.settle().then(() => (settled = true));
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await act(async () => {
      running.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(settled).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
