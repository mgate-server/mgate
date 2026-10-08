import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Mail,
  Plus,
  Search,
  KeyRound,
  ShieldAlert,
  Trash2,
  HardDrive,
  Filter,
  ChevronLeft,
  ChevronRight,
  Upload,
} from 'lucide-react';
import { Avatar, Button, Card, Input, Modal, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import { apiClient, fetchApi } from '../../lib/apiClient';
import { BulkImportModal } from './mailboxes/BulkImportModal';

interface MailboxSummary {
  id: string;
  address: string;
  domain_id: string;
  status: string;
  quota_bytes: number | null;
  display_name?: string | null;
}

interface DomainSummary {
  id: string;
  name: string;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '10 GB';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(gb % 1 === 0 ? 0 : 1)} GB`;
}

export function MailboxesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Modals state
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [editQuotaOpen, setEditQuotaOpen] = useState(false);
  const [selectedMailbox, setSelectedMailbox] = useState<MailboxSummary | null>(null);

  // Form states
  const [localPart, setLocalPart] = useState('');
  const [domainId, setDomainId] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [quotaGb, setQuotaGb] = useState('10');
  const [newPassword, setNewPassword] = useState('');
  const [editQuotaValue, setEditQuotaValue] = useState('10');
  const [formError, setFormError] = useState<string | null>(null);
  const [filterDomain, setFilterDomain] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data: domainsData } = useQuery({
    queryKey: ['admin', 'domains'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/admin/domains');
      if (error) throw error;
      return data;
    },
  });

  const domains: DomainSummary[] = domainsData?.items ?? [];

  const { data: mailboxesData, isLoading } = useQuery({
    queryKey: ['admin', 'mailboxes', filterDomain],
    queryFn: async () => {
      const url = filterDomain
        ? `/api/v1/admin/mailboxes?domain_id=${filterDomain}`
        : '/api/v1/admin/mailboxes';
      const res = await fetchApi(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load mailboxes');
      return res.json();
    },
  });

  const rawMailboxes: MailboxSummary[] = mailboxesData?.items ?? [];
  const filteredMailboxes: MailboxSummary[] = rawMailboxes.filter((mb: MailboxSummary) => {
    if (statusFilter !== 'all' && mb.status !== statusFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      mb.address.toLowerCase().includes(q) ||
      (mb.display_name && mb.display_name.toLowerCase().includes(q))
    );
  });

  const totalPages = Math.max(1, Math.ceil(filteredMailboxes.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedMailboxes = filteredMailboxes.slice(startIndex, startIndex + pageSize);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi('/api/v1/admin/mailboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain_id: domainId,
          local_part: localPart,
          password,
          display_name: displayName || undefined,
          quota_bytes: parseInt(quotaGb, 10) * 1024 * 1024 * 1024,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Failed to create mailbox');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      setCreateOpen(false);
      setLocalPart('');
      setPassword('');
      setDisplayName('');
      setFormError(null);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const resetPwMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMailbox) return;
      const res = await fetchApi(`/api/v1/admin/mailboxes/${selectedMailbox.id}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Failed to reset password');
      }
      return res.json();
    },
    onSuccess: () => {
      setResetPwOpen(false);
      setNewPassword('');
      setSelectedMailbox(null);
      setFormError(null);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const quotaMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMailbox) return;
      const res = await fetchApi(`/api/v1/admin/mailboxes/${selectedMailbox.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          quota_bytes: parseInt(editQuotaValue, 10) * 1024 * 1024 * 1024,
        }),
      });
      if (!res.ok) throw new Error('Failed to update quota');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });
      setEditQuotaOpen(false);
      setSelectedMailbox(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mbId: string) => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mbId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete mailbox');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });

  const columns: TableColumn<MailboxSummary>[] = [
    {
      key: 'address',
      header: t('admin.mailboxes.address', 'Почтовый ящик'),
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.display_name || row.address} email={row.address} size="sm" />
          <div className="flex min-w-0 flex-col">
            <Link
              to={`/admin/mailboxes/${row.id}`}
              className="text-mg-text hover:text-mg-primary truncate text-sm font-semibold transition-colors"
            >
              {row.address}
            </Link>
            {row.display_name && (
              <span className="text-mg-text-muted truncate text-xs">{row.display_name}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'quota',
      header: t('admin.mailboxes.quota', 'Квота хранилища'),
      render: (row) => (
        <button
          type="button"
          onClick={() => {
            setSelectedMailbox(row);
            setEditQuotaValue(
              String(Math.round((row.quota_bytes ?? 10737418240) / (1024 * 1024 * 1024))),
            );
            setEditQuotaOpen(true);
          }}
          className="bg-mg-surface-subtle border-mg-border-subtle hover:border-mg-primary/50 text-mg-text inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
          title="Изменить квоту"
        >
          <HardDrive className="text-mg-text-muted h-3.5 w-3.5" />
          <span>{formatBytes(row.quota_bytes)}</span>
        </button>
      ),
    },
    {
      key: 'status',
      header: t('common.status', 'Статус'),
      render: (row) => {
        const isActive = row.status === 'active';
        return (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              isActive
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-rose-500'}`}
            />
            {row.status}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setSelectedMailbox(row);
              setNewPassword('');
              setFormError(null);
              setResetPwOpen(true);
            }}
            title={t('admin.mailboxes.resetPassword', 'Сменить пароль')}
          >
            <KeyRound className="text-mg-text-muted hover:text-mg-text h-3.5 w-3.5" />
          </Button>

          {/* Forced 2FA is not enforced at login yet: shown disabled, never as a working control. */}
          <Button
            size="xs"
            variant="ghost"
            disabled
            title={t('admin.mailboxes.force2faDev', 'Принудительная 2FA — в разработке')}
            aria-label={t('admin.mailboxes.force2faDev', 'Принудительная 2FA — в разработке')}
          >
            <ShieldAlert className="text-mg-text-muted h-3.5 w-3.5 opacity-50" />
          </Button>

          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              if (confirm(t('admin.mailboxes.confirmDelete', `Удалить ящик ${row.address}?`))) {
                deleteMutation.mutate(row.id);
              }
            }}
            className="text-mg-danger hover:bg-red-500/10"
            title={t('common.delete', 'Удалить')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="border-mg-border-subtle flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
            <Mail className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-mg-text text-xl font-semibold tracking-tight">
              {t('nav.admin.mailboxes', 'Почтовые ящики')}
            </h1>
            <p className="text-mg-text-muted text-xs">
              Управление учетными записями пользователей, квотами и безопасностью
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBulkImportOpen(true)} className="gap-1.5">
            <Upload className="h-4 w-4" />
            <span>Импорт из CSV</span>
          </Button>
          <Button
            onClick={() => {
              if (domains.length > 0 && !domainId && domains[0]) {
                setDomainId(domains[0].id);
              }
              setFormError(null);
              setCreateOpen(true);
            }}
            className="gap-1.5 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>{t('admin.mailboxes.create', 'Создать ящик')}</span>
          </Button>
        </div>
      </div>

      {/* Main Table Card */}
      <Card className="overflow-hidden p-0 shadow-sm">
        {/* Search & Domain Filter Bar */}
        <div className="border-mg-border-subtle bg-mg-surface-subtle/30 flex flex-col justify-between gap-3 border-b p-4 sm:flex-row sm:items-center">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="text-mg-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Поиск по адресу или имени..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="bg-mg-surface border-mg-border text-mg-text placeholder:text-mg-text-muted focus:border-mg-primary focus:ring-mg-primary w-full rounded-lg border py-1.5 pr-3 pl-9 text-xs focus:ring-1 focus:outline-none"
              />
            </div>

            {domains.length > 1 && (
              <div className="flex items-center gap-1.5">
                <Filter className="text-mg-text-muted h-3.5 w-3.5" />
                <select
                  aria-label="Фильтр по домену"
                  className="border-mg-border bg-mg-surface text-mg-text focus:border-mg-primary rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none"
                  value={filterDomain}
                  onChange={(e) => {
                    setFilterDomain(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('common.all', 'Все домены')}</option>
                  {domains.map((d) => (
                    <option key={d.id} value={d.id}>
                      @{d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <select
              aria-label="Фильтр по статусу ящиков"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as 'all' | 'active' | 'disabled');
                setPage(1);
              }}
              className="border-mg-border bg-mg-surface text-mg-text focus:border-mg-primary rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none"
            >
              <option value="all">Все статусы</option>
              <option value="active">Активные</option>
              <option value="disabled">Отключенные</option>
            </select>

            <select
              aria-label="Количество элементов на странице"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="border-mg-border bg-mg-surface text-mg-text focus:border-mg-primary rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none"
            >
              <option value={10}>10 / стр</option>
              <option value={25}>25 / стр</option>
              <option value={50}>50 / стр</option>
            </select>
          </div>

          <span className="text-mg-text-muted shrink-0 text-xs">
            Найдено: {filteredMailboxes.length} {filteredMailboxes.length === 1 ? 'ящик' : 'ящиков'}
          </span>
        </div>

        <Table
          columns={columns}
          rows={paginatedMailboxes}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Mail className="text-mg-text-muted mb-2 h-8 w-8" />
              <p className="text-mg-text text-sm font-medium">
                {searchQuery || statusFilter !== 'all'
                  ? 'Ящики не найдены'
                  : t('admin.mailboxes.empty', 'Почтовые ящики не найдены')}
              </p>
              <p className="text-mg-text-muted mt-1 max-w-xs text-xs">
                Создайте первый ящик для пользователей вашего домена.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  if (domains.length > 0 && !domainId && domains[0]) {
                    setDomainId(domains[0].id);
                  }
                  setFormError(null);
                  setCreateOpen(true);
                }}
                className="mt-4 gap-1.5"
              >
                <Plus className="h-4 w-4" />
                <span>Создать ящик</span>
              </Button>
            </div>
          }
        />

        {/* Pagination Footer */}
        {filteredMailboxes.length > 0 && (
          <div className="border-mg-border-subtle bg-mg-surface-subtle/20 text-mg-text-muted flex flex-col items-center justify-between gap-2 border-t p-3 text-xs sm:flex-row">
            <span>
              Показано {startIndex + 1}–{Math.min(startIndex + pageSize, filteredMailboxes.length)}{' '}
              из {filteredMailboxes.length}
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="secondary"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="gap-1 px-2"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Назад</span>
              </Button>
              <span className="text-mg-text px-2 font-medium">
                {currentPage} / {totalPages}
              </span>
              <Button
                size="xs"
                variant="secondary"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="gap-1 px-2"
              >
                <span>Вперед</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Create Mailbox Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('admin.mailboxes.createTitle', 'Создать почтовый ящик')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('common.cancel', 'Отмена')}
            </Button>
            <Button
              onClick={() => {
                if (!localPart || !domainId || !password) {
                  setFormError('Заполните все обязательные поля');
                  return;
                }
                createMutation.mutate();
              }}
              isLoading={createMutation.isPending}
            >
              {t('common.create', 'Создать')}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('admin.mailboxes.localPart', 'Имя ящика')}
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value)}
              placeholder="alex"
              required
              autoFocus
            />
            <div>
              <label className="text-mg-text mb-1.5 block text-xs font-medium">
                {t('admin.domains.domain', 'Домен')}
              </label>
              <select
                className="border-mg-border bg-mg-surface text-mg-text focus:border-mg-primary w-full rounded-lg border p-2 text-xs focus:outline-none"
                value={domainId}
                onChange={(e) => setDomainId(e.target.value)}
              >
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    @{d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Input
            label={t('admin.mailboxes.displayName', 'Отображаемое имя')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Alex Smith"
          />

          <Input
            label={t('auth.login.password', 'Пароль')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            required
          />

          <Input
            label={t('admin.mailboxes.quotaGb', 'Квота хранилища (ГБ)')}
            type="number"
            value={quotaGb}
            onChange={(e) => setQuotaGb(e.target.value)}
          />

          {formError && (
            <p className="text-mg-danger rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 text-xs">
              {formError}
            </p>
          )}
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        open={resetPwOpen}
        onClose={() => setResetPwOpen(false)}
        title={t('admin.mailboxes.resetPasswordTitle', 'Сброс пароля')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetPwOpen(false)}>
              {t('common.cancel', 'Отмена')}
            </Button>
            <Button
              onClick={() => {
                if (!newPassword) {
                  setFormError('Введите новый пароль');
                  return;
                }
                resetPwMutation.mutate();
              }}
              isLoading={resetPwMutation.isPending}
            >
              {t('common.save', 'Сменить пароль')}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5 pt-2">
          <div className="bg-mg-surface-subtle border-mg-border-subtle rounded-lg border p-3 text-xs">
            <span className="text-mg-text-muted">
              {t('admin.mailboxes.resetTarget', 'Смена пароля для')}:{' '}
            </span>
            <strong className="text-mg-text font-semibold">{selectedMailbox?.address}</strong>
          </div>
          <Input
            label={t('admin.mailboxes.newPassword', 'Новый пароль')}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••••••"
            error={formError ?? undefined}
            autoFocus
          />
        </div>
      </Modal>

      {/* Edit Quota Modal */}
      <Modal
        open={editQuotaOpen}
        onClose={() => setEditQuotaOpen(false)}
        title={t('admin.mailboxes.editQuotaTitle', 'Изменить квоту')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditQuotaOpen(false)}>
              {t('common.cancel', 'Отмена')}
            </Button>
            <Button onClick={() => quotaMutation.mutate()} isLoading={quotaMutation.isPending}>
              {t('common.save', 'Сохранить')}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5 pt-2">
          <div className="bg-mg-surface-subtle border-mg-border-subtle rounded-lg border p-3 text-xs">
            <span className="text-mg-text-muted">Ящик: </span>
            <strong className="text-mg-text font-semibold">{selectedMailbox?.address}</strong>
          </div>
          <Input
            label={t('admin.mailboxes.quotaGb', 'Квота (ГБ)')}
            type="number"
            value={editQuotaValue}
            onChange={(e) => setEditQuotaValue(e.target.value)}
            autoFocus
          />
        </div>
      </Modal>

      <BulkImportModal
        isOpen={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['admin-mailboxes'] });
        }}
        domains={domains}
        defaultDomainId={filterDomain || undefined}
      />
    </div>
  );
}
