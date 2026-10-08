import { useQuery } from '@tanstack/react-query';
import { isMailApiError, mailApi } from './mailApi';
import { sortFolders } from './folders';
import type { FolderInfo } from './types';

export const FOLDERS_KEY = ['mail', 'folders'] as const;

/** Codes after which retrying or polling is pointless: the session cannot use webmail at all. */
const FATAL_CODES = new Set(['webmail_requires_mailbox', 'mailbox_disabled', 'domain_disabled']);

export function isFatalMailError(e: unknown): boolean {
  return (
    isMailApiError(e) && (e.status === 401 || (e.status === 403 && FATAL_CODES.has(e.code ?? '')))
  );
}

/** Folder list, refreshed by push events and (as a fallback) polled every 30 s. */
export function useFolders() {
  return useQuery<FolderInfo[]>({
    queryKey: FOLDERS_KEY,
    queryFn: async ({ signal }) => sortFolders((await mailApi.folders(signal)) ?? []),
    refetchInterval: (query) => (isFatalMailError(query.state.error) ? false : 30_000),
    retry: (count, error) => !isFatalMailError(error) && count < 1,
  });
}
