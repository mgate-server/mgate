import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Globe,
  Mail,
  AtSign,
  Share2,
  Users,
  Inbox,
  Layers,
  ScrollText,
  BarChart3,
  Lock,
  ShieldCheck,
  UserCheck,
  Settings,
  KeyRound,
  DownloadCloud,
  BookOpen,
} from 'lucide-react';
import { SidebarShell } from '@mgate/ui';
import { useAuth } from '../../auth/AuthContext';
import { NavList } from './NavList';
import type { NavItem } from './NavList';
import { TopBar } from './TopBar';

import { BreadcrumbsProvider, Breadcrumbs } from './Breadcrumbs';

const SUPER_ADMIN_ONLY = new Set([
  '/admin/queue',
  '/admin/certificates',
  '/admin/security',
  '/admin/admins',
  '/admin/settings',
  '/admin/license',
]);

/** Shell for every `/admin/*` route (RBAC: SuperAdmin/DomainAdmin only). */
export function AdminLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SuperAdmin';

  const allItems: NavItem[] = [
    // Section 1: Dashboard
    {
      to: '/admin',
      label: t('nav.admin.dashboard', 'Обзор'),
      end: true,
      icon: LayoutDashboard,
    },

    // Section 2: Mail
    {
      to: '/admin/domains',
      label: t('nav.admin.domains', 'Домены'),
      icon: Globe,
      sectionTitle: t('nav.admin.mailSection', 'Почтовая система'),
    },
    {
      to: '/admin/mailboxes',
      label: t('nav.admin.mailboxes', 'Почтовые ящики'),
      icon: Mail,
    },
    {
      to: '/admin/migration',
      label: t('nav.admin.migration', 'Импорт и миграция'),
      icon: DownloadCloud,
    },

    // Section 3: Monitoring & Operations
    {
      to: '/admin/queue',
      label: t('nav.admin.queue', 'Очередь писем'),
      icon: Layers,
      sectionTitle: t('nav.admin.opsSection', 'Мониторинг и операции'),
    },
    {
      to: '/admin/logs',
      label: t('nav.admin.logs', 'Журнал событий'),
      icon: ScrollText,
    },
    {
      to: '/admin/statistics',
      label: t('nav.admin.statistics', 'Статистика'),
      icon: BarChart3,
    },

    // Section 4: Security & System
    {
      to: '/admin/certificates',
      label: t('nav.admin.certificates', 'SSL-сертификаты'),
      icon: Lock,
      sectionTitle: t('nav.admin.systemSection', 'Система и безопасность'),
    },
    {
      to: '/admin/security',
      label: t('nav.admin.security', 'Политики безопасности'),
      icon: ShieldCheck,
    },
    {
      to: '/admin/admins',
      label: t('nav.admin.admins', 'Администраторы'),
      icon: UserCheck,
    },
    {
      to: '/admin/settings',
      label: t('nav.admin.settings', 'Настройки сервера'),
      icon: Settings,
    },
    {
      to: '/admin/license',
      label: t('nav.admin.license', 'Лицензия'),
      icon: KeyRound,
    },

    // Section 5: Help & Support
    {
      to: '/admin/docs',
      label: t('nav.admin.docs', 'Документация'),
      icon: BookOpen,
      sectionTitle: t('nav.admin.helpSection', 'Справка и поддержка'),
    },
  ];

  const items = allItems.filter((item) => isSuperAdmin || !SUPER_ADMIN_ONLY.has(item.to));

  return (
    <BreadcrumbsProvider>
      <SidebarShell
        sidebar={
          <div className="flex h-full flex-col">
            {/* Admin Sidebar Header */}
            <div className="border-mg-border-subtle flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-mg-primary h-4 w-4" />
                <span className="text-mg-text text-xs font-semibold tracking-tight">
                  {t('layout.adminTitle', 'Администрирование')}
                </span>
              </div>
              <span className="bg-mg-surface-subtle text-mg-text-muted border-mg-border-subtle rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase">
                {isSuperAdmin ? 'Super' : 'Domain'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              <NavList items={items} />
            </div>
          </div>
        }
        topbar={<TopBar title={t('layout.adminTitle', 'Панель администратора')} />}
      >
        <div className="space-y-4">
          <Breadcrumbs />
          <Outlet />
        </div>
      </SidebarShell>
    </BreadcrumbsProvider>
  );
}
