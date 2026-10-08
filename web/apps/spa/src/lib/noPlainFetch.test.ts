import { describe, expect, it } from 'vitest';

/**
 * Regression guard: the API rejects mutating requests without the `X-CSRF-Token` header
 * (403 `csrf_token_invalid`). Application code must therefore go through `fetchApi` (or the
 * generated `apiClient`), never a bare `fetch`. Allowed bare callers: the CSRF-aware wrapper
 * itself, the public runtime config / branding reads (GET, no session needed).
 */
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const ALLOWED = new Set([
  '/src/lib/apiClient.ts',
  '/src/lib/runtimeConfig.ts',
  '/src/components/layout/TopBar.tsx',
]);

describe('CSRF-aware requests', () => {
  it('has no bare fetch( outside the allow-list', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path) && !ALLOWED.has(path))
      .filter(([, code]) => /(?<![.\w])fetch\(/.test(code))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('keeps the allow-listed bare fetch calls GET-only', () => {
    for (const path of ALLOWED) {
      if (path === '/src/lib/apiClient.ts') continue;
      const code = sources[path] ?? '';
      expect(code, path).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/);
    }
  });
});
