import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  PenTool,
  SlidersHorizontal,
  Plus,
  Trash2,
  Pencil,
  Check,
  Shield,
  LayoutList,
  Sparkles,
  MailCheck,
} from 'lucide-react';
import { Badge, Button, Card, Input, Modal } from '@mgate/ui';
import { htmlToText, textToHtml } from '../../features/mail/composeText';
import { mailErrorMessage } from '../../features/mail/errors';
import { mailApi } from '../../features/mail/mailApi';
import {
  MAIL_SETTINGS_KEY,
  normalizePrefs,
  useMailSettingsQuery,
} from '../../features/mail/useMailPrefs';
import type {
  ListDensity,
  RemoteImagesPolicy,
  Signature,
  WebmailPrefs,
} from '../../features/mail/types';

const MAX_SIGNATURE_CHARS = 10_000; // server limit: 10 KiB of text

export function MailSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [sigOpen, setSigOpen] = useState(false);
  const [editing, setEditing] = useState<Signature | null>(null);
  const [sigName, setSigName] = useState('');
  const [sigText, setSigText] = useState('');
  const [sigIsDefault, setSigIsDefault] = useState(false);

  const { data: signatures, isLoading: isSigsLoading } = useQuery({
    queryKey: ['mail', 'signatures'],
    queryFn: async ({ signal }) => (await mailApi.signatures(signal)) ?? [],
  });

  const prefsQuery = useMailSettingsQuery();

  const saveSigMutation = useMutation({
    mutationFn: async () => {
      const input = {
        name: sigName.trim(),
        text_body: sigText,
        // Built from escaped plain text: what the user types is never interpreted as markup.
        html_body: textToHtml(sigText),
        is_default: sigIsDefault,
      };
      if (editing) await mailApi.updateSignature(editing.id, input);
      else await mailApi.createSignature(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mail', 'signatures'] });
      closeSigModal();
    },
  });

  const deleteSigMutation = useMutation({
    mutationFn: (id: string) => mailApi.deleteSignature(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mail', 'signatures'] });
    },
  });

  const makeDefaultMutation = useMutation({
    mutationFn: (sig: Signature) =>
      mailApi.updateSignature(sig.id, {
        name: sig.name,
        text_body: sig.text_body ?? htmlToText(sig.html_body ?? ''),
        html_body: sig.html_body ?? textToHtml(sig.text_body ?? ''),
        is_default: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mail', 'signatures'] });
    },
  });

  function openCreate() {
    saveSigMutation.reset();
    setEditing(null);
    setSigName('');
    setSigText('');
    setSigIsDefault(false);
    setSigOpen(true);
  }

  function openEdit(sig: Signature) {
    saveSigMutation.reset();
    setEditing(sig);
    setSigName(sig.name);
    setSigText(sig.text_body ?? htmlToText(sig.html_body ?? ''));
    setSigIsDefault(sig.is_default);
    setSigOpen(true);
  }

  function closeSigModal() {
    setSigOpen(false);
    setEditing(null);
  }

  const listError = deleteSigMutation.error ?? makeDefaultMutation.error;

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col space-y-6 overflow-y-auto p-6">
      {/* Header */}
      <div className="border-mg-border-subtle flex items-center gap-3 border-b pb-4">
        <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
          <Settings className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-mg-text text-xl font-semibold tracking-tight">
            {t('nav.mail.settings')}
          </h1>
          <p className="text-mg-text-muted text-xs">{t('mail.settings.subtitle')}</p>
        </div>
      </div>

      {/* Webmail Preferences Section */}
      <Card className="space-y-5 p-5 shadow-sm">
        <div className="border-mg-border-subtle flex items-center gap-2.5 border-b pb-3">
          <SlidersHorizontal className="text-mg-primary h-4 w-4" />
          <h2 className="text-mg-text text-sm font-semibold">{t('mail.settings.displayTitle')}</h2>
        </div>
        {prefsQuery.data ? (
          <PrefsForm initialPrefs={prefsQuery.data} />
        ) : prefsQuery.isError ? (
          <p role="alert" className="text-mg-danger text-xs">
            {mailErrorMessage(prefsQuery.error, t)}
          </p>
        ) : (
          <p className="text-mg-text-muted text-xs">{t('common.loading')}</p>
        )}
      </Card>

      {/* Signatures Section */}
      <Card className="space-y-5 p-5 shadow-sm">
        <div className="border-mg-border-subtle flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2.5">
            <PenTool className="text-mg-primary h-4 w-4" />
            <div>
              <h2 className="text-mg-text text-sm font-semibold">
                {t('mail.settings.signaturesTitle')}
              </h2>
              <p className="text-mg-text-muted mt-0.5 text-xs">
                {t('mail.settings.signaturesHint')}
              </p>
            </div>
          </div>

          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            <span>{t('mail.settings.addSig')}</span>
          </Button>
        </div>

        {listError ? (
          <p role="alert" className="text-mg-danger text-xs">
            {mailErrorMessage(listError, t)}
          </p>
        ) : null}

        {isSigsLoading ? (
          <div className="text-mg-text-muted py-8 text-center text-xs">
            {t('mail.settings.sigLoading')}
          </div>
        ) : signatures && signatures.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {signatures.map((sig) => (
              <div
                key={sig.id}
                className="border-mg-border bg-mg-surface-subtle/30 hover:border-mg-border flex flex-col justify-between gap-3 rounded-xl border p-4 transition-colors sm:flex-row sm:items-center"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-mg-text text-sm font-semibold">{sig.name}</span>
                    {sig.is_default && (
                      <Badge tone="success" className="gap-1">
                        <Check className="h-3 w-3" />
                        <span>{t('mail.settings.defaultBadge')}</span>
                      </Badge>
                    )}
                  </div>
                  <pre className="text-mg-text-muted bg-mg-surface border-mg-border-subtle line-clamp-3 rounded-lg border p-2.5 font-sans text-xs whitespace-pre-wrap">
                    {sig.text_body || htmlToText(sig.html_body ?? '') || '—'}
                  </pre>
                </div>

                <div className="flex shrink-0 items-end justify-between gap-2 sm:flex-col">
                  {!sig.is_default ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={makeDefaultMutation.isPending}
                      onClick={() => makeDefaultMutation.mutate(sig)}
                      className="gap-1"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>{t('mail.settings.makeDefaultAction')}</span>
                    </Button>
                  ) : null}
                  <Button size="xs" variant="ghost" onClick={() => openEdit(sig)} className="gap-1">
                    <Pencil className="h-3.5 w-3.5" />
                    <span>{t('common.edit')}</span>
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    isLoading={deleteSigMutation.isPending}
                    onClick={() => {
                      if (confirm(t('mail.settings.confirmDeleteSig', { name: sig.name }))) {
                        deleteSigMutation.mutate(sig.id);
                      }
                    }}
                    className="text-mg-danger gap-1 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{t('common.delete')}</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="bg-mg-surface-subtle text-mg-text-muted mb-2 flex h-10 w-10 items-center justify-center rounded-full">
              <PenTool className="h-5 w-5" />
            </div>
            <p className="text-mg-text text-xs font-medium">{t('mail.settings.noSignatures')}</p>
            <p className="text-mg-text-muted mt-0.5 mb-3 text-xs">
              {t('mail.settings.noSignaturesHint')}
            </p>
            <Button size="xs" onClick={openCreate} className="gap-1">
              <Plus className="h-3.5 w-3.5" />
              <span>{t('mail.settings.createFirstSig')}</span>
            </Button>
          </div>
        )}
      </Card>

      {/* Create / edit signature modal */}
      <Modal
        open={sigOpen}
        onClose={closeSigModal}
        title={editing ? t('mail.settings.editSigTitle') : t('mail.settings.newSigTitle')}
      >
        <div className="space-y-4 pt-2">
          <Input
            label={t('mail.settings.sigName')}
            placeholder={t('mail.settings.sigNamePlaceholder')}
            value={sigName}
            maxLength={100}
            onChange={(e) => setSigName(e.target.value)}
            required
            autoFocus
          />

          <div>
            <label
              htmlFor="mail-sig-text"
              className="text-mg-text mb-1.5 block text-xs font-medium"
            >
              {t('mail.settings.sigText')}
            </label>
            <textarea
              id="mail-sig-text"
              className="border-mg-border bg-mg-surface text-mg-text focus-visible:ring-mg-focus-ring placeholder:text-mg-text-muted min-h-28 w-full rounded-lg border p-3 text-xs focus-visible:ring-2 focus-visible:outline-none"
              placeholder={t('mail.settings.sigTextPlaceholder')}
              value={sigText}
              maxLength={MAX_SIGNATURE_CHARS}
              onChange={(e) => setSigText(e.target.value)}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 py-1 select-none">
            <input
              type="checkbox"
              checked={sigIsDefault}
              onChange={(e) => setSigIsDefault(e.target.checked)}
              className="border-mg-border text-mg-primary focus:ring-mg-primary rounded"
            />
            <span className="text-mg-text text-xs font-medium">
              {t('mail.settings.makeDefault')}
            </span>
          </label>

          {saveSigMutation.error ? (
            <p role="alert" className="text-mg-danger text-xs">
              {mailErrorMessage(saveSigMutation.error, t)}
            </p>
          ) : null}

          <div className="border-mg-border-subtle flex justify-end gap-2 border-t pt-3">
            <Button variant="secondary" onClick={closeSigModal}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!sigName.trim()}
              isLoading={saveSigMutation.isPending}
              onClick={() => saveSigMutation.mutate()}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function PrefsForm({ initialPrefs }: { initialPrefs: WebmailPrefs }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [remoteImages, setRemoteImages] = useState<RemoteImagesPolicy>(initialPrefs.remote_images);
  const [density, setDensity] = useState<ListDensity>(initialPrefs.list_density);
  const [markRead, setMarkRead] = useState(initialPrefs.mark_read_on_open);
  const [saved, setSaved] = useState(false);

  const savePrefsMutation = useMutation({
    mutationFn: () =>
      mailApi.saveSettings({
        remote_images: remoteImages,
        list_density: density,
        mark_read_on_open: markRead,
      }),
    onSuccess: (res) => {
      const sent: WebmailPrefs = {
        remote_images: remoteImages,
        list_density: density,
        mark_read_on_open: markRead,
      };
      queryClient.setQueryData(MAIL_SETTINGS_KEY, normalizePrefs({ ...sent, ...(res ?? {}) }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Remote images policy */}
        <div className="space-y-2">
          <label
            htmlFor="mail-pref-images"
            className="text-mg-text flex items-center gap-1.5 text-xs font-semibold"
          >
            <Shield className="text-mg-primary h-3.5 w-3.5" />
            <span>{t('mail.settings.remoteImagesPolicy')}</span>
          </label>
          <p className="text-mg-text-muted text-xs">{t('mail.settings.remoteImagesHint')}</p>
          <select
            id="mail-pref-images"
            value={remoteImages}
            onChange={(e) => setRemoteImages(e.target.value as RemoteImagesPolicy)}
            className="border-mg-border bg-mg-surface text-mg-text focus:border-mg-primary w-full rounded-lg border px-3 py-2 text-xs focus:outline-none"
          >
            <option value="ask">{t('mail.settings.imgAsk')}</option>
            <option value="always">{t('mail.settings.imgAlways')}</option>
            <option value="never">{t('mail.settings.imgNever')}</option>
          </select>
        </div>

        {/* List density */}
        <div className="space-y-2">
          <label
            htmlFor="mail-pref-density"
            className="text-mg-text flex items-center gap-1.5 text-xs font-semibold"
          >
            <LayoutList className="text-mg-primary h-3.5 w-3.5" />
            <span>{t('mail.settings.densityLabel')}</span>
          </label>
          <p className="text-mg-text-muted text-xs">{t('mail.settings.densityHint')}</p>
          <select
            id="mail-pref-density"
            value={density}
            onChange={(e) => setDensity(e.target.value as ListDensity)}
            className="border-mg-border bg-mg-surface text-mg-text focus:border-mg-primary w-full rounded-lg border px-3 py-2 text-xs focus:outline-none"
          >
            <option value="compact">{t('mail.settings.compact')}</option>
            <option value="normal">{t('mail.settings.normal')}</option>
            <option value="comfortable">{t('mail.settings.comfortable')}</option>
          </select>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 select-none">
        <input
          type="checkbox"
          checked={markRead}
          onChange={(e) => setMarkRead(e.target.checked)}
          className="border-mg-border text-mg-primary focus:ring-mg-primary mt-0.5 rounded"
        />
        <span>
          <span className="text-mg-text flex items-center gap-1.5 text-xs font-semibold">
            <MailCheck className="text-mg-primary h-3.5 w-3.5" />
            {t('mail.settings.markReadOnOpen')}
          </span>
          <span className="text-mg-text-muted text-xs">
            {t('mail.settings.markReadOnOpenHint')}
          </span>
        </span>
      </label>

      {savePrefsMutation.error ? (
        <p role="alert" className="text-mg-danger text-xs">
          {mailErrorMessage(savePrefsMutation.error, t)}
        </p>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <Button
          isLoading={savePrefsMutation.isPending}
          onClick={() => savePrefsMutation.mutate()}
          className="gap-1.5"
        >
          <Check className="h-4 w-4" />
          <span>{t('common.save')}</span>
        </Button>
        {saved && (
          <span className="text-mg-success inline-flex items-center gap-1 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            {t('common.saved')}
          </span>
        )}
      </div>
    </div>
  );
}
