import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Modal, PageHeader, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import { apiClient, fetchApi } from '../../lib/apiClient';

interface ListSummary {
  id: string;
  domain_id: string;
  address: string;
  display_name: string | null;
  send_policy: string;
  status: string;
  member_count: number;
}

interface DomainSummary {
  id: string;
  name: string;
}

export function DistributionListsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<ListSummary | null>(null);

  const [localPart, setLocalPart] = useState('');
  const [domainId, setDomainId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [sendPolicy, setSendPolicy] = useState('members_only');
  const [newMemberEmail, setNewMemberEmail] = useState('');
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

  const { data: lists = [], isLoading } = useQuery<ListSummary[]>({
    queryKey: ['admin', 'lists'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/lists', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load distribution lists');
      return res.json();
    },
  });

  const { data: members = [], refetch: refetchMembers } = useQuery<string[]>({
    queryKey: ['admin', 'lists', selectedList?.id, 'members'],
    queryFn: async () => {
      if (!selectedList) return [];
      const res = await fetchApi(`/api/v1/admin/lists/${selectedList.id}/members`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load list members');
      return res.json();
    },
    enabled: Boolean(selectedList),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const currentDomain = domains.find((d) => d.id === domainId);
      const fullAddress = `${localPart}@${currentDomain?.name}`;

      const res = await fetchApi('/api/v1/admin/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain_id: domainId,
          address: fullAddress,
          display_name: displayName || undefined,
          send_policy: sendPolicy,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Failed to create list');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'lists'] });
      setCreateOpen(false);
      setLocalPart('');
      setDisplayName('');
      setFormError(null);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (listId: string) => {
      const res = await fetchApi(`/api/v1/admin/lists/${listId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete list');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'lists'] });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      if (!selectedList || !newMemberEmail) return;
      const res = await fetchApi(`/api/v1/admin/lists/${selectedList.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ member: newMemberEmail.trim() }),
      });
      if (!res.ok) throw new Error('Failed to add member');
      return res.json();
    },
    onSuccess: () => {
      setNewMemberEmail('');
      refetchMembers();
      queryClient.invalidateQueries({ queryKey: ['admin', 'lists'] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (member: string) => {
      if (!selectedList) return;
      const res = await fetchApi(
        `/api/v1/admin/lists/${selectedList.id}/members/${encodeURIComponent(member)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to remove member');
    },
    onSuccess: () => {
      refetchMembers();
      queryClient.invalidateQueries({ queryKey: ['admin', 'lists'] });
    },
  });

  const columns: TableColumn<ListSummary>[] = [
    {
      key: 'address',
      header: t('admin.lists.address', 'Адрес списка'),
      render: (row) => (
        <div>
          <span className="text-mg-text font-medium">{row.address}</span>
          {row.display_name ? (
            <p className="text-mg-text-muted text-xs">{row.display_name}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'policy',
      header: t('admin.lists.sendPolicy', 'Политика отправки'),
      render: (row) => (
        <Badge
          tone={
            row.send_policy === 'open'
              ? 'warning'
              : row.send_policy === 'members_only'
                ? 'primary'
                : 'neutral'
          }
        >
          {row.send_policy}
        </Badge>
      ),
    },
    {
      key: 'members',
      header: t('admin.lists.members', 'Участники'),
      render: (row) => (
        <span
          className="text-mg-primary cursor-pointer hover:underline"
          onClick={() => {
            setSelectedList(row);
            setMembersOpen(true);
          }}
        >
          {row.member_count} {t('admin.lists.membersCount', 'уч.')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedList(row);
              setMembersOpen(true);
            }}
          >
            {t('admin.lists.manageMembers', 'Участники')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirm(t('admin.lists.confirmDelete', `Удалить список ${row.address}?`))) {
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
        title={t('nav.admin.lists')}
        actions={
          <Button
            onClick={() => {
              if (domains.length > 0 && !domainId && domains[0]) {
                setDomainId(domains[0].id);
              }
              setFormError(null);
              setCreateOpen(true);
            }}
          >
            {t('admin.lists.create', 'Создать список')}
          </Button>
        }
      />

      <Card>
        <Table
          columns={columns}
          rows={lists}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('admin.lists.empty', 'Списки рассылки не созданы')}
        />
      </Card>

      {/* Create Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('admin.lists.createTitle', 'Создать список рассылки')}
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
          <div className="grid grid-cols-2 gap-2">
            <Input
              label={t('admin.lists.localPart', 'Имя списка')}
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value)}
              placeholder="team"
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

          <Input
            label={t('admin.lists.displayName', 'Название (необязательно)')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Engineering Team"
          />

          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">
              {t('admin.lists.sendPolicy', 'Политика отправки')}
            </label>
            <select
              className="border-mg-border bg-mg-surface text-mg-text w-full rounded-md border p-2 text-sm"
              value={sendPolicy}
              onChange={(e) => setSendPolicy(e.target.value)}
            >
              <option value="members_only">
                {t('admin.lists.policyMembersOnly', 'Только участники списка (members_only)')}
              </option>
              <option value="domain_only">
                {t(
                  'admin.lists.policyDomainOnly',
                  'Только пользователи этого домена (domain_only)',
                )}
              </option>
              <option value="open">
                {t('admin.lists.policyOpen', 'Открытый (любой отправитель, open)')}
              </option>
              <option value="moderated">
                {t('admin.lists.policyModerated', 'Модерируемый (moderated)')}
              </option>
            </select>
          </div>

          {formError ? <p className="text-mg-danger text-sm">{formError}</p> : null}
        </div>
      </Modal>

      {/* Members Modal */}
      <Modal
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        title={`${t('admin.lists.membersTitle', 'Участники')}: ${selectedList?.address}`}
        footer={
          <Button variant="secondary" onClick={() => setMembersOpen(false)}>
            {t('common.close', 'Закрыть')}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              placeholder="user@example.com"
            />
            <Button
              onClick={() => addMemberMutation.mutate()}
              isLoading={addMemberMutation.isPending}
            >
              {t('common.add', 'Добавить')}
            </Button>
          </div>

          <div className="border-mg-border max-h-60 overflow-y-auto rounded-md border p-2">
            {members.length === 0 ? (
              <p className="text-mg-text-muted p-2 text-sm">
                {t('admin.lists.noMembers', 'В списке пока нет участников.')}
              </p>
            ) : (
              <ul className="divide-mg-border divide-y">
                {members.map((m) => (
                  <li key={m} className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-mg-text font-mono text-sm">{m}</span>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => removeMemberMutation.mutate(m)}
                    >
                      ×
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
