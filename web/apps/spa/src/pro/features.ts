/**
 * Pro feature metadata shown by the Pro pages (mirrors the backend's list of feature flags — kept in sync by hand for
 * now; TODO(S4): derive it from the `GET /api/v1/system/entitlements` response or a shared JSON
 * once the admin "Pro features" page needs it to be exact rather than illustrative).
 *
 * `flag` matches the string `GET /api/v1/system/entitlements` returns in `features` when the
 * feature is enabled. It is absent for a capability the backend has no flag for (DMARC extras
 * come with any Pro lease, see `includedWithPro`).
 * `slug` is reused for both the frontend route (`/admin/pro/<slug>`) and the backend stub
 * endpoint (`/api/v1/pro/<slug>`) so the two stay easy to cross-check.
 */
export interface ProFeatureMeta {
  id: string;
  /** Backend feature flag; `undefined` when the capability is part of every Pro lease. */
  flag?: string;
  slug: string;
  titleKey: string;
  descriptionKey: string;
  /**
   * `true` only when the backend really implements the feature. Everything else is a backlog
   * stub: the backend answers `501 not_implemented` and the SPA renders an honest "in
   * development" state instead of data or an upsell.
   */
  implemented?: boolean;
  /** `true` when no separate flag exists: the capability is granted by any Pro lease. */
  includedWithPro?: boolean;
  /** Where an implemented feature lives in the SPA (shown by the Pro overview). */
  href?: string;
}

export const PRO_FEATURES: ProFeatureMeta[] = [
  {
    id: 'dns-autopilot',
    flag: 'pro.dns_autopilot',
    slug: 'dns-autopilot',
    titleKey: 'proUi.features.dnsAutopilot.title',
    descriptionKey: 'proUi.features.dnsAutopilot.description',
    // The Pro part (scheduled background reconciliation) is a backlog item: the backend answers
    // 501 for `/api/v1/pro/dns-autopilot`. The one-off sync button in the domain DNS wizard is
    // available in every edition and is not a Pro feature.
  },
  {
    id: 'dmarc-intelligence',
    // No `pro.dmarc_intelligence` flag exists in the backend: full DMARC source data comes with
    // any Pro lease.
    includedWithPro: true,
    slug: 'dmarc-intelligence',
    titleKey: 'proUi.features.dmarcIntelligence.title',
    descriptionKey: 'proUi.features.dmarcIntelligence.description',
    implemented: true,
    href: '/admin/domains',
  },
  {
    id: 'advanced-dashboard',
    flag: 'pro.advanced_dashboard',
    slug: 'advanced-dashboard',
    titleKey: 'proUi.features.advancedDashboard.title',
    descriptionKey: 'proUi.features.advancedDashboard.description',
  },
  {
    id: 'backup-center',
    flag: 'pro.backup_center',
    slug: 'backup-center',
    titleKey: 'proUi.features.backupCenter.title',
    descriptionKey: 'proUi.features.backupCenter.description',
  },
  {
    id: 'branding',
    flag: 'pro.branding',
    slug: 'branding',
    titleKey: 'proUi.features.branding.title',
    descriptionKey: 'proUi.features.branding.description',
    implemented: true,
    href: '/admin/settings?tab=white-label',
  },
  {
    id: 'multi-tenant-rbac',
    flag: 'pro.multi_tenant_rbac',
    slug: 'multi-tenant',
    titleKey: 'proUi.features.multiTenantRbac.title',
    descriptionKey: 'proUi.features.multiTenantRbac.description',
  },
  {
    id: 'priority-updates',
    flag: 'pro.priority_updates',
    slug: 'priority-updates',
    titleKey: 'proUi.features.priorityUpdates.title',
    descriptionKey: 'proUi.features.priorityUpdates.description',
  },
];
