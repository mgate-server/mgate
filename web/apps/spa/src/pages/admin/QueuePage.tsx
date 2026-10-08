import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Modal, PageHeader, StatusDot, Table, cn } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import {
  Layers,
  Activity,
  Clock,
  PauseCircle,
  RefreshCw,
  Search,
  Trash2,
  Play,
  Send,
  Info,
  ChevronDown,
  ChevronUp,
  Terminal,
  AlertTriangle,
  Copy,
  Check,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { fetchApi } from '../../lib/apiClient';

export interface RawQueueRecipient {
  address?: string;
  delay_reason?: string;
}

export interface RawQueueEntry {
  queue_id?: string;
  id?: string;
  queue_name?: string;
  status?: 'active' | 'deferred' | 'held' | 'hold';
  sender?: string;
  recipients?: (RawQueueRecipient | string)[];
  message_size?: number;
  size_bytes?: number;
  sizeBytes?: number;
  arrival_time?: number;
  forced_expire?: boolean;
  reason?: string;
}

export interface NormalizedQueueEntry {
  id: string;
  queueName: 'active' | 'deferred' | 'held';
  sender: string;
  recipients: string[];
  recipientDetails: { address: string; reason?: string }[];
  sizeBytes: number;
  arrivalTime?: number;
  arrivalDate?: Date;
  reason?: string;
}

interface LogEvent {
  ts: string;
  host?: string;
  prog: string;
  sev: string;
  msg: string;
}

export function normalizeQueueEntry(raw: RawQueueEntry): NormalizedQueueEntry {
  const id = raw.queue_id || raw.id || '';
  let queueName: 'active' | 'deferred' | 'held' = 'active';
  const rawStatus = (raw.queue_name || raw.status || '').toLowerCase();
  if (rawStatus === 'hold' || rawStatus === 'held') {
    queueName = 'held';
  } else if (rawStatus === 'deferred') {
    queueName = 'deferred';
  } else if (rawStatus === 'active') {
    queueName = 'active';
  }

  const recipientDetails: { address: string; reason?: string }[] = [];
  const recipients: string[] = [];

  if (Array.isArray(raw.recipients)) {
    for (const r of raw.recipients) {
      if (typeof r === 'string') {
        recipients.push(r);
        recipientDetails.push({ address: r });
      } else if (r && typeof r === 'object') {
        const addr = r.address || '';
        recipients.push(addr);
        recipientDetails.push({ address: addr, reason: r.delay_reason });
      }
    }
  }

  const sizeBytes = raw.message_size ?? raw.size_bytes ?? raw.sizeBytes ?? 0;
  const arrivalTime = raw.arrival_time ? raw.arrival_time * 1000 : undefined;
  const arrivalDate = arrivalTime ? new Date(arrivalTime) : undefined;
  const reason = raw.reason || recipientDetails.find((r) => r.reason)?.reason;

  return {
    id,
    queueName,
    sender: raw.sender || '',
    recipients,
    recipientDetails,
    sizeBytes,
    arrivalTime,
    arrivalDate,
    reason,
  };
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRelativeTime(date?: Date): string {
  if (!date || isNaN(date.getTime())) return '—';
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 10) return 'только что';
  if (sec < 60) return `${sec} с назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} д назад`;
}

function isMtaLog(prog?: string): boolean {
  if (!prog) return false;
  const lower = prog.toLowerCase();
  return (
    lower.includes('postfix') ||
    lower.includes('smtp') ||
    lower.includes('qmgr') ||
    lower.includes('cleanup') ||
    lower.includes('bounce') ||
    lower.includes('lmtp')
  );
}

export function QueuePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Controls & auto-refresh
  const [refreshInterval, setRefreshInterval] = useState<number | false>(5000);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'deferred' | 'held' | 'active'>('all');
  const [selectedMessage, setSelectedMessage] = useState<NormalizedQueueEntry | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Live Logs section state
  const [showLogs, setShowLogs] = useState(true);
  const [logEvents, setLogEvents] = useState<LogEvent[]>([]);
  const [logsPaused, setLogsPaused] = useState(false);
  const logsPausedRef = useRef(logsPaused);
  useEffect(() => {
    logsPausedRef.current = logsPaused;
  }, [logsPaused]);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Fetch Queue
  const {
    data: rawQueue = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery<RawQueueEntry[]>({
    queryKey: ['admin', 'queue'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/queue', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch queue');
      return res.json();
    },
    refetchInterval: refreshInterval,
  });

  const queue = useMemo(() => {
    return rawQueue.map(normalizeQueueEntry);
  }, [rawQueue]);

  // Micro-dashboard metrics
  const metrics = useMemo(() => {
    const totalCount = queue.length;
    const totalBytes = queue.reduce((sum, item) => sum + item.sizeBytes, 0);
    const deferredCount = queue.filter((it) => it.queueName === 'deferred').length;
    const heldCount = queue.filter((it) => it.queueName === 'held').length;
    const activeCount = queue.filter((it) => it.queueName === 'active').length;

    const oldestTimestamp = queue.reduce<number | null>((oldest, it) => {
      if (!it.arrivalTime) return oldest;
      return oldest === null ? it.arrivalTime : Math.min(oldest, it.arrivalTime);
    }, null);

    return {
      totalCount,
      totalBytes,
      deferredCount,
      heldCount,
      activeCount,
      oldestAge: oldestTimestamp ? formatRelativeTime(new Date(oldestTimestamp)) : '—',
    };
  }, [queue]);

  // Filtering
  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      if (statusFilter !== 'all' && item.queueName !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inId = item.id.toLowerCase().includes(q);
        const inSender = item.sender.toLowerCase().includes(q);
        const inRecipients = item.recipients.some((r) => r.toLowerCase().includes(q));
        const inReason = (item.reason || '').toLowerCase().includes(q);
        return inId || inSender || inRecipients || inReason;
      }
      return true;
    });
  }, [queue, statusFilter, searchQuery]);

  // Mutations
  const flushMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi('/api/v1/admin/queue/flush', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Flush failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'queue'] });
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'hold' | 'release' | 'requeue' }) => {
      const res = await fetchApi(`/api/v1/admin/queue/${id}/${action}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Action ${action} failed`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'queue'] });
      if (selectedMessage) setSelectedMessage(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchApi(`/api/v1/admin/queue/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'queue'] });
      if (selectedMessage) setSelectedMessage(null);
    },
  });

  // Preload and Stream Delivery Logs
  useEffect(() => {
    let active = true;
    const preload = async () => {
      try {
        const res = await fetchApi('/api/v1/admin/logs?limit=50', { credentials: 'include' });
        if (res.ok && active) {
          const data = await res.json();
          const items = Array.isArray(data.items) ? data.items : [];
          const mtaLogs = items.filter((log: LogEvent) => isMtaLog(log.prog));
          setLogEvents(mtaLogs);
        }
      } catch {
        // ignore
      }
    };
    preload();

    let source: EventSource | null = null;
    try {
      source = new EventSource('/api/v1/admin/logs/stream');
      source.onmessage = (event) => {
        if (logsPausedRef.current) return;
        try {
          const parsed = JSON.parse(event.data) as LogEvent;
          if (isMtaLog(parsed.prog)) {
            setLogEvents((prev) => [parsed, ...prev].slice(0, 200));
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }

    return () => {
      active = false;
      source?.close();
    };
  }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Table Columns
  const columns: TableColumn<NormalizedQueueEntry>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (row) => (
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <button
            type="button"
            className="text-mg-primary font-bold hover:underline"
            onClick={() => setSelectedMessage(row)}
            title={t('admin.queue.viewDetails', 'Посмотреть детали сообщения')}
          >
            {row.id}
          </button>
          <button
            type="button"
            className="text-mg-text-muted hover:text-mg-text rounded p-0.5 transition-colors"
            onClick={() => handleCopy(row.id)}
            title={t('common.copy', 'Копировать ID')}
          >
            {copiedId === row.id ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('common.status', 'Статус'),
      render: (row) => {
        let tone: 'primary' | 'warning' | 'danger' = 'primary';
        let label = 'В процессе';
        let Icon = Activity;

        if (row.queueName === 'held') {
          tone = 'warning';
          label = 'Заморожено';
          Icon = PauseCircle;
        } else if (row.queueName === 'deferred') {
          tone = 'danger';
          label = 'Отложено';
          Icon = Clock;
        }

        return (
          <div className="space-y-1">
            <Badge tone={tone} className="inline-flex items-center gap-1">
              <Icon className="h-3 w-3" />
              <span>{label}</span>
            </Badge>
            {row.reason ? (
              <div
                className="text-mg-danger flex max-w-xs cursor-pointer items-center gap-1 truncate text-xs"
                title={row.reason}
                onClick={() => setSelectedMessage(row)}
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="truncate">{row.reason}</span>
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'sender',
      header: t('admin.queue.from', 'Отправитель'),
      render: (row) => (
        <span
          className="text-mg-text block max-w-[180px] truncate font-mono text-sm"
          title={row.sender}
        >
          {row.sender || '—'}
        </span>
      ),
    },
    {
      key: 'recipients',
      header: t('admin.queue.to', 'Получатели'),
      render: (row) => (
        <div className="space-y-0.5">
          {row.recipients.map((rcpt, idx) => (
            <span
              key={idx}
              className="bg-mg-card-subtle text-mg-text-muted mr-1 inline-block rounded px-1.5 py-0.5 font-mono text-xs"
              title={rcpt}
            >
              {rcpt}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'size',
      header: t('admin.queue.size', 'Размер'),
      render: (row) => (
        <span className="text-mg-text-muted text-xs whitespace-nowrap">
          {formatBytes(row.sizeBytes)}
        </span>
      ),
    },
    {
      key: 'age',
      header: t('admin.queue.age', 'В очереди'),
      render: (row) => (
        <span
          className="text-mg-text-muted text-xs whitespace-nowrap"
          title={row.arrivalDate ? row.arrivalDate.toLocaleString() : undefined}
        >
          {formatRelativeTime(row.arrivalDate)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end gap-1.5">
          {row.queueName === 'held' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => actionMutation.mutate({ id: row.id, action: 'release' })}
              isLoading={actionMutation.isPending}
              title={t('admin.queue.release', 'Разморозить и вернуть в отправку')}
              className="h-7 px-2 text-xs"
            >
              <Play className="mr-1 h-3 w-3" />
              {t('admin.queue.release', 'Release')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => actionMutation.mutate({ id: row.id, action: 'hold' })}
              isLoading={actionMutation.isPending}
              title={t('admin.queue.hold', 'Приостановить отправку (Hold)')}
              className="h-7 px-2 text-xs"
            >
              <PauseCircle className="mr-1 h-3 w-3" />
              {t('admin.queue.hold', 'Hold')}
            </Button>
          )}

          <Button
            size="sm"
            variant="secondary"
            onClick={() => actionMutation.mutate({ id: row.id, action: 'requeue' })}
            isLoading={actionMutation.isPending}
            title={t('common.retry', 'Перезапустить немедленно (Requeue)')}
            className="h-7 px-2 text-xs"
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            {t('common.retry', 'Requeue')}
          </Button>

          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (
                confirm(
                  t(
                    'admin.queue.confirmDelete',
                    `Удалить письмо ${row.id} из очереди безвозвратно?`,
                  ),
                )
              ) {
                deleteMutation.mutate(row.id);
              }
            }}
            isLoading={deleteMutation.isPending}
            title={t('common.delete', 'Удалить из очереди')}
            className="h-7 px-2 text-xs"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* 1. Header & Primary Actions */}
      <PageHeader
        title={t('nav.admin.queue', 'Очередь сообщений')}
        description={t(
          'admin.queue.description',
          'Управление очередью доставки почтового ядра Postfix (активные, отложенные и замороженные письма)',
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Auto-refresh interval selector */}
            <div className="bg-mg-card border-mg-border-subtle text-mg-text-muted flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs">
              <StatusDot tone={refreshInterval ? 'success' : 'neutral'} pulse={!!refreshInterval} />
              <span>{refreshInterval ? `${refreshInterval / 1000}с` : 'Пауза'}</span>
              <select
                value={refreshInterval === false ? 'off' : refreshInterval.toString()}
                onChange={(e) => {
                  const val = e.target.value;
                  setRefreshInterval(val === 'off' ? false : Number(val));
                }}
                className="text-mg-text cursor-pointer border-0 bg-transparent p-0 text-xs focus:ring-0"
                title={t('admin.queue.autoRefresh', 'Интервал автообновления')}
              >
                <option value="3000">3 сек</option>
                <option value="5000">5 сек</option>
                <option value="10000">10 сек</option>
                <option value="off">Выкл</option>
              </select>
            </div>

            {/* Manual refresh button */}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => refetch()}
              isLoading={isFetching}
              title={t('common.refresh', 'Обновить сейчас')}
            >
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', isFetching && 'animate-spin')} />
              {t('common.refresh', 'Обновить')}
            </Button>

            {/* Flush queue button */}
            <Button
              size="sm"
              variant="primary"
              onClick={() => flushMutation.mutate()}
              isLoading={flushMutation.isPending}
              title={t(
                'admin.queue.flushTooltip',
                'Попытаться немедленно доставить все отложенные письма',
              )}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {t('admin.queue.flush', 'Сбросить очередь (Flush)')}
            </Button>
          </div>
        }
      />

      {/* 2. Micro-Dashboard (Key Metrics) */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-5">
        <Card className="flex flex-col justify-between border-l-4 border-l-blue-500 p-4">
          <div className="text-mg-text-muted mb-2 flex items-center justify-between">
            <span className="text-xs font-medium tracking-wider uppercase">Всего в очереди</span>
            <div className="rounded-lg bg-blue-500/10 p-1.5 text-blue-500">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-mg-text text-2xl font-bold">{metrics.totalCount}</div>
            <div className="text-mg-text-muted mt-0.5 text-xs">
              Объем: {formatBytes(metrics.totalBytes)}
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between border-l-4 border-l-amber-500 p-4">
          <div className="text-mg-text-muted mb-2 flex items-center justify-between">
            <span className="text-xs font-medium tracking-wider uppercase">Отложенные</span>
            <div className="rounded-lg bg-amber-500/10 p-1.5 text-amber-500">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-500">{metrics.deferredCount}</div>
            <div className="text-mg-text-muted mt-0.5 text-xs">Временные сбои (retry)</div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between border-l-4 border-l-purple-500 p-4">
          <div className="text-mg-text-muted mb-2 flex items-center justify-between">
            <span className="text-xs font-medium tracking-wider uppercase">Замороженные</span>
            <div className="rounded-lg bg-purple-500/10 p-1.5 text-purple-500">
              <PauseCircle className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-purple-500">{metrics.heldCount}</div>
            <div className="text-mg-text-muted mt-0.5 text-xs">Остановлены вручную</div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between border-l-4 border-l-emerald-500 p-4">
          <div className="text-mg-text-muted mb-2 flex items-center justify-between">
            <span className="text-xs font-medium tracking-wider uppercase">Активные</span>
            <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-500">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-500">{metrics.activeCount}</div>
            <div className="text-mg-text-muted mt-0.5 text-xs">В процессе отправки</div>
          </div>
        </Card>

        <Card className="col-span-2 flex flex-col justify-between border-l-4 border-l-slate-500 p-4 md:col-span-1">
          <div className="text-mg-text-muted mb-2 flex items-center justify-between">
            <span className="text-xs font-medium tracking-wider uppercase">Самое старое</span>
            <div className="rounded-lg bg-slate-500/10 p-1.5 text-slate-400">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div>
            <div className="text-mg-text truncate text-lg font-bold">{metrics.oldestAge}</div>
            <div className="text-mg-text-muted mt-0.5 text-xs">Макс. задержка в spool</div>
          </div>
        </Card>
      </div>

      {/* 3. Toolbar & Status Filter Tabs */}
      <div className="bg-mg-card border-mg-border-subtle flex flex-col justify-between gap-3 rounded-xl border p-3 md:flex-row md:items-center">
        {/* Filter Pills */}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              statusFilter === 'all'
                ? 'bg-mg-primary text-white'
                : 'bg-mg-card-subtle text-mg-text-muted hover:text-mg-text hover:bg-mg-card-hover',
            )}
          >
            <span>Все</span>
            <span className="py-0.2 rounded-full bg-black/20 px-1.5 text-[10px]">
              {metrics.totalCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('deferred')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              statusFilter === 'deferred'
                ? 'bg-amber-500 text-white'
                : 'bg-mg-card-subtle text-mg-text-muted hover:text-mg-text hover:bg-mg-card-hover',
            )}
          >
            <span>Отложенные</span>
            <span className="py-0.2 rounded-full bg-black/20 px-1.5 text-[10px]">
              {metrics.deferredCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('held')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              statusFilter === 'held'
                ? 'bg-purple-600 text-white'
                : 'bg-mg-card-subtle text-mg-text-muted hover:text-mg-text hover:bg-mg-card-hover',
            )}
          >
            <span>Замороженные</span>
            <span className="py-0.2 rounded-full bg-black/20 px-1.5 text-[10px]">
              {metrics.heldCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              statusFilter === 'active'
                ? 'bg-emerald-600 text-white'
                : 'bg-mg-card-subtle text-mg-text-muted hover:text-mg-text hover:bg-mg-card-hover',
            )}
          >
            <span>Активные</span>
            <span className="py-0.2 rounded-full bg-black/20 px-1.5 text-[10px]">
              {metrics.activeCount}
            </span>
          </button>
        </div>

        {/* Live Search */}
        <div className="relative min-w-[260px]">
          <Search className="text-mg-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('admin.queue.searchPlaceholder', 'Поиск по ID, email, ошибке...')}
            className="bg-mg-card-subtle border-mg-border-subtle text-mg-text placeholder-mg-text-muted focus:border-mg-primary w-full rounded-lg border py-1.5 pr-8 pl-9 text-xs focus:outline-none"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-mg-text-muted hover:text-mg-text absolute top-1/2 right-2.5 -translate-y-1/2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* 4. Queue Table Card */}
      <Card>
        <Table
          columns={columns}
          rows={filteredQueue}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={
            searchQuery || statusFilter !== 'all'
              ? t('admin.queue.noFilterResults', 'По заданному фильтру сообщений не найдено')
              : t('admin.queue.empty', 'Почтовая очередь пуста — все сообщения доставлены!')
          }
        />
      </Card>

      {/* 5. Live MTA Delivery Logs Terminal */}
      <Card className="border-mg-border-subtle overflow-hidden border">
        <div
          className="bg-mg-card-subtle flex cursor-pointer items-center justify-between px-4 py-3 select-none"
          onClick={() => setShowLogs(!showLogs)}
        >
          <div className="flex items-center gap-2">
            <Terminal className="text-mg-primary h-4 w-4" />
            <span className="text-mg-text text-sm font-semibold">
              {t(
                'admin.queue.liveLogsTitle',
                'Живой журнал доставки MTA (Postfix Delivery Stream)',
              )}
            </span>
            <span className="text-mg-text-muted bg-mg-card inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-normal">
              <StatusDot tone="success" pulse />
              Live SSE
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-mg-text-muted hover:text-mg-text bg-mg-card border-mg-border-subtle rounded border px-2 py-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setLogsPaused(!logsPaused);
              }}
            >
              {logsPaused ? 'Возобновить' : 'Пауза'}
            </button>
            <button
              type="button"
              className="text-mg-text-muted hover:text-mg-text bg-mg-card border-mg-border-subtle rounded border px-2 py-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setLogEvents([]);
              }}
            >
              Очистить
            </button>
            {showLogs ? (
              <ChevronUp className="text-mg-text-muted h-4 w-4" />
            ) : (
              <ChevronDown className="text-mg-text-muted h-4 w-4" />
            )}
          </div>
        </div>

        {showLogs && (
          <div
            ref={logContainerRef}
            className="max-h-64 space-y-1 overflow-y-auto bg-zinc-950 p-3 font-mono text-[11px] leading-5 text-zinc-300 select-text"
          >
            {logEvents.length === 0 ? (
              <div className="py-4 text-center text-zinc-500 italic">
                Ожидание транзакций доставки Postfix... Сообщения появятся при отправке писем.
              </div>
            ) : (
              logEvents.map((ev, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 rounded px-1.5 py-0.5 hover:bg-zinc-900/60"
                >
                  <span className="shrink-0 text-zinc-500 select-none">
                    {ev.ts ? ev.ts.replace('T', ' ').substring(11, 19) : ''}
                  </span>
                  <span className="shrink-0 font-bold text-blue-400">[{ev.prog}]</span>
                  <span
                    className={cn(
                      'break-all',
                      ev.sev === 'warning' ||
                        ev.msg?.includes('deferred') ||
                        ev.msg?.includes('reject')
                        ? 'text-amber-300'
                        : ev.sev === 'error' || ev.msg?.includes('bounced')
                          ? 'text-rose-400'
                          : 'text-zinc-200',
                    )}
                  >
                    {ev.msg}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </Card>

      {/* 6. Message Inspector Details Modal */}
      {selectedMessage && (
        <Modal
          open={true}
          onClose={() => setSelectedMessage(null)}
          title={`Детали сообщения очереди: ${selectedMessage.id}`}
        >
          <div className="space-y-4 text-sm">
            <div className="bg-mg-card-subtle grid grid-cols-2 gap-3 rounded-lg p-3 text-xs">
              <div>
                <span className="text-mg-text-muted block">Queue ID</span>
                <span className="text-mg-text font-mono font-bold">{selectedMessage.id}</span>
              </div>
              <div>
                <span className="text-mg-text-muted block">Категория spool</span>
                <Badge
                  tone={
                    selectedMessage.queueName === 'held'
                      ? 'warning'
                      : selectedMessage.queueName === 'deferred'
                        ? 'danger'
                        : 'primary'
                  }
                >
                  {selectedMessage.queueName}
                </Badge>
              </div>
              <div>
                <span className="text-mg-text-muted block">Размер</span>
                <span className="text-mg-text">
                  {formatBytes(selectedMessage.sizeBytes)} ({selectedMessage.sizeBytes} B)
                </span>
              </div>
              <div>
                <span className="text-mg-text-muted block">Время поступления</span>
                <span className="text-mg-text">
                  {selectedMessage.arrivalDate ? selectedMessage.arrivalDate.toLocaleString() : '—'}
                </span>
              </div>
            </div>

            <div>
              <span className="text-mg-text-muted mb-1 block text-xs font-medium">
                Отправитель (Envelope From)
              </span>
              <div className="bg-mg-card-subtle text-mg-text rounded p-2 font-mono text-xs break-all">
                {selectedMessage.sender || '—'}
              </div>
            </div>

            <div>
              <span className="text-mg-text-muted mb-1 block text-xs font-medium">
                Получатели (Recipients)
              </span>
              <div className="space-y-1">
                {selectedMessage.recipientDetails.map((r, i) => (
                  <div key={i} className="bg-mg-card-subtle space-y-1 rounded p-2 text-xs">
                    <div className="text-mg-text font-mono font-semibold">{r.address}</div>
                    {r.reason && (
                      <div className="text-mg-danger font-mono text-[11px] leading-relaxed break-all">
                        {r.reason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {selectedMessage.reason && (
              <div>
                <span className="text-mg-text-muted mb-1 block text-xs font-medium">
                  Диагностическая ошибка (Delay Reason)
                </span>
                <div className="rounded border border-rose-500/20 bg-rose-500/10 p-2.5 font-mono text-xs leading-relaxed break-all text-rose-300">
                  {selectedMessage.reason}
                </div>
              </div>
            )}

            <div className="border-mg-border-subtle flex items-center justify-end gap-2 border-t pt-2">
              {selectedMessage.queueName === 'held' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    actionMutation.mutate({ id: selectedMessage.id, action: 'release' })
                  }
                  isLoading={actionMutation.isPending}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Разморозить (Release)
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => actionMutation.mutate({ id: selectedMessage.id, action: 'hold' })}
                  isLoading={actionMutation.isPending}
                >
                  <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
                  Заморозить (Hold)
                </Button>
              )}

              <Button
                size="sm"
                variant="secondary"
                onClick={() => actionMutation.mutate({ id: selectedMessage.id, action: 'requeue' })}
                isLoading={actionMutation.isPending}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Requeue
              </Button>

              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (confirm(`Удалить сообщение ${selectedMessage.id} безвозвратно?`)) {
                    deleteMutation.mutate(selectedMessage.id);
                  }
                }}
                isLoading={deleteMutation.isPending}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Удалить
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
