import { useQuery } from '@tanstack/react-query';
import { apiClient } from './apiClient';

/**
 * Version-compatibility check: the SPA reads `GET /api/v1/system/info`
 * (`api_version`, `spa_min_version`) and shows a clear 'update required' banner on mismatch.
 *
 * `api_version`/`spa_min_version` are not yet in the committed `openapi.json`'s `SystemInfo`
 * schema yet — the backend side of this check is still landing. Declared
 * as an extra optional interface (rather than assumed absent) so this activates the moment the
 * fields appear in a refreshed schema (`make openapi-sync`), with no further SPA change needed;
 * until then `updateRequired` is always `false`.
 */
interface VersionFields {
  api_version?: string;
  spa_min_version?: string;
}

/**
 * Baked in at build time from `VITE_APP_VERSION` (the release pipeline passes the product's
 * CalVer `YYYY.M.N`, e.g. `2026.10.1`). Local/dev builds use `dev` or `0.0.0-dev`, which never
 * trigger the "update required" banner.
 */
export const SPA_VERSION = String(import.meta.env.VITE_APP_VERSION || '0.0.0-dev');

/** `dev`, `0.0.0-dev`, `1.2.3-dev` etc.: a local build that is exempt from version checks. */
export function isDevVersion(version: string): boolean {
  return /(^|[-.+])dev$/i.test(version.trim());
}

/** Parses the numeric core of a dotted version (`"2026.10.1"`, `"v2026.10.1-rc1"`); `null` if invalid. */
function parseVersion(version: string): number[] | null {
  const core = version.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split('.').map(Number);
}

/**
 * Compares dotted numeric versions segment by segment (works for SemVer and CalVer
 * `YYYY.M.N`: `2026.9.3` < `2026.10.1`). Pre-release/build suffixes are ignored, missing
 * segments count as 0, and dev/unparsable versions are never considered older.
 */
export function isOlderVersion(a: string, b: string): boolean {
  if (isDevVersion(a) || isDevVersion(b)) return false;
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  if (!partsA || !partsB) return false;
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i += 1) {
    const x = partsA[i] ?? 0;
    const y = partsB[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export function useVersionCompatibility() {
  const query = useQuery({
    queryKey: ['system', 'info'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/system/info');
      if (error) throw error;
      return data as typeof data & VersionFields;
    },
    staleTime: 5 * 60_000,
  });

  const info = query.data;
  const updateRequired = Boolean(
    info?.spa_min_version && isOlderVersion(SPA_VERSION, info.spa_min_version),
  );

  return { ...query, updateRequired, apiVersion: info?.api_version };
}
