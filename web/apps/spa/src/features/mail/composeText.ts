import { extractEmail, isPlausibleEmail } from './addresses';
import type { MessageDetail } from './types';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text -> HTML paragraphs (blank line = new paragraph, newline = `<br>`), fully escaped. */
export function textToHtml(text: string): string {
  const normalised = text.replace(/\r\n?/g, '\n').trim();
  if (!normalised) return '';
  return normalised
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Visible text of an HTML fragment. Parsed inertly (`DOMParser`): nothing runs or loads. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  doc.querySelectorAll('style,script,head').forEach((n) => n.remove());
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

const PREFIX_RE = /^\s*((re|fwd?|fw|ответ|пересл|отв|пр)\s*(\[\d+\])?\s*:\s*)+/i;

/** `Re: x` / `Fwd: x` without stacking prefixes (`Re: Re: x`). */
export function subjectWithPrefix(subject: string, kind: 'reply' | 'forward'): string {
  const base = subject.replace(PREFIX_RE, '').trim();
  return `${kind === 'reply' ? 'Re' : 'Fwd'}: ${base}`.trim();
}

/** Body text of a message for quoting: the text part, else the visible text of the HTML part. */
export function quotableText(message: Pick<MessageDetail, 'text' | 'html'>): string {
  if (message.text && message.text.trim()) return message.text;
  if (message.html?.html) return htmlToText(message.html.html);
  return '';
}

/** `> `-style quote as an HTML blockquote with an attribution line above it. */
export function buildReplyHtml(attribution: string, body: string): string {
  const quoted = textToHtml(body);
  return `<p>${escapeHtml(attribution)}</p><blockquote>${quoted || '<p></p>'}</blockquote>`;
}

export interface ForwardHeaderLabels {
  title: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
}

export function buildForwardHtml(
  labels: ForwardHeaderLabels,
  message: Pick<MessageDetail, 'from' | 'to' | 'cc' | 'subject' | 'date' | 'text' | 'html'>,
  formattedDate: string,
): string {
  const lines = [
    escapeHtml(labels.title),
    `${escapeHtml(labels.from)}: ${escapeHtml(message.from)}`,
    `${escapeHtml(labels.to)}: ${escapeHtml((message.to ?? []).join(', '))}`,
  ];
  if (message.cc?.length)
    lines.push(`${escapeHtml(labels.cc)}: ${escapeHtml(message.cc.join(', '))}`);
  lines.push(`${escapeHtml(labels.subject)}: ${escapeHtml(message.subject)}`);
  lines.push(`${escapeHtml(labels.date)}: ${escapeHtml(formattedDate)}`);
  return `<p>${lines.join('<br>')}</p>${textToHtml(quotableText(message))}`;
}

export interface ReplyRecipients {
  to: string[];
  cc: string[];
}

/** Recipients of a reply; with `all` also the original To/Cc minus the signed-in mailbox. */
export function replyRecipients(
  message: Pick<MessageDetail, 'from' | 'to' | 'cc'>,
  self: string | undefined,
  all: boolean,
): ReplyRecipients {
  const me = self?.toLowerCase();
  const seen = new Set<string>();
  const pick = (entries: string[]): string[] => {
    const out: string[] = [];
    for (const entry of entries) {
      const email = extractEmail(entry);
      const key = email.toLowerCase();
      if (!isPlausibleEmail(email) || key === me || seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
    return out;
  };
  const to = pick([message.from]);
  if (!all) return { to, cc: [] };
  to.push(...pick(message.to ?? []));
  return { to, cc: pick(message.cc ?? []) };
}
