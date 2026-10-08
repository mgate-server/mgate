import { QueryClient } from '@tanstack/react-query';

/**
 * Single TanStack Query client for the whole SPA. TODO(S2): once `@mgate/api-client`'s ApiError
 * carries retryable status codes, add a shared `retry`/`throwOnError` policy here instead of the
 * library defaults.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
