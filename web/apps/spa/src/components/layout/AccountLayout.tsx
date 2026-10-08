import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  User,
  KeyRound,
  Shield,
  Key,
  Laptop,
  Plane,
  Filter,
  Share2,
  Sliders,
  DownloadCloud,
} from 'lucide-react';
import { SidebarShell } from '@mgate/ui';
import { extensionRegistry } from '../../lib/extensions';
import { NavList } from './NavList';
import type { NavItem } from './NavList';
import { TopBar } from './TopBar';

import { BreadcrumbsProvider, Breadcrumbs } from './Breadcrumbs';

/** Shell for every `/account/*` self-service route. */
export function AccountLayout() {
  const { t } = useTranslation();

  const items: NavItem[] = [
    // Section 1: Security & Profile
    {
      to: '/account',
      label: t('nav.account.overview', 'Профиль и квота'),
      end: true,
      icon: User,
    },
    {
      to: '/account/password',
      label: t('nav.account.password', 'Пароль'),
      icon: KeyRound,
    },
    {
      to: '/account/2fa',
      label: t('nav.account.twoFactor', '2FA (в разработке)'),
      icon: Shield,
    },
    {
      to: '/account/app-passwords',
      label: t('nav.account.appPasswords', 'Пароли приложений'),
      icon: Key,
    },
    {
      to: '/account/sessions',
      label: t('nav.account.sessions', 'Активные сессии'),
      icon: Laptop,
    },

    // Section 2: Mail Routing & Auto-rules
    {
      to: '/account/vacation',
      label: t('nav.account.vacation', 'Автоответчик'),
      icon: Plane,
      sectionTitle: t('nav.account.rulesSection', 'Почтовые правила'),
    },
    {
      to: '/account/filters',
      label: t('nav.account.filters', 'Фильтры писем'),
      icon: Filter,
    },
    {
      to: '/account/forwarding',
      label: t('nav.account.forwarding', 'Пересылка'),
      icon: Share2,
    },
    {
      to: '/account/migration',
      label: t('nav.account.migration', 'Импорт почты (IMAP)'),
      icon: DownloadCloud,
    },

    // Extensions
    ...extensionRegistry.getNavItems('account').map((item) => ({
      to: item.to,
      label: t(item.labelKey),
      icon: Sliders,
    })),
  ];

  return (
    <BreadcrumbsProvider>
      <SidebarShell
        sidebar={
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="border-mg-border-subtle flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <User className="text-mg-primary h-4 w-4" />
                <span className="text-mg-text text-xs font-semibold tracking-tight">
                  {t('layout.accountTitle', 'Личный кабинет')}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              <NavList items={items} />
            </div>
          </div>
        }
        topbar={<TopBar title={t('layout.accountTitle', 'Личный кабинет')} />}
      >
        <div className="space-y-4">
          <Breadcrumbs />
          <Outlet />
        </div>
      </SidebarShell>
    </BreadcrumbsProvider>
  );
}
