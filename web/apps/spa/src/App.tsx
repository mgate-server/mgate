import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ToastProvider } from '@mgate/ui';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './lib/theme';
import { queryClient } from './lib/queryClient';
import { useEntitlementsSync } from './lib/entitlements';
import { router } from './router';
import { UpdateRequiredBanner } from './components/UpdateRequiredBanner';

function EntitlementsSync() {
  useEntitlementsSync();
  return null;
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <EntitlementsSync />
            <UpdateRequiredBanner />
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
