import { useQuery } from '@tanstack/react-query';
import { mailApi } from './mailApi';
import type {
  ListDensity,
  MailLimits,
  RemoteImagesPolicy,
  WebmailPrefs,
  WebmailPrefsWire,
} from './types';

export const DEFAULT_PREFS: WebmailPrefs = {
  remote_images: 'ask',
  list_density: 'normal',
  mark_read_on_open: true,
};

const REMOTE_IMAGES: RemoteImagesPolicy[] = ['ask', 'always', 'never'];
const DENSITIES: ListDensity[] = ['compact', 'normal', 'comfortable'];

/** Fills missing/unknown values with defaults, so a stale or partial response never breaks the UI. */
export function normalizePrefs(raw: Partial<WebmailPrefsWire> | null | undefined): WebmailPrefs {
  return {
    remote_images: REMOTE_IMAGES.includes(raw?.remote_images as RemoteImagesPolicy)
      ? (raw?.remote_images as RemoteImagesPolicy)
      : DEFAULT_PREFS.remote_images,
    list_density: DENSITIES.includes(raw?.list_density as ListDensity)
      ? (raw?.list_density as ListDensity)
      : DEFAULT_PREFS.list_density,
    mark_read_on_open:
      typeof raw?.mark_read_on_open === 'boolean'
        ? raw.mark_read_on_open
        : DEFAULT_PREFS.mark_read_on_open,
  };
}

export const MAIL_SETTINGS_KEY = ['mail', 'settings'] as const;

/** Raw settings query (for the settings form: it must know when data has actually arrived). */
export function useMailSettingsQuery() {
  return useQuery({
    queryKey: MAIL_SETTINGS_KEY,
    queryFn: async ({ signal }) => normalizePrefs(await mailApi.settings(signal)),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Effective prefs: server values once loaded, defaults before (and if the call fails). */
export function useMailPrefs(): WebmailPrefs {
  const { data } = useMailSettingsQuery();
  return data ?? DEFAULT_PREFS;
}

/** Server limits (`GET /limits`); `undefined` while loading or if the backend does not offer them. */
export function useMailLimits(): MailLimits | undefined {
  const { data } = useQuery({
    queryKey: ['mail', 'limits'],
    queryFn: ({ signal }) => mailApi.limits(signal),
    staleTime: 10 * 60_000,
    retry: false,
  });
  return data;
}
