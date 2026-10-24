import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UpdatesTab } from './UpdatesTab';
import { CSRF_COOKIE_NAME } from '../../lib/apiClient';
import i18n from '../../i18n';

const initial = {
  supported: true,
  current_version: '2026.9.9',
  latest_version: '2026.10.1',
  release_url: 'https://github.com/mgate-server/mgate/releases/tag/v2026.10.1',
  check_error: null,
  job: null,
};
const job = {
  id: 'operation-1',
  actor: 'admin',
  from_version: '2026.9.9',
  to_version: '2026.10.1',
  stage: 'backup',
  migration_started: false,
  started_at: 1,
  error: null,
  backup_path: null,
};

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <UpdatesTab />
    </QueryClientProvider>,
  );
  return client;
}

describe('UpdatesTab', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ru');
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-update; path=/; secure`;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; secure; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  });

  it('requires confirmation and sends the pinned version with CSRF exactly once', async () => {
    const posts: RequestInit[] = [];
    let current: object = initial;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(init);
          current = { ...initial, job };
          return new Response(JSON.stringify(job), { status: 202 });
        }
        return new Response(JSON.stringify(current));
      }),
    );
    const client = mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Обновить' }));
    expect(posts).toHaveLength(0);
    expect(screen.getByText(/Обновить до 2026.10.1/)).toBeInTheDocument();
    // Release metadata changes while the dialog is open: confirmation stays pinned.
    current = { ...initial, latest_version: '2026.10.2' };
    await client.invalidateQueries({ queryKey: ['admin', 'updates'] });
    await user.click(screen.getByRole('button', { name: 'Создать копию и обновить' }));
    await screen.findByText('Резервное копирование');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.body))).toEqual({ version: '2026.10.1' });
    expect(new Headers(posts[0]?.headers).get('X-CSRF-Token')).toBe('csrf-update');
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeDisabled();
  });

  it('cancelling confirmation never starts an operation', async () => {
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(initial)),
    );
    vi.stubGlobal('fetch', fetch);
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Обновить' }));
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(fetch.mock.calls.every((call) => !call[1]?.method || call[1].method === 'GET')).toBe(
      true,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('blocks unsupported installations and recovery states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...initial, supported: false }))),
    );
    const client = mount();
    await screen.findByText(/Обновление из панели доступно/);
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeDisabled();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...initial,
              job: {
                ...job,
                stage: 'recovery_required',
                error: 'Migration failed',
                backup_path: '/safe/backup',
              },
            }),
          ),
      ),
    );
    await client.invalidateQueries({ queryKey: ['admin', 'updates'] });
    await screen.findByText('Migration failed');
    expect(screen.getByText(/\/safe\/backup/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeDisabled();
  });

  it('retains progress through an API outage and reads the durable result after reconnecting', async () => {
    let offline = false;
    let finished = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (offline) throw new TypeError('network');
        return new Response(
          JSON.stringify({
            ...initial,
            job: { ...job, stage: finished ? 'succeeded' : 'starting' },
          }),
        );
      }),
    );
    const client = mount();
    await screen.findByText('Запуск сервисов');
    offline = true;
    await client.invalidateQueries({ queryKey: ['admin', 'updates'] });
    await screen.findByText(/Ожидаем восстановления связи/);
    expect(screen.getByText('Запуск сервисов')).toBeInTheDocument();
    offline = false;
    finished = true;
    await client.invalidateQueries({ queryKey: ['admin', 'updates'] });
    await screen.findByText('Обновление завершено');
    expect(screen.queryByText(/Ожидаем восстановления связи/)).not.toBeInTheDocument();
  });

  it('forces metadata refresh on an explicit check', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(initial));
      }),
    );
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Проверить обновления' }));
    await waitFor(() => expect(urls).toContain('/api/v1/admin/updates?refresh=true'));
  });

  it('does not retry a failed POST and recovers the operation via GET', async () => {
    let posted = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posted++;
          throw new TypeError('connection closed during restart');
        }
        return new Response(JSON.stringify(posted ? { ...initial, job } : initial));
      }),
    );
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Обновить' }));
    await user.click(screen.getByRole('button', { name: 'Создать копию и обновить' }));
    await screen.findByText('Резервное копирование');
    expect(posted).toBe(1);
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeDisabled();
  });
});
