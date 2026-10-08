import { createExtensionRegistry, type ExtensionRegistry } from './registry';
import type { ExtensionModule, FeatureFlags } from './types';

type Listener = () => void;

/**
 * MGate ships exactly one SPA build: there is no community/Pro
 * module swap, so `modules` is simply whatever the shell registers once at startup (its Pro
 * pages, always compiled in — `apps/spa/src/pro`). `entitlementFlags` is the live overlay: the
 * shell calls `setEntitlementFlags` whenever `GET /api/v1/system/entitlements` resolves
 * (`apps/spa/src/lib/entitlements.ts`), and it always wins over a module's own static
 * `featureFlags` so `<ProFeature>` reflects the real lease, not a placeholder.
 */
let modules: ExtensionModule[] = [];
let entitlementFlags: FeatureFlags = {};
let active: ExtensionRegistry = createExtensionRegistry([]);
const listeners = new Set<Listener>();

function rebuild(): void {
  active = createExtensionRegistry(
    modules.map((module) => ({
      ...module,
      featureFlags: { ...module.featureFlags, ...entitlementFlags },
    })),
  );
  listeners.forEach((listener) => listener());
}

/** Called once by the SPA shell at startup (`apps/spa/src/lib/extensions.ts`). */
export function setActiveExtensions(next: ExtensionModule[]): void {
  modules = next;
  rebuild();
}

/**
 * Called whenever the shell's entitlements query resolves or refetches
 * (`apps/spa/src/lib/entitlements.ts`). Enforcement itself is server-side — this only decides
 * what `<ProFeature>` shows; the backend refuses the underlying calls regardless.
 */
export function setEntitlementFlags(flags: FeatureFlags): void {
  entitlementFlags = flags;
  rebuild();
}

/** Read-only accessor used by `<ProFeature>` and by nav/dashboard renderers. */
export function getActiveRegistry(): ExtensionRegistry {
  return active;
}

/**
 * Subscribes to registry/entitlement changes; pairs with `getActiveRegistry` as the
 * `useSyncExternalStore` snapshot for components (like `<ProFeature>`) that must re-render once
 * entitlements load asynchronously after the initial render.
 */
export function subscribeActiveExtensions(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only helper to reset global state between unit tests. */
export function _resetActiveExtensionsForTests(): void {
  modules = [];
  entitlementFlags = {};
  rebuild();
}
