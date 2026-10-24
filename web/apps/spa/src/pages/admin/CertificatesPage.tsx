import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Modal, PageHeader, Table } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import type { components } from '@mgate/api-client';
import { fetchApi } from '../../lib/apiClient';
import { readApiError } from '../../lib/apiError';
import { sourceLabel, statusLabel, statusTone } from './certificateLabels';

/**
 * `source` is `uploaded` (own certificate), `self_signed` (installation default) or `acme` (not
 * issued by this release); `status` is `pending`, `valid`, `expiring`, `expired` or `error`.
 */
type CertificateRow = components['schemas']['CertificateResponse'];

export function CertificatesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [certName, setCertName] = useState('');
  const [sansStr, setSansStr] = useState('');
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [renewingId, setRenewingId] = useState<string | null>(null);

  const { data: certificates = [], isLoading } = useQuery<CertificateRow[]>({
    queryKey: ['admin', 'certificates'],
    queryFn: async () => {
      const res = await fetchApi('/api/v1/admin/certificates', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load certificates');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchApi(`/api/v1/admin/certificates/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to delete certificate'));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'certificates'] });
    },
  });

  const renewMutation = useMutation({
    mutationFn: async (id: string) => {
      setRenewingId(id);
      const res = await fetchApi(`/api/v1/admin/certificates/${id}/renew`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to renew certificate'));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'certificates'] });
      setRenewingId(null);
    },
    onError: (err: Error) => {
      setRenewingId(null);
      alert(err.message);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!certPem.trim() || !keyPem.trim()) {
        throw new Error('Вставьте цепочку сертификата и приватный ключ в формате PEM');
      }
      const sans = sansStr
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetchApi('/api/v1/admin/certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          // Optional: the server derives the name from the certificate's first host name.
          ...(certName.trim() ? { name: certName.trim() } : {}),
          sans,
          cert_pem: certPem,
          key_pem: keyPem,
        }),
      });

      if (!res.ok) {
        // 422 carries the concrete cause (bad chain, key mismatch, expired, name not covered)
        // in `error.details.reason`; `error.message` is only a generic sentence.
        throw new Error(await readApiError(res, 'Failed to upload certificate'));
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'certificates'] });
      setUploadOpen(false);
      setCertName('');
      setSansStr('');
      setCertPem('');
      setKeyPem('');
      setFormError(null);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const columns: TableColumn<CertificateRow>[] = [
    {
      key: 'name',
      header: t('admin.certs.name', 'Имя сертификата'),
      render: (row) => (
        <div>
          <span className="text-mg-text font-medium">{row.name}</span>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {row.sans.map((s, i) => (
              <span key={i} className="text-mg-text-muted font-mono text-xs">
                {s}
                {i < row.sans.length - 1 ? ',' : ''}
              </span>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: 'source',
      header: t('admin.certs.source', 'Источник'),
      render: (row) => (
        <Badge tone={row.source === 'uploaded' ? 'primary' : 'neutral'}>
          {sourceLabel(row.source, t)}
        </Badge>
      ),
    },
    {
      key: 'validity',
      header: t('admin.certs.validity', 'Действителен до'),
      render: (row) => {
        if (!row.not_after) return <span className="text-mg-text-muted text-xs">—</span>;
        const expiry = new Date(row.not_after);
        const daysLeft = Math.round((expiry.getTime() - Date.now()) / (1000 * 3600 * 24));
        const isExpiring = daysLeft < 14;
        const isExpired = daysLeft <= 0;

        return (
          <div>
            <p className="text-xs">{expiry.toLocaleDateString()}</p>
            <span
              className={`text-[11px] ${
                isExpired
                  ? 'text-mg-danger font-semibold'
                  : isExpiring
                    ? 'font-semibold text-amber-500'
                    : 'text-mg-text-muted'
              }`}
            >
              {isExpired ? 'Истек' : `Осталось ${daysLeft} ${daysLeft === 1 ? 'день' : 'дней'}`}
            </span>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('common.status', 'Статус'),
      render: (row) => (
        <div>
          <Badge tone={statusTone(row.status)}>{statusLabel(row.status, t)}</Badge>
          {row.status === 'error' && row.last_error ? (
            <p className="text-mg-danger mt-0.5 max-w-xs text-[11px] break-words">
              {row.last_error}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end gap-2">
          {row.source === 'acme' && (
            <Button
              size="sm"
              variant="secondary"
              loading={renewingId === row.id}
              onClick={() => renewMutation.mutate(row.id)}
            >
              {t('admin.certs.renew', 'Обновить')}
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirm(t('admin.certs.confirmDelete', `Удалить сертификат ${row.name}?`))) {
                deleteMutation.mutate(row.id);
              }
            }}
          >
            {t('common.delete', 'Удалить')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.admin.certificates')}
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            {t('admin.certs.upload', 'Загрузить сертификат')}
          </Button>
        }
      />

      <div className="border-mg-border-subtle bg-mg-surface-subtle/40 text-mg-text-muted rounded-lg border p-3 text-xs leading-relaxed">
        {t(
          'admin.certs.info',
          'MGate автоматически выпускает и продлевает TLS-сертификаты (Let\'s Encrypt / ZeroSSL) через фоновый ACME-клиент для хоста сервера и доменов. Также поддерживается загрузка собственных сертификатов.',
        )}
      </div>

      <Card>
        <Table
          columns={columns}
          rows={certificates}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t(
            'admin.certs.empty',
            'Сертификаты не найдены. Загрузите собственный сертификат: автоматический выпуск Let’s Encrypt в разработке.',
          )}
        />
      </Card>

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title={t('admin.certs.uploadTitle', 'Загрузить кастомный SSL/TLS сертификат')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>
              {t('common.cancel', 'Отмена')}
            </Button>
            <Button onClick={() => uploadMutation.mutate()} isLoading={uploadMutation.isPending}>
              {t('admin.certs.uploadSubmit', 'Загрузить')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label={t('admin.certs.nameOptional', 'Имя (необязательно)')}
            value={certName}
            onChange={(e) => setCertName(e.target.value)}
            placeholder="custom-mail-cert"
          />

          <Input
            label={t('admin.certs.domains', 'Домены / SANs (через запятую)')}
            value={sansStr}
            onChange={(e) => setSansStr(e.target.value)}
            placeholder="mail.example.com, imap.example.com"
          />

          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">
              {t('admin.certs.chainPem', 'Сертификат (Chain PEM)')}
            </label>
            <textarea
              className="border-mg-border bg-mg-surface text-mg-text w-full rounded-md border p-2 font-mono text-xs"
              rows={4}
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
            />
          </div>

          <div>
            <label className="text-mg-text mb-1 block text-xs font-medium">
              {t('admin.certs.keyPem', 'Приватный ключ (Private Key PEM)')}
            </label>
            <textarea
              className="border-mg-border bg-mg-surface text-mg-text w-full rounded-md border p-2 font-mono text-xs"
              rows={4}
              value={keyPem}
              onChange={(e) => setKeyPem(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
            />
          </div>

          {formError ? <p className="text-mg-danger text-sm">{formError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
