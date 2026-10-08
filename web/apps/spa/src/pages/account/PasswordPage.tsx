import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, Check, AlertCircle } from 'lucide-react';
import { Button, Card, Input, cn } from '@mgate/ui';
import { estimatePasswordStrength } from '../../lib/passwordStrength';
import type { PasswordStrength } from '../../lib/passwordStrength';
import { apiClient } from '../../lib/apiClient';

const SCORE_LABELS = ['Очень слабый', 'Слабый', 'Средний', 'Хороший', 'Отличный'];
const SCORE_COLORS = [
  'bg-mg-danger',
  'bg-mg-danger',
  'bg-mg-warning',
  'bg-mg-primary',
  'bg-mg-success',
];

const EMPTY_STRENGTH: PasswordStrength = { score: 0, warning: '', suggestions: [] };

function StrengthMeter({ password }: { password: string }) {
  const { i18n } = useTranslation();
  const [strength, setStrength] = useState<PasswordStrength>(EMPTY_STRENGTH);

  useEffect(() => {
    let cancelled = false;
    void estimatePasswordStrength(password, i18n.language).then((result) => {
      if (!cancelled) setStrength(result);
    });
    return () => {
      cancelled = true;
    };
  }, [password, i18n.language]);

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'bg-mg-surface-subtle border-mg-border-subtle h-1 flex-1 rounded-full border transition-colors',
              password && i <= strength.score && SCORE_COLORS[strength.score],
            )}
          />
        ))}
      </div>
      {password ? (
        <p className="text-mg-text-muted flex items-center justify-between text-[11px]">
          <span>
            Надежность: <strong className="text-mg-text">{SCORE_LABELS[strength.score]}</strong>
          </span>
          {strength.warning && <span className="text-amber-500">{strength.warning}</span>}
        </p>
      ) : null}
    </div>
  );
}

export function PasswordPage() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      const { error } = await apiClient.PUT('/api/v1/account/password', {
        body: {
          current_password: currentPassword,
          new_password: newPassword,
        },
      });
      if (error) {
        throw new Error((error as { error?: string })?.error || 'Не удалось сменить пароль');
      }
    },
    onSuccess: () => {
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(false), 4000);
    },
    onError: (err: Error) => {
      setErrorMessage(err.message);
    },
  });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Header */}
      <div className="border-mg-border-subtle flex items-center gap-3 border-b pb-4">
        <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
          <KeyRound className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-mg-text text-xl font-semibold tracking-tight">
            {t('nav.account.password', 'Пароль учетной записи')}
          </h1>
          <p className="text-mg-text-muted text-xs">
            Обновление пароля для входа в веб-клиент и почтовые сервисы
          </p>
        </div>
      </div>

      <Card className="p-6 shadow-sm">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            changePasswordMutation.mutate();
          }}
        >
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="h-4 w-4 shrink-0" />
              <span>{t('account.password.success', 'Пароль успешно обновлен!')}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <Input
            label={t('account.password.current', 'Текущий пароль')}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />

          <div className="space-y-1.5">
            <Input
              label={t('account.password.new', 'Новый пароль')}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <StrengthMeter password={newPassword} />
          </div>

          <div className="space-y-1">
            <Input
              label={t('account.password.confirm', 'Повторите новый пароль')}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {mismatch && (
              <p className="text-mg-danger text-xs">
                {t('account.password.mismatch', 'Пароли не совпадают')}
              </p>
            )}
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              disabled={
                !currentPassword || !newPassword || mismatch || changePasswordMutation.isPending
              }
              isLoading={changePasswordMutation.isPending}
              className="w-full gap-2"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{t('account.password.submit', 'Обновить пароль')}</span>
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
