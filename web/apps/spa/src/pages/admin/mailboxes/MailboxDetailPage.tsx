import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Mail,
  Copy,
  Check,
  KeyRound,
  ShieldAlert,
  Trash2,
  HardDrive,
  User,
  Forward,
  Calendar,
  Filter,
  LogOut,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import { Avatar, Badge, Button, Card, Input, Modal, Tabs, Table } from '@mgate/ui';
import type { TabItem, TableColumn } from '@mgate/ui';
import { useBreadcrumbs } from '../../../components/layout/Breadcrumbs';
import { fetchApi } from '../../../lib/apiClient';

type TabValue = 'profile' | 'aliases' | 'forwarding' | 'vacation' | 'sieve' | 'security';

interface MailboxDetail {
  id: string;
  address: string;
  domain_id: string;
  status: string;
  quota_bytes: number | null;
  display_name?: string | null;
  created_at: string;
}

interface AliasItem {
  id: string;
  address: string;
  target_address: string;
}

interface ForwardingResponse {
  destination: string;
  keep_copy: boolean;
}

interface AutoreplyRow {
  mailbox_id: string;
  enabled: boolean;
  subject?: string | null;
  body?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

interface SieveRuleRow {
  id: string;
  mailbox_id: string;
  name: string;
  script: string;
  enabled: boolean;
}

export function MailboxDetailPage() {
  const { t } = useTranslation();
  const { mailboxId } = useParams<{ mailboxId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabValue>('profile');
  const [copied, setCopied] = useState(false);

  // Modals state
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { data: mailbox, isLoading } = useQuery<MailboxDetail>({
    queryKey: ['admin', 'mailboxes', mailboxId],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load mailbox');
      return res.json();
    },
    enabled: Boolean(mailboxId),
  });

  const resetPwMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Не удалось сбросить пароль');
      }
    },
    onSuccess: () => {
      setResetPwOpen(false);
      setNewPassword('');
      setPwError(null);
      setSuccessMsg('Пароль успешно изменен');
      setTimeout(() => setSuccessMsg(null), 4000);
    },
    onError: (err: Error) => setPwError(err.message),
  });

  const forceLogoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/sessions`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Не удалось завершить сессии');
    },
    onSuccess: () => {
      setSuccessMsg('Все активные сессии пользователя завершены');
      setTimeout(() => setSuccessMsg(null), 4000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Не удалось удалить ящик');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });
      navigate('/admin/mailboxes');
    },
  });

  function handleCopyAddress() {
    if (!mailbox) return;
    navigator.clipboard.writeText(mailbox.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const tabLabels: Record<TabValue, string> = {
    profile: 'Профиль и квота',
    aliases: 'Алиасы (псевдонимы)',
    forwarding: 'Пересылка почты',
    vacation: 'Автоответчик (Vacation)',
    sieve: 'Фильтры Sieve',
    security: 'Безопасность',
  };

  const mailboxCrumbs = useMemo(
    () => [
      { label: 'Главная', to: '/' },
      { label: 'Администрирование', to: '/admin' },
      { label: 'Почтовые ящики', to: '/admin/mailboxes' },
      {
        label: mailbox?.address || mailboxId || 'Почтовый ящик',
        to: `/admin/mailboxes/${mailboxId}`,
      },
      { label: tabLabels[tab] },
    ],
    [mailbox?.address, mailboxId, tab],
  );

  useBreadcrumbs(mailboxCrumbs);

  const tabs: TabItem[] = [
    { value: 'profile', label: tabLabels.profile },
    { value: 'aliases', label: tabLabels.aliases },
    { value: 'forwarding', label: tabLabels.forwarding },
    { value: 'vacation', label: tabLabels.vacation },
    { value: 'sieve', label: tabLabels.sieve },
    { value: 'security', label: tabLabels.security },
  ];

  if (isLoading) {
    return <div className="text-mg-text-muted p-8 text-center">Загрузка ящика...</div>;
  }

  if (!mailbox) {
    return <div className="text-mg-danger p-8 text-center">Почтовый ящик не найден</div>;
  }

  const isActive = mailbox.status === 'active';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="border-mg-border-subtle flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Avatar
            name={mailbox.display_name || mailbox.address}
            email={mailbox.address}
            size="lg"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-mg-text font-mono text-xl font-bold tracking-tight">
                {mailbox.address}
              </h1>
              <button
                type="button"
                onClick={handleCopyAddress}
                className="hover:bg-mg-surface-subtle text-mg-text-muted hover:text-mg-primary rounded p-1 transition-colors"
                title="Копировать адрес"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
              <Badge tone={isActive ? 'success' : 'danger'}>{mailbox.status}</Badge>
            </div>
            {mailbox.display_name && (
              <p className="text-mg-text-muted mt-0.5 text-xs">{mailbox.display_name}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/admin/mailboxes"
            className="text-mg-text-muted hover:text-mg-text border-mg-border rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            ← К списку ящиков
          </Link>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setResetPwOpen(true)}
            className="gap-1.5"
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>Сбросить пароль</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (confirm('Завершить все активные сессии этого ящика?')) {
                forceLogoutMutation.mutate();
              }
            }}
            isLoading={forceLogoutMutation.isPending}
            className="gap-1.5"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Сбросить сессии</span>
          </Button>
        </div>
      </div>

      {successMsg && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          ✓ {successMsg}
        </div>
      )}

      {/* Main Content Tabs */}
      <Card>
        <Tabs items={tabs} value={tab} onChange={(v) => setTab(v as TabValue)} className="mb-6" />

        {tab === 'profile' && <ProfileTab mailbox={mailbox} />}
        {tab === 'aliases' && <AliasesTab mailbox={mailbox} />}
        {tab === 'forwarding' && <ForwardingTab mailboxId={mailbox.id} />}
        {tab === 'vacation' && <VacationTab mailboxId={mailbox.id} />}
        {tab === 'sieve' && <SieveTab mailboxId={mailbox.id} />}
        {tab === 'security' && (
          <MailboxSecurityTab
            mailbox={mailbox}
            deleteMutation={deleteMutation}
            onResetPassword={() => setResetPwOpen(true)}
            onRevokeSessions={() => {
              if (confirm('Завершить все активные сессии этого ящика?')) {
                forceLogoutMutation.mutate();
              }
            }}
            isRevokingSessions={forceLogoutMutation.isPending}
          />
        )}
      </Card>

      {/* Reset Password Modal */}
      <Modal
        open={resetPwOpen}
        onClose={() => setResetPwOpen(false)}
        title="Смена пароля почтового ящика"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetPwOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                if (!newPassword || newPassword.length < 8) {
                  setPwError('Пароль должен содержать минимум 8 символов');
                  return;
                }
                resetPwMutation.mutate();
              }}
              isLoading={resetPwMutation.isPending}
            >
              Сохранить пароль
            </Button>
          </>
        }
      >
        <div className="space-y-4 pt-2">
          <p className="text-mg-text-muted text-xs">
            Введите новый пароль для{' '}
            <span className="text-mg-text font-mono font-semibold">{mailbox.address}</span>.
            Пользователю потребуется ввести его при следующем входе.
          </p>
          <Input
            label="Новый пароль"
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setPwError(null);
            }}
            placeholder="••••••••••••"
            error={pwError ?? undefined}
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
}

function ProfileTab({ mailbox }: { mailbox: MailboxDetail }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(mailbox.display_name || '');
  const [quotaGb, setQuotaGb] = useState(
    String(Math.round((mailbox.quota_bytes ?? 10737418240) / (1024 * 1024 * 1024))),
  );
  const [status, setStatus] = useState(mailbox.status);
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailbox.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          display_name: displayName,
          quota_bytes: parseInt(quotaGb, 10) * 1024 * 1024 * 1024,
          status,
        }),
      });
      if (!res.ok) throw new Error('Failed to update mailbox');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes', mailbox.id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <div className="max-w-lg space-y-4">
      <Input
        label="Отображаемое имя (Display Name)"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Иван Иванов"
      />

      <Input
        label="Дисковая квота (ГБ)"
        type="number"
        value={quotaGb}
        onChange={(e) => setQuotaGb(e.target.value)}
        placeholder="10"
      />

      <div>
        <label className="text-mg-text-muted mb-1 block text-xs font-semibold">
          Статус аккаунта
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border-mg-border bg-mg-surface text-mg-text focus:ring-mg-primary w-full rounded-lg border p-2 text-sm focus:ring-1 focus:outline-none"
        >
          <option value="active">Активен (Active)</option>
          <option value="suspended">Приостановлен (Suspended)</option>
          <option value="disabled">Отключен (Disabled)</option>
        </select>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={() => updateMutation.mutate()} isLoading={updateMutation.isPending}>
          Сохранить настройки
        </Button>
        {saved && (
          <span className="text-xs font-medium text-emerald-600">✓ Настройки сохранены</span>
        )}
      </div>
    </div>
  );
}

function AliasesTab({ mailbox }: { mailbox: MailboxDetail }) {
  const queryClient = useQueryClient();
  const [newAliasLocal, setNewAliasLocal] = useState('');
  const domainPart = mailbox.address.split('@')[1] || '';

  const { data: aliases = [], isLoading } = useQuery<AliasItem[]>({
    queryKey: ['admin', 'aliases', mailbox.domain_id],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/aliases?domain_id=${mailbox.domain_id}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load aliases');
      return res.json();
    },
  });

  const mailboxAliases = aliases.filter((a) => a.target_address === mailbox.address);

  const addAliasMutation = useMutation({
    mutationFn: async () => {
      const aliasFull = `${newAliasLocal.trim().toLowerCase()}@${domainPart}`;
      const res = await fetchApi('/api/v1/admin/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain_id: mailbox.domain_id,
          source: aliasFull,
          destination: mailbox.address,
        }),
      });
      if (!res.ok) throw new Error('Failed to create alias');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'aliases'] });
      setNewAliasLocal('');
    },
  });

  const deleteAliasMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchApi(`/api/v1/admin/aliases/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete alias');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'aliases'] });
    },
  });

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-mg-text text-sm font-semibold">Псевдонимы ящика (Aliases)</h3>
        <p className="text-mg-text-muted text-xs">
          Письма, отправленные на эти адреса, будут доставлены в данный почтовый ящик.
        </p>
      </div>

      {/* Add Alias */}
      <div className="flex items-center gap-2">
        <div className="border-mg-border bg-mg-surface focus-within:ring-mg-primary flex flex-1 items-center rounded-lg border px-3 py-1.5 text-sm focus-within:ring-1">
          <input
            type="text"
            placeholder="info, sales, support"
            value={newAliasLocal}
            onChange={(e) => setNewAliasLocal(e.target.value)}
            className="text-mg-text flex-1 bg-transparent text-xs focus:outline-none"
          />
          <span className="text-mg-text-muted font-mono text-xs">@{domainPart}</span>
        </div>
        <Button
          size="sm"
          onClick={() => {
            if (newAliasLocal.trim()) addAliasMutation.mutate();
          }}
          disabled={!newAliasLocal.trim() || addAliasMutation.isPending}
        >
          Добавить алиас
        </Button>
      </div>

      <div className="border-mg-border divide-mg-border divide-y overflow-hidden rounded-lg border">
        {isLoading ? (
          <div className="text-mg-text-muted p-4 text-center text-xs">Загрузка алиасов...</div>
        ) : mailboxAliases.length === 0 ? (
          <div className="text-mg-text-muted p-4 text-center text-xs">Алиасы пока не добавлены</div>
        ) : (
          mailboxAliases.map((a) => (
            <div key={a.id} className="bg-mg-surface flex items-center justify-between p-3 text-xs">
              <span className="text-mg-text font-mono font-medium">{a.address}</span>
              <button
                type="button"
                onClick={() => deleteAliasMutation.mutate(a.id)}
                className="text-xs text-rose-600 hover:text-rose-800"
              >
                Удалить
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ForwardingTab({ mailboxId }: { mailboxId: string }) {
  const queryClient = useQueryClient();
  const [destination, setDestination] = useState('');
  const [keepCopy, setKeepCopy] = useState(true);
  const [saved, setSaved] = useState(false);

  const { data: forwarding, isLoading } = useQuery<ForwardingResponse | null>({
    queryKey: ['admin', 'mailboxes', mailboxId, 'forwarding'],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/forwarding`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.destination) {
        setDestination(data.destination);
        setKeepCopy(data.keep_copy);
      }
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/forwarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ destination, keep_copy: keepCopy }),
      });
      if (!res.ok) throw new Error('Failed to set forwarding');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes', mailboxId, 'forwarding'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/forwarding`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to remove forwarding');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes', mailboxId, 'forwarding'] });
      setDestination('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h3 className="text-mg-text text-sm font-semibold">Пересылка входящей почты</h3>
        <p className="text-mg-text-muted text-xs">
          Автоматическая отправка копий входящих сообщений на внешний или внутренний адрес.
        </p>
      </div>

      <Input
        label="Адрес пересылки"
        placeholder="target@example.org"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
      />

      <div className="flex items-center gap-2 pt-1">
        <input
          type="checkbox"
          id="keepCopyCheck"
          checked={keepCopy}
          onChange={(e) => setKeepCopy(e.target.checked)}
          className="border-mg-border text-mg-primary focus:ring-mg-primary rounded"
        />
        <label htmlFor="keepCopyCheck" className="text-mg-text cursor-pointer text-xs font-medium">
          Сохранять копию письма в этом ящике
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button
          onClick={() => saveMutation.mutate()}
          isLoading={saveMutation.isPending}
          disabled={!destination.trim()}
        >
          Сохранить пересылку
        </Button>
        {forwarding?.destination && (
          <Button
            variant="secondary"
            onClick={() => deleteMutation.mutate()}
            isLoading={deleteMutation.isPending}
          >
            Отключить пересылку
          </Button>
        )}
        {saved && (
          <span className="text-xs font-medium text-emerald-600">✓ Пересылка обновлена</span>
        )}
      </div>
    </div>
  );
}

function VacationTab({ mailboxId }: { mailboxId: string }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: autoreply, isLoading } = useQuery<AutoreplyRow | null>({
    queryKey: ['admin', 'mailboxes', mailboxId, 'vacation'],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/vacation`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data) {
        setEnabled(data.enabled);
        setSubject(data.subject || '');
        setBody(data.body || '');
      }
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/vacation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          enabled,
          subject: subject || undefined,
          body: body || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to set vacation');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes', mailboxId, 'vacation'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h3 className="text-mg-text text-sm font-semibold">
          Автоответчик (Vacation / Out-of-Office)
        </h3>
        <p className="text-mg-text-muted text-xs">
          Автоматический ответ на входящие сообщения в период отсутствия сотрудника.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="vacationCheck"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="border-mg-border text-mg-primary focus:ring-mg-primary rounded"
        />
        <label
          htmlFor="vacationCheck"
          className="text-mg-text cursor-pointer text-xs font-semibold"
        >
          Включить автоответчик
        </label>
      </div>

      <Input
        label="Тема автоответа"
        placeholder="Вне офиса / Out of office"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={!enabled}
      />

      <div>
        <label className="text-mg-text-muted mb-1 block text-xs font-semibold">
          Текст сообщения
        </label>
        <textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Спасибо за ваше письмо. В настоящее время я нахожусь в отпуске до..."
          disabled={!enabled}
          className="border-mg-border bg-mg-surface text-mg-text focus:ring-mg-primary w-full rounded-lg border p-2 text-xs focus:ring-1 focus:outline-none disabled:opacity-50"
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={() => saveMutation.mutate()} isLoading={saveMutation.isPending}>
          Сохранить автоответчик
        </Button>
        {saved && (
          <span className="text-xs font-medium text-emerald-600">✓ Автоответчик сохранен</span>
        )}
      </div>
    </div>
  );
}

function SieveTab({ mailboxId }: { mailboxId: string }) {
  const queryClient = useQueryClient();
  const [ruleName, setRuleName] = useState('');
  const [script, setScript] = useState('');

  const { data: rules = [], isLoading } = useQuery<SieveRuleRow[]>({
    queryKey: ['admin', 'mailboxes', mailboxId, 'sieve'],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/sieve`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load sieve rules');
      return res.json();
    },
  });

  const addRuleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/sieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: ruleName,
          script,
          enabled: true,
        }),
      });
      if (!res.ok) throw new Error('Failed to add sieve rule');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes', mailboxId, 'sieve'] });
      setRuleName('');
      setScript('');
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/sieve/${ruleId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete sieve rule');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes', mailboxId, 'sieve'] });
    },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="text-mg-text text-sm font-semibold">Правила фильтрации Sieve</h3>
        <p className="text-mg-text-muted text-xs">
          Серверные правила обработки входящих писем (перемещение в папки, отклонение, маркировка).
        </p>
      </div>

      {/* Add rule */}
      <div className="border-mg-border bg-mg-surface-subtle/30 space-y-3 rounded-xl border p-4">
        <h4 className="text-mg-text text-xs font-semibold">Создать правило</h4>
        <Input
          label="Название правила"
          placeholder="Move invoices to Invoices folder"
          value={ruleName}
          onChange={(e) => setRuleName(e.target.value)}
        />
        <div>
          <label className="text-mg-text-muted mb-1 block text-xs font-semibold">
            Sieve Script
          </label>
          <textarea
            rows={3}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder='if header :contains "Subject" "Invoice" { fileinto "INBOX.Invoices"; }'
            className="border-mg-border bg-mg-surface text-mg-text focus:ring-mg-primary w-full rounded-lg border p-2 font-mono text-xs focus:ring-1 focus:outline-none"
          />
        </div>
        <Button
          size="sm"
          onClick={() => {
            if (ruleName && script) addRuleMutation.mutate();
          }}
          disabled={!ruleName || !script || addRuleMutation.isPending}
        >
          Добавить правило
        </Button>
      </div>

      {/* Rules list */}
      <div className="border-mg-border divide-mg-border divide-y overflow-hidden rounded-lg border">
        {isLoading ? (
          <div className="text-mg-text-muted p-4 text-center text-xs">Загрузка правил...</div>
        ) : rules.length === 0 ? (
          <div className="text-mg-text-muted p-4 text-center text-xs">
            Правила Sieve не настроены
          </div>
        ) : (
          rules.map((r) => (
            <div key={r.id} className="bg-mg-surface flex items-center justify-between p-3 text-xs">
              <div>
                <div className="text-mg-text font-semibold">{r.name}</div>
                <div className="text-mg-text-muted mt-0.5 font-mono text-[11px]">{r.script}</div>
              </div>
              <button
                type="button"
                onClick={() => deleteRuleMutation.mutate(r.id)}
                className="ml-4 text-xs text-rose-600 hover:text-rose-800"
              >
                Удалить
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function MailboxSecurityTab({
  mailbox,
  deleteMutation,
  onResetPassword,
  onRevokeSessions,
  isRevokingSessions,
}: {
  mailbox: MailboxDetail;
  deleteMutation: { mutate: () => void; isPending: boolean };
  onResetPassword: () => void;
  onRevokeSessions: () => void;
  isRevokingSessions: boolean;
}) {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h3 className="text-mg-text text-sm font-semibold">Параметры безопасности ящика</h3>
        <p className="text-mg-text-muted mt-0.5 text-xs">
          Управление учетными данными, доступом к сессиям и удалением почтового ящика.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Reset Password card */}
        <div className="border-mg-border-subtle bg-mg-surface-subtle/30 space-y-3 rounded-xl border p-4">
          <div className="text-mg-text flex items-center gap-2 text-xs font-semibold">
            <KeyRound className="text-mg-primary h-4 w-4" />
            <span>Пароль учетной записи</span>
          </div>
          <p className="text-mg-text-muted text-[11px]">
            Вы можете принудительно установить новый пароль для доступа к почтовому ящику через
            веб-интерфейс и почтовые клиенты (IMAP/SMTP).
          </p>
          <Button size="xs" variant="secondary" onClick={onResetPassword} className="gap-1.5">
            <KeyRound className="h-3.5 w-3.5" />
            <span>Сменить пароль</span>
          </Button>
        </div>

        {/* Revoke Sessions card */}
        <div className="border-mg-border-subtle bg-mg-surface-subtle/30 space-y-3 rounded-xl border p-4">
          <div className="text-mg-text flex items-center gap-2 text-xs font-semibold">
            <LogOut className="text-mg-primary h-4 w-4" />
            <span>Активные сессии</span>
          </div>
          <p className="text-mg-text-muted text-[11px]">
            Мгновенно завершить все открытые сессии входа и отозвать авторизационные токены данного
            ящика на всех устройствах.
          </p>
          <Button
            size="xs"
            variant="secondary"
            onClick={onRevokeSessions}
            isLoading={isRevokingSessions}
            className="gap-1.5"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Сбросить все сессии</span>
          </Button>
        </div>
      </div>

      {/* Danger Zone: Delete Mailbox (STRICTLY inside security tab) */}
      <div className="border-mg-border-subtle border-t pt-4">
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-400">
                <AlertTriangle className="h-4 w-4" />
                Опасная зона: Удаление почтового ящика
              </h4>
              <p className="text-mg-text-muted mt-1 max-w-xl text-xs">
                Удаление ящика приведет к безвозвратному удалению всех хранящихся писем, папок,
                вложений, правил фильтрации и связанных алиасов без возможности восстановления.
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (confirm(`Удалить ящик ${mailbox.address} и ВСЕ письма навсегда?`)) {
                  deleteMutation.mutate();
                }
              }}
              isLoading={deleteMutation.isPending}
              className="shrink-0 gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Удалить ящик</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
