/**
 * Runtime configuration fetched from `/config.json`: rendered by the `web`
 * nginx image's entrypoint from env at container start, so one built SPA image works for any
 * hostname without a rebuild. The Vite dev server never serves this file, so every field has a
 * same-origin-friendly default — `npm run dev`'s own proxy (`vite.config.ts`) already forwards
 * `/api` to the local backend.
 */
export interface RuntimeConfig {
  /** Prefix prepended to every `/api/v1/...` / `/internal/v1/...` call. '' = same origin. */
  apiBaseUrl: string;
  /**
   * Optional operator-configured links (`MGATE_PRICING_URL`, `MGATE_VENDOR_PORTAL_URL`). A key
   * is present only when it holds a valid http(s) URL; the UI shows the matching button/link
   * only then — no hostnames are hard-coded in the SPA.
   */
  links?: RuntimeLinks;
}

export interface RuntimeLinks {
  /** Pricing / purchase page of the vendor. */
  pricingUrl?: string;
  /** Vendor customer portal (licence owner's account). */
  vendorPortalUrl?: string;
}

const DEFAULT_CONFIG: RuntimeConfig = { apiBaseUrl: '' };

/** Returns `value` if it is a non-empty string holding an http(s) URL, otherwise `undefined`. */
function parseHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** Validates the optional `links` object: drops non-string/empty/non-http(s) values. */
export function parseRuntimeLinks(raw: unknown): RuntimeLinks | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const links: RuntimeLinks = {};
  const pricingUrl = parseHttpUrl(source.pricingUrl);
  if (pricingUrl) links.pricingUrl = pricingUrl;
  const vendorPortalUrl = parseHttpUrl(source.vendorPortalUrl);
  if (vendorPortalUrl) links.vendorPortalUrl = vendorPortalUrl;
  return Object.keys(links).length > 0 ? links : undefined;
}

let cached: RuntimeConfig | null = null;
let loading: Promise<RuntimeConfig> | null = null;

/**
 * Fetches and caches `/config.json`. Call once, before bootstrapping the app (`main.tsx`), so
 * `getRuntimeConfig()` can be used synchronously everywhere else (e.g. `apiClient.ts`).
 * Never throws: a missing/invalid file (dev server, or a misconfigured image) falls back to
 * `DEFAULT_CONFIG` rather than blocking the app from rendering.
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;
  if (!loading) {
    loading = fetch('/config.json', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`config.json responded ${res.status}`);
        return res.json() as Promise<Partial<RuntimeConfig>>;
      })
      .then((data) => {
        const config: RuntimeConfig = { ...DEFAULT_CONFIG, ...data };
        const links = parseRuntimeLinks((data as { links?: unknown }).links);
        if (links) config.links = links;
        else delete config.links;
        return config;
      })
      .catch(() => DEFAULT_CONFIG)
      .then((config) => {
        cached = config;
        return config;
      });
  }
  return loading;
}

/** Synchronous accessor. Returns `DEFAULT_CONFIG` if `loadRuntimeConfig` has not resolved yet. */
export function getRuntimeConfig(): RuntimeConfig {
  return cached ?? DEFAULT_CONFIG;
}

/** Operator-configured links; an empty object when none are configured (never `undefined`). */
export function getRuntimeLinks(): RuntimeLinks {
  return getRuntimeConfig().links ?? {};
}
