import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import {
  Send,
  Paperclip,
  Trash2,
  X,
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Undo,
  Redo,
  UploadCloud,
  FileText,
  ArrowLeft,
  ChevronDown,
  Save,
} from 'lucide-react';
import { Button, useToast } from '@mgate/ui';
import { useAuth } from '../../auth/AuthContext';
import { parseRecipients } from '../../features/mail/addresses';
import {
  buildInitialCompose,
  parseComposeParams,
  toKept,
  type ComposeInitial,
  type ComposeOpened,
  type KeptAttachment,
} from '../../features/mail/composeInit';
import { mailErrorMessage } from '../../features/mail/errors';
import { formatBytes } from '../../features/mail/format';
import { isMailApiError, mailApi } from '../../features/mail/mailApi';
import { RecipientInput } from '../../features/mail/RecipientInput';
import { forgetDraftReply, rememberDraftReply } from '../../features/mail/draftReply';
import { useAutosave } from '../../features/mail/useAutosave';
import { useMailLimits } from '../../features/mail/useMailPrefs';
import type {
  AttachmentInfo,
  DraftItem,
  SaveDraftRequest,
  SendRequest,
  Signature,
  StagedAttachment,
} from '../../features/mail/types';

/**
 * `/mail/compose[?draft=<id>|replyTo=<id>[&all=1]|forward=<id>|to=&subject=]`.
 * Re-mounted on every navigation (location key), so "Написать" always starts a clean form and
 * the previous one is autosaved on the way out.
 */
export function ComposePage() {
  const location = useLocation();
  return <ComposeLoader key={location.key} />;
}

/** Loads what the form needs (draft, original message, default signature), then mounts it. */
function ComposeLoader() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  // Read once: later URL updates (the draft id after a save) must not re-initialise the form.
  const [opened] = useState<ComposeOpened>(() => parseComposeParams(searchParams));
  const sourceId = opened.draft ? undefined : (opened.replyTo ?? opened.forward);

  const signatures = useQuery({
    queryKey: ['mail', 'signatures'],
    queryFn: ({ signal }) => mailApi.signatures(signal),
    retry: false,
  });
  const original = useQuery({
    queryKey: ['mail', 'compose-source', sourceId],
    enabled: !!sourceId,
    queryFn: ({ signal }) => mailApi.message(sourceId!, { peek: true, signal }),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const draft = useQuery({
    queryKey: ['mail', 'draft', opened.draft],
    enabled: !!opened.draft,
    queryFn: ({ signal }) => mailApi.getDraft(opened.draft!, signal),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  const source = opened.draft ? draft : sourceId ? original : null;
  const ready =
    (signatures.isSuccess || signatures.isError) && (!source || source.isSuccess || source.isError);

  const initial = useMemo<ComposeInitial | null>(() => {
    if (!ready) return null;
    const def = signatures.data?.find((s) => s.is_default);
    return buildInitialCompose({
      opened,
      draft: draft.data,
      original: original.data,
      // Drafts already carry their signature.
      signatureHtml: opened.draft ? '' : (def?.html_body ?? ''),
      selfEmail: user?.email,
      t,
    });
  }, [ready, opened, signatures.data, draft.data, original.data, user?.email, t]);

  if (!initial) {
    return (
      <div className="text-mg-text-muted flex h-full items-center justify-center text-xs">
        {t('mail.compose.loading')}
      </div>
    );
  }
  return (
    <ComposeForm
      opened={opened}
      initial={initial}
      signatures={signatures.data ?? []}
      sourceError={source?.isError ? mailErrorMessage(source.error, t) : null}
    />
  );
}

interface ComposeFormProps {
  opened: ComposeOpened;
  initial: ComposeInitial;
  signatures: Signature[];
  sourceError: string | null;
}

function ComposeForm({ opened, initial, signatures, sourceError }: ComposeFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const limits = useMailLimits();

  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [bcc, setBcc] = useState(initial.bcc);
  const [showCc, setShowCc] = useState(initial.cc !== '');
  const [showBcc, setShowBcc] = useState(initial.bcc !== '');
  const [subject, setSubject] = useState(initial.subject);
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [kept, setKept] = useState<KeptAttachment[]>(initial.kept);
  const [forwardAtts] = useState<AttachmentInfo[]>(initial.forwardAtts);
  const [includeForwardAtts, setIncludeForwardAtts] = useState(true);
  const [inReplyTo] = useState<string | undefined>(initial.inReplyTo);
  const replyToId = initial.replyToId;
  const [uploading, setUploading] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const draftIdRef = useRef<string | undefined>(initial.draftId);
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve());
  const markDirtyRef = useRef<() => void>(() => {});

  // Snapshot of the form for the autosave callback, which can run after unmount ("on leave").
  const formRef = useRef({ to, cc, bcc, subject, staged, kept, inReplyTo });
  useEffect(() => {
    formRef.current = { to, cc, bcc, subject, staged, kept, inReplyTo };
  });

  const editor = useEditor({
    extensions: [StarterKit, Image],
    content: initial.html,
    onUpdate: () => markDirtyRef.current(),
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-[300px] focus:outline-none p-4 text-mg-text leading-relaxed',
      },
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  /** Builds the draft request from the live form. `null` when there is nothing worth saving. */
  const buildDraft = useCallback((): SaveDraftRequest | null => {
    const f = formRef.current;
    const ed = editorRef.current;
    const from = user?.email;
    if (!from || !ed) return null;
    const recipients = parseRecipients(f.to).addresses;
    const ccList = parseRecipients(f.cc).addresses;
    const bccList = parseRecipients(f.bcc).addresses;
    const text = ed.getText();
    const empty =
      !recipients.length &&
      !ccList.length &&
      !bccList.length &&
      !f.subject.trim() &&
      !text.trim() &&
      !f.staged.length &&
      !f.kept.length;
    if (empty) return null;
    return {
      from,
      to: recipients,
      cc: ccList,
      bcc: bccList,
      subject: f.subject,
      html: ed.getHTML(),
      text,
      ...(replyToId ? { reply_to_id: replyToId } : {}),
      ...(f.inReplyTo ? { in_reply_to: f.inReplyTo } : {}),
      attachment_ids: f.staged.map((a) => a.id),
      keep_attachments: f.kept.map((a) => a.index),
    };
  }, [user?.email, replyToId]);

  const saveDraft = useCallback(async () => {
    const payload = buildDraft();
    if (!payload) return;
    let saved: DraftItem;
    try {
      saved = draftIdRef.current
        ? await mailApi.updateDraft(draftIdRef.current, payload)
        : await mailApi.createDraft(payload);
    } catch (e) {
      // The draft disappeared (deleted elsewhere): start a new one instead of failing forever.
      if (!draftIdRef.current || !isMailApiError(e, 'not_found')) throw e;
      saved = await mailApi.createDraft(payload);
    }
    // The server replaces the draft on every save and answers with the new id.
    const previousDraftId = draftIdRef.current;
    draftIdRef.current = saved.id;
    if (replyToId) rememberDraftReply(saved.id, replyToId, previousDraftId);
    const url = new URL(window.location.href);
    url.searchParams.set('draft', saved.id);
    window.history.replaceState(window.history.state, '', url);
    if (saved.attachments) {
      // The draft now holds every attachment; staged uploads that went into it are done with.
      const sent = new Set(payload.attachment_ids);
      const newKept = toKept(saved.attachments, t('mail.compose.unnamedAttachment'));
      // Update the snapshot synchronously too: a send that was waiting on this save reads it.
      formRef.current = {
        ...formRef.current,
        kept: newKept,
        staged: formRef.current.staged.filter((a) => !sent.has(a.id)),
      };
      setStaged((prev) => prev.filter((a) => !sent.has(a.id)));
      setKept(newKept);
    }
    void queryClient.invalidateQueries({ queryKey: ['mail', 'folders'] });
  }, [buildDraft, queryClient, replyToId, t]);

  const autosave = useAutosave({ save: saveDraft });
  useEffect(() => {
    markDirtyRef.current = autosave.markDirty;
  }, [autosave.markDirty]);
  const { markDirty } = autosave;

  // Warn before closing the tab with edits that autosave has not stored yet.
  const { isDirty } = autosave;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const setField = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    markDirty();
  };

  // --- Attachments ---------------------------------------------------------------------------

  const uploadOne = useCallback(
    async (file: File) => {
      if (limits && file.size > limits.max_upload_bytes) {
        setFormError(
          t('mail.errors.attachment_too_large', { max: formatBytes(limits.max_upload_bytes) }),
        );
        return;
      }
      // Read from the synchronous snapshot: several files may be queued at once.
      const stagedBytes = formRef.current.staged.reduce((n, a) => n + a.size, 0);
      if (limits && stagedBytes + file.size > limits.max_staged_bytes) {
        setFormError(t('mail.errors.upload_quota_exceeded'));
        return;
      }
      setUploading((n) => n + 1);
      try {
        const up = await mailApi.uploadAttachment(file);
        const entry: StagedAttachment = {
          ...up,
          name: up.name || file.name,
          size: up.size ?? file.size,
        };
        formRef.current = { ...formRef.current, staged: [...formRef.current.staged, entry] };
        setStaged((prev) => [...prev, entry]);
        markDirty();
      } catch (e) {
        setFormError(mailErrorMessage(e, t));
      } finally {
        setUploading((n) => n - 1);
      }
    },
    [limits, markDirty, t],
  );

  /** Uploads one at a time: the server allows only a few concurrent uploads per mailbox. */
  const uploadFile = useCallback(
    (file: File) => {
      setFormError(null);
      uploadChainRef.current = uploadChainRef.current.then(() => uploadOne(file));
    },
    [uploadOne],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      for (const file of Array.from(event.dataTransfer.files)) uploadFile(file);
    },
    [uploadFile],
  );

  const removeStaged = (a: StagedAttachment) => {
    formRef.current = {
      ...formRef.current,
      staged: formRef.current.staged.filter((x) => x.id !== a.id),
    };
    setStaged((prev) => prev.filter((x) => x.id !== a.id));
    markDirty();
    mailApi.deleteAttachment(a.id).catch(() => {
      // The staged file expires on its own; nothing to tell the user.
    });
  };

  // --- Send / discard ------------------------------------------------------------------------

  const sendMutation = useMutation({
    mutationFn: async (req: Omit<SendRequest, 'draft_id' | 'keep_draft_attachments'>) => {
      // Stop autosave, let a running save finish: it decides the final draft id.
      autosave.setDisabled(true);
      await autosave.settle();
      const draftId = draftIdRef.current;
      const snapshot = formRef.current;
      const staleIds = new Set(req.attachment_ids);
      return mailApi.send({
        ...req,
        // A save that just finished may have moved staged uploads into the draft.
        attachment_ids: snapshot.staged.map((a) => a.id).filter((id) => staleIds.has(id)),
        ...(draftId
          ? { draft_id: draftId, keep_draft_attachments: snapshot.kept.map((a) => a.index) }
          : {}),
      });
    },
    onSuccess: (res) => {
      forgetDraftReply(draftIdRef.current);
      void queryClient.invalidateQueries({ queryKey: ['mail', 'folders'] });
      void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] });
      if (res.saved_to_sent === false) {
        toast({ title: t('mail.compose.notSavedToSent'), tone: 'warning' });
      }
      navigate('/mail/sent');
    },
    onError: (e) => {
      autosave.setDisabled(false);
      setFormError(mailErrorMessage(e, t));
    },
  });

  const handleSend = () => {
    setFormError(null);
    const from = user?.email;
    const ed = editorRef.current;
    if (!from || !ed) {
      setFormError(t('mail.compose.errNoSender'));
      return;
    }
    const toList = parseRecipients(to);
    const ccList = parseRecipients(cc);
    const bccList = parseRecipients(bcc);
    const invalid = [...toList.invalid, ...ccList.invalid, ...bccList.invalid];
    if (invalid.length > 0) {
      setFormError(t('mail.compose.errInvalidAddress', { list: invalid.join(', ') }));
      return;
    }
    const all = new Set(
      [...toList.addresses, ...ccList.addresses, ...bccList.addresses].map((a) => a.toLowerCase()),
    );
    if (all.size === 0) {
      setFormError(t('mail.compose.errNoRecipients'));
      return;
    }
    if (limits && all.size > limits.max_recipients) {
      setFormError(t('mail.compose.errTooManyRecipients', { max: limits.max_recipients }));
      return;
    }
    if (!subject.trim() && !confirm(t('mail.compose.confirmNoSubject'))) return;

    sendMutation.mutate({
      from,
      to: toList.addresses,
      cc: ccList.addresses,
      bcc: bccList.addresses,
      subject: subject.trim(),
      html: ed.getHTML(),
      text: ed.getText(),
      ...(replyToId ? { reply_to_id: replyToId } : {}),
      ...(inReplyTo ? { in_reply_to: inReplyTo } : {}),
      ...(opened.forward
        ? {
            forward_of_id: opened.forward,
            ...(forwardAtts.length > 0
              ? { forward_attachments: includeForwardAtts ? forwardAtts.map((a) => a.index) : [] }
              : {}),
          }
        : {}),
      attachment_ids: staged.map((a) => a.id),
    });
  };

  const handleDiscard = async () => {
    if (!confirm(t('mail.compose.confirmDiscard'))) return;
    autosave.setDisabled(true);
    await autosave.settle();
    const draftId = draftIdRef.current;
    if (draftId) await mailApi.deleteDraft(draftId).catch(() => undefined);
    forgetDraftReply(draftId);
    await Promise.all(staged.map((a) => mailApi.deleteAttachment(a.id).catch(() => undefined)));
    void queryClient.invalidateQueries({ queryKey: ['mail', 'folders'] });
    void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] });
    navigate('/mail/inbox');
  };

  const handleSaveNow = async () => {
    setFormError(null);
    markDirty();
    if (!(await autosave.flush())) setFormError(t('mail.compose.saveFailed'));
  };

  const handleApplySignature = (sigId: string) => {
    const chosen = signatures.find((s) => s.id === sigId);
    if (chosen?.html_body && editor) {
      editor.commands.setContent(`${editor.getHTML()}${chosen.html_body}`);
    }
  };

  const draftStatus = useMemo(() => {
    if (autosave.phase === 'saving') return t('mail.compose.saving');
    if (autosave.phase === 'error') return t('mail.compose.saveFailed');
    if (autosave.phase === 'saved' && autosave.savedAt) {
      return t('mail.compose.savedAt', {
        time: autosave.savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }
    return '';
  }, [autosave.phase, autosave.savedAt, t]);

  const isReply = !!replyToId;
  const isForward = !!opened.forward;

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-y-auto p-6">
      {/* Top Header bar */}
      <div className="border-mg-border-subtle mb-4 flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/mail/inbox')}
            className="hover:bg-mg-surface-subtle text-mg-text-muted hover:text-mg-text rounded-md p-1.5 transition-colors"
            title={t('common.back')}
            aria-label={t('common.back')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-mg-text text-xl font-semibold tracking-tight">
              {t('nav.mail.compose')}
            </h1>
            <span className="text-mg-text-muted text-xs">
              {isReply
                ? t('mail.compose.inReply')
                : isForward
                  ? t('mail.compose.forwarding')
                  : opened.draft
                    ? t('mail.compose.draft')
                    : t('mail.compose.newMessage')}
              {draftStatus ? ` · ${draftStatus}` : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleDiscard()}
            className="text-mg-danger hover:bg-red-500/10"
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {t('common.delete')}
          </Button>
        </div>
      </div>

      {sourceError ? (
        <p
          role="alert"
          className="border-mg-danger/40 bg-mg-danger/10 text-mg-danger mb-3 rounded-lg border px-3 py-2 text-xs"
        >
          {sourceError}
        </p>
      ) : null}

      {/* Main Composer Card */}
      <div
        className={`bg-mg-surface flex flex-1 flex-col rounded-xl border shadow-sm transition-all ${
          isDragOver ? 'border-mg-primary ring-mg-primary/20 ring-2' : 'border-mg-border'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Recipient Rows */}
        <div className="border-mg-border-subtle divide-mg-border-subtle divide-y border-b text-sm">
          <div className="flex items-center px-4 py-2.5">
            <label className="text-mg-text-muted w-16 shrink-0 font-medium select-none">
              {t('mail.compose.to')}:
            </label>
            <RecipientInput
              value={to}
              onChange={setField(setTo)}
              ariaLabel={t('mail.compose.to')}
              placeholder="recipient@example.com"
              autoFocus
            />
            <div className="flex items-center gap-2 pl-2">
              {!showCc && (
                <button
                  type="button"
                  onClick={() => setShowCc(true)}
                  className="text-mg-text-muted hover:text-mg-primary hover:bg-mg-surface-subtle rounded px-1 py-0.5 text-xs transition-colors"
                >
                  {t('mail.compose.cc')}
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  onClick={() => setShowBcc(true)}
                  className="text-mg-text-muted hover:text-mg-primary hover:bg-mg-surface-subtle rounded px-1 py-0.5 text-xs transition-colors"
                >
                  {t('mail.compose.bcc')}
                </button>
              )}
            </div>
          </div>

          {showCc && (
            <div className="flex items-center px-4 py-2.5">
              <label className="text-mg-text-muted w-16 shrink-0 font-medium select-none">
                {t('mail.compose.cc')}:
              </label>
              <RecipientInput
                value={cc}
                onChange={setField(setCc)}
                ariaLabel={t('mail.compose.cc')}
                placeholder="cc@example.com"
              />
              <button
                type="button"
                aria-label={t('common.delete')}
                onClick={() => {
                  setCc('');
                  setShowCc(false);
                  markDirty();
                }}
                className="text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-subtle rounded p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {showBcc && (
            <div className="flex items-center px-4 py-2.5">
              <label className="text-mg-text-muted w-16 shrink-0 font-medium select-none">
                {t('mail.compose.bcc')}:
              </label>
              <RecipientInput
                value={bcc}
                onChange={setField(setBcc)}
                ariaLabel={t('mail.compose.bcc')}
                placeholder="bcc@example.com"
              />
              <button
                type="button"
                aria-label={t('common.delete')}
                onClick={() => {
                  setBcc('');
                  setShowBcc(false);
                  markDirty();
                }}
                className="text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-subtle rounded p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center px-4 py-2.5">
            <label className="text-mg-text-muted w-16 shrink-0 font-medium select-none">
              {t('mail.compose.subject')}:
            </label>
            <input
              type="text"
              aria-label={t('mail.compose.subject')}
              placeholder={t('mail.compose.subjectPlaceholder')}
              value={subject}
              maxLength={998}
              onChange={(e) => setField(setSubject)(e.target.value)}
              className="text-mg-text placeholder:text-mg-text-muted flex-1 bg-transparent font-medium focus:outline-none"
            />
          </div>
        </div>

        {/* TipTap Rich Text Toolbar */}
        <div className="border-mg-border-subtle bg-mg-surface-subtle/50 text-mg-text-muted flex flex-wrap items-center gap-1 border-b px-3 py-2">
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className={`hover:bg-mg-surface hover:text-mg-text rounded p-1.5 transition-colors ${
              editor?.isActive('bold') ? 'bg-mg-surface text-mg-primary font-bold shadow-xs' : ''
            }`}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className={`hover:bg-mg-surface hover:text-mg-text rounded p-1.5 transition-colors ${
              editor?.isActive('italic') ? 'bg-mg-surface text-mg-primary font-bold shadow-xs' : ''
            }`}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
            className={`hover:bg-mg-surface hover:text-mg-text rounded p-1.5 transition-colors ${
              editor?.isActive('strike') ? 'bg-mg-surface text-mg-primary font-bold shadow-xs' : ''
            }`}
            title="Strikethrough"
          >
            <Strikethrough className="h-4 w-4" />
          </button>

          <div className="bg-mg-border mx-1 h-4 w-px" />

          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            className={`hover:bg-mg-surface hover:text-mg-text rounded p-1.5 transition-colors ${
              editor?.isActive('bulletList') ? 'bg-mg-surface text-mg-primary shadow-xs' : ''
            }`}
            title="Bullet list"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            className={`hover:bg-mg-surface hover:text-mg-text rounded p-1.5 transition-colors ${
              editor?.isActive('orderedList') ? 'bg-mg-surface text-mg-primary shadow-xs' : ''
            }`}
            title="Numbered list"
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            className={`hover:bg-mg-surface hover:text-mg-text rounded p-1.5 transition-colors ${
              editor?.isActive('blockquote') ? 'bg-mg-surface text-mg-primary shadow-xs' : ''
            }`}
            title="Blockquote"
          >
            <Quote className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
            className={`hover:bg-mg-surface hover:text-mg-text rounded p-1.5 transition-colors ${
              editor?.isActive('codeBlock') ? 'bg-mg-surface text-mg-primary shadow-xs' : ''
            }`}
            title="Code block"
          >
            <Code className="h-4 w-4" />
          </button>

          <div className="bg-mg-border mx-1 h-4 w-px" />

          <button
            type="button"
            onClick={() => editor?.chain().focus().undo().run()}
            className="hover:bg-mg-surface hover:text-mg-text rounded p-1.5 transition-colors"
            title="Undo"
          >
            <Undo className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().redo().run()}
            className="hover:bg-mg-surface hover:text-mg-text rounded p-1.5 transition-colors"
            title="Redo"
          >
            <Redo className="h-4 w-4" />
          </button>
        </div>

        {/* Editor Body */}
        <div className="bg-mg-surface min-h-[260px] flex-1 overflow-y-auto">
          <EditorContent editor={editor} />
        </div>

        {/* Attachments Section */}
        {(staged.length > 0 || kept.length > 0 || uploading > 0 || forwardAtts.length > 0) && (
          <div className="border-mg-border-subtle bg-mg-surface-subtle/30 space-y-2 border-t px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {kept.map((a) => (
                <div
                  key={`k-${a.index}`}
                  className="bg-mg-surface border-mg-border text-mg-text flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-xs"
                >
                  <FileText className="text-mg-primary h-3.5 w-3.5" />
                  <span className="max-w-[200px] truncate font-medium">{a.name}</span>
                  <span className="text-mg-text-muted">({formatBytes(a.size)})</span>
                  <button
                    type="button"
                    aria-label={t('mail.compose.removeAttachment')}
                    onClick={() => {
                      setKept((prev) => prev.filter((x) => x.index !== a.index));
                      markDirty();
                    }}
                    className="text-mg-text-muted hover:text-mg-danger rounded p-0.5 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {staged.map((a) => (
                <div
                  key={a.id}
                  className="bg-mg-surface border-mg-border text-mg-text group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-xs"
                >
                  <FileText className="text-mg-primary h-3.5 w-3.5" />
                  <span className="max-w-[200px] truncate font-medium">{a.name}</span>
                  <span className="text-mg-text-muted">({formatBytes(a.size)})</span>
                  <button
                    type="button"
                    aria-label={t('mail.compose.removeAttachment')}
                    onClick={() => removeStaged(a)}
                    className="text-mg-text-muted hover:text-mg-danger rounded p-0.5 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {uploading > 0 ? (
                <span className="text-mg-text-muted flex items-center gap-2 px-3 py-1.5 text-xs">
                  {t('mail.compose.uploading')}
                </span>
              ) : null}
            </div>
            {forwardAtts.length > 0 ? (
              <label className="text-mg-text flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={includeForwardAtts}
                  onChange={(e) => setIncludeForwardAtts(e.target.checked)}
                  className="border-mg-border text-mg-primary focus:ring-mg-primary rounded"
                />
                <span>
                  {t('mail.compose.includeOriginalAttachments', { count: forwardAtts.length })}:{' '}
                  {forwardAtts
                    .map(
                      (a) => a.name || t('mail.reader.attachmentFallback', { index: a.index + 1 }),
                    )
                    .join(', ')}
                </span>
              </label>
            ) : null}
          </div>
        )}

        {isDragOver && (
          <div className="bg-mg-primary/5 border-mg-primary text-mg-primary flex animate-pulse items-center justify-center gap-2 border-t border-dashed p-4 text-sm font-medium">
            <UploadCloud className="h-5 w-5" />
            <span>{t('mail.compose.dropNow')}</span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          data-testid="compose-file-input"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              for (const file of Array.from(e.target.files)) uploadFile(file);
              e.target.value = '';
            }
          }}
        />

        {formError ? (
          <p
            role="alert"
            className="border-mg-danger/40 bg-mg-danger/10 text-mg-danger mx-4 mb-2 rounded-lg border px-3 py-2 text-xs"
          >
            {formError}
          </p>
        ) : null}

        {/* Bottom Actions Footer */}
        <div className="border-mg-border bg-mg-surface-subtle/40 flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              isLoading={sendMutation.isPending}
              disabled={!user?.email || uploading > 0}
              onClick={handleSend}
              className="gap-2 px-5"
            >
              <Send className="h-4 w-4" />
              <span>{t('mail.compose.send')}</span>
            </Button>

            <Button
              variant="secondary"
              size="md"
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5"
            >
              <Paperclip className="h-4 w-4" />
              <span>{uploading > 0 ? t('mail.compose.uploading') : t('mail.compose.attach')}</span>
            </Button>

            <Button
              variant="ghost"
              size="md"
              onClick={() => void handleSaveNow()}
              disabled={sendMutation.isPending}
              className="gap-1.5"
            >
              <Save className="h-4 w-4" />
              <span>{t('mail.compose.saveDraft')}</span>
            </Button>

            {signatures.length > 0 && (
              <div className="group relative">
                <select
                  aria-label={t('mail.compose.signature')}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) handleApplySignature(e.target.value);
                  }}
                  className="bg-mg-surface border-mg-border text-mg-text hover:bg-mg-surface-subtle cursor-pointer appearance-none rounded-md border px-3 py-1.5 pr-7 text-xs transition-colors focus:outline-none"
                >
                  <option value="" disabled>
                    {t('mail.compose.insertSignature')}
                  </option>
                  {signatures.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.is_default ? t('mail.compose.defaultMark') : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="text-mg-text-muted pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2" />
              </div>
            )}
          </div>

          <div className="text-mg-text-muted text-xs">
            {limits
              ? t('mail.compose.attachmentLimit', { max: formatBytes(limits.max_upload_bytes) })
              : null}
          </div>
        </div>
      </div>
    </div>
  );
}
