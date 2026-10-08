import type { TFunction } from 'i18next';
import {
  buildForwardHtml,
  buildReplyHtml,
  quotableText,
  replyRecipients,
  subjectWithPrefix,
  textToHtml,
} from './composeText';
import { recallDraftReply } from './draftReply';
import { sanitizeEmailHtml } from './sanitizeEmailHtml';
import type { AttachmentInfo, DraftItem, MessageDetail } from './types';

/** What the composer was opened for (query string of `/mail/compose`). */
export interface ComposeOpened {
  draft?: string;
  replyTo?: string;
  forward?: string;
  all: boolean;
  to: string;
  subject: string;
}

export function parseComposeParams(params: URLSearchParams): ComposeOpened {
  return {
    draft: params.get('draft') || undefined,
    replyTo: params.get('replyTo') || undefined,
    forward: params.get('forward') || undefined,
    all: params.get('all') === '1',
    to: params.get('to') || '',
    subject: params.get('subject') || '',
  };
}

/** An attachment that already lives inside the saved draft (identified by its MIME index). */
export interface KeptAttachment {
  index: number;
  name: string;
  size: number;
}

export function toKept(list: AttachmentInfo[] | undefined, fallbackName: string): KeptAttachment[] {
  return (list ?? [])
    .filter((a) => !a.inline)
    .map((a) => ({ index: a.index, name: a.name || fallbackName, size: a.size }));
}

export interface ComposeInitial {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  kept: KeptAttachment[];
  forwardAtts: AttachmentInfo[];
  inReplyTo?: string;
  /** Id of the message being replied to (drives the `\\Answered` flag on send). */
  replyToId?: string;
  draftId?: string;
}

export interface BuildInitialArgs {
  opened: ComposeOpened;
  draft?: DraftItem;
  original?: MessageDetail;
  /** Sanitized HTML of the default signature ('' for none). */
  signatureHtml: string;
  selfEmail?: string;
  t: TFunction;
}

/**
 * A draft can hold a received message (moved to Drafts) with its remote images. The editor runs
 * in the app origin, so those must not load: blank them before the HTML reaches the editor.
 */
export function withoutRemoteImages(html: string): string {
  return sanitizeEmailHtml(html, { allowRemoteImages: false }).html;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Initial field values and editor content for a new message, a reply, a forward or a draft. */
export function buildInitialCompose({
  opened,
  draft,
  original,
  signatureHtml,
  selfEmail,
  t,
}: BuildInitialArgs): ComposeInitial {
  const blank: ComposeInitial = {
    to: opened.to,
    cc: '',
    bcc: '',
    subject: opened.subject,
    html: signatureHtml ? `<p></p>${signatureHtml}` : '<p></p>',
    kept: [],
    forwardAtts: [],
  };

  if (opened.draft) {
    if (!draft) return { ...blank, to: '', subject: '', html: '<p></p>' };
    return {
      to: (draft.to ?? []).join(', '),
      cc: (draft.cc ?? []).join(', '),
      bcc: (draft.bcc ?? []).join(', '),
      subject: draft.subject,
      html:
        (draft.html ? withoutRemoteImages(draft.html) : '') ||
        textToHtml(draft.text ?? '') ||
        '<p></p>',
      kept: toKept(draft.attachments, t('mail.compose.unnamedAttachment')),
      forwardAtts: [],
      inReplyTo: draft.in_reply_to ?? undefined,
      replyToId: draft.in_reply_to ? recallDraftReply(draft.id) : undefined,
      draftId: draft.id,
    };
  }

  if (opened.replyTo && original) {
    const r = replyRecipients(original, selfEmail, opened.all);
    return {
      ...blank,
      replyToId: opened.replyTo,
      to: r.to.join(', '),
      cc: r.cc.join(', '),
      subject: subjectWithPrefix(original.subject, 'reply'),
      html:
        `<p></p>${signatureHtml}` +
        buildReplyHtml(
          t('mail.compose.quoteHeader', { date: formatWhen(original.date), from: original.from }),
          quotableText(original),
        ),
    };
  }

  if (opened.forward && original) {
    return {
      ...blank,
      subject: subjectWithPrefix(original.subject, 'forward'),
      forwardAtts: (original.attachments ?? []).filter((a) => !a.inline),
      html:
        `<p></p>${signatureHtml}` +
        buildForwardHtml(
          {
            title: t('mail.compose.forwardTitle'),
            from: t('mail.compose.fwdFrom'),
            to: t('mail.compose.fwdTo'),
            cc: t('mail.compose.fwdCc'),
            subject: t('mail.compose.fwdSubject'),
            date: t('mail.compose.fwdDate'),
          },
          original,
          formatWhen(original.date),
        ),
    };
  }

  return blank;
}
