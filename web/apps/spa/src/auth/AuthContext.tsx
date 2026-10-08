import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { components } from '@mgate/api-client';
import { apiClient } from '../lib/apiClient';

/** RBAC roles. Order matters for `hasAtLeastRole`. Kept as a
 * distinct (PascalCase) frontend type rather than reusing the wire `Role` string directly —
 * route guards (`router.tsx`, `guards.tsx`) read more clearly as `role="DomainAdmin"` than as the
 * wire's `snake_case`; [`toFrontendRole`] is the single place that translates between the two. */
export type Role = 'User' | 'DomainAdmin' | 'SuperAdmin';

const ROLE_RANK: Record<Role, number> = { User: 0, DomainAdmin: 1, SuperAdmin: 2 };

/** Wire role (`snake_case` — the single JSON casing convention for the
 * whole public API) -> frontend [`Role`]. */
function toFrontendRole(role: components['schemas']['Role']): Role {
  switch (role) {
    case 'super_admin':
      return 'SuperAdmin';
    case 'domain_admin':
      return 'DomainAdmin';
    case 'user':
      return 'User';
  }
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  /** Non-null for DomainAdmin scoped to a single domain; null for SuperAdmin/User. */
  domainId: string | null;
}

/** Maps the wire `AuthUser` (`GET /api/v1/auth/me`, a successful login) to the frontend shape. */
function toFrontendUser(wire: components['schemas']['AuthUser']): AuthUser {
  return {
    id: wire.id,
    email: wire.email,
    role: toFrontendRole(wire.role),
    domainId: wire.domain_id ?? null,
  };
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'totp_required';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  hasAtLeastRole: (role: Role) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * TODO(S2): replace the bootstrap effect with a real `GET /api/v1/auth/me` call once the backend auth
 * flow is implemented (the route and DTO already exist and are wired below; today it always answers
 * `501`), so a page refresh restores `user` from the session instead of starting logged out.
 * `login`/`logout` already call the real `/api/v1/auth/*` endpoints against the final DTO shape.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .GET('/api/v1/auth/me')
      .then(({ data }) => {
        if (!active) return;
        if (data) {
          setUser(toFrontendUser(data));
          setStatus('authenticated');
        } else {
          setStatus('unauthenticated');
        }
      })
      .catch(() => {
        if (active) setStatus('unauthenticated');
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string, totpCode?: string) => {
    const { data, error } = await apiClient.POST('/api/v1/auth/login', {
      body: { email, password, totp_code: totpCode ?? null },
    });
    if (error) throw error;
    if (data.status === 'totp_required') {
      setStatus('totp_required');
      return;
    }
    if (data.user) setUser(toFrontendUser(data.user));
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.POST('/api/v1/auth/logout', {});
    } catch {
      // ignore
    }
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const hasAtLeastRole = useCallback(
    (role: Role) => Boolean(user) && ROLE_RANK[user!.role] >= ROLE_RANK[role],
    [user],
  );

  const value = useMemo(
    () => ({ status, user, login, logout, hasAtLeastRole }),
    [status, user, login, logout, hasAtLeastRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
