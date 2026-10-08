import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth, type Role } from './AuthContext';

import { ForbiddenPage } from '../pages/ForbiddenPage';

/** Redirects to /login (preserving the intended destination) unless a session is active. */
export function RequireAuth(): ReactElement {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <div className="text-mg-text-muted p-6">…</div>;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}

/** Gate for a subtree that additionally requires at least `role` (RBAC). */
export function RequireRole({ role }: { role: Role }): ReactElement {
  const { hasAtLeastRole } = useAuth();
  if (!hasAtLeastRole(role)) {
    return <ForbiddenPage />;
  }
  return <Outlet />;
}

