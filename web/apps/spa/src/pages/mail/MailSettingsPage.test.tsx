import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { apiError, installFetchMock, renderAt, setCsrfCookie } from '../../features/mail/testUtils';
import { MailSettingsPage } from './MailSettingsPage';

const SIGS = [
  {
    id: 's1',
    name: 'Рабочая',
    is_default: true,
    html_body: '<p>С уважением</p>',
    text_body: 'С уважением',
  },
  { id: 's2', name: 'Личная', is_default: false, html_body: '<p>Привет</p>', text_body: 'Привет' },
];

function open(extra: Record<string, unknown> = {}) {
  const mock = installFetchMock({
    'GET /api/v1/mail/settings': {
      remote_images: 'never',
      list_density: 'comfortable',
      mark_read_on_open: false,
    },
    'GET /api/v1/mail/signatures': SIGS,
    ...(extra as Record<string, object>),
  });
  renderAt(<MailSettingsPage />, { route: '/mail/settings', path: '/mail/settings' });
  return mock;
}

describe('MailSettingsPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });
  beforeEach(() => setCsrfCookie('csrf-1'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setCsrfCookie(null);
  });

  it('shows the saved preferences, not the defaults, once they have loaded', async () => {
    open();
    const images = (await screen.findByLabelText(/Показ внешних изображений/)) as HTMLSelectElement;
    expect(images.value).toBe('never');
    expect((screen.getByLabelText(/Плотность списка/) as HTMLSelectElement).value).toBe(
      'comfortable',
    );
    expect((screen.getByLabelText(/Помечать письмо прочитанным/) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it('saves the three preferences with CSRF', async () => {
    const mock = open({
      'PUT /api/v1/mail/settings': {
        remote_images: 'always',
        list_density: 'compact',
        mark_read_on_open: true,
      },
    });
    const images = await screen.findByLabelText(/Показ внешних изображений/);
    await userEvent.selectOptions(images, 'always');
    await userEvent.selectOptions(screen.getByLabelText(/Плотность списка/), 'compact');
    await userEvent.click(screen.getByLabelText(/Помечать письмо прочитанным/));
    await userEvent.click(screen.getAllByRole('button', { name: 'Сохранить' })[0]!);

    await waitFor(() => expect(mock.find('PUT', '/api/v1/mail/settings')).toHaveLength(1));
    const [call] = mock.find('PUT', '/api/v1/mail/settings');
    expect(call!.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(call!.body).toEqual({
      remote_images: 'always',
      list_density: 'compact',
      mark_read_on_open: true,
    });
    expect(await screen.findByText('Сохранено!')).toBeInTheDocument();
  });

  it('shows why saving failed', async () => {
    open({
      'PUT /api/v1/mail/settings': () =>
        apiError(422, 'validation_failed', { reason: 'Недопустимое значение' }),
    });
    await screen.findByLabelText(/Показ внешних изображений/);
    await userEvent.click(screen.getAllByRole('button', { name: 'Сохранить' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Недопустимое значение');
  });

  it('creates a signature from escaped text, never from raw markup', async () => {
    const mock = open({
      'POST /api/v1/mail/signatures': { id: 's3', name: 'x', is_default: false },
    });
    await screen.findByText('Рабочая');
    await userEvent.click(screen.getAllByRole('button', { name: /Создать подпись/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Название/), { target: { value: 'XSS' } });
    fireEvent.change(within(dialog).getByLabelText('Текст подписи'), {
      target: { value: '<img src=x onerror=alert(1)>\nвторая строка' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(mock.find('POST', '/api/v1/mail/signatures')).toHaveLength(1));
    const call = mock.find('POST', '/api/v1/mail/signatures')[0]!;
    expect(call.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(call.body).toMatchObject({
      name: 'XSS',
      html_body: '<p>&lt;img src=x onerror=alert(1)&gt;<br>вторая строка</p>',
      is_default: false,
    });
  });

  it('edits a signature by id', async () => {
    const mock = open({ 'PUT /api/v1/mail/signatures/s2': SIGS[1] });
    await screen.findByText('Личная');
    const card = screen.getByText('Личная').closest('div.p-4')!;
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText(/^Название/) as HTMLInputElement).value).toBe('Личная');
    fireEvent.change(within(dialog).getByLabelText('Текст подписи'), {
      target: { value: 'Новый текст' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(mock.find('PUT', '/api/v1/mail/signatures/s2')).toHaveLength(1));
    expect(mock.find('PUT', '/api/v1/mail/signatures/s2')[0]!.body).toMatchObject({
      name: 'Личная',
      text_body: 'Новый текст',
      html_body: '<p>Новый текст</p>',
    });
  });

  it('makes another signature the default', async () => {
    const mock = open({ 'PUT /api/v1/mail/signatures/s2': SIGS[1] });
    await screen.findByText('Личная');
    await userEvent.click(screen.getByRole('button', { name: 'Сделать основной' }));
    await waitFor(() => expect(mock.find('PUT', '/api/v1/mail/signatures/s2')).toHaveLength(1));
    expect(mock.find('PUT', '/api/v1/mail/signatures/s2')[0]!.body).toMatchObject({
      is_default: true,
    });
  });

  it('reports a duplicate signature name (409) inside the dialog', async () => {
    open({ 'POST /api/v1/mail/signatures': () => apiError(409, 'conflict') });
    await screen.findByText('Рабочая');
    await userEvent.click(screen.getAllByRole('button', { name: /Создать подпись/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Название/), { target: { value: 'Рабочая' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('уже существует');
  });

  it('deletes after confirmation, with CSRF', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const mock = open({ 'DELETE /api/v1/mail/signatures/s2': () => undefined });
    await screen.findByText('Личная');
    const card = screen.getByText('Личная').closest('div.p-4')!;
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(mock.find('DELETE', '/api/v1/mail/signatures/s2')).toHaveLength(1));
    expect(mock.find('DELETE', '/api/v1/mail/signatures/s2')[0]!.headers.get('X-CSRF-Token')).toBe(
      'csrf-1',
    );
  });
});
