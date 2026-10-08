import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AdminLayout } from './components/layout/AdminLayout';
import { AccountLayout } from './components/layout/AccountLayout';
import { MailLayout } from './components/layout/MailLayout';
import { AuthLayout } from './components/layout/AuthLayout';
import { RequireAuth, RequireRole } from './auth/guards';
import { extensionRegistry } from './lib/extensions';

import { LoginPage } from './pages/login/LoginPage';
import { HomeRedirect } from './pages/HomeRedirect';
import { NotFoundPage } from './pages/NotFoundPage';

import { DashboardPage } from './pages/admin/DashboardPage';
import { DomainsListPage } from './pages/admin/domains/DomainsListPage';
import { DomainDetailPage } from './pages/admin/domains/DomainDetailPage';
import { MailboxesPage } from './pages/admin/MailboxesPage';
import { MailboxDetailPage } from './pages/admin/mailboxes/MailboxDetailPage';
import { AliasesPage } from './pages/admin/AliasesPage';
import { ForwardingsPage } from './pages/admin/ForwardingsPage';
import { DistributionListsPage } from './pages/admin/DistributionListsPage';
import { CatchAllPage } from './pages/admin/CatchAllPage';
import { MigrationPage } from './pages/admin/migration/MigrationPage';
import { QueuePage } from './pages/admin/QueuePage';
import { LiveLogsPage } from './pages/admin/LiveLogsPage';
import { StatisticsPage } from './pages/admin/StatisticsPage';
import { CertificatesPage } from './pages/admin/CertificatesPage';
import { SecurityPage } from './pages/admin/SecurityPage';
import { AdminsPage } from './pages/admin/AdminsPage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';
import { LicensePage } from './pages/admin/LicensePage';
import { DocumentationPage } from './pages/admin/DocumentationPage';

import { OverviewPage } from './pages/account/OverviewPage';
import { AppPasswordsPage } from './pages/account/AppPasswordsPage';
import { VacationPage } from './pages/account/VacationPage';
import { FiltersPage } from './pages/account/FiltersPage';
import { ForwardingPage } from './pages/account/ForwardingPage';
import { SessionsPage } from './pages/account/SessionsPage';
import { MigrationPage as AccountMigrationPage } from './pages/account/MigrationPage';

import { MailFolderPage } from './pages/mail/MailFolderPage';
import { ContactsPage } from './pages/mail/ContactsPage';
import { MailSettingsPage } from './pages/mail/MailSettingsPage';

// Lazy-loaded: each of these pulls in a large, otherwise-unused-elsewhere dependency
// (zxcvbn-ts's ru/en dictionaries, TipTap + its ProseMirror core, a QR-code renderer) that would
// otherwise sit in the main bundle every visitor downloads just to reach /login.
// TODO(S4)/TODO(S5): revisit which other routes deserve this once real per-page data fetching
// (and therefore genuinely separate code, not just this stub) exists.
const passwordPageLazy = () =>
  import('./pages/account/PasswordPage').then((m) => ({ Component: m.PasswordPage }));
const twoFactorPageLazy = () =>
  import('./pages/account/TwoFactorPage').then((m) => ({ Component: m.TwoFactorPage }));
const composePageLazy = () =>
  import('./pages/mail/ComposePage').then((m) => ({ Component: m.ComposePage }));

/**
 * Route tree (`/login`, `/admin/*`, `/account/*`, `/mail/*`).
 * `RequireRole role="DomainAdmin"` gates the whole /admin subtree (SuperAdmin ranks above it,
 * see ROLE_RANK in auth/AuthContext.tsx) — per-page finer RBAC (e.g. AdminsPage being
 * SuperAdmin-only) is TODO(S4) once the API tells us which admin the session actually is.
 * Extension routes (empty for Community) are appended inside the authenticated subtree so a
 * Pro route still benefits from session gating.
 */
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <AuthLayout />,
    children: [{ index: true, element: <LoginPage /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <HomeRedirect /> },
      {
        path: '/admin',
        element: <RequireRole role="DomainAdmin" />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: 'domains', element: <DomainsListPage /> },
              { path: 'domains/:domainId', element: <DomainDetailPage /> },
              { path: 'mailboxes', element: <MailboxesPage /> },
              { path: 'mailboxes/:mailboxId', element: <MailboxDetailPage /> },
              { path: 'aliases', element: <AliasesPage /> },
              { path: 'forwardings', element: <ForwardingsPage /> },
              { path: 'lists', element: <DistributionListsPage /> },
              { path: 'catch-all', element: <CatchAllPage /> },
              { path: 'migration', element: <MigrationPage /> },
              { path: 'logs', element: <LiveLogsPage /> },
              { path: 'statistics', element: <StatisticsPage /> },
              { path: 'docs', element: <DocumentationPage /> },
              {
                element: <RequireRole role="SuperAdmin" />,
                children: [
                  { path: 'queue', element: <QueuePage /> },
                  { path: 'certificates', element: <CertificatesPage /> },
                  { path: 'security', element: <SecurityPage /> },
                  { path: 'admins', element: <AdminsPage /> },
                  { path: 'settings', element: <AdminSettingsPage /> },
                  { path: 'license', element: <LicensePage /> },
                  ...extensionRegistry
                    .getRoutes()
                    .filter((r) => r.path?.startsWith('/admin/'))
                    .map((r) => ({
                      ...r,
                      path: r.path!.slice('/admin/'.length),
                    })),
                ],
              },
            ],
          },
        ],
      },
      {
        path: '/account',
        element: <AccountLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'password', lazy: passwordPageLazy },
          { path: '2fa', lazy: twoFactorPageLazy },
          { path: 'app-passwords', element: <AppPasswordsPage /> },
          { path: 'vacation', element: <VacationPage /> },
          { path: 'filters', element: <FiltersPage /> },
          { path: 'forwarding', element: <ForwardingPage /> },
          { path: 'sessions', element: <SessionsPage /> },
          { path: 'migration', element: <AccountMigrationPage /> },
        ],
      },
      {
        path: '/mail',
        element: <MailLayout />,
        children: [
          { index: true, element: <Navigate to="/mail/inbox" replace /> },
          { path: 'compose', lazy: composePageLazy },
          { path: 'contacts', element: <ContactsPage /> },
          { path: 'settings', element: <MailSettingsPage /> },
          { path: ':folderId', element: <MailFolderPage /> },
          { path: ':folderId/:messageId', element: <MailFolderPage /> },
        ],
      },
      ...extensionRegistry.getRoutes().filter((r) => !r.path?.startsWith('/admin/')),
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
