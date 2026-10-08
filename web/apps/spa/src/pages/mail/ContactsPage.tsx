import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Search, Plus, Upload, Download, Pencil, Trash2, Tag } from 'lucide-react';
import { Avatar, Button, Card, Input, Modal, Table, useToast } from '@mgate/ui';
import type { TableColumn } from '@mgate/ui';
import { mailErrorMessage } from '../../features/mail/errors';
import { mailApi } from '../../features/mail/mailApi';
import type { Contact, ContactInput } from '../../features/mail/types';

/** Server cap for one import request (design: 1 MiB). */
const MAX_IMPORT_BYTES = 1024 * 1024;

export function ContactsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const importInputRef = useRef<HTMLInputElement>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [group, setGroup] = useState('');
  const [notes, setNotes] = useState('');
  const [filterQuery, setFilterQuery] = useState('');

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['mail', 'contacts'],
    queryFn: async ({ signal }) => (await mailApi.contacts(signal)) ?? [],
  });

  const { data: groups } = useQuery({
    queryKey: ['mail', 'contact-groups'],
    queryFn: ({ signal }) => mailApi.contactGroups(signal),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: ContactInput = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        group: group.trim() || null,
        notes: notes.trim() || null,
      };
      if (editingContact) await mailApi.updateContact(editingContact.id, body);
      else await mailApi.createContact(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mail', 'contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['mail', 'contact-groups'] });
      handleCloseModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => mailApi.deleteContact(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mail', 'contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['mail', 'contact-groups'] });
    },
    onError: (e) => toast({ title: mailErrorMessage(e, t), tone: 'danger' }),
  });

  function handleOpenCreate() {
    saveMutation.reset();
    setEditingContact(null);
    setName('');
    setEmail('');
    setPhone('');
    setGroup('');
    setNotes('');
    setCreateOpen(true);
  }

  function handleOpenEdit(contact: Contact) {
    saveMutation.reset();
    setEditingContact(contact);
    setName(contact.name);
    setEmail(contact.email);
    setPhone(contact.phone || '');
    setGroup(contact.group || '');
    setNotes(contact.notes || '');
    setCreateOpen(true);
  }

  function handleCloseModal() {
    setCreateOpen(false);
    setEditingContact(null);
  }

  async function handleImportFile(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      toast({ title: t('mail.contacts.importTooLarge'), tone: 'danger' });
      return;
    }
    try {
      const result = await mailApi.importContacts(await file.text());
      toast({
        title: t('mail.contacts.importDone', { count: result?.imported ?? 0 }),
        description:
          result?.skipped && result.skipped > 0
            ? t('mail.contacts.importSkipped', { count: result.skipped })
            : undefined,
        tone: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: ['mail', 'contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['mail', 'contact-groups'] });
    } catch (e) {
      toast({
        title: t('mail.contacts.importFailed'),
        description: mailErrorMessage(e, t),
        tone: 'danger',
      });
    }
  }

  const filteredContacts = (contacts || []).filter((c) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.group && c.group.toLowerCase().includes(q))
    );
  });

  const columns: TableColumn<Contact>[] = [
    {
      key: 'name',
      header: t('mail.contacts.name', 'Контакт'),
      render: (c) => (
        <div className="flex items-center gap-3">
          <Avatar name={c.name} email={c.email} size="sm" />
          <div className="flex min-w-0 flex-col">
            <span className="text-mg-text truncate text-sm font-medium">{c.name}</span>
            {c.notes && (
              <span className="text-mg-text-muted max-w-xs truncate text-xs">{c.notes}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      header: t('mail.contacts.email', 'Email'),
      render: (c) => (
        <Link
          to={`/mail/compose?to=${encodeURIComponent(c.email)}`}
          className="text-mg-primary block max-w-xs truncate font-mono text-sm hover:underline"
        >
          {c.email}
        </Link>
      ),
    },
    {
      key: 'phone',
      header: t('mail.contacts.phone', 'Телефон'),
      render: (c) => <span className="text-mg-text-muted font-mono text-xs">{c.phone || '—'}</span>,
    },
    {
      key: 'group',
      header: t('mail.contacts.group', 'Группа'),
      render: (c) => (
        <span className="bg-mg-surface-subtle border-mg-border-subtle text-mg-text inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium">
          <Tag className="text-mg-text-muted h-3 w-3" />
          {c.group || t('mail.contacts.defaultGroup')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (c) => (
        <div className="flex justify-end gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => handleOpenEdit(c)}
            title={t('common.edit', 'Изменить')}
          >
            <Pencil className="text-mg-text-muted hover:text-mg-text h-3.5 w-3.5" />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            isLoading={deleteMutation.isPending}
            onClick={() => {
              if (confirm(t('mail.contacts.confirmDelete', { name: c.name }))) {
                deleteMutation.mutate(c.id);
              }
            }}
            title={t('common.delete', 'Удалить')}
            className="text-mg-danger hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col space-y-6 p-6">
      {/* Header */}
      <div className="border-mg-border-subtle flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="bg-mg-primary/10 text-mg-primary rounded-lg p-2">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-mg-text text-xl font-semibold tracking-tight">
              {t('nav.mail.contacts', 'Контакты')}
            </h1>
            <p className="text-mg-text-muted text-xs">{t('mail.contacts.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".vcf,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => importInputRef.current?.click()}
            className="gap-1.5"
            title={t('mail.contacts.importHint')}
          >
            <Upload className="h-3.5 w-3.5" />
            <span>{t('mail.contacts.import', 'Импорт (.vcf / .csv)')}</span>
          </Button>

          <a href={mailApi.exportUrl('vcard')} download="contacts.vcf">
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              title={t('mail.contacts.exportVcardHint')}
            >
              <Download className="h-3.5 w-3.5" />
              <span>{t('mail.contacts.exportVcard', 'Экспорт vCard')}</span>
            </Button>
          </a>

          <a href={mailApi.exportUrl('csv')} download="contacts.csv">
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              title={t('mail.contacts.exportCsvHint')}
            >
              <Download className="h-3.5 w-3.5" />
              <span>{t('mail.contacts.exportCsv')}</span>
            </Button>
          </a>

          <Button size="sm" onClick={handleOpenCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span>{t('mail.contacts.add', 'Новый контакт')}</span>
          </Button>
        </div>
      </div>

      {/* Main card */}
      <Card className="overflow-hidden p-0 shadow-sm">
        {/* Search bar */}
        <div className="border-mg-border-subtle bg-mg-surface-subtle/30 border-b p-4">
          <div className="relative max-w-md">
            <Search className="text-mg-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t('mail.contacts.searchPlaceholder')}
              aria-label={t('mail.contacts.searchPlaceholder')}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="bg-mg-surface border-mg-border text-mg-text placeholder:text-mg-text-muted focus:border-mg-primary focus:ring-mg-primary w-full rounded-lg border py-1.5 pr-3 pl-9 text-xs focus:ring-1 focus:outline-none"
            />
          </div>
        </div>

        {/* Contacts Table */}
        <Table
          columns={columns}
          rows={filteredContacts}
          rowKey={(c) => c.id}
          isLoading={isLoading}
          emptyMessage={
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="bg-mg-surface-subtle text-mg-text-muted mb-3 flex h-12 w-12 items-center justify-center rounded-full">
                <Users className="h-6 w-6" />
              </div>
              <p className="text-mg-text text-sm font-medium">
                {filterQuery ? t('mail.contacts.noMatches') : t('mail.contacts.empty')}
              </p>
              <p className="text-mg-text-muted mt-1 mb-4 max-w-xs text-xs">
                {t('mail.contacts.emptyHint')}
              </p>
              <Button size="sm" onClick={handleOpenCreate} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                <span>{t('mail.contacts.add')}</span>
              </Button>
            </div>
          }
        />
      </Card>

      {/* Modal */}
      <Modal
        open={createOpen}
        onClose={handleCloseModal}
        title={
          editingContact
            ? t('mail.contacts.editTitle', 'Редактировать контакт')
            : t('mail.contacts.newTitle', 'Новый контакт')
        }
      >
        <div className="space-y-4 pt-2">
          <Input
            label={t('mail.contacts.name', 'Имя / ФИО')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('mail.contacts.namePlaceholder')}
            required
            autoFocus
          />

          <Input
            label={t('mail.contacts.email', 'Email адрес')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="john.doe@example.com"
            required
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('mail.contacts.phone', 'Телефон')}
              value={phone}
              placeholder={t('mail.contacts.phonePlaceholder')}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Input
              label={t('mail.contacts.group')}
              placeholder={t('mail.contacts.groupPlaceholder')}
              value={group}
              list="mail-contact-groups"
              onChange={(e) => setGroup(e.target.value)}
            />
            <datalist id="mail-contact-groups">
              {(groups ?? []).map((g) => (
                <option key={g.id} value={g.name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="text-mg-text mb-1.5 block text-xs font-medium">
              {t('mail.contacts.notes', 'Заметки')}
            </label>
            <textarea
              className="border-mg-border bg-mg-surface text-mg-text focus-visible:ring-mg-focus-ring placeholder:text-mg-text-muted min-h-20 w-full rounded-lg border p-2.5 text-xs focus-visible:ring-2 focus-visible:outline-none"
              placeholder={t('mail.contacts.notesPlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {saveMutation.error ? (
            <p role="alert" className="text-mg-danger text-xs">
              {mailErrorMessage(saveMutation.error, t)}
            </p>
          ) : null}

          <div className="border-mg-border-subtle flex justify-end gap-2 border-t pt-3">
            <Button variant="secondary" onClick={handleCloseModal}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!name.trim() || !email.trim()}
              isLoading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {editingContact ? t('common.save') : t('common.create')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
