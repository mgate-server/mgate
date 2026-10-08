import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from './sanitizeEmailHtml';

describe('sanitizeEmailHtml', () => {
  it('strips <script> tags and inline event handlers', () => {
    const raw =
      '<p onclick="alert(1)">Hello</p><script>alert("xss")</script><img src="x.png" onerror="alert(2)">';
    const { html } = sanitizeEmailHtml(raw, { allowRemoteImages: false });

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onerror');
    expect(html).toContain('Hello');
  });

  it('strips dangerous structural tags (iframe/object/embed/form)', () => {
    const raw =
      '<iframe src="https://evil.example"></iframe><object data="x"></object>' +
      '<embed src="y"><form action="https://evil.example"><input></form><p>ok</p>';
    const { html } = sanitizeEmailHtml(raw, { allowRemoteImages: true });

    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<embed');
    expect(html).not.toContain('<form');
    expect(html).toContain('ok');
  });

  it('blocks a remote <img> by default and reports hasRemoteContent', () => {
    const raw = '<img src="https://tracker.example/pixel.gif" width="1" height="1">';
    const { html, hasRemoteContent } = sanitizeEmailHtml(raw, { allowRemoteImages: false });

    expect(hasRemoteContent).toBe(true);
    expect(html).not.toContain('https://tracker.example');
    expect(html).toContain('data:image/gif;base64');
  });

  it('leaves the remote <img> src intact once the user allows remote images', () => {
    const raw = '<img src="https://cdn.example/logo.png">';
    const { html, hasRemoteContent } = sanitizeEmailHtml(raw, { allowRemoteImages: true });

    expect(hasRemoteContent).toBe(true);
    expect(html).toContain('https://cdn.example/logo.png');
  });

  it('does not flag inline (cid:) or data: images as remote content', () => {
    const raw = '<img src="cid:part1.image@example"><img src="data:image/png;base64,AAAA">';
    const { hasRemoteContent, html } = sanitizeEmailHtml(raw, { allowRemoteImages: false });

    expect(hasRemoteContent).toBe(false);
    expect(html).toContain('cid:part1.image@example');
  });

  it('neutralizes a remote CSS background used as a tracking vector', () => {
    const raw = '<div style="background-image:url(https://tracker.example/bg.gif)">x</div>';
    const { html, hasRemoteContent } = sanitizeEmailHtml(raw, { allowRemoteImages: false });

    expect(hasRemoteContent).toBe(true);
    expect(html).not.toContain('tracker.example');
  });

  it('detects a short remote CSS background even right after a long one was allowed through', () => {
    // Regression test: STYLE_URL_RE is a module-level `g`-flagged RegExp shared across calls.
    // A prior `.test()` match (here on a long URL, with allowRemoteImages:true so the match
    // path never resets lastIndex via the replace branch) used to leave `lastIndex` advanced
    // past the end of a later, shorter string, making that later `.test()` spuriously return
    // false and letting the remote background through undetected and unstripped.
    const longUrlRaw =
      '<div style="background-image:url(https://tracker.example/verylongpath/pixel-image-file.gif)">a</div>';
    const first = sanitizeEmailHtml(longUrlRaw, { allowRemoteImages: true });
    expect(first.hasRemoteContent).toBe(true);

    const shortUrlRaw = '<div style="background:url(https://evil.example/p.gif)">b</div>';
    const second = sanitizeEmailHtml(shortUrlRaw, { allowRemoteImages: false });

    expect(second.hasRemoteContent).toBe(true);
    expect(second.html).not.toContain('evil.example');
  });
});
