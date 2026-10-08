import { describe, expect, it } from 'vitest';
import {
  buildReplyHtml,
  escapeHtml,
  htmlToText,
  quotableText,
  replyRecipients,
  subjectWithPrefix,
  textToHtml,
} from './composeText';

describe('textToHtml', () => {
  it('escapes markup so typed text is never interpreted as HTML', () => {
    expect(textToHtml('<script>alert(1)</script> & "q"')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;</p>',
    );
  });

  it('turns newlines into <br> and blank lines into paragraphs', () => {
    expect(textToHtml('a\nb\n\nc')).toBe('<p>a<br>b</p><p>c</p>');
    expect(textToHtml('   ')).toBe('');
  });

  it('escapes attribute-breaking characters', () => {
    expect(escapeHtml(`'"`)).toBe('&#39;&quot;');
  });
});

describe('htmlToText', () => {
  it('extracts visible text without running or loading anything', () => {
    const html =
      '<style>p{}</style><p>Hello</p><p>World<br>again</p><img src="http://t/x.gif" onerror="x()">';
    expect(htmlToText(html)).toBe('Hello\nWorld\nagain');
  });
});

describe('subjectWithPrefix', () => {
  it('does not stack prefixes', () => {
    expect(subjectWithPrefix('Re: Re: Отчёт', 'reply')).toBe('Re: Отчёт');
    expect(subjectWithPrefix('Ответ: Отчёт', 'reply')).toBe('Re: Отчёт');
    expect(subjectWithPrefix('Fwd: Re: x', 'forward')).toBe('Fwd: x');
    expect(subjectWithPrefix('Plain', 'forward')).toBe('Fwd: Plain');
  });
});

describe('quotes', () => {
  it('prefers the text part, falls back to the HTML text', () => {
    expect(quotableText({ text: 'plain', html: { html: '<p>h</p>', blocked_remote: 0 } })).toBe(
      'plain',
    );
    expect(quotableText({ text: null, html: { html: '<p>h</p>', blocked_remote: 0 } })).toBe('h');
    expect(quotableText({ text: null, html: null })).toBe('');
  });

  it('puts the quoted body in a blockquote under an escaped attribution', () => {
    expect(buildReplyHtml('A <b> wrote:', 'line')).toBe(
      '<p>A &lt;b&gt; wrote:</p><blockquote><p>line</p></blockquote>',
    );
  });
});

describe('replyRecipients', () => {
  const msg = {
    from: 'Bob <bob@x.org>',
    to: ['alice@x.org', 'carol@x.org'],
    cc: ['Dave <dave@x.org>', 'bob@x.org'],
  };

  it('replies to the sender only', () => {
    expect(replyRecipients(msg, 'alice@x.org', false)).toEqual({ to: ['bob@x.org'], cc: [] });
  });

  it('reply-all adds the other recipients but never the signed-in mailbox or duplicates', () => {
    expect(replyRecipients(msg, 'Alice@x.org', true)).toEqual({
      to: ['bob@x.org', 'carol@x.org'],
      cc: ['dave@x.org'],
    });
  });
});
