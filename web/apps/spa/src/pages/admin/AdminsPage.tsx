import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Modal, PageHeader, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import { apiClient, fetchApi } from '../../lib/apiClient';

interface AdminSummary {
  id: string;
  email: string;
  is_super_admin: boolean;
  status: string;
  granted_domains: string[];
}

interface DomainSummary {
  id: string;
  name: string;
}

export function AdminsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [selectedDomainIds, setSelectedDomainIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: domainsData } = useQuery({
    queryKey: ['admin', 'domains'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/admin/domains');
      if (error) throw error;
      return data;
    },
  });

  const domains: DomainSummary[] = domainsData?.items ?? [];

  const { data: admins = [], isLoading } = useQuery<AdminSummary[]>({
    queryKey: ['admin', 'admins'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/admins', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load admins');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!email || !password) {
        throw new Error('Введите email и пароль');
      }
      if (!isSuperAdmin && selectedDomainIds.length === 0) {
        throw new Error('Для DomainAdmin выберите хотя бы один домен');
      }

      const res = await fetchApi('/api/v1/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          is_super_admin: isSuperAdmin,
          domain_ids: isSuperAdmin ? [] : selectedDomainIds,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Failed to create admin');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      setCreateOpen(false);
      setEmail('');
      setPassword('');
      setIsSuperAdmin(false);
      setSelectedDomainIds([]);
      setFormError(null);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (adminId: string) => {
      const res = await fetchApi(`/api/v1/admin/admins/${adminId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete admin');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
    },
  });

  const columns: TableColumn<AdminSummary>[] = [
    {
      key: 'email',
      header: t('admin.admins.email', 'Email администратора'),
      render: (row) => <span className="text-mg-text font-medium">{row.email}</span>,
    },
    {
      key: 'role',
      header: t('admin.admins.role', 'Роль'),
      render: (row) => (
        <Badge tone={row.is_super_admin ? 'primary' : 'neutral'}>
          {row.is_super_admin ? 'SuperAdmin' : 'DomainAdmin'}
        </Badge>
      ),
    },
    {
      key: 'domains',
      header: t('admin.admins.grantedDomains', 'Доступные домены'),
      render: (row) => {
        if (row.is_super_admin) {
          return (
            <span className="text-mg-text-muted text-xs">{t('common.all', 'Все домены')}</span>
          );
        }
        const names = row.granted_domains.map((id) => domains.find((d) => d.id === id)?.name ?? id);
        return (
          <div className="flex flex-wrap gap-1">
            {names.map((n, i) => (
              <Badge key={i} tone="neutral">
                {n}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('common.status', 'Статус'),
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : 'danger'}>{row.status}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (
                confirm(t('admin.admins.confirmDelete', `Удалить администратора ${row.email}?`))
              ) {
                deleteMutation.mutate(row.id);
              }
            }}
          >
            {t('common.delete', 'Удалить')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.admin.admins')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            {t('admin.admins.create', 'Добавить администратора')}
          </Button>
        }
      />

      <Card>
        <Table
          columns={columns}
          rows={admins}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('admin.admins.empty', 'Список администраторов пуст')}
        />
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('admin.admins.createTitle', 'Создать учетную запись администратора')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('common.cancel', 'Отмена')}
            </Button>
            <Button onClick={() => createMutation.mutate()} isLoading={createMutation.isPending}>
              {t('common.create', 'Создать')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label={t('admin.admins.email', 'Email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
          />

          <Input
            label={t('auth.login.password', 'Пароль')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
          />

          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">
              {t('admin.admins.role', 'Роль')}
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="adminRole"
                  checked={isSuperAdmin}
                  onChange={() => setIsSuperAdmin(true)}
                />
                <span className="text-mg-text">SuperAdmin (Полный доступ)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="adminRole"
                  checked={!isSuperAdmin}
                  onChange={() => setIsSuperAdmin(false)}
                />
                <span className="text-mg-text">DomainAdmin (Доступ к доменам)</span>
              </label>
            </div>
          </div>

          {!isSuperAdmin ? (
            <div>
              <label className="text-mg-text mb-1 block text-xs font-medium">
                {t('admin.admins.selectDomains', 'Назначить домены')}
              </label>
              <div className="border-mg-border max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {domains.map((d) => {
                  const checked = selectedDomainIds.includes(d.id);
                  return (
                    <label key={d.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedDomainIds((prev) => [...prev, d.id]);
                          } else {
                            setSelectedDomainIds((prev) => prev.filter((id) => id !== d.id));
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-mg-text font-mono text-xs">{d.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {formError ? <p className="text-mg-danger text-sm">{formError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
