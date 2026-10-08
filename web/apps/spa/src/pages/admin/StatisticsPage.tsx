import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Modal, PageHeader, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import {
  BarChart3,
  MailCheck,
  Search,
  Filter,
  Eye,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Send,
  RefreshCw,
  Copy,
  Check,
  Shield,
  Mail,
  User,
  FileCode,
} from 'lucide-react';
import { fetchApi } from '../../lib/apiClient';

interface StatRow {
  hour: string;
  scope_type: string;
  scope_id: string | null;
  metric: string;
  count: number;
  bytes: number;
}

interface MetricSummary {
  metric: string;
  count: number;
  bytes: number;
}

/** One rspamd symbol attached to a mail event's details. */
interface MailEventSymbol {
  name?: string;
  score?: number | string | null;
  description?: string;
  group?: string;
}

/** Structured `details` of a mail event (shape varies by event type; every field is optional). */
interface MailEventDetails {
  symbols?: MailEventSymbol[];
  subject?: string | null;
  header_subject?: unknown;
  ip?: string | null;
  qid?: string | null;
  score?: unknown;
  size?: unknown;
  from?: string | null;
  action?: string | null;
  rcpt?: unknown;
  [key: string]: unknown;
}

/** Raw row of GET /api/v1/admin/mail-events (older builds return a bare array). */
interface RawMailEvent {
  id: string | number;
  queue_id?: string | null;
  message_id?: string | null;
  from_address?: string | null;
  sender?: string | null;
  to_address?: string | null;
  recipient?: string | null;
  event_type: string;
  action?: string | null;
  status_code?: string | null;
  occurred_at: string;
  spam_score?: number | null;
  size_bytes?: number | null;
  details?: MailEventDetails | string | null;
}

interface MailEventItem {
  id: string;
  queue_id?: string | null;
  message_id?: string | null;
  sender: string;
  recipient: string;
  event_type: string;
  status_code?: string | null;
  diag_message?: string | null;
  occurred_at: string;
  size_bytes?: number | null;
  spam_score?: number | null;
  action?: string | null;
  subject?: string | null;
  client_ip?: string | null;
  raw_details?: MailEventDetails | string | null;
}

/** rspamd symbols recorded in a mail event's structured details (empty when absent). */
function getEventSymbols(ev: MailEventItem): MailEventSymbol[] {
  const details = ev.raw_details;
  if (typeof details !== 'object' || details === null) return [];
  return Array.isArray(details.symbols) ? details.symbols : [];
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function StatisticsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'metrics' | 'tracking'>('metrics');
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('24h');

  // Tracking tab filter state
  const [trackingType, setTrackingType] = useState('ALL');
  const [trackingSender, setTrackingSender] = useState('');
  const [trackingRecipient, setTrackingRecipient] = useState('');
  const [inspectEvent, setInspectEvent] = useState<MailEventItem | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Stats query
  const {
    data: stats = [],
    isLoading: isStatsLoading,
    refetch: refetchStats,
  } = useQuery<StatRow[]>({
    queryKey: ['admin', 'stats', period],
    queryFn: async () => {
      const now = new Date();
      let hours = 24;
      if (period === '7d') hours = 24 * 7;
      if (period === '30d') hours = 24 * 30;
      const from = new Date(now.getTime() - hours * 3600 * 1000);

      const params = new URLSearchParams({
        from: from.toISOString(),
        to: now.toISOString(),
      });

      const res = await fetchApi(`/api/v1/admin/stats?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load stats');
      return res.json();
    },
  });

  // Mail events tracking query
  const {
    data: trackingData,
    isLoading: isTrackingLoading,
    refetch: refetchTracking,
  } = useQuery<{ items: MailEventItem[]; total: number }>({
    queryKey: ['admin', 'mail-events', trackingType, trackingSender, trackingRecipient],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (trackingType !== 'ALL') params.set('event_type', trackingType);
      const searchTarget = trackingSender.trim() || trackingRecipient.trim();
      if (searchTarget) params.set('search', searchTarget);
      if (trackingSender.trim()) params.set('sender', trackingSender.trim());
      if (trackingRecipient.trim()) params.set('recipient', trackingRecipient.trim());
      params.set('limit', '100');

      const res = await fetchApi(`/api/v1/admin/mail-events?${params}`, { credentials: 'include' });
      if (!res.ok) {
        return { items: [], total: 0 };
      }
      const data = await res.json();
      const rawList: RawMailEvent[] = Array.isArray(data)
        ? data
        : Array.isArray(data.items)
          ? data.items
          : [];
      const items: MailEventItem[] = rawList.map((ev) => {
        const details: MailEventDetails =
          typeof ev.details === 'object' && ev.details !== null ? ev.details : {};
        const subject =
          details.subject ||
          (Array.isArray(details.header_subject) ? details.header_subject[0] : null);
        const clientIp = details.ip || null;
        const qid = details.qid ?? ev.queue_id ?? null;
        const score =
          typeof ev.spam_score === 'number'
            ? ev.spam_score
            : typeof details.score === 'number'
              ? details.score
              : null;
        const size =
          typeof ev.size_bytes === 'number'
            ? ev.size_bytes
            : typeof details.size === 'number'
              ? details.size
              : null;

        return {
          id: String(ev.id),
          queue_id: qid,
          message_id: ev.message_id,
          sender: ev.from_address ?? ev.sender ?? details.from ?? '',
          recipient:
            ev.to_address ??
            ev.recipient ??
            (Array.isArray(details.rcpt) ? details.rcpt.join(', ') : ''),
          event_type: ev.event_type,
          status_code: ev.action ?? details.action ?? ev.status_code ?? '250 OK',
          diag_message: typeof ev.details === 'string' ? ev.details : null,
          occurred_at: ev.occurred_at,
          size_bytes: size,
          spam_score: score,
          action: ev.action ?? details.action ?? null,
          subject,
          client_ip: clientIp,
          raw_details: ev.details,
        };
      });
      return { items, total: items.length };
    },
    enabled: activeTab === 'tracking',
  });

  // Calculate aggregate totals
  let totalCount = 0;
  let totalBytes = 0;
  let deliveredCount = 0;
  let spamCount = 0;
  let rejectedCount = 0;

  const metricMap = new Map<string, { count: number; bytes: number }>();

  for (const row of stats) {
    totalCount += row.count;
    totalBytes += row.bytes;

    if (row.metric.includes('delivered') || row.metric.includes('sent')) {
      deliveredCount += row.count;
    }
    if (row.metric.includes('spam')) {
      spamCount += row.count;
    }
    if (row.metric.includes('reject') || row.metric.includes('bounce')) {
      rejectedCount += row.count;
    }

    const curr = metricMap.get(row.metric) ?? { count: 0, bytes: 0 };
    curr.count += row.count;
    curr.bytes += row.bytes;
    metricMap.set(row.metric, curr);
  }

  const metricSummaries: MetricSummary[] = Array.from(metricMap.entries()).map(([metric, val]) => ({
    metric,
    count: val.count,
    bytes: val.bytes,
  }));

  const deliveryRate = totalCount > 0 ? ((deliveredCount / totalCount) * 100).toFixed(1) : '100.0';

  const columns: TableColumn<MetricSummary>[] = [
    {
      key: 'metric',
      header: t('admin.stats.metric', 'Метрика события'),
      render: (row) => <span className="text-mg-text font-mono text-xs">{row.metric}</span>,
    },
    {
      key: 'count',
      header: t('admin.stats.count', 'Количество писем'),
      render: (row) => (
        <span className="text-mg-text font-semibold">{row.count.toLocaleString()}</span>
      ),
    },
    {
      key: 'bytes',
      header: t('admin.stats.volume', 'Объем данных'),
      render: (row) => <span className="text-mg-text-muted text-xs">{formatBytes(row.bytes)}</span>,
    },
  ];

  const trackingItems = trackingData?.items ?? [];

  const trackingColumns: TableColumn<MailEventItem>[] = [
    {
      key: 'time',
      header: 'Время',
      render: (row) => (
        <span className="text-mg-text-muted text-xs whitespace-nowrap">
          {new Date(row.occurred_at).toLocaleTimeString()}{' '}
          <span className="text-[11px] opacity-70">
            {new Date(row.occurred_at).toLocaleDateString()}
          </span>
        </span>
      ),
    },
    {
      key: 'event_type',
      header: 'Статус доставки',
      render: (row) => {
        const t = row.event_type.toLowerCase();
        if (t === 'delivered' || t === 'success') {
          return (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Доставлено
            </span>
          );
        }
        if (t === 'sent') {
          return (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
              <Send className="h-3 w-3" />
              Отправлено
            </span>
          );
        }
        if (t === 'bounced' || t === 'bounce') {
          return (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
              <XCircle className="h-3 w-3" />
              Возврат (Bounce)
            </span>
          );
        }
        if (t === 'rejected' || t === 'reject') {
          return (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              Отклонено
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-gray-500/20 bg-gray-500/10 px-2 py-0.5 text-xs font-medium text-gray-400">
            {row.event_type}
          </span>
        );
      },
    },
    {
      key: 'sender',
      header: 'Отправитель',
      render: (row) => (
        <span className="text-mg-text inline-block max-w-[180px] truncate font-mono text-xs">
          {row.sender || '<empty>'}
        </span>
      ),
    },
    {
      key: 'recipient',
      header: 'Получатель',
      render: (row) => (
        <span className="text-mg-text inline-block max-w-[180px] truncate font-mono text-xs font-semibold">
          {row.recipient}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Код ответа',
      render: (row) => (
        <span className="text-mg-text-muted font-mono text-xs">{row.status_code || '250 OK'}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setInspectEvent(row)}
          title="Детали события и лог доставки"
        >
          <Eye className="text-mg-primary mr-1 h-3.5 w-3.5" />
          Детали
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.admin.statistics', 'Почтовая статистика и мониторинг')}
        actions={
          <div className="flex items-center gap-2">
            {activeTab === 'metrics' ? (
              <div className="border-mg-border bg-mg-surface flex gap-1 rounded-md border p-1">
                <button
                  type="button"
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    period === '24h'
                      ? 'bg-mg-primary text-white'
                      : 'text-mg-text-muted hover:text-mg-text'
                  }`}
                  onClick={() => setPeriod('24h')}
                >
                  24 часа
                </button>
                <button
                  type="button"
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    period === '7d'
                      ? 'bg-mg-primary text-white'
                      : 'text-mg-text-muted hover:text-mg-text'
                  }`}
                  onClick={() => setPeriod('7d')}
                >
                  7 дней
                </button>
                <button
                  type="button"
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    period === '30d'
                      ? 'bg-mg-primary text-white'
                      : 'text-mg-text-muted hover:text-mg-text'
                  }`}
                  onClick={() => setPeriod('30d')}
                >
                  30 дней
                </button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => refetchTracking()}
                isLoading={isTrackingLoading}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Обновить трекинг
              </Button>
            )}
          </div>
        }
      />

      {/* Navigation tabs */}
      <div className="border-mg-border flex items-center gap-2 border-b pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('metrics')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'metrics'
              ? 'bg-mg-primary text-white shadow-sm'
              : 'text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-raised'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Сводные метрики и графики
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('tracking')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'tracking'
              ? 'bg-mg-primary text-white shadow-sm'
              : 'text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-raised'
          }`}
        >
          <MailCheck className="h-3.5 w-3.5" />
          Журнал писем (Message Tracking)
        </button>
      </div>

      {activeTab === 'metrics' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Card>
              <p className="text-mg-text-muted text-sm">
                {t('admin.stats.totalEmails', 'Всего сообщений')}
              </p>
              <p className="text-mg-text mt-1 text-2xl font-semibold">
                {isStatsLoading ? '...' : totalCount.toLocaleString()}
              </p>
            </Card>
            <Card>
              <p className="text-mg-text-muted text-sm">
                {t('admin.stats.delivered', 'Успешно доставлено')}
              </p>
              <p className="text-mg-success mt-1 text-2xl font-semibold">
                {isStatsLoading ? '...' : deliveredCount.toLocaleString()}
              </p>
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                {deliveryRate}% Deliverability
              </span>
            </Card>
            <Card>
              <p className="text-mg-text-muted text-sm">
                {t('admin.stats.spamBlocked', 'Спам / Заблокировано')}
              </p>
              <p className="mt-1 text-2xl font-semibold text-amber-500">
                {isStatsLoading ? '...' : spamCount.toLocaleString()}
              </p>
            </Card>
            <Card>
              <p className="text-mg-text-muted text-sm">
                {t('admin.stats.rejected', 'Ошибки / Bounce')}
              </p>
              <p className="text-mg-error mt-1 text-2xl font-semibold">
                {isStatsLoading ? '...' : rejectedCount.toLocaleString()}
              </p>
            </Card>
            <Card>
              <p className="text-mg-text-muted text-sm">
                {t('admin.stats.trafficVolume', 'Общий трафик')}
              </p>
              <p className="text-mg-text mt-1 text-2xl font-semibold">
                {isStatsLoading ? '...' : formatBytes(totalBytes)}
              </p>
            </Card>
          </div>

          <Card title={t('admin.stats.breakdownTitle', 'Детализация по типам событий')}>
            <Table
              columns={columns}
              rows={metricSummaries}
              rowKey={(row) => row.metric}
              isLoading={isStatsLoading}
              emptyMessage={t(
                'admin.stats.empty',
                'За выбранный период данных статистики пока нет.',
              )}
            />
          </Card>
        </div>
      )}

      {activeTab === 'tracking' && (
        <div className="space-y-4">
          <Card>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-mg-text-muted text-xs font-medium">Тип события</label>
                <select
                  value={trackingType}
                  onChange={(e) => setTrackingType(e.target.value)}
                  className="border-mg-border bg-mg-surface text-mg-text focus:border-mg-primary focus:ring-mg-primary rounded-md border px-3 py-1.5 text-xs shadow-sm focus:ring-1 focus:outline-none"
                >
                  <option value="ALL">Все события доставки</option>
                  <option value="delivered">Доставлено (Delivered)</option>
                  <option value="sent">Отправлено (Sent)</option>
                  <option value="bounced">Возврат (Bounced)</option>
                  <option value="rejected">Отклонено (Rejected)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-mg-text-muted text-xs font-medium">Отправитель</label>
                <Input
                  value={trackingSender}
                  onChange={(e) => setTrackingSender(e.target.value)}
                  placeholder="user@example.com"
                  className="text-xs"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-mg-text-muted text-xs font-medium">Получатель</label>
                <Input
                  value={trackingRecipient}
                  onChange={(e) => setTrackingRecipient(e.target.value)}
                  placeholder="recipient@example.com"
                  className="text-xs"
                />
              </div>
            </div>

            <Table
              columns={trackingColumns}
              rows={trackingItems}
              rowKey={(row) => row.id}
              isLoading={isTrackingLoading}
              emptyMessage="Нет записей трекинга почтовых сообщений по заданным критериям."
            />
          </Card>

          {/* Modal for inspect event details */}
          <Modal
            open={!!inspectEvent}
            onClose={() => setInspectEvent(null)}
            title={
              inspectEvent ? (
                <div className="flex items-center gap-2">
                  <MailCheck className="text-mg-primary h-5 w-5" />
                  <span>Детали почтового сообщения</span>
                  <span className="bg-mg-surface border-mg-border text-mg-text-muted rounded border px-2 py-0.5 font-mono text-xs">
                    ID: {inspectEvent.id}
                  </span>
                </div>
              ) : null
            }
            size="3xl"
            footer={
              <div className="flex w-full items-center justify-between">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (inspectEvent) {
                      handleCopy(
                        'all-json',
                        JSON.stringify(inspectEvent.raw_details || inspectEvent, null, 2),
                      );
                    }
                  }}
                >
                  {copiedKey === 'all-json' ? (
                    <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="text-mg-text-muted mr-1.5 h-3.5 w-3.5" />
                  )}
                  {copiedKey === 'all-json' ? 'Скопировано!' : 'Копировать JSON'}
                </Button>
                <Button variant="primary" size="sm" onClick={() => setInspectEvent(null)}>
                  Закрыть
                </Button>
              </div>
            }
          >
            {inspectEvent && (
              <div className="space-y-4">
                {/* 1. Status & Core Metrics Grid */}
                <div className="bg-mg-surface-raised border-mg-border grid grid-cols-2 gap-3 rounded-xl border p-3.5 sm:grid-cols-4">
                  <div>
                    <span className="text-mg-text-muted mb-0.5 block text-[11px]">
                      Статус доставки
                    </span>
                    <div>
                      {(() => {
                        const t = inspectEvent.event_type.toLowerCase();
                        if (t === 'delivered' || t === 'success') {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Доставлено
                            </span>
                          );
                        }
                        if (t === 'sent') {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
                              <Send className="h-3.5 w-3.5" /> Отправлено
                            </span>
                          );
                        }
                        if (t === 'bounced' || t === 'bounce') {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400">
                              <XCircle className="h-3.5 w-3.5" /> Bounce
                            </span>
                          );
                        }
                        if (t === 'rejected' || t === 'reject') {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3.5 w-3.5" /> Отклонено
                            </span>
                          );
                        }
                        return (
                          <span className="text-mg-text text-xs font-semibold capitalize">
                            {inspectEvent.event_type}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  <div>
                    <span className="text-mg-text-muted mb-0.5 block text-[11px]">
                      Время события
                    </span>
                    <span className="text-mg-text block text-xs font-medium">
                      {new Date(inspectEvent.occurred_at).toLocaleTimeString()}
                    </span>
                    <span className="text-mg-text-muted text-[11px]">
                      {new Date(inspectEvent.occurred_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div>
                    <span className="text-mg-text-muted mb-0.5 block text-[11px]">
                      Размер сообщения
                    </span>
                    <span className="text-mg-text font-mono text-xs font-medium">
                      {inspectEvent.size_bytes ? formatBytes(inspectEvent.size_bytes) : '—'}
                    </span>
                  </div>

                  <div>
                    <span className="text-mg-text-muted mb-0.5 block text-[11px]">
                      Queue ID (Postfix)
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-mg-text font-mono text-xs font-semibold">
                        {inspectEvent.queue_id || '—'}
                      </span>
                      {inspectEvent.queue_id && (
                        <button
                          type="button"
                          onClick={() => handleCopy('qid', inspectEvent.queue_id!)}
                          className="text-mg-text-muted hover:text-mg-text rounded p-0.5 transition-colors"
                          title="Скопировать Queue ID"
                        >
                          {copiedKey === 'qid' ? (
                            <Check className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. Addresses & Subject Card */}
                <div className="border-mg-border bg-mg-surface space-y-3 rounded-xl border p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {/* Sender */}
                    <div className="bg-mg-surface-raised/60 border-mg-border-subtle rounded-lg border p-2.5">
                      <span className="text-mg-text-muted mb-1 flex items-center gap-1 text-[11px] font-medium">
                        <Mail className="h-3 w-3" /> Отправитель (From)
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-mg-text truncate font-mono text-xs font-semibold select-all">
                          {inspectEvent.sender || '<пусто>'}
                        </span>
                        {inspectEvent.sender && (
                          <button
                            type="button"
                            onClick={() => handleCopy('sender', inspectEvent.sender)}
                            className="text-mg-text-muted hover:text-mg-text hover:bg-mg-surface shrink-0 rounded p-1 transition-colors"
                            title="Скопировать"
                          >
                            {copiedKey === 'sender' ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Recipient */}
                    <div className="bg-mg-surface-raised/60 border-mg-border-subtle rounded-lg border p-2.5">
                      <span className="text-mg-text-muted mb-1 flex items-center gap-1 text-[11px] font-medium">
                        <User className="h-3 w-3" /> Получатель (To)
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-mg-text truncate font-mono text-xs font-semibold select-all">
                          {inspectEvent.recipient}
                        </span>
                        {inspectEvent.recipient && (
                          <button
                            type="button"
                            onClick={() => handleCopy('recipient', inspectEvent.recipient)}
                            className="text-mg-text-muted hover:text-mg-text hover:bg-mg-surface shrink-0 rounded p-1 transition-colors"
                            title="Скопировать"
                          >
                            {copiedKey === 'recipient' ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Subject */}
                  {inspectEvent.subject && (
                    <div className="pt-1">
                      <span className="text-mg-text-muted mb-0.5 block text-[11px] font-medium">
                        Тема сообщения
                      </span>
                      <p className="text-mg-text bg-mg-surface-raised/40 border-mg-border-subtle rounded-lg border px-3 py-1.5 text-xs font-medium">
                        {inspectEvent.subject}
                      </p>
                    </div>
                  )}

                  {/* Message-ID & IP */}
                  <div className="grid grid-cols-1 gap-2 pt-1 text-xs sm:grid-cols-3">
                    {inspectEvent.message_id && (
                      <div className="sm:col-span-2">
                        <span className="text-mg-text-muted mb-0.5 block text-[11px]">
                          Message-ID
                        </span>
                        <div className="bg-mg-surface-raised/40 border-mg-border-subtle text-mg-text flex items-center justify-between gap-1 rounded border px-2.5 py-1.5 font-mono text-[11px]">
                          <span className="truncate">{inspectEvent.message_id}</span>
                          <button
                            type="button"
                            onClick={() => handleCopy('mid', inspectEvent.message_id!)}
                            className="text-mg-text-muted hover:text-mg-text shrink-0 p-0.5"
                            title="Скопировать Message-ID"
                          >
                            {copiedKey === 'mid' ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {inspectEvent.client_ip && (
                      <div>
                        <span className="text-mg-text-muted mb-0.5 block text-[11px]">
                          IP клиента / узла
                        </span>
                        <div className="bg-mg-surface-raised/40 border-mg-border-subtle text-mg-text rounded border px-2.5 py-1.5 font-mono text-[11px]">
                          {inspectEvent.client_ip}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Antispam & Rspamd Analysis Card (if score or symbols available) */}
                {(inspectEvent.spam_score !== null || getEventSymbols(inspectEvent).length > 0) && (
                  <div className="border-mg-border bg-mg-surface space-y-3 rounded-xl border p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="text-mg-primary h-4 w-4" />
                        <span className="text-mg-text text-xs font-semibold">
                          Анализ спам-фильтра (Rspamd)
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {inspectEvent.spam_score !== null && (
                          <span
                            className={`rounded-full border px-2 py-0.5 font-mono text-xs font-semibold ${
                              (inspectEvent.spam_score || 0) <= 2
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : (inspectEvent.spam_score || 0) <= 6
                                  ? 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                  : 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            Score: {inspectEvent.spam_score}
                          </span>
                        )}
                        {inspectEvent.action && (
                          <span className="text-mg-text-muted bg-mg-surface-raised border-mg-border rounded-full border px-2 py-0.5 font-mono text-xs">
                            {inspectEvent.action}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Symbols list */}
                    {getEventSymbols(inspectEvent).length > 0 && (
                      <div>
                        <span className="text-mg-text-muted mb-1.5 block text-[11px] font-medium">
                          Сработавшие символы и правила ({getEventSymbols(inspectEvent).length}):
                        </span>
                        <div className="bg-mg-surface-raised/40 border-mg-border-subtle flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border p-2">
                          {getEventSymbols(inspectEvent).map((sym, idx) => {
                            const score = Number(sym.score || 0);
                            return (
                              <span
                                key={idx}
                                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] ${
                                  score > 0
                                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                    : score < 0
                                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-mg-surface text-mg-text-muted border-mg-border'
                                }`}
                                title={sym.description || sym.group}
                              >
                                {sym.name}
                                {score !== 0 && (
                                  <span className="font-semibold">
                                    {score > 0 ? `+${score}` : score}
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Diagnostic Message from MTA */}
                {inspectEvent.diag_message && (
                  <div className="border-mg-border bg-mg-surface space-y-1.5 rounded-xl border p-3.5">
                    <span className="text-mg-text block text-xs font-semibold">
                      Диагностика сервера доставки (MTA)
                    </span>
                    <div className="bg-mg-surface-raised border-mg-border text-mg-text max-h-40 overflow-y-auto rounded-lg border p-2.5 font-mono text-xs break-all whitespace-pre-wrap">
                      {inspectEvent.diag_message}
                    </div>
                  </div>
                )}

                {/* 5. Collapsible Raw JSON Data */}
                <details className="group border-mg-border bg-mg-surface overflow-hidden rounded-xl border">
                  <summary className="text-mg-text hover:bg-mg-surface-raised flex cursor-pointer items-center justify-between px-4 py-2.5 text-xs font-medium select-none">
                    <span className="flex items-center gap-2">
                      <FileCode className="text-mg-primary h-3.5 w-3.5" />
                      Сырые данные события (Raw JSON)
                    </span>
                    <span className="text-mg-text-muted text-[11px] group-open:hidden">
                      Нажмите, чтобы развернуть
                    </span>
                  </summary>
                  <div className="border-mg-border bg-mg-surface-raised/40 border-t p-3">
                    <pre className="bg-mg-surface border-mg-border text-mg-text-muted max-h-52 overflow-y-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed select-all">
                      {JSON.stringify(inspectEvent.raw_details || inspectEvent, null, 2)}
                    </pre>
                  </div>
                </details>
              </div>
            )}
          </Modal>
        </div>
      )}
    </div>
  );
}
