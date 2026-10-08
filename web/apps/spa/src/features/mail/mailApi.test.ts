import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailApiError, isMailApiError, mailApi, mailUrl } from './mailApi';
import { apiError, installFetchMock, setCsrfCookie } from './testUtils';

const file = (name: string, type: string, size = 5) => new File(['x'.repeat(size)], name, { type });

describe('mailApi transport', () => {
  beforeEach(() => setCsrfCookie('csrf-xyz'));
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfCookie(null);
  });

  it('sends the CSRF header and the session cookie on EVERY mutating call', async () => {
    const mock = installFetchMock({
      'POST **': { id: 'x' },
      'PUT **': { id: 'x' },
      'PATCH **': () => undefined,
      'DELETE **': () => undefined,
    });
    const draft = {
      from: 'a@x.org',
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      html: '',
      text: '',
      attachment_ids: [],
      keep_attachments: [],
    };
    const sig = { name: 'n', html_body: '', text_body: '', is_default: false };
    const contact = { name: 'n', email: 'e@x.org' };

    await mailApi.patchMessage('inbox.1.2', { read: true });
    await mailApi.deleteMessage('inbox.1.2');
    await mailApi.createDraft(draft);
    await mailApi.updateDraft('drafts.1.3', draft);
    await mailApi.deleteDraft('drafts.1.3');
    await mailApi.send({ ...draft, to: ['b@x.org'] });
    await mailApi.uploadAttachment(file('a.txt', 'text/plain'));
    await mailApi.deleteAttachment('u-1');
    await mailApi.saveSettings({
      remote_images: 'ask',
      list_density: 'normal',
      mark_read_on_open: true,
    });
    await mailApi.createSignature(sig);
    await mailApi.updateSignature('s1', sig);
    await mailApi.deleteSignature('s1');
    await mailApi.createContact(contact);
    await mailApi.updateContact('c1', contact);
    await mailApi.deleteContact('c1');
    await mailApi.importContacts('BEGIN:VCARD');

    expect(mock.calls).toHaveLength(16);
    for (const c of mock.calls) {
      expect(c.method, c.url.pathname).not.toBe('GET');
      expect(c.headers.get('X-CSRF-Token'), `${c.method} ${c.url.pathname}`).toBe('csrf-xyz');
    }
  });

  it('does not add the token to reads', async () => {
    const mock = installFetchMock({ 'GET **': [] });
    await mailApi.folders();
    await mailApi.limits();
    expect(mock.calls.every((c) => !c.headers.has('X-CSRF-Token'))).toBe(true);
  });

  it('uploads the raw file with ?filename= and its own content type', async () => {
    const mock = installFetchMock({
      'POST /api/v1/mail/attachments': { id: 'u-1', name: 'a b.txt', size: 5 },
    });
    const f = file('отчёт a&b.txt', 'text/plain');
    const res = await mailApi.uploadAttachment(f);
    const [call] = mock.calls;
    expect(res.id).toBe('u-1');
    expect(call!.url.searchParams.get('filename')).toBe('отчёт a&b.txt');
    expect(call!.headers.get('Content-Type')).toBe('text/plain');
    expect(call!.body).toBe(f);
  });

  it('falls back to octet-stream for files without a type', async () => {
    const mock = installFetchMock({ 'POST /api/v1/mail/attachments': { id: 'u-2' } });
    await mailApi.uploadAttachment(file('blob.bin', ''));
    expect(mock.calls[0]!.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('imports contacts as text/plain', async () => {
    const mock = installFetchMock({
      'POST /api/v1/mail/contacts/import': { imported: 2, skipped: 1 },
    });
    const res = await mailApi.importContacts('Name,Email\nA,a@x.org');
    expect(res).toEqual({ imported: 2, skipped: 1 });
    expect(mock.calls[0]!.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
  });

  it('builds list queries with pagination and filters, skipping empty values', async () => {
    const mock = installFetchMock({
      'GET /api/v1/mail/messages': { messages: [], total: 0, page: 2, per_page: 50 },
    });
    await mailApi.messages({
      folder: 'inbox',
      page: 2,
      perPage: 50,
      q: '  отчёт ',
      unread: true,
      flagged: false,
    });
    const q = mock.calls[0]!.url.searchParams;
    expect(Object.fromEntries(q)).toEqual({
      folder: 'inbox',
      page: '2',
      per_page: '50',
      q: 'отчёт',
      unread: 'true',
    });
  });

  it('asks for a peek when requested and encodes ids', async () => {
    const mock = installFetchMock({ 'GET **': { id: 'x' } });
    await mailApi.message('f-a_b-c.7.12', { peek: true });
    expect(mock.calls[0]!.url.pathname).toBe('/api/v1/mail/messages/f-a_b-c.7.12');
    expect(mock.calls[0]!.url.searchParams.get('peek')).toBe('true');
  });

  it('answers 204 with undefined', async () => {
    installFetchMock({ 'DELETE **': () => undefined });
    await expect(mailApi.deleteMessage('inbox.1.1')).resolves.toBeUndefined();
  });

  it('normalises the error envelope, details and Retry-After', async () => {
    installFetchMock({
      'POST /api/v1/mail/send': () =>
        apiError(429, 'rate_limited', { x: 1 }, { 'Retry-After': '17' }),
    });
    const e = await mailApi
      .send({
        from: 'a@x.org',
        to: ['b@x.org'],
        cc: [],
        bcc: [],
        subject: '',
        html: '',
        text: '',
        attachment_ids: [],
      })
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(MailApiError);
    expect(isMailApiError(e, 'rate_limited')).toBe(true);
    expect((e as MailApiError).status).toBe(429);
    expect((e as MailApiError).retryAfter).toBe(17);
    expect((e as MailApiError).requestId).toBe('req-1');
    expect((e as MailApiError).details).toEqual({ x: 1 });
  });

  it('reports transport failures as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const e = await mailApi.folders().catch((err: unknown) => err);
    expect(isMailApiError(e, 'network')).toBe(true);
    expect((e as MailApiError).status).toBe(0);
  });

  it('builds download URLs and the WebSocket URL', () => {
    expect(mailApi.attachmentUrl('inbox.1.2', 3)).toBe(
      '/api/v1/mail/messages/inbox.1.2/attachments/3',
    );
    expect(mailApi.rawUrl('inbox.1.2')).toBe('/api/v1/mail/messages/inbox.1.2/raw');
    expect(mailApi.exportUrl('csv')).toBe('/api/v1/mail/contacts/export?format=csv');
    expect(mailUrl('/folders')).toBe('/api/v1/mail/folders');
    expect(mailApi.wsUrl()).toBe(`ws://${window.location.host}/api/v1/mail/ws`);
  });
});
