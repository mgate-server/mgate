import { createApiClient, type ApiClient } from '@mgate/api-client';
import { getRuntimeConfig } from './runtimeConfig';

let client: ApiClient | null = null;

function getOrCreateClient(): ApiClient {
  // Reads whatever `getRuntimeConfig()` returns at the moment of the *first* actual API call,
  // not at module-load time — `main.tsx` awaits `loadRuntimeConfig()` before rendering the app,
  // so by the time any page fires a request the real `apiBaseUrl` from `/config.json` (or the
  // '' same-origin default) is already cached. This keeps the SPA host-agnostic: the same built
  // image works behind any hostname/reverse-proxy layout without a rebuild.
  client ??= createApiClient({ baseUrl: getRuntimeConfig().apiBaseUrl });
  return client;
}

/**
 * Single shared client for `/api/v1/*` calls. Exported as a stable object (not a factory) so
 * existing call sites keep doing `import { apiClient } from '...'; apiClient.GET(...)` — the
 * underlying `openapi-fetch` client is created lazily on first use via the Proxy below.
 */
export const apiClient: ApiClient = new Proxy({} as ApiClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getOrCreateClient(), prop, receiver);
  },
});

/**
 * Readable (non-HttpOnly) cookie the API sets at login; its value goes back in `X-CSRF-Token`.
 * The `__Host-` prefix means the browser only accepts it from this exact host (Secure, Path=/,
 * no Domain), so a sibling host of the same site cannot plant its own copy.
 */
export const CSRF_COOKIE_NAME = '__Host-mgate_csrf';

export function getCsrfToken(): string | undefined {
  const match = document.cookie.match(/(?:^|;\s*)__Host-mgate_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export async function fetchApi(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getCsrfToken();
  if (token && init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    headers.set('X-CSRF-Token', token);
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? 'include',
  });
}
