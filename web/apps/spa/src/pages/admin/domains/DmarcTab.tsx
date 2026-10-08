import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Lock,
  UploadCloud,
  FileCode,
  Calendar,
  RefreshCw,
  Globe,
  Server,
  ArrowUpRight,
  TrendingUp,
} from 'lucide-react';
import { Badge, Button, Card, Modal, cn } from '@mgate/ui';
import { fetchApi } from '../../../lib/apiClient';

interface DmarcDailyStat {
  date: string;
  total: number;
  pass: number;
  fail: number;
}

interface DmarcSourceItem {
  source_ip: string;
  message_count: number;
  disposition: string;
  dkim_result: string;
  spf_result: string;
  header_from: string;
  hostname: string | null;
  country: string | null;
  reporter_org: string;
  report_id: string;
  raw_xml_available: boolean;
}

interface DmarcSummaryResponse {
  domain_name: string;
  is_pro: boolean;
  total_messages: number;
  dmarc_pass_count: number;
  dmarc_fail_count: number;
  dkim_pass_count: number;
  spf_pass_count: number;
  compliance_rate: number;
  spf_pass_rate: number;
  dkim_pass_rate: number;
  policy_readiness: 'ready_for_reject' | 'ready_for_quarantine' | 'needs_improvement';
  daily_stats: DmarcDailyStat[];
  sources: DmarcSourceItem[];
}

export function DmarcTab({ domainId, domainName }: { domainId: string; domainName: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [days, setDays] = useState<number>(7);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [xmlContent, setXmlContent] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: dmarc, isLoading, refetch } = useQuery<DmarcSummaryResponse>({
    queryKey: ['admin', 'domains', domainId, 'dmarc', days],
    queryFn: async () => {
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/dmarc/summary?days=${days}`);
      if (!res.ok) throw new Error('Failed to fetch DMARC summary');
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (xml: string) => {
      setUploadError(null);
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/dmarc/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error?.message || 'Ошибка импорта RUA XML отчета');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains', domainId, 'dmarc'] });
      setUploadModalOpen(false);
      setXmlContent('');
    },
    onError: (err: Error) => {
      setUploadError(err.message);
    },
  });

  const downloadRawXml = async (reportId: string) => {
    try {
      const res = await fetchApi(`/api/v1/admin/domains/${domainId}/dmarc/reports/${reportId}/raw`);
      if (!res.ok) throw new Error('Не удалось загрузить XML');
      const xml = await res.text();
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dmarc-report-${reportId}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert((err instanceof Error && err.message) || 'Ошибка скачивания отчета');
    }
  };

  const isPro = dmarc?.is_pro ?? false;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-mg-border-subtle bg-mg-surface-subtle/30">
        <div>
          <h3 className="text-sm font-semibold text-mg-text flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-mg-primary" />
            <span>DMARC-Аналитика и защита доставляемости</span>
          </h3>
          <p className="text-xs text-mg-text-muted mt-0.5">
            Анализ входящих RUA отчётов почтовых провайдеров (Google, Mail.ru, Yandex, Yahoo) для защиты домена от спуфинга и фишинга.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Days range selector */}
          <div className="flex items-center rounded-lg border border-mg-border-subtle p-0.5 bg-mg-surface">
            <button
              type="button"
              onClick={() => setDays(7)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                days === 7 ? 'bg-mg-primary text-white' : 'text-mg-text-muted hover:text-mg-text',
              )}
            >
              7 дней
            </button>
            <button
              type="button"
              onClick={() => {
                if (isPro) setDays(30);
                else alert('История отчетов более 7 дней доступна в Pro версии');
              }}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1',
                days === 30 ? 'bg-mg-primary text-white' : 'text-mg-text-muted hover:text-mg-text',
                !isPro && 'opacity-60 cursor-not-allowed',
              )}
            >
              <span>30 дней</span>
              {!isPro && <Lock className="w-3 h-3 text-amber-500" />}
            </button>
            <button
              type="button"
              onClick={() => {
                if (isPro) setDays(90);
                else alert('История отчетов более 7 дней доступна в Pro версии');
              }}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1',
                days === 90 ? 'bg-mg-primary text-white' : 'text-mg-text-muted hover:text-mg-text',
                !isPro && 'opacity-60 cursor-not-allowed',
              )}
            >
              <span>90 дней</span>
              {!isPro && <Lock className="w-3 h-3 text-amber-500" />}
            </button>
          </div>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => setUploadModalOpen(true)}
            className="gap-1.5"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Импорт RUA XML</span>
          </Button>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => refetch()}
            isLoading={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            <span>Обновить</span>
          </Button>
        </div>
      </div>

      {/* Policy Readiness Status Card */}
      {dmarc && (
        <div
          className={cn(
            'p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3',
            dmarc.policy_readiness === 'ready_for_reject' &&
              'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300',
            dmarc.policy_readiness === 'ready_for_quarantine' &&
              'bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300',
            dmarc.policy_readiness === 'needs_improvement' &&
              'bg-rose-500/10 border-rose-500/20 text-rose-800 dark:text-rose-300',
          )}
        >
          <div className="flex items-center gap-3">
            {dmarc.policy_readiness === 'ready_for_reject' && (
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            )}
            {dmarc.policy_readiness === 'ready_for_quarantine' && (
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
            )}
            {dmarc.policy_readiness === 'needs_improvement' && (
              <ShieldAlert className="w-6 h-6 text-rose-600 shrink-0" />
            )}
            <div>
              <h4 className="text-xs font-bold">
                {dmarc.policy_readiness === 'ready_for_reject' && 'Домен готов к строгой политике p=reject'}
                {dmarc.policy_readiness === 'ready_for_quarantine' && 'Рекомендуется политика p=quarantine'}
                {dmarc.policy_readiness === 'needs_improvement' && 'Обнаружены ошибки аутентификации (рекомендуется p=none)'}
              </h4>
              <p className="text-[11px] opacity-90 mt-0.5">
                {dmarc.policy_readiness === 'ready_for_reject' &&
                  `Уровень соответствия DMARC составляет ${dmarc.compliance_rate.toFixed(1)}%. Легитимная почта успешно проходит проверки SPF и DKIM.`}
                {dmarc.policy_readiness === 'ready_for_quarantine' &&
                  `Уровень соответствия DMARC составляет ${dmarc.compliance_rate.toFixed(1)}%. Перевод в p=quarantine защитит от подделок без риска потери важных писем.`}
                {dmarc.policy_readiness === 'needs_improvement' &&
                  `Уровень соответствия DMARC составляет ${dmarc.compliance_rate.toFixed(1)}%. Проверьте настройки DKIM и SPF перед ужесточением политики.`}
              </p>
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full border uppercase bg-mg-surface">
              {dmarc.policy_readiness.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      )}

      {/* Metrics 4-grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 space-y-1">
          <div className="text-[11px] font-medium text-mg-text-muted">Всего проверено писем</div>
          <div className="text-xl font-bold text-mg-text">
            {isLoading ? '...' : (dmarc?.total_messages ?? 0).toLocaleString()}
          </div>
          <div className="text-[11px] text-mg-text-muted">
            за последние {days} дней
          </div>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="text-[11px] font-medium text-mg-text-muted">DMARC Соответствие</div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
            {isLoading ? '...' : `${(dmarc?.compliance_rate ?? 100).toFixed(1)}%`}
          </div>
          <div className="text-[11px] text-mg-text-muted">
            {dmarc?.dmarc_pass_count ?? 0} успешно / {dmarc?.dmarc_fail_count ?? 0} отклонено
          </div>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="text-[11px] font-medium text-mg-text-muted">SPF Успешность</div>
          <div className="text-xl font-bold text-mg-primary">
            {isLoading ? '...' : `${(dmarc?.spf_pass_rate ?? 100).toFixed(1)}%`}
          </div>
          <div className="text-[11px] text-mg-text-muted">
            {dmarc?.spf_pass_count ?? 0} валидных SPF
          </div>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="text-[11px] font-medium text-mg-text-muted">DKIM Успешность</div>
          <div className="text-xl font-bold text-indigo-500">
            {isLoading ? '...' : `${(dmarc?.dkim_pass_rate ?? 100).toFixed(1)}%`}
          </div>
          <div className="text-[11px] text-mg-text-muted">
            {dmarc?.dkim_pass_count ?? 0} валидных подписей
          </div>
        </Card>
      </div>

      {/* Freemium Banner if not Pro */}
      {!isPro && (
        <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>DMARC Intelligence Pro</span>
            </div>
            <p className="text-[11px] text-mg-text-muted">
              Во Free-версии IP-адреса спуфинга маскируются. В Pro версии доступна полная деанонимизация атакующих серверов, PTR/ASN, география атак и скачивание сырых XML RUA отчётов.
            </p>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => window.location.assign('/admin/license')}
            className="shrink-0 text-xs"
          >
            Подробнее о Pro
          </Button>
        </div>
      )}

      {/* Sources & Spoofing incidents table */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between border-b border-mg-border-subtle pb-3">
          <div>
            <h4 className="text-xs font-semibold text-mg-text uppercase tracking-wider">
              Источники отправки и инциденты ({dmarc?.sources.length ?? 0})
            </h4>
            <p className="text-[11px] text-mg-text-muted">
              IP-адреса узлов, отправлявших письма от имени @{domainName}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-mg-text-muted">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto text-mg-primary mb-2" />
            <span>Загрузка источников...</span>
          </div>
        ) : dmarc?.sources && dmarc.sources.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-mg-border-subtle text-mg-text-muted text-[11px]">
                  <th className="py-2.5 px-3">IP-адрес отправителя</th>
                  <th className="py-2.5 px-3">Сообщений</th>
                  <th className="py-2.5 px-3">Политика</th>
                  <th className="py-2.5 px-3">SPF</th>
                  <th className="py-2.5 px-3">DKIM</th>
                  <th className="py-2.5 px-3">Провайдер отчета</th>
                  <th className="py-2.5 px-3 text-right">Исходный XML</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mg-border-subtle">
                {dmarc.sources.map((src, i) => (
                  <tr key={`${src.source_ip}-${i}`} className="hover:bg-mg-surface-subtle/40 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-mg-text font-semibold flex items-center gap-1.5">
                      <span>{src.source_ip}</span>
                      {!isPro && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20 font-sans">
                          PRO
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-mg-text">
                      {src.message_count}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="capitalize text-[11px] px-2 py-0.5 rounded bg-mg-surface border border-mg-border-subtle text-mg-text">
                        {src.disposition}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={cn(
                          'text-[11px] font-bold',
                          src.spf_result === 'pass'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400',
                        )}
                      >
                        {src.spf_result.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={cn(
                          'text-[11px] font-bold',
                          src.dkim_result === 'pass'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400',
                        )}
                      >
                        {src.dkim_result.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-mg-text-muted text-[11px]">
                      {src.reporter_org}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {src.raw_xml_available ? (
                        <button
                          type="button"
                          onClick={() => downloadRawXml(src.report_id)}
                          className="text-mg-primary hover:underline flex items-center gap-1 ml-auto text-[11px]"
                        >
                          <FileCode className="w-3.5 h-3.5" />
                          <span>XML</span>
                        </button>
                      ) : (
                        <span className="text-mg-text-muted text-[11px] flex items-center gap-1 justify-end opacity-60">
                          <Lock className="w-3 h-3 text-amber-500" />
                          <span>Pro</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-mg-text-muted">
            Отчётов DMARC пока не поступало. Вы можете импортировать полученный отчёт RUA XML вручную с помощью кнопки «Импорт RUA XML».
          </div>
        )}
      </Card>

      {/* Manual XML Import Modal */}
      <Modal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title="Импорт агрегированного отчёта DMARC (RUA XML)"
        footer={
          <div className="flex items-center justify-between w-full">
            <Button variant="secondary" onClick={() => setUploadModalOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => uploadMutation.mutate(xmlContent)}
              isLoading={uploadMutation.isPending}
              disabled={!xmlContent.trim()}
              className="gap-1.5"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Импортировать отчёт</span>
            </Button>
          </div>
        }
      >
        <div className="space-y-4 py-1 text-xs">
          {uploadError && (
            <div className="p-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-800 dark:text-rose-300">
              {uploadError}
            </div>
          )}

          <p className="text-mg-text-muted">
            Вставьте содержимое стандартного XML-отчета DMARC (RFC 7489 feedback report), полученного на почтовый ящик отчётов:
          </p>

          <textarea
            rows={10}
            value={xmlContent}
            onChange={(e) => setXmlContent(e.target.value)}
            placeholder="<feedback><report_metadata>...</report_metadata>...</feedback>"
            className="w-full p-3 font-mono text-xs rounded-lg bg-mg-surface border border-mg-border text-mg-text focus:outline-none focus:border-mg-primary resize-y"
          />
        </div>
      </Modal>
    </div>
  );
}
