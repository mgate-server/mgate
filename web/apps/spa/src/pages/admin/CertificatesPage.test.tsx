import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../i18n';
import { CSRF_COOKIE_NAME } from '../../lib/apiClient';
import { CertificatesPage } from './CertificatesPage';
import { sourceLabel, statusTone } from './certificateLabels';

const ROWS = [
  {
    id: '1',
    name: 'default',
    sans: ['mail.example.com'],
    source: 'self_signed',
    status: 'valid',
    not_before: '2026-01-01T00:00:00Z',
    not_after: '2099-01-01T00:00:00Z',
    last_error: null,
  },
  {
    id: '2',
    name: 'corp',
    sans: ['corp.example.com'],
    source: 'uploaded',
    status: 'error',
    not_before: null,
    not_after: null,
    last_error: 'deploy failed: disk full',
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CertificatesPage />
    </QueryClientProvider>,
  );
}

describe('CertificatesPage', () => {
  const fetchSpy = vi.fn();

  beforeEach(async () => {
    await i18n.changeLanguage('ru');
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-123; path=/; secure`;
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; secure; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  });

  it('maps backend sources and statuses (uploaded / self_signed, error)', () => {
    const t = (_key: string, fallback: string) => fallback;
    expect(sourceLabel('uploaded', t)).toBe('Загруженный');
    expect(sourceLabel('self_signed', t)).toBe('Самоподписанный');
    expect(statusTone('error')).toBe('danger');
    expect(statusTone('failed')).toBe('neutral');
    expect(statusTone('expiring')).toBe('warning');
    expect(statusTone('valid')).toBe('success');
  });

  it('lists certificates, shows the last error and says that ACME is in development', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(ROWS)));
    renderPage();
    expect(await screen.findByText('corp')).toBeInTheDocument();
    expect(screen.getByText('Самоподписанный')).toBeInTheDocument();
    expect(screen.getByText('Загруженный')).toBeInTheDocument();
    expect(screen.getByText('deploy failed: disk full')).toBeInTheDocument();
    expect(screen.getByText(/Let’s Encrypt — в разработке/)).toBeInTheDocument();
  });

  it('uploads with the CSRF header and shows error.details.reason on 422', async () => {
    fetchSpy.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            error: {
              code: 'validation_failed',
              message: 'Ошибка валидации данных.',
              details: { reason: 'the private key does not match the certificate' },
            },
          }),
          { status: 422 },
        );
      }
      return new Response('[]');
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Загрузить сертификат' }));
    const [certArea, keyArea] = screen.getAllByPlaceholderText(/-----BEGIN/);
    await user.type(certArea!, 'CERT');
    await user.type(keyArea!, 'KEY');
    await user.click(screen.getByRole('button', { name: 'Загрузить' }));

    expect(
      await screen.findByText('the private key does not match the certificate'),
    ).toBeInTheDocument();

    await waitFor(() => {
      const post = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeTruthy();
      const init = post![1] as RequestInit;
      expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-123');
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ cert_pem: 'CERT', key_pem: 'KEY' });
      expect(body).not.toHaveProperty('name');
    });
  });
});
