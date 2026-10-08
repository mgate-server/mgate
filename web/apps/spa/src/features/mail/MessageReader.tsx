import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertOctagon,
  Archive,
  ArrowLeft,
  Download,
  FileText,
  Forward,
  Mail,
  Paperclip,
  Printer,
  Reply,
  ReplyAll,
  Star,
  Trash2,
} from 'lucide-react';
import { Avatar, Button, cn } from '@mgate/ui';
import { AuthResultsBadge } from './AuthResultsBadge';
import { SafeHtmlRenderer } from './SafeHtmlRenderer';
import { folderLabel } from './folders';
import { formatBytes } from './format';
import { mailApi } from './mailApi';
import type { FolderInfo, MessageDetail, RemoteImagesPolicy } from './types';

export interface MessageReaderProps {
  message: MessageDetail;
  remoteImages: RemoteImagesPolicy;
  /** Hide "archive" when already in the archive. */
  canArchive: boolean;
  /** Hide "spam" in Spam itself (and wherever the message cannot be reported). */
  canSpam?: boolean;
  /** Folders offered by "move to" (the current folder and Drafts already left out). */
  moveTargets?: FolderInfo[];
  /** Thread strip rendered between the header and the body. */
  thread?: ReactNode;
  busy?: boolean;
  onBack: () => void;
  onReply: (all: boolean) => void;
  onForward: () => void;
  onArchive: () => void;
  onSpam?: () => void;
  onMove?: (folderId: string) => void;
  onDelete: () => void;
  onToggleFlag: () => void;
  onToggleRead: () => void;
}

/** The open message: toolbar, header, sanitized body (sandboxed iframe), attachments. */
export function MessageReader({
  message,
  remoteImages,
  canArchive,
  canSpam = false,
  moveTargets = [],
  thread,
  busy,
  onBack,
  onReply,
  onForward,
  onArchive,
  onSpam,
  onMove,
  onDelete,
  onToggleFlag,
  onToggleRead,
}: MessageReaderProps) {
  const { t } = useTranslation();
  const attachments = (message.attachments ?? []).filter((a) => !a.inline);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-mg-border bg-mg-surface flex flex-wrap items-center justify-between gap-1 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onBack}
            title={t('common.back')}
            className="lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <Button size="sm" variant="outline" onClick={() => onReply(false)} className="gap-1.5">
            <Reply className="h-3.5 w-3.5" />
            <span>{t('mail.reader.reply')}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReply(true)}
            title={t('mail.reader.replyAll')}
            className="gap-1.5"
          >
            <ReplyAll className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={onForward} className="gap-1.5">
            <Forward className="h-3.5 w-3.5" />
            <span>{t('mail.reader.forward')}</span>
          </Button>

          <div className="bg-mg-border mx-1.5 h-4 w-px" />

          {canArchive ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onArchive}
              title={t('mail.reader.archive')}
            >
              <Archive className="h-4 w-4" />
            </Button>
          ) : null}
          {canSpam && onSpam ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onSpam}
              title={t('mail.reader.spam')}
              aria-label={t('mail.reader.spam')}
            >
              <AlertOctagon className="h-4 w-4" />
            </Button>
          ) : null}
          {onMove && moveTargets.length > 0 ? (
            <select
              aria-label={t('mail.reader.moveTo')}
              title={t('mail.reader.moveTo')}
              disabled={busy}
              value=""
              onChange={(e) => {
                if (e.target.value) onMove(e.target.value);
              }}
              className="border-mg-border bg-mg-surface text-mg-text-muted hover:text-mg-text h-8 max-w-40 rounded-md border px-2 text-xs"
            >
              <option value="">{t('mail.reader.moveTo')}</option>
              {moveTargets.map((f) => (
                <option key={f.id} value={f.id}>
                  {folderLabel(f, f.id, t)}
                </option>
              ))}
            </select>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onDelete}
            title={t('mail.reader.delete')}
            className="text-mg-danger hover:text-mg-danger hover:bg-mg-danger/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onToggleFlag}
            title={message.flagged ? t('mail.reader.unflag') : t('mail.reader.flag')}
            aria-pressed={message.flagged}
          >
            <Star
              className={cn(
                'h-4 w-4',
                message.flagged ? 'fill-amber-400 text-amber-400' : 'text-mg-text-muted',
              )}
            />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onToggleRead}
            title={message.read ? t('mail.reader.markUnread') : t('mail.reader.markRead')}
          >
            <Mail className="text-mg-text-muted h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <a
            href={mailApi.rawUrl(message.id)}
            download="message.eml"
            title={t('mail.reader.downloadEml')}
            aria-label={t('mail.reader.downloadEml')}
            className="hover:bg-mg-border/40 inline-flex h-8 items-center justify-center rounded-md px-3"
          >
            <Download className="text-mg-text-muted h-4 w-4" />
          </a>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.print()}
            title={t('mail.reader.print')}
          >
            <Printer className="text-mg-text-muted h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-mg-text text-xl font-bold tracking-tight">
              {message.subject || t('mail.reader.noSubject')}
            </h1>
            <AuthResultsBadge authenticationResults={message.authentication_results ?? null} />
          </div>

          <div className="border-mg-border flex items-center justify-between border-b pb-4">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar email={message.from} size="md" />
              <div className="min-w-0">
                <div className="text-mg-text truncate text-sm font-semibold">{message.from}</div>
                <div className="text-mg-text-muted text-xs">
                  {t('mail.reader.to')}: {(message.to ?? []).join(', ')}
                  {message.cc?.length ? ` | ${t('mail.reader.cc')}: ${message.cc.join(', ')}` : ''}
                  {message.bcc?.length
                    ? ` | ${t('mail.reader.bcc')}: ${message.bcc.join(', ')}`
                    : ''}
                </div>
              </div>
            </div>
            <div className="text-mg-text-muted shrink-0 pl-2 text-xs">
              {new Date(message.date).toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </div>
          </div>
        </div>

        {thread}

        <div className="prose prose-sm dark:prose-invert max-w-none">
          {message.too_large ? (
            <div
              role="status"
              className="not-prose border-mg-border bg-mg-surface-subtle text-mg-text-muted rounded-lg border p-4 text-sm"
            >
              <p>{t('mail.reader.tooLarge')}</p>
              <a
                href={mailApi.rawUrl(message.id)}
                download="message.eml"
                className="text-mg-primary mt-2 inline-flex items-center gap-1.5 hover:underline"
              >
                <Download className="h-4 w-4" />
                {t('mail.reader.downloadEml')}
              </a>
            </div>
          ) : message.html ? (
            <SafeHtmlRenderer
              key={message.id}
              html={message.html.html}
              remoteImages={remoteImages}
              blockedRemote={message.html.blocked_remote}
            />
          ) : (
            <pre className="text-mg-text font-sans text-sm whitespace-pre-wrap">{message.text}</pre>
          )}
        </div>

        {attachments.length > 0 ? (
          <div className="border-mg-border bg-mg-surface-subtle space-y-3 rounded-xl border p-4">
            <div className="text-mg-text-muted flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
              <Paperclip className="h-3.5 w-3.5" />
              <span>
                {t('mail.reader.attachments')} ({attachments.length})
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {attachments.map((a) => {
                const name = a.name || t('mail.reader.attachmentFallback', { index: a.index + 1 });
                return (
                  <a
                    key={a.index}
                    href={mailApi.attachmentUrl(message.id, a.index)}
                    download={name}
                    className="border-mg-border bg-mg-surface hover:border-mg-primary/50 flex items-center justify-between rounded-lg border p-2.5 text-xs transition-colors"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <FileText className="text-mg-primary h-4 w-4 shrink-0" />
                      <div className="truncate">
                        <div className="text-mg-text truncate font-medium">{name}</div>
                        <div className="text-mg-text-muted text-[10px]">{formatBytes(a.size)}</div>
                      </div>
                    </div>
                    <Download className="text-mg-text-muted hover:text-mg-text h-4 w-4 shrink-0" />
                  </a>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
