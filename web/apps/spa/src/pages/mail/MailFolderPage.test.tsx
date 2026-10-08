import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import {
  DEFAULT_FOLDERS,
  apiError,
  installFetchMock,
  mkDetail,
  mkSummary,
  renderAt,
  setCsrfCookie,
  type Handler,
} from '../../features/mail/testUtils';
import { MailFolderPage } from './MailFolderPage';

const PATH = '/mail/:folderId/:messageId?';
const location = () => screen.getByTestId('location').textContent;

function page(from: number, count: number, total: number, pageNo: number) {
  return {
    messages: Array.from({ length: count }, (_, i) => mkSummary(from + i)),
    total,
    page: pageNo,
    per_page: 50,
  };
}

function baseRoutes(extra: Record<string, Handler | object> = {}) {
  return {
    'GET /api/v1/mail/folders': DEFAULT_FOLDERS,
    'GET /api/v1/mail/settings': {
      remote_images: 'ask',
      list_density: 'normal',
      mark_read_on_open: true,
    },
    'GET /api/v1/mail/messages': page(1, 3, 3, 1),
    ...extra,
  };
}

describe('MailFolderPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });
  beforeEach(() => setCsrfCookie('csrf-1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setCsrfCookie(null);
  });

  describe('list', () => {
    it('shows the localised folder name, never the raw folder id', async () => {
      installFetchMock(baseRoutes());
      const { unmount } = renderAt(<MailFolderPage />, { route: '/mail/sent', path: PATH });
      expect(await screen.findByText('Отправленные')).toBeInTheDocument();
      expect(screen.queryByText('sent')).not.toBeInTheDocument();
      unmount();

      installFetchMock(baseRoutes());
      renderAt(<MailFolderPage />, { route: '/mail/f-0J_Qn9GA', path: PATH });
      expect(await screen.findByText('Проекты')).toBeInTheDocument();
      expect(screen.queryByText('f-0J_Qn9GA')).not.toBeInTheDocument();
    });

    it('loads the next page with "show more" until everything is shown', async () => {
      const mock = installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/messages': (c) => {
            const p = Number(c.url.searchParams.get('page') ?? '1');
            return p === 1
              ? page(1, 50, 120, 1)
              : p === 2
                ? page(51, 50, 120, 2)
                : page(101, 20, 120, 3);
          },
        }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/inbox', path: PATH });

      expect(await screen.findByText('Subject 1')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(50);
      expect(screen.getByText(/120/)).toBeInTheDocument();
      expect(mock.calls[mock.calls.length - 1]!.url.searchParams.get('per_page')).toBe('50');

      await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
      expect(await screen.findByText('Subject 100')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(100);

      await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
      expect(await screen.findByText('Subject 120')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(120);
      expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();

      const pages = mock.calls
        .filter((c) => c.url.pathname === '/api/v1/mail/messages')
        .map((c) => c.url.searchParams.get('page'));
      expect(pages).toEqual(['1', '2', '3']);
    });

    it('does not show a message twice when new mail shifts the pages', async () => {
      installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/messages': (c) =>
            c.url.searchParams.get('page') === '2' ? page(50, 50, 100, 2) : page(1, 50, 100, 1),
        }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/inbox', path: PATH });
      await screen.findByText('Subject 1');
      await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
      await screen.findByText('Subject 99');
      expect(screen.getAllByText('Subject 50')).toHaveLength(1);
    });

    it.each([
      ['compact', false],
      ['normal', true],
      ['comfortable', true],
    ] as const)('applies the %s list density', async (density, hasPreview) => {
      installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/settings': { remote_images: 'ask', list_density: density },
        }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/inbox', path: PATH });
      await screen.findByText('Subject 1');
      await waitFor(() =>
        expect(screen.getAllByRole('list')[0]).toHaveAttribute('data-density', density),
      );
      expect(screen.queryByText('Preview text 1') !== null).toBe(hasPreview);
    });

    it('passes search text (debounced) and the unread/starred filters to the API', async () => {
      const mock = installFetchMock(baseRoutes());
      renderAt(<MailFolderPage />, { route: '/mail/inbox', path: PATH });
      await screen.findByText('Subject 1');

      await userEvent.type(screen.getByRole('searchbox'), 'отчёт');
      await userEvent.click(screen.getByRole('button', { name: 'Непрочитанные' }));
      await userEvent.click(screen.getByRole('button', { name: 'Со звездой' }));

      await waitFor(() => {
        const last = mock.calls.filter((c) => c.url.pathname === '/api/v1/mail/messages').at(-1)!;
        expect(last.url.searchParams.get('q')).toBe('отчёт');
        expect(last.url.searchParams.get('unread')).toBe('true');
        expect(last.url.searchParams.get('flagged')).toBe('true');
      });
    });

    it('searches every folder on request', async () => {
      const mock = installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/search': {
            messages: [mkSummary(7, { folder: 'sent', id: 'sent.1.7' })],
            total: 1,
            page: 1,
            per_page: 50,
          },
        }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/inbox', path: PATH });
      await screen.findByText('Subject 1');
      await userEvent.click(screen.getByRole('button', { name: 'Во всех папках' }));
      await userEvent.type(screen.getByRole('searchbox'), 'x');
      expect(await screen.findByText('Subject 7')).toBeInTheDocument();
      expect(mock.find('GET', '/api/v1/mail/search').at(-1)!.url.searchParams.get('q')).toBe('x');
      expect(screen.getByRole('link', { name: /Subject 7/ })).toHaveAttribute(
        'href',
        '/mail/sent/sent.1.7',
      );
    });

    it('opens drafts in the composer instead of the reader', async () => {
      installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/messages': {
            messages: [mkSummary(4, { id: 'drafts.1.4', folder: 'drafts' })],
            total: 1,
            page: 1,
            per_page: 50,
          },
        }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/drafts', path: PATH });
      const link = await screen.findByRole('link', { name: /Subject 4/ });
      expect(link).toHaveAttribute('href', '/mail/compose?draft=drafts.1.4');
    });

    it('shows a retry button when the list cannot be loaded', async () => {
      installFetchMock(
        baseRoutes({ 'GET /api/v1/mail/messages': () => apiError(503, 'upstream_unavailable') }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/inbox', path: PATH });
      // one automatic retry (1 s) for server errors before the message appears
      expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
        'временно недоступен',
      );
      expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    });
  });

  describe('reader', () => {
    const open = (
      extra: Record<string, Handler | object> = {},
      route = '/mail/inbox/inbox.1.1',
    ) => {
      const mock = installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/messages/inbox.1.1': mkDetail(1),
          ...extra,
        }),
      );
      renderAt(<MailFolderPage />, { route, path: PATH });
      return mock;
    };

    it('opens a message and refreshes the unread counters it just cleared', async () => {
      const mock = open();
      expect(await screen.findByRole('heading', { name: 'Subject 1' })).toBeInTheDocument();
      expect(screen.getByText('Body of message 1')).toBeInTheDocument();
      const [detailCall] = mock.find('GET', '/api/v1/mail/messages/inbox.1.1');
      expect(detailCall!.url.searchParams.has('peek')).toBe(false);
      await waitFor(() =>
        expect(mock.find('GET', '/api/v1/mail/folders').length).toBeGreaterThanOrEqual(2),
      );
    });

    it('marks as unread with CSRF and does not undo it by re-reading the message', async () => {
      const mock = open({ 'PATCH /api/v1/mail/messages/inbox.1.1': () => undefined });
      await screen.findByRole('heading', { name: 'Subject 1' });
      await userEvent.click(screen.getByTitle('Как непрочитанное'));

      await waitFor(() =>
        expect(mock.find('PATCH', '/api/v1/mail/messages/inbox.1.1')).toHaveLength(1),
      );
      const patch = mock.find('PATCH', '/api/v1/mail/messages/inbox.1.1')[0]!;
      expect(patch.body).toEqual({ read: false });
      expect(patch.headers.get('X-CSRF-Token')).toBe('csrf-1');
      expect(await screen.findByTitle('Как прочитанное')).toBeInTheDocument();
      expect(mock.find('GET', '/api/v1/mail/messages/inbox.1.1')).toHaveLength(1);
    });

    it('toggles the star', async () => {
      const mock = open({ 'PATCH /api/v1/mail/messages/inbox.1.1': () => undefined });
      await screen.findByRole('heading', { name: 'Subject 1' });
      await userEvent.click(screen.getByTitle('Пометить звездой'));
      await waitFor(() =>
        expect(mock.find('PATCH', '/api/v1/mail/messages/inbox.1.1')[0]!.body).toEqual({
          flagged: true,
        }),
      );
      expect(await screen.findByTitle('Снять звезду')).toBeInTheDocument();
    });

    it('archives and returns to the folder', async () => {
      const mock = open({ 'PATCH /api/v1/mail/messages/inbox.1.1': () => undefined });
      await screen.findByRole('heading', { name: 'Subject 1' });
      await userEvent.click(screen.getByTitle('В архив'));
      await waitFor(() => expect(location()).toBe('/mail/inbox'));
      expect(mock.find('PATCH', '/api/v1/mail/messages/inbox.1.1')[0]!.body).toEqual({
        folder: 'archive',
      });
    });

    it('reports a message as spam by moving it to the spam folder', async () => {
      const mock = open({ 'PATCH /api/v1/mail/messages/inbox.1.1': () => undefined });
      await screen.findByRole('heading', { name: 'Subject 1' });
      await userEvent.click(screen.getByTitle('В спам'));
      await waitFor(() => expect(location()).toBe('/mail/inbox'));
      expect(mock.find('PATCH', '/api/v1/mail/messages/inbox.1.1')[0]!.body).toEqual({
        folder: 'spam',
      });
    });

    it('moves a message to a chosen folder (current folder and Drafts are not offered)', async () => {
      const mock = open({ 'PATCH /api/v1/mail/messages/inbox.1.1': () => undefined });
      await screen.findByRole('heading', { name: 'Subject 1' });
      const select = screen.getByRole('combobox', { name: 'Переместить в папку…' });
      const offered = within(select)
        .getAllByRole('option')
        .map((o) => o.textContent);
      expect(offered).toContain('Проекты');
      expect(offered).toContain('Архив');
      expect(offered).not.toContain('Входящие');
      expect(offered).not.toContain('Черновики');

      await userEvent.selectOptions(select, 'f-0J_Qn9GA');
      await waitFor(() => expect(location()).toBe('/mail/inbox'));
      expect(mock.find('PATCH', '/api/v1/mail/messages/inbox.1.1')[0]!.body).toEqual({
        folder: 'f-0J_Qn9GA',
      });
    });

    it('hides the spam button inside the spam folder', async () => {
      installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/folders': [
            ...DEFAULT_FOLDERS,
            { id: 'spam', name: 'Junk', role: 'spam', unread_count: 0, total_count: 1 },
          ],
          'GET /api/v1/mail/messages/spam.1.1': mkDetail(1, { id: 'spam.1.1', folder: 'spam' }),
        }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/spam/spam.1.1', path: PATH });
      await screen.findByRole('heading', { name: 'Subject 1' });
      expect(screen.queryByTitle('В спам')).not.toBeInTheDocument();
    });

    it('hides the archive button inside the archive', async () => {
      installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/messages/archive.1.1': mkDetail(1, {
            id: 'archive.1.1',
            folder: 'archive',
          }),
        }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/archive/archive.1.1', path: PATH });
      await screen.findByRole('heading', { name: 'Subject 1' });
      expect(screen.queryByTitle('В архив')).not.toBeInTheDocument();
    });

    it('deletes straight away outside the trash, but asks before deleting for good', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const mock = open({ 'DELETE /api/v1/mail/messages/inbox.1.1': () => undefined });
      await screen.findByRole('heading', { name: 'Subject 1' });
      await userEvent.click(screen.getByTitle('Удалить'));
      await waitFor(() =>
        expect(mock.find('DELETE', '/api/v1/mail/messages/inbox.1.1')).toHaveLength(1),
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(
        mock.find('DELETE', '/api/v1/mail/messages/inbox.1.1')[0]!.headers.get('X-CSRF-Token'),
      ).toBe('csrf-1');
    });

    it('asks before permanent deletion in the trash and honours "cancel"', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const mock = installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/messages/trash.1.1': mkDetail(1, { id: 'trash.1.1', folder: 'trash' }),
          'DELETE /api/v1/mail/messages/trash.1.1': () => undefined,
        }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/trash/trash.1.1', path: PATH });
      await screen.findByRole('heading', { name: 'Subject 1' });
      await userEvent.click(screen.getByTitle('Удалить'));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(mock.find('DELETE', '/api/v1/mail/messages/trash.1.1')).toHaveLength(0);

      confirm.mockReturnValue(true);
      await userEvent.click(screen.getByTitle('Удалить'));
      await waitFor(() =>
        expect(mock.find('DELETE', '/api/v1/mail/messages/trash.1.1')).toHaveLength(1),
      );
    });

    it('starts a reply, reply-all and forward by message id', async () => {
      open();
      await screen.findByRole('heading', { name: 'Subject 1' });
      await userEvent.click(screen.getByRole('button', { name: /Ответить$/ }));
      await waitFor(() => expect(location()).toBe('/mail/compose?replyTo=inbox.1.1'));
    });

    it('starts a reply to all', async () => {
      open();
      await screen.findByRole('heading', { name: 'Subject 1' });
      await userEvent.click(screen.getByTitle('Ответить всем'));
      await waitFor(() => expect(location()).toBe('/mail/compose?replyTo=inbox.1.1&all=1'));
    });

    it('starts a forward', async () => {
      open();
      await screen.findByRole('heading', { name: 'Subject 1' });
      await userEvent.click(screen.getByRole('button', { name: /Переслать/ }));
      await waitFor(() => expect(location()).toBe('/mail/compose?forward=inbox.1.1'));
    });

    it.each([
      ['ask', true, false],
      ['always', false, true],
      ['never', false, false],
    ] as const)(
      'applies the %s remote-image preference to the open message',
      async (policy, button, loaded) => {
        open({
          'GET /api/v1/mail/settings': { remote_images: policy, list_density: 'normal' },
          'GET /api/v1/mail/messages/inbox.1.1': mkDetail(1, {
            html: { html: '<p>Hi</p><img src="https://tracker.example/p.gif">', blocked_remote: 1 },
          }),
        });
        const frame = (await screen.findByTitle('mgate-email-body')) as HTMLIFrameElement;
        await waitFor(() => expect(frame.srcdoc.includes('tracker.example')).toBe(loaded));
        expect(screen.queryByRole('button', { name: 'Показать изображения' }) !== null).toBe(
          button,
        );
      },
    );

    it('leaves the message unread when "mark as read on open" is off', async () => {
      const mock = open({
        'GET /api/v1/mail/settings': {
          remote_images: 'ask',
          list_density: 'normal',
          mark_read_on_open: false,
        },
      });
      await screen.findByRole('heading', { name: 'Subject 1' });
      expect(screen.getByTitle('Как прочитанное')).toBeInTheDocument();
      expect(mock.find('GET', '/api/v1/mail/folders')).toHaveLength(1); // no counters to refresh
    });

    it('lists attachments with working download links and hides inline parts', async () => {
      open({
        'GET /api/v1/mail/messages/inbox.1.1': mkDetail(1, {
          attachments: [
            { index: 0, name: 'отчёт.pdf', content_type: 'application/pdf', size: 2048 },
            {
              index: 1,
              name: 'logo.png',
              content_type: 'image/png',
              size: 10,
              inline: true,
              content_id: 'c1',
            },
          ],
        }),
      });
      const link = await screen.findByRole('link', { name: /отчёт\.pdf/ });
      expect(link).toHaveAttribute('href', '/api/v1/mail/messages/inbox.1.1/attachments/0');
      expect(screen.getByText('2.0 KB')).toBeInTheDocument();
      expect(screen.queryByText('logo.png')).not.toBeInTheDocument();
    });

    it('offers the original instead of a body for oversized messages', async () => {
      open({
        'GET /api/v1/mail/messages/inbox.1.1': mkDetail(1, { too_large: true, text: null }),
      });
      expect(await screen.findByText(/слишком большое/)).toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: /Скачать письмо/ })[0]).toHaveAttribute(
        'href',
        '/api/v1/mail/messages/inbox.1.1/raw',
      );
    });

    it('explains a stale message id instead of an empty pane', async () => {
      open({
        'GET /api/v1/mail/messages/inbox.1.1': () =>
          apiError(404, 'not_found', { reason: 'stale_id' }),
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('содержимое ящика изменилось');
    });

    it('does not fetch the message body for a draft URL, it opens the composer', async () => {
      const mock = installFetchMock(baseRoutes());
      renderAt(<MailFolderPage />, { route: '/mail/drafts/drafts.1.9', path: PATH });
      await waitFor(() => expect(location()).toBe('/mail/compose?draft=drafts.1.9'));
      expect(mock.calls.some((c) => c.url.pathname.includes('/messages/drafts'))).toBe(false);
    });
  });

  describe('thread view', () => {
    const threadMessages = [
      mkSummary(3, { thread_count: 3, thread_id: 'inbox.1.1', date: '2026-10-03T10:00:00Z' }),
      mkSummary(1, { thread_count: 3, thread_id: 'inbox.1.1', date: '2026-10-01T10:00:00Z' }),
      mkSummary(2, { thread_count: 3, thread_id: 'inbox.1.1', date: '2026-10-02T10:00:00Z' }),
    ];

    it('shows the conversation inside the reader, oldest first, and switches messages', async () => {
      const mock = installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/messages': {
            messages: threadMessages,
            total: 3,
            page: 1,
            per_page: 50,
          },
          'GET /api/v1/mail/messages/inbox.1.3': mkDetail(3),
          'GET /api/v1/mail/threads/inbox.1.1': {
            id: 'inbox.1.1',
            subject: 'Subject 1',
            messages: threadMessages,
          },
        }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/inbox/inbox.1.3', path: PATH });

      const strip = await screen.findByRole('region', { name: /Цепочка/ });
      const rows = within(strip).getAllByRole('link');
      expect(rows.map((r) => r.getAttribute('href'))).toEqual([
        '/mail/inbox/inbox.1.1',
        '/mail/inbox/inbox.1.2',
        '/mail/inbox/inbox.1.3',
      ]);
      expect(rows[2]).toHaveAttribute('aria-current', 'true');
      expect(mock.find('GET', '/api/v1/mail/threads/inbox.1.1')).toHaveLength(1);

      await userEvent.click(rows[0]!);
      await waitFor(() => expect(location()).toBe('/mail/inbox/inbox.1.1'));
    });

    it('still shows the message when the thread endpoint is unavailable (501)', async () => {
      installFetchMock(
        baseRoutes({
          'GET /api/v1/mail/messages': {
            messages: threadMessages,
            total: 3,
            page: 1,
            per_page: 50,
          },
          'GET /api/v1/mail/messages/inbox.1.3': mkDetail(3),
          'GET /api/v1/mail/threads/inbox.1.1': () => apiError(501, 'not_implemented'),
        }),
      );
      renderAt(<MailFolderPage />, { route: '/mail/inbox/inbox.1.3', path: PATH });
      expect(await screen.findByRole('heading', { name: 'Subject 3' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /Цепочка/ })).not.toBeInTheDocument();
    });
  });
});
