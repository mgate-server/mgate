import type { SettingsPanel } from '@mgate/extensions';
import { ProSettingsPanel } from './ProSettingsPanel';

export const proSettingsPanels: SettingsPanel[] = [
  {
    id: 'pro-settings',
    titleKey: 'proUi.settings.title',
    area: 'admin',
    Component: ProSettingsPanel,
    order: 200,
  },
];
