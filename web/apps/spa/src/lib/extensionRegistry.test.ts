import { describe, expect, it } from 'vitest';
import { createExtensionRegistry } from '@mgate/extensions';
import type { ExtensionModule } from '@mgate/extensions';

const communityLikeModule: ExtensionModule = {
  id: 'community',
  routes: [],
  navItems: [],
  featureFlags: {},
};

const proLikeModule: ExtensionModule = {
  id: 'pro',
  routes: [{ path: '/admin/pro-widget' }],
  navItems: [
    { id: 'pro-nav', labelKey: 'pro.nav', to: '/admin/pro-widget', area: 'admin', order: 5 },
  ],
  dashboardWidgets: [{ id: 'pro-widget', titleKey: 'pro.widget', Component: () => null, order: 1 }],
  settingsPanels: [
    { id: 'pro-panel', titleKey: 'pro.panel', area: 'admin', Component: () => null },
  ],
  featureFlags: { 'pro.advancedRouting': true },
};

describe('ExtensionRegistry', () => {
  it('reports no routes/nav/flags for an empty (Community) module set', () => {
    const registry = createExtensionRegistry([communityLikeModule]);

    expect(registry.getRoutes()).toEqual([]);
    expect(registry.getNavItems('admin')).toEqual([]);
    expect(registry.isFeatureEnabled('pro.advancedRouting')).toBe(false);
  });

  it('aggregates routes/nav/widgets/panels/flags across modules', () => {
    const registry = createExtensionRegistry([communityLikeModule, proLikeModule]);

    expect(registry.getRoutes()).toHaveLength(1);
    expect(registry.getNavItems('admin')).toHaveLength(1);
    expect(registry.getNavItems('account')).toHaveLength(0);
    expect(registry.getDashboardWidgets()).toHaveLength(1);
    expect(registry.getSettingsPanels('admin')).toHaveLength(1);
    expect(registry.isFeatureEnabled('pro.advancedRouting')).toBe(true);
    expect(registry.isFeatureEnabled('pro.unknownFlag')).toBe(false);
  });

  it('sorts nav items by their `order` field', () => {
    const first: ExtensionModule = {
      id: 'a',
      navItems: [{ id: 'z', labelKey: 'z', to: '/z', area: 'admin', order: 50 }],
    };
    const second: ExtensionModule = {
      id: 'b',
      navItems: [{ id: 'a', labelKey: 'a', to: '/a', area: 'admin', order: 10 }],
    };
    const registry = createExtensionRegistry([first, second]);

    expect(registry.getNavItems('admin').map((item) => item.id)).toEqual(['a', 'z']);
  });

  it('exposes the registered module ids', () => {
    const registry = createExtensionRegistry([communityLikeModule, proLikeModule]);
    expect(registry.moduleIds).toEqual(['community', 'pro']);
  });
});
