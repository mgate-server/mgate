import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { backoffDelay, parsePushFrame, useMailPush, WS_CLOSE_SESSION_EXPIRED } from './useMailPush';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(frame: unknown) {
    this.onmessage?.({
      data: typeof frame === 'string' ? frame : JSON.stringify(frame),
    } as MessageEvent);
  }
  drop(code = 1006) {
    this.onclose?.({ code } as CloseEvent);
  }
}

function setup(opts: Parameters<typeof useMailPush>[0] = {}) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const createSocket = (url: string) => new FakeSocket(url) as unknown as WebSocket;
  const hook = renderHook(() => useMailPush({ createSocket, ...opts }), { wrapper });
  return { ...hook, invalidate, sockets: FakeSocket.instances };
}

describe('useMailPush', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('connects to the mail socket on the same origin', () => {
    const { sockets } = setup();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe(`ws://${window.location.host}/api/v1/mail/ws`);
  });

  it('refreshes folders and message lists on mailbox_changed, ignores other frames', () => {
    const { sockets, invalidate } = setup();
    const ws = sockets[0]!;
    ws.emit({ type: 'connected' });
    ws.emit({ type: 'ping' });
    ws.emit('not json');
    expect(invalidate).not.toHaveBeenCalled();

    ws.emit({ type: 'mailbox_changed', folder: 'inbox' });
    const keys = invalidate.mock.calls.map((c) =>
      (c[0] as { queryKey: string[] }).queryKey.join('/'),
    );
    expect(keys).toEqual(['mail/folders', 'mail/messages']);
  });

  it('reports an expired session once and does not reconnect', () => {
    const onSessionExpired = vi.fn();
    const { sockets } = setup({ onSessionExpired });
    sockets[0]!.emit({ type: 'session_expired' });
    sockets[0]!.drop(WS_CLOSE_SESSION_EXPIRED);
    vi.advanceTimersByTime(120_000);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
  });

  it('treats close code 4401 as an expired session', () => {
    const onSessionExpired = vi.fn();
    const { sockets } = setup({ onSessionExpired });
    sockets[0]!.drop(WS_CLOSE_SESSION_EXPIRED);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
  });

  it('reconnects with a growing delay after a dropped connection', () => {
    const { sockets } = setup();
    sockets[0]!.drop();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(2);
    sockets[1]!.drop();
    vi.advanceTimersByTime(1500); // second delay is ~2 s: not yet
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(3);
  });

  it('resets the backoff once the server says connected', () => {
    const { sockets } = setup();
    sockets[0]!.drop();
    vi.advanceTimersByTime(1500);
    sockets[1]!.drop();
    vi.advanceTimersByTime(2600);
    sockets[2]!.emit({ type: 'connected' });
    sockets[2]!.drop();
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(4);
  });

  it('closes the socket and stops reconnecting on unmount', () => {
    const { sockets, unmount } = setup();
    sockets[0]!.drop();
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);

    const second = setup();
    second.unmount();
    expect(FakeSocket.instances.at(-1)!.closed).toBe(true);
  });

  it('does nothing while disabled', () => {
    const { sockets } = setup({ enabled: false });
    expect(sockets).toHaveLength(0);
  });
});

describe('push helpers', () => {
  it('parses only well-formed frames', () => {
    expect(parsePushFrame('{"type":"ping"}')).toEqual({ type: 'ping' });
    expect(parsePushFrame('{"nope":1}')).toBeNull();
    expect(parsePushFrame('x')).toBeNull();
    expect(parsePushFrame(new ArrayBuffer(1))).toBeNull();
  });

  it('caps the reconnect delay at 30 s (+25% jitter)', () => {
    expect(backoffDelay(0, () => 0)).toBe(1000);
    expect(backoffDelay(3, () => 0)).toBe(8000);
    expect(backoffDelay(20, () => 1)).toBe(37_500);
  });
});
