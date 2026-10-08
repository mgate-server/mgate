import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../i18n';
import { CSRF_COOKIE_NAME } from '../../lib/apiClient';
import { AdminSettingsPage } from './AdminSettingsPage';

// jsdom/Node cannot build a `Request` for a relative URL (browsers resolve it against the page).
vi.mock('../../lib/runtimeConfig', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRuntimeConfig: () => ({ apiBaseUrl: 'http://localhost' }),
}));

interface Call {
  url: string;
  method: string;
  csrf: string | null;
}

/** The generated API client passes a `Request`, `fetchApi` passes `(url, init)`: normalise both. */
function describeCall(input: unknown, init?: RequestInit): Call {
  if (input instanceof Request) {
    return {
      url: new URL(input.url).pathname,
      method: input.method,
      csrf: input.headers.get('X-CSRF-Token'),
    };
  }
  return {
    url: String(input),
    method: (init?.method ?? 'GET').toUpperCase(),
    csrf: new Headers(init?.headers).get('X-CSRF-Token'),
  };
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AdminSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminSettingsPage CSRF', () => {
  const calls: Call[] = [];
  const fetchSpy = vi.fn(async (input: unknown, init?: RequestInit) => {
    const call = describeCall(input, init);
    calls.push(call);
    if (call.url === '/api/v1/system/entitlements') {
      return new Response(JSON.stringify({ edition: 'pro', features: ['pro.branding'] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (call.url === '/api/v1/pro/branding' && call.method === 'GET') {
      return new Response(JSON.stringify({ product_name: 'MGate' }));
    }
    if (call.method === 'PUT') {
      return new Response(JSON.stringify({}));
    }
    return new Response(JSON.stringify({}));
  });

  beforeEach(async () => {
    await i18n.changeLanguage('ru');
    calls.length = 0;
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-xyz; path=/; secure`;
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; secure; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  });

  it('saves general settings with the CSRF header', async () => {
    const user = userEvent.setup();
    renderAt('/admin/settings');
    await user.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url === '/api/v1/admin/settings');
      expect(put?.csrf).toBe('csrf-xyz');
    });
  });

  it('saves branding with the CSRF header', async () => {
    const user = userEvent.setup();
    renderAt('/admin/settings?tab=white-label');
    const save = await screen.findByRole('button', { name: /Сохранить настройки White-Label/ });
    await user.click(save);
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url === '/api/v1/pro/branding');
      expect(put?.csrf).toBe('csrf-xyz');
    });
  });
});
