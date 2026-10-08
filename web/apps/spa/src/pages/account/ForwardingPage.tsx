import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, PageHeader } from '@mgate/ui';
import { apiClient } from '../../lib/apiClient';

interface ForwardingData {
  destination?: string;
  keep_copy?: boolean;
}

export function ForwardingPage() {
  const { t } = useTranslation();

  const { data: forwarding, isLoading } = useQuery({
    queryKey: ['account', 'forwarding'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/account/forwarding');
      if (error) throw error;
      return (data || {}) as ForwardingData;
    },
  });

  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title={t('nav.account.forwarding')} />

      <Card title={t('account.forwarding.title', 'Персональная пересылка входящей почты')}>
        {isLoading ? (
          <p className="text-mg-text-muted py-4 text-sm">{t('common.loading', 'Загрузка...')}</p>
        ) : (
          <ForwardingForm initialData={forwarding ?? {}} />
        )}
      </Card>
    </div>
  );
}

function ForwardingForm({ initialData }: { initialData: ForwardingData }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [destination, setDestination] = useState(initialData.destination ?? '');
  const [keepCopy, setKeepCopy] = useState(initialData.keep_copy ?? true);
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!destination.trim()) return;
      const { error } = await apiClient.PUT('/api/v1/account/forwarding', {
        body: {
          destination: destination.trim(),
          keep_copy: keepCopy,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account', 'forwarding'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const { error } = await apiClient.DELETE('/api/v1/account/forwarding');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account', 'forwarding'] });
      setDestination('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        saveMutation.mutate();
      }}
    >
      <p className="text-mg-text-muted text-sm">
        {t(
          'account.forwarding.hint',
          'Все входящие письма будут автоматически пересылаться на указанный адрес. Вы можете выбрать, сохранять ли копию в этом ящике.',
        )}
      </p>

      <Input
        label={t('account.forwarding.destination', 'Адрес для пересылки')}
        type="email"
        placeholder="personal@example.org"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        required
      />

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={keepCopy}
          onChange={(e) => setKeepCopy(e.target.checked)}
          className="rounded"
        />
        <span className="text-mg-text text-sm">
          {t('account.forwarding.keepCopy', 'Сохранять копию каждого письма в текущем ящике')}
        </span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" isLoading={saveMutation.isPending} disabled={!destination.trim()}>
          {t('common.save', 'Сохранить')}
        </Button>
        {initialData.destination ? (
          <Button
            type="button"
            variant="danger"
            isLoading={disableMutation.isPending}
            onClick={() => disableMutation.mutate()}
          >
            {t('account.forwarding.disable', 'Отключить пересылку')}
          </Button>
        ) : null}
        {saved ? (
          <span className="text-mg-success text-sm">
            {t('common.saved', 'Настройки успешно сохранены!')}
          </span>
        ) : null}
      </div>
    </form>
  );
}
