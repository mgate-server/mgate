import { Outlet } from 'react-router-dom';

/** Centered card shell for /login. */
export function AuthLayout() {
  return (
    <div className="bg-mg-bg flex min-h-dvh items-center justify-center p-4">
      <div className="border-mg-border bg-mg-surface w-full max-w-sm rounded-lg border p-6 shadow-sm">
        <Outlet />
      </div>
    </div>
  );
}
