import React, { useState } from 'react';
import { Upload, CheckCircle2, AlertCircle, Loader2, Users } from 'lucide-react';
import { Button, Input, Modal } from '@mgate/ui';
import { fetchApi } from '../../../lib/apiClient';

export interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  domains: Array<{ id: string; name: string }>;
  defaultDomainId?: string;
}

interface ParsedMailbox {
  localPart: string;
  password: string;
  fullName?: string;
  quotaGb?: number;
}

export function BulkImportModal({
  isOpen,
  onClose,
  onSuccess,
  domains,
  defaultDomainId,
}: BulkImportModalProps) {
  const [selectedDomainId, setSelectedDomainId] = useState<string>(
    defaultDomainId || domains[0]?.id || ''
  );
  const [csvContent, setCsvContent] = useState('');
  const [parsed, setParsed] = useState<ParsedMailbox[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const selectedDomainName = domains.find((d) => d.id === selectedDomainId)?.name || '';

  const handleParse = (text: string) => {
    setCsvContent(text);
    setResult(null);
    const lines = text.split('\n');
    const items: ParsedMailbox[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const parts = trimmed.split(/[;,]/).map((p) => p.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        let lp = parts[0] || '';
        if (lp.includes('@')) {
          lp = lp.split('@')[0] || lp;
        }
        items.push({
          localPart: lp,
          password: parts[1],
          fullName: parts[2] || undefined,
          quotaGb: parts[3] ? parseFloat(parts[3]) || 10 : 10,
        });
      }
    }
    setParsed(items);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      handleParse(content || '');
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!selectedDomainId || parsed.length === 0) return;

    setIsSubmitting(true);
    setResult(null);
    try {
      const payload = {
        domain_id: selectedDomainId,
        mailboxes: parsed.map((item) => ({
          local_part: item.localPart,
          password: item.password,
          full_name: item.fullName,
          quota_bytes: (item.quotaGb || 10) * 1024 * 1024 * 1024,
        })),
      };

      const res = await fetchApi('/api/v1/admin/mailboxes/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      const resData = await res.json();
      setResult(resData);
      onSuccess();
    } catch (e: unknown) {
      setResult({
        created: 0,
        skipped: 0,
        errors: [e instanceof Error ? e.message : 'Сетевая ошибка при импорте'],
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Пакетный импорт ящиков из CSV"
      size="lg"
    >
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-[var(--muted-foreground)]">Целевой домен</label>
          <select
            value={selectedDomainId}
            onChange={(e) => setSelectedDomainId(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] p-2 text-sm mt-1"
          >
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">
              Данные CSV (логин, пароль, имя, квота_ГБ)
            </label>
            <label className="cursor-pointer text-xs font-semibold text-[var(--primary)] hover:underline">
              Загрузить файл .csv
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
          <textarea
            rows={5}
            value={csvContent}
            onChange={(e) => handleParse(e.target.value)}
            placeholder={`ivan.ivanov,SuperSecretPass123,Иван Иванов,15\npetr.petrov,AnotherSecretPass456,Петр Петров,10`}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] p-2.5 font-mono text-xs"
          />
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Формат строк: <code className="font-mono">логин,пароль[,ФИО,квота_в_ГБ]</code>.
            Разделитель: запятая или точка с запятой.
          </p>
        </div>

        {/* Results summary */}
        {result && (
          <div className="rounded-lg border border-[var(--border)] p-3 bg-[var(--muted)]/20 space-y-2 text-xs">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>
                Импорт завершен: создано <b>{result.created}</b>, пропущено (дубликаты){' '}
                <b>{result.skipped}</b>.
              </span>
            </div>
            {result.errors.length > 0 && (
              <div className="text-red-500 space-y-1">
                <p className="font-semibold">Ошибки ({result.errors.length}):</p>
                <ul className="list-disc pl-4 max-h-24 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Preview Table */}
        {parsed.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">Предпросмотр ({parsed.length} ящиков):</span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[var(--muted)]/40 border-b border-[var(--border)] font-medium">
                  <tr>
                    <th className="p-2">Будет создан email</th>
                    <th className="p-2">Пароль</th>
                    <th className="p-2">Имя</th>
                    <th className="p-2 text-right">Квота</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {parsed.map((item, idx) => (
                    <tr key={idx} className="hover:bg-[var(--muted)]/20">
                      <td className="p-2 font-mono font-medium">
                        {item.localPart}@{selectedDomainName || 'домен'}
                      </td>
                      <td className="p-2 font-mono text-[var(--muted-foreground)]">••••••••</td>
                      <td className="p-2">{item.fullName || '—'}</td>
                      <td className="p-2 text-right">{item.quotaGb} GB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal actions */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            Закрыть
          </Button>
          <Button
            size="sm"
            onClick={handleImport}
            disabled={isSubmitting || parsed.length === 0}
            className="gap-1.5"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Импорт...
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                Создать {parsed.length} ящиков
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
