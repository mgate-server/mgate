import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Palette, Sparkles, ArrowRight, ShieldCheck } from 'lucide-react';
import { Card, Button } from '@mgate/ui';
import { fetchApi } from '../../lib/apiClient';

interface BrandingConfig {
  product_name: string;
  company_name?: string | null;
  logo_url?: string | null;
  accent_color?: string | null;
}

/**
 * Settings sub-panel contributed under `/admin/settings` (`ExtensionModule.settingsPanels`). Provides direct access to Pro customizations:
 * White-Label branding, DNS Autopilot, and Backup Center (the latter is still in development).
 */
export function ProSettingsPanel() {
  const { t } = useTranslation();

  const { data: branding } = useQuery<BrandingConfig>({
    queryKey: ['pro', 'branding'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/pro/branding');
      if (!res.ok) return { product_name: 'MGate' };
      return res.json();
    },
  });

  return (
    <Card
      title={
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span>{t('proUi.settings.title', 'Pro-конфигурация платформы')}</span>
          </span>
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-amber-600 uppercase dark:text-amber-400">
            PRO
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        {/* White Label Branding Summary */}
        <div className="border-mg-border-subtle bg-mg-surface-subtle/30 flex flex-col justify-between gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Palette className="text-mg-primary h-4 w-4" />
              <span className="text-mg-text text-xs font-semibold">
                {t('admin.settings.brandingTitle', 'White-Label брендинг платформы')}
              </span>
            </div>
            <p className="text-mg-text-muted mt-1 text-xs">
              Название:{' '}
              <span className="text-mg-text font-semibold">
                {branding?.product_name || 'MGate'}
              </span>
              {branding?.company_name ? ` • Компания: ${branding.company_name}` : ''}
            </p>
          </div>
          <Link to="/admin/pro/branding" className="shrink-0">
            <Button size="sm" variant="secondary" className="gap-1.5 text-xs">
              <Palette className="text-mg-primary h-3.5 w-3.5" />
              <span>Настроить White-Label</span>
              <ArrowRight className="text-mg-text-muted h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>

        {/* Quick Links to DNS Autopilot and Backup Center */}
        <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
          <Link
            to="/admin/pro/dns-autopilot"
            className="border-mg-border-subtle bg-mg-surface group flex items-center justify-between rounded-lg border p-3 transition-colors hover:border-amber-500/40"
          >
            <div className="flex items-center gap-2.5">
              <div className="rounded-md bg-amber-500/10 p-1.5 text-amber-500 transition-colors group-hover:bg-amber-500/20">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <span className="text-mg-text block text-xs font-semibold">DNS-Автопилот</span>
                <span className="text-mg-text-muted text-[11px]">
                  Фоновая сверка — в разработке
                </span>
              </div>
            </div>
            <ArrowRight className="text-mg-text-muted group-hover:text-mg-text h-3.5 w-3.5 transition-colors" />
          </Link>

          <Link
            to="/admin/pro/backup-center"
            className="border-mg-border-subtle hover:border-mg-primary/40 bg-mg-surface group flex items-center justify-between rounded-lg border p-3 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="bg-mg-primary/10 text-mg-primary group-hover:bg-mg-primary/20 rounded-md p-1.5 transition-colors">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <span className="text-mg-text block text-xs font-semibold">Центр бэкапов</span>
                <span className="text-mg-text-muted text-[11px]">В разработке</span>
              </div>
            </div>
            <ArrowRight className="text-mg-text-muted group-hover:text-mg-text h-3.5 w-3.5 transition-colors" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
