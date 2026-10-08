import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Inbox,
  Send,
  FileText,
  AlertOctagon,
  Trash2,
  Archive,
  Folder,
  PenSquare,
  Users,
  Settings,
  FolderCog,
} from 'lucide-react';
import { SidebarShell, Button, QuotaBar } from '@mgate/ui';
import { NavList, type NavEntry } from './NavList';
import { TopBar } from './TopBar';
import { apiClient } from '../../lib/apiClient';
import { useAuth } from '../../auth/AuthContext';
import { defaultFolders, folderLabel } from '../../features/mail/folders';
import { FolderManager } from '../../features/mail/FolderManager';
import { isMailApiError } from '../../features/mail/mailApi';
import { MailUnavailable, type MailBlockReason } from '../../features/mail/MailUnavailable';
import { isFatalMailError, useFolders } from '../../features/mail/useFolders';
import { useMailPush } from '../../features/mail/useMailPush';

const FOLDER_ICONS: Record<string, typeof Inbox> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  spam: AlertOctagon,
  trash: Trash2,
  archive: Archive,
};

const BLOCK_REASONS: readonly string[] = [
  'webmail_requires_mailbox',
  'mailbox_disabled',
  'domain_disabled',
];

/** Why the gateway refuses this session, when it does (403 with a known code). */
function blockReason(error: unknown): MailBlockReason | null {
  if (isMailApiError(error) && error.status === 403 && BLOCK_REASONS.includes(error.code ?? '')) {
    return error.code as MailBlockReason;
  }
  return null;
}

export function MailLayout() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [manageOpen, setManageOpen] = useState(false);

  const { data: folders, error: foldersError } = useFolders();
  const blocked = blockReason(foldersError);
  const sessionGone = isMailApiError(foldersError) && foldersError.status === 401;

  // The session was revoked (logout elsewhere, account disabled): leave to the sign-in screen.
  useEffect(() => {
    if (sessionGone) void logout();
  }, [sessionGone, logout]);

  // Live updates over WebSocket; the 30 s folder poll remains the fallback.
  useMailPush({
    enabled: !isFatalMailError(foldersError),
    onSessionExpired: () => void logout(),
  });

  const { data: quota } = useQuery({
    queryKey: ['account', 'quota'],
    enabled: !blocked,
    retry: false,
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/account/quota');
      if (error) throw error;
      return data;
    },
    staleTime: 60000,
  });

  const activeFolders = folders && folders.length > 0 ? folders : defaultFolders();

  const folderEntries: NavEntry[] = activeFolders.map((f) => {
    const IconComponent = FOLDER_ICONS[f.role] || Folder;
    // Drafts are never "unread": show how many there are instead.
    const count = f.role === 'drafts' ? f.total_count : f.unread_count;
    return {
      to: `/mail/${f.id}`,
      label: folderLabel(f, f.id, t),
      icon: IconComponent,
      badge:
        count > 0 ? (
          <span
            className={
              f.role === 'drafts'
                ? 'bg-mg-surface-subtle text-mg-text-muted rounded-full px-1.5 py-0.5 text-[10px] font-semibold'
                : 'bg-mg-primary rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white shadow-2xs'
            }
          >
            {count}
          </span>
        ) : undefined,
    };
  });

  const toolEntries: NavEntry[] = [
    {
      to: '/mail/contacts',
      label: t('nav.mail.contacts'),
      icon: Users,
    },
    {
      to: '/mail/settings',
      label: t('nav.mail.settings'),
      icon: Settings,
    },
  ];

  return (
    <SidebarShell
      fullHeight
      noPadding
      sidebar={
        blocked ? (
          <div className="p-3" />
        ) : (
          <div className="flex h-full flex-col justify-between p-3">
            <div className="space-y-4">
              {/* Compose primary action */}
              <Link to="/mail/compose" className="block">
                <Button
                  variant="primary"
                  size="md"
                  className="w-full gap-2 font-semibold shadow-xs"
                >
                  <PenSquare className="h-4 w-4" />
                  <span>{t('nav.mail.compose')}</span>
                </Button>
              </Link>

              {/* Folders navigation */}
              <div>
                <NavList sectionTitle={t('mail.folders.title')} items={folderEntries} />
                <button
                  type="button"
                  onClick={() => setManageOpen(true)}
                  className="text-mg-text-muted hover:bg-mg-surface-subtle hover:text-mg-text mx-2 mt-0.5 flex w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all"
                >
                  <FolderCog className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{t('mail.folders.manage')}</span>
                </button>
              </div>

              <div className="border-mg-border border-t" />

              {/* Tools navigation */}
              <NavList sectionTitle={t('mail.tools.title')} items={toolEntries} />
            </div>

            {/* Bottom quota indicator */}
            {quota ? (
              <div className="border-mg-border mt-auto border-t pt-3">
                <QuotaBar
                  usedBytes={quota.used_bytes}
                  totalBytes={quota.quota_bytes}
                  label={t('mail.quota.label')}
                  className="text-xs"
                />
              </div>
            ) : null}
          </div>
        )
      }
      topbar={<TopBar title={t('mail.title')} />}
    >
      {blocked ? <MailUnavailable reason={blocked} /> : <Outlet />}
      <FolderManager
        open={manageOpen && !blocked}
        onClose={() => setManageOpen(false)}
        folders={activeFolders}
        onRenamed={(oldId, renamed) => {
          // A folder id derives from its name: follow the folder that is open right now.
          if (location.pathname.split('/')[2] === oldId) navigate(`/mail/${renamed.id}`);
        }}
        onDeleted={(id) => {
          if (location.pathname.split('/')[2] === id) navigate('/mail/inbox');
        }}
      />
    </SidebarShell>
  );
}
