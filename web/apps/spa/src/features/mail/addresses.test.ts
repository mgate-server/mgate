import { describe, expect, it } from 'vitest';
import {
  extractEmail,
  isPlausibleEmail,
  lastToken,
  parseRecipients,
  replaceLastToken,
  splitAddressList,
} from './addresses';

describe('splitAddressList', () => {
  it('splits on commas and semicolons', () => {
    expect(splitAddressList('a@x.org, b@x.org; c@x.org')).toEqual([
      'a@x.org',
      'b@x.org',
      'c@x.org',
    ]);
  });

  it('keeps commas inside quoted names and angle brackets', () => {
    expect(splitAddressList('"Doe, John" <j@x.org>, b@x.org')).toEqual([
      '"Doe, John" <j@x.org>',
      'b@x.org',
    ]);
  });

  it('ignores empty entries', () => {
    expect(splitAddressList(' , ;; a@x.org ,')).toEqual(['a@x.org']);
  });
});

describe('extractEmail / isPlausibleEmail', () => {
  it('strips display names', () => {
    expect(extractEmail('Иван <ivan@example.com>')).toBe('ivan@example.com');
    expect(extractEmail('ivan@example.com')).toBe('ivan@example.com');
  });

  it('rejects things that are not addresses', () => {
    expect(isPlausibleEmail('ivan@example.com')).toBe(true);
    expect(isPlausibleEmail('ivan')).toBe(false);
    expect(isPlausibleEmail('a b@example.com')).toBe(false);
    expect(isPlausibleEmail('ivan@example')).toBe(false);
    expect(isPlausibleEmail('a@b.c\r\nBcc: evil@x.org')).toBe(false);
  });
});

describe('parseRecipients', () => {
  it('returns plain, de-duplicated addresses and the invalid entries', () => {
    const r = parseRecipients('A <a@x.org>, a@X.org, nonsense, b@x.org');
    expect(r.addresses).toEqual(['a@x.org', 'b@x.org']);
    expect(r.invalid).toEqual(['nonsense']);
  });

  it('is empty for blank input', () => {
    expect(parseRecipients('  ')).toEqual({ addresses: [], invalid: [] });
  });
});

describe('autocomplete token helpers', () => {
  it('reads the entry after the last separator', () => {
    expect(lastToken('a@x.org, ivan')).toBe('ivan');
    expect(lastToken('a@x.org, ')).toBe('');
    expect(lastToken('')).toBe('');
  });

  it('replaces only the entry being typed', () => {
    expect(replaceLastToken('a@x.org, iv', 'ivan@x.org')).toBe('a@x.org, ivan@x.org, ');
    expect(replaceLastToken('iv', 'ivan@x.org')).toBe('ivan@x.org, ');
  });
});
