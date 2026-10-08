import { describe, expect, it } from 'vitest';
import { parseAuthenticationResults } from './authResults';

describe('parseAuthenticationResults', () => {
  it('parses a typical multi-mechanism header', () => {
    const header =
      'mx.example.com; spf=pass smtp.mailfrom=sender@example.org; ' +
      'dkim=pass header.i=@example.org header.s=selector1; ' +
      'dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=example.org';

    expect(parseAuthenticationResults(header)).toEqual({
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass',
    });
  });

  it('reports failures and unknown mechanisms as null', () => {
    const header = 'mx.example.com; spf=fail smtp.mailfrom=sender@example.org; dkim=none';

    expect(parseAuthenticationResults(header)).toEqual({
      spf: 'fail',
      dkim: 'none',
      dmarc: null,
    });
  });

  it('prefers pass when multiple DKIM signatures are present', () => {
    const header = 'mx.example.com; dkim=fail header.s=old; dkim=pass header.s=new';

    expect(parseAuthenticationResults(header).dkim).toBe('pass');
  });

  it('normalizes an unrecognized result token to neutral', () => {
    const header = 'mx.example.com; spf=weirdvalue';

    expect(parseAuthenticationResults(header).spf).toBe('neutral');
  });

  it('returns all-null for a missing/empty header', () => {
    expect(parseAuthenticationResults(undefined)).toEqual({ spf: null, dkim: null, dmarc: null });
    expect(parseAuthenticationResults('')).toEqual({ spf: null, dkim: null, dmarc: null });
  });
});
