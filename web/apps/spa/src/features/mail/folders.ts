import type { TFunction } from 'i18next';
import type { FolderInfo } from './types';

/** Display order of the system folders; custom folders follow alphabetically. */
const ROLE_ORDER = ['inbox', 'sent', 'drafts', 'spam', 'trash', 'archive'];

export const SYSTEM_ROLES = new Set(ROLE_ORDER);

/** Fallback list shown while the folder list is loading, so the sidebar never jumps. */
export function defaultFolders(): FolderInfo[] {
  return ROLE_ORDER.map((role) => ({
    id: role,
    name: role,
    role,
    unread_count: 0,
    total_count: 0,
  }));
}

export function sortFolders(folders: FolderInfo[]): FolderInfo[] {
  const rank = (f: FolderInfo) => {
    const i = ROLE_ORDER.indexOf(f.role);
    return i === -1 ? ROLE_ORDER.length : i;
  };
  return [...folders].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Localised folder name. System folders are named by role (the server returns the IMAP names,
 * which vary: "Sent Messages", "Junk", ...); custom folders keep their own name.
 */
export function folderLabel(
  folder: Pick<FolderInfo, 'id' | 'role' | 'name'> | undefined,
  folderId: string,
  t: TFunction,
): string {
  const role = folder?.role ?? (SYSTEM_ROLES.has(folderId) ? folderId : undefined);
  if (role && SYSTEM_ROLES.has(role)) return t(`nav.mail.${role}`);
  if (folder) return folder.name;
  return folderId.startsWith('f-') ? t('mail.folders.custom') : folderId;
}

/** A user-created folder: the only kind that can be renamed or deleted. */
export function isCustomFolder(folder: Pick<FolderInfo, 'role'>): boolean {
  return !SYSTEM_ROLES.has(folder.role);
}

/** Folders a message can be moved to: everything but the current folder and Drafts. */
export function moveTargets(folders: FolderInfo[], currentId: string): FolderInfo[] {
  return folders.filter((f) => f.id !== currentId && f.role !== 'drafts');
}
