import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  Cloud,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Info,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Modal, Button, Input, Badge, cn } from '@mgate/ui';
import { fetchApi } from '../../../lib/apiClient';

export interface DnsAutopilotModalProps {
  open: boolean;
  onClose: () => void;
  domainId: string;
  domainName: string;
  onSyncComplete?: () => void;
}

interface ToCreateRecord {
  name: string;
  record_type: string;
  content: string;
  ttl: number;
  priority: number | null;
}

interface ToUpdateRecord {
  id: string;
  name: string;
  record_type: string;
  old_content: string;
  new_content: string;
  ttl: number;
}

interface UnchangedRecord {
  id: string;
  name: string;
  record_type: string;
  content: string;
  ttl: number;
}

interface AutopilotDiffResponse {
  domain_name: string;
  provider: string;
  to_create: ToCreateRecord[];
  to_update: ToUpdateRecord[];
  unchanged: UnchangedRecord[];
}

interface AutopilotSyncResponse {
  created: number;
  updated: number;
  unchanged: number;
}

export function DnsAutopilotModal({
  open,
  onClose,
  domainId,
  domainName,
  onSyncComplete,
}: DnsAutopilotModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [provider, setProvider] = useState<'cloudflare' | 'selectel'>('cloudflare');
  const [apiToken, setApiToken] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [step, setStep] = useState<'form' | 'diff' | 'completed'>('form');
  const [diffData, setDiffData] = useState<AutopilotDiffResponse | null>(null);
  const [syncResult, setSyncResult] = useState<AutopilotSyncResponse | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleClose = () => {
    setErrorMessage(null);
    setStep('form');
    setDiffData(null);
    setSyncResult(null);
    onClose();
  };

  const diffMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/dns/autopilot/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          api_token: apiToken.trim(),
          zone_id: zoneId.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error?.message || 'Не удалось получить статус DNS-провайдера');
      }

      return res.json() as Promise<AutopilotDiffResponse>;
    },
    onSuccess: (data) => {
      setDiffData(data);
      setStep('diff');
    },
    onError: (err: Error) => {
      setErrorMessage(err.message);
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/dns/autopilot/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          api_token: apiToken.trim(),
          zone_id: zoneId.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error?.message || 'Ошибка синхронизации DNS-записей');
      }

      return res.json() as Promise<AutopilotSyncResponse>;
    },
    onSuccess: (data) => {
      setSyncResult(data);
      setStep('completed');
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains', domainId, 'dns'] });
      if (onSyncComplete) {
        onSyncComplete();
      }
    },
    onError: (err: Error) => {
      setErrorMessage(err.message);
    },
  });

  const totalChanges = (diffData?.to_create.length ?? 0) + (diffData?.to_update.length ?? 0);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <span>DNS-Автопилот: {domainName}</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="secondary" onClick={handleClose} disabled={syncMutation.isPending}>
            {step === 'completed' ? 'Закрыть' : 'Отмена'}
          </Button>

          <div className="flex items-center gap-2">
            {step === 'diff' && (
              <Button
                variant="secondary"
                onClick={() => setStep('form')}
                disabled={syncMutation.isPending}
              >
                Назад
              </Button>
            )}

            {step === 'form' && (
              <Button
                onClick={() => diffMutation.mutate()}
                isLoading={diffMutation.isPending}
                disabled={!apiToken.trim()}
                className="gap-1.5"
              >
                <Cloud className="w-4 h-4" />
                <span>Рассчитать изменения (Diff)</span>
              </Button>
            )}

            {step === 'diff' && (
              <Button
                onClick={() => syncMutation.mutate()}
                isLoading={syncMutation.isPending}
                disabled={totalChanges === 0}
                className="gap-1.5"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Применить изменения ({totalChanges})</span>
              </Button>
            )}

            {step === 'completed' && (
              <Button onClick={handleClose}>Готово</Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        {errorMessage && (
          <div className="p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {step === 'form' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl border border-blue-500/20 bg-blue-500/5 text-xs text-mg-text space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400">
                <ShieldCheck className="w-4 h-4" />
                <span>Безопасная автонастройка DNS</span>
              </div>
              <p className="text-mg-text-muted text-[11px]">
                Автопилот автоматически проверит записи MX, SPF, DKIM и DMARC для домена и синхронизирует их. Записи сайтов, поддоменов и других сервисов не удаляются.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-mg-text mb-1">
                DNS-провайдер
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as 'cloudflare' | 'selectel')}
                className="w-full p-2.5 text-xs rounded-lg bg-mg-surface border border-mg-border text-mg-text focus:outline-none focus:border-mg-primary"
              >
                <option value="cloudflare">Cloudflare DNS API</option>
                <option value="selectel">Selectel DNS API</option>
              </select>
            </div>

            <Input
              type="password"
              label={
                provider === 'cloudflare'
                  ? 'Cloudflare API Token (с правами Zone.DNS:Edit)'
                  : 'Selectel API Token'
              }
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={
                provider === 'cloudflare'
                  ? 'например, 1x_xxxxxxxxxxxxxxxxxxxxxx'
                  : 'например, sel_token_xxxxxxxx'
              }
            />

            <Input
              label="ID зоны (Zone ID, необязательно)"
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              placeholder="Оставьте пустым для автоматического поиска зоны по имени домена"
            />
          </div>
        )}

        {step === 'diff' && diffData && (
          <div className="space-y-4">
            {/* Diff metrics bar */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-center">
                <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  +{diffData.to_create.length}
                </div>
                <div className="text-[11px] text-mg-text-muted">К созданию</div>
              </div>
              <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-center">
                <div className="text-lg font-bold text-amber-600 dark:text-amber-400">
                  ~{diffData.to_update.length}
                </div>
                <div className="text-[11px] text-mg-text-muted">К обновлению</div>
              </div>
              <div className="p-3 rounded-xl border border-mg-border-subtle bg-mg-surface-subtle/30 text-center">
                <div className="text-lg font-bold text-mg-text">
                  {diffData.unchanged.length}
                </div>
                <div className="text-[11px] text-mg-text-muted">Без изменений</div>
              </div>
            </div>

            {totalChanges === 0 ? (
              <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-center space-y-1">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto" />
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  Все DNS-записи домена уже актуальны
                </p>
                <p className="text-[11px] text-mg-text-muted">
                  В зоне DNS уже присутствуют все требуемые записи с правильными значениями.
                </p>
              </div>
            ) : null}

            {/* List of records to create */}
            {diffData.to_create.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <span>Новые записи (+{diffData.to_create.length})</span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {diffData.to_create.map((rec, i) => (
                    <div
                      key={`create-${i}`}
                      className="p-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-xs font-mono space-y-1"
                    >
                      <div className="flex items-center justify-between text-[11px] font-sans">
                        <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                          {rec.record_type} {rec.name}
                        </span>
                        <span className="text-mg-text-muted">TTL: {rec.ttl}s</span>
                      </div>
                      <div className="text-emerald-800 dark:text-emerald-300 break-all text-[11px]">
                        + {rec.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* List of records to update */}
            {diffData.to_update.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <span>Обновляемые записи (~{diffData.to_update.length})</span>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {diffData.to_update.map((rec, i) => (
                    <div
                      key={`update-${i}`}
                      className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs font-mono space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px] font-sans">
                        <span className="font-semibold text-amber-700 dark:text-amber-300">
                          {rec.record_type} {rec.name}
                        </span>
                        <span className="text-mg-text-muted">TTL: {rec.ttl}s</span>
                      </div>
                      <div className="text-rose-600 dark:text-rose-400 line-through break-all text-[11px]">
                        - {rec.old_content}
                      </div>
                      <div className="text-emerald-600 dark:text-emerald-400 break-all text-[11px]">
                        + {rec.new_content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Unchanged toggle */}
            {diffData.unchanged.length > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowUnchanged(!showUnchanged)}
                  className="text-xs text-mg-text-muted hover:text-mg-text flex items-center gap-1 transition-colors"
                >
                  {showUnchanged ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <span>Записи без изменений ({diffData.unchanged.length})</span>
                </button>
                {showUnchanged && (
                  <div className="mt-2 space-y-1 max-h-36 overflow-y-auto pr-1">
                    {diffData.unchanged.map((rec, i) => (
                      <div
                        key={`unchanged-${i}`}
                        className="p-2 rounded border border-mg-border-subtle bg-mg-surface-subtle/40 text-[11px] font-mono flex items-center justify-between"
                      >
                        <span className="text-mg-text-muted">{rec.record_type} {rec.name}</span>
                        <span className="text-mg-text-muted truncate max-w-xs">{rec.content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'completed' && syncResult && (
          <div className="p-6 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
            <div>
              <h4 className="text-sm font-bold text-mg-text">
                Синхронизация успешно завершена!
              </h4>
              <p className="text-xs text-mg-text-muted mt-1">
                Создано записей: {syncResult.created}, обновлено: {syncResult.updated}, без изменений: {syncResult.unchanged}.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-mg-surface-subtle border border-mg-border-subtle text-[11px] text-mg-text-muted">
              DNS-записи отправлены в инфраструктуру {provider === 'cloudflare' ? 'Cloudflare' : 'Selectel'}. Распространение изменений по глобальным кэшам может занять от 1 до 15 минут.
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
