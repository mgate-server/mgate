import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import { cn } from '@mgate/ui';
import { formatMailDate } from './format';
import type { MessageSummary } from './types';

export interface ThreadStripProps {
  folderId: string;
  currentId: string;
  messages: MessageSummary[];
}

/**
 * The other messages of the conversation, oldest first, shown inside the reader. Opening one of
 * them makes it the current message; the strip stays in place.
 */
export function ThreadStrip({ folderId, currentId, messages }: ThreadStripProps) {
  const { t } = useTranslation();
  if (messages.length < 2) return null;

  const ordered = [...messages].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  return (
    <section
      aria-label={t('mail.thread.title')}
      className="border-mg-border bg-mg-surface-subtle/50 rounded-xl border"
    >
      <h2 className="border-mg-border text-mg-text-muted flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold tracking-wider uppercase">
        <MessagesSquare className="h-3.5 w-3.5" />
        {t('mail.thread.title')} ({messages.length})
      </h2>
      <ul className="divide-mg-border divide-y">
        {ordered.map((m) => {
          const current = m.id === currentId;
          return (
            <li key={m.id}>
              <Link
                to={`/mail/${m.folder || folderId}/${m.id}`}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'hover:bg-mg-surface-subtle flex items-baseline gap-3 px-3 py-2 text-xs transition-colors',
                  current && 'bg-mg-primary/5 dark:bg-mg-primary/10',
                )}
              >
                <span
                  className={cn('w-40 shrink-0 truncate', !m.read ? 'font-bold' : 'font-medium')}
                >
                  {m.from}
                </span>
                <span className="text-mg-text-muted min-w-0 flex-1 truncate">{m.preview}</span>
                <span className="text-mg-text-muted shrink-0 text-[11px]">
                  {formatMailDate(m.date)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
