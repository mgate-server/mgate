import { useState, useRef, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Mail, Shield, User, Sun, Moon, Globe, LogOut, ChevronDown } from 'lucide-react';
import { Avatar, Badge, Button, cn } from '@mgate/ui';
import { useAuth } from '../../auth/AuthContext';
import { useTheme } from '../../lib/theme';

interface BrandingInfo {
  product_name?: string;
  logo_url?: string | null;
  accent_color?: string | null;
  favicon_url?: string | null;
}

export function TopBar({ title: _title }: { title: string }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { preference, setPreference } = useTheme();
  const { user, logout, hasAtLeastRole } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: branding } = useQuery<BrandingInfo>({
    queryKey: ['system', 'branding'],
    queryFn: async () => {
      const res = await fetch('/api/v1/system/branding');
      if (!res.ok) return { product_name: 'MGate' };
      return res.json();
    },
    staleTime: 60000,
  });

  useEffect(() => {
    if (branding?.product_name) {
      document.title = branding.product_name;
    }
    if (branding?.accent_color) {
      document.documentElement.style.setProperty('--mg-primary', branding.accent_color);
    }
    if (branding?.favicon_url) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = branding.favicon_url;
    }
  }, [branding?.product_name, branding?.accent_color, branding?.favicon_url]);

  const isMail = location.pathname.startsWith('/mail');
  const isAdmin = location.pathname.startsWith('/admin');
  const isAccount = location.pathname.startsWith('/account');

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleLang = () => {
    const next = i18n.language === 'ru' ? 'en' : 'ru';
    void i18n.changeLanguage(next);
  };

  const roleLabel = {
    SuperAdmin: t('auth.roles.superAdmin', 'Суперадминистратор'),
    DomainAdmin: t('auth.roles.domainAdmin', 'Администратор домена'),
    User: t('auth.roles.user', 'Пользователь'),
  }[user?.role ?? 'User'];

  const brandName = branding?.product_name || 'MGate';

  return (
    <div className="flex h-14 w-full items-center justify-between gap-2 px-2 sm:px-4">
      {/* Left: Brand & App Switcher */}
      <div className="flex items-center gap-3 md:gap-6">
        <Link
          to="/"
          className="text-mg-text flex items-center gap-2 font-bold tracking-tight hover:opacity-90"
        >
          {branding?.logo_url ? (
            <img
              src={branding.logo_url}
              alt={brandName}
              className="h-8 max-w-[120px] object-contain"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="bg-mg-primary text-mg-primary-fg flex h-8 w-8 items-center justify-center rounded-lg shadow-xs">
              <Mail className="h-4.5 w-4.5" />
            </div>
          )}
          <span className="hidden text-base font-bold sm:inline">{brandName}</span>
        </Link>

        {/* Segmented App Navigation */}
        <nav className="border-mg-border bg-mg-surface-subtle flex items-center gap-1 rounded-lg border p-0.5">
          <Link
            to="/mail/inbox"
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              isMail
                ? 'bg-mg-surface text-mg-primary shadow-xs'
                : 'text-mg-text-muted hover:text-mg-text',
            )}
          >
            <Mail className="h-3.5 w-3.5" />
            <span>{t('layout.mailTitle', 'Почта')}</span>
          </Link>

          {hasAtLeastRole('DomainAdmin') ? (
            <Link
              to="/admin"
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                isAdmin
                  ? 'bg-mg-surface text-mg-primary shadow-xs'
                  : 'text-mg-text-muted hover:text-mg-text',
              )}
            >
              <Shield className="h-3.5 w-3.5" />
              <span>{t('layout.adminTitle', 'Админка')}</span>
            </Link>
          ) : null}

          <Link
            to="/account"
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              isAccount
                ? 'bg-mg-surface text-mg-primary shadow-xs'
                : 'text-mg-text-muted hover:text-mg-text',
            )}
          >
            <User className="h-3.5 w-3.5" />
            <span>{t('layout.accountTitle', 'Аккаунт')}</span>
          </Link>
        </nav>
      </div>

      {/* Right Controls: Theme, Lang, User Menu */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Language switch */}
        <Button
          size="xs"
          variant="ghost"
          onClick={toggleLang}
          className="text-mg-text-muted hover:text-mg-text h-8 gap-1 px-2 text-xs font-medium"
          title="Сменить язык / Switch language"
        >
          <Globe className="h-3.5 w-3.5" />
          <span className="uppercase">{i18n.language?.slice(0, 2) || 'ru'}</span>
        </Button>

        {/* Theme toggle */}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setPreference(preference === 'dark' ? 'light' : 'dark')}
          className="text-mg-text-muted hover:text-mg-text h-8 w-8 p-0"
          aria-label="Toggle theme"
          title={preference === 'dark' ? 'Светлая тема' : 'Темная тема'}
        >
          {preference === 'dark' ? (
            <Sun className="h-4 w-4 text-amber-400" />
          ) : (
            <Moon className="h-4 w-4 text-slate-600" />
          )}
        </Button>

        <div className="bg-mg-border h-4 w-px" />

        {/* User profile menu */}
        {user ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setUserMenuOpen((prev) => !prev)}
              className="hover:bg-mg-surface-subtle flex items-center gap-2 rounded-lg p-1 text-left transition-colors focus:outline-none"
            >
              <Avatar email={user.email} size="sm" />
              <div className="hidden text-left md:block">
                <div className="text-mg-text max-w-[140px] truncate text-xs font-semibold">
                  {user.email}
                </div>
                <div className="text-mg-text-muted text-[10px]">{roleLabel}</div>
              </div>
              <ChevronDown className="text-mg-text-muted hidden h-3.5 w-3.5 md:block" />
            </button>

            {userMenuOpen ? (
              <div className="border-mg-border bg-mg-surface animate-in fade-in zoom-in-95 absolute right-0 z-50 mt-1.5 w-56 rounded-xl border p-1.5 shadow-lg">
                <div className="border-mg-border border-b px-3 py-2">
                  <p className="text-mg-text truncate text-xs font-semibold">{user.email}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Badge tone={user.role === 'SuperAdmin' ? 'primary' : 'neutral'}>
                      {roleLabel}
                    </Badge>
                  </div>
                </div>

                <div className="py-1">
                  <Link
                    to="/account"
                    onClick={() => setUserMenuOpen(false)}
                    className="text-mg-text hover:bg-mg-surface-subtle flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs"
                  >
                    <User className="text-mg-text-muted h-3.5 w-3.5" />
                    <span>{t('nav.account.overview', 'Личный кабинет')}</span>
                  </Link>

                  {hasAtLeastRole('DomainAdmin') ? (
                    <Link
                      to="/admin"
                      onClick={() => setUserMenuOpen(false)}
                      className="text-mg-text hover:bg-mg-surface-subtle flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs"
                    >
                      <Shield className="text-mg-text-muted h-3.5 w-3.5" />
                      <span>{t('nav.admin.dashboard', 'Админ-панель')}</span>
                    </Link>
                  ) : null}
                </div>

                <div className="border-mg-border border-t pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      void logout();
                    }}
                    className="text-mg-danger hover:bg-mg-danger/10 flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>{t('common.logout', 'Выйти')}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
