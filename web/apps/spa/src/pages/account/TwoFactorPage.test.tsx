import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../i18n';
import { TwoFactorPage } from './TwoFactorPage';

// jsdom/Node cannot build a `Request` for a relative URL (browsers resolve it against the page).
vi.mock('../../lib/runtimeConfig', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRuntimeConfig: () => ({ apiBaseUrl: 'http://localhost' }),
}));

// The generated API client captures `fetch` when it is first used, so one spy is shared by all
// tests and only its answer changes.
let enabled = false;
const fetchSpy = vi.fn(
  async () =>
    new Response(JSON.stringify({ enabled }), { headers: { 'Content-Type': 'application/json' } }),
);

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

describe('TwoFactorPage (2FA is in development)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ru');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('explains that 2FA is in development and offers no enrolment', async () => {
    respondWith(false);
    renderPage();
    expect(screen.getByText('В разработке')).toBeInTheDocument();
    expect(screen.getByText(/не запрашивается и не проверяется/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Включить/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('000000')).not.toBeInTheDocument();
    expect(screen.queryByText('Удалить секрет')).not.toBeInTheDocument();
  });

  it('lets the user remove a TOTP secret stored earlier, and says it is unused', async () => {
    respondWith(true);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Удалить секрет' })).toBeInTheDocument();
    expect(screen.getByText(/Он не используется при входе/)).toBeInTheDocument();
  });
});
