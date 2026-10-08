import type { ZxcvbnResult } from '@zxcvbn-ts/core';

export interface PasswordStrength {
  /** 0 (very weak) .. 4 (very strong), zxcvbn's own scale. */
  score: 0 | 1 | 2 | 3 | 4;
  warning: string;
  suggestions: string[];
}

type Zxcvbn = { check: (password: string) => ZxcvbnResult };

/** `i18next` locale -> zxcvbn-ts language package. Only `ru`/`en` are supported
 * (i18n/index.ts `supportedLngs`); anything else falls back to `en`. */
type ZxcvbnLang = 'ru' | 'en';

function toZxcvbnLang(locale: string): ZxcvbnLang {
  return locale.startsWith('ru') ? 'ru' : 'en';
}

// Memoized per language so switching locale back and forth doesn't re-fetch the chunk, and
// concurrent calls for the same language share one in-flight import.
const instances = new Map<ZxcvbnLang, Promise<Zxcvbn>>();

/**
 * Lazily builds a zxcvbn-ts instance carrying only the dictionary for one language, via dynamic
 * `import()` so Vite splits each language's dictionary into its own chunk. Bundling
 * `language-common` + `language-en` + `language-ru` eagerly (the previous approach) made
 * PasswordPage's own lazy route chunk 2.71 MB/1.32 MB gzip — far more than the ~1 MB budget —
 * even though a given browser session only ever needs one language's dictionary.
 */
function loadZxcvbn(lang: ZxcvbnLang): Promise<Zxcvbn> {
  let pending = instances.get(lang);
  if (!pending) {
    pending = (async () => {
      const [{ ZxcvbnFactory }, common, language] = await Promise.all([
        import('@zxcvbn-ts/core'),
        import('@zxcvbn-ts/language-common'),
        lang === 'ru' ? import('@zxcvbn-ts/language-ru') : import('@zxcvbn-ts/language-en'),
      ]);
      return new ZxcvbnFactory({
        dictionary: { ...common.dictionary, ...language.dictionary },
        graphs: common.adjacencyGraphs,
        translations: language.translations,
      });
    })();
    instances.set(lang, pending);
  }
  return pending;
}

/** Password-change complexity check. Wraps zxcvbn-ts behind our own, testable shape.
 * `locale` should be the active i18next language (`i18next.language`); the matching dictionary
 * is fetched on first use and cached (see [`loadZxcvbn`]). */
export async function estimatePasswordStrength(
  password: string,
  locale: string,
): Promise<PasswordStrength> {
  if (!password) {
    return { score: 0, warning: '', suggestions: [] };
  }
  const zxcvbn = await loadZxcvbn(toZxcvbnLang(locale));
  const result = zxcvbn.check(password);
  return {
    score: result.score,
    warning: result.feedback.warning ?? '',
    suggestions: result.feedback.suggestions ?? [],
  };
}
