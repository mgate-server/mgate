import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mailApi } from './mailApi';

/** Server frame: `connected`, `ping`, `mailbox_changed`, `session_expired`. */
export interface PushFrame {
  type: string;
  folder?: string;
}

/** Close code the gateway uses when the web session behind the socket is gone. */
export const WS_CLOSE_SESSION_EXPIRED = 4401;

export function parsePushFrame(data: unknown): PushFrame | null {
  if (typeof data !== 'string') return null;
  try {
    const v: unknown = JSON.parse(data);
    if (v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string') {
      return v as PushFrame;
    }
  } catch {
    // Ignore malformed frames.
  }
  return null;
}

/** Reconnect delay: 1 s doubling up to 30 s, with up to 25% jitter. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 + random() * 0.25));
}

export interface UseMailPushOptions {
  /** Turn the channel off (for example when the mailbox is unavailable). */
  enabled?: boolean;
  /** Called once when the server reports that the session has ended. */
  onSessionExpired?: () => void;
  /** Test seam. */
  createSocket?: (url: string) => WebSocket;
}

/**
 * Keeps one WebSocket to the gateway and refreshes the folder list and message lists when the
 * mailbox changes. The 30 s folder poll in the layout stays as a fallback, so a dead socket only
 * costs latency. Reconnects with backoff; stops for good when the session has expired.
 */
export function useMailPush({
  enabled = true,
  onSessionExpired,
  createSocket,
}: UseMailPushOptions = {}): void {
  const queryClient = useQueryClient();
  const expiredRef = useRef(onSessionExpired);
  useEffect(() => {
    expiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['mail', 'folders'] });
      void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] });
    };

    const expire = () => {
      stopped = true;
      expiredRef.current?.();
    };

    const connect = () => {
      if (stopped) return;
      let ws: WebSocket;
      try {
        const url = mailApi.wsUrl();
        ws = createSocket ? createSocket(url) : new WebSocket(url);
      } catch {
        schedule();
        return;
      }
      socket = ws;
      ws.onmessage = (ev: MessageEvent) => {
        const frame = parsePushFrame(ev.data);
        if (!frame) return;
        if (frame.type === 'connected') attempt = 0;
        else if (frame.type === 'mailbox_changed') refresh();
        else if (frame.type === 'session_expired') expire();
      };
      ws.onclose = (ev: CloseEvent) => {
        socket = null;
        if (stopped) return;
        if (ev.code === WS_CLOSE_SESSION_EXPIRED) {
          expire();
          return;
        }
        schedule();
      };
      ws.onerror = () => {
        // `close` follows; reconnect is handled there.
      };
    };

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(connect, backoffDelay(attempt));
      attempt += 1;
    };

    connect();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (socket) {
        socket.onclose = null;
        socket.onmessage = null;
        socket.close();
      }
    };
  }, [enabled, queryClient, createSocket]);
}
