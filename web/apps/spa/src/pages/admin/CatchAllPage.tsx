import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, PageHeader } from '@mgate/ui';
import { apiClient, fetchApi } from '../../lib/apiClient';

interface DomainSummary {
  id: string;
  name: string;
}

interface MailboxSummary {
  id: string;
  address: string;
}

interface CatchAllResponse {
  mailbox_id: string;
  mailbox_address?: string;
}

export function CatchAllPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [selectedDomainId, setSelectedDomainId] = useState<string>('');
  const [targetMailboxId, setTargetMailboxId] = useState<string>('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const { data: domainsData } = useQuery({
    queryKey: ['admin', 'domains'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/admin/domains');
      if (error) throw error;
      return data;
    },
  });

  const domains: DomainSummary[] = domainsData?.items ?? [];
  const activeDomainId = selectedDomainId || domains[0]?.id || '';

  const { data: catchAll } = useQuery<CatchAllResponse | null>({
    queryKey: ['admin', 'catch-all', activeDomainId],
    queryFn: async () => {
      if (!activeDomainId) return null;
      const res = await fetchApi(`/api/v1/admin/domains/${activeDomainId}/catch-all`, {
        credentials: 'include',
      });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(activeDomainId),
  });

  const { data: mailboxesData } = useQuery({
    queryKey: ['admin', 'mailboxes', activeDomainId],
    queryFn: async () => {
      if (!activeDomainId) return { items: [] };
      const res = await fetchApi(`/api/v1/admin/mailboxes?domain_id=${activeDomainId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load mailboxes');
      return res.json();
    },
    enabled: Boolean(activeDomainId),
  });

  const mailboxes: MailboxSummary[] = mailboxesData?.items ?? [];
  const activeTargetMailboxId = targetMailboxId || catchAll?.mailbox_id || mailboxes[0]?.id || '';

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/domains/${activeDomainId}/catch-all`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mailbox_id: activeTargetMailboxId }),
      });
      if (!res.ok) throw new Error('Failed to set catch-all');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'catch-all', activeDomainId] });
      setSavedMessage('Настройки Catch-all сохранены');
      setTimeout(() => setSavedMessage(null), 3000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/domains/${activeDomainId}/catch-all`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to disable catch-all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'catch-all', activeDomainId] });
      setSavedMessage('Catch-all отключен');
      setTimeout(() => setSavedMessage(null), 3000);
    },
  });

  const isEnabled = Boolean(catchAll?.mailbox_id);

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={t('nav.admin.catchAll')} />

      <Card>
        <div className="space-y-4">
          <p className="text-mg-text-muted text-sm">
            {t(
              'admin.catchAll.description',
              'Catch-all перенаправляет все входящие письма, отправленные на несуществующие адреса домена, в один выбранный почтовый ящик.',
            )}
          </p>

          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">
              {t('admin.domains.domain', 'Домен')}
            </label>
            <select
              className="border-mg-border bg-mg-surface text-mg-text w-full rounded-md border p-2 text-sm"
              value={activeDomainId}
              onChange={(e) => {
                setSelectedDomainId(e.target.value);
                setTargetMailboxId('');
              }}
            >
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="border-mg-border flex items-center justify-between border-t pt-4">
            <span className="text-mg-text text-sm font-medium">
              {t('common.status', 'Статус')}:
            </span>
            <Badge tone={isEnabled ? 'success' : 'neutral'}>
              {isEnabled ? t('common.enabled', 'Включен') : t('common.disabled', 'Выключен')}
            </Badge>
          </div>

          {mailboxes.length > 0 ? (
            <div>
              <label className="text-mg-text mb-1 block text-xs font-medium">
                {t('admin.catchAll.targetMailbox', 'Целевой почтовый ящик')}
              </label>
              <select
                className="border-mg-border bg-mg-surface text-mg-text w-full rounded-md border p-2 text-sm"
                value={activeTargetMailboxId}
                onChange={(e) => setTargetMailboxId(e.target.value)}
              >
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.address}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-mg-text-muted text-sm">
              {t('admin.catchAll.noMailboxes', 'В выбранном домене нет созданных ящиков.')}
            </p>
          )}

          <div className="border-mg-border flex items-center gap-3 border-t pt-4">
            <Button
              onClick={() => saveMutation.mutate()}
              isLoading={saveMutation.isPending}
              disabled={mailboxes.length === 0}
            >
              {t('common.save', 'Сохранить')}
            </Button>
            {isEnabled ? (
              <Button
                variant="danger"
                onClick={() => deleteMutation.mutate()}
                isLoading={deleteMutation.isPending}
              >
                {t('admin.catchAll.disable', 'Отключить Catch-all')}
              </Button>
            ) : null}
            {savedMessage ? <span className="text-mg-success text-sm">{savedMessage}</span> : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
