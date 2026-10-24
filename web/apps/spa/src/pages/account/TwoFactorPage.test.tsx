import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../i18n';
import { TwoFactorPage } from './TwoFactorPage';

// jsdom/Node cannot build a `Request` for a relative URL (browsers resolve it against the page).
vi.mock('../../lib/runtimeConfig', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRuntimeConfig: () => ({ apiBaseUrl: 'http://localhost' }),
}));

let enabled = false;
const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? new URL(input.url, 'http://localhost').pathname : String(input);
  const method = input instanceof Request ? input.method : (init?.method ?? 'GET').toUpperCase();

  if (url.includes('/api/v1/account/2fa/verify') && method === 'POST') {
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (url.includes('/api/v1/account/2fa') && method === 'POST') {
    return new Response(
      JSON.stringify({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauth_uri: 'otpauth://totp/MGate:user@example.com?secret=JBSWY3DPEHPK3PXP',
        recovery_codes: ['ABCD-1234', 'EFGH-5678'],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (url.includes('/api/v1/account/2fa') && method === 'DELETE') {
    enabled = false;
    return new Response(null, { status: 204 });
  }

  return new Response(JSON.stringify({ enabled }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

function respondWith(value: boolean) {
  enabled = value;
  vi.stubGlobal('fetch', fetchSpy);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TwoFactorPage />
    </QueryClientProvider>,
  );
}

describe('TwoFactorPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ru');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders disabled state and offers enrollment', async () => {
    respondWith(false);
    renderPage();
    expect(await screen.findByText('Отключена')).toBeInTheDocument();
    expect(screen.getByText(/Двухфакторная аутентификация опциональна/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Включить 2FA' })).toBeInTheDocument();
  });

  it('starts enrollment flow when button is clicked', async () => {
    respondWith(false);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Включить 2FA' });
    fireEvent.click(btn);

    expect(await screen.findByText('Настройка двухфакторной аутентификации')).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByText('ABCD-1234')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('000000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подтвердить и включить' })).toBeInTheDocument();
  });

  it('renders active state and allows disabling 2FA', async () => {
    respondWith(true);
    renderPage();
    expect(await screen.findByText('Включена')).toBeInTheDocument();
    expect(screen.getByText('2FA активна')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отключить 2FA' })).toBeInTheDocument();
  });
});
