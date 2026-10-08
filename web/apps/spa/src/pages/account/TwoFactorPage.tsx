import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Shield } from 'lucide-react';
import { Badge, Button, Card } from '@mgate/ui';
import { apiClient } from '../../lib/apiClient';

/**
 * /account/2fa — two-factor authentication is IN DEVELOPMENT.
 *
 * The login does not ask for a TOTP code yet, so offering an enrolment here would give a false
 * sense of security. The page therefore only explains the status; the one action kept is
 * removing a TOTP secret that was stored earlier (so nobody is left with a dormant secret they
 * cannot get rid of).
 */
export function TwoFactorPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['account', '2fa'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/account/2fa');
      if (error) throw error;
      return data;
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      const { error } = await apiClient.DELETE('/api/v1/account/2fa');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account', '2fa'] });
    },
    onError: () => {
      setErrorMessage(t('account.2fa.removeFailed', 'Не удалось удалить сохранённый секрет.'));
    },
  });

  const hasStoredSecret = status?.enabled ?? false;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="border-mg-border-subtle flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-mg-text text-xl font-semibold tracking-tight">
              {t('nav.account.twoFactor', 'Двухфакторная аутентификация')}
            </h1>
            <p className="text-mg-text-muted text-xs">
              {t('account.2fa.subtitle', 'Одноразовые коды TOTP при входе в веб-интерфейс')}
            </p>
          </div>
        </div>
        <Badge tone="warning">{t('account.2fa.devBadge', 'В разработке')}</Badge>
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-600 dark:text-rose-400"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <Card className="space-y-3 p-6 shadow-sm">
        <h2 className="text-mg-text text-base font-semibold">
          {t('account.2fa.devTitle', 'Двухфакторная аутентификация пока не работает')}
        </h2>
        <p className="text-mg-text-muted text-xs leading-relaxed">
          {t(
            'account.2fa.devDesc',
            'Вход в MGate сейчас выполняется только по паролю: одноразовый код при входе не запрашивается и не проверяется. Подключение 2FA сейчас не повысило бы защиту учётной записи, поэтому оно временно недоступно. Используйте длинный уникальный пароль, а для почтовых программ — отдельные пароли приложений.',
          )}
        </p>
      </Card>

      {hasStoredSecret ? (
        <Card className="space-y-3 border-amber-500/30 p-6 shadow-sm">
          <h2 className="text-mg-text text-base font-semibold">
            {t('account.2fa.storedTitle', 'Сохранён секрет TOTP')}
          </h2>
          <p className="text-mg-text-muted text-xs leading-relaxed">
            {t(
              'account.2fa.storedDesc',
              'Ранее для вашей учётной записи был сохранён секрет TOTP. Он не используется при входе. Вы можете удалить его.',
            )}
          </p>
          <div>
            <Button
              variant="danger"
              size="sm"
              isLoading={disableMutation.isPending}
              onClick={() => {
                if (confirm(t('account.2fa.removeConfirm', 'Удалить сохранённый секрет TOTP?'))) {
                  disableMutation.mutate();
                }
              }}
            >
              {t('account.2fa.remove', 'Удалить секрет')}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
