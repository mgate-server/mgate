import { getActiveRegistry, setActiveExtensions } from '@mgate/extensions';
import { proExtensionModule } from '../pro';

// MGate ships exactly one SPA build: the Pro pages are always compiled in and
// registered here directly, rather than resolved through a build-time module swap. Live
// entitlements (`GET /api/v1/system/entitlements`, see `entitlements.ts`) decide what
// `<ProFeature>` actually shows.
setActiveExtensions([proExtensionModule]);

export const extensionRegistry = getActiveRegistry();
