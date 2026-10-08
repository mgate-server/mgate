import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DownloadCloud,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Inbox,
  HardDrive,
  Mail,
  Server,
  StopCircle,
} from 'lucide-react';
import { Button, Card, Badge } from '@mgate/ui';
import { fetchApi } from '../../../lib/apiClient';
import { MigrationWizardModal } from './MigrationWizardModal';

interface MigrationBatch {
  id: string;
  name: string;
  source_type: string;
  source_host: string;
  source_port: number;
  source_ssl: boolean;
  target_domain_id: string;
  status: 'draft' | 'validating' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  total_messages_synced: number;
  total_bytes_synced: number;
  created_at: string;
  finished_at?: string | null;
}

interface MigrationTask {
  id: string;
  batch_id: string;
  source_user: string;
  target_mailbox_id: string;
  target_address: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  messages_synced: number;
  bytes_synced: number;
  current_folder?: string | null;
  last_error?: string | null;
  attempts: number;
  started_at?: string | null;
  finished_at?: string | null;
}

interface BatchDetailsResponse {
  batch: MigrationBatch;
  tasks: MigrationTask[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function MigrationPage() {
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  // Fetch batches with live polling
  const { data: batches = [], isLoading: batchesLoading } = useQuery<MigrationBatch[]>({
    queryKey: ['migration-batches'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/migration/batches');
      if (!res.ok) throw new Error('Failed to load migration batches');
      return res.json();
    },
    refetchInterval: 3000,
  });

  // Fetch domains for the wizard
  const { data: domains = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['admin-domains-list'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/domains');
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch details for expanded batch
  const { data: batchDetails } = useQuery<BatchDetailsResponse>({
    queryKey: ['migration-batch-details', expandedBatchId],
    queryFn: async () => {
      if (!expandedBatchId) return null as unknown as BatchDetailsResponse;
      const res = await fetchApi(`/api/v1/admin/migration/batches/${expandedBatchId}`);
      if (!res.ok) throw new Error('Failed to load batch details');
      return res.json();
    },
    enabled: !!expandedBatchId,
    refetchInterval: expandedBatchId ? 3000 : false,
  });

  // Re-sync mutation
  const syncAgainMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await fetchApi(`/api/v1/admin/migration/batches/${batchId}/sync-again`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to trigger re-sync');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-batches'] });
      queryClient.invalidateQueries({ queryKey: ['migration-batch-details', expandedBatchId] });
    },
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await fetchApi(`/api/v1/admin/migration/batches/${batchId}/cancel`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to cancel batch');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-batches'] });
      queryClient.invalidateQueries({ queryKey: ['migration-batch-details', expandedBatchId] });
    },
  });

  // Aggregated stats
  const totalBatches = batches.length;
  const runningBatches = batches.filter((b) => b.status === 'running' || b.status === 'pending').length;
  const totalMessages = batches.reduce((acc, b) => acc + (b.total_messages_synced || 0), 0);
  const totalBytes = batches.reduce((acc, b) => acc + (b.total_bytes_synced || 0), 0);

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-500">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Выполняется
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-500">
            <CheckCircle2 className="h-3 w-3" />
            Завершено
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-500">
            <XCircle className="h-3 w-3" />
            Ошибка
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-500/10 px-2.5 py-0.5 text-xs font-semibold text-gray-500">
            <StopCircle className="h-3 w-3" />
            Отменено
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-500">
            <Clock className="h-3 w-3" />
            В очереди
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Импорт и миграция</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Бесшовный перенос почтовых ящиков, писем и структуры папок с Яндекс 360, Mail.ru,
            Google Workspace и любых серверов IMAP.
          </p>
        </div>
        <Button onClick={() => setWizardOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Начать новый перенос
        </Button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
              <DownloadCloud className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--muted-foreground)]">Всего пакетов</p>
              <p className="text-xl font-bold">{totalBatches}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <RefreshCw className={`h-5 w-5 ${runningBatches > 0 ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--muted-foreground)]">В процессе</p>
              <p className="text-xl font-bold">{runningBatches}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--muted-foreground)]">Писем перенесено</p>
              <p className="text-xl font-bold">{totalMessages.toLocaleString('ru-RU')}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--muted-foreground)]">Объем данных</p>
              <p className="text-xl font-bold">{formatBytes(totalBytes)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Batches List */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold">История и активные пакеты переноса</h2>

        {batchesLoading ? (
          <Card className="p-8 text-center text-sm text-[var(--muted-foreground)]">
            Загрузка списка миграций...
          </Card>
        ) : batches.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-500 mb-4">
              <DownloadCloud className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold">Нет активных или прошлых миграций</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)] max-w-md mx-auto">
              Вы можете запустить перенос с облачных сервисов (Яндекс 360, VK WorkSpace, Google)
              или произвольного IMAP-сервера прямо сейчас.
            </p>
            <Button onClick={() => setWizardOpen(true)} className="mt-4 gap-2">
              <Plus className="h-4 w-4" />
              Запустить мастер миграции
            </Button>
          </Card>
        ) : (
          batches.map((batch) => {
            const isExpanded = expandedBatchId === batch.id;
            const percent =
              batch.total_tasks > 0
                ? Math.round((batch.completed_tasks / batch.total_tasks) * 100)
                : 0;

            return (
              <Card key={batch.id} className="overflow-hidden transition-all">
                <div className="p-5 space-y-4">
                  {/* Batch Header */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-base">{batch.name}</h3>
                        {renderStatusBadge(batch.status)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
                        <span className="flex items-center gap-1">
                          <Server className="h-3.5 w-3.5" />
                          {batch.source_host}:{batch.source_port}
                          {batch.source_ssl && ' (SSL)'}
                        </span>
                        <span>Создан: {new Date(batch.created_at).toLocaleString('ru-RU')}</span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                      {batch.status === 'running' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => cancelMutation.mutate(batch.id)}
                          disabled={cancelMutation.isPending}
                          className="text-red-500 hover:text-red-600"
                        >
                          <StopCircle className="h-3.5 w-3.5 mr-1" />
                          Остановить
                        </Button>
                      )}

                      {(batch.status === 'completed' ||
                        batch.status === 'failed' ||
                        batch.status === 'cancelled') && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => syncAgainMutation.mutate(batch.id)}
                          disabled={syncAgainMutation.isPending}
                          title="Повторный перенос только новых писем (инкрементальная синхронизация)"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 mr-1 ${
                              syncAgainMutation.isPending ? 'animate-spin' : ''
                            }`}
                          />
                          Досинхронизировать
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedBatchId(isExpanded ? null : batch.id)}
                      >
                        {isExpanded ? (
                          <>
                            Скрыть <ChevronUp className="h-4 w-4 ml-1" />
                          </>
                        ) : (
                          <>
                            Детали ({batch.total_tasks} ящ.){' '}
                            <ChevronDown className="h-4 w-4 ml-1" />
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Progress Bar & Counters */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-medium">
                      <span>
                        Прогресс: {batch.completed_tasks} из {batch.total_tasks} ящиков завершено
                        {batch.failed_tasks > 0 && (
                          <span className="text-red-500 ml-2">({batch.failed_tasks} с ошибками)</span>
                        )}
                      </span>
                      <span>{percent}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[var(--muted)] overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${
                          batch.status === 'failed'
                            ? 'bg-red-500'
                            : batch.status === 'completed'
                            ? 'bg-emerald-500'
                            : 'bg-[var(--primary)]'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-[var(--muted-foreground)] pt-0.5">
                      <span>Писем перенесено: {batch.total_messages_synced.toLocaleString('ru-RU')}</span>
                      <span>Объем: {formatBytes(batch.total_bytes_synced)}</span>
                    </div>
                  </div>
                </div>

                {/* Expanded Mailbox Tasks */}
                {isExpanded && (
                  <div className="border-t border-[var(--border)] bg-[var(--muted)]/10 p-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
                      Почтовые ящики в пакете
                    </h4>

                    {batchDetails && batchDetails.tasks ? (
                      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--background)]">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-[var(--border)] bg-[var(--muted)]/30 font-medium">
                            <tr>
                              <th className="p-2.5">Исходный аккаунт</th>
                              <th className="p-2.5">Целевой ящик в MGate</th>
                              <th className="p-2.5">Статус</th>
                              <th className="p-2.5 text-right">Сообщений</th>
                              <th className="p-2.5 text-right">Объем</th>
                              <th className="p-2.5">Информация / Ошибка</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border)]">
                            {batchDetails.tasks.map((task) => (
                              <tr key={task.id} className="hover:bg-[var(--muted)]/20">
                                <td className="p-2.5 font-mono">{task.source_user}</td>
                                <td className="p-2.5 font-medium">{task.target_address}</td>
                                <td className="p-2.5">{renderStatusBadge(task.status)}</td>
                                <td className="p-2.5 text-right font-mono">
                                  {task.messages_synced.toLocaleString('ru-RU')}
                                </td>
                                <td className="p-2.5 text-right font-mono">
                                  {formatBytes(task.bytes_synced)}
                                </td>
                                <td className="p-2.5 text-[var(--muted-foreground)] max-w-xs truncate">
                                  {task.last_error ? (
                                    <span className="text-red-500" title={task.last_error}>
                                      {task.last_error}
                                    </span>
                                  ) : task.status === 'running' ? (
                                    <span className="text-blue-500">
                                      Синхронизация папок IMAP...
                                    </span>
                                  ) : task.status === 'completed' ? (
                                    <span className="text-emerald-500">Перенесено успешно</span>
                                  ) : (
                                    'В очереди'
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="py-4 text-center text-xs text-[var(--muted-foreground)]">
                        Загрузка списка ящиков...
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* Migration Wizard Modal */}
      <MigrationWizardModal
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        existingDomains={domains}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['migration-batches'] });
        }}
      />
    </div>
  );
}
