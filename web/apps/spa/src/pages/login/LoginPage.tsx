import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { Button, Input } from '@mgate/ui';
import { ApiError } from '@mgate/api-client';
import { useAuth } from '../../auth/AuthContext';

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const totpSchema = z.object({
  totpCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'expected a 6-digit code'),
});

/**
 * /login — email + password sign-in. The TOTP step is kept for when the backend starts
 * enforcing 2FA (in development; today the API never answers `totp_required`).
 * TODO(S2): once the backend's real response shape lands, redirect by role (SuperAdmin/DomainAdmin
 * -> /admin, User -> /account or /mail) instead of always going to "/".
 */
export function LoginPage() {
  const { t } = useTranslation();
  const { login, status, user } = useAuth();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    const from = (location.state as { from?: Location } | null)?.from;
    if (from?.pathname) {
      return <Navigate to={from.pathname} replace />;
    }
    const defaultPath =
      user?.role === 'SuperAdmin' || user?.role === 'DomainAdmin' ? '/admin' : '/mail';
    return <Navigate to={defaultPath} replace />;
  }

  const showTotpStep = status === 'totp_required';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (showTotpStep) {
      const parsed = totpSchema.safeParse({ totpCode });
      if (!parsed.success) {
        setFieldErrors({ totpCode: t('auth.login.totpInvalid', 'Введите 6-значный код') });
        return;
      }
    } else {
      const parsed = credentialsSchema.safeParse({ email, password });
      if (!parsed.success) {
        const next: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path[0];
          if (typeof key === 'string') next[key] = issue.message;
        }
        setFieldErrors(next);
        return;
      }
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      await login(email, password, showTotpStep ? totpCode : undefined);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : t('auth.login.genericError', 'Не удалось войти');
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <h1 className="text-mg-text text-lg font-semibold">
        {showTotpStep ? t('auth.login.totpTitle') : t('auth.login.title')}
      </h1>

      {formError ? <p className="text-mg-danger text-sm">{formError}</p> : null}

      {showTotpStep ? (
        <Input
          label={t('auth.login.totpCode')}
          name="totpCode"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={totpCode}
          onChange={(e) => setTotpCode(e.target.value)}
          error={fieldErrors.totpCode}
          autoFocus
        />
      ) : (
        <>
          <Input
            label={t('auth.login.email')}
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
            autoFocus
          />
          <Input
            label={t('auth.login.password')}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
          />
        </>
      )}

      <Button type="submit" isLoading={submitting} className="mt-2 w-full">
        {showTotpStep ? t('auth.login.totpSubmit') : t('auth.login.submit')}
      </Button>
    </form>
  );
}
