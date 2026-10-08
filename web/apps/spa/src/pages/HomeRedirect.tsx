import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/**
 * / — routes an authenticated user to the area their role actually uses.
 * TODO(S2): once `AuthUser` is populated from the real session, SuperAdmin/DomainAdmin should
 * probably land on /admin and a plain User on /account (or /mail) instead of always /account.
 */
export function HomeRedirect() {
  const { hasAtLeastRole } = useAuth();
  return <Navigate to={hasAtLeastRole('DomainAdmin') ? '/admin' : '/account'} replace />;
}
