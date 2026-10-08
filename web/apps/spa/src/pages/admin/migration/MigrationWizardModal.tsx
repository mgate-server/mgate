import React, { useState } from 'react';
import {
  Globe,
  Server,
  KeyRound,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  Upload,
  Download,
  Plus,
  Trash2,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { Button, Card, Input, Modal, Badge } from '@mgate/ui';
import { fetchApi } from '../../../lib/apiClient';

export interface MigrationWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (batchId: string) => void;
  existingDomains: Array<{ id: string; name: string }>;
}

interface SourcePreset {
  id: string;
  name: string;
  badge: string;
  badgeBg: string;
  host: string;
  port: number;
  ssl: boolean;
  hint: string;
}

const PRESETS: SourcePreset[] = [
  {
    id: 'yandex',
    name: 'Яндекс 360',
    badge: 'Я',
    badgeBg: 'bg-red-500/10 text-red-500 border-red-500/20',
    host: 'imap.yandex.ru',
    port: 993,
    ssl: true,
    hint: 'В Яндекс ID включите «Пароли приложений» -> создайте пароль типа «Почта».',
  },
  {
    id: 'mailru',
    name: 'VK WorkSpace (Mail.ru)',
    badge: 'VK',
    badgeBg: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    host: 'imap.mail.ru',
    port: 993,
    ssl: true,
    hint: 'В настройках безопасности Mail.ru создайте «Пароль для внешних приложений».',
  },
  {
    id: 'google',
    name: 'Google Workspace',
    badge: 'G',
    badgeBg: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    host: 'imap.gmail.com',
    port: 993,
    ssl: true,
    hint: 'Включите доступ IMAP в Gmail и создайте пароль приложения в аккаунте Google.',
  },
  {
    id: 'm365',
    name: 'Microsoft 365',
    badge: 'M365',
    badgeBg: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    host: 'outlook.office365.com',
    port: 993,
    ssl: true,
    hint: 'Убедитесь, что протокол IMAP включен для пользователей в админ-центре M365.',
  },
  {
    id: 'custom',
    name: 'Произвольный IMAP',
    badge: 'IMAP',
    badgeBg: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    host: '',
    port: 993,
    ssl: true,
    hint: 'cPanel, ISPmanager, Mailcow, Postfix или любой другой почтовый сервер с IMAP.',
  },
];

interface AccountItem {
  id: string;
  sourceUser: string;
  sourcePass: string;
  targetLocalPart: string;
  targetPass?: string;
  testStatus: 'idle' | 'testing' | 'success' | 'failed';
  testError?: string;
  folders?: string[];
}

function generatePassword(length = 14): string {
  const charset = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  let ret = '';
  const cryptoObj = window.crypto || (window as unknown as { msCrypto: Crypto }).msCrypto;
  const values = new Uint32Array(length);
  cryptoObj.getRandomValues(values);
  for (let i = 0; i < length; i++) {
    ret += charset[(values[i] ?? 0) % charset.length];
  }
  return ret;
}

export function MigrationWizardModal({
  isOpen,
  onClose,
  onSuccess,
  existingDomains,
}: MigrationWizardModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Source
  const [selectedPreset, setSelectedPreset] = useState<string>('yandex');
  const [sourceHost, setSourceHost] = useState('imap.yandex.ru');
  const [sourcePort, setSourcePort] = useState(993);
  const [sourceSsl, setSourceSsl] = useState(true);
  const [batchName, setBatchName] = useState('Миграция с Яндекс 360');

  // Step 2: Target Domain
  const [targetDomainMode, setTargetDomainMode] = useState<'existing' | 'new'>(
    existingDomains.length > 0 ? 'existing' : 'new'
  );
  const [selectedDomainId, setSelectedDomainId] = useState<string>(
    existingDomains[0]?.id || ''
  );
  const [newDomainName, setNewDomainName] = useState('');

  // Step 3: Accounts
  const [accounts, setAccounts] = useState<AccountItem[]>([
    {
      id: '1',
      sourceUser: '',
      sourcePass: '',
      targetLocalPart: '',
      testStatus: 'idle',
    },
  ]);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [csvText, setCsvText] = useState('');
  const [isTestingAll, setIsTestingAll] = useState(false);

  // Step 4: Password policy
  const [passwordMode, setPasswordMode] = useState<'keep' | 'generate'>('keep');

  // Global submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSelectPreset = (p: SourcePreset) => {
    setSelectedPreset(p.id);
    if (p.host) {
      setSourceHost(p.host);
      setSourcePort(p.port);
      setSourceSsl(p.ssl);
    }
    setBatchName(`Миграция с ${p.name}`);
  };

  const getTargetDomainName = (): string => {
    if (targetDomainMode === 'existing') {
      const found = existingDomains.find((d) => d.id === selectedDomainId);
      return found ? found.name : '';
    }
    return newDomainName.trim();
  };

  const handleAddAccountRow = () => {
    setAccounts((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2, 9),
        sourceUser: '',
        sourcePass: '',
        targetLocalPart: '',
        testStatus: 'idle',
      },
    ]);
  };

  const handleRemoveAccountRow = (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleAccountChange = (id: string, field: keyof AccountItem, value: string) => {
    setAccounts((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const updated = { ...a, [field]: value, testStatus: 'idle' as const, testError: undefined };
        if (field === 'sourceUser' && !a.targetLocalPart) {
          const lp = value.includes('@') ? value.split('@')[0] || value : value;
          updated.targetLocalPart = lp;
        }
        return updated;
      })
    );
  };

  const handleParseCsv = () => {
    if (!csvText.trim()) return;
    const lines = csvText.split('\n');
    const parsed: AccountItem[] = [];

    for (const line of lines) {
      const parts = line.split(/[;,]/).map((s) => s.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const user = parts[0];
        const pass = parts[1];
        const targetLp = parts[2] || (user.includes('@') ? user.split('@')[0] || user : user);
        parsed.push({
          id: Math.random().toString(36).slice(2, 9),
          sourceUser: user,
          sourcePass: pass,
          targetLocalPart: targetLp,
          testStatus: 'idle',
        });
      }
    }

    if (parsed.length > 0) {
      setAccounts(parsed);
      setCsvText('');
    }
  };

  const testSingleAccount = async (account: AccountItem) => {
    if (!account.sourceUser || !account.sourcePass) return;

    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, testStatus: 'testing' } : a))
    );

    try {
      const res = await fetchApi('/api/v1/admin/migration/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_host: sourceHost,
          source_port: sourcePort,
          source_ssl: sourceSsl,
          source_user: account.sourceUser,
          source_password: account.sourcePass,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === account.id
              ? { ...a, testStatus: 'success', folders: data.folders || [], testError: undefined }
              : a
          )
        );
      } else {
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === account.id
              ? { ...a, testStatus: 'failed', testError: data.error || 'Ошибка авторизации' }
              : a
          )
        );
      }
    } catch (e: unknown) {
      const errStr = e instanceof Error ? e.message : 'Сетевая ошибка';
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === account.id ? { ...a, testStatus: 'failed', testError: errStr } : a
        )
      );
    }
  };

  const handleTestAllAccounts = async () => {
    setIsTestingAll(true);
    for (const acc of accounts) {
      if (acc.sourceUser && acc.sourcePass) {
        await testSingleAccount(acc);
      }
    }
    setIsTestingAll(false);
  };

  const handleApplyGeneratePasswords = () => {
    setAccounts((prev) =>
      prev.map((a) => ({
        ...a,
        targetPass: generatePassword(),
      }))
    );
  };

  const handleExportCsvWithPasswords = () => {
    const domain = getTargetDomainName();
    const rows = [
      ['Email в MGate', 'Новый пароль', 'Исходный логин'],
      ...accounts.map((a) => [
        `${a.targetLocalPart}@${domain}`,
        a.targetPass || a.sourcePass,
        a.sourceUser,
      ]),
    ];
    const csvContent =
      'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `mgate_passwords_${domain}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmitMigration = async () => {
    setSubmitError(null);
    const domain = getTargetDomainName();
    if (!domain) {
      setSubmitError('Укажите целевой домен');
      return;
    }

    const validAccounts = accounts.filter((a) => a.sourceUser.trim() && a.sourcePass.trim());
    if (validAccounts.length === 0) {
      setSubmitError('Добавьте хотя бы один почтовый ящик для переноса');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: batchName || `Перенос на ${domain}`,
        source_type: selectedPreset,
        source_host: sourceHost,
        source_port: sourcePort,
        source_ssl: sourceSsl,
        target_domain: targetDomainMode === 'existing' ? selectedDomainId : newDomainName,
        create_domain_if_missing: targetDomainMode === 'new',
        mailboxes: validAccounts.map((a) => ({
          source_user: a.sourceUser.trim(),
          source_password: a.sourcePass.trim(),
          target_address: `${a.targetLocalPart.trim()}@${domain}`,
          target_password: passwordMode === 'generate' ? a.targetPass : undefined,
          quota_bytes: 10 * 1024 * 1024 * 1024,
        })),
      };

      const res = await fetchApi('/api/v1/admin/migration/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || `HTTP ${res.status}`);
      }

      const createdBatch = await res.json();
      onSuccess(createdBatch.id);
      onClose();
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Не удалось запустить миграцию');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Мастер импорта и миграции почты"
      size="xl"
    >
      <div className="space-y-6">
        {/* Step indicator */}
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-4 text-xs font-medium">
          <div
            className={`flex items-center gap-2 cursor-pointer ${
              step === 1 ? 'text-[var(--primary)] font-semibold' : 'text-[var(--muted-foreground)]'
            }`}
            onClick={() => setStep(1)}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                step === 1
                  ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                  : 'border-[var(--border)]'
              }`}
            >
              1
            </span>
            <span>Источник</span>
          </div>
          <div className="h-px w-8 bg-[var(--border)]" />
          <div
            className={`flex items-center gap-2 cursor-pointer ${
              step === 2 ? 'text-[var(--primary)] font-semibold' : 'text-[var(--muted-foreground)]'
            }`}
            onClick={() => setStep(2)}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                step === 2
                  ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                  : 'border-[var(--border)]'
              }`}
            >
              2
            </span>
            <span>Целевой домен</span>
          </div>
          <div className="h-px w-8 bg-[var(--border)]" />
          <div
            className={`flex items-center gap-2 cursor-pointer ${
              step === 3 ? 'text-[var(--primary)] font-semibold' : 'text-[var(--muted-foreground)]'
            }`}
            onClick={() => setStep(3)}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                step === 3
                  ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                  : 'border-[var(--border)]'
              }`}
            >
              3
            </span>
            <span>Ящики и проверка</span>
          </div>
          <div className="h-px w-8 bg-[var(--border)]" />
          <div
            className={`flex items-center gap-2 cursor-pointer ${
              step === 4 ? 'text-[var(--primary)] font-semibold' : 'text-[var(--muted-foreground)]'
            }`}
            onClick={() => setStep(4)}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                step === 4
                  ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                  : 'border-[var(--border)]'
              }`}
            >
              4
            </span>
            <span>Пароли и старт</span>
          </div>
        </div>

        {submitError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {/* STEP 1: Source Selection */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Выберите исходный почтовый сервис</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PRESETS.map((p) => {
                const isSelected = selectedPreset === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => handleSelectPreset(p)}
                    className={`flex cursor-pointer flex-col justify-between rounded-lg border p-4 transition-all ${
                      isSelected
                        ? 'border-[var(--primary)] bg-[var(--primary)]/5 shadow-sm'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{p.name}</span>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-xs font-bold ${p.badgeBg}`}
                      >
                        {p.badge}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">{p.hint}</p>
                  </div>
                );
              })}
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-4 space-y-3">
              <h4 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
                Параметры IMAP-сервера
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">
                    Хост сервера IMAP
                  </label>
                  <Input
                    value={sourceHost}
                    onChange={(e) => setSourceHost(e.target.value)}
                    placeholder="imap.example.com"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">Порт</label>
                  <Input
                    type="number"
                    value={sourcePort}
                    onChange={(e) => setSourcePort(parseInt(e.target.value) || 993)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="source_ssl"
                  checked={sourceSsl}
                  onChange={(e) => setSourceSsl(e.target.checked)}
                  className="rounded border-[var(--border)]"
                />
                <label htmlFor="source_ssl" className="text-xs font-medium cursor-pointer">
                  Использовать защищенное подключение (SSL / TLS)
                </label>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--muted-foreground)]">
                Название пакета миграции
              </label>
              <Input
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                placeholder="Миграция сотрудников"
              />
            </div>
          </div>
        )}

        {/* STEP 2: Target Domain */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Выберите целевой домен в MGate</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div
                onClick={() => setTargetDomainMode('existing')}
                className={`cursor-pointer rounded-lg border p-4 transition-all ${
                  targetDomainMode === 'existing'
                    ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                    : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Globe className="h-4 w-4 text-[var(--primary)]" />
                  <span>Существующий домен</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Перенести ящики в уже подключенный к MGate домен
                </p>
              </div>

              <div
                onClick={() => setTargetDomainMode('new')}
                className={`cursor-pointer rounded-lg border p-4 transition-all ${
                  targetDomainMode === 'new'
                    ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                    : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Plus className="h-4 w-4 text-[var(--primary)]" />
                  <span>Добавить новый домен</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Автоматически создаст домен и сгенерирует ключи DKIM (RSA 2048)
                </p>
              </div>
            </div>

            {targetDomainMode === 'existing' ? (
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--muted-foreground)]">
                  Домен в системе
                </label>
                {existingDomains.length > 0 ? (
                  <select
                    value={selectedDomainId}
                    onChange={(e) => setSelectedDomainId(e.target.value)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
                  >
                    {existingDomains.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-amber-500">
                    В системе нет добавленных доменов. Переключитесь на «Добавить новый домен».
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--muted-foreground)]">
                  Имя нового домена
                </label>
                <Input
                  value={newDomainName}
                  onChange={(e) => setNewDomainName(e.target.value)}
                  placeholder="example.com"
                />
                <p className="text-xs text-[var(--muted-foreground)]">
                  Домен будет автоматически зарегистрирован со статусом ожидания DNS. После миграции
                  вы сможете настроить DNS-записи по подсказкам в панели.
                </p>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Accounts and Validation */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Список переносимых ящиков</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Укажите учетные данные от исходного сервера и проверьте подключение.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestAllAccounts}
                  disabled={isTestingAll || accounts.length === 0}
                >
                  {isTestingAll ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mr-1" />
                  )}
                  Проверить все аккаунты
                </Button>
                <Button variant="outline" size="sm" onClick={handleAddAccountRow}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Добавить строку
                </Button>
              </div>
            </div>

            {/* Quick CSV input collapse */}
            <details className="rounded-lg border border-[var(--border)] p-3 text-xs bg-[var(--muted)]/10">
              <summary className="cursor-pointer font-medium text-[var(--primary)] select-none">
                Быстрая вставка списком из CSV / Буфера обмена
              </summary>
              <div className="mt-3 space-y-2">
                <textarea
                  rows={4}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={`alice@example.com,app-password-123\nbob@example.com,app-password-456`}
                  className="w-full rounded border border-[var(--border)] bg-[var(--background)] p-2 font-mono text-xs"
                />
                <Button size="sm" onClick={handleParseCsv} disabled={!csvText.trim()}>
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  Применить список
                </Button>
              </div>
            </details>

            {/* Accounts table */}
            <div className="max-h-[350px] overflow-y-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--muted)]/50 font-medium">
                  <tr>
                    <th className="p-2">Исходный логин (email)</th>
                    <th className="p-2">Пароль / Пароль приложения</th>
                    <th className="p-2">Ящик в MGate</th>
                    <th className="p-2 text-center">Проверка связи</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {accounts.map((acc) => {
                    const isShown = showPasswords[acc.id];
                    return (
                      <tr key={acc.id} className="hover:bg-[var(--muted)]/20">
                        <td className="p-2">
                          <input
                            type="text"
                            value={acc.sourceUser}
                            onChange={(e) =>
                              handleAccountChange(acc.id, 'sourceUser', e.target.value)
                            }
                            placeholder="user@example.com"
                            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="p-2">
                          <div className="relative">
                            <input
                              type={isShown ? 'text' : 'password'}
                              value={acc.sourcePass}
                              onChange={(e) =>
                                handleAccountChange(acc.id, 'sourcePass', e.target.value)
                              }
                              placeholder="••••••••"
                              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 pr-7 text-xs font-mono"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setShowPasswords((p) => ({ ...p, [acc.id]: !p[acc.id] }))
                              }
                              className="absolute right-1.5 top-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                            >
                              {isShown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={acc.targetLocalPart}
                              onChange={(e) =>
                                handleAccountChange(acc.id, 'targetLocalPart', e.target.value)
                              }
                              placeholder="user"
                              className="w-24 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                            />
                            <span className="text-[var(--muted-foreground)]">
                              @{getTargetDomainName() || 'домен'}
                            </span>
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          {acc.testStatus === 'testing' && (
                            <span className="inline-flex items-center gap-1 text-xs text-[var(--primary)]">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Проверка...
                            </span>
                          )}
                          {acc.testStatus === 'success' && (
                            <span
                              className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500 font-medium"
                              title={
                                acc.folders && acc.folders.length > 0
                                  ? `Папки: ${acc.folders.slice(0, 4).join(', ')}...`
                                  : 'Подключено'
                              }
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              OK ({acc.folders?.length || 0} папок)
                            </span>
                          )}
                          {acc.testStatus === 'failed' && (
                            <span
                              className="inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-xs text-red-500"
                              title={acc.testError}
                            >
                              <XCircle className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate max-w-[120px]">{acc.testError}</span>
                            </span>
                          )}
                          {acc.testStatus === 'idle' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => testSingleAccount(acc)}
                              disabled={!acc.sourceUser || !acc.sourcePass}
                            >
                              Проверить
                            </Button>
                          )}
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveAccountRow(acc.id)}
                            className="text-[var(--muted-foreground)] hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* STEP 4: Password Policy & Launch */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Пароли для доступа пользователей к MGate</h3>
            <div className="space-y-3">
              <div
                onClick={() => setPasswordMode('keep')}
                className={`cursor-pointer rounded-lg border p-3 transition-all ${
                  passwordMode === 'keep'
                    ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                    : 'border-[var(--border)]'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name="pw_mode"
                    checked={passwordMode === 'keep'}
                    onChange={() => setPasswordMode('keep')}
                  />
                  <span>Сохранить исходные пароли</span>
                </div>
                <p className="mt-1 ml-5 text-xs text-[var(--muted-foreground)]">
                  Пароли локальных ящиков MGate будут установлены такими же, как на исходном
                  сервере. Пользователям не придется менять настройки в своих почтовых программах.
                </p>
              </div>

              <div
                onClick={() => {
                  setPasswordMode('generate');
                  handleApplyGeneratePasswords();
                }}
                className={`cursor-pointer rounded-lg border p-3 transition-all ${
                  passwordMode === 'generate'
                    ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                    : 'border-[var(--border)]'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name="pw_mode"
                    checked={passwordMode === 'generate'}
                    onChange={() => {
                      setPasswordMode('generate');
                      handleApplyGeneratePasswords();
                    }}
                  />
                  <span>Сгенерировать новые случайные пароли для MGate</span>
                </div>
                <p className="mt-1 ml-5 text-xs text-[var(--muted-foreground)]">
                  Рекомендуется, если на исходном сервере использовались пароли приложений, а для
                  MGate требуется установить новые корпоративные пароли.
                </p>
                {passwordMode === 'generate' && (
                  <div className="mt-3 ml-5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportCsvWithPasswords();
                      }}
                    >
                      <Download className="h-3.5 w-3.5 mr-1" />
                      Скачать CSV-памятку с новыми паролями
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Summary card */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-4 space-y-2 text-xs">
              <h4 className="font-semibold text-sm">Сводка перед запуском:</h4>
              <div className="grid grid-cols-2 gap-2 text-[var(--muted-foreground)]">
                <div>
                  Источник: <span className="font-medium text-[var(--foreground)]">{sourceHost}</span>
                </div>
                <div>
                  Целевой домен:{' '}
                  <span className="font-medium text-[var(--foreground)]">
                    {getTargetDomainName()}
                  </span>
                </div>
                <div>
                  Всего ящиков:{' '}
                  <span className="font-medium text-[var(--foreground)]">
                    {accounts.filter((a) => a.sourceUser).length}
                  </span>
                </div>
                <div>
                  Проверено успешно:{' '}
                  <span className="font-medium text-emerald-500">
                    {accounts.filter((a) => a.testStatus === 'success').length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Navigation */}
        <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
          {step > 1 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}
              disabled={isSubmitting}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Назад
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
              Отмена
            </Button>
          )}

          {step < 4 ? (
            <Button
              size="sm"
              onClick={() => {
                if (step === 2 && !getTargetDomainName()) {
                  setSubmitError('Укажите домен для перехода к следующему шагу');
                  return;
                }
                setSubmitError(null);
                setStep((s) => (s + 1) as 1 | 2 | 3 | 4);
              }}
            >
              Далее
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmitMigration}
              disabled={isSubmitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  Создание задач...
                </>
              ) : (
                'Запустить перенос писем'
              )}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
