import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Paintbrush,
  Sparkles,
  Save,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Eye,
  RotateCcw,
  Palette,
  Sliders,
  Lock,
} from 'lucide-react';
import { Badge, Button, Card, Input, Modal, PageHeader, Tabs, cn } from '@mgate/ui';
import type { TabItem } from '@mgate/ui';
import { useEntitlements } from '../../lib/entitlements';
import { fetchApi } from '../../lib/apiClient';
import { readApiError } from '../../lib/apiError';
import { getRuntimeLinks } from '../../lib/runtimeConfig';
import { UpdatesTab } from './UpdatesTab';

interface GlobalSettings {
  server_name?: string;
  max_message_size_mb?: number;
  default_mailbox_quota_gb?: number;
  enforce_tls?: boolean;
  greylisting_enabled?: boolean;
  spam_reject_score?: number;
}

interface BrandingConfig {
  product_name: string;
  company_name?: string | null;
  logo_url?: string | null;
  favicon_url?: string | null;
  accent_color?: string | null;
  support_url?: string | null;
  custom_footer_text?: string | null;
}

const PRESET_COLORS = [
  { name: 'Синий (По умолчанию)', hex: '#3b82f6' },
  { name: 'Изумрудный', hex: '#10b981' },
  { name: 'Индиго', hex: '#6366f1' },
  { name: 'Фиолетовый', hex: '#8b5cf6' },
  { name: 'Янтарный', hex: '#f59e0b' },
  { name: 'Алый', hex: '#ef4444' },
];

export function AdminSettingsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab =
    requestedTab === 'white-label' || requestedTab === 'updates' ? requestedTab : 'general';

  const { data: settings, isLoading } = useQuery<GlobalSettings>({
    queryKey: ['admin', 'settings'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/settings', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load settings');
      return res.json();
    },
  });

  const tabs: TabItem[] = [
    { value: 'general', label: t('admin.settings.tabs.general', 'Основные параметры') },
    { value: 'white-label', label: t('admin.settings.tabs.branding', 'White-Label') },
    { value: 'updates', label: t('updates.title') },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title={t('nav.admin.settings', 'Настройки сервера')} />

      <div className="border-mg-border-subtle border-b pb-1">
        <Tabs items={tabs} value={activeTab} onChange={(val) => setSearchParams({ tab: val })} />
      </div>

      {activeTab === 'general' && (
        <Card
          title={t('admin.settings.generalTitle', 'Общие параметры почтового сервера')}
          className="max-w-2xl"
        >
          {isLoading ? (
            <p className="text-mg-text-muted py-4 text-sm">
              {t('common.loading', 'Загрузка настроек...')}
            </p>
          ) : (
            <AdminSettingsForm initialSettings={settings ?? {}} />
          )}
        </Card>
      )}

      {activeTab === 'white-label' && <WhiteLabelSettingsTab />}
      {activeTab === 'updates' && <UpdatesTab />}
    </div>
  );
}

function AdminSettingsForm({ initialSettings }: { initialSettings: GlobalSettings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [serverName, setServerName] = useState(initialSettings.server_name ?? 'MGate Mail Server');
  const [maxMsgMb, setMaxMsgMb] = useState(String(initialSettings.max_message_size_mb ?? 25));
  const [defaultQuotaGb, setDefaultQuotaGb] = useState(
    String(initialSettings.default_mailbox_quota_gb ?? 10),
  );
  const [enforceTls, setEnforceTls] = useState(initialSettings.enforce_tls ?? true);
  const [greylisting, setGreylisting] = useState(initialSettings.greylisting_enabled ?? true);
  const [spamScore, setSpamScore] = useState(String(initialSettings.spam_reject_score ?? 15));
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        key: 'global',
        value: {
          server_name: serverName,
          max_message_size_mb: parseInt(maxMsgMb, 10),
          default_mailbox_quota_gb: parseInt(defaultQuotaGb, 10),
          enforce_tls: enforceTls,
          greylisting_enabled: greylisting,
          spam_reject_score: parseInt(spamScore, 10),
        },
      };

      const res = await fetchApi('/api/v1/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(await readApiError(res, 'Failed to save settings'));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <div className="space-y-4">
      <Input
        label={t('admin.settings.serverName', 'Название сервера')}
        value={serverName}
        onChange={(e) => setServerName(e.target.value)}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label={t('admin.settings.maxMessageSize', 'Максимальный размер письма (МБ)')}
          type="number"
          value={maxMsgMb}
          onChange={(e) => setMaxMsgMb(e.target.value)}
        />
        <Input
          label={t('admin.settings.defaultQuota', 'Квота ящика по умолчанию (ГБ)')}
          type="number"
          value={defaultQuotaGb}
          onChange={(e) => setDefaultQuotaGb(e.target.value)}
        />
      </div>

      <Input
        label={t('admin.settings.spamScore', 'Порог отклонения спама (Rspamd score)')}
        type="number"
        value={spamScore}
        onChange={(e) => setSpamScore(e.target.value)}
      />

      <div className="border-mg-border space-y-2 border-t pt-4">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={enforceTls}
            onChange={(e) => setEnforceTls(e.target.checked)}
            className="rounded"
          />
          <span className="text-mg-text text-sm">
            {t(
              'admin.settings.enforceTls',
              'Требовать обязательное шифрование TLS (STARTTLS / SSL)',
            )}
          </span>
        </label>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={greylisting}
            onChange={(e) => setGreylisting(e.target.checked)}
            className="rounded"
          />
          <span className="text-mg-text text-sm">
            {t(
              'admin.settings.greylisting',
              'Включить серые списки (Greylisting) для борьбы со спам-ботами',
            )}
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={() => saveMutation.mutate()} isLoading={saveMutation.isPending}>
          {t('common.save', 'Сохранить настройки')}
        </Button>
        {saved ? (
          <span className="text-mg-success text-sm font-medium">
            {t('common.saved', 'Настройки успешно сохранены!')}
          </span>
        ) : null}
        {saveMutation.isError ? (
          <span role="alert" className="text-mg-danger text-sm">
            {(saveMutation.error as Error).message}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function WhiteLabelSettingsTab() {
  const queryClient = useQueryClient();
  const { data: entitlements } = useEntitlements();
  const isPro = entitlements?.edition === 'pro';

  const [productName, setProductName] = useState('MGate');
  const [companyName, setCompanyName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [accentColor, setAccentColor] = useState('#3b82f6');
  const [supportUrl, setSupportUrl] = useState('');
  const [customFooterText, setCustomFooterText] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const { pricingUrl } = getRuntimeLinks();

  const { data: branding } = useQuery<BrandingConfig>({
    queryKey: ['pro', 'branding'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/pro/branding');
      if (!res.ok) return { product_name: 'MGate' };
      return res.json() as Promise<BrandingConfig>;
    },
  });

  // Sync the form with the server copy whenever the query data changes (derived during render
  // rather than in an effect, so there is no extra cascading render).
  const [syncedBranding, setSyncedBranding] = useState<BrandingConfig | undefined>(undefined);
  if (branding !== syncedBranding) {
    setSyncedBranding(branding);
    if (branding) {
      setProductName(branding.product_name || 'MGate');
      setCompanyName(branding.company_name || '');
      setLogoUrl(branding.logo_url || '');
      setFaviconUrl(branding.favicon_url || '');
      setAccentColor(branding.accent_color || '#3b82f6');
      setSupportUrl(branding.support_url || '');
      setCustomFooterText(branding.custom_footer_text || '');
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: BrandingConfig = {
        product_name: productName.trim() || 'MGate',
        company_name: companyName.trim() || null,
        logo_url: logoUrl.trim() || null,
        favicon_url: faviconUrl.trim() || null,
        accent_color: accentColor.trim() || null,
        support_url: supportUrl.trim() || null,
        custom_footer_text: customFooterText.trim() || null,
      };

      const res = await fetchApi('/api/v1/pro/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(await readApiError(res, 'Ошибка сохранения брендинга'));

      return res.json();
    },
    onSuccess: () => {
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3500);
      queryClient.invalidateQueries({ queryKey: ['pro', 'branding'] });
      queryClient.invalidateQueries({ queryKey: ['system', 'branding'] });
    },
  });

  function handleReset() {
    setProductName('MGate');
    setCompanyName('');
    setLogoUrl('');
    setFaviconUrl('');
    setAccentColor('#3b82f6');
    setSupportUrl('');
    setCustomFooterText('');
  }

  function handleSave() {
    if (!isPro) {
      setUpgradeModalOpen(true);
      return;
    }
    saveMutation.mutate();
  }

  return (
    <div className="space-y-6">
      {/* Informational banner if Community (Free) */}
      {!isPro && (
        <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 shadow-xs sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-amber-500/15 p-2.5 text-amber-600 dark:text-amber-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-mg-text text-sm font-semibold">
                  White-Label брендинг — функция MGate Pro
                </span>
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 uppercase dark:text-amber-300">
                  PRO
                </span>
              </div>
              <p className="text-mg-text-muted mt-0.5 text-xs leading-relaxed">
                В бесплатной редакции MGate Community кастомизация не применяется на сервере. Вы
                можете заполнить поля и посмотреть предпросмотр ниже, а для применения перейдите на
                Pro.
              </p>
            </div>
          </div>
          <Link to="/admin/license" className="shrink-0">
            <Button size="sm" variant="primary" className="gap-1.5 text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Активировать Pro</span>
            </Button>
          </Link>
        </div>
      )}

      <p className="text-mg-text-muted text-xs leading-relaxed">
        Сейчас в интерфейсе применяются название продукта и логотип (шапка и заголовок вкладки).
        Фавикон, акцентный цвет, ссылка поддержки и текст футера сохраняются, но пока не
        отображаются — их применение в разработке. Предпросмотр ниже показывает целевой вид.
      </p>

      {savedSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Настройки брендинга успешно сохранены и применены к платформе!</span>
        </div>
      )}

      {saveMutation.isError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3.5 text-xs font-medium text-rose-700 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{(saveMutation.error as Error).message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Form Column */}
        <div className="space-y-6 lg:col-span-7">
          <Card className="space-y-4 p-5 shadow-sm">
            <div className="border-mg-border-subtle flex items-center gap-2 border-b pb-2">
              <Paintbrush className="text-mg-primary h-4 w-4" />
              <h3 className="text-mg-text text-sm font-semibold">Айдентика и названия</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-mg-text mb-1 block text-xs font-medium">
                  Название почтового сервиса (Product Name) *
                </label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="MGate"
                  className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-full rounded-lg border px-3 py-2 text-xs focus:outline-none"
                />
                <p className="text-mg-text-muted mt-1 text-[11px]">
                  Отображается в шапке панели управления, на странице входа и во вкладках браузера.
                </p>
              </div>

              <div>
                <label className="text-mg-text mb-1 block text-xs font-medium">
                  Название компании / организации
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Корпорация Пример"
                  className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-full rounded-lg border px-3 py-2 text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="text-mg-text mb-1 block text-xs font-medium">
                  URL логотипа (SVG или PNG)
                </label>
                <input
                  type="text"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.svg или /custom-logo.svg"
                  className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-full rounded-lg border px-3 py-2 font-mono text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="text-mg-text mb-1 block text-xs font-medium">
                  URL фавикона (.ico, .png, .svg)
                </label>
                <input
                  type="text"
                  value={faviconUrl}
                  onChange={(e) => setFaviconUrl(e.target.value)}
                  placeholder="https://example.com/favicon.ico"
                  className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-full rounded-lg border px-3 py-2 font-mono text-xs focus:outline-none"
                />
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-5 shadow-sm">
            <div className="border-mg-border-subtle flex items-center gap-2 border-b pb-2">
              <Palette className="text-mg-primary h-4 w-4" />
              <h3 className="text-mg-text text-sm font-semibold">Цветовая палитра темы</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-mg-text mb-1 block text-xs font-medium">
                  Основной акцентный цвет (Brand Accent Color)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="border-mg-border h-9 w-9 cursor-pointer rounded-lg border bg-transparent"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    placeholder="#3b82f6"
                    className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-32 rounded-lg border px-3 py-2 font-mono text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-mg-text mb-2 block text-xs font-medium">
                  Быстрый выбор цвета:
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((preset) => (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => setAccentColor(preset.hex)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                        accentColor.toLowerCase() === preset.hex.toLowerCase()
                          ? 'bg-mg-surface-subtle border-white/40 font-semibold text-white'
                          : 'border-mg-border text-mg-text-muted hover:border-mg-border-subtle hover:text-mg-text',
                      )}
                    >
                      <span
                        className="h-3 w-3 rounded-full border border-black/20"
                        style={{ backgroundColor: preset.hex }}
                      />
                      <span>{preset.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-5 shadow-sm">
            <div className="border-mg-border-subtle flex items-center gap-2 border-b pb-2">
              <ExternalLink className="text-mg-primary h-4 w-4" />
              <h3 className="text-mg-text text-sm font-semibold">Поддержка и подвал</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-mg-text mb-1 block text-xs font-medium">
                  URL портала поддержки (Helpdesk URL)
                </label>
                <input
                  type="url"
                  value={supportUrl}
                  onChange={(e) => setSupportUrl(e.target.value)}
                  placeholder="https://help.example.com"
                  className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-full rounded-lg border px-3 py-2 text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="text-mg-text mb-1 block text-xs font-medium">
                  Текст в подвале (Footer copyright)
                </label>
                <input
                  type="text"
                  value={customFooterText}
                  onChange={(e) => setCustomFooterText(e.target.value)}
                  placeholder="© 2026 Моя Компания. Все права защищены."
                  className="bg-mg-surface border-mg-border text-mg-text focus:border-mg-primary w-full rounded-lg border px-3 py-2 text-xs focus:outline-none"
                />
              </div>
            </div>
          </Card>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-2">
            <Button variant="secondary" size="sm" onClick={handleReset} className="gap-1.5">
              <RotateCcw className="h-4 w-4" />
              <span>Сбросить</span>
            </Button>

            <Button
              size="sm"
              onClick={handleSave}
              isLoading={saveMutation.isPending}
              className="gap-1.5"
            >
              {isPro ? (
                <>
                  <Save className="h-4 w-4" />
                  <span>Сохранить настройки White-Label</span>
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 text-amber-300" />
                  <span>Сохранить (доступно в Pro)</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Live Preview Column */}
        <div className="space-y-4 lg:col-span-5">
          <Card className="bg-mg-surface-subtle/30 sticky top-6 p-5 shadow-sm">
            <div className="border-mg-border-subtle mb-4 flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Eye className="text-mg-primary h-4 w-4" />
                <h4 className="text-mg-text text-xs font-semibold tracking-wider uppercase">
                  Живой предпросмотр
                </h4>
              </div>
              <Badge tone="primary" className="text-[10px]">
                Live Preview
              </Badge>
            </div>

            {/* Simulated UI Topbar */}
            <div className="space-y-4">
              <div className="border-mg-border bg-mg-surface overflow-hidden rounded-xl border shadow-sm">
                <div className="border-mg-border bg-mg-surface-subtle/50 flex h-11 items-center justify-between border-b px-3">
                  <div className="flex items-center gap-2">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Logo"
                        className="h-5 max-w-[80px] object-contain"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div
                        className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold text-white"
                        style={{ backgroundColor: accentColor }}
                      >
                        {productName.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span className="text-mg-text text-xs font-semibold">
                      {productName || 'MGate'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-mg-text-muted text-[10px]">Онлайн</span>
                  </div>
                </div>

                {/* Simulated Body Content */}
                <div className="space-y-3 p-4">
                  <div className="space-y-1">
                    <div className="bg-mg-border-subtle h-2 w-24 rounded" />
                    <div className="bg-mg-border-subtle/60 h-1.5 w-40 rounded" />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      className="rounded px-3 py-1.5 text-xs font-medium text-white shadow-xs"
                      style={{ backgroundColor: accentColor }}
                    >
                      Кнопка действия
                    </button>
                    <button
                      type="button"
                      className="bg-mg-surface-subtle border-mg-border text-mg-text rounded border px-3 py-1.5 text-xs font-medium"
                    >
                      Вторичная
                    </button>
                  </div>
                </div>

                {/* Simulated Footer */}
                <div className="bg-mg-surface-subtle/30 border-mg-border text-mg-text-muted flex items-center justify-between border-t px-3 py-2 text-[10px]">
                  <span>{customFooterText || `© 2026 ${productName || 'MGate'}`}</span>
                  {supportUrl && (
                    <span className="text-mg-primary font-medium hover:underline">Поддержка</span>
                  )}
                </div>
              </div>

              <p className="text-mg-text-muted text-[11px] leading-relaxed">
                Настройки применяются ко всей платформе (панель администратора и веб-клиент почты).
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Upgrade modal for Free users */}
      <Modal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        title="White-Label брендинг"
        footer={
          <div className="flex w-full items-center justify-between">
            <Link
              to="/admin/license"
              className="text-mg-primary text-xs font-medium hover:underline"
            >
              Активировать Pro →
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
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Купить MGate Pro</span>
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-3 pt-2">
          <div className="text-mg-text space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              Кастомизация доступна в версии MGate Pro
            </p>
            <p className="text-mg-text-muted leading-relaxed">
              White-Label позволяет заменить название продукта и логотип в интерфейсе MGate.
              Фавикон, акцентный цвет, ссылка поддержки и текст футера можно сохранить уже сейчас,
              но их отображение пока в разработке.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
