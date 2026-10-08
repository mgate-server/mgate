import { useTranslation } from 'react-i18next';
import { useVersionCompatibility } from '../lib/versionCheck';

/**
 * App-wide banner shown when this SPA build is older than what the API requires
 * (`spa_min_version` from `GET /api/v1/system/info`). Renders nothing while
 * compatible, loading, or against a backend that does not send `spa_min_version` yet.
 */
export function UpdateRequiredBanner() {
  const { t } = useTranslation();
  const { updateRequired } = useVersionCompatibility();

  if (!updateRequired) return null;

  return (
    <div
      role="alert"
      className="bg-mg-danger text-mg-danger-fg w-full px-4 py-2 text-center text-sm font-medium"
    >
      {t('system.updateRequired')}
    </div>
  );
}
