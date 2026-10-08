import { Navigate, type RouteObject } from 'react-router-dom';
import { ProOverviewPage } from './pages/ProOverviewPage';
import { BacklogFeaturePage } from './pages/BacklogFeaturePage';

/**
 * Routes contributed to the SPA's `ExtensionModule.routes`.
 *
 * DNS autopilot (scheduled sync), Backup Center and Advanced Dashboard have no pages of their
 * own: the backend answers 501 `not_implemented` for them, so they are served by
 * `BacklogFeaturePage` ("in development") like every other Pro feature that is not implemented
 * yet.
 */
export const proRoutes: RouteObject[] = [
  { path: '/admin/pro', element: <ProOverviewPage /> },
  {
    path: '/admin/pro/branding',
    element: <Navigate to="/admin/settings?tab=white-label" replace />,
  },
  { path: '/admin/pro/:slug', element: <BacklogFeaturePage /> },
];
