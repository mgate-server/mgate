import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  HardDrive,
  KeyRound,
  Shield,
  Key,
  Plane,
  Filter,
  Mail,
  Calendar,
  Clock,
  ChevronRight,
} from 'lucide-react';
import { Avatar, Badge, Card } from '@mgate/ui';
import { apiClient } from '../../lib/apiClient';
import { useAuth } from '../../auth/AuthContext';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function OverviewPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ['account', 'profile'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/account');
      if (error) throw error;
      return data;
    },
  });

  const { data: quota } = useQuery({
    queryKey: ['account', 'quota'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/account/quota');
      if (error) throw error;
      return data;
    },
  });

  const used = quota?.used_bytes ?? 0;
  const total = quota?.quota_bytes ?? profile?.quota_bytes ?? 10 * 1024 * 1024 * 1024;
  const percentUsed = Math.min(100, Math.round((used / total) * 100));

  const quickLinks = [
    {
      to: '/account/password',
      title: t('nav.account.password', 'Пароль учетной записи'),
      desc: 'Изменение основного пароля для входа',
      icon: KeyRound,
    },
    {
      to: '/account/2fa',
      title: t('nav.account.twoFactor', 'Двухфакторная защита (2FA)'),
      desc: 'В разработке: одноразовый код при входе пока не запрашивается',
      icon: Shield,
    },
    {
      to: '/account/app-passwords',
      title: t('nav.account.appPasswords', 'Пароли приложений'),
      desc: 'Безопасное подключение для Thunderbird, Apple Mail и др.',
      icon: Key,
    },
    {
      to: '/account/vacation',
      title: t('nav.account.vacation', 'Автоответчик в отпуске'),
      desc: 'Автоматические ответы входящим письмам',
      icon: Plane,
    },
    {
      to: '/account/filters',
      title: t('nav.account.filters', 'Правила сортировки и фильтры'),
      desc: 'Автоматическая раскладка писем по папкам (Sieve)',
      icon: Filter,
    },
    {
      to: '/mail/inbox',
      title: t('nav.mail.inbox', 'Перейти к почте'),
      desc: 'Открыть веб-клиент для чтения сообщений',
      icon: Mail,
      isAction: true,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Profile Overview Card */}
      <div className="border-mg-border bg-mg-surface rounded-2xl border p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <Avatar
              name={profile?.display_name || user?.email || 'User'}
              email={profile?.email || user?.email}
              size="lg"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <h1 className="text-mg-text text-xl font-bold tracking-tight">
                  {profile?.display_name || profile?.email || user?.email || 'Пользователь'}
                </h1>
                <Badge tone="primary">{user?.role || 'User'}</Badge>
              </div>
              <p className="text-mg-text-muted font-mono text-sm">
                {profile?.email || user?.email}
              </p>
            </div>
          </div>

          <div className="text-mg-text-muted border-mg-border-subtle flex flex-wrap items-center gap-4 border-t pt-2 text-xs sm:border-t-0 sm:pt-0">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>
                Создан:{' '}
                {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              <span>
                {profile?.last_login_at
                  ? `Вход: ${new Date(profile.last_login_at).toLocaleDateString()}`
                  : 'Текущая сессия'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Quota Section */}
      <Card className="space-y-4 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <HardDrive className="text-mg-primary h-5 w-5" />
            <div>
              <h2 className="text-mg-text text-sm font-semibold">
                {t('account.overview.mailboxQuota', 'Хранилище почтового ящика')}
              </h2>
              <p className="text-mg-text-muted mt-0.5 text-xs">
                {t(
                  'account.overview.quotaDescription',
                  'Лимит пространства для писем, вложений и папок',
                )}
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-mg-text text-sm font-bold">{formatBytes(used)}</span>
            <span className="text-mg-text-muted text-xs"> / {formatBytes(total)}</span>
          </div>
        </div>

        {/* Custom Progress bar */}
        <div className="space-y-2">
          <div className="bg-mg-surface-subtle border-mg-border-subtle h-2.5 w-full overflow-hidden rounded-full border">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                percentUsed > 90
                  ? 'bg-rose-500'
                  : percentUsed > 75
                    ? 'bg-amber-500'
                    : 'bg-mg-primary'
              }`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          <div className="text-mg-text-muted flex justify-between text-[11px]">
            <span>Использовано {percentUsed}%</span>
            <span>Свободно {formatBytes(Math.max(0, total - used))}</span>
          </div>
        </div>
      </Card>

      {/* Quick Access Grid */}
      <div className="space-y-3">
        <h2 className="text-mg-text-muted px-1 text-xs font-semibold tracking-wider uppercase">
          {t('account.overview.quickActions', 'Настройки и функции')}
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`group flex flex-col justify-between rounded-xl border p-4 transition-all ${
                  link.isAction
                    ? 'bg-mg-primary/5 border-mg-primary/30 hover:border-mg-primary hover:bg-mg-primary/10'
                    : 'bg-mg-surface border-mg-border hover:border-mg-primary/40 hover:shadow-xs'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="bg-mg-surface-subtle border-mg-border-subtle group-hover:border-mg-primary/30 text-mg-primary rounded-lg border p-2 transition-colors">
                    <Icon className="h-4 w-4" />
                  </div>
                  <ChevronRight className="text-mg-text-muted group-hover:text-mg-primary h-4 w-4 transition-all group-hover:translate-x-0.5" />
                </div>
                <div className="mt-3">
                  <h3 className="text-mg-text group-hover:text-mg-primary text-xs font-semibold transition-colors">
                    {link.title}
                  </h3>
                  <p className="text-mg-text-muted mt-0.5 text-[11px]">{link.desc}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
