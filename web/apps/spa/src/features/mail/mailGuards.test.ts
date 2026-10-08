import { describe, expect, it } from 'vitest';
import ru from '../../i18n/locales/ru/common.json';
import en from '../../i18n/locales/en/common.json';
import { KNOWN_ERROR_CODES } from './errors';

const sources = import.meta.glob(
  [
    '/src/pages/mail/**/*.{ts,tsx}',
    '/src/features/mail/**/*.{ts,tsx}',
    '/src/components/layout/MailLayout.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const production = Object.entries(sources).filter(
  ([path]) => !/\.test\.tsx?$|testUtils/.test(path),
);

function lookup(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  }, tree);
}

describe('webmail sources', () => {
  it('have no bare fetch( - every call goes through the CSRF-aware transport', () => {
    const offenders = production
      .filter(([, code]) => /(?<![.\w])fetch\(/.test(code))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('only reach the network through mailApi / apiClient', () => {
    const offenders = production
      .filter(([path]) => !path.endsWith('/mailApi.ts'))
      .filter(([, code]) => /\bfetchApi\b|new WebSocket\(|XMLHttpRequest/.test(code))
      // the push hook owns the socket; mailApi owns fetchApi
      .map(([path]) => path)
      .filter((p) => !p.endsWith('/useMailPush.ts'));
    expect(offenders).toEqual([]);
  });

  it('use only translation keys that exist in both ru and en', () => {
    const missing: string[] = [];
    for (const [path, code] of production) {
      for (const m of code.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) {
        const key = m[1]!;
        for (const [lang, tree] of [
          ['ru', ru],
          ['en', en],
        ] as const) {
          const hit = lookup(tree, key) ?? lookup(tree, `${key}_other`);
          if (hit === undefined) missing.push(`${lang}: ${key} (${path})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('have a message for every error code and every block reason', () => {
    for (const code of KNOWN_ERROR_CODES) {
      for (const tree of [ru, en]) {
        expect(lookup(tree, `mail.errors.${code}`), code).toBeTypeOf('string');
      }
    }
    for (const reason of ['webmail_requires_mailbox', 'mailbox_disabled', 'domain_disabled']) {
      for (const tree of [ru, en]) {
        expect(lookup(tree, `mail.unavailable.${reason}.title`), reason).toBeTypeOf('string');
        expect(lookup(tree, `mail.unavailable.${reason}.description`), reason).toBeTypeOf('string');
      }
    }
  });

  it('keep ru and en mail keys in sync', () => {
    const flat = (o: unknown, prefix = ''): string[] =>
      o && typeof o === 'object'
        ? Object.entries(o).flatMap(([k, v]) => flat(v, `${prefix}${k}.`))
        : [prefix.slice(0, -1)];
    const strip = (k: string) => k.replace(/_(one|few|many|other|two|zero)$/, '');
    const keys = (tree: unknown) => new Set(flat(lookup(tree, 'mail')).map(strip));
    const ruKeys = keys(ru);
    const enKeys = keys(en);
    expect([...ruKeys].filter((k) => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter((k) => !ruKeys.has(k))).toEqual([]);
  });
});
