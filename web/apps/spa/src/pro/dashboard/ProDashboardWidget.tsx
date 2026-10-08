import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@mgate/ui';

/**
 * Dashboard widget contributed to the admin grid (`ExtensionModule.dashboardWidgets`; the shell wraps this in its own `<Card title=...>`, see
 * `apps/spa/src/pages/admin/DashboardPage.tsx`). Teases `pro.advanced_dashboard` — a backlog
 * feature (`../features.ts`) — with a link to the full Pro overview page.
 */
export function ProDashboardWidget() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-mg-text-muted text-sm">{t('proUi.dashboard.teaser')}</p>
      <Link to="/admin/pro/advanced-dashboard">
        <Badge tone="primary">{t('proUi.dashboard.cta')}</Badge>
      </Link>
    </div>
  );
}
