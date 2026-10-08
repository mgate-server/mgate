import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Folder, Lock, Pencil, Trash2, X } from 'lucide-react';
import { Button, Input, Modal } from '@mgate/ui';
import { mailErrorMessage } from './errors';
import { folderLabel, isCustomFolder } from './folders';
import { mailApi } from './mailApi';
import type { FolderInfo } from './types';

const MAX_NAME_CHARS = 200;

export interface FolderManagerProps {
  open: boolean;
  onClose: () => void;
  folders: FolderInfo[];
  /** A folder was renamed: its id changes with its name. */
  onRenamed?: (oldId: string, renamed: FolderInfo) => void;
  onDeleted?: (id: string) => void;
}

/**
 * Create, rename and delete custom folders. System folders are listed but locked: the server
 * refuses to touch them (409 `system_folder`), so the UI does not offer the actions at all.
 */
export function FolderManager({
  open,
  onClose,
  folders,
  onRenamed,
  onDeleted,
}: FolderManagerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['mail', 'folders'] });
    void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] });
  };

  const createMutation = useMutation({
    mutationFn: (name: string) => mailApi.createFolder(name),
    onSuccess: () => {
      setNewName('');
      refresh();
    },
  });
  const renameMutation = useMutation({
    mutationFn: (v: { id: string; name: string }) => mailApi.renameFolder(v.id, v.name),
    onSuccess: (renamed, v) => {
      setEditingId(null);
      refresh();
      onRenamed?.(v.id, renamed);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => mailApi.deleteFolder(id),
    onSuccess: (_r, id) => {
      refresh();
      onDeleted?.(id);
    },
  });

  const busy = createMutation.isPending || renameMutation.isPending || deleteMutation.isPending;
  const error = createMutation.error ?? renameMutation.error ?? deleteMutation.error;
  const resetErrors = () => {
    createMutation.reset();
    renameMutation.reset();
    deleteMutation.reset();
  };

  const close = () => {
    setEditingId(null);
    setNewName('');
    resetErrors();
    onClose();
  };

  const submitCreate = () => {
    const name = newName.trim();
    if (!name || busy) return;
    resetErrors();
    createMutation.mutate(name);
  };

  const submitRename = (folder: FolderInfo) => {
    const name = editName.trim();
    if (!name || busy) return;
    if (name === folder.name) {
      setEditingId(null);
      return;
    }
    resetErrors();
    renameMutation.mutate({ id: folder.id, name });
  };

  return (
    <Modal open={open} onClose={close} title={t('mail.folders.manageTitle')} size="md">
      <div className="space-y-4 pt-2">
        <p className="text-mg-text-muted text-xs">{t('mail.folders.manageHint')}</p>

        <ul className="border-mg-border divide-mg-border divide-y rounded-lg border">
          {folders.map((f) => {
            const custom = isCustomFolder(f);
            const editing = editingId === f.id;
            return (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                {custom ? (
                  <Folder className="text-mg-text-muted h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <Lock className="text-mg-text-muted h-4 w-4 shrink-0" aria-hidden />
                )}
                {editing ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitRename(f);
                    }}
                  >
                    <Input
                      aria-label={t('mail.folders.renameLabel', { name: f.name })}
                      value={editName}
                      maxLength={MAX_NAME_CHARS}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      disabled={busy || !editName.trim()}
                      title={t('common.save')}
                      aria-label={t('common.save')}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      title={t('common.cancel')}
                      aria-label={t('common.cancel')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="text-mg-text min-w-0 flex-1 truncate font-medium">
                      {folderLabel(f, f.id, t)}
                    </span>
                    {custom ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            resetErrors();
                            setEditingId(f.id);
                            setEditName(f.name);
                          }}
                          title={t('mail.folders.rename')}
                          aria-label={t('mail.folders.renameLabel', { name: f.name })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            if (!confirm(t('mail.folders.confirmDelete', { name: f.name }))) return;
                            resetErrors();
                            deleteMutation.mutate(f.id);
                          }}
                          title={t('mail.folders.delete')}
                          aria-label={t('mail.folders.deleteLabel', { name: f.name })}
                          className="text-mg-danger hover:text-mg-danger hover:bg-mg-danger/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <span className="text-mg-text-muted text-[10px]">
                        {t('mail.folders.system')}
                      </span>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitCreate();
          }}
        >
          <div className="flex-1">
            <Input
              label={t('mail.folders.newLabel')}
              value={newName}
              maxLength={MAX_NAME_CHARS}
              placeholder={t('mail.folders.newPlaceholder')}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || !newName.trim()}>
            {t('common.create')}
          </Button>
        </form>

        {error ? (
          <p role="alert" className="text-mg-danger text-xs">
            {mailErrorMessage(error, t)}
          </p>
        ) : null}

        <div className="border-mg-border-subtle flex justify-end border-t pt-3">
          <Button variant="secondary" onClick={close}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
