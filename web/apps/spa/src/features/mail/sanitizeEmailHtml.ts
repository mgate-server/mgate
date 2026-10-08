import DOMPurify from 'dompurify';

export interface SanitizeEmailHtmlOptions {
  /** Show remote images/backgrounds instead of blocking them (user clicked "Show images"). */
  allowRemoteImages: boolean;
}

export interface SanitizeEmailHtmlResult {
  html: string;
  /** True if the message referenced at least one remote (http/https) image or CSS background. */
  hasRemoteContent: boolean;
}

// 1x1 transparent GIF used in place of a blocked remote image, so layout doesn't collapse.
const BLOCKED_IMAGE_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';

const REMOTE_URL_RE = /^(?:https?:)?\/\//i;
const STYLE_URL_RE = /url\(\s*(['"]?)((?:https?:)?\/\/[^'")]+)\1\s*\)/gi;

function isRemoteUrl(value: string): boolean {
  const trimmed = value.trim();
  return REMOTE_URL_RE.test(trimmed) && !trimmed.startsWith('cid:') && !trimmed.startsWith('data:');
}

/**
 * Sanitizes untrusted email HTML for display and, by default, neutralizes remote images and
 * CSS `background`/`background-image` references (the classic tracking-pixel vector) so the
 * mail server never leaks "message was opened" to a remote sender. Pure and DOM-library-only
 * (no React), so it is unit-testable directly and reusable by both the reader pane and any
 * future preview/export path.
 *
 * The caller (`SafeHtmlRenderer`) is additionally responsible for rendering the result inside a
 * sandboxed iframe with a restrictive CSP — this function only guarantees the *markup* is inert,
 * not the rendering context.
 */
export function sanitizeEmailHtml(
  rawHtml: string,
  { allowRemoteImages }: SanitizeEmailHtmlOptions,
): SanitizeEmailHtmlResult {
  let hasRemoteContent = false;

  const onElement = (node: Element) => {
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src');
      if (src && isRemoteUrl(src)) {
        hasRemoteContent = true;
        if (!allowRemoteImages) {
          // Note: the original URL is intentionally dropped, not just hidden — revealing images
          // re-sanitizes from the raw message body with `allowRemoteImages: true` rather than
          // reading it back off the DOM, so there is no reason to leave it in a data-* attribute.
          node.setAttribute('src', BLOCKED_IMAGE_PLACEHOLDER);
        }
      }
      // `srcset` is a second, easily-forgotten remote-image vector.
      if (node.hasAttribute('srcset')) {
        hasRemoteContent = true;
        if (!allowRemoteImages) node.removeAttribute('srcset');
      }
    }

    const style = node.getAttribute('style');
    if (style) {
      // STYLE_URL_RE carries the global flag (needed for the `.replace()` below), which means a
      // stateful `.test()` call mutates its shared `lastIndex` on a match. Reset unconditionally
      // right before every use so a match on one element/call can never suppress detection on a
      // later one (see regression test: a long-URL match followed by a short-URL match).
      STYLE_URL_RE.lastIndex = 0;
      if (STYLE_URL_RE.test(style)) {
        hasRemoteContent = true;
        if (!allowRemoteImages) {
          STYLE_URL_RE.lastIndex = 0;
          node.setAttribute('style', style.replace(STYLE_URL_RE, 'none'));
        }
      }
    }

    if (node.hasAttribute('background')) {
      const bg = node.getAttribute('background');
      if (bg && isRemoteUrl(bg)) {
        hasRemoteContent = true;
        if (!allowRemoteImages) node.removeAttribute('background');
      }
    }
  };

  DOMPurify.addHook('afterSanitizeAttributes', onElement);
  let html: string;
  try {
    html = DOMPurify.sanitize(rawHtml, {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'],
      FORBID_ATTR: ['srcdoc'],
      WHOLE_DOCUMENT: false,
      RETURN_TRUSTED_TYPE: false,
    });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }

  return { html, hasRemoteContent };
}
