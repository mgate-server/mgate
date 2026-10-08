import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import i18n from '../../i18n';
import {
  apiError,
  installFetchMock,
  jsonResponse,
  renderRoutes,
  setCsrfCookie,
} from '../../features/mail/testUtils';
import { MailLayout } from './MailLayout';

const logout = vi.fn();
let isAdmin = false;
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'u1', email: 'alice@example.com', role: 'User', domainId: null },
    logout,
    hasAtLeastRole: () => isAdmin,
  }),
}));
vi.mock('./TopBar', () => ({ TopBar: () => <div data-testid="topbar" /> }));

const pushSpy = vi.fn();
vi.mock('../../features/mail/useMailPush', () => ({
  useMailPush: (opts: unknown) => pushSpy(opts),
}));

const FOLDERS = [
  { id: 'trash', name: 'Trash', role: 'trash', unread_count: 0, total_count: 4 },
  { id: 'inbox', name: 'INBOX', role: 'inbox', unread_count: 3, total_count: 20 },
  { id: 'sent', name: 'Sent Messages', role: 'sent', unread_count: 0, total_count: 9 },
  { id: 'drafts', name: 'Drafts', role: 'drafts', unread_count: 0, total_count: 2 },
  { id: 'f-0J_Qn9GA', name: 'Проекты', role: 'custom', unread_count: 1, total_count: 5 },
];

function renderLayout() {
  return renderRoutes(
    <Route path="/mail" element={<MailLayout />}>
      <Route path=":folderId" element={<div data-testid="outlet">child</div>} />
    </Route>,
    '/mail/inbox',
  );
}

describe('MailLayout', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });
  beforeEach(() => {
    logout.mockReset();
    pushSpy.mockReset();
    isAdmin = false;
    setCsrfCookie('csrf-1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfCookie(null);
  });

  it('names folders by role through i18n, keeps custom names and shows counts', async () => {
    installFetchMock({
      'GET /api/v1/mail/folders': FOLDERS,
      'GET /api/v1/account/quota': { used_bytes: 1, quota_bytes: 100 },
    });
    renderLayout();

    expect(await screen.findByText('Проекты')).toBeInTheDocument();
    expect(screen.getByText('Отправленные')).toBeInTheDocument();
    expect(screen.getByText('Входящие')).toBeInTheDocument();
    expect(screen.getByText('Корзина')).toBeInTheDocument();
    expect(screen.queryByText('Sent Messages')).not.toBeInTheDocument();
    expect(screen.queryByText('INBOX')).not.toBeInTheDocument();

    // system folders first, in a fixed order; custom last
    const labels = screen.getAllByRole('link').map((a) => a.textContent ?? '');
    const order = ['Входящие', 'Отправленные', 'Черновики', 'Корзина', 'Проекты'];
    const positions = order.map((name) => labels.findIndex((l) => l.includes(name)));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);

    // unread badge on the inbox, total on drafts, nothing on read folders
    expect(screen.getByRole('link', { name: /Входящие/ })).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: /Черновики/ })).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: /Отправленные/ })).not.toHaveTextContent('9');
  });

  describe('folder management', () => {
    const routes = (extra: Record<string, unknown> = {}) => ({
      'GET /api/v1/mail/folders': FOLDERS,
      'GET /api/v1/account/quota': { used_bytes: 1, quota_bytes: 100 },
      ...extra,
    });
    const openManager = async () => {
      await screen.findByText('Проекты');
      await userEvent.click(screen.getByRole('button', { name: 'Управление папками' }));
      return screen.findByRole('dialog');
    };

    it('creates a folder', async () => {
      const mock = installFetchMock(
        routes({
          'POST /api/v1/mail/folders': () =>
            jsonResponse(
              { id: 'f-new', name: 'Клиенты', role: 'custom', unread_count: 0, total_count: 0 },
              201,
            ),
        }),
      );
      renderLayout();
      const dialog = await openManager();
      await userEvent.type(within(dialog).getByLabelText('Новая папка'), '  Клиенты ');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/folders')).toHaveLength(1));
      const post = mock.find('POST', '/api/v1/mail/folders')[0]!;
      expect(post.body).toEqual({ name: 'Клиенты' });
      expect(post.headers.get('X-CSRF-Token')).toBe('csrf-1');
    });

    it('protects system folders: only custom ones can be renamed or deleted', async () => {
      installFetchMock(routes());
      renderLayout();
      const dialog = await openManager();
      expect(within(dialog).getAllByText('системная').length).toBe(4);
      expect(
        within(dialog).getByRole('button', { name: 'Переименовать папку Проекты' }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', { name: 'Удалить папку Проекты' }),
      ).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: /папку INBOX/ })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: /папку Trash/ })).not.toBeInTheDocument();
    });

    it('renames a custom folder', async () => {
      const mock = installFetchMock(
        routes({
          'PATCH /api/v1/mail/folders/*': () => ({
            id: 'f-renamed',
            name: 'Работа',
            role: 'custom',
            unread_count: 0,
            total_count: 5,
          }),
        }),
      );
      renderLayout();
      const dialog = await openManager();
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Переименовать папку Проекты' }),
      );
      const input = within(dialog).getByLabelText('Переименовать папку Проекты');
      await userEvent.clear(input);
      await userEvent.type(input, 'Работа');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
      await waitFor(() =>
        expect(mock.find('PATCH', '/api/v1/mail/folders/f-0J_Qn9GA')).toHaveLength(1),
      );
      expect(mock.find('PATCH', '/api/v1/mail/folders/f-0J_Qn9GA')[0]!.body).toEqual({
        name: 'Работа',
      });
    });

    it('deletes a custom folder only after confirmation', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
      const mock = installFetchMock(routes({ 'DELETE /api/v1/mail/folders/*': () => undefined }));
      renderLayout();
      const dialog = await openManager();
      const del = within(dialog).getByRole('button', { name: 'Удалить папку Проекты' });
      await userEvent.click(del);
      expect(mock.find('DELETE', '/api/v1/mail/folders/f-0J_Qn9GA')).toHaveLength(0);

      confirm.mockReturnValueOnce(true);
      await userEvent.click(del);
      await waitFor(() =>
        expect(mock.find('DELETE', '/api/v1/mail/folders/f-0J_Qn9GA')).toHaveLength(1),
      );
      confirm.mockRestore();
    });

    it('shows the server refusal for a system folder', async () => {
      installFetchMock(
        routes({
          'POST /api/v1/mail/folders': () => apiError(409, 'conflict', { reason: 'system_folder' }),
        }),
      );
      renderLayout();
      const dialog = await openManager();
      await userEvent.type(within(dialog).getByLabelText('Новая папка'), 'Trash');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Системную папку нельзя изменить или удалить.',
      );
    });
  });

  it('starts the live-update channel for a normal mailbox session', async () => {
    installFetchMock({
      'GET /api/v1/mail/folders': FOLDERS,
      'GET /api/v1/account/quota': { used_bytes: 0, quota_bytes: 1 },
    });
    renderLayout();
    await screen.findByText('Входящие');
    expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('shows the "mailboxes only" screen to an administrator session (403 webmail_requires_mailbox)', async () => {
    isAdmin = true;
    const mock = installFetchMock({
      'GET /api/v1/mail/folders': () => apiError(403, 'webmail_requires_mailbox'),
    });
    renderLayout();

    expect(await screen.findByTestId('mail-unavailable')).toBeInTheDocument();
    expect(screen.getByText('Веб-почта доступна только для почтовых ящиков')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(screen.queryByText('Написать')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /панел/i })).toHaveAttribute('href', '/admin');

    // no pointless retries / quota calls / socket for a session that can never use webmail
    await waitFor(() =>
      expect(pushSpy).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false })),
    );
    expect(mock.calls.filter((c) => c.url.pathname === '/api/v1/mail/folders')).toHaveLength(1);
    expect(mock.calls.some((c) => c.url.pathname === '/api/v1/account/quota')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('explains a disabled mailbox', async () => {
    installFetchMock({ 'GET /api/v1/mail/folders': () => apiError(403, 'mailbox_disabled') });
    renderLayout();
    expect(await screen.findByText('Почтовый ящик отключён')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /панел/i })).not.toBeInTheDocument();
  });

  it('signs out when the session has been revoked (401)', async () => {
    installFetchMock({ 'GET /api/v1/mail/folders': () => apiError(401, 'unauthorized') });
    renderLayout();
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it('signs out when the push channel reports an expired session', async () => {
    installFetchMock({
      'GET /api/v1/mail/folders': FOLDERS,
      'GET /api/v1/account/quota': { used_bytes: 0, quota_bytes: 1 },
    });
    renderLayout();
    await screen.findByText('Входящие');
    const opts = pushSpy.mock.calls.at(-1)![0] as { onSessionExpired: () => void };
    opts.onSessionExpired();
    expect(logout).toHaveBeenCalled();
  });
});
