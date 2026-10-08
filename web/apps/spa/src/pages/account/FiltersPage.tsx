import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Modal, PageHeader, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import { apiClient } from '../../lib/apiClient';

interface SieveRule {
  id: string;
  name: string;
  position: number;
  definition: {
    field?: string;
    op?: string;
    value?: string;
    action?: string;
    target?: string;
  };
  script: string;
  enabled: boolean;
}

export function FiltersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [field, setField] = useState('from');
  const [customHeader, setCustomHeader] = useState('');
  const [op, setOp] = useState('contains');
  const [value, setValue] = useState('');
  const [action, setAction] = useState('fileinto');
  const [target, setTarget] = useState('Archive');

  const { data: filters, isLoading } = useQuery({
    queryKey: ['account', 'filters'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/api/v1/account/filters');
      if (error) throw error;
      return (data || []) as SieveRule[];
    },
  });

  const saveRuleMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim() || (field !== 'spam' && !value.trim())) return;

      const requires = new Set<string>();
      let conditionStr: string;

      if (field === 'body') {
        requires.add('body');
        if (op === 'regex') requires.add('regex');
        conditionStr = `body :text :${op} "${value.replace(/"/g, '\\"')}"`;
      } else if (field === 'spam') {
        conditionStr = `header :is "X-Spam-Flag" "YES"`;
      } else if (field === 'from' || field === 'to') {
        if (op === 'regex') requires.add('regex');
        const targetHeader = field === 'from' ? '"from"' : '["to", "cc"]';
        conditionStr = `address :all :${op} ${targetHeader} "${value.replace(/"/g, '\\"')}"`;
      } else if (field === 'header') {
        if (op === 'regex') requires.add('regex');
        const hName = customHeader.trim() || 'X-Custom-Header';
        conditionStr = `header :${op} "${hName}" "${value.replace(/"/g, '\\"')}"`;
      } else {
        if (op === 'regex') requires.add('regex');
        conditionStr = `header :${op} "${field}" "${value.replace(/"/g, '\\"')}"`;
      }

      let actionStr: string;
      if (action === 'fileinto') {
        requires.add('fileinto');
        requires.add('mailbox');
        actionStr = `fileinto :create "${target.replace(/"/g, '\\"')}";`;
      } else if (action === 'redirect') {
        actionStr = `redirect "${target.replace(/"/g, '\\"')}";`;
      } else if (action === 'mark_read') {
        requires.add('imap4flags');
        actionStr = `addflag "\\\\Seen";`;
      } else if (action === 'flag') {
        requires.add('imap4flags');
        actionStr = `addflag "\\\\Flagged";`;
      } else {
        actionStr = `discard;`;
      }

      const reqHeader =
        requires.size > 0
          ? `require [${Array.from(requires)
              .sort()
              .map((r) => `"${r}"`)
              .join(', ')}];\n\n`
          : '';
      const script = `${reqHeader}# rule: ${name}\nif ${conditionStr} {\n    ${actionStr}\n    stop;\n}`;

      const { error } = await apiClient.PUT('/api/v1/account/filters', {
        body: {
          name: name.trim(),
          position: (filters?.length ?? 0) + 1,
          definition: { field, customHeader, op, value, action, target },
          script,
          enabled: true,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account', 'filters'] });
      setCreateOpen(false);
      setName('');
      setValue('');
      setCustomHeader('');
    },
  });

  const columns: TableColumn<SieveRule>[] = [
    {
      key: 'name',
      header: t('account.filters.name', 'Название правила'),
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-mg-text font-medium">{r.name}</span>
          <span className="text-mg-text-muted max-w-xl truncate font-mono text-xs">{r.script}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('common.status', 'Статус'),
      render: (r) =>
        r.enabled ? (
          <Badge tone="success">{t('common.enabled', 'Активно')}</Badge>
        ) : (
          <Badge tone="neutral">{t('common.disabled', 'Отключено')}</Badge>
        ),
    },
  ];

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        title={t('nav.account.filters')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            {t('account.filters.create', 'Создать правило')}
          </Button>
        }
      />

      <Card>
        <p className="text-mg-text-muted mb-4 text-sm">
          {t(
            'account.filters.hint',
            'Серверные фильтры автоматически обрабатывают входящие письма при доставке на основе правил Sieve (поиск по телу письма, регулярные выражения, перемещение в папки, флаги, пересылка, удаление).',
          )}
        </p>

        <Table
          columns={columns}
          rows={filters || []}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          emptyMessage={t('account.filters.empty', 'У вас пока нет настроенных фильтров.')}
        />
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('account.filters.newTitle', 'Новое правило фильтрации')}
      >
        <div className="space-y-4">
          <Input
            label={t('account.filters.ruleName', 'Название правила')}
            placeholder="Рассылки в архив"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <div className="border-mg-border space-y-3 rounded-md border p-3">
            <h4 className="text-mg-text text-xs font-semibold tracking-wide uppercase">
              {t('account.filters.conditionTitle', 'Условие')}
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-mg-text-muted text-xs font-medium">Поле</label>
                <select
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                  className="border-mg-border bg-mg-surface text-mg-text mt-1 w-full rounded border px-2 py-1.5 text-xs"
                >
                  <option value="from">Отправитель (From)</option>
                  <option value="to">Получатель (To/Cc)</option>
                  <option value="subject">Тема (Subject)</option>
                  <option value="body">Тело письма (Body)</option>
                  <option value="spam">Спам (X-Spam-Flag)</option>
                  <option value="header">Пользовательский заголовок</option>
                </select>
              </div>

              {field !== 'spam' && (
                <div>
                  <label className="text-mg-text-muted text-xs font-medium">Сравнение</label>
                  <select
                    value={op}
                    onChange={(e) => setOp(e.target.value)}
                    className="border-mg-border bg-mg-surface text-mg-text mt-1 w-full rounded border px-2 py-1.5 text-xs"
                  >
                    <option value="contains">содержит</option>
                    <option value="is">точно совпадает</option>
                    <option value="matches">по шаблону (*, ?)</option>
                    <option value="regex">регулярное выражение (Regex)</option>
                  </select>
                </div>
              )}

              {field !== 'spam' && (
                <div>
                  <label className="text-mg-text-muted text-xs font-medium">Значение</label>
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={op === 'regex' ? '^[A-Z]{3}-[0-9]+' : 'newsletter@'}
                    className="border-mg-border bg-mg-surface text-mg-text mt-1 w-full rounded border px-2 py-1.5 text-xs"
                  />
                </div>
              )}
            </div>

            {field === 'header' && (
              <div className="pt-2">
                <label className="text-mg-text-muted text-xs font-medium">
                  Имя заголовка (Header Name)
                </label>
                <input
                  value={customHeader}
                  onChange={(e) => setCustomHeader(e.target.value)}
                  placeholder="X-Invoice-Ref"
                  className="border-mg-border bg-mg-surface text-mg-text mt-1 w-full rounded border px-2 py-1.5 font-mono text-xs"
                />
              </div>
            )}
          </div>

          <div className="border-mg-border space-y-3 rounded-md border p-3">
            <h4 className="text-mg-text text-xs font-semibold tracking-wide uppercase">
              {t('account.filters.actionTitle', 'Действие')}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-mg-text-muted text-xs font-medium">Тип действия</label>
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  className="border-mg-border bg-mg-surface text-mg-text mt-1 w-full rounded border px-2 py-1.5 text-xs"
                >
                  <option value="fileinto">Переместить в папку</option>
                  <option value="redirect">Переслать на адрес</option>
                  <option value="flag">Пометить флажком (Flagged)</option>
                  <option value="mark_read">Отметить как прочитанное</option>
                  <option value="discard">Удалить письмо</option>
                </select>
              </div>

              {action === 'fileinto' || action === 'redirect' ? (
                <div>
                  <label className="text-mg-text-muted text-xs font-medium">
                    {action === 'fileinto' ? 'Папка назначения' : 'Email для пересылки'}
                  </label>
                  <input
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="border-mg-border bg-mg-surface text-mg-text mt-1 w-full rounded border px-2 py-1.5 text-xs"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!name.trim() || (field !== 'spam' && !value.trim())}
              isLoading={saveRuleMutation.isPending}
              onClick={() => saveRuleMutation.mutate()}
            >
              {t('common.create', 'Создать правило')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
