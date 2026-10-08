import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import {
  apiError,
  installFetchMock,
  mkDetail,
  renderAt,
  setCsrfCookie,
  type Handler,
} from '../../features/mail/testUtils';
import { ComposePage } from './ComposePage';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'u1', email: 'alice@example.com', role: 'User', domainId: null },
    logout: vi.fn(),
    hasAtLeastRole: () => false,
  }),
}));

const LIMITS = {
  max_upload_bytes: 1000,
  max_message_bytes: 50_000_000,
  max_recipients: 10,
  max_staged_bytes: 1500,
  per_page_max: 100,
};

const SIG = {
  id: 's1',
  name: 'Work',
  is_default: true,
  html_body: '<p>-- Alice</p>',
  text_body: '-- Alice',
};

type Calls = ReturnType<typeof installFetchMock>;
const location = () => screen.getByTestId('location').textContent;
const body = (c: { body: unknown }) => c.body as Record<string, unknown>;

function routes(extra: Record<string, Handler | object> = {}) {
  return {
    'GET /api/v1/mail/signatures': [] as object,
    'GET /api/v1/mail/limits': LIMITS,
    'GET /api/v1/mail/contacts/autocomplete': [] as object,
    'POST /api/v1/mail/send': { status: 'sent', message_id: '<m@x>', saved_to_sent: true },
    ...extra,
  };
}

function open(route = '/mail/compose', extra: Record<string, Handler | object> = {}): Calls {
  const mock = installFetchMock(routes(extra));
  renderAt(<ComposePage />, { route, path: '/mail/compose' });
  return mock;
}

const toField = () => screen.getByRole('textbox', { name: 'Кому' });
const subjectField = () => screen.getByRole('textbox', { name: 'Тема' });
const sendButton = () => screen.getByRole('button', { name: /Отправить/ });

async function ready() {
  await screen.findByRole('textbox', { name: 'Кому' });
  await screen.findByText(/Максимальный размер вложения/);
}

describe('ComposePage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });
  beforeEach(() => {
    setCsrfCookie('csrf-1');
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setCsrfCookie(null);
  });

  describe('sending', () => {
    it('sends to / cc / bcc as plain addresses with the CSRF header, then goes to Sent', async () => {
      const mock = open();
      await ready();

      fireEvent.change(toField(), {
        target: { value: 'Иван <ivan@example.com>, anna@example.com' },
      });
      await userEvent.click(screen.getByRole('button', { name: 'Копия' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Копия' }), {
        target: { value: 'cc@example.com' },
      });
      await userEvent.click(screen.getByRole('button', { name: 'Скрытая' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Скрытая' }), {
        target: { value: 'hidden@example.com' },
      });
      fireEvent.change(subjectField(), { target: { value: 'Привет' } });
      await userEvent.click(sendButton());

      await waitFor(() => expect(location()).toBe('/mail/sent'));
      const [send] = mock.find('POST', '/api/v1/mail/send');
      expect(send!.headers.get('X-CSRF-Token')).toBe('csrf-1');
      expect(body(send!)).toMatchObject({
        from: 'alice@example.com',
        to: ['ivan@example.com', 'anna@example.com'],
        cc: ['cc@example.com'],
        bcc: ['hidden@example.com'],
        subject: 'Привет',
        attachment_ids: [],
      });
      expect(body(send!).draft_id).toBeUndefined();
      expect(body(send!).in_reply_to).toBeUndefined();
    });

    it('refuses to send without recipients or with a malformed address, without calling the API', async () => {
      const mock = open();
      await ready();

      await userEvent.click(sendButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Укажите хотя бы одного получателя',
      );

      fireEvent.change(toField(), { target: { value: 'ok@example.com, not-an-address' } });
      await userEvent.click(sendButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Некорректный адрес: not-an-address',
      );
      expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(0);
    });

    it('enforces the recipient limit from /limits', async () => {
      const mock = open('/mail/compose', {
        'GET /api/v1/mail/limits': { ...LIMITS, max_recipients: 3 },
      });
      await ready();
      fireEvent.change(toField(), { target: { value: 'a@x.org, b@x.org, c@x.org, d@x.org' } });
      await userEvent.click(sendButton());
      expect(await screen.findByRole('alert')).toHaveTextContent('максимум 3');
      expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(0);
    });

    it('asks before sending without a subject', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const mock = open();
      await ready();
      fireEvent.change(toField(), { target: { value: 'a@x.org' } });
      await userEvent.click(sendButton());
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(0);

      confirm.mockReturnValue(true);
      await userEvent.click(sendButton());
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(1));
      expect(body(mock.find('POST', '/api/v1/mail/send')[0]!).subject).toBe('');
    });

    it('shows a localised reason when the server refuses, and lets the user retry', async () => {
      let n = 0;
      const mock = open('/mail/compose', {
        'POST /api/v1/mail/send': () =>
          ++n === 1 ? apiError(403, 'sender_not_allowed') : { status: 'sent', message_id: 'x' },
      });
      await ready();
      fireEvent.change(toField(), { target: { value: 'a@x.org' } });
      fireEvent.change(subjectField(), { target: { value: 's' } });
      await userEvent.click(sendButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'нельзя отправлять письма от выбранного адреса',
      );
      expect(location()).toBe('/mail/compose');

      await userEvent.click(sendButton());
      await waitFor(() => expect(location()).toBe('/mail/sent'));
      expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(2);
    });

    it('warns when the message went out but the Sent copy could not be saved', async () => {
      open('/mail/compose', {
        'POST /api/v1/mail/send': { status: 'sent', message_id: 'x', saved_to_sent: false },
      });
      await ready();
      fireEvent.change(toField(), { target: { value: 'a@x.org' } });
      fireEvent.change(subjectField(), { target: { value: 's' } });
      await userEvent.click(sendButton());
      expect(await screen.findByText(/копию не удалось сохранить/)).toBeInTheDocument();
    });

    it('puts the default signature into the new message', async () => {
      const mock = open('/mail/compose', { 'GET /api/v1/mail/signatures': [SIG] });
      await ready();
      fireEvent.change(toField(), { target: { value: 'a@x.org' } });
      fireEvent.change(subjectField(), { target: { value: 's' } });
      await userEvent.click(sendButton());
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(1));
      expect(String(body(mock.find('POST', '/api/v1/mail/send')[0]!).html)).toContain('-- Alice');
    });
  });

  describe('reply and forward', () => {
    const original = mkDetail(5, {
      from: 'Bob <bob@example.org>',
      to: ['alice@example.com', 'carol@example.org'],
      cc: ['dave@example.org'],
      subject: 'Re: Отчёт',
      text: 'Первая строка\nВторая строка',
      attachments: [
        { index: 0, name: 'report.pdf', content_type: 'application/pdf', size: 100 },
        { index: 1, name: 'logo.png', content_type: 'image/png', size: 5, inline: true },
      ],
    });
    const orig = { 'GET /api/v1/mail/messages/inbox.1.5': original };

    it('replies via reply_to_id (not the legacy param), quoting the original', async () => {
      const mock = open('/mail/compose?replyTo=inbox.1.5', orig);
      await waitFor(() => expect((toField() as HTMLInputElement).value).toBe('bob@example.org'));
      expect((subjectField() as HTMLInputElement).value).toBe('Re: Отчёт');
      // reading the original for the quote must not mark it read again
      expect(
        mock.find('GET', '/api/v1/mail/messages/inbox.1.5')[0]!.url.searchParams.get('peek'),
      ).toBe('true');

      await userEvent.click(sendButton());
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(1));
      const sent = body(mock.find('POST', '/api/v1/mail/send')[0]!);
      expect(sent.reply_to_id).toBe('inbox.1.5');
      expect(sent.to).toEqual(['bob@example.org']);
      expect(sent.forward_of_id).toBeUndefined();
      expect(String(sent.html)).toMatch(/<blockquote>[\s\S]*Первая строка[\s\S]*Вторая строка/);
      expect(String(sent.html)).toContain('Bob &lt;bob@example.org&gt; писал(а):');
    });

    it('replies to everyone except the signed-in mailbox', async () => {
      open('/mail/compose?replyTo=inbox.1.5&all=1', orig);
      await waitFor(() =>
        expect((toField() as HTMLInputElement).value).toBe('bob@example.org, carol@example.org'),
      );
      expect((screen.getByRole('textbox', { name: 'Копия' }) as HTMLInputElement).value).toBe(
        'dave@example.org',
      );
    });

    it('forwards via forward_of_id, including the original attachments by default', async () => {
      const mock = open('/mail/compose?forward=inbox.1.5', orig);
      await waitFor(() => expect((subjectField() as HTMLInputElement).value).toBe('Fwd: Отчёт'));
      expect(screen.getByText(/report\.pdf/)).toBeInTheDocument();
      expect(screen.queryByText(/logo\.png/)).not.toBeInTheDocument();

      fireEvent.change(toField(), { target: { value: 'z@x.org' } });
      await userEvent.click(sendButton());
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(1));
      const sent = body(mock.find('POST', '/api/v1/mail/send')[0]!);
      expect(sent).toMatchObject({ forward_of_id: 'inbox.1.5', forward_attachments: [0] });
      expect(sent.reply_to_id).toBeUndefined();
      expect(String(sent.html)).toContain('Пересылаемое письмо');
      expect(String(sent.html)).toContain('Первая строка');
    });

    it('lets the user leave the original attachments out of a forward', async () => {
      const mock = open('/mail/compose?forward=inbox.1.5', orig);
      await waitFor(() => expect((subjectField() as HTMLInputElement).value).toBe('Fwd: Отчёт'));
      await userEvent.click(screen.getByRole('checkbox'));
      fireEvent.change(toField(), { target: { value: 'z@x.org' } });
      await userEvent.click(sendButton());
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(1));
      expect(body(mock.find('POST', '/api/v1/mail/send')[0]!).forward_attachments).toEqual([]);
    });

    it('still opens when the original cannot be read, and says why', async () => {
      open('/mail/compose?replyTo=inbox.1.5', {
        'GET /api/v1/mail/messages/inbox.1.5': () =>
          apiError(404, 'not_found', { reason: 'stale_id' }),
      });
      expect(await screen.findByText(/содержимое ящика изменилось/)).toBeInTheDocument();
      expect(toField()).toBeInTheDocument();
    });
  });

  describe('attachments', () => {
    const upload = async (file: File) => {
      await userEvent.upload(screen.getByTestId('compose-file-input'), file);
    };

    it('uploads with ?filename= and CSRF, shows the server name/size, and sends the ids', async () => {
      const mock = open('/mail/compose', {
        'POST /api/v1/mail/attachments': {
          id: 'u-1',
          name: 'отчёт.txt',
          content_type: 'text/plain',
          size: 12,
        },
      });
      await ready();
      const file = new File(['hello world!'], 'отчёт.txt', { type: 'text/plain' });
      await upload(file);

      expect(await screen.findByText('отчёт.txt')).toBeInTheDocument();
      const [up] = mock.find('POST', '/api/v1/mail/attachments');
      expect(up!.url.searchParams.get('filename')).toBe('отчёт.txt');
      expect(up!.headers.get('X-CSRF-Token')).toBe('csrf-1');
      expect(up!.body).toBe(file);

      fireEvent.change(toField(), { target: { value: 'a@x.org' } });
      fireEvent.change(subjectField(), { target: { value: 's' } });
      await userEvent.click(sendButton());
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(1));
      expect(body(mock.find('POST', '/api/v1/mail/send')[0]!).attachment_ids).toEqual(['u-1']);
    });

    it('removes a staged upload on the server too', async () => {
      const mock = open('/mail/compose', {
        'POST /api/v1/mail/attachments': { id: 'u-9', name: 'a.txt', size: 3 },
        'DELETE /api/v1/mail/attachments/u-9': () => undefined,
      });
      await ready();
      await upload(new File(['abc'], 'a.txt', { type: 'text/plain' }));
      await screen.findByText('a.txt');
      await userEvent.click(screen.getByRole('button', { name: 'Убрать вложение' }));
      await waitFor(() =>
        expect(mock.find('DELETE', '/api/v1/mail/attachments/u-9')).toHaveLength(1),
      );
      expect(
        mock.find('DELETE', '/api/v1/mail/attachments/u-9')[0]!.headers.get('X-CSRF-Token'),
      ).toBe('csrf-1');
      expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
    });

    it('takes the size limit from /limits instead of a hard-coded 50 MB', async () => {
      const mock = open();
      await ready();
      expect(screen.getByText(/Максимальный размер вложения: 1000 B/)).toBeInTheDocument();
      expect(screen.queryByText(/50/)).not.toBeInTheDocument();

      await upload(new File(['x'.repeat(2000)], 'big.bin'));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Максимальный размер вложения: 1000 B',
      );
      expect(mock.find('POST', '/api/v1/mail/attachments')).toHaveLength(0);
    });

    it('stops at the staged-bytes quota from /limits', async () => {
      let id = 0;
      const mock = open('/mail/compose', {
        'POST /api/v1/mail/attachments': () => ({ id: `u-${++id}`, name: `f${id}.bin`, size: 900 }),
      });
      await ready();
      await upload(new File(['x'.repeat(900)], 'f1.bin'));
      await screen.findByText('f1.bin');
      await upload(new File(['x'.repeat(900)], 'f2.bin'));
      expect(await screen.findByRole('alert')).toHaveTextContent('лимит загруженных вложений');
      expect(mock.find('POST', '/api/v1/mail/attachments')).toHaveLength(1);
    });

    it('applies the staged-bytes quota to files picked together', async () => {
      let id = 0;
      const mock = open('/mail/compose', {
        'POST /api/v1/mail/attachments': () => ({ id: `u-${++id}`, name: `f${id}.bin`, size: 900 }),
      });
      await ready();
      await userEvent.upload(screen.getByTestId('compose-file-input'), [
        new File(['x'.repeat(900)], 'f1.bin'),
        new File(['x'.repeat(900)], 'f2.bin'),
      ]);
      expect(await screen.findByRole('alert')).toHaveTextContent('лимит загруженных вложений');
      expect(mock.find('POST', '/api/v1/mail/attachments')).toHaveLength(1);
    });

    it('explains a server-side rejection (413 attachment_too_large)', async () => {
      open('/mail/compose', {
        'POST /api/v1/mail/attachments': () =>
          apiError(413, 'attachment_too_large', { max_bytes: 2048 }),
      });
      await ready();
      await upload(new File(['x'.repeat(500)], 'a.bin'));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Максимальный размер вложения: 2.0 KB',
      );
    });
  });

  describe('drafts', () => {
    const saved = (id: string, extra: object = {}) => ({
      id,
      from: 'alice@example.com',
      subject: '',
      updated_at: '2026-10-01T10:00:00Z',
      ...extra,
    });

    it('autosaves every 10 s while there are edits, following the id the server returns', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let n = 0;
      const mock = open('/mail/compose', {
        'POST /api/v1/mail/drafts': () => saved(`drafts.1.${10 + ++n}`),
        'PUT /api/v1/mail/drafts/*': () => saved(`drafts.1.${10 + ++n}`),
      });
      await ready();

      fireEvent.change(toField(), { target: { value: 'a@x.org' } });
      fireEvent.change(subjectField(), { target: { value: 'Черновик 1' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500);
      });
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/drafts')).toHaveLength(1));
      const [create] = mock.find('POST', '/api/v1/mail/drafts');
      expect(create!.headers.get('X-CSRF-Token')).toBe('csrf-1');
      expect(body(create!)).toMatchObject({
        from: 'alice@example.com',
        to: ['a@x.org'],
        subject: 'Черновик 1',
      });
      expect(window.location.search).toContain('draft=drafts.1.11');
      expect(await screen.findByText(/Черновик сохранён/)).toBeInTheDocument();

      // no edits -> no request
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(mock.calls.filter((c) => c.url.pathname.includes('/drafts'))).toHaveLength(1);

      fireEvent.change(subjectField(), { target: { value: 'Черновик 2' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500);
      });
      await waitFor(() =>
        expect(mock.find('PUT', '/api/v1/mail/drafts/drafts.1.11')).toHaveLength(1),
      );
      expect(window.location.search).toContain('draft=drafts.1.12');

      fireEvent.change(subjectField(), { target: { value: 'Черновик 3' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500);
      });
      await waitFor(() =>
        expect(mock.find('PUT', '/api/v1/mail/drafts/drafts.1.12')).toHaveLength(1),
      );
    });

    it('does not create a draft for an untouched or empty form', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const mock = open('/mail/compose', { 'GET /api/v1/mail/signatures': [SIG] });
      await ready();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40_000);
      });
      expect(mock.find('POST', '/api/v1/mail/drafts')).toHaveLength(0);
    });

    it('saves on demand', async () => {
      const mock = open('/mail/compose', { 'POST /api/v1/mail/drafts': saved('drafts.1.20') });
      await ready();
      fireEvent.change(subjectField(), { target: { value: 'x' } });
      await userEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/drafts')).toHaveLength(1));
      expect(await screen.findByText(/Черновик сохранён/)).toBeInTheDocument();
    });

    it('reports a failed save', async () => {
      open('/mail/compose', { 'POST /api/v1/mail/drafts': () => apiError(507, 'quota_exceeded') });
      await ready();
      fireEvent.change(subjectField(), { target: { value: 'x' } });
      await userEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить черновик');
    });

    it('saves the draft when the composer is left', async () => {
      const mock = installFetchMock(routes({ 'POST /api/v1/mail/drafts': saved('drafts.1.30') }));
      const { unmount } = renderAt(<ComposePage />, {
        route: '/mail/compose',
        path: '/mail/compose',
      });
      await ready();
      fireEvent.change(subjectField(), { target: { value: 'unsent' } });
      unmount();
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/drafts')).toHaveLength(1));
      expect(body(mock.find('POST', '/api/v1/mail/drafts')[0]!).subject).toBe('unsent');
    });

    it('opens a draft for editing, sends it with draft_id and never autosaves it again', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const mock = open('/mail/compose?draft=drafts.1.7', {
        'GET /api/v1/mail/drafts/drafts.1.7': saved('drafts.1.7', {
          to: ['bob@example.org'],
          cc: ['cc@example.org'],
          bcc: ['hidden@example.org'],
          subject: 'Незаконченное',
          html: '<p>Текст черновика</p>',
          attachments: [
            { index: 2, name: 'plan.pdf', content_type: 'application/pdf', size: 4096 },
          ],
        }),
      });
      await waitFor(() => expect((subjectField() as HTMLInputElement).value).toBe('Незаконченное'));
      expect((toField() as HTMLInputElement).value).toBe('bob@example.org');
      expect((screen.getByRole('textbox', { name: 'Копия' }) as HTMLInputElement).value).toBe(
        'cc@example.org',
      );
      expect((screen.getByRole('textbox', { name: 'Скрытая' }) as HTMLInputElement).value).toBe(
        'hidden@example.org',
      );
      expect(screen.getByText('plan.pdf')).toBeInTheDocument();

      fireEvent.change(subjectField(), { target: { value: 'Готово' } });
      await userEvent.click(sendButton());
      await waitFor(() => expect(location()).toBe('/mail/sent'));
      const sent = body(mock.find('POST', '/api/v1/mail/send')[0]!);
      expect(sent).toMatchObject({
        draft_id: 'drafts.1.7',
        keep_draft_attachments: [2],
        subject: 'Готово',
        bcc: ['hidden@example.org'],
      });
      expect(String(sent.html)).toContain('Текст черновика');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(
        mock.calls.filter((c) => c.url.pathname.includes('/drafts') && c.method !== 'GET'),
      ).toHaveLength(0);
    });

    it('keeps reply_to_id across saves and across reopening the saved reply draft', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      window.localStorage.clear();
      const original = mkDetail(5, {
        subject: 'Отчёт',
        from: 'Bob <bob@example.org>',
      });
      let n = 0;
      const mock = open('/mail/compose?replyTo=inbox.1.5', {
        'GET /api/v1/mail/messages/inbox.1.5': original,
        'POST /api/v1/mail/drafts': () =>
          saved(`drafts.1.${20 + ++n}`, { in_reply_to: '<m5@example.org>' }),
        'PUT /api/v1/mail/drafts/*': () =>
          saved(`drafts.1.${20 + ++n}`, { in_reply_to: '<m5@example.org>' }),
      });
      await waitFor(() => expect((subjectField() as HTMLInputElement).value).toBe('Re: Отчёт'));
      fireEvent.change(subjectField(), { target: { value: 'Re: Отчёт (правка)' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500);
      });
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/drafts')).toHaveLength(1));
      expect(body(mock.find('POST', '/api/v1/mail/drafts')[0]!).reply_to_id).toBe('inbox.1.5');

      fireEvent.change(subjectField(), { target: { value: 'Re: Отчёт (ещё)' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500);
      });
      await waitFor(() =>
        expect(mock.find('PUT', '/api/v1/mail/drafts/drafts.1.21')).toHaveLength(1),
      );
      expect(body(mock.find('PUT', '/api/v1/mail/drafts/drafts.1.21')[0]!).reply_to_id).toBe(
        'inbox.1.5',
      );
    });

    it('restores reply_to_id when a saved reply draft is reopened', async () => {
      window.localStorage.setItem(
        'mgate.mail.draftReplies',
        JSON.stringify({ 'drafts.1.7': 'inbox.1.5' }),
      );
      const mock = open('/mail/compose?draft=drafts.1.7', {
        'GET /api/v1/mail/drafts/drafts.1.7': saved('drafts.1.7', {
          to: ['bob@example.org'],
          subject: 'Re: Отчёт',
          html: '<p>Ответ</p>',
          in_reply_to: '<m5@example.org>',
        }),
      });
      await waitFor(() => expect((subjectField() as HTMLInputElement).value).toBe('Re: Отчёт'));
      await userEvent.click(sendButton());
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(1));
      const sent = body(mock.find('POST', '/api/v1/mail/send')[0]!);
      expect(sent).toMatchObject({
        reply_to_id: 'inbox.1.5',
        in_reply_to: '<m5@example.org>',
        draft_id: 'drafts.1.7',
      });
      await waitFor(() => expect(location()).toBe('/mail/sent'));
      expect(window.localStorage.getItem('mgate.mail.draftReplies')).not.toContain('drafts.1.7');
    });

    it('does not load remote images of a draft into the editor', async () => {
      const mock = open('/mail/compose?draft=drafts.1.8', {
        'GET /api/v1/mail/drafts/drafts.1.8': saved('drafts.1.8', {
          to: ['bob@example.org'],
          subject: 'Moved',
          html: '<p>Hi</p><img src="https://tracker.example/p.gif">',
        }),
      });
      await waitFor(() => expect((subjectField() as HTMLInputElement).value).toBe('Moved'));
      await userEvent.click(sendButton());
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/send')).toHaveLength(1));
      expect(String(body(mock.find('POST', '/api/v1/mail/send')[0]!).html)).not.toContain(
        'tracker.example',
      );
    });

    it('lets the user drop a draft attachment, which then is not kept on save', async () => {
      const mock = open('/mail/compose?draft=drafts.1.7', {
        'GET /api/v1/mail/drafts/drafts.1.7': saved('drafts.1.7', {
          to: ['bob@example.org'],
          subject: 'S',
          html: '<p>x</p>',
          attachments: [
            { index: 0, name: 'a.pdf', size: 1 },
            { index: 1, name: 'b.pdf', size: 1 },
          ],
        }),
        'PUT /api/v1/mail/drafts/drafts.1.7': saved('drafts.1.8'),
      });
      await screen.findByText('a.pdf');
      await userEvent.click(screen.getAllByRole('button', { name: 'Убрать вложение' })[0]!);
      await userEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
      await waitFor(() =>
        expect(mock.find('PUT', '/api/v1/mail/drafts/drafts.1.7')).toHaveLength(1),
      );
      expect(body(mock.find('PUT', '/api/v1/mail/drafts/drafts.1.7')[0]!).keep_attachments).toEqual(
        [1],
      );
    });

    it('picks up the attachment list the server returns after a save', async () => {
      const mock = open('/mail/compose', {
        'POST /api/v1/mail/attachments': { id: 'u-5', name: 'scan.png', size: 10 },
        'POST /api/v1/mail/drafts': saved('drafts.1.40', {
          attachments: [{ index: 0, name: 'scan.png', size: 10 }],
        }),
        'PUT /api/v1/mail/drafts/drafts.1.40': saved('drafts.1.41', {
          attachments: [{ index: 0, name: 'scan.png', size: 10 }],
        }),
      });
      await ready();
      await userEvent.upload(
        screen.getByTestId('compose-file-input'),
        new File(['0123456789'], 'scan.png'),
      );
      await screen.findByText('scan.png');
      await userEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/drafts')).toHaveLength(1));
      expect(body(mock.find('POST', '/api/v1/mail/drafts')[0]!).attachment_ids).toEqual(['u-5']);

      // second save: the upload is part of the draft now, referenced by index, not re-sent
      fireEvent.change(subjectField(), { target: { value: 'again' } });
      await userEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
      await waitFor(() =>
        expect(mock.find('PUT', '/api/v1/mail/drafts/drafts.1.40')).toHaveLength(1),
      );
      const second = body(mock.find('PUT', '/api/v1/mail/drafts/drafts.1.40')[0]!);
      expect(second.attachment_ids).toEqual([]);
      expect(second.keep_attachments).toEqual([0]);
      expect(screen.getAllByText('scan.png')).toHaveLength(1);
    });

    it('starts a new draft if the saved one has disappeared', async () => {
      const mock = open('/mail/compose?draft=drafts.1.7', {
        'GET /api/v1/mail/drafts/drafts.1.7': saved('drafts.1.7', {
          subject: 'S',
          html: '<p>x</p>',
        }),
        'PUT /api/v1/mail/drafts/drafts.1.7': () => apiError(404, 'not_found'),
        'POST /api/v1/mail/drafts': saved('drafts.1.99'),
      });
      await waitFor(() => expect((subjectField() as HTMLInputElement).value).toBe('S'));
      fireEvent.change(subjectField(), { target: { value: 'S2' } });
      await userEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
      await waitFor(() => expect(mock.find('POST', '/api/v1/mail/drafts')).toHaveLength(1));
      expect(await screen.findByText(/Черновик сохранён/)).toBeInTheDocument();
    });

    it('deletes the draft and its uploads on discard', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const mock = open('/mail/compose?draft=drafts.1.7', {
        'GET /api/v1/mail/drafts/drafts.1.7': saved('drafts.1.7', {
          subject: 'S',
          html: '<p>x</p>',
        }),
        'DELETE /api/v1/mail/drafts/drafts.1.7': () => undefined,
      });
      await waitFor(() => expect((subjectField() as HTMLInputElement).value).toBe('S'));
      await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
      await waitFor(() => expect(location()).toBe('/mail/inbox'));
      const [del] = mock.find('DELETE', '/api/v1/mail/drafts/drafts.1.7');
      expect(del!.headers.get('X-CSRF-Token')).toBe('csrf-1');
      expect(mock.find('POST', '/api/v1/mail/drafts')).toHaveLength(0); // not resurrected on leave
    });
  });
});
