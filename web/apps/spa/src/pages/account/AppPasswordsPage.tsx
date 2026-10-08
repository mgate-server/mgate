import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Key, Plus, Trash2, Copy, Check, AlertTriangle, Info } from 'lucide-react';
import { Button, Card, Input, Modal, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import type { components } from '@mgate/api-client';
import { apiClient } from '../../lib/apiClient';

type AppPassword = components['schemas']['AppPasswordSummary'];
type NewPasswordResult = Pick<components['schemas']['NewAppPasswordResponse'], 'name' | 'password'>;

export function AppPasswordsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [passwordLabel, setPasswordLabel] = useState('');
  const [createdResult, setCreatedResult] = useState<NewPasswordResult | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: passwords, isLoading } = useQuery({
    queryKey: ['account', 'app-passwords'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/account/app-passwords');
      if (error) throw error;
      return (data || []) as AppPassword[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!passwordLabel.trim()) return;
      const { data, error } = await apiClient.POST('/api/v1/account/app-passwords', {
        body: { name: passwordLabel.trim() },
      });
      if (error) throw error;
      return data as { id: string; name: string; password: string };
    },
    onSuccess: (data) => {
      if (!data) return;
      queryClient.invalidateQueries({ queryKey: ['account', 'app-passwords'] });
      setCreateOpen(false);
      setPasswordLabel('');
      setCreatedResult({ name: data.name, password: data.password });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.DELETE('/api/v1/account/app-passwords/{id}', {
        params: { path: { id } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account', 'app-passwords'] });
    },
  });

  function handleCopy() {
    if (createdResult?.password) {
      navigator.clipboard.writeText(createdResult.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  const columns: TableColumn<AppPassword>[] = [
    {
      key: 'name',
      header: t('account.appPasswords.name', 'Приложение'),
      render: (p) => (
        <div className="flex items-center gap-3">
          <div className="bg-mg-surface-subtle border-mg-border-subtle text-mg-primary flex h-8 w-8 items-center justify-center rounded-lg border">
            <Key className="h-4 w-4" />
          </div>
          <span className="text-mg-text text-xs font-semibold">{p.name}</span>
        </div>
      ),
    },
    {
      key: 'created_at',
      header: t('account.appPasswords.created', 'Создан'),
      render: (p) => (
        <span className="text-mg-text-muted text-xs">
          {new Date(p.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'last_used_at',
      header: t('account.appPasswords.lastUsed', 'Последнее использование'),
      render: (p) => (
        <span className="text-mg-text-muted text-xs">
          {p.last_used_at
            ? new Date(p.last_used_at).toLocaleDateString()
            : t('account.appPasswords.never', 'Никогда')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <div className="flex justify-end">
          <Button
            size="xs"
            variant="ghost"
            isLoading={revokeMutation.isPending}
            onClick={() => {
              if (confirm(`Отозвать пароль приложения "${p.name}"?`)) {
                revokeMutation.mutate(p.id);
              }
            }}
            className="text-mg-danger gap-1 hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Отозвать</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="border-mg-border-subtle flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
            <Key className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-mg-text text-xl font-semibold tracking-tight">
              {t('nav.account.appPasswords', 'Пароли приложений')}
            </h1>
            <p className="text-mg-text-muted text-xs">
              Специальные пароли для почтовых клиентов (IMAP, SMTP, POP3, DAV)
            </p>
          </div>
        </div>

        <Button onClick={() => setCreateOpen(true)} className="gap-1.5 shadow-sm">
          <Plus className="h-4 w-4" />
          <span>{t('account.appPasswords.generate', 'Создать пароль')}</span>
        </Button>
      </div>

      {/* Info notice */}
      <div className="border-mg-border-subtle bg-mg-surface-subtle/40 text-mg-text-muted flex items-start gap-3 rounded-xl border p-4 text-xs leading-relaxed">
        <Info className="text-mg-primary mt-0.5 h-4 w-4 shrink-0" />
        <div>
          Пароли приложений позволяют безопасно подключать почтовые программы (Thunderbird, Apple
          Mail, Outlook, K-9 Mail) без использования вашего основного пароля. Даже при включенной
          двухфакторной аутентификации используйте здесь сгенерированный пароль.
        </div>
      </div>

      {/* Table Card */}
      <Card className="overflow-hidden p-0 shadow-sm">
        <Table
          columns={columns}
          rows={passwords || []}
          rowKey={(p) => p.id}
          isLoading={isLoading}
          emptyMessage={
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Key className="text-mg-text-muted mb-2 h-8 w-8" />
              <p className="text-mg-text text-sm font-medium">
                {t('account.appPasswords.empty', 'У вас нет активных паролей приложений')}
              </p>
              <p className="text-mg-text-muted mt-1 mb-4 max-w-xs text-xs">
                Сгенерируйте пароль для входа в почтовый клиент на телефоне или компьютере.
              </p>
              <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                <span>Создать пароль</span>
              </Button>
            </div>
          }
        />
      </Card>

      {/* Create Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('account.appPasswords.modalTitle', 'Создание пароля приложения')}
      >
        <div className="space-y-4 pt-2">
          <Input
            label={t('account.appPasswords.labelField', 'Имя приложения или устройства')}
            placeholder="iPhone Mail, Thunderbird на ноутбуке..."
            value={passwordLabel}
            onChange={(e) => setPasswordLabel(e.target.value)}
            required
            autoFocus
          />

          <div className="border-mg-border-subtle flex justify-end gap-2 border-t pt-3">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!passwordLabel.trim()}
              isLoading={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {t('common.create', 'Сгенерировать')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Result Modal */}
      <Modal
        open={Boolean(createdResult)}
        onClose={() => setCreatedResult(null)}
        title={t('account.appPasswords.generatedTitle', 'Пароль приложения сгенерирован')}
      >
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {t(
                'account.appPasswords.warningOnce',
                'Скопируйте этот пароль сейчас. Он больше никогда не будет показан.',
              )}
            </span>
          </div>

          <div className="bg-mg-surface-subtle border-mg-border flex items-center justify-between rounded-xl border p-3.5">
            <span className="text-mg-primary font-mono text-base font-bold tracking-wider select-all">
              {createdResult?.password}
            </span>
            <Button size="xs" variant="secondary" onClick={handleCopy} className="gap-1.5">
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
            </Button>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={() => setCreatedResult(null)}>{t('common.close', 'Готово')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
