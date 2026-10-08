import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSRF_COOKIE_NAME, fetchApi, getCsrfToken } from './apiClient';

function lastHeaders(spy: ReturnType<typeof vi.fn>): Headers {
  const init = spy.mock.calls.at(-1)?.[1] as RequestInit;
  return new Headers(init.headers);
}

describe('fetchApi', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    // `__Host-` cookies need `secure` (jsdom enforces the prefix rules like a browser).
    document.cookie = `${CSRF_COOKIE_NAME}=tok%2Fen+1; path=/; secure`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; secure; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  });

  it('reads the CSRF token from the __Host-mgate_csrf cookie', () => {
    expect(CSRF_COOKIE_NAME).toBe('__Host-mgate_csrf');
    expect(getCsrfToken()).toBe('tok/en+1');
  });

  it('ignores the old unprefixed cookie name', () => {
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; secure; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    document.cookie = 'mgate_csrf=old; path=/';
    try {
      expect(getCsrfToken()).toBeUndefined();
    } finally {
      document.cookie = 'mgate_csrf=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])('adds X-CSRF-Token to %s', async (method) => {
    await fetchApi('/api/v1/admin/settings', { method });
    expect(lastHeaders(fetchSpy).get('X-CSRF-Token')).toBe('tok/en+1');
  });

  it.each([undefined, 'GET', 'HEAD'])('does not add the token to %s', async (method) => {
    await fetchApi('/api/v1/admin/settings', method ? { method } : {});
    expect(lastHeaders(fetchSpy).has('X-CSRF-Token')).toBe(false);
  });

  it('keeps caller headers and always sends credentials', async () => {
    await fetchApi('/x', { method: 'PUT', headers: { 'Content-Type': 'application/json' } });
    const init = fetchSpy.mock.calls.at(-1)?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(init.credentials).toBe('include');
  });
});
