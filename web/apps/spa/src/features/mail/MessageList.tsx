import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MailOpen, Paperclip, Star } from 'lucide-react';
import { Avatar, Badge, Button, cn } from '@mgate/ui';
import { formatMailDate } from './format';
import { mailErrorMessage } from './errors';
import type { ListDensity, MessageSummary } from './types';

const DENSITY: Record<ListDensity, { row: string; preview: string | null }> = {
  compact: { row: 'px-3.5 py-1.5', preview: null },
  normal: { row: 'px-3.5 py-3', preview: 'line-clamp-2' },
  comfortable: { row: 'px-4 py-4', preview: 'line-clamp-3' },
};

export interface MessageListProps {
  folderId: string;
  messages: MessageSummary[];
  currentId?: string;
  density: ListDensity;
  isLoading: boolean;
  error: unknown;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  /** Link target of a row; defaults to the reader (`/mail/<folder>/<id>`). */
  hrefFor?: (m: MessageSummary) => string;
}

/** Scrollable message list with "load more" pagination; row spacing follows `list_density`. */
export function MessageList({
  folderId,
  messages,
  currentId,
  density,
  isLoading,
  error,
  hasMore,
  isFetchingMore,
  onLoadMore,
  onRetry,
  hrefFor,
}: MessageListProps) {
  const { t } = useTranslation();
  const d = DENSITY[density];

  if (isLoading) {
    return (
      <div className="text-mg-text-muted flex h-40 items-center justify-center text-xs">
        {t('mail.list.loading')}
      </div>
    );
  }

  if (error && messages.length === 0) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-mg-danger text-xs">{mailErrorMessage(error, t)}</p>
        <Button size="xs" variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <MailOpen className="text-mg-text-muted/40 h-10 w-10" />
        <p className="text-mg-text-muted mt-3 text-xs font-medium">{t('mail.list.empty')}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-mg-border divide-y" data-density={density}>
        {messages.map((m) => (
          <li key={m.id}>
            <Link
              to={hrefFor ? hrefFor(m) : `/mail/${m.folder || folderId}/${m.id}`}
              className={cn(
                'group hover:bg-mg-surface-subtle/80 relative flex gap-3 transition-colors',
                d.row,
                currentId === m.id
                  ? 'bg-mg-primary/5 dark:bg-mg-primary/10 border-mg-primary border-l-2'
                  : 'border-l-2 border-transparent',
                !m.read && 'bg-mg-surface-subtle/40',
              )}
            >
              {density !== 'compact' ? (
                <Avatar email={m.from} size="sm" className="mt-0.5" />
              ) : null}

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 truncate">
                    {!m.read ? (
                      <span className="bg-mg-primary h-2 w-2 shrink-0 rounded-full" />
                    ) : null}
                    <span
                      className={cn(
                        'truncate text-xs',
                        !m.read ? 'text-mg-text font-bold' : 'text-mg-text/90 font-medium',
                      )}
                    >
                      {m.from}
                    </span>
                  </div>
                  <span className="text-mg-text-muted shrink-0 text-[11px]">
                    {formatMailDate(m.date)}
                  </span>
                </div>

                <div className="mt-1 flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      'truncate text-xs',
                      !m.read ? 'text-mg-text font-semibold' : 'text-mg-text/80',
                    )}
                  >
                    {m.subject || t('mail.reader.noSubject')}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    {m.flagged ? <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> : null}
                    {m.has_attachments ? (
                      <Paperclip className="text-mg-text-muted h-3 w-3" />
                    ) : null}
                    {m.thread_count > 1 ? <Badge tone="neutral">{m.thread_count}</Badge> : null}
                  </div>
                </div>

                {d.preview ? (
                  <p className={cn('text-mg-text-muted mt-0.5 text-[11px]', d.preview)}>
                    {m.preview}
                  </p>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="text-mg-danger px-4 pt-3 text-center text-xs">
          {mailErrorMessage(error, t)}
        </p>
      ) : null}

      {hasMore ? (
        <div className="p-3 text-center">
          <Button
            size="sm"
            variant="secondary"
            isLoading={isFetchingMore}
            onClick={onLoadMore}
            className="w-full"
          >
            {t('mail.list.loadMore')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
