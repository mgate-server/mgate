import { fetchApi } from '../../lib/apiClient';
import { getRuntimeConfig } from '../../lib/runtimeConfig';
import type {
  Contact,
  ContactGroup,
  ContactInput,
  DraftItem,
  FolderInfo,
  ImportResult,
  MailLimits,
  MessageDetail,
  MessageList,
  MessageSummary,
  SaveDraftRequest,
  SendRequest,
  SendResponse,
  Signature,
  SignatureInput,
  StagedAttachment,
  ThreadDetail,
  WebmailPrefs,
  WebmailPrefsWire,
} from './types';

const MAIL_BASE = '/api/v1/mail';

/** Failure of a `/api/v1/mail/*` call, normalised from the shared `{"error": {...}}` envelope. */
export class MailApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;
  /** Seconds from `Retry-After`, when the server sent one (429/503). */
  readonly retryAfter: number | undefined;

  constructor(init: {
    status: number;
    message: string;
    code?: string;
    details?: Record<string, unknown>;
    requestId?: string;
    retryAfter?: number;
  }) {
    super(init.message);
    this.name = 'MailApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryAfter = init.retryAfter;
  }
}

export function isMailApiError(e: unknown, code?: string): e is MailApiError {
  return e instanceof MailApiError && (code === undefined || e.code === code);
}

/** Absolute-or-relative URL of a mail API path (honours the runtime `apiBaseUrl`). */
export function mailUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
) {
  const base = getRuntimeConfig().apiBaseUrl.replace(/\/+$/, '');
  const qs = buildQuery(query);
  return `${base}${MAIL_BASE}${path}${qs}`;
}

function buildQuery(query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  body?: BodyInit;
  contentType?: string;
  signal?: AbortSignal;
}

async function toError(res: Response): Promise<MailApiError> {
  let code: string | undefined;
  let message = res.statusText || `HTTP ${res.status}`;
  let details: Record<string, unknown> | undefined;
  let requestId: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: {
        code?: string;
        message?: string;
        details?: Record<string, unknown> | null;
        request_id?: string;
      };
    };
    code = body.error?.code;
    message = body.error?.message ?? message;
    details = body.error?.details ?? undefined;
    requestId = body.error?.request_id ?? undefined;
  } catch {
    // Not JSON (a proxy error page, for instance): keep the status text.
  }
  const retry = Number(res.headers.get('Retry-After'));
  return new MailApiError({
    status: res.status,
    message,
    code,
    details,
    requestId,
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
  });
}

/**
 * Single transport for the webmail API. Goes through `fetchApi`, so every mutating call carries
 * the double-submit CSRF header and the session cookie.
 */
async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers = new Headers();
  let body: BodyInit | undefined = opts.body;
  if (opts.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opts.json);
  } else if (opts.contentType) {
    headers.set('Content-Type', opts.contentType);
  }
  let res: Response;
  try {
    res = await fetchApi(mailUrl(path, opts.query), {
      method,
      headers,
      body,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new MailApiError({ status: 0, code: 'network', message: 'Network error' });
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface ListMessagesParams {
  folder: string;
  page?: number;
  perPage?: number;
  q?: string;
  unread?: boolean;
  flagged?: boolean;
  signal?: AbortSignal;
}

export const mailApi = {
  folders: (signal?: AbortSignal) => request<FolderInfo[]>('GET', '/folders', { signal }),

  /** Creates a custom folder; `/` in the name separates levels. */
  createFolder: (name: string) => request<FolderInfo>('POST', '/folders', { json: { name } }),

  /** Renames a custom folder. The folder id derives from its name, so the answer carries a new id. */
  renameFolder: (id: string, name: string) =>
    request<FolderInfo>('PATCH', `/folders/${encodeURIComponent(id)}`, { json: { name } }),

  /** Deletes a custom folder together with its messages (system folders answer 409). */
  deleteFolder: (id: string) => request<void>('DELETE', `/folders/${encodeURIComponent(id)}`),

  messages: (p: ListMessagesParams) =>
    request<MessageList>('GET', '/messages', {
      signal: p.signal,
      query: {
        folder: p.folder,
        page: p.page,
        per_page: p.perPage,
        q: p.q?.trim() || undefined,
        unread: p.unread ? true : undefined,
        flagged: p.flagged ? true : undefined,
      },
    }),

  search: (q: string, signal?: AbortSignal) =>
    request<MessageList>('GET', '/search', { query: { q: q.trim() }, signal }),

  message: (id: string, opts: { peek?: boolean; signal?: AbortSignal } = {}) =>
    request<MessageDetail>('GET', `/messages/${encodeURIComponent(id)}`, {
      query: { peek: opts.peek ? true : undefined },
      signal: opts.signal,
    }),

  patchMessage: (id: string, patch: { read?: boolean; flagged?: boolean; folder?: string }) =>
    request<MessageSummary | undefined>('PATCH', `/messages/${encodeURIComponent(id)}`, {
      json: patch,
    }),

  learnSpam: (id: string) =>
    request<MessageSummary | undefined>('POST', `/messages/${encodeURIComponent(id)}/learn-spam`),

  learnHam: (id: string) =>
    request<MessageSummary | undefined>('POST', `/messages/${encodeURIComponent(id)}/learn-ham`),

  deleteMessage: (id: string) => request<void>('DELETE', `/messages/${encodeURIComponent(id)}`),

  thread: (id: string, signal?: AbortSignal) =>
    request<ThreadDetail>('GET', `/threads/${encodeURIComponent(id)}`, { signal }),

  attachmentUrl: (messageId: string, index: number) =>
    mailUrl(`/messages/${encodeURIComponent(messageId)}/attachments/${index}`),

  rawUrl: (messageId: string) => mailUrl(`/messages/${encodeURIComponent(messageId)}/raw`),

  // Drafts
  getDraft: (id: string, signal?: AbortSignal) =>
    request<DraftItem>('GET', `/drafts/${encodeURIComponent(id)}`, { signal }),

  createDraft: (draft: SaveDraftRequest) => request<DraftItem>('POST', '/drafts', { json: draft }),

  /** Replaces a draft. The server answers with the NEW id: the old one is gone afterwards. */
  updateDraft: (id: string, draft: SaveDraftRequest) =>
    request<DraftItem>('PUT', `/drafts/${encodeURIComponent(id)}`, { json: draft }),

  deleteDraft: (id: string) => request<void>('DELETE', `/drafts/${encodeURIComponent(id)}`),

  // Send and staged uploads
  send: (msg: SendRequest) => request<SendResponse>('POST', '/send', { json: msg }),

  /** Streams the file as the raw request body; the name travels in `?filename=`. */
  uploadAttachment: (file: File, signal?: AbortSignal) =>
    request<StagedAttachment>('POST', '/attachments', {
      query: { filename: file.name || 'file' },
      body: file,
      contentType: file.type || 'application/octet-stream',
      signal,
    }),

  deleteAttachment: (id: string) =>
    request<void>('DELETE', `/attachments/${encodeURIComponent(id)}`),

  limits: (signal?: AbortSignal) => request<MailLimits>('GET', '/limits', { signal }),

  // Settings and signatures
  settings: (signal?: AbortSignal) => request<WebmailPrefsWire>('GET', '/settings', { signal }),

  saveSettings: (prefs: WebmailPrefs) =>
    request<WebmailPrefsWire>('PUT', '/settings', { json: prefs }),

  signatures: (signal?: AbortSignal) => request<Signature[]>('GET', '/signatures', { signal }),

  createSignature: (sig: SignatureInput) =>
    request<Signature>('POST', '/signatures', { json: sig }),

  updateSignature: (id: string, sig: SignatureInput) =>
    request<Signature>('PUT', `/signatures/${encodeURIComponent(id)}`, { json: sig }),

  deleteSignature: (id: string) => request<void>('DELETE', `/signatures/${encodeURIComponent(id)}`),

  // Contacts
  contacts: (signal?: AbortSignal) => request<Contact[]>('GET', '/contacts', { signal }),

  createContact: (c: ContactInput) => request<Contact>('POST', '/contacts', { json: c }),

  updateContact: (id: string, c: ContactInput) =>
    request<Contact>('PUT', `/contacts/${encodeURIComponent(id)}`, { json: c }),

  deleteContact: (id: string) => request<void>('DELETE', `/contacts/${encodeURIComponent(id)}`),

  autocomplete: (q: string, signal?: AbortSignal) =>
    request<Contact[]>('GET', '/contacts/autocomplete', { query: { q }, signal }),

  contactGroups: (signal?: AbortSignal) =>
    request<ContactGroup[]>('GET', '/contact-groups', { signal }),

  importContacts: (text: string) =>
    request<ImportResult>('POST', '/contacts/import', {
      body: text,
      contentType: 'text/plain; charset=utf-8',
    }),

  exportUrl: (format: 'vcard' | 'csv') => mailUrl('/contacts/export', { format }),

  /** `ws://` / `wss://` URL of the push channel. */
  wsUrl: (): string => {
    const base = getRuntimeConfig().apiBaseUrl.replace(/\/+$/, '');
    const origin = base || window.location.origin;
    const url = new URL(`${MAIL_BASE}/ws`, origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  },
};
