import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Smartphone, Trash2, CheckCircle2, Monitor } from 'lucide-react';
import { Button, Card, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import type { components } from '@mgate/api-client';
import { apiClient } from '../../lib/apiClient';

type SessionItem = components['schemas']['SessionSummary'];

export function SessionsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['account', 'sessions'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/account/sessions');
      if (error) throw error;
      return (data || []) as SessionItem[];
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.DELETE('/api/v1/account/sessions/{id}', {
        params: { path: { id } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] });
    },
  });

  const columns: TableColumn<SessionItem>[] = [
    {
      key: 'device',
      header: t('account.sessions.device', 'Устройство и браузер'),
      render: (s) => {
        const ua = s.user_agent || '';
        const isMobile = /mobile|iphone|android/i.test(ua);
        const Icon = isMobile ? Smartphone : Monitor;

        return (
          <div className="flex items-center gap-3">
            <div className="bg-mg-surface-subtle border-mg-border-subtle text-mg-text-muted flex h-8 w-8 items-center justify-center rounded-lg border">
              <Icon className="text-mg-primary h-4 w-4" />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="text-mg-text max-w-sm truncate text-xs font-semibold">
                {ua || t('account.sessions.unknownDevice', 'Браузер')}
              </span>
              {s.current ? (
                <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>{t('account.sessions.current', 'Текущая активная сессия')}</span>
                </span>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      key: 'ip',
      header: t('account.sessions.ip', 'IP-адрес'),
      render: (s) => (
        <span className="text-mg-text-muted bg-mg-surface-subtle border-mg-border-subtle rounded border px-2 py-0.5 font-mono text-xs">
          {s.ip || '—'}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: t('account.sessions.started', 'Начало сессии'),
      render: (s) => (
        <span className="text-mg-text-muted text-xs">
          {new Date(s.created_at).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (s) =>
        s.current ? null : (
          <div className="flex justify-end">
            <Button
              size="xs"
              variant="ghost"
              isLoading={revokeMutation.isPending}
              onClick={() => {
                if (confirm('Завершить эту сессию и отозвать доступ?')) {
                  revokeMutation.mutate(s.id);
                }
              }}
              className="text-mg-danger gap-1 hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t('account.sessions.terminate', 'Завершить')}</span>
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="border-mg-border-subtle flex items-center gap-3 border-b pb-4">
        <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
          <Laptop className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-mg-text text-xl font-semibold tracking-tight">
            {t('nav.account.sessions', 'Активные сессии')}
          </h1>
          <p className="text-mg-text-muted text-xs">
            Управление устройствами и открытыми входами в веб-интерфейс MGate
          </p>
        </div>
      </div>

      <Card className="overflow-hidden p-0 shadow-sm">
        <div className="border-mg-border-subtle bg-mg-surface-subtle/30 text-mg-text-muted border-b p-4 text-xs">
          {t(
            'account.sessions.webDesc',
            'Список активных сессий входа в веб-интерфейс. При завершении сессии токен доступа немедленно аннулируется.',
          )}
        </div>

        <Table
          columns={columns}
          rows={sessions || []}
          rowKey={(s) => s.id}
          isLoading={isLoading}
          emptyMessage={
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Laptop className="text-mg-text-muted mb-2 h-8 w-8" />
              <p className="text-mg-text text-sm font-medium">Нет активных сессий</p>
            </div>
          }
        />
      </Card>
    </div>
  );
}
