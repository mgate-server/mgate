import type { DashboardWidget } from '@mgate/extensions';
import { ProDashboardWidget } from './ProDashboardWidget';

export const proDashboardWidgets: DashboardWidget[] = [
  {
    id: 'pro-advanced-dashboard-teaser',
    titleKey: 'proUi.features.advancedDashboard.title',
    Component: ProDashboardWidget,
    span: 12,
    order: 200,
  },
];
