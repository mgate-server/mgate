/**
 * Extension SDK types.
 *
 * MGate ships exactly one SPA build. Its Pro pages (`apps/spa/src/pro`) are ordinary, always-compiled-in `ExtensionModule`s registered
 * once at startup (`apps/spa/src/lib/extensions.ts`) — there is no build-time module swap.
 * What an admin actually gets access to is decided at runtime by
 * `GET /api/v1/system/entitlements`, enforced only in the closed backend; `<ProFeature>` here is
 * a cosmetic gate, never a security control.
 */
import type { ComponentType, ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';

/** A single left-nav entry contributed by an extension. */
export interface NavItem {
  id: string;
  /** i18next key, resolved by the shell (not the extension) so translations stay centralized. */
  labelKey: string;
  to: string;
  /** lucide-react icon name, kept as a string so the SDK has no icon-library coupling. */
  icon?: string;
  /** Which area's nav this item belongs to. */
  area: 'admin' | 'account' | 'mail';
  /** Optional ordering hint; lower sorts first. Community items default to 100+. */
  order?: number;
}

/** A settings sub-panel an extension injects into an existing settings page. */
export interface SettingsPanel {
  id: string;
  titleKey: string;
  area: 'admin' | 'account';
  Component: ComponentType;
  order?: number;
}

/** A widget an extension injects into the admin dashboard grid. */
export interface DashboardWidget {
  id: string;
  titleKey: string;
  Component: ComponentType;
  /** Grid column span out of a 12-col dashboard grid. */
  span?: 4 | 6 | 8 | 12;
  order?: number;
}

/**
 * A named boolean capability gate. A module may declare static flags, but the shell's live
 * entitlements query (`setEntitlementFlags`, from `GET /api/v1/system/entitlements`) always
 * overlays and wins — see `runtime.ts`.
 */
export type FeatureFlags = Record<string, boolean>;

/** Contract every extension module must satisfy. */
export interface ExtensionModule {
  id: string;
  routes?: RouteObject[];
  navItems?: NavItem[];
  settingsPanels?: SettingsPanel[];
  dashboardWidgets?: DashboardWidget[];
  featureFlags?: FeatureFlags;
}

/** Props for the upsell shown by <ProFeature> when a flag is not granted. */
export interface ProUpsellProps {
  flag: string;
  children?: ReactNode;
}
