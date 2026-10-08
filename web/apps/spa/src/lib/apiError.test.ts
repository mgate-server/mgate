import { describe, expect, it } from 'vitest';
import { messageFromApiErrorBody, readApiError } from './apiError';

describe('messageFromApiErrorBody', () => {
  it('prefers details.reason (422 validation_failed)', () => {
    const body = {
      error: {
        code: 'validation_failed',
        message: 'Ошибка валидации данных.',
        details: { reason: 'the private key does not match the certificate' },
      },
    };
    expect(messageFromApiErrorBody(body, 'fallback')).toBe(
      'the private key does not match the certificate',
    );
  });

  it('falls back to error.message, then to the caller fallback', () => {
    expect(messageFromApiErrorBody({ error: { code: 'x', message: 'Нет доступа.' } }, 'fb')).toBe(
      'Нет доступа.',
    );
    expect(messageFromApiErrorBody({ error: { code: 'x', details: {}, message: ' ' } }, 'fb')).toBe(
      'fb',
    );
    expect(messageFromApiErrorBody(null, 'fb')).toBe('fb');
    expect(messageFromApiErrorBody('oops', 'fb')).toBe('fb');
  });
});

describe('readApiError', () => {
  it('reads a JSON error response', async () => {
    const res = new Response(
      JSON.stringify({
        error: { code: 'validation_failed', message: 'm', details: { reason: 'r' } },
      }),
      { status: 422 },
    );
    expect(await readApiError(res, 'fb')).toBe('r');
  });

  it('uses the fallback for a non-JSON body', async () => {
    expect(await readApiError(new Response('<html>502</html>', { status: 502 }), 'fb')).toBe('fb');
  });
});
