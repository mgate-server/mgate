/**
 * The whole `@mgate/extensions` surface (one SPA build, no build-time
 * community/Pro module swap). `apps/spa/src/pro` builds its `ExtensionModule` against
 * these types; `apps/spa/src/lib/extensions.ts` registers it once at startup; `<ProFeature>`
 * gates content behind `GET /api/v1/system/entitlements` (cosmetic only — enforcement is
 * server-side).
 */
export type {
  DashboardWidget,
  ExtensionModule,
  FeatureFlags,
  NavItem,
  ProUpsellProps,
  SettingsPanel,
} from './types';
export { ExtensionRegistry, createExtensionRegistry } from './registry';
export {
  getActiveRegistry,
  setActiveExtensions,
  setEntitlementFlags,
  subscribeActiveExtensions,
  _resetActiveExtensionsForTests,
} from './runtime';
export { ProFeature } from './ProFeature';
