import type {
  DashboardWidget,
  ExtensionModule,
  FeatureFlags,
  NavItem,
  SettingsPanel,
} from './types';
import type { RouteObject } from 'react-router-dom';

/**
 * Merges zero or more ExtensionModule instances into flat, sorted collections the shell
 * can render directly. Pure and framework-agnostic: no React context, no globals — the
 * shell owns one instance (see `runtime.ts`, `apps/spa/src/lib/extensions.ts`) built from
 * the SPA's own Pro module (`apps/spa/src/pro`), always registered.
 */
export class ExtensionRegistry {
  private readonly modules: ExtensionModule[];

  constructor(modules: ExtensionModule[] = []) {
    this.modules = modules;
  }

  get moduleIds(): string[] {
    return this.modules.map((m) => m.id);
  }

  getRoutes(): RouteObject[] {
    return this.modules.flatMap((m) => m.routes ?? []);
  }

  getNavItems(area: NavItem['area']): NavItem[] {
    return this.modules
      .flatMap((m) => m.navItems ?? [])
      .filter((item) => item.area === area)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  getSettingsPanels(area: SettingsPanel['area']): SettingsPanel[] {
    return this.modules
      .flatMap((m) => m.settingsPanels ?? [])
      .filter((panel) => panel.area === area)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  getDashboardWidgets(): DashboardWidget[] {
    return this.modules
      .flatMap((m) => m.dashboardWidgets ?? [])
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /** Union of every module's feature flags; a later module wins on key collision. */
  getFeatureFlags(): FeatureFlags {
    return this.modules.reduce<FeatureFlags>((acc, m) => ({ ...acc, ...m.featureFlags }), {});
  }

  isFeatureEnabled(flag: string): boolean {
    return this.getFeatureFlags()[flag] === true;
  }
}

export function createExtensionRegistry(modules: ExtensionModule[]): ExtensionRegistry {
  return new ExtensionRegistry(modules);
}
