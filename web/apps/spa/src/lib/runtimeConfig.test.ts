import { describe, expect, it } from 'vitest';
import { parseRuntimeLinks } from './runtimeConfig';

describe('parseRuntimeLinks', () => {
  it('returns undefined for missing or non-object input', () => {
    expect(parseRuntimeLinks(undefined)).toBeUndefined();
    expect(parseRuntimeLinks(null)).toBeUndefined();
    expect(parseRuntimeLinks('https://example.com')).toBeUndefined();
    expect(parseRuntimeLinks({})).toBeUndefined();
  });

  it('keeps valid http(s) URLs', () => {
    expect(
      parseRuntimeLinks({
        pricingUrl: 'https://example.com/pricing',
        vendorPortalUrl: 'http://portal.example.com',
      }),
    ).toEqual({
      pricingUrl: 'https://example.com/pricing',
      vendorPortalUrl: 'http://portal.example.com',
    });
  });

  it('drops empty, non-string and non-http(s) values', () => {
    expect(
      parseRuntimeLinks({ pricingUrl: '', vendorPortalUrl: 'javascript:alert(1)' }),
    ).toBeUndefined();
    expect(parseRuntimeLinks({ pricingUrl: 42, vendorPortalUrl: 'not a url' })).toBeUndefined();
    expect(
      parseRuntimeLinks({
        pricingUrl: 'https://example.com',
        vendorPortalUrl: 'ftp://example.com',
      }),
    ).toEqual({ pricingUrl: 'https://example.com' });
  });
});
