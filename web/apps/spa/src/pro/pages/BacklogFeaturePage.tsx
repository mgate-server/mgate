import type { ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Card, PageHeader } from '@mgate/ui';
import { PRO_FEATURES } from '../features';

/**
 * `/admin/pro/:slug` — one detail page per Pro feature (`../features.ts`).
 *
 * Features the backend really implements (`implemented`) redirect to the place where they live.
 * Every other feature is a backlog stub: the backend answers `501 not_implemented` for it
 * regardless of the edition, so this page always renders an honest "in development" state — no
 * data, no upsell, no pretence that an entitled admin could use it.
 *
 * Not nested inside the SPA's `AdminLayout`: extension routes are spliced at the router's top
 * level, as siblings of `/admin`/`/account`/`/mail` (`apps/spa/src/router.tsx`),
 * not as children of the `/admin` subtree — so this page renders without the shared sidebar.
 * TODO(S4): once `@mgate/ui` exports the shared admin chrome for extension pages to reuse, wrap
 * this in it instead of `<StandaloneShell>`.
 */
export function BacklogFeaturePage() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const feature = PRO_FEATURES.find((f) => f.slug === slug);

  if (!feature) {
    return (
      <StandaloneShell>
        <p className="text-mg-text-muted text-sm">{t('proUi.notFound')}</p>
      </StandaloneShell>
    );
  }

  if (feature.implemented && feature.href) {
    return <Navigate to={feature.href} replace />;
  }

  return (
    <StandaloneShell>
      <PageHeader
        title={t(feature.titleKey)}
        description={t(feature.descriptionKey)}
        actions={<Badge tone="warning">{t('proUi.backlogBadge')}</Badge>}
      />
      <Card>
        <div className="flex flex-col gap-2">
          <p className="text-mg-text text-sm font-medium">{t('proUi.inDevelopment.title')}</p>
          <p className="text-mg-text-muted text-sm">{t('proUi.inDevelopment.description')}</p>
        </div>
      </Card>
    </StandaloneShell>
  );
}

function StandaloneShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link to="/admin" className="text-mg-primary mb-4 inline-block text-sm hover:underline">
        ← {t('proUi.backToAdmin')}
      </Link>
      {children}
    </div>
  );
}
