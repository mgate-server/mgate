import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { setEntitlementFlags } from '@mgate/extensions';
import { apiClient } from './apiClient';

/**
 * Fetches `GET /api/v1/system/entitlements` and pushes the enabled
 * `features` into the extension registry (`@mgate/extensions`'s `setEntitlementFlags`) so
 * `<ProFeature>` reflects the real lease everywhere it's used, without every page re-fetching.
 * Mounted once near the root (`App.tsx`); TanStack Query dedupes/caches the actual request.
 *
 * This only controls what the SPA *shows* — the backend refuses the underlying `/api/v1/pro/*`
 * calls regardless, so a stale or bypassed flag here is a UX nit, never a security issue.
 */
export function useEntitlementsSync(): void {
  const { data } = useQuery({
    queryKey: ['system', 'entitlements'],
    queryFn: async () => {
      const { data: body, error } = await apiClient.GET('/api/v1/system/entitlements');
      if (error) throw error;
      return body;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!data) return;
    const flags: Record<string, boolean> = {};
    if (data.edition === 'pro') {
      // Only modules the backend really implements; backlog modules (DNS autopilot scheduling,
      // backup center, advanced dashboard, multi-tenant RBAC, priority updates) answer 501 and
      // must not look enabled. DMARC extras have no flag of their own: any Pro lease has them.
      flags['pro.branding'] = true;
      flags['pro.unlimited_domains'] = true;
    }
    for (const flag of data.features ?? []) {
      flags[flag] = true;
    }
    setEntitlementFlags(flags);
  }, [data]);
}

export function useEntitlements() {
  return useQuery({
    queryKey: ['system', 'entitlements'],
    queryFn: async () => {
      const { data: body, error } = await apiClient.GET('/api/v1/system/entitlements');
      if (error) throw error;
      return body;
    },
    staleTime: 60_000,
  });
}
