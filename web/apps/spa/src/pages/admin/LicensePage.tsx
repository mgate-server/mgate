import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, PageHeader } from '@mgate/ui';
import { ApiError } from '@mgate/api-client';
import { apiClient, fetchApi } from '../../lib/apiClient';

interface LicenseStatusResponse {
  state: 'active' | 'expired' | 'grace_period' | 'revoked' | 'unlicensed' | string;
  edition: string;
  expires_at?: string | null;
  domains_limit?: number | null;
  domains_count?: number;
  features?: string[];
}

export function LicensePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const activationId = searchParams.get('activation');

  const {
    data: license,
    isLoading,
    refetch,
  } = useQuery<LicenseStatusResponse>({
    queryKey: ['admin', 'license'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/admin/license');
      if (error) throw error;
      return data;
    },
  });

  // If redirected from cloud portal with ?activation=<id>, poll activation
  useEffect(() => {
    if (!activationId) return;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetchApi(`/api/v1/admin/license/activation/${activationId}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'completed' || data.status === 'active') {
            clearInterval(interval);
            refetch();
          }
        }
      } catch {
        // Continue polling
      }
      if (attempts >= 15) {
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activationId, refetch]);

  const startActivation = useMutation({
    mutationFn: async () => {
      const { data, error } = await apiClient.POST('/api/v1/admin/license/activation', {});
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.checkout_url) {
        window.location.assign(data.checkout_url);
      }
    },
  });

  const activateCode = useMutation({
    mutationFn: async (value: string) => {
      setCodeError(null);
      const res = await fetchApi('/api/v1/admin/license/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: value.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (
          res.status === 409 ||
          body.error?.code === 'pro_conflict' ||
          body.error?.code === 'license_conflict'
        ) {
          throw new Error(
            t(
              'admin.license.conflictError',
              'Конфликт лицензии (ProConflict): количество активных доменов превышает лимит или лицензия уже привязана к другому серверу.',
            ),
          );
        }
        throw new Error(body.error?.message || 'Неверный код активации');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'license'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
      setCode('');
      setCodeError(null);
    },
    onError: (err: Error) => {
      setCodeError(err.message);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchApi('/api/v1/admin/license/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to deactivate license');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'license'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });

  const isPro = license?.edition?.toLowerCase() === 'pro';

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.admin.license')}
        actions={
          <Badge tone={isPro ? 'primary' : 'neutral'}>
            {isPro ? 'MGate Pro' : t('common.communityEdition', 'Community Edition')}
          </Badge>
        }
      />

      {/* License Overview */}
      <Card title={t('admin.license.currentStatus', 'Текущий статус лицензии')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="border-mg-border bg-mg-surface-raised rounded-md border p-3">
            <p className="text-mg-text-muted text-xs">{t('admin.license.edition', 'Редакция')}</p>
            <p className="text-mg-text text-base font-semibold">
              {isLoading ? '...' : isPro ? 'Pro' : 'Community'}
            </p>
          </div>

          <div className="border-mg-border bg-mg-surface-raised rounded-md border p-3">
            <p className="text-mg-text-muted text-xs">
              {t('admin.license.domainUsage', 'Использование доменов')}
            </p>
            <p className="text-mg-text text-base font-semibold">
              {isLoading
                ? '...'
                : `${license?.domains_count ?? 1} / ${
                    license?.domains_limit ? license.domains_limit : isPro ? '∞' : '1'
                  }`}
            </p>
          </div>

          <div className="border-mg-border bg-mg-surface-raised rounded-md border p-3">
            <p className="text-mg-text-muted text-xs">
              {t('admin.license.validUntil', 'Срок действия')}
            </p>
            <p className="text-mg-text text-base font-semibold">
              {isLoading
                ? '...'
                : license?.expires_at
                  ? new Date(license.expires_at).toLocaleDateString()
                  : isPro
                    ? 'Активна'
                    : 'Бессрочно (Community)'}
            </p>
          </div>
        </div>

        {isPro ? (
          <div className="border-mg-border mt-4 flex items-center justify-between border-t pt-4">
            <span className="text-mg-text-muted text-xs">
              Лицензия привязана к данному инстансу.
            </span>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (
                  confirm(
                    t(
                      'admin.license.confirmDeactivate',
                      'Деактивировать Pro-лицензию на этом сервере и переключиться в Community?',
                    ),
                  )
                ) {
                  deactivateMutation.mutate();
                }
              }}
              isLoading={deactivateMutation.isPending}
            >
              {t('admin.license.deactivate', 'Деактивировать лицензию')}
            </Button>
          </div>
        ) : null}
      </Card>

      {/* Upgrade & Activation only if Community edition */}
      {!isPro ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Upgrade to Pro">
            <p className="text-mg-text-muted mb-4 text-sm">
              {t(
                'admin.license.upgradeText',
                'Снимает ограничение на 1 домен, открывает Pro-модули (брендинг, расширенную маршрутизацию, синхронизацию). Переход на страницу покупки.',
              )}
            </p>
            <Button onClick={() => startActivation.mutate()} isLoading={startActivation.isPending}>
              {t('admin.license.upgrade', 'Перейти к покупке Pro')}
            </Button>
            {startActivation.isError ? (
              <p className="text-mg-danger mt-2 text-sm">
                {startActivation.error instanceof ApiError
                  ? startActivation.error.message
                  : t('auth.login.genericError', 'Ошибка запуска оплаты')}
              </p>
            ) : null}
          </Card>

          <Card title={t('admin.license.enterCode', 'Ввести код активации')}>
            <div className="flex flex-col gap-3">
              <Input
                label="Код лицензии (MGT-XXXXX-...)"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="MGT-XXXXX-XXXXX-XXXXX-XXXXX"
                error={codeError ?? undefined}
              />
              <Button
                variant="secondary"
                onClick={() => activateCode.mutate(code)}
                isLoading={activateCode.isPending}
              >
                {t('common.activate', 'Активировать код')}
              </Button>
              {activateCode.isSuccess ? (
                <p className="text-mg-success text-sm">
                  {t('admin.license.activated', 'Лицензия успешно активирована!')}
                </p>
              ) : null}
            </div>
          </Card>
        </div>
      ) : (
        <Card title="Возможности MGate Pro">
          <div className="space-y-3 text-sm">
            <p className="text-mg-text">
              На данном сервере активирована коммерческая лицензия <strong>MGate Pro</strong>.
              Доступны неограниченные почтовые домены, экспорт аудита соответствия и расширенные
              возможности.
            </p>
            <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
              <div className="border-mg-border bg-mg-surface-raised flex items-center gap-2 rounded border p-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium">Неограниченное число доменов</span>
              </div>
              <div className="border-mg-border bg-mg-surface-raised flex items-center gap-2 rounded border p-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium">Подписанный экспорт журнала аудита</span>
              </div>
              <div className="border-mg-border bg-mg-surface-raised flex items-center gap-2 rounded border p-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium">
                  Автоматическое продление и синхронизация
                </span>
              </div>
              <div className="border-mg-border bg-mg-surface-raised flex items-center gap-2 rounded border p-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium">Приоритетная поддержка и обновления</span>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
