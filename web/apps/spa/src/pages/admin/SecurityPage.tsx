import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Modal, PageHeader, Table, Tabs } from '@mgate/ui';
import type { TabItem, TableColumn } from '@mgate/ui';
import { fetchApi } from '../../lib/apiClient';

interface RateLimits {
  mailbox_hourly: number;
  mailbox_daily: number;
  domain_hourly: number;
  domain_daily: number;
  ip_hourly: number;
  ip_daily: number;
}

export function SecurityPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'bans' | 'rate-limits'>('bans');

  // Ban modal
  const [banModalOpen, setBanModalOpen] = useState(false);
  const [banIp, setBanIp] = useState('');
  const [banReason, setBanReason] = useState('Manual admin ban');
  const [banHours, setBanHours] = useState('24');
  const [banError, setBanError] = useState<string | null>(null);

  const { data: bans = [], isLoading: loadingBans } = useQuery<string[]>({
    queryKey: ['admin', 'security', 'bans'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/security/bans', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load bans');
      return res.json();
    },
  });

  const { data: limits } = useQuery<RateLimits>({
    queryKey: ['admin', 'security', 'rate-limits'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/security/rate-limits', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load rate limits');
      return res.json();
    },
  });

  const addBanMutation = useMutation({
    mutationFn: async () => {
      if (!banIp) throw new Error('Укажите IP адрес');
      const ttl = parseInt(banHours, 10) * 3600;
      const res = await fetchApi('/api/v1/admin/security/bans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ip: banIp.trim(),
          ttl_secs: ttl,
          reason: banReason,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Failed to add ban');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'bans'] });
      setBanModalOpen(false);
      setBanIp('');
      setBanError(null);
    },
    onError: (err: Error) => {
      setBanError(err.message);
    },
  });

  const removeBanMutation = useMutation({
    mutationFn: async (ip: string) => {
      const res = await fetchApi(`/api/v1/admin/security/bans/${encodeURIComponent(ip)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to remove ban');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'bans'] });
    },
  });

  const tabs: TabItem[] = [
    { value: 'bans', label: t('admin.security.tabs.bans', 'Блокировки IP (Bans)') },
    {
      value: 'rate-limits',
      label: t('admin.security.tabs.rateLimits', 'Лимиты отправки (Rate Limits)'),
    },
  ];

  const banColumns: TableColumn<string>[] = [
    {
      key: 'ip',
      header: t('admin.security.ip', 'IP адрес'),
      render: (ip) => <span className="font-mono text-sm font-semibold">{ip}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (ip) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => removeBanMutation.mutate(ip)}
            isLoading={removeBanMutation.isPending}
          >
            {t('admin.security.unban', 'Разблокировать')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.admin.security')}
        actions={
          tab === 'bans' ? (
            <Button onClick={() => setBanModalOpen(true)}>
              {t('admin.security.addBan', 'Заблокировать IP')}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <Tabs
          items={tabs}
          value={tab}
          onChange={(v) => setTab(v as 'bans' | 'rate-limits')}
          className="mb-4"
        />

        {tab === 'bans' ? (
          <div className="space-y-4">
            <p className="text-mg-text-muted text-sm">
              {t(
                'admin.security.bansHint',
                'Список заблокированных IP адресов. При попытке подключения с этих IP почтовые демоны сбрасывают соединение.',
              )}
            </p>
            <Table
              columns={banColumns}
              rows={bans}
              rowKey={(ip) => ip}
              isLoading={loadingBans}
              emptyMessage={t('admin.security.emptyBans', 'Нет активных блокировок IP')}
            />
          </div>
        ) : null}

        {tab === 'rate-limits' ? (
          <RateLimitsTab key={limits ? 'loaded' : 'loading'} initialLimits={limits} />
        ) : null}
      </Card>

      <Modal
        open={banModalOpen}
        onClose={() => setBanModalOpen(false)}
        title={t('admin.security.addBanTitle', 'Ручная блокировка IP адреса')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBanModalOpen(false)}>
              {t('common.cancel', 'Отмена')}
            </Button>
            <Button onClick={() => addBanMutation.mutate()} isLoading={addBanMutation.isPending}>
              {t('admin.security.banButton', 'Заблокировать')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="IP адрес"
            value={banIp}
            onChange={(e) => setBanIp(e.target.value)}
            placeholder="198.51.100.42"
          />

          <Input
            label={t('admin.security.banHours', 'Срок блокировки (в часах)')}
            type="number"
            value={banHours}
            onChange={(e) => setBanHours(e.target.value)}
            placeholder="24"
          />

          <Input
            label={t('admin.security.banReason', 'Причина блокировки')}
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
          />

          {banError ? <p className="text-mg-danger text-sm">{banError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}

function RateLimitsTab({ initialLimits }: { initialLimits?: RateLimits }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // The API returns the limits in force, so the form never invents values of its own.
  const [mbHourly, setMbHourly] = useState(String(initialLimits?.mailbox_hourly ?? ''));
  const [mbDaily, setMbDaily] = useState(String(initialLimits?.mailbox_daily ?? ''));
  const [domHourly, setDomHourly] = useState(String(initialLimits?.domain_hourly ?? ''));
  const [domDaily, setDomDaily] = useState(String(initialLimits?.domain_daily ?? ''));
  const [ipHourly, setIpHourly] = useState(String(initialLimits?.ip_hourly ?? ''));
  const [ipDaily, setIpDaily] = useState(String(initialLimits?.ip_daily ?? ''));
  const fields = [mbHourly, mbDaily, domHourly, domDaily, ipHourly, ipDaily];
  const valid = !!initialLimits && fields.every((v) => /^[1-9]\d*$/.test(v.trim()));
  const [rateLimitSaved, setRateLimitSaved] = useState(false);

  const saveLimitsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi('/api/v1/admin/security/rate-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mailbox_hourly: parseInt(mbHourly, 10),
          mailbox_daily: parseInt(mbDaily, 10),
          domain_hourly: parseInt(domHourly, 10),
          domain_daily: parseInt(domDaily, 10),
          ip_hourly: parseInt(ipHourly, 10),
          ip_daily: parseInt(ipDaily, 10),
        }),
      });
      if (!res.ok) throw new Error('Failed to update rate limits');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'rate-limits'] });
      setRateLimitSaved(true);
      setTimeout(() => setRateLimitSaved(false), 2500);
    },
  });

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-mg-text-muted text-sm">
        {t(
          'admin.security.rateLimitsHint',
          'Ограничения на количество исходящих писем в час и в сутки для предотвращения рассылки спама через скомпрометированные учетные записи.',
        )}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label={t('admin.security.mbHourly', 'Писем с ящика в час')}
          type="number"
          min={1}
          value={mbHourly}
          onChange={(e) => setMbHourly(e.target.value)}
        />
        <Input
          label={t('admin.security.mbDaily', 'Писем с ящика в сутки')}
          type="number"
          min={1}
          value={mbDaily}
          onChange={(e) => setMbDaily(e.target.value)}
        />
        <Input
          label={t('admin.security.domHourly', 'Писем с домена в час')}
          type="number"
          min={1}
          value={domHourly}
          onChange={(e) => setDomHourly(e.target.value)}
        />
        <Input
          label={t('admin.security.domDaily', 'Писем с домена в сутки')}
          type="number"
          min={1}
          value={domDaily}
          onChange={(e) => setDomDaily(e.target.value)}
        />
        <Input
          label={t('admin.security.ipHourly', 'Писем с одного IP в час')}
          type="number"
          min={1}
          value={ipHourly}
          onChange={(e) => setIpHourly(e.target.value)}
        />
        <Input
          label={t('admin.security.ipDaily', 'Писем с одного IP в сутки')}
          type="number"
          min={1}
          value={ipDaily}
          onChange={(e) => setIpDaily(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button
          onClick={() => saveLimitsMutation.mutate()}
          isLoading={saveLimitsMutation.isPending}
          disabled={!valid}
        >
          {t('common.save', 'Сохранить лимиты')}
        </Button>
        {rateLimitSaved ? (
          <span className="text-mg-success text-sm">
            {t('common.saved', 'Настройки сохранены!')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
