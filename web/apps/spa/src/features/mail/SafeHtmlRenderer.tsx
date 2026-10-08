import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@mgate/ui';
import { sanitizeEmailHtml } from './sanitizeEmailHtml';
import type { RemoteImagesPolicy } from './types';

export interface SafeHtmlRendererProps {
  /** Raw HTML message body, as stored by the mail store — untrusted. */
  html: string;
  className?: string;
  /**
   * Remote image policy (`remote_images` pref): `ask` blocks until the reader clicks, `always`
   * shows them right away, `never` blocks them and offers no way to reveal them.
   * Mount with `key={messageId}` so a reveal never carries over to the next message.
   */
  remoteImages?: RemoteImagesPolicy;
  /** Remote resources the server counted in the message (informational). */
  blockedRemote?: number;
}

function buildSrcDoc(bodyHtml: string, allowRemoteImages: boolean): string {
  // `default-src 'none'` plus no script-src means the iframe cannot fetch anything itself even
  // if sanitization somehow missed something; `img-src` is the only thing widened, and only
  // once the reader explicitly opts in per-message.
  const csp = [
    "default-src 'none'",
    `img-src data: ${allowRemoteImages ? 'https: http:' : ''}`.trim(),
    "style-src 'unsafe-inline'",
    'font-src data:',
  ].join('; ');
  return (
    '<!doctype html><html><head>' +
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<base target="_blank">' +
    '<style>body{font-family:system-ui,sans-serif;word-break:break-word;margin:0;padding:12px;}' +
    'img{max-width:100%;}</style>' +
    `</head><body>${bodyHtml}</body></html>`
  );
}

/**
 * Renders an (untrusted, sanitized) HTML email body inside a sandboxed iframe.
 * Sandbox deliberately omits `allow-scripts` (and `allow-same-origin`, so the frame gets an
 * opaque origin with no access to our storage/cookies even if a script somehow ran) — the only
 * capability granted is `allow-popups`, so a normal `<a target="_blank">` link still opens.
 * Remote images/backgrounds are stripped by default (tracking-pixel protection);
 * the reader can reveal them per message via "Показать изображения".
 */
export function SafeHtmlRenderer({
  html,
  className,
  remoteImages = 'ask',
  blockedRemote = 0,
}: SafeHtmlRendererProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const allowRemoteImages = remoteImages === 'always' || (remoteImages === 'ask' && revealed);

  const { html: sanitizedHtml, hasRemoteContent } = useMemo(
    () => sanitizeEmailHtml(html, { allowRemoteImages }),
    [html, allowRemoteImages],
  );

  const srcDoc = useMemo(
    () => buildSrcDoc(sanitizedHtml, allowRemoteImages),
    [sanitizedHtml, allowRemoteImages],
  );

  return (
    <div className={className}>
      {(hasRemoteContent || blockedRemote > 0) && !allowRemoteImages ? (
        <div className="border-mg-border bg-mg-surface-raised mb-2 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
          <span className="text-mg-text-muted">
            {remoteImages === 'never'
              ? t('mail.reader.remoteImagesDisabled')
              : t('mail.reader.remoteImagesBlocked')}
          </span>
          {remoteImages === 'ask' ? (
            <Button size="sm" variant="secondary" onClick={() => setRevealed(true)}>
              {t('mail.reader.showImages')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <iframe
        title="mgate-email-body"
        sandbox="allow-popups"
        srcDoc={srcDoc}
        className="border-mg-border h-full min-h-64 w-full rounded-md border bg-white"
      />
    </div>
  );
}
