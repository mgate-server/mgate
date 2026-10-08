import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plane, Check, Sparkles } from 'lucide-react';
import { Button, Card, Input } from '@mgate/ui';
import { apiClient } from '../../lib/apiClient';

interface VacationData {
  mailbox_id?: string;
  enabled?: boolean;
  subject?: string | null;
  body?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

export function VacationPage() {
  const { t } = useTranslation();

  const { data: vacation, isLoading } = useQuery({
    queryKey: ['account', 'vacation'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/account/vacation');
      if (error) throw error;
      return (data || {}) as VacationData;
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="border-mg-border-subtle flex items-center gap-3 border-b pb-4">
        <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
          <Plane className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-mg-text text-xl font-semibold tracking-tight">
            {t('nav.account.vacation', 'Автоответчик')}
          </h1>
          <p className="text-mg-text-muted text-xs">
            Автоматические ответы на входящие письма в период вашего отсутствия или отпуска
          </p>
        </div>
      </div>

      <Card className="p-6 shadow-sm">
        {isLoading ? (
          <p className="text-mg-text-muted py-4 text-center text-xs">Загрузка параметров...</p>
        ) : (
          <VacationForm initialData={vacation ?? {}} />
        )}
      </Card>
    </div>
  );
}

function VacationForm({ initialData }: { initialData: VacationData }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(initialData.enabled ?? false);
  const [subject, setSubject] = useState(initialData.subject ?? 'Вне офиса / Автоответ');
  const [body, setBody] = useState(
    initialData.body ??
      'Здравствуйте!\n\nВ настоящее время я нахожусь в отпуске/командировке и могу отвечать на письма с задержкой.\nПо срочным вопросам обращайтесь к коллегам.\n\nС уважением,',
  );
  const [startDate, setStartDate] = useState(
    initialData.starts_at ? initialData.starts_at.slice(0, 10) : '',
  );
  const [endDate, setEndDate] = useState(
    initialData.ends_at ? initialData.ends_at.slice(0, 10) : '',
  );
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await apiClient.PUT('/api/v1/account/vacation', {
        body: {
          enabled,
          subject: subject.trim() || undefined,
          body: body.trim() || undefined,
          starts_at: startDate ? new Date(startDate).toISOString() : undefined,
          ends_at: endDate ? new Date(endDate).toISOString() : undefined,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account', 'vacation'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        saveMutation.mutate();
      }}
    >
      {/* Enable Toggle Card */}
      <div
        className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-colors ${
          enabled
            ? 'bg-mg-primary/5 border-mg-primary/40'
            : 'bg-mg-surface-subtle/40 border-mg-border-subtle'
        }`}
        onClick={() => setEnabled(!enabled)}
      >
        <div className="space-y-0.5">
          <span className="text-mg-text text-xs font-semibold">
            {t('account.vacation.enableCheckbox', 'Включить автоматический ответ')}
          </span>
          <p className="text-mg-text-muted text-[11px]">
            Отправлять автоответ каждому отправителю не чаще одного раза в несколько дней
          </p>
        </div>

        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="text-mg-primary focus:ring-mg-primary h-4 w-4 cursor-pointer rounded"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <div className={`space-y-4 transition-opacity ${enabled ? 'opacity-100' : 'opacity-60'}`}>
        <Input
          label={t('account.vacation.subject', 'Тема автоответа')}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={!enabled}
          placeholder="Вне офиса / Автоответ"
          required={enabled}
        />

        <div>
          <label className="text-mg-text mb-1.5 block text-xs font-medium">
            {t('account.vacation.body', 'Текст сообщения')}
          </label>
          <textarea
            className="border-mg-border bg-mg-surface text-mg-text focus-visible:ring-mg-focus-ring placeholder:text-mg-text-muted min-h-32 w-full rounded-lg border p-3 text-xs leading-relaxed focus-visible:ring-2 focus-visible:outline-none"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!enabled}
            required={enabled}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t('account.vacation.startsAt', 'Дата начала (включительно)')}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={!enabled}
          />

          <Input
            label={t('account.vacation.endsAt', 'Дата окончания (включительно)')}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={!enabled}
          />
        </div>
      </div>

      <div className="border-mg-border-subtle flex items-center gap-3 border-t pt-3">
        <Button type="submit" isLoading={saveMutation.isPending} className="gap-1.5">
          <Check className="h-4 w-4" />
          <span>{t('common.save', 'Сохранить настройки')}</span>
        </Button>

        {saved && (
          <span className="text-mg-success inline-flex items-center gap-1 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Параметры автоответчика сохранены!</span>
          </span>
        )}
      </div>
    </form>
  );
}
