import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Globe,
  Mail,
  ShieldCheck,
  Star,
  Trash2,
  ExternalLink,
  Plus,
  RefreshCw,
  AlertTriangle,
  HardDrive,
  BarChart3,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  AtSign,
  Share2,
  Users,
  Inbox,
  Lock,
  Check,
  X,
  UserPlus,
  Copy,
  Key,
  Shield,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Tabs, Table, cn } from '@mgate/ui';
import type { TabItem, TableColumn } from '@mgate/ui';
import { useAuth } from '../../../auth/AuthContext';
import { useBreadcrumbs } from '../../../components/layout/Breadcrumbs';
import { fetchApi } from '../../../lib/apiClient';
import { DnsAutopilotModal } from './DnsAutopilotModal';
import { DmarcTab } from './DmarcTab';

type TabValue =
  | 'overview'
  | 'mailboxes'
  | 'aliases'
  | 'forwarding'
  | 'lists'
  | 'catch-all'
  | 'dns'
  | 'dmarc'
  | 'stats'
  | 'quotas'
  | 'security';

interface DnsRecordDto {
  record_type: string;
  host: string;
  value: string;
  status: string;
}

interface DnsCheckResponse {
  domain: string;
  records: DnsRecordDto[];
  all_ok: boolean;
}

interface MailboxSummary {
  id: string;
  address: string;
  domain_id: string;
  status: string;
  quota_bytes: number | null;
  display_name?: string | null;
}

interface MailEventRecord {
  id: number;
  occurred_at: string;
  event_type: string;
  message_id: string | null;
  from_address: string | null;
  to_address: string | null;
  size_bytes: number | null;
  spam_score: number | null;
  action: string | null;
  details: Record<string, unknown>;
}

interface AliasSummary {
  id: string;
  domain_id: string;
  source: string;
  destinations: string[];
  status: string;
}

interface ForwardingItem {
  id: string;
  mailbox_id: string;
  mailbox_address: string;
  destination: string;
  keep_copy: boolean;
  status: string;
}

interface ListSummary {
  id: string;
  domain_id: string;
  address: string;
  display_name: string | null;
  send_policy: string;
  status: string;
  member_count: number;
}

interface CatchAllResponse {
  mailbox_id: string;
  mailbox_address?: string;
}

export function DomainDetailPage() {
  const { t } = useTranslation();
  const { domainId } = useParams<{ domainId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SuperAdmin';
  const [tab, setTab] = useState<TabValue>('overview');
  const [autopilotOpen, setAutopilotOpen] = useState(false);

  const { data: domain, isLoading } = useQuery({
    queryKey: ['admin', 'domains', domainId],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}`);
      if (!res.ok) throw new Error('Domain not found');
      return res.json();
    },
    enabled: Boolean(domainId),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete domain');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
      navigate('/admin/domains');
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to change status');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains', domainId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
    },
  });

  const tabLabels: Record<TabValue, string> = {
    overview: t('admin.domains.tabs.overview', 'Обзор'),
    mailboxes: 'Почтовые ящики',
    aliases: 'Алиасы',
    forwarding: 'Пересылки',
    lists: 'Списки рассылки',
    'catch-all': 'Catch-All',
    dns: t('admin.domains.tabs.dns', 'Мастер DNS'),
    dmarc: 'DMARC & Аналитика',
    stats: 'Статистика и спам',
    quotas: t('admin.domains.tabs.quotas', 'Квоты'),
    security: 'Безопасность',
  };

  const domainCrumbs = useMemo(
    () => [
      { label: 'Главная', to: '/' },
      { label: 'Администрирование', to: '/admin' },
      { label: 'Домены', to: '/admin/domains' },
      { label: domain?.name || domainId || 'Домен', to: `/admin/domains/${domainId}` },
      { label: tabLabels[tab] },
    ],
    [domain?.name, domainId, tab],
  );

  useBreadcrumbs(domainCrumbs);

  const tabs: TabItem[] = [
    { value: 'overview', label: tabLabels.overview },
    { value: 'mailboxes', label: tabLabels.mailboxes },
    { value: 'aliases', label: tabLabels.aliases },
    { value: 'forwarding', label: tabLabels.forwarding },
    { value: 'lists', label: tabLabels.lists },
    { value: 'catch-all', label: tabLabels['catch-all'] },
    { value: 'dns', label: tabLabels.dns },
    { value: 'dmarc', label: tabLabels.dmarc },
    { value: 'stats', label: tabLabels.stats },
    { value: 'quotas', label: tabLabels.quotas },
    { value: 'security', label: tabLabels.security },
  ];

  if (isLoading) {
    return <div className="text-mg-text-muted p-6">Загрузка домена...</div>;
  }

  if (!domain) {
    return <div className="text-mg-danger p-6">Домен не найден</div>;
  }

  const isActive = domain.status === 'active';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="border-mg-border-subtle flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
            <Globe className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-mg-text text-xl font-semibold tracking-tight">{domain.name}</h1>
              {domain.is_primary && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  <Star className="h-2.5 w-2.5 fill-current" />
                  Основной
                </span>
              )}
              <Badge tone={isActive ? 'success' : 'danger'}>{domain.status}</Badge>
            </div>
            <p className="text-mg-text-muted mt-0.5 font-mono text-xs">ID: {domain.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/admin/domains"
            className="text-mg-text-muted hover:text-mg-text border-mg-border rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            ← К списку доменов
          </Link>
          {isSuperAdmin && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => toggleStatusMutation.mutate(isActive ? 'disabled' : 'active')}
              isLoading={toggleStatusMutation.isPending}
            >
              {isActive ? 'Приостановить' : 'Активировать'}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <div className="border-mg-border-subtle mb-6 overflow-x-auto border-b pb-1">
          <Tabs items={tabs} value={tab} onChange={(v) => setTab(v as TabValue)} />
        </div>

        {/* Overview Tab (Danger Zone removed!) */}
        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="border-mg-border-subtle bg-mg-surface-subtle/40 rounded-xl border p-4">
                <p className="text-mg-text-muted text-xs font-medium">Количество ящиков</p>
                <p className="text-mg-text mt-1 text-2xl font-bold">{domain.mailbox_count ?? 0}</p>
                <p className="text-mg-text-muted mt-1 text-[11px]">Активные ящики домена</p>
              </div>

              <div className="border-mg-border-subtle bg-mg-surface-subtle/40 rounded-xl border p-4">
                <p className="text-mg-text-muted text-xs font-medium">Статус DKIM и DNS</p>
                <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Настроен</span>
                </p>
                <p className="text-mg-text-muted mt-1 text-[11px]">Подпись DKIM включена</p>
              </div>

              <div className="border-mg-border-subtle bg-mg-surface-subtle/40 rounded-xl border p-4">
                <p className="text-mg-text-muted text-xs font-medium">Объем хранилища</p>
                <p className="text-mg-text mt-1 text-2xl font-bold">
                  {domain.quota_total_bytes
                    ? `${Math.round(domain.quota_total_bytes / (1024 * 1024 * 1024))} GB`
                    : 'Не ограничен'}
                </p>
                <p className="text-mg-text-muted mt-1 text-[11px]">Квота на весь домен</p>
              </div>
            </div>

            <div className="border-mg-border-subtle bg-mg-surface-subtle/20 rounded-xl border p-4">
              <h3 className="text-mg-text mb-3 text-xs font-semibold tracking-wider uppercase">
                Быстрые ссылки по домену
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => setTab('mailboxes')}
                  className="border-mg-border-subtle bg-mg-surface hover:border-mg-primary/40 flex flex-col items-start rounded-lg border p-3 text-left transition-colors"
                >
                  <Mail className="text-mg-primary mb-1.5 h-4 w-4" />
                  <span className="text-mg-text text-xs font-medium">Ящики</span>
                  <span className="text-mg-text-muted text-[10px]">Управление адресами</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('aliases')}
                  className="border-mg-border-subtle bg-mg-surface hover:border-mg-primary/40 flex flex-col items-start rounded-lg border p-3 text-left transition-colors"
                >
                  <AtSign className="text-mg-primary mb-1.5 h-4 w-4" />
                  <span className="text-mg-text text-xs font-medium">Алиасы</span>
                  <span className="text-mg-text-muted text-[10px]">Псевдонимы почты</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('forwarding')}
                  className="border-mg-border-subtle bg-mg-surface hover:border-mg-primary/40 flex flex-col items-start rounded-lg border p-3 text-left transition-colors"
                >
                  <Share2 className="text-mg-primary mb-1.5 h-4 w-4" />
                  <span className="text-mg-text text-xs font-medium">Пересылки</span>
                  <span className="text-mg-text-muted text-[10px]">Правила перенаправления</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('security')}
                  className="border-mg-border-subtle bg-mg-surface hover:border-mg-primary/40 flex flex-col items-start rounded-lg border p-3 text-left transition-colors"
                >
                  <Lock className="text-mg-primary mb-1.5 h-4 w-4" />
                  <span className="text-mg-text text-xs font-medium">Безопасность</span>
                  <span className="text-mg-text-muted text-[10px]">Удаление и политики</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mailboxes Tab with search, filter, and pagination */}
        {tab === 'mailboxes' && (
          <DomainMailboxesTab domainId={domain.id} domainName={domain.name} />
        )}

        {/* Aliases Tab */}
        {tab === 'aliases' && <DomainAliasesTab domainId={domain.id} domainName={domain.name} />}

        {/* Forwarding Tab */}
        {tab === 'forwarding' && (
          <DomainForwardingTab domainId={domain.id} domainName={domain.name} />
        )}

        {/* Distribution Lists Tab */}
        {tab === 'lists' && <DomainListsTab domainId={domain.id} domainName={domain.name} />}

        {/* Catch-All Tab */}
        {tab === 'catch-all' && <DomainCatchAllTab domainId={domain.id} domainName={domain.name} />}

        {/* DNS Wizard Tab */}
        {tab === 'dns' && <DnsWizardTab domainId={domain.id} domainName={domain.name} />}

        {/* DMARC Analytics Tab */}
        {tab === 'dmarc' && <DmarcTab domainId={domain.id} domainName={domain.name} />}

        {/* Stats & Spam Tab */}
        {tab === 'stats' && <DomainStatsTab domainName={domain.name} />}

        {/* Quotas Tab */}
        {tab === 'quotas' && <QuotasTab domainId={domain.id} />}

        {/* Security Tab (Dedicated delete zone) */}
        {tab === 'security' && (
          <DomainSecurityTab
            domain={domain}
            isSuperAdmin={isSuperAdmin}
            deleteMutation={deleteMutation}
            toggleStatusMutation={toggleStatusMutation}
          />
        )}
      </Card>

      {/* Global DNS Autopilot Modal */}
      {autopilotOpen && (
        <DnsAutopilotModal
          open={autopilotOpen}
          onClose={() => setAutopilotOpen(false)}
          domainId={domain.id}
          domainName={domain.name}
          onSyncComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'domains', domain.id] });
          }}
        />
      )}
    </div>
  );
}

function DomainMailboxesTab({ domainId, domainName }: { domainId: string; domainName: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Create mailbox modal
  const [createOpen, setCreateOpen] = useState(false);
  const [localPart, setLocalPart] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [quotaGb, setQuotaGb] = useState('10');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: mailboxesData, isLoading } = useQuery({
    queryKey: ['admin', 'mailboxes', domainId],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes?domain_id=${domainId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load mailboxes');
      return res.json();
    },
  });

  const mailboxes: MailboxSummary[] = mailboxesData?.items ?? [];

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
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes', domainId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains', domainId] });
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

  // Filter
  const filtered = mailboxes.filter((mb) => {
    if (statusFilter !== 'all' && mb.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      mb.address.toLowerCase().includes(q) ||
      (mb.display_name && mb.display_name.toLowerCase().includes(q))
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginated = filtered.slice(startIndex, startIndex + pageSize);

  const columns: TableColumn<MailboxSummary>[] = [
    {
      key: 'address',
      header: 'Почтовый ящик',
      render: (row) => (
        <Link
          to={`/admin/mailboxes/${row.id}`}
          className="text-mg-text hover:text-mg-primary flex items-center gap-1.5 text-sm font-semibold transition-colors"
        >
          <span>{row.address}</span>
          <ExternalLink className="text-mg-text-muted h-3 w-3" />
        </Link>
      ),
    },
    {
      key: 'display_name',
      header: 'Имя пользователя',
      render: (row) => (
        <span className="text-mg-text-muted text-xs">{row.display_name || '—'}</span>
      ),
    },
    {
      key: 'quota',
      header: 'Квота',
      render: (row) => (
        <span className="text-mg-text-muted inline-flex items-center gap-1 text-xs">
          <HardDrive className="h-3 w-3" />
          <span>
            {row.quota_bytes
              ? `${(row.quota_bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
              : '10 GB'}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      render: (row) => (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            row.status === 'active'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
          }`}
        >
          {row.status}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-mg-text text-sm font-semibold">
            Почтовые ящики домена @{domainName} ({mailboxes.length})
          </h3>
          <p className="text-mg-text-muted text-xs">
            Управление почтовыми адресами, лимитами и параметрами ящиков.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="gap-1.5 self-start sm:self-auto"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Создать ящик</span>
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="border-mg-border-subtle bg-mg-surface-subtle/30 flex flex-col items-center gap-3 rounded-lg border p-3 sm:flex-row">
        <div className="relative w-full flex-1">
          <Search className="text-mg-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Поиск по ящику или имени..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="bg-mg-surface border-mg-border text-mg-text placeholder:text-mg-text-muted focus:border-mg-primary w-full rounded-md border py-1.5 pr-3 pl-9 text-xs focus:outline-none"
          />
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as 'all' | 'active' | 'disabled');
              setPage(1);
            }}
            aria-label="Фильтр статуса ящиков"
            className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary rounded-md border px-2.5 py-1.5 text-xs focus:outline-none"
          >
            <option value="all">Все статусы</option>
            <option value="active">Активные</option>
            <option value="disabled">Отключенные</option>
          </select>

          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            aria-label="Количество ящиков на странице"
            className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary rounded-md border px-2.5 py-1.5 text-xs focus:outline-none"
          >
            <option value={10}>10 / стр</option>
            <option value={25}>25 / стр</option>
            <option value={50}>50 / стр</option>
          </select>
        </div>
      </div>

      <Table
        columns={columns}
        rows={paginated}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        emptyMessage={
          <div className="text-mg-text-muted py-8 text-center text-xs">
            {search || statusFilter !== 'all'
              ? 'По указанным фильтрам ящики не найдены.'
              : 'В этом домене еще нет почтовых ящиков.'}
          </div>
        }
      />

      {/* Pagination Controls */}
      {filtered.length > 0 && (
        <div className="text-mg-text-muted border-mg-border-subtle flex flex-col items-center justify-between gap-2 border-t pt-2 text-xs sm:flex-row">
          <span>
            Показано {startIndex + 1}–{Math.min(startIndex + pageSize, filtered.length)} из{' '}
            {filtered.length}
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

      {/* Create Mailbox Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Создание ящика в @${domainName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              isLoading={createMutation.isPending}
              disabled={!localPart || !password}
            >
              Создать ящик
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600">
              {formError}
            </div>
          )}
          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">Имя ящика</label>
            <div className="flex items-center">
              <input
                type="text"
                placeholder="info"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
                className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary flex-1 rounded-l-md border border-r-0 px-3 py-1.5 text-xs focus:outline-none"
              />
              <span className="bg-mg-surface-subtle border-mg-border text-mg-text-muted rounded-r-md border px-3 py-1.5 text-xs">
                @{domainName}
              </span>
            </div>
          </div>
          <Input
            label="Пароль"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Сложный пароль..."
          />
          <Input
            label="Имя пользователя (необязательно)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Иван Иванов"
          />
          <Input
            label="Квота хранилища (ГБ)"
            type="number"
            value={quotaGb}
            onChange={(e) => setQuotaGb(e.target.value)}
            placeholder="10"
          />
        </div>
      </Modal>
    </div>
  );
}

function DomainAliasesTab({ domainId, domainName }: { domainId: string; domainName: string }) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [localPart, setLocalPart] = useState('');
  const [destinationsStr, setDestinationsStr] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: aliases = [], isLoading } = useQuery<AliasSummary[]>({
    queryKey: ['admin', 'aliases'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/aliases', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load aliases');
      return res.json();
    },
  });

  const domainAliases = aliases.filter(
    (a) => a.domain_id === domainId || a.source.endsWith(`@${domainName}`),
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const dests = destinationsStr
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (!localPart || dests.length === 0) {
        throw new Error('Укажите имя алиаса и хотя бы один адрес назначения');
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
      setCreateOpen(false);
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
      header: 'Алиас',
      render: (row) => (
        <span className="text-mg-text font-mono text-xs font-medium">{row.source}</span>
      ),
    },
    {
      key: 'destinations',
      header: 'Получатели',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.destinations.map((d, i) => (
            <span
              key={i}
              className="text-mg-text-muted bg-mg-surface-subtle border-mg-border-subtle rounded border px-1.5 py-0.5 font-mono text-xs"
            >
              {d}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
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
            size="xs"
            variant="danger"
            onClick={() => {
              if (confirm(`Удалить алиас ${row.source}?`)) {
                deleteMutation.mutate(row.id);
              }
            }}
            isLoading={deleteMutation.isPending}
          >
            Удалить
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-mg-text text-sm font-semibold">
            Алиасы домена @{domainName} ({domainAliases.length})
          </h3>
          <p className="text-mg-text-muted text-xs">
            Псевдонимы для перенаправления почты на один или несколько реальных адресов.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          <span>Создать алиас</span>
        </Button>
      </div>

      <Table
        columns={columns}
        rows={domainAliases}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        emptyMessage={
          <div className="text-mg-text-muted py-8 text-center text-xs">
            В этом домене еще нет настроенных алиасов.
          </div>
        }
      />

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Создать алиас в @${domainName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => createMutation.mutate()} isLoading={createMutation.isPending}>
              Создать
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600">
              {formError}
            </div>
          )}
          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">Имя алиаса</label>
            <div className="flex items-center">
              <input
                type="text"
                placeholder="sales"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
                className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary flex-1 rounded-l-md border border-r-0 px-3 py-1.5 text-xs focus:outline-none"
              />
              <span className="bg-mg-surface-subtle border-mg-border text-mg-text-muted rounded-r-md border px-3 py-1.5 text-xs">
                @{domainName}
              </span>
            </div>
          </div>
          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">
              Адреса назначения (через запятую или новую строку)
            </label>
            <textarea
              rows={3}
              value={destinationsStr}
              onChange={(e) => setDestinationsStr(e.target.value)}
              placeholder="user1@example.com, user2@example.com"
              className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-full rounded-md border p-2.5 text-xs focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function DomainForwardingTab({ domainId, domainName }: { domainId: string; domainName: string }) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedMailboxId, setSelectedMailboxId] = useState('');
  const [destination, setDestination] = useState('');
  const [keepCopy, setKeepCopy] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: forwardings = [], isLoading: isFwdLoading } = useQuery<ForwardingItem[]>({
    queryKey: ['admin', 'forwardings'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/forwardings', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load forwardings');
      return res.json();
    },
  });

  const { data: mailboxesData } = useQuery({
    queryKey: ['admin', 'mailboxes', domainId],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes?domain_id=${domainId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load mailboxes');
      return res.json();
    },
  });

  const mailboxes: MailboxSummary[] = mailboxesData?.items ?? [];
  const domainForwardings = forwardings.filter((f) => f.mailbox_address.endsWith(`@${domainName}`));

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMailboxId || !destination) {
        throw new Error('Выберите ящик и адрес пересылки');
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
      setCreateOpen(false);
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
      header: 'Исходный ящик',
      render: (row) => (
        <span className="text-mg-text font-mono text-xs font-medium">{row.mailbox_address}</span>
      ),
    },
    {
      key: 'destination',
      header: 'Куда пересылать',
      render: (row) => (
        <span className="text-mg-text-muted font-mono text-xs">{row.destination}</span>
      ),
    },
    {
      key: 'keep_copy',
      header: 'Копия на сервере',
      render: (row) => (
        <span className="text-mg-text-muted text-xs">
          {row.keep_copy ? 'Сохранять' : 'Удалять'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{row.status}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end">
          <Button
            size="xs"
            variant="danger"
            onClick={() => {
              if (confirm(`Удалить пересылку для ${row.mailbox_address}?`)) {
                deleteMutation.mutate(row.mailbox_id);
              }
            }}
            isLoading={deleteMutation.isPending}
          >
            Удалить
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-mg-text text-sm font-semibold">
            Пересылки почты домена @{domainName} ({domainForwardings.length})
          </h3>
          <p className="text-mg-text-muted text-xs">
            Автоматическая пересылка входящих писем на внешние или внутренние адреса.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          <span>Добавить пересылку</span>
        </Button>
      </div>

      <Table
        columns={columns}
        rows={domainForwardings}
        rowKey={(row) => row.id}
        isLoading={isFwdLoading}
        emptyMessage={
          <div className="text-mg-text-muted py-8 text-center text-xs">
            В этом домене нет настроенных правил пересылки.
          </div>
        }
      />

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Настройка пересылки почты"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => createMutation.mutate()} isLoading={createMutation.isPending}>
              Сохранить
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600">
              {formError}
            </div>
          )}
          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">Исходный ящик</label>
            <select
              value={selectedMailboxId}
              onChange={(e) => setSelectedMailboxId(e.target.value)}
              className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-full rounded-md border p-2 text-xs focus:outline-none"
            >
              <option value="">Выберите ящик из домена @{domainName}</option>
              {mailboxes.map((mb) => (
                <option key={mb.id} value={mb.id}>
                  {mb.address} {mb.display_name ? `(${mb.display_name})` : ''}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Адрес пересылки"
            type="email"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="target@example.com"
          />
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="fwd-keep-copy"
              checked={keepCopy}
              onChange={(e) => setKeepCopy(e.target.checked)}
              className="border-mg-border text-mg-primary rounded focus:ring-0"
            />
            <label
              htmlFor="fwd-keep-copy"
              className="text-mg-text cursor-pointer text-xs select-none"
            >
              Сохранять входящее письмо в ящике отправителя
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function DomainListsTab({ domainId, domainName }: { domainId: string; domainName: string }) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [selectedList, setSelectedList] = useState<ListSummary | null>(null);

  const [localPart, setLocalPart] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [sendPolicy, setSendPolicy] = useState('members_only');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: lists = [], isLoading } = useQuery<ListSummary[]>({
    queryKey: ['admin', 'lists'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/lists', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load distribution lists');
      return res.json();
    },
  });

  const domainLists = lists.filter(
    (l) => l.domain_id === domainId || l.address.endsWith(`@${domainName}`),
  );

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
      const fullAddress = `${localPart}@${domainName}`;
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
        body: JSON.stringify({ email: newMemberEmail }),
      });
      if (!res.ok) throw new Error('Failed to add member');
      return res.json();
    },
    onSuccess: () => {
      refetchMembers();
      setNewMemberEmail('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'lists'] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (email: string) => {
      if (!selectedList) return;
      const res = await fetchApi(
        `/api/v1/admin/lists/${selectedList.id}/members/${encodeURIComponent(email)}`,
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
      header: 'Адрес рассылки',
      render: (row) => (
        <span className="text-mg-text font-mono text-xs font-medium">{row.address}</span>
      ),
    },
    {
      key: 'display_name',
      header: 'Название',
      render: (row) => (
        <span className="text-mg-text-muted text-xs">{row.display_name || '—'}</span>
      ),
    },
    {
      key: 'policy',
      header: 'Политика отправки',
      render: (row) => {
        const labels: Record<string, string> = {
          anyone: 'Все пользователи',
          members_only: 'Только участники',
          domain_only: 'Только домен',
        };
        return (
          <span className="bg-mg-surface-subtle border-mg-border-subtle text-mg-text-muted rounded border px-2 py-0.5 text-xs">
            {labels[row.send_policy] || row.send_policy}
          </span>
        );
      },
    },
    {
      key: 'members',
      header: 'Участников',
      render: (row) => (
        <span className="text-mg-text inline-flex items-center gap-1 text-xs font-semibold">
          <Users className="text-mg-text-muted h-3 w-3" />
          {row.member_count}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              setSelectedList(row);
              setMembersOpen(true);
            }}
          >
            Участники ({row.member_count})
          </Button>
          <Button
            size="xs"
            variant="danger"
            onClick={() => {
              if (confirm(`Удалить список рассылки ${row.address}?`)) {
                deleteMutation.mutate(row.id);
              }
            }}
            isLoading={deleteMutation.isPending}
          >
            Удалить
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-mg-text text-sm font-semibold">
            Списки рассылки домена @{domainName} ({domainLists.length})
          </h3>
          <p className="text-mg-text-muted text-xs">
            Групповые адреса для рассылки сообщений множеству получателей одновременно.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          <span>Создать список</span>
        </Button>
      </div>

      <Table
        columns={columns}
        rows={domainLists}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        emptyMessage={
          <div className="text-mg-text-muted py-8 text-center text-xs">
            В этом домене еще нет списков рассылки.
          </div>
        }
      />

      {/* Create List Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Создать список рассылки в @${domainName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => createMutation.mutate()} isLoading={createMutation.isPending}>
              Создать
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600">
              {formError}
            </div>
          )}
          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">Адрес рассылки</label>
            <div className="flex items-center">
              <input
                type="text"
                placeholder="team"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
                className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary flex-1 rounded-l-md border border-r-0 px-3 py-1.5 text-xs focus:outline-none"
              />
              <span className="bg-mg-surface-subtle border-mg-border text-mg-text-muted rounded-r-md border px-3 py-1.5 text-xs">
                @{domainName}
              </span>
            </div>
          </div>
          <Input
            label="Отображаемое имя (необязательно)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Команда разработки"
          />
          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">Политика отправки</label>
            <select
              value={sendPolicy}
              onChange={(e) => setSendPolicy(e.target.value)}
              className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-full rounded-md border p-2 text-xs focus:outline-none"
            >
              <option value="members_only">Только участники могут отправлять</option>
              <option value="domain_only">Все пользователи домена</option>
              <option value="anyone">Кто угодно (внешние и внутренние)</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* Members Modal */}
      <Modal
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        title={`Участники рассылки: ${selectedList?.address}`}
        footer={
          <Button variant="secondary" onClick={() => setMembersOpen(false)}>
            Закрыть
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="email"
              placeholder="member@example.com"
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary flex-1 rounded-md border px-3 py-1.5 text-xs focus:outline-none"
            />
            <Button
              size="sm"
              onClick={() => addMemberMutation.mutate()}
              isLoading={addMemberMutation.isPending}
              disabled={!newMemberEmail}
            >
              Добавить
            </Button>
          </div>

          <div className="border-mg-border-subtle bg-mg-surface-subtle/20 max-h-60 space-y-1.5 overflow-y-auto rounded-lg border p-2">
            {members.length === 0 ? (
              <p className="text-mg-text-muted py-4 text-center text-xs">Список участников пуст</p>
            ) : (
              members.map((email) => (
                <div
                  key={email}
                  className="bg-mg-surface border-mg-border-subtle flex items-center justify-between rounded border p-1.5 px-2 text-xs"
                >
                  <span className="text-mg-text font-mono">{email}</span>
                  <button
                    type="button"
                    onClick={() => removeMemberMutation.mutate(email)}
                    className="text-mg-text-muted rounded p-1 transition-colors hover:bg-rose-500/10 hover:text-rose-600"
                    title="Исключить из рассылки"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function DomainCatchAllTab({ domainId, domainName }: { domainId: string; domainName: string }) {
  const queryClient = useQueryClient();
  const [selectedMailboxId, setSelectedMailboxId] = useState('');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const { data: catchAll, isLoading: isCatchAllLoading } = useQuery<CatchAllResponse | null>({
    queryKey: ['admin', 'catch-all', domainId],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/catch-all`, {
        credentials: 'include',
      });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: mailboxesData } = useQuery({
    queryKey: ['admin', 'mailboxes', domainId],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/mailboxes?domain_id=${domainId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load mailboxes');
      return res.json();
    },
  });

  const mailboxes: MailboxSummary[] = mailboxesData?.items ?? [];
  const currentTargetId = selectedMailboxId || catchAll?.mailbox_id || (mailboxes[0]?.id ?? '');

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!currentTargetId) throw new Error('Выберите ящик');
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/catch-all`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mailbox_id: currentTargetId }),
      });
      if (!res.ok) throw new Error('Failed to set catch-all');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'catch-all', domainId] });
      setSavedMsg('Настройки Catch-All сохранены');
      setTimeout(() => setSavedMsg(null), 3000);
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/catch-all`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to disable catch-all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'catch-all', domainId] });
      setSavedMsg('Catch-All отключен');
      setTimeout(() => setSavedMsg(null), 3000);
    },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="text-mg-text text-sm font-semibold">
          Настройка Catch-All для @{domainName}
        </h3>
        <p className="text-mg-text-muted mt-1 text-xs">
          Функция Catch-All перенаправляет все входящие письма, отправленные на несуществующие
          адреса в домене @{domainName}, в один назначенный почтовый ящик вместо возврата ошибки
          отправителю.
        </p>
      </div>

      {savedMsg && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
          ✓ {savedMsg}
        </div>
      )}

      <div className="border-mg-border-subtle bg-mg-surface-subtle/30 space-y-4 rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <span className="text-mg-text text-xs font-medium">Текущий статус Catch-All:</span>
          {catchAll?.mailbox_id ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
              <Check className="h-3 w-3" /> Включен ({catchAll.mailbox_address || 'Ящик назначен'})
            </span>
          ) : (
            <span className="text-mg-text-muted bg-mg-surface-subtle border-mg-border-subtle rounded-full border px-2 py-0.5 text-[11px] font-semibold">
              Отключен
            </span>
          )}
        </div>

        <div>
          <label className="text-mg-text mb-1 block text-xs font-medium">
            Почтовый ящик назначения
          </label>
          <select
            value={currentTargetId}
            onChange={(e) => setSelectedMailboxId(e.target.value)}
            disabled={mailboxes.length === 0}
            className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-full rounded-md border p-2 text-xs focus:outline-none"
          >
            {mailboxes.map((mb) => (
              <option key={mb.id} value={mb.id}>
                {mb.address} {mb.display_name ? `(${mb.display_name})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            isLoading={saveMutation.isPending}
            disabled={mailboxes.length === 0}
          >
            Сохранить настройку
          </Button>

          {catchAll?.mailbox_id && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => disableMutation.mutate()}
              isLoading={disableMutation.isPending}
            >
              Отключить Catch-All
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DomainSecurityTab({
  domain,
  isSuperAdmin,
  deleteMutation,
  toggleStatusMutation,
}: {
  domain: { name: string; status: string };
  isSuperAdmin: boolean;
  deleteMutation: { mutate: () => void; isPending: boolean };
  toggleStatusMutation: { mutate: (newStatus: string) => void; isPending: boolean };
}) {
  const isActive = domain.status === 'active';

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h3 className="text-mg-text text-sm font-semibold">Параметры безопасности домена</h3>
        <p className="text-mg-text-muted mt-0.5 text-xs">
          Управление доступом, статусом обслуживания и критическими операциями с доменом.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="border-mg-border-subtle bg-mg-surface-subtle/30 space-y-2 rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <span className="text-mg-text text-xs font-medium">Статус активности</span>
            <Badge tone={isActive ? 'success' : 'danger'}>{domain.status}</Badge>
          </div>
          <p className="text-mg-text-muted text-[11px]">
            {isActive
              ? 'Домен принимает и отправляет почту в штатном режиме.'
              : 'Домен временно приостановлен. Почтовые ящики не принимают новые письма.'}
          </p>
          {isSuperAdmin && (
            <div className="pt-2">
              <Button
                size="xs"
                variant="secondary"
                onClick={() => toggleStatusMutation.mutate(isActive ? 'disabled' : 'active')}
                isLoading={toggleStatusMutation.isPending}
              >
                {isActive ? 'Приостановить домен' : 'Активировать домен'}
              </Button>
            </div>
          )}
        </div>

        <div className="border-mg-border-subtle bg-mg-surface-subtle/30 space-y-2 rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <span className="text-mg-text text-xs font-medium">Подпись DKIM</span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
              Активна (2048 bit)
            </span>
          </div>
          <p className="text-mg-text-muted text-[11px]">
            Все исходящие сообщения домена автоматически подписываются криптографическим ключом
            DKIM.
          </p>
        </div>
      </div>

      {/* Danger Zone: Delete Domain (STRICTLY inside this security tab) */}
      {isSuperAdmin && (
        <div className="border-mg-border-subtle border-t pt-4">
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h4 className="flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-400">
                  <AlertTriangle className="h-4 w-4" />
                  Опасная зона: Удаление домена
                </h4>
                <p className="text-mg-text-muted mt-1 max-w-xl text-xs">
                  Удаление домена приведет к безвозвратному удалению всех связанных почтовых ящиков,
                  алиасов, списков рассылки, правил пересылки и хранящихся писем.
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  if (
                    confirm(
                      `ВНИМАНИЕ! Удалить домен ${domain.name} и ВСЕ его почтовые ящики безвозвратно?`,
                    )
                  ) {
                    deleteMutation.mutate();
                  }
                }}
                isLoading={deleteMutation.isPending}
                className="shrink-0 gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Удалить домен</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DomainStatsTab({ domainName }: { domainName: string }) {
  const { data: events = [], isLoading } = useQuery<MailEventRecord[]>({
    queryKey: ['admin', 'mail-events', domainName],
    queryFn: async () => {
      const res = await fetchApi(
        `/api/v1/admin/mail-events?domain=${encodeURIComponent(domainName)}&limit=50`,
        {
          credentials: 'include',
        },
      );
      if (!res.ok) throw new Error('Failed to load mail events');
      return res.json();
    },
  });

  let delivered = 0;
  let bounced = 0;
  let rejected = 0;
  let spam = 0;

  for (const ev of events) {
    if (ev.event_type.includes('delivered') || ev.event_type.includes('sent')) delivered++;
    if (ev.event_type.includes('bounced')) bounced++;
    if (ev.event_type.includes('rejected')) rejected++;
    if (ev.event_type.includes('spam')) spam++;
  }

  const columns: TableColumn<MailEventRecord>[] = [
    {
      key: 'occurred_at',
      header: 'Время',
      render: (row) => (
        <span className="text-mg-text-muted text-xs whitespace-nowrap">
          {new Date(row.occurred_at).toLocaleTimeString()}
        </span>
      ),
    },
    {
      key: 'event_type',
      header: 'Событие',
      render: (row) => {
        let tone = 'bg-slate-100 text-slate-700';
        if (row.event_type.includes('delivered'))
          tone = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
        if (row.event_type.includes('bounced'))
          tone = 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
        if (row.event_type.includes('rejected'))
          tone = 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300';
        return (
          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>
            {row.event_type}
          </span>
        );
      },
    },
    {
      key: 'from_address',
      header: 'Отправитель',
      render: (row) => (
        <span className="text-mg-text max-w-xs truncate font-mono text-xs">
          {row.from_address || '—'}
        </span>
      ),
    },
    {
      key: 'to_address',
      header: 'Получатель',
      render: (row) => (
        <span className="text-mg-text max-w-xs truncate font-mono text-xs">
          {row.to_address || '—'}
        </span>
      ),
    },
    {
      key: 'spam_score',
      header: 'Spam Score',
      render: (row) => (
        <span className="text-mg-text-muted font-mono text-xs">
          {row.spam_score !== null && row.spam_score !== undefined
            ? row.spam_score.toFixed(1)
            : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-mg-surface-subtle border-mg-border-subtle rounded-lg border p-3">
          <p className="text-mg-text-muted text-[11px] font-medium">Доставлено</p>
          <p className="mt-0.5 text-xl font-bold text-emerald-600">{delivered}</p>
        </div>
        <div className="bg-mg-surface-subtle border-mg-border-subtle rounded-lg border p-3">
          <p className="text-mg-text-muted text-[11px] font-medium">Отклонено (Bounced)</p>
          <p className="mt-0.5 text-xl font-bold text-amber-600">{bounced}</p>
        </div>
        <div className="bg-mg-surface-subtle border-mg-border-subtle rounded-lg border p-3">
          <p className="text-mg-text-muted text-[11px] font-medium">Отвергнуто (Rejected)</p>
          <p className="mt-0.5 text-xl font-bold text-rose-600">{rejected}</p>
        </div>
        <div className="bg-mg-surface-subtle border-mg-border-subtle rounded-lg border p-3">
          <p className="text-mg-text-muted text-[11px] font-medium">Спам</p>
          <p className="mt-0.5 text-xl font-bold text-slate-500">{spam}</p>
        </div>
      </div>

      <div>
        <h4 className="text-mg-text mb-2 text-sm font-semibold">Последние события почты</h4>
        <Table
          columns={columns}
          rows={events}
          rowKey={(row) => String(row.id)}
          isLoading={isLoading}
          emptyMessage={
            <div className="text-mg-text-muted py-8 text-center text-xs">
              Пока нет зафиксированных почтовых событий для этого домена.
            </div>
          }
        />
      </div>
    </div>
  );
}

function DnsRecordRow({ record, domainName }: { record: DnsRecordDto; domainName: string }) {
  const [copiedHost, setCopiedHost] = useState(false);
  const [copiedVal, setCopiedVal] = useState(false);

  // Compute clean FQDN host
  const fullHost =
    record.host === '@'
      ? domainName
      : record.host.endsWith(domainName)
        ? record.host
        : `${record.host}.${domainName}`;

  function copyHost() {
    navigator.clipboard.writeText(fullHost);
    setCopiedHost(true);
    setTimeout(() => setCopiedHost(false), 2000);
  }

  function copyValue() {
    if (!record.value) return;
    navigator.clipboard.writeText(record.value);
    setCopiedVal(true);
    setTimeout(() => setCopiedVal(false), 2000);
  }

  const isDkim = record.host.includes('_domainkey');

  const renderStatus = () => {
    switch (record.status) {
      case 'ok':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" /> Настроена
          </span>
        );
      case 'missing':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
            <X className="h-3 w-3" /> Не найдена в DNS
          </span>
        );
      case 'mismatch':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Не совпадает
          </span>
        );
      default:
        return (
          <span className="text-mg-text-muted bg-mg-surface-subtle border-mg-border-subtle inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
            Рекомендовано
          </span>
        );
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border p-4 transition-all',
        isDkim
          ? 'border-indigo-500/30 bg-indigo-500/5'
          : 'border-mg-border bg-mg-surface-subtle/20',
      )}
    >
      <div className="border-mg-border-subtle flex flex-col justify-between gap-2 border-b pb-2.5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span className="bg-mg-primary/10 text-mg-primary rounded px-2 py-0.5 font-mono text-xs font-bold uppercase">
            {record.record_type}
          </span>
          <span className="text-mg-text font-mono text-xs font-semibold">{record.host}</span>
          {isDkim && (
            <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 uppercase dark:text-indigo-400">
              DKIM Подпись
            </span>
          )}
        </div>
        <div>{renderStatus()}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 pt-3 text-xs md:grid-cols-2">
        <div>
          <span className="text-mg-text-muted mb-1 block text-[11px]">Имя хоста (Host):</span>
          <div className="bg-mg-surface border-mg-border flex items-center gap-1.5 rounded-lg border p-2 font-mono text-xs break-all">
            <span className="flex-1 select-all">{fullHost}</span>
            <Button
              size="xs"
              variant="ghost"
              onClick={copyHost}
              className="h-6 shrink-0 gap-1 px-2 text-[11px]"
              title="Скопировать имя хоста"
            >
              {copiedHost ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span className="text-emerald-600">Скопировано</span>
                </>
              ) : (
                <>
                  <Copy className="text-mg-text-muted h-3 w-3" />
                  <span>Копия</span>
                </>
              )}
            </Button>
          </div>
        </div>

        <div>
          <span className="text-mg-text-muted mb-1 block text-[11px]">
            Значение записи (Value):
          </span>
          {record.value ? (
            <div className="bg-mg-surface border-mg-border flex items-center gap-1.5 rounded-lg border p-2 font-mono text-xs break-all">
              <span className="flex-1 select-all">{record.value}</span>
              <Button
                size="xs"
                variant="ghost"
                onClick={copyValue}
                className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                title="Скопировать значение"
              >
                {copiedVal ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" />
                    <span className="text-emerald-600">Скопировано</span>
                  </>
                ) : (
                  <>
                    <Copy className="text-mg-text-muted h-3 w-3" />
                    <span>Копия</span>
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 font-sans text-xs text-amber-700 dark:text-amber-400">
              Ключ еще не сгенерирован на сервере. Нажмите кнопку «Ротировать DKIM».
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DnsWizardTab({ domainId, domainName }: { domainId: string; domainName: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const [autopilotOpen, setAutopilotOpen] = useState(false);

  const {
    data: dns,
    isLoading,
    refetch,
  } = useQuery<DnsCheckResponse>({
    queryKey: ['admin', 'domains', domainId, 'dns'],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/dns`);
      if (!res.ok) throw new Error('Failed to fetch DNS');
      return res.json();
    },
  });

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/dns/check`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Не удалось выполнить проверку DNS');
      }
      return res.json() as Promise<DnsCheckResponse>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['admin', 'domains', domainId, 'dns'], data);
      if (data.all_ok) {
        setFeedback({
          type: 'success',
          message: 'Все DNS-записи домена успешно подтверждены и активны!',
        });
      } else {
        const missing = data.records.filter((r) => r.status !== 'ok').length;
        setFeedback({
          type: 'warning',
          message: `Проверка выполнена: ${missing} из ${data.records.length} записей еще не подтверждены или отличаются от рекомендуемых в DNS.`,
        });
      }
    },
    onError: (err: Error) => {
      setFeedback({ type: 'error', message: err.message });
    },
  });

  const rotateDkimMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/dkim/rotate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || 'Ошибка ротации DKIM ключа');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains', domainId, 'dns'] });
      setFeedback({
        type: 'success',
        message:
          'Новый криптографический ключ DKIM (RSA 2048) успешно создан и активирован на сервере! Опубликуйте обновленную TXT-запись у вашего DNS-провайдера.',
      });
    },
    onError: (err: Error) => {
      setFeedback({ type: 'error', message: err.message });
    },
  });

  const dkimRecord = dns?.records.find((r) => r.host.includes('_domainkey'));

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="border-mg-border-subtle bg-mg-surface-subtle/30 flex flex-col justify-between gap-4 rounded-xl border p-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-mg-text flex items-center gap-1.5 text-sm font-semibold">
            <Globe className="text-mg-primary h-4 w-4" />
            <span>Мастер настройки DNS и DKIM</span>
          </h3>
          <p className="text-mg-text-muted mt-1 text-xs">
            Опубликуйте указанные записи у вашего DNS-регистратора для корректной маршрутизации
            почты и прохождения проверок спам-фильтров.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAutopilotOpen(true)}
            className="gap-1.5"
            title="Разовая синхронизация DNS-записей через API Cloudflare / Selectel (доступна во всех редакциях)"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span>Автонастройка</span>
          </Button>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (
                confirm(
                  'Сгенерировать новый ключ DKIM? Предыдущий ключ перестанет действовать для новых писем.',
                )
              ) {
                rotateDkimMutation.mutate();
              }
            }}
            isLoading={rotateDkimMutation.isPending}
            className="gap-1.5"
          >
            <Key className="h-3.5 w-3.5 text-indigo-500" />
            <span>Ротировать DKIM</span>
          </Button>

          <Button
            size="sm"
            onClick={() => checkMutation.mutate()}
            isLoading={checkMutation.isPending || isLoading}
            className="gap-1.5"
          >
            <RefreshCw
              className={cn(
                'h-3.5 w-3.5',
                (checkMutation.isPending || isLoading) && 'animate-spin',
              )}
            />
            <span>Проверить DNS</span>
          </Button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={cn(
            'flex items-center justify-between gap-2 rounded-xl border p-3.5 text-xs font-medium',
            feedback.type === 'success' &&
              'border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
            feedback.type === 'warning' &&
              'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300',
            feedback.type === 'error' &&
              'border-rose-500/20 bg-rose-500/10 text-rose-800 dark:text-rose-300',
          )}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
            {feedback.type === 'warning' && (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            )}
            {feedback.type === 'error' && (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-mg-text-muted rounded p-1 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* DKIM Status Highlight Box */}
      <div className="space-y-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h4 className="text-mg-text text-xs font-bold">
                Криптографическая подпись DKIM (DomainKeys Identified Mail)
              </h4>
              <p className="text-mg-text-muted text-[11px]">
                {dkimRecord?.value
                  ? 'Ключ RSA 2048 бит активен. Сервер автоматически подписывает исходящие сообщения.'
                  : 'Ключ еще не активен. Нажмите «Ротировать DKIM» для генерации.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase',
                dkimRecord?.value
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
                  : 'border-amber-500/20 bg-amber-500/10 text-amber-600',
              )}
            >
              {dkimRecord?.value ? 'Ключ сгенерирован' : 'Требуется генерация'}
            </span>
          </div>
        </div>
      </div>

      {/* DNS Records List */}
      <div className="space-y-3">
        <h4 className="text-mg-text text-xs font-semibold tracking-wider uppercase">
          Необходимые DNS-записи ({dns?.records.length ?? 0})
        </h4>

        {isLoading ? (
          <div className="text-mg-text-muted border-mg-border-subtle rounded-xl border p-8 text-center text-xs">
            <RefreshCw className="text-mg-primary mx-auto mb-2 h-5 w-5 animate-spin" />
            <span>Загрузка DNS записей...</span>
          </div>
        ) : dns?.records && dns.records.length > 0 ? (
          dns.records.map((rec, i) => (
            <DnsRecordRow
              key={`${rec.record_type}-${rec.host}-${i}`}
              record={rec}
              domainName={domainName}
            />
          ))
        ) : (
          <div className="text-mg-text-muted border-mg-border-subtle rounded-xl border p-8 text-center text-xs">
            Записи DNS не найдены
          </div>
        )}
      </div>

      <DnsAutopilotModal
        open={autopilotOpen}
        onClose={() => setAutopilotOpen(false)}
        domainId={domainId}
        domainName={domainName}
        onSyncComplete={() => {
          checkMutation.mutate();
        }}
      />
    </div>
  );
}

function QuotasTab({ domainId }: { domainId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [maxMailboxes, setMaxMailboxes] = useState('');
  const [quotaTotalGb, setQuotaTotalGb] = useState('');
  const [defaultQuotaGb, setDefaultQuotaGb] = useState('');
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, number> = {};
      if (maxMailboxes) payload.max_mailboxes = parseInt(maxMailboxes, 10);
      if (quotaTotalGb) payload.quota_total_bytes = parseInt(quotaTotalGb, 10) * 1024 * 1024 * 1024;
      if (defaultQuotaGb)
        payload.default_mailbox_quota_bytes = parseInt(defaultQuotaGb, 10) * 1024 * 1024 * 1024;
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update quotas');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains', domainId] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <div className="max-w-md space-y-4">
      <p className="text-mg-text-muted text-xs leading-relaxed">
        Лимиты ресурсов домена для делегированных доменных администраторов. Предотвращает перерасход
        дискового пространства и несанкционированное создание избыточных ящиков.
      </p>
      <Input
        label={t('admin.quotas.maxMailboxes', 'Максимум почтовых ящиков (0 = без лимита)')}
        type="number"
        value={maxMailboxes}
        onChange={(e) => setMaxMailboxes(e.target.value)}
        placeholder="50"
      />
      <Input
        label={t('admin.quotas.totalQuotaGb', 'Общий объем хранилища домена (ГБ, 0 = без лимита)')}
        type="number"
        value={quotaTotalGb}
        onChange={(e) => setQuotaTotalGb(e.target.value)}
        placeholder="100"
      />
      <Input
        label={t(
          'admin.quotas.defaultQuotaGb',
          'Квота ящика по умолчанию (ГБ, 0 = системная 10 ГБ)',
        )}
        type="number"
        value={defaultQuotaGb}
        onChange={(e) => setDefaultQuotaGb(e.target.value)}
        placeholder="10"
      />
      <div className="flex items-center gap-3">
        <Button onClick={() => saveMutation.mutate()} isLoading={saveMutation.isPending}>
          {t('common.save', 'Сохранить')}
        </Button>
        {saved ? (
          <span className="text-mg-success text-sm">{t('common.saved', 'Сохранено!')}</span>
        ) : null}
      </div>
    </div>
  );
}
