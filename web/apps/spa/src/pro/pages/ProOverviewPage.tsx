import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Card, PageHeader } from '@mgate/ui';
import { PRO_FEATURES } from '../features';

/** `/admin/pro` — index of Pro features: implemented ones are marked available, the rest "in development". */
export function ProOverviewPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link to="/admin" className="text-mg-primary mb-4 inline-block text-sm hover:underline">
        ← {t('proUi.backToAdmin')}
      </Link>
      <PageHeader title={t('proUi.nav.overview')} description={t('proUi.overview.description')} />
      <div className="flex flex-col gap-3">
        {PRO_FEATURES.map((feature) => (
          <Card key={feature.id}>
            <Link
              to={feature.implemented && feature.href ? feature.href : `/admin/pro/${feature.slug}`}
              className="flex items-center justify-between gap-3"
            >
              <div>
                <p className="text-mg-text font-medium">{t(feature.titleKey)}</p>
                <p className="text-mg-text-muted text-sm">{t(feature.descriptionKey)}</p>
              </div>
              <Badge tone={feature.implemented ? 'success' : 'warning'}>
                {feature.implemented ? t('proUi.activeBadge') : t('proUi.backlogBadge')}
              </Badge>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
