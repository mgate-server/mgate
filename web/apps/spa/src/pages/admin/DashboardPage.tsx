import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Globe,
  Mail,
  Layers,
  ShieldAlert,
  Clock,
  ArrowUpRight,
  Plus,
  Terminal,
  Activity,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Server,
  Zap,
} from 'lucide-react';
import { Badge, Button, Card } from '@mgate/ui';
import { apiClient } from '../../lib/apiClient';
import { extensionRegistry } from '../../lib/extensions';

// Tailwind static classes for widget spans
const SPAN_CLASSES: Record<4 | 6 | 8 | 12, string> = {
  4: 'col-span-12 md:col-span-4',
  6: 'col-span-12 md:col-span-6',
  8: 'col-span-12 md:col-span-8',
  12: 'col-span-12',
};

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0м';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

/** /admin — dashboard */
export function DashboardPage() {
  const { t } = useTranslation();
  const widgets = extensionRegistry.getDashboardWidgets();

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/admin/dashboard');
      if (error) throw error;
      return data;
    },
    refetchInterval: 15000,
  });

  const isPro = dashboard?.license_edition === 'pro';

  const stats = [
    {
      label: t('admin.dashboard.domains', 'Домены'),
      value: isLoading ? '...' : (dashboard?.domains_count ?? 0),
      to: '/admin/domains',
      icon: Globe,
      description: 'Обслуживаемых доменов',
      tone: 'text-blue-500 bg-blue-500/10',
    },
    {
      label: t('admin.dashboard.mailboxes', 'Почтовые ящики'),
      value: isLoading ? '...' : (dashboard?.mailboxes_count ?? 0),
      to: '/admin/mailboxes',
      icon: Mail,
      description: 'Активных ящиков',
      tone: 'text-emerald-500 bg-emerald-500/10',
    },
    {
      label: t('admin.dashboard.queue', 'Очередь писем'),
      value: isLoading ? '...' : (dashboard?.queue_count ?? 0),
      to: '/admin/queue',
      icon: Layers,
      description: 'Сообщений на отправку',
      tone: 'text-amber-500 bg-amber-500/10',
    },
    {
      label: t('admin.dashboard.spamToday', 'Спам за 24ч'),
      value: isLoading ? '...' : (dashboard?.spam_today ?? 0),
      to: '/admin/statistics',
      icon: ShieldAlert,
      description: 'Заблокировано спам-фильтром',
      tone: 'text-rose-500 bg-rose-500/10',
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-mg-border-subtle">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-mg-text">
              {t('nav.admin.dashboard', 'Панель управления')}
            </h1>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Система в норме</span>
            </div>
          </div>
          <p className="text-xs text-mg-text-muted">
            Мониторинг инфраструктуры, метрики производительности и управление почтовым кластером
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge tone={isPro ? 'primary' : 'neutral'} className="px-2.5 py-1 text-xs">
            {isPro ? (
              <span className="inline-flex items-center gap-1 font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                {t('common.proEdition', 'MGate Pro')}
              </span>
            ) : (
              <span>{t('common.communityEdition', 'Community Edition')}</span>
            )}
          </Badge>

          {dashboard?.uptime_secs !== undefined && (
            <div className="flex items-center gap-1.5 text-xs text-mg-text-muted bg-mg-surface border border-mg-border-subtle px-3 py-1 rounded-lg">
              <Clock className="w-3.5 h-3.5" />
              <span>Аптайм: {formatUptime(dashboard.uptime_secs)}</span>
            </div>
          )}
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              to={stat.to}
              className="group block p-5 rounded-xl border border-mg-border bg-mg-surface hover:border-mg-primary/50 hover:shadow-md transition-all duration-200"
            >
              <div className="flex items-center justify-between">
                <div className={`p-2.5 rounded-xl ${stat.tone}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-mg-text-muted group-hover:text-mg-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
              </div>

              <div className="mt-4">
                <div className="text-2xl font-bold text-mg-text tracking-tight">{stat.value}</div>
                <div className="text-xs font-medium text-mg-text mt-0.5">{stat.label}</div>
                <div className="text-[11px] text-mg-text-muted mt-1">{stat.description}</div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Pro Banner if Community */}
      {!isPro && (
        <div className="p-5 rounded-xl border border-mg-primary/30 bg-gradient-to-r from-mg-primary/10 via-transparent to-transparent flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-mg-primary" />
              <h2 className="font-semibold text-sm text-mg-text">
                {t('admin.license.upgradeTitle', 'Активируйте MGate Pro')}
              </h2>
            </div>
            <p className="text-xs text-mg-text-muted max-w-2xl">
              {t(
                'admin.license.upgradeDescription',
                'Снимите ограничение на количество доменов, подключите кластеризацию, расширенный журнал аудита и круглосуточную поддержку.',
              )}
            </p>
          </div>
          <Link to="/admin/license" className="shrink-0">
            <Button size="sm" className="gap-1.5 shadow-sm">
              <span>{t('admin.license.upgradeButton', 'Подробнее о Pro')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      )}

      {/* Quick Actions & System Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <Card className="p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-mg-border-subtle">
            <Zap className="w-4 h-4 text-mg-primary" />
            <h2 className="font-semibold text-sm text-mg-text">
              {t('admin.dashboard.quickActions', 'Быстрые действия')}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Link to="/admin/domains">
              <Button variant="secondary" size="sm" className="w-full justify-start gap-2 h-auto py-2.5">
                <Plus className="w-4 h-4 text-mg-primary" />
                <div className="text-left">
                  <div className="text-xs font-semibold">{t('admin.dashboard.addDomain', 'Домен')}</div>
                  <div className="text-[10px] text-mg-text-muted">Подключить почту</div>
                </div>
              </Button>
            </Link>

            <Link to="/admin/mailboxes">
              <Button variant="secondary" size="sm" className="w-full justify-start gap-2 h-auto py-2.5">
                <Mail className="w-4 h-4 text-emerald-500" />
                <div className="text-left">
                  <div className="text-xs font-semibold">{t('admin.dashboard.createMailbox', 'Ящик')}</div>
                  <div className="text-[10px] text-mg-text-muted">Создать аккаунт</div>
                </div>
              </Button>
            </Link>

            <Link to="/admin/logs">
              <Button variant="secondary" size="sm" className="w-full justify-start gap-2 h-auto py-2.5">
                <Terminal className="w-4 h-4 text-amber-500" />
                <div className="text-left">
                  <div className="text-xs font-semibold">{t('admin.dashboard.viewLogs', 'Логи')}</div>
                  <div className="text-[10px] text-mg-text-muted">Анализ событий</div>
                </div>
              </Button>
            </Link>
          </div>
        </Card>

        {/* System Health */}
        <Card className="p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-mg-border-subtle">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-mg-primary" />
              <h2 className="font-semibold text-sm text-mg-text">
                {t('admin.dashboard.systemHealth', 'Состояние служб')}
              </h2>
            </div>
            <span className="text-xs text-mg-text-muted">Все подсистемы активны</span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-mg-surface-subtle/40 border border-mg-border-subtle">
              <div className="flex items-center gap-2.5">
                <Server className="w-4 h-4 text-emerald-500" />
                <span className="font-medium text-mg-text">
                  {t('admin.dashboard.apiStatus', 'API Gateway & PostgreSQL')}
                </span>
              </div>
              <Badge tone="success" className="gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>{t('common.operational', 'Работает')}</span>
              </Badge>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-mg-surface-subtle/40 border border-mg-border-subtle">
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-emerald-500" />
                <span className="font-medium text-mg-text">
                  {t('admin.dashboard.mailServices', 'Почтовый транспорт (Postfix & Dovecot)')}
                </span>
              </div>
              <Badge tone="success" className="gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>{t('common.operational', 'Работает')}</span>
              </Badge>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-mg-surface-subtle/40 border border-mg-border-subtle">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-4 h-4 text-emerald-500" />
                <span className="font-medium text-mg-text">
                  {t('admin.dashboard.antispam', 'Фильтрация спама (Rspamd & Valkey)')}
                </span>
              </div>
              <Badge tone="success" className="gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>{t('common.operational', 'Работает')}</span>
              </Badge>
            </div>
          </div>
        </Card>
      </div>

      {/* Extension Widgets */}
      {widgets.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          {widgets.map((widget) => {
            const WidgetComponent = widget.Component;
            const span = widget.span ?? 12;
            return (
              <div key={widget.id} className={SPAN_CLASSES[span]}>
                <WidgetComponent />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
