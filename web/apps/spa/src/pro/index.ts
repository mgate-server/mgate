/**
 * The Pro pages of the public SPA: there is exactly ONE SPA build — these pages are always
 * compiled in and always registered by `lib/extensions.ts`; what an admin actually sees behind
 * `<ProFeature>` is decided at runtime by `GET /api/v1/system/entitlements`
 * (`lib/entitlements.ts`). This UI gate is cosmetic: real enforcement lives only in the closed
 * backend, which refuses the underlying API calls regardless of what the SPA renders.
 */
import type { ExtensionModule } from '@mgate/extensions';
import { proDashboardWidgets } from './dashboard';
import { proNavItems } from './nav';
import { proRoutes } from './routes';
import { proSettingsPanels } from './settings';

export const proExtensionModule: ExtensionModule = {
  id: 'pro',
  routes: proRoutes,
  navItems: proNavItems,
  settingsPanels: proSettingsPanels,
  dashboardWidgets: proDashboardWidgets,
};
