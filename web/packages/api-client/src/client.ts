import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './generated/schema';

/** Normalized shape every failed call rejects with, regardless of transport vs. HTTP failure. */
export interface ApiClientError {
  kind: 'http' | 'network' | 'parse';
  status?: number;
  code?: string;
  message: string;
  requestId?: string;
}

export class ApiError extends Error implements ApiClientError {
  readonly kind: ApiClientError['kind'];
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(info: ApiClientError) {
    super(info.message);
    this.name = 'ApiError';
    this.kind = info.kind;
    this.status = info.status;
    this.code = info.code;
    this.requestId = info.requestId;
  }
}

/**
 * Non-HttpOnly cookie name the API sets on session start so the SPA can read it and echo it back
 * (`__Host-`: accepted by the browser only from this exact host — Secure, Path=/, no Domain).
 */
const CSRF_COOKIE_NAME = '__Host-mgate_csrf';
/** Header the client must set to the current CSRF cookie value. */
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/** Reads the CSRF token the API sets as a readable (non-HttpOnly) cookie on session start. */
function readCsrfCookie(): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    const token = readCsrfCookie();
    if (token && request.method !== 'GET' && request.method !== 'HEAD') {
      request.headers.set(CSRF_HEADER_NAME, token);
    }
    return request;
  },
  async onResponse({ response }) {
    if (response.ok) return response;

    let code: string | undefined;
    let message = response.statusText || 'Request failed';
    let requestId: string | undefined;
    try {
      // Public API error envelope: `{"error": {code, message,
      // request_id, details}}` — every `/api/v1/*` failure (including 501 stubs) uses this
      // shape, so this is the one place that needs to know about it.
      const body = (await response.clone().json()) as {
        error?: { code?: string; message?: string; request_id?: string };
      };
      code = body.error?.code;
      message = body.error?.message ?? message;
      requestId = body.error?.request_id ?? undefined;
    } catch {
      // Body wasn't JSON (e.g. an upstream 502 from Traefik) — keep the statusText fallback.
    }
    throw new ApiError({ kind: 'http', status: response.status, code, message, requestId });
  },
};

export interface CreateApiClientOptions {
  /** Defaults to '' (same origin): the generated `paths` already carry the full `/api/v1/...`
   * prefix (mirroring `mgate openapi`'s output), matching the Vite dev proxy (`/api` ->
   * `127.0.0.1:8080`) and production same-origin serving alike. */
  baseUrl?: string;
}

/**
 * Creates the typed fetch client for the public API (`/api/v1/*`).
 * Credentials are always included (session cookie); mutating requests carry the CSRF header.
 * Call sites should catch `ApiError` specifically to render a normalized error message.
 */
export function createApiClient(options: CreateApiClientOptions = {}) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? '',
    credentials: 'include',
  });
  client.use(csrfMiddleware);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;
