import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Modal, PageHeader, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import { fetchApi } from '../../lib/apiClient';

interface ForwardingItem {
  id: string;
  mailbox_id: string;
  mailbox_address: string;
  destination: string;
  keep_copy: boolean;
  status: string;
}

interface MailboxSummary {
  id: string;
  address: string;
}

export function ForwardingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedMailboxId, setSelectedMailboxId] = useState('');
  const [destination, setDestination] = useState('');
  const [keepCopy, setKeepCopy] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: forwardings = [], isLoading } = useQuery<ForwardingItem[]>({
    queryKey: ['admin', 'forwardings'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/forwardings', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load forwardings');
      return res.json();
    },
  });

  const { data: mailboxesData } = useQuery({
    queryKey: ['admin', 'mailboxes'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/mailboxes', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load mailboxes');
      return res.json();
    },
  });

  const mailboxes: MailboxSummary[] = mailboxesData?.items ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMailboxId || !destination) {
        throw new Error('Укажите ящик и адрес пересылки');
      }
      const res = await fetchApi(`/api/v1/admin/mailboxes/${selectedMailboxId}/forwarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          destination,
          keep_copy: keepCopy,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Failed to configure forwarding');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'forwardings'] });
      setModalOpen(false);
      setDestination('');
      setFormError(null);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mailboxId: string) => {
      const res = await fetchApi(`/api/v1/admin/mailboxes/${mailboxId}/forwarding`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to remove forwarding');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'forwardings'] });
    },
  });

  const columns: TableColumn<ForwardingItem>[] = [
    {
      key: 'mailbox',
      header: t('admin.forwarding.source', 'Исходный ящик'),
      render: (row) => <span className="text-mg-text font-medium">{row.mailbox_address}</span>,
    },
    {
      key: 'destination',
      header: t('admin.forwarding.destination', 'Пересылать на'),
      render: (row) => <span className="text-mg-text font-mono text-xs">{row.destination}</span>,
    },
    {
      key: 'keep_copy',
      header: t('admin.forwarding.keepCopy', 'Сохранять копию'),
      render: (row) => (
        <Badge tone={row.keep_copy ? 'primary' : 'neutral'}>
          {row.keep_copy ? t('common.yes', 'Да') : t('common.no', 'Нет')}
        </Badge>
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
                confirm(
                  t(
                    'admin.forwarding.confirmDelete',
                    `Удалить пересылку для ${row.mailbox_address}?`,
                  ),
                )
              ) {
                deleteMutation.mutate(row.mailbox_id);
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
        title={t('nav.admin.forwardings')}
        actions={
          <Button
            onClick={() => {
              if (mailboxes.length > 0 && !selectedMailboxId && mailboxes[0]) {
                setSelectedMailboxId(mailboxes[0].id);
              }
              setFormError(null);
              setModalOpen(true);
            }}
          >
            {t('admin.forwarding.create', 'Настроить пересылку')}
          </Button>
        }
      />

      <Card>
        <Table
          columns={columns}
          rows={forwardings}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('admin.forwarding.empty', 'Правила пересылки не настроены')}
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('admin.forwarding.createTitle', 'Настройка пересылки почты')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              {t('common.cancel', 'Отмена')}
            </Button>
            <Button onClick={() => createMutation.mutate()} isLoading={createMutation.isPending}>
              {t('common.save', 'Сохранить')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">
              {t('admin.forwarding.source', 'Исходный ящик')}
            </label>
            <select
              className="border-mg-border bg-mg-surface text-mg-text w-full rounded-md border p-2 text-sm"
              value={selectedMailboxId}
              onChange={(e) => setSelectedMailboxId(e.target.value)}
            >
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.address}
                </option>
              ))}
            </select>
          </div>

          <Input
            label={t('admin.forwarding.destination', 'Адрес пересылки')}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="target@example.org"
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={keepCopy}
              onChange={(e) => setKeepCopy(e.target.checked)}
              className="rounded"
            />
            <span className="text-mg-text">
              {t(
                'admin.forwarding.keepCopyLabel',
                'Оставлять копию входящих писем в исходном ящике',
              )}
            </span>
          </label>

          {formError ? <p className="text-mg-danger text-sm">{formError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
