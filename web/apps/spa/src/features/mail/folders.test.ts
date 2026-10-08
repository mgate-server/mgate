import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { defaultFolders, folderLabel, sortFolders } from './folders';
import type { FolderInfo } from './types';

const f = (id: string, role: string, name = id): FolderInfo => ({
  id,
  name,
  role,
  unread_count: 0,
  total_count: 0,
});

describe('folder display names', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });
  const t = i18n.t.bind(i18n);

  it('localises system folders by role, whatever the IMAP name is', () => {
    expect(folderLabel(f('sent', 'sent', 'Sent Messages'), 'sent', t)).toBe('Отправленные');
    expect(folderLabel(f('spam', 'spam', 'Junk'), 'spam', t)).toBe('Спам');
    expect(folderLabel(f('archive', 'archive', 'Archive'), 'archive', t)).toBe('Архив');
  });

  it('follows the interface language', async () => {
    await i18n.changeLanguage('en');
    expect(folderLabel(f('drafts', 'drafts'), 'drafts', i18n.t.bind(i18n))).toBe('Drafts');
    await i18n.changeLanguage('ru');
  });

  it('keeps the name of custom folders and never shows the raw folder id', () => {
    expect(folderLabel(f('f-0JTQuNC30LDQudC9', 'custom', 'Дизайн'), 'f-0JTQuNC30LDQudC9', t)).toBe(
      'Дизайн',
    );
    expect(folderLabel(undefined, 'f-abc', t)).toBe('Папка');
    expect(folderLabel(undefined, 'inbox', t)).toBe('Входящие');
  });

  it('orders system folders first, then custom ones by name', () => {
    const sorted = sortFolders([
      f('f-b', 'custom', 'B'),
      f('trash', 'trash'),
      f('inbox', 'inbox'),
      f('f-a', 'custom', 'A'),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['inbox', 'trash', 'f-a', 'f-b']);
    expect(defaultFolders().map((x) => x.id)).toEqual([
      'inbox',
      'sent',
      'drafts',
      'spam',
      'trash',
      'archive',
    ]);
  });
});
