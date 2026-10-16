import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailOpen, RotateCw, Search } from 'lucide-react';
import { cn } from '@mgate/ui';
import { mailErrorMessage } from '../../features/mail/errors';
import { folderLabel, moveTargets } from '../../features/mail/folders';
import { isMailApiError, mailApi } from '../../features/mail/mailApi';
import { MessageList } from '../../features/mail/MessageList';
import { MessageReader } from '../../features/mail/MessageReader';
import { ThreadStrip } from '../../features/mail/ThreadStrip';
import { useFolders } from '../../features/mail/useFolders';
import { useMailPrefs, useMailSettingsQuery } from '../../features/mail/useMailPrefs';
import type {
  MessageDetail,
  MessageList as MessageListPage,
  MessageSummary,
} from '../../features/mail/types';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const MAX_QUERY_CHARS = 256;

/** Debounced copy of a value. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Keyed by folder: switching folders starts with a clean search and filter state. */
export function MailFolderPage() {
  const { folderId = 'inbox' } = useParams<{ folderId: string }>();
  return <FolderView key={folderId} />;
}

function FolderView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { folderId = 'inbox', messageId } = useParams<{ folderId: string; messageId?: string }>();

  const prefs = useMailPrefs();
  const settings = useMailSettingsQuery();
  const { data: folders } = useFolders();
  const folder = folders?.find((f) => f.id === folderId);
  const role = folder?.role ?? folderId;

  const [searchInput, setSearchInput] = useState('');
  const [searchAll, setSearchAll] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const debouncedInput = useDebounced(searchInput.trim(), SEARCH_DEBOUNCE_MS);
  // Clearing the box applies at once; typing waits for a pause.
  const searchQuery = searchInput.trim() ? debouncedInput : '';

  const crossFolder = searchAll && searchQuery.length > 0;

  const list = useInfiniteQuery({
    queryKey: [
      'mail',
      'messages',
      folderId,
      { q: searchQuery, all: crossFolder, unread: unreadOnly, flagged: flaggedOnly },
    ],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }): Promise<MessageListPage> =>
      crossFolder
        ? mailApi.search(searchQuery, signal)
        : mailApi.messages({
            folder: folderId,
            page: pageParam,
            perPage: PAGE_SIZE,
            q: searchQuery,
            unread: unreadOnly,
            flagged: flaggedOnly,
            signal,
          }),
    getNextPageParam: (last, pages) => {
      if (crossFolder || last.messages.length === 0) return undefined;
      const loaded = pages.reduce((n, p) => n + p.messages.length, 0);
      return loaded < last.total ? pages.length + 1 : undefined;
    },
    retry: (count, error) => !(isMailApiError(error) && error.status < 500) && count < 1,
  });

  const messages = useMemo(() => {
    const seen = new Set<string>();
    const out: MessageSummary[] = [];
    for (const page of list.data?.pages ?? []) {
      for (const m of page.messages) {
        if (seen.has(m.id)) continue; // new mail shifts pages: a message may appear twice
        seen.add(m.id);
        out.push(m);
      }
    }
    return out;
  }, [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const selectedSummary = messages.find((m) => m.id === messageId);

  const detailKey = ['mail', 'message', messageId] as const;
  const settingsSettled = settings.isSuccess || settings.isError;
  const detail = useQuery({
    queryKey: detailKey,
    enabled: !!messageId && folderId !== 'drafts' && settingsSettled,
    queryFn: async ({ signal }): Promise<MessageDetail> => {
      // Opening marks the message read on the server. Refetching one the user has just marked
      // unread again would undo that, so a refetch of an already-read message only peeks.
      const cached = queryClient.getQueryData<MessageDetail>(detailKey);
      const d = await mailApi.message(messageId!, { peek: cached?.read === true, signal });
      if (!d.read && prefs.mark_read_on_open) {
        void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] });
        void queryClient.invalidateQueries({ queryKey: ['mail', 'folders'] });
        return { ...d, read: true };
      }
      return d;
    },
    retry: (count, error) => !(isMailApiError(error) && error.status < 500) && count < 1,
  });

  const threadId =
    selectedSummary && selectedSummary.thread_count > 1 ? selectedSummary.thread_id : undefined;
  const thread = useQuery({
    queryKey: ['mail', 'thread', threadId],
    enabled: !!threadId,
    queryFn: ({ signal }) => mailApi.thread(threadId!, signal),
    retry: false,
    staleTime: 30_000,
  });

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] });
    void queryClient.invalidateQueries({ queryKey: ['mail', 'folders'] });
    void queryClient.invalidateQueries({ queryKey: ['mail', 'thread'] });
  };

  const leaveMessage = (id: string) => {
    queryClient.removeQueries({ queryKey: ['mail', 'message', id] });
    refreshLists();
    navigate(`/mail/${folderId}`);
  };

  const flagMutation = useMutation({
    mutationFn: (flagged: boolean) => mailApi.patchMessage(messageId!, { flagged }),
    onSuccess: (_r, flagged) => {
      queryClient.setQueryData<MessageDetail>(detailKey, (d) => (d ? { ...d, flagged } : d));
      refreshLists();
    },
  });
  const readMutation = useMutation({
    mutationFn: (read: boolean) => mailApi.patchMessage(messageId!, { read }),
    onSuccess: (_r, read) => {
      queryClient.setQueryData<MessageDetail>(detailKey, (d) => (d ? { ...d, read } : d));
      refreshLists();
    },
  });
  const archiveMutation = useMutation({
    mutationFn: () => mailApi.patchMessage(messageId!, { folder: 'archive' }),
    onSuccess: () => leaveMessage(messageId!),
  });
  const moveMutation = useMutation({
    mutationFn: (target: string) => mailApi.patchMessage(messageId!, { folder: target }),
    onSuccess: () => leaveMessage(messageId!),
  });
  const spamMutation = useMutation({
    mutationFn: () => mailApi.learnSpam(messageId!),
    onSuccess: () => leaveMessage(messageId!),
  });
  const notSpamMutation = useMutation({
    mutationFn: () => mailApi.learnHam(messageId!),
    onSuccess: () => leaveMessage(messageId!),
  });
  const deleteMutation = useMutation({
    mutationFn: () => mailApi.deleteMessage(messageId!),
    onSuccess: () => leaveMessage(messageId!),
  });

  const busy =
    flagMutation.isPending ||
    readMutation.isPending ||
    archiveMutation.isPending ||
    moveMutation.isPending ||
    spamMutation.isPending ||
    notSpamMutation.isPending ||
    deleteMutation.isPending;
  const actionError =
    flagMutation.error ??
    readMutation.error ??
    archiveMutation.error ??
    moveMutation.error ??
    spamMutation.error ??
    notSpamMutation.error ??
    deleteMutation.error;

  // A stale id (the mailbox changed under us) is not worth a retry: show it and refresh the list.
  useEffect(() => {
    if (detail.error) refreshLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.error]);

  if (folderId === 'drafts' && messageId) {
    return <Navigate to={`/mail/compose?draft=${encodeURIComponent(messageId)}`} replace />;
  }

  const openMessage = detail.data;
  const inTrash = role === 'trash' || role === 'spam';

  const goCompose = (params: Record<string, string>) =>
    navigate(`/mail/compose?${new URLSearchParams(params).toString()}`);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Pane 1: message list */}
      <div
        className={cn(
          'border-mg-border bg-mg-surface shrink-0 flex-col border-r lg:flex lg:w-[380px] xl:w-[420px]',
          messageId ? 'hidden w-full' : 'flex w-full',
        )}
      >
        <div className="border-mg-border space-y-2 border-b p-3">
          <div className="relative flex items-center">
            <Search className="text-mg-text-muted pointer-events-none absolute left-3 h-4 w-4" />
            <input
              type="search"
              value={searchInput}
              maxLength={MAX_QUERY_CHARS}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('mail.search.placeholder')}
              aria-label={t('mail.search.placeholder')}
              className="border-mg-border bg-mg-surface-subtle text-mg-text placeholder:text-mg-text-muted focus:border-mg-primary focus:bg-mg-surface focus:ring-mg-primary w-full rounded-lg border py-1.5 pr-8 pl-9 text-xs transition-all focus:ring-1 focus:outline-none"
            />
            {list.isFetching ? (
              <RotateCw className="text-mg-text-muted absolute right-3 h-3.5 w-3.5 animate-spin" />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <FilterChip active={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>
              {t('mail.search.unreadOnly')}
            </FilterChip>
            <FilterChip active={flaggedOnly} onClick={() => setFlaggedOnly((v) => !v)}>
              {t('mail.search.flaggedOnly')}
            </FilterChip>
            <FilterChip active={searchAll} onClick={() => setSearchAll((v) => !v)}>
              {t('mail.search.allFolders')}
            </FilterChip>
          </div>

          <div className="text-mg-text-muted flex items-center justify-between text-xs">
            <span className="font-semibold tracking-wider uppercase">
              {crossFolder ? t('mail.search.results') : folderLabel(folder, folderId, t)}
            </span>
            <div className="flex items-center gap-2">
              <span>{t('mail.list.count', { count: total })}</span>
              <button
                type="button"
                onClick={() => void list.refetch()}
                className="text-mg-text-muted hover:bg-mg-surface-subtle hover:text-mg-text rounded p-1"
                title={t('mail.list.refresh')}
                aria-label={t('mail.list.refresh')}
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {actionError ? (
          <p
            role="alert"
            className="border-mg-border bg-mg-danger/10 text-mg-danger border-b px-3 py-2 text-xs"
          >
            {mailErrorMessage(actionError, t)}
          </p>
        ) : null}

        <div className="flex-1 overflow-y-auto">
          <MessageList
            folderId={folderId}
            messages={messages}
            currentId={messageId}
            density={prefs.list_density}
            isLoading={list.isLoading}
            error={list.error}
            hasMore={!!list.hasNextPage}
            isFetchingMore={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            onRetry={() => void list.refetch()}
            hrefFor={
              role === 'drafts'
                ? (m) => `/mail/compose?draft=${encodeURIComponent(m.id)}`
                : undefined
            }
          />
        </div>
      </div>

      {/* Pane 2: reader */}
      <div
        className={cn(
          'bg-mg-surface flex-1 flex-col overflow-hidden lg:flex',
          messageId ? 'flex' : 'hidden',
        )}
      >
        {detail.isLoading ? (
          <div className="text-mg-text-muted flex flex-1 items-center justify-center text-xs">
            {t('mail.reader.loading')}
          </div>
        ) : detail.error ? (
          <div
            role="alert"
            className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
          >
            <p className="text-mg-danger text-sm">{mailErrorMessage(detail.error, t)}</p>
            <button
              type="button"
              className="text-mg-primary text-xs hover:underline"
              onClick={() => navigate(`/mail/${folderId}`)}
            >
              {t('mail.reader.backToList')}
            </button>
          </div>
        ) : openMessage && messageId ? (
          <MessageReader
            message={openMessage}
            remoteImages={prefs.remote_images}
            canArchive={role !== 'archive'}
            canSpam={role !== 'spam'}
            canNotSpam={role === 'spam'}
            moveTargets={moveTargets(folders ?? [], folderId)}
            busy={busy}
            thread={
              thread.data && thread.data.messages.length > 1 ? (
                <ThreadStrip
                  folderId={folderId}
                  currentId={openMessage.id}
                  messages={thread.data.messages}
                />
              ) : null
            }
            onBack={() => navigate(`/mail/${folderId}`)}
            onReply={(all) =>
              goCompose(all ? { replyTo: openMessage.id, all: '1' } : { replyTo: openMessage.id })
            }
            onForward={() => goCompose({ forward: openMessage.id })}
            onArchive={() => archiveMutation.mutate()}
            onSpam={() => spamMutation.mutate()}
            onNotSpam={() => notSpamMutation.mutate()}
            onMove={(target) => moveMutation.mutate(target)}
            onDelete={() => {
              if (inTrash && !confirm(t('mail.reader.confirmDeleteForever'))) return;
              deleteMutation.mutate();
            }}
            onToggleFlag={() => flagMutation.mutate(!openMessage.flagged)}
            onToggleRead={() => readMutation.mutate(!openMessage.read)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="bg-mg-surface-subtle text-mg-text-muted/50 flex h-16 w-16 items-center justify-center rounded-full">
              <MailOpen className="h-8 w-8" />
            </div>
            <h3 className="text-mg-text mt-4 text-sm font-semibold">
              {t('mail.reader.noSelectionTitle')}
            </h3>
            <p className="text-mg-text-muted mt-1 max-w-sm text-xs">
              {t('mail.reader.noSelectionDesc')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 transition-colors',
        active
          ? 'border-mg-primary bg-mg-primary/10 text-mg-primary font-semibold'
          : 'border-mg-border text-mg-text-muted hover:bg-mg-surface-subtle hover:text-mg-text',
      )}
    >
      {children}
    </button>
  );
}
