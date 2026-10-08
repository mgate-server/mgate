import { useSyncExternalStore, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState } from '@mgate/ui';
import type { ProUpsellProps } from './types';
import { getActiveRegistry, subscribeActiveExtensions } from './runtime';

/**
 * Gates `children` behind a feature flag reported by `GET /api/v1/system/entitlements`
 * (wired into the registry via `setEntitlementFlags`, see `runtime.ts` and
 * `apps/spa/src/lib/entitlements.ts`). Subscribes via `useSyncExternalStore` so a page rendered
 * before the entitlements query resolves upgrades in place once it does, without a manual
 * refresh.
 *
 * This is a COSMETIC gate only: the backend refuses the underlying API
 * calls regardless of what this component renders, so hiding/showing here is UX, never
 * enforcement — a modified SPA build cannot grant itself Pro features.
 */
export function ProFeature({ flag, children }: ProUpsellProps): ReactElement {
  const { t } = useTranslation();
  const enabled = useSyncExternalStore(subscribeActiveExtensions, () =>
    getActiveRegistry().isFeatureEnabled(flag),
  );

  if (enabled) {
    return <>{children}</>;
  }

  return (
    <EmptyState
      title={t('extensions.proFeature.title')}
      description={t('extensions.proFeature.description')}
      action={
        <Button variant="primary" onClick={() => window.location.assign('/admin/license')}>
          {t('extensions.proFeature.cta')}
        </Button>
      }
    />
  );
}
