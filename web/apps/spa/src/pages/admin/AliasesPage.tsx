import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Modal, PageHeader, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import { apiClient, fetchApi } from '../../lib/apiClient';

interface AliasSummary {
  id: string;
  domain_id: string;
  source: string;
  destinations: string[];
  status: string;
}

interface DomainSummary {
  id: string;
  name: string;
}

export function AliasesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [localPart, setLocalPart] = useState('');
  const [domainId, setDomainId] = useState('');
  const [destinationsStr, setDestinationsStr] = useState('');
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

  const { data: aliases = [], isLoading } = useQuery<AliasSummary[]>({
    queryKey: ['admin', 'aliases'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/aliases', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load aliases');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const dests = destinationsStr
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (!localPart || !domainId || dests.length === 0) {
        throw new Error('Укажите имя алиаса, домен и хотя бы один адрес назначения');
      }

      const res = await fetchApi('/api/v1/admin/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain_id: domainId,
          local_part: localPart,
          destinations: dests,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Failed to create alias');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'aliases'] });
      setModalOpen(false);
      setLocalPart('');
      setDestinationsStr('');
      setFormError(null);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (aliasId: string) => {
      const res = await fetchApi(`/api/v1/admin/aliases/${aliasId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete alias');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'aliases'] });
    },
  });

  const columns: TableColumn<AliasSummary>[] = [
    {
      key: 'source',
      header: t('admin.aliases.source', 'Алиас'),
      render: (row) => <span className="text-mg-text font-medium">{row.source}</span>,
    },
    {
      key: 'destinations',
      header: t('admin.aliases.destinations', 'Получатели'),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.destinations.map((d, i) => (
            <span key={i} className="text-mg-text-muted font-mono text-xs">
              {d}
              {i < row.destinations.length - 1 ? ',' : ''}
            </span>
          ))}
        </div>
      ),
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
              if (confirm(t('admin.aliases.confirmDelete', `Удалить алиас ${row.source}?`))) {
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
        title={t('nav.admin.aliases')}
        actions={
          <Button
            onClick={() => {
              if (domains.length > 0 && !domainId && domains[0]) {
                setDomainId(domains[0].id);
              }
              setFormError(null);
              setModalOpen(true);
            }}
          >
            {t('admin.aliases.create', 'Создать алиас')}
          </Button>
        }
      />

      <Card>
        <Table
          columns={columns}
          rows={aliases}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('admin.aliases.empty', 'Алиасы не созданы')}
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('admin.aliases.createTitle', 'Создать почтовый алиас')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              {t('common.cancel', 'Отмена')}
            </Button>
            <Button onClick={() => createMutation.mutate()} isLoading={createMutation.isPending}>
              {t('common.create', 'Создать')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              label={t('admin.aliases.aliasName', 'Имя алиаса')}
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value)}
              placeholder="support"
            />
            <div>
              <label className="text-mg-text mb-1 block text-xs font-medium">
                {t('admin.domains.domain', 'Домен')}
              </label>
              <select
                className="border-mg-border bg-mg-surface text-mg-text w-full rounded-md border p-2 text-sm"
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

          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">
              {t('admin.aliases.recipients', 'Адреса назначения (через запятую или новую строку)')}
            </label>
            <textarea
              className="border-mg-border bg-mg-surface text-mg-text w-full rounded-md border p-2 font-mono text-sm"
              rows={3}
              value={destinationsStr}
              onChange={(e) => setDestinationsStr(e.target.value)}
              placeholder="user1@example.com&#10;user2@example.com"
            />
          </div>

          {formError ? <p className="text-mg-danger text-sm">{formError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
