import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { apiError, installFetchMock, renderAt, setCsrfCookie } from '../../features/mail/testUtils';
import { ContactsPage } from './ContactsPage';

const CONTACTS = [
  {
    id: 'c1',
    name: 'Анна Смирнова',
    email: 'anna@example.org',
    phone: '+7 900',
    group: 'Коллеги',
    notes: null,
  },
  {
    id: 'c2',
    name: 'Борис',
    email: 'boris@example.org',
    phone: null,
    group: null,
    notes: 'заметка',
  },
];

function open(extra: Record<string, unknown> = {}) {
  const mock = installFetchMock({
    'GET /api/v1/mail/contacts': CONTACTS,
    'GET /api/v1/mail/contact-groups': [{ id: 'g1', name: 'Коллеги', count: 1 }],
    ...(extra as Record<string, object>),
  });
  renderAt(<ContactsPage />, { route: '/mail/contacts', path: '/mail/contacts' });
  return mock;
}

describe('ContactsPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });
  beforeEach(() => setCsrfCookie('csrf-1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setCsrfCookie(null);
  });

  it('lists contacts and links the address to the composer', async () => {
    open();
    expect(await screen.findByText('Анна Смирнова')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'anna@example.org' })).toHaveAttribute(
      'href',
      '/mail/compose?to=anna%40example.org',
    );
    expect(screen.getByText('Основная')).toBeInTheDocument(); // contact without a group
  });

  it('imports a file with the CSRF header and reports imported/skipped counts', async () => {
    const mock = open({
      'POST /api/v1/mail/contacts/import': { status: 'ok', imported: 3, skipped: 2 },
    });
    await screen.findByText('Анна Смирнова');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(
      input,
      new File(['BEGIN:VCARD\nEND:VCARD'], 'c.vcf', { type: 'text/vcard' }),
    );

    expect(await screen.findByText('Импортировано контактов: 3')).toBeInTheDocument();
    expect(screen.getByText('Пропущено записей: 2')).toBeInTheDocument();
    const [call] = mock.find('POST', '/api/v1/mail/contacts/import');
    expect(call!.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(call!.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(call!.body).toBe('BEGIN:VCARD\nEND:VCARD');
  });

  it('refuses an import above the 1 MiB server limit without uploading it', async () => {
    const mock = open();
    await screen.findByText('Анна Смирнова');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File([new Uint8Array(1024 * 1024 + 1)], 'big.csv'));
    expect(await screen.findByText(/больше 1 МБ/)).toBeInTheDocument();
    expect(mock.find('POST', '/api/v1/mail/contacts/import')).toHaveLength(0);
  });

  it('shows a failed import instead of failing silently', async () => {
    open({ 'POST /api/v1/mail/contacts/import': () => apiError(403, 'csrf_token_invalid') });
    await screen.findByText('Анна Смирнова');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['x'], 'c.csv'));
    expect(await screen.findByText('Не удалось импортировать файл контактов')).toBeInTheDocument();
    expect(screen.getByText(/Обновите страницу/)).toBeInTheDocument();
  });

  it('creates a contact with CSRF; empty optional fields are sent as null', async () => {
    const mock = open({ 'POST /api/v1/mail/contacts': { id: 'c3', name: 'N', email: 'n@x.org' } });
    await screen.findByText('Анна Смирнова');
    await userEvent.click(
      screen.getAllByRole('button', { name: /Новый контакт|Добавить контакт/ })[0]!,
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Имя/), { target: { value: ' Новый ' } });
    fireEvent.change(within(dialog).getByLabelText(/Email/), { target: { value: 'n@x.org' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(mock.find('POST', '/api/v1/mail/contacts')).toHaveLength(1));
    const [call] = mock.find('POST', '/api/v1/mail/contacts');
    expect(call!.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(call!.body).toEqual({
      name: 'Новый',
      email: 'n@x.org',
      phone: null,
      group: null,
      notes: null,
    });
  });

  it('says so when the address already exists (409)', async () => {
    open({ 'POST /api/v1/mail/contacts': () => apiError(409, 'conflict') });
    await screen.findByText('Анна Смирнова');
    await userEvent.click(
      screen.getAllByRole('button', { name: /Новый контакт|Добавить контакт/ })[0]!,
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Имя/), { target: { value: 'A' } });
    fireEvent.change(within(dialog).getByLabelText(/Email/), {
      target: { value: 'anna@example.org' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('уже существует');
  });

  it('updates by id and deletes after confirmation, both with CSRF', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const mock = open({
      'PUT /api/v1/mail/contacts/c1': { ...CONTACTS[0] },
      'DELETE /api/v1/mail/contacts/c2': () => undefined,
    });
    await screen.findByText('Анна Смирнова');

    const rowA = screen.getByText('Анна Смирнова').closest('tr')!;
    await userEvent.click(within(rowA).getByTitle('Изменить'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Телефон/), { target: { value: '' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(mock.find('PUT', '/api/v1/mail/contacts/c1')).toHaveLength(1));
    expect(mock.find('PUT', '/api/v1/mail/contacts/c1')[0]!.headers.get('X-CSRF-Token')).toBe(
      'csrf-1',
    );
    expect(mock.find('PUT', '/api/v1/mail/contacts/c1')[0]!.body).toMatchObject({
      phone: null,
      group: 'Коллеги',
    });

    const rowB = screen.getByText('Борис').closest('tr')!;
    await userEvent.click(within(rowB).getByTitle('Удалить'));
    await waitFor(() => expect(mock.find('DELETE', '/api/v1/mail/contacts/c2')).toHaveLength(1));
    expect(mock.find('DELETE', '/api/v1/mail/contacts/c2')[0]!.headers.get('X-CSRF-Token')).toBe(
      'csrf-1',
    );
  });

  it('points the export buttons at the API', async () => {
    open();
    await screen.findByText('Анна Смирнова');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/api/v1/mail/contacts/export?format=vcard');
    expect(hrefs).toContain('/api/v1/mail/contacts/export?format=csv');
  });
});
