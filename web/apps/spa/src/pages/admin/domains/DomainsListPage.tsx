import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Globe,
  Plus,
  Search,
  Mail,
  ShieldCheck,
  Star,
  ExternalLink,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { Button, Card, Input, Modal, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import { apiClient, fetchApi } from '../../../lib/apiClient';
import { useAuth } from '../../../auth/AuthContext';
import { useEntitlements } from '../../../lib/entitlements';
import { getRuntimeLinks } from '../../../lib/runtimeConfig';
import { DnsAutopilotModal } from './DnsAutopilotModal';

interface DomainRow {
  id: string;
  name: string;
  is_primary: boolean;
  mailbox_count: number;
  status: string;
}

const newDomainSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, 'expected a valid FQDN'),
});

/** Domains management */
export function DomainsListPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SuperAdmin';
  const { data: entitlements } = useEntitlements();

  const [modalOpen, setModalOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const { pricingUrl, vendorPortalUrl } = getRuntimeLinks();
  const [autopilotDomain, setAutopilotDomain] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'domains'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/admin/domains');
      if (error) throw error;
      return data;
    },
  });

  const isCommunityLimited =
    entitlements?.edition === 'community' &&
    (data?.items?.length ?? 0) >= (entitlements?.max_domains ?? 1);

  function handleOpenCreate() {
    if (isCommunityLimited) {
      setUpgradeModalOpen(true);
      return;
    }
    setModalOpen(true);
  }

  const createMutation = useMutation({
    mutationFn: async (domainName: string) => {
      const res = await fetchApi('/api/v1/admin/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: domainName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 402 || body?.error?.code === 'edition_limit') {
          setModalOpen(false);
          setUpgradeModalOpen(true);
          return null;
        }
        throw new Error(body?.error?.message || 'Failed to create domain');
      }
      return res.json();
    },
    onSuccess: (res) => {
      if (!res) return;
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      setModalOpen(false);
      setName('');
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  function handleCreate() {
    const parsed = newDomainSchema.safeParse({ name });
    if (!parsed.success) {
      setError(t('admin.domains.invalidName', 'Введите корректное доменное имя (например, example.com)'));
      return;
    }
    setError(null);
    createMutation.mutate(name.toLowerCase());
  }

  const domains: DomainRow[] = (data?.items ?? []).filter((d: DomainRow) =>
    searchQuery ? d.name.toLowerCase().includes(searchQuery.toLowerCase()) : true,
  );

  const columns: TableColumn<DomainRow>[] = [
    {
      key: 'name',
      header: t('admin.domains.domain', 'Домен'),
      render: (row) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-mg-surface-subtle border border-mg-border-subtle flex items-center justify-center text-mg-text-muted">
            <Globe className="w-4 h-4 text-mg-primary" />
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/admin/domains/${row.id}`}
              className="text-sm font-semibold text-mg-text hover:text-mg-primary transition-colors inline-flex items-center gap-1.5"
            >
              <span>{row.name}</span>
              <ExternalLink className="w-3 h-3 text-mg-text-muted" />
            </Link>
            {row.is_primary && (
              <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-500/20">
                <Star className="w-2.5 h-2.5 fill-current" />
                Основной
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'mailboxes',
      header: t('admin.domains.mailboxes', 'Почтовые ящики'),
      render: (row) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-mg-text">
          <Mail className="w-3.5 h-3.5 text-mg-text-muted" />
          <span className="font-semibold">{row.mailbox_count}</span>
          <span className="text-mg-text-muted">ящиков</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: t('common.status', 'Статус'),
      render: (row) => {
        const isActive = row.status === 'active';
        return (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
              isActive
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-rose-500'}`}
            />
            {row.status}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: t('common.actions', 'Действия'),
      render: (row) => (
        <div className="flex items-center gap-2 justify-end">
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5 text-xs py-1 px-2.5 h-7 shadow-xs"
            onClick={() => setAutopilotDomain({ id: row.id, name: row.name })}
            title="Автоматическая настройка DNS через Cloudflare или Selectel"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>DNS-Автопилот</span>
          </Button>
          <Link
            to={`/admin/domains/${row.id}`}
            className="text-xs font-medium text-mg-text-muted hover:text-mg-primary transition-colors px-2 py-1"
          >
            Настройки →
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-mg-border-subtle">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-mg-primary/10 text-mg-primary">
            <Globe className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-mg-text tracking-tight">
              {t('nav.admin.domains', 'Почтовые домены')}
            </h1>
            <p className="text-xs text-mg-text-muted">
              Управление доменами, DNS-записями (MX, SPF, DKIM, DMARC) и сертификатами
            </p>
          </div>
        </div>

        {isSuperAdmin && (
          <Button onClick={handleOpenCreate} className="gap-1.5 shadow-sm">
            <Plus className="w-4 h-4" />
            <span>{t('common.create', 'Добавить домен')}</span>
          </Button>
        )}
      </div>

      {/* Main Table Card */}
      <Card className="p-0 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-mg-border-subtle bg-mg-surface-subtle/30 flex items-center justify-between gap-4">
          <div className="relative max-w-xs w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mg-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Поиск по домену..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-mg-surface border border-mg-border rounded-lg text-mg-text placeholder:text-mg-text-muted focus:outline-none focus:border-mg-primary focus:ring-1 focus:ring-mg-primary"
            />
          </div>
          <span className="text-xs text-mg-text-muted">
            Всего: {domains.length} {domains.length === 1 ? 'домен' : 'доменов'}
          </span>
        </div>

        <Table
          columns={columns}
          rows={domains}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <Globe className="w-8 h-8 text-mg-text-muted mb-2" />
              <p className="text-sm font-medium text-mg-text">
                {searchQuery ? 'Домены не найдены' : t('admin.domains.empty', 'Список доменов пуст')}
              </p>
              <p className="text-xs text-mg-text-muted mt-1 max-w-xs">
                Подключите ваш первый почтовый домен для создания почтовых ящиков.
              </p>
              {isSuperAdmin && (
                <Button size="sm" onClick={handleOpenCreate} className="mt-4 gap-1.5">
                  <Plus className="w-4 h-4" />
                  <span>Добавить домен</span>
                </Button>
              )}
            </div>
          }
        />
      </Card>

      {/* Create Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('admin.domains.addTitle', 'Добавить почтовый домен')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              {t('common.cancel', 'Отмена')}
            </Button>
            <Button onClick={handleCreate} isLoading={createMutation.isPending}>
              {t('common.create', 'Создать')}
            </Button>
          </>
        }
      >
        <div className="space-y-4 pt-2">
          <Input
            label="FQDN (Доменное имя)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="example.com"
            error={error ?? undefined}
            autoFocus
          />
          <div className="p-3 rounded-lg bg-mg-surface-subtle border border-mg-border-subtle flex items-start gap-2.5 text-xs text-mg-text-muted">
            <ShieldCheck className="w-4 h-4 text-mg-primary shrink-0 mt-0.5" />
            <span>
              {t(
                'admin.domains.createHint',
                'После добавления домена в панели будет автоматически сгенерирован DKIM-ключ и предоставлены параметры для настройки DNS (MX, SPF, DKIM, DMARC).',
              )}
            </span>
          </div>
        </div>
      </Modal>

      {/* Pro Edition Limit Modal */}
      <Modal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        title="Лимит редакции Community исчерпан"
        footer={
          <div className="flex items-center justify-between w-full">
            <Link to="/admin/license" className="text-xs text-mg-primary hover:underline font-medium">
              Ввести код активации →
            </Link>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setUpgradeModalOpen(false)}>
                Закрыть
              </Button>
              {pricingUrl && (
                <Button
                  variant="primary"
                  onClick={() => window.open(pricingUrl, '_blank', 'noopener,noreferrer')}
                  className="gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Купить MGate Pro</span>
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-3 pt-2">
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-mg-text text-xs space-y-2">
            <p className="font-semibold text-sm text-amber-700 dark:text-amber-300">
              Внимание: лимит 1 домен в бесплатной версии
            </p>
            <p className="text-mg-text-muted leading-relaxed">
              Бесплатная редакция MGate Community поддерживает работу с 1 почтовым доменом. 
              Чтобы подключить неограниченное количество доменов, кластеризацию, аудит-логи и расширенную защиту, перейдите на MGate Pro.
            </p>
          </div>
          {vendorPortalUrl && (
            <div className="p-3 rounded-lg bg-mg-surface-subtle border border-mg-border-subtle text-xs text-mg-text-muted flex items-center justify-between">
              <span>Управление лицензией:</span>
              <a href={vendorPortalUrl} target="_blank" rel="noreferrer" className="text-mg-primary font-medium hover:underline">
                Портал вендора ↗
              </a>
            </div>
          )}
        </div>
      </Modal>

      {/* DNS Autopilot Modal */}
      {autopilotDomain && (
        <DnsAutopilotModal
          open={!!autopilotDomain}
          onClose={() => setAutopilotDomain(null)}
          domainId={autopilotDomain.id}
          domainName={autopilotDomain.name}
          onSyncComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
          }}
        />
      )}
    </div>
  );
}
