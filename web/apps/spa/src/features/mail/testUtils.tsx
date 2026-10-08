import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '@mgate/ui';
import { CSRF_COOKIE_NAME } from '../../lib/apiClient';
import type { MessageDetail, MessageSummary } from './types';

/** One request seen by the fetch mock. */
export interface RecordedCall {
  method: string;
  url: URL;
  headers: Headers;
  /** Parsed JSON body, raw string, or the Blob/File that was sent. */
  body: unknown;
}

type HandlerResult = Response | object | undefined | null;
export type Handler = (call: RecordedCall) => HandlerResult | Promise<HandlerResult>;

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function apiError(
  status: number,
  code: string,
  details?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return jsonResponse(
    { error: { code, message: 'сообщение сервера', request_id: 'req-1', details } },
    status,
    headers,
  );
}

/** Single shared mock: `openapi-fetch` keeps the first `fetch` it sees, so it must never change. */
const fetchMock = vi.fn();

function matches(pattern: string, method: string, path: string): boolean {
  const [pm, pp] = pattern.split(' ');
  if (pm !== method) return false;
  const escaped = (pp ?? '').replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // `**` matches any path tail, `*` a single segment.
  const body = escaped.replace(/\*\*|\*/g, (m) => (m === '**' ? '.*' : '[^/]+'));
  const re = new RegExp(`^${body}$`);
  return re.test(path);
}

/**
 * Routes `fetch` by `"METHOD /path"` (a `*` matches one path segment). A handler may return a
 * `Response`, or any object (sent as 200 JSON); `undefined` gives 204. Unknown routes get 404.
 */
export function installFetchMock(
  routes: Record<string, Handler | Exclude<HandlerResult, undefined>>,
) {
  const calls: RecordedCall[] = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), 'http://localhost');
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers ?? request?.headers);
    let body: unknown = init.body ?? undefined;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // keep the raw string (text/plain imports)
      }
    }
    const call: RecordedCall = { method, url, headers, body };
    calls.push(call);
    const key = Object.keys(routes).find((k) => matches(k, method, url.pathname));
    if (!key) return apiError(404, 'not_found');
    const route = routes[key]!;
    const result = typeof route === 'function' ? await route(call) : route;
    if (result instanceof Response) return result;
    if (result === undefined || result === null) return new Response(null, { status: 204 });
    return jsonResponse(result);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    find: (method: string, path: string) =>
      calls.filter((c) => c.method === method && c.url.pathname === path),
  };
}

export function setCsrfCookie(token: string | null) {
  // `__Host-` cookies need `secure` (jsdom enforces the prefix rules like a browser).
  document.cookie = token
    ? `${CSRF_COOKIE_NAME}=${token}; path=/; secure`
    : `${CSRF_COOKIE_NAME}=; path=/; secure; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// Test-only helper component; Fast Refresh does not apply here.
// eslint-disable-next-line react-refresh/only-export-components
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.search}</output>;
}

/** Renders route definitions at `route` with query client, router, toasts and a location probe. */
export function renderRoutes(routes: ReactNode, route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const result = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            {routes}
            <Route path="*" element={null} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

/** Renders `ui` at `route` (matching `path`). */
export function renderAt(ui: ReactElement, opts: { route: string; path: string }) {
  return renderRoutes(<Route path={opts.path} element={ui} />, opts.route);
}

export const ME = { email: 'alice@example.com' };

export function mkSummary(n: number, over: Partial<MessageSummary> = {}) {
  return {
    id: `inbox.1.${n}`,
    folder: 'inbox',
    from: `Sender ${n} <s${n}@example.org>`,
    to: ['alice@example.com'],
    subject: `Subject ${n}`,
    preview: `Preview text ${n}`,
    date: '2026-10-01T10:00:00Z',
    read: true,
    flagged: false,
    has_attachments: false,
    thread_count: 1,
    thread_id: null,
    ...over,
  };
}

export function mkDetail(n: number, over: Partial<MessageDetail> = {}) {
  return {
    id: `inbox.1.${n}`,
    folder: 'inbox',
    from: `Sender ${n} <s${n}@example.org>`,
    to: ['alice@example.com'],
    cc: [],
    subject: `Subject ${n}`,
    date: '2026-10-01T10:00:00Z',
    read: false,
    flagged: false,
    authentication_results: null,
    html: null,
    text: `Body of message ${n}`,
    attachments: [],
    message_id: `<m${n}@example.org>`,
    in_reply_to: null,
    ...over,
  };
}

export const DEFAULT_FOLDERS = [
  { id: 'inbox', name: 'INBOX', role: 'inbox', unread_count: 0, total_count: 3 },
  { id: 'sent', name: 'Sent Messages', role: 'sent', unread_count: 0, total_count: 1 },
  { id: 'drafts', name: 'Drafts', role: 'drafts', unread_count: 0, total_count: 1 },
  { id: 'trash', name: 'Trash', role: 'trash', unread_count: 0, total_count: 1 },
  { id: 'archive', name: 'Archive', role: 'archive', unread_count: 0, total_count: 0 },
  { id: 'f-0J_Qn9GA', name: 'Проекты', role: 'custom', unread_count: 0, total_count: 2 },
];
