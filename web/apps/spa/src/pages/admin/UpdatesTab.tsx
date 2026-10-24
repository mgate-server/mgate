import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Modal } from '@mgate/ui';
import type { components } from '@mgate/api-client';
import { fetchApi } from '../../lib/apiClient';
import { readApiError } from '../../lib/apiError';
import { isOlderVersion } from '../../lib/versionCheck';

type UpdateStatus = components['schemas']['UpdateStatus'];
type UpdateJob = components['schemas']['UpdateJob'];
const QUERY_KEY = ['admin', 'updates'];
const ACTIVE = new Set([
  'checking',
  'downloading',
  'backup',
  'installing',
  'migrating',
  'starting',
  'verifying',
]);
const BLOCKED = new Set(['interrupted', 'recovery_required']);

async function loadStatus(refresh = false): Promise<UpdateStatus> {
  const response = await fetchApi(`/api/v1/admin/updates${refresh ? '?refresh=true' : ''}`);
  if (!response.ok) throw new Error(await readApiError(response, 'Update status unavailable'));
  return response.json();
}

export function UpdatesTab() {
  const { t } = useTranslation();
  const client = useQueryClient();
  // Keep the pinned version even if a newer release appears while the dialog is open.
  const [confirmedVersion, setConfirmedVersion] = useState<string | null>(null);
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => loadStatus(),
    retry: false,
    refetchInterval: (q) =>
      q.state.error || ACTIVE.has(q.state.data?.job?.stage ?? '') ? 3000 : 60000,
  });
  const refresh = useMutation({
    mutationFn: () => loadStatus(true),
    onSuccess: (data) => client.setQueryData(QUERY_KEY, data),
  });
  const start = useMutation({
    retry: false,
    mutationFn: async (version: string): Promise<UpdateJob> => {
      const response = await fetchApi('/api/v1/admin/updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Update request failed'));
      return response.json();
    },
    onSuccess: (job) => {
      client.setQueryData<UpdateStatus>(QUERY_KEY, (current) =>
        current ? { ...current, job } : current,
      );
    },
    onSettled: () => {
      setConfirmedVersion(null);
      void client.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
  const data = query.data;
  const job = data?.job;
  const active = ACTIVE.has(job?.stage ?? '');
  const blocked = BLOCKED.has(job?.stage ?? '');
  const available =
    data?.latest_version && isOlderVersion(data.current_version, data.latest_version);

  return (
    <Card title={t('updates.title')} className="space-y-4">
      {query.isPending && <p>{t('common.loading')}</p>}
      {data && (
        <>
          <p>
            {t('updates.current')}: <strong>{data.current_version}</strong>
          </p>
          <p>
            {t('updates.latest')}: <strong>{data.latest_version ?? '—'}</strong>
          </p>
          {data.release_url && (
            <a
              className="text-mg-primary underline"
              href={data.release_url}
              target="_blank"
              rel="noreferrer"
            >
              {t('updates.releaseNotes')}
            </a>
          )}
          {!data.supported && <p role="status">{t('updates.unsupported')}</p>}
          {data.check_error && <p role="alert">{data.check_error}</p>}
          {job && (
            <div className="space-y-2" aria-live="polite">
              <p>
                {job.from_version} → {job.to_version}
              </p>
              <p>{t(`updates.stages.${job.stage}`, { defaultValue: job.stage })}</p>
              {job.error && <p role="alert">{job.error}</p>}
              {job.backup_path && (
                <p className="text-sm break-all">
                  {t('updates.backup')}: {job.backup_path}
                </p>
              )}
              {blocked && <p>{t('updates.recovery')}</p>}
              {job.stage === 'succeeded' && (
                <Button onClick={() => window.location.reload()}>{t('updates.reload')}</Button>
              )}
            </div>
          )}
        </>
      )}
      {query.isError && <p role="status">{t('updates.reconnecting')}</p>}
      {(start.isError || refresh.isError) && (
        <p role="alert">{(start.error ?? refresh.error)?.message}</p>
      )}
      {start.isError && <p>{t('updates.requestUncertain')}</p>}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={refresh.isPending || active || start.isPending}
          onClick={() => refresh.mutate()}
        >
          {t('updates.check')}
        </Button>
        <Button
          disabled={
            !data?.supported || !available || active || blocked || start.isPending || query.isError
          }
          onClick={() => setConfirmedVersion(data?.latest_version ?? null)}
        >
          {t('updates.update')}
        </Button>
      </div>
      <Modal
        open={confirmedVersion !== null}
        onClose={() => !start.isPending && setConfirmedVersion(null)}
        title={t('updates.confirmTitle')}
        footer={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              disabled={start.isPending}
              onClick={() => setConfirmedVersion(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={start.isPending || active}
              onClick={() => confirmedVersion && start.mutate(confirmedVersion)}
            >
              {t('updates.confirm')}
            </Button>
          </div>
        }
      >
        <p>{t('updates.confirmText', { version: confirmedVersion })}</p>
      </Modal>
    </Card>
  );
}
