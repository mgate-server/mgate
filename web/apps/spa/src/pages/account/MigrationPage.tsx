import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DownloadCloud,
  Server,
  KeyRound,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw,
  Clock,
  HardDrive,
  Mail,
  StopCircle,
  Inbox,
} from 'lucide-react';
import { Button, Card, Input, Badge } from '@mgate/ui';
import { fetchApi } from '../../lib/apiClient';

interface MigrationTaskInfo {
  id: string;
  source_user: string;
  target_address: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  messages_synced: number;
  bytes_synced: number;
  current_folder?: string | null;
  last_error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
}

interface MigrationStatusResponse {
  active_task?: MigrationTaskInfo | null;
  batch_name?: string | null;
}

interface TestConnectionResponse {
  ok: boolean;
  folders: string[];
  total_messages_estimate: number;
  error?: string | null;
}

interface Preset {
  id: string;
  name: string;
  badge: string;
  host: string;
  port: number;
  ssl: boolean;
  hint: string;
}

const PRESETS: Preset[] = [
  {
    id: 'yandex',
    name: 'Яндекс 360',
    badge: 'Я',
    host: 'imap.yandex.ru',
    port: 993,
    ssl: true,
    hint: 'В Яндекс ID включите «Пароли приложений» и создайте пароль типа «Почта».',
  },
  {
    id: 'mailru',
    name: 'Mail.ru / VK',
    badge: 'VK',
    host: 'imap.mail.ru',
    port: 993,
    ssl: true,
    hint: 'В настройках безопасности Mail.ru создайте «Пароль для внешних приложений».',
  },
  {
    id: 'google',
    name: 'Gmail / Google',
    badge: 'G',
    host: 'imap.gmail.com',
    port: 993,
    ssl: true,
    hint: 'В Google Account включите 2-Step Verification и создайте App Password.',
  },
  {
    id: 'custom',
    name: 'Другой сервер',
    badge: 'IMAP',
    host: '',
    port: 993,
    ssl: true,
    hint: 'Укажите адрес сервера IMAP и учетные данные вашего внешнего провайдера.',
  },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function MigrationPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [selectedPreset, setSelectedPreset] = useState<string>('yandex');
  const [host, setHost] = useState(PRESETS[0]!.host);
  const [port, setPort] = useState(PRESETS[0]!.port);
  const [ssl, setSsl] = useState(PRESETS[0]!.ssl);
  const [sourceUser, setSourceUser] = useState('');
  const [sourcePassword, setSourcePassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  // Test connection state
  const [testResult, setTestResult] = useState<TestConnectionResponse | null>(null);

  // Query latest migration
  const { data: statusData, isLoading } = useQuery<MigrationStatusResponse>({
    queryKey: ['account-migration-status'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/account/migration');
      if (!res.ok) throw new Error('Failed to load migration status');
      return res.json();
    },
    refetchInterval: (query) => {
      const task = query.state.data?.active_task;
      if (task && (task.status === 'pending' || task.status === 'running')) {
        return 2500;
      }
      return false;
    },
  });

  const activeTask = statusData?.active_task;

  // Test connection mutation
  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi('/api/v1/account/migration/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_host: host,
          source_port: port,
          source_ssl: ssl,
          source_user: sourceUser,
          source_password: sourcePassword,
        }),
      });
      if (!res.ok) throw new Error('Ошибка сети при проверке подключения');
      return res.json() as Promise<TestConnectionResponse>;
    },
    onSuccess: (data) => {
      setTestResult(data);
    },
    onError: (err: Error) => {
      setTestResult({
        ok: false,
        folders: [],
        total_messages_estimate: 0,
        error: err.message,
      });
    },
  });

  // Start migration mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi('/api/v1/account/migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: selectedPreset,
          source_host: host,
          source_port: port,
          source_ssl: ssl,
          source_user: sourceUser,
          source_password: sourcePassword,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Не удалось запустить миграцию');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-migration-status'] });
      setShowNewForm(false);
      setTestResult(null);
      setSourcePassword('');
    },
  });

  // Cancel migration mutation
  const cancelMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetchApi(`/api/v1/account/migration/${taskId}/cancel`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Не удалось отменить задачу');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-migration-status'] });
    },
  });

  const handleSelectPreset = (preset: Preset) => {
    setSelectedPreset(preset.id);
    if (preset.id !== 'custom') {
      setHost(preset.host);
      setPort(preset.port);
      setSsl(preset.ssl);
    }
    setTestResult(null);
  };

  const currentHint = PRESETS.find((p) => p.id === selectedPreset)?.hint || '';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="border-mg-border-subtle flex items-center gap-3 border-b pb-4">
        <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
          <DownloadCloud className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-mg-text text-xl font-semibold tracking-tight">
            {t('nav.account.migration', 'Импорт почты (IMAP Sync)')}
          </h1>
          <p className="text-mg-text-muted text-xs">
            Безопасный перенос писем, папок и архива из внешнего почтового сервиса в ваш ящик MGate
          </p>
        </div>
      </div>

      {isLoading ? (
        <Card className="text-mg-text-muted p-8 text-center text-xs">
          <Loader2 className="text-mg-primary mx-auto mb-2 h-5 w-5 animate-spin" />
          Загрузка состояния миграции...
        </Card>
      ) : activeTask && !showNewForm ? (
        /* Active / Completed Task View */
        <Card className="space-y-6 p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-mg-text text-sm font-semibold">
                  Импорт из {activeTask.source_user}
                </span>
                <StatusBadge status={activeTask.status} />
              </div>
              <p className="text-mg-text-muted text-xs">
                Целевой ящик:{' '}
                <span className="text-mg-text font-mono">{activeTask.target_address}</span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              {(activeTask.status === 'pending' || activeTask.status === 'running') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cancelMutation.mutate(activeTask.id)}
                  disabled={cancelMutation.isPending}
                  className="border-red-500/20 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                >
                  <StopCircle className="mr-1 h-4 w-4" />
                  Остановить
                </Button>
              )}
              {(activeTask.status === 'completed' ||
                activeTask.status === 'failed' ||
                activeTask.status === 'cancelled') && (
                <Button variant="outline" size="sm" onClick={() => setShowNewForm(true)}>
                  <RefreshCw className="mr-1 h-4 w-4" />
                  Новый импорт
                </Button>
              )}
            </div>
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-3">
            <div className="bg-mg-surface border-mg-border-subtle flex items-center gap-3 rounded-lg border p-3">
              <Mail className="text-mg-primary h-5 w-5 shrink-0" />
              <div>
                <p className="text-mg-text-muted text-xs">Перенесено писем</p>
                <p className="text-mg-text text-base font-semibold">
                  {activeTask.messages_synced.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="bg-mg-surface border-mg-border-subtle flex items-center gap-3 rounded-lg border p-3">
              <HardDrive className="h-5 w-5 shrink-0 text-emerald-500" />
              <div>
                <p className="text-mg-text-muted text-xs">Объем данных</p>
                <p className="text-mg-text text-base font-semibold">
                  {formatBytes(activeTask.bytes_synced)}
                </p>
              </div>
            </div>

            <div className="bg-mg-surface border-mg-border-subtle flex items-center gap-3 rounded-lg border p-3">
              <Inbox className="h-5 w-5 shrink-0 text-amber-500" />
              <div>
                <p className="text-mg-text-muted text-xs">Текущая папка</p>
                <p className="text-mg-text max-w-[140px] truncate text-base font-semibold">
                  {activeTask.current_folder || 'Завершено'}
                </p>
              </div>
            </div>
          </div>

          {/* Error banner if failed */}
          {activeTask.last_error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <span className="font-semibold">Причина остановки: </span>
                {activeTask.last_error}
              </div>
            </div>
          )}

          {/* Success banner if completed */}
          {activeTask.status === 'completed' && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                Все сообщения успешно перенесены в ваш почтовый ящик MGate. Они уже доступны в
                веб-почте!
              </span>
            </div>
          )}
        </Card>
      ) : (
        /* New Migration Wizard Form */
        <Card className="space-y-6 p-6">
          <div className="space-y-3">
            <label className="text-mg-text text-xs font-semibold tracking-wider uppercase">
              1. Выберите почтовый сервис
            </label>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPreset(p)}
                  className={`flex flex-col justify-between rounded-lg border p-3 text-left transition-all ${
                    selectedPreset === p.id
                      ? 'border-mg-primary bg-mg-primary/10 shadow-sm'
                      : 'border-mg-border-subtle bg-mg-surface hover:border-mg-border'
                  }`}
                >
                  <span className="bg-mg-surface-subtle mb-2 w-fit rounded px-2 py-0.5 text-xs font-bold">
                    {p.badge}
                  </span>
                  <span className="text-mg-text text-xs font-semibold">{p.name}</span>
                </button>
              ))}
            </div>
            {currentHint && (
              <p className="text-mg-text-muted bg-mg-surface border-mg-border-subtle rounded border p-2.5 text-xs">
                💡 {currentHint}
              </p>
            )}
          </div>

          <div className="border-mg-border-subtle space-y-4 border-t pt-2">
            <label className="text-mg-text text-xs font-semibold tracking-wider uppercase">
              2. Параметры внешнего ящика
            </label>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="text-mg-text-muted mb-1 block text-xs">IMAP Сервер</label>
                <Input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="imap.example.com"
                  disabled={selectedPreset !== 'custom'}
                  className="font-mono text-xs"
                />
              </div>

              <div>
                <label className="text-mg-text-muted mb-1 block text-xs">Порт (SSL/TLS)</label>
                <Input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  disabled={selectedPreset !== 'custom'}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-mg-text-muted mb-1 block text-xs">
                  Email или логин на стороннем сервисе
                </label>
                <Input
                  value={sourceUser}
                  onChange={(e) => {
                    setSourceUser(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="user@example.com"
                  className="font-mono text-xs"
                />
              </div>

              <div>
                <label className="text-mg-text-muted mb-1 block text-xs">
                  Пароль приложения / Пароль
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={sourcePassword}
                    onChange={(e) => {
                      setSourcePassword(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="••••••••••••••••"
                    className="pr-10 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-mg-text-muted hover:text-mg-text absolute top-1/2 right-2.5 -translate-y-1/2"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Test connection result banner */}
          {testResult && (
            <div
              className={`rounded-lg border p-4 text-xs ${
                testResult.ok
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                  : 'border-red-500/20 bg-red-500/10 text-red-400'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {testResult.ok ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Соединение успешно установлено!
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 shrink-0" />
                    Ошибка соединения: {testResult.error || 'Неверный логин или пароль'}
                  </>
                )}
              </div>
              {testResult.ok && (
                <div className="text-mg-text-muted mt-2 space-y-1 text-xs">
                  <p>
                    Обнаружено папок:{' '}
                    <span className="text-mg-text font-semibold">{testResult.folders.length}</span>{' '}
                    ({testResult.folders.slice(0, 5).join(', ')}
                    {testResult.folders.length > 5 ? '…' : ''})
                  </p>
                  <p>
                    Ориентировочно писем к переносу:{' '}
                    <span className="text-mg-text font-semibold">
                      {testResult.total_messages_estimate.toLocaleString()}
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="border-mg-border-subtle flex items-center justify-between border-t pt-3">
            {activeTask && (
              <Button variant="ghost" size="sm" onClick={() => setShowNewForm(false)}>
                Вернуться к статусу
              </Button>
            )}

            <div className="ml-auto flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testMutation.mutate()}
                disabled={!sourceUser || !sourcePassword || testMutation.isPending}
              >
                {testMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Server className="mr-1.5 h-4 w-4" />
                )}
                Проверить подключение
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => startMutation.mutate()}
                disabled={
                  !sourceUser ||
                  !sourcePassword ||
                  startMutation.isPending ||
                  (testResult !== null && !testResult.ok)
                }
              >
                {startMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <DownloadCloud className="mr-1.5 h-4 w-4" />
                )}
                Запустить перенос
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: MigrationTaskInfo['status'] }) {
  switch (status) {
    case 'running':
      return (
        <Badge tone="warning" className="flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Выполняется
        </Badge>
      );
    case 'completed':
      return (
        <Badge tone="success" className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Завершено
        </Badge>
      );
    case 'failed':
      return (
        <Badge tone="danger" className="flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          Ошибка
        </Badge>
      );
    case 'cancelled':
      return (
        <Badge tone="neutral" className="flex items-center gap-1">
          <StopCircle className="h-3 w-3" />
          Отменено
        </Badge>
      );
    case 'pending':
    default:
      return (
        <Badge tone="neutral" className="flex items-center gap-1">
          <Clock className="h-3 w-3" />В очереди
        </Badge>
      );
  }
}
