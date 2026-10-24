import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Copy, Shield, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Badge, Button, Card, Input } from '@mgate/ui';
import { apiClient } from '../../lib/apiClient';

interface EnrollmentData {
  secret: string;
  otpauth_uri: string;
  recovery_codes: string[];
}

export function TwoFactorPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [enrolmentData, setEnrolmentData] = useState<EnrollmentData | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['account', '2fa'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/account/2fa');
      if (error) throw error;
      return data;
    },
  });

  const enrollMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      const { data, error } = await apiClient.POST('/api/v1/account/2fa');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data) {
        setEnrolmentData(data);
        setVerifyCode('');
      }
    },
    onError: () => {
      setErrorMessage(t('account.2fa.enrollFailed', 'Не удалось начать настройку 2FA.'));
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ code, secret }: { code: string; secret: string }) => {
      setErrorMessage(null);
      const { error } = await apiClient.POST('/api/v1/account/2fa/verify', {
        body: { code, secret },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEnrolmentData(null);
      setVerifyCode('');
      queryClient.invalidateQueries({ queryKey: ['account', '2fa'] });
    },
    onError: () => {
      setErrorMessage(t('account.2fa.verifyFailed', 'Неверный код подтверждения. Попробуйте ещё раз.'));
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      const { error } = await apiClient.DELETE('/api/v1/account/2fa');
      if (error) throw error;
    },
    onSuccess: () => {
      setEnrolmentData(null);
      queryClient.invalidateQueries({ queryKey: ['account', '2fa'] });
    },
    onError: () => {
      setErrorMessage(t('account.2fa.removeFailed', 'Не удалось отключить 2FA.'));
    },
  });

  const isEnabled = status?.enabled ?? false;

  const handleCopySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="border-mg-border-subtle flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
            {isEnabled ? <ShieldCheck className="h-6 w-6 text-emerald-500" /> : <Shield className="h-6 w-6" />}
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
        {isEnabled ? (
          <Badge tone="success">{t('account.2fa.enabledBadge', 'Включена')}</Badge>
        ) : (
          <Badge tone="neutral">{t('account.2fa.disabledBadge', 'Отключена')}</Badge>
        )}
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

      {isEnabled ? (
        <Card className="space-y-4 p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-emerald-500/10 p-2 text-emerald-500">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-mg-text text-base font-semibold">
                {t('account.2fa.activeTitle', '2FA активна')}
              </h2>
              <p className="text-mg-text-muted text-xs">
                {t(
                  'account.2fa.activeDesc',
                  'При входе в веб-интерфейс запрашивается 6-значный одноразовый код из вашего приложения-аутентификатора.',
                )}
              </p>
            </div>
          </div>

          <div className="pt-2">
            <Button
              variant="danger"
              size="sm"
              isLoading={disableMutation.isPending}
              onClick={() => {
                if (
                  confirm(
                    t(
                      'account.2fa.disableConfirm',
                      'Вы уверены, что хотите отключить двухфакторную аутентификацию? Вход будет осуществляться только по паролю.',
                    ),
                  )
                ) {
                  disableMutation.mutate();
                }
              }}
            >
              {t('account.2fa.disableBtn', 'Отключить 2FA')}
            </Button>
          </div>
        </Card>
      ) : enrolmentData ? (
        <Card className="space-y-6 p-6 shadow-sm">
          <div>
            <h2 className="text-mg-text text-base font-semibold">
              {t('account.2fa.setupTitle', 'Настройка двухфакторной аутентификации')}
            </h2>
            <p className="text-mg-text-muted text-xs mt-1">
              {t(
                'account.2fa.setupSubtitle',
                'Отсканируйте QR-код в приложении-аутентификаторе (Google Authenticator, YubiKey, 1Password и др.)',
              )}
            </p>
          </div>

          {/* Step 1: QR Code */}
          <div className="flex flex-col items-center justify-center p-4 bg-mg-surface-subtle/50 rounded-xl space-y-4">
            <div className="bg-white p-3 rounded-xl shadow-sm">
              <QRCodeSVG value={enrolmentData.otpauth_uri} size={180} />
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs text-mg-text-muted font-medium">
                {t('account.2fa.manualEntry', 'Или введите ключ вручную:')}
              </p>
              <div className="inline-flex items-center gap-2 bg-mg-surface px-3 py-1.5 rounded-lg border border-mg-border text-xs font-mono">
                <span>{enrolmentData.secret}</span>
                <button
                  type="button"
                  onClick={() => handleCopySecret(enrolmentData.secret)}
                  className="text-mg-text-muted hover:text-mg-text transition-colors"
                  title="Копировать"
                >
                  {copiedSecret ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Step 2: Recovery Codes */}
          {enrolmentData.recovery_codes && enrolmentData.recovery_codes.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-mg-text">
                {t('account.2fa.recoveryTitle', 'Резервные коды восстановления')}
              </h3>
              <p className="text-xs text-mg-text-muted">
                {t(
                  'account.2fa.recoveryDesc',
                  'Сохраните эти коды в надёжном месте. Каждый код может быть использован один раз для входа при утере доступа к приложению.',
                )}
              </p>
              <div className="grid grid-cols-2 gap-2 bg-mg-surface-subtle/40 p-3 rounded-lg border border-mg-border text-xs font-mono text-center">
                {enrolmentData.recovery_codes.map((code) => (
                  <div key={code} className="p-1">
                    {code}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Step 3: Verification */}
          <div className="space-y-4 pt-2 border-t border-mg-border-subtle">
            <h3 className="text-xs font-semibold text-mg-text">
              {t('account.2fa.verifyTitle', 'Подтверждение')}
            </h3>
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="w-full sm:w-48">
                <Input
                  label={t('account.2fa.verifyInputLabel', 'Код из приложения')}
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                />
              </div>
              <Button
                variant="primary"
                isLoading={verifyMutation.isPending}
                disabled={verifyCode.length !== 6}
                onClick={() => verifyMutation.mutate({ code: verifyCode, secret: enrolmentData.secret })}
              >
                {t('account.2fa.confirmBtn', 'Подтвердить и включить')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEnrolmentData(null);
                  setErrorMessage(null);
                }}
              >
                {t('common.cancel', 'Отмена')}
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="space-y-4 p-6 shadow-sm">
          <h2 className="text-mg-text text-base font-semibold">
            {t('account.2fa.optInTitle', 'Защита учётной записи')}
          </h2>
          <p className="text-mg-text-muted text-xs leading-relaxed">
            {t(
              'account.2fa.optInDesc',
              'Двухфакторная аутентификация опциональна. Если она не включена, вход в систему выполняется стандартно по паролю. Включение 2FA требует ввода 6-значного кода при каждом входе в веб-интерфейс MGate.',
            )}
          </p>
          <div className="pt-2">
            <Button
              variant="primary"
              size="sm"
              isLoading={enrollMutation.isPending}
              onClick={() => enrollMutation.mutate()}
            >
              {t('account.2fa.enableBtn', 'Включить 2FA')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
