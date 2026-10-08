import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { mailErrorMessage } from './errors';
import { MailApiError } from './mailApi';

describe('mailErrorMessage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });
  const t = i18n.t.bind(i18n);
  const err = (
    status: number,
    code: string,
    details?: Record<string, unknown>,
    retryAfter?: number,
  ) => new MailApiError({ status, code, message: 'server text', details, retryAfter });

  it('maps known codes to localised text, never the raw server message', () => {
    expect(mailErrorMessage(err(403, 'sender_not_allowed'), t)).toMatch(/отправлять/);
    expect(mailErrorMessage(err(403, 'sending_suspended'), t)).toMatch(/приостановлена/);
    expect(mailErrorMessage(err(403, 'csrf_token_invalid'), t)).toMatch(/Обновите страницу/);
  });

  it('fills in sizes, recipients and retry delays', () => {
    expect(
      mailErrorMessage(err(413, 'attachment_too_large', { max_bytes: 5 * 1024 * 1024 }), t),
    ).toContain('5.0 MB');
    expect(mailErrorMessage(err(422, 'recipient_rejected', { recipient: 'x@y.org' }), t)).toContain(
      'x@y.org',
    );
    expect(mailErrorMessage(err(429, 'rate_limited', undefined, 30), t)).toContain('30');
    expect(mailErrorMessage(err(503, 'upstream_unavailable'), t)).toContain('5');
  });

  it('uses the validation reason, and the stale-id wording', () => {
    expect(
      mailErrorMessage(err(422, 'validation_failed', { reason: 'Тема слишком длинная' }), t),
    ).toBe('Тема слишком длинная');
    expect(mailErrorMessage(err(404, 'not_found', { reason: 'stale_id' }), t)).toMatch(
      /изменилось/,
    );
  });

  it('handles transport failures and unknown errors', () => {
    expect(
      mailErrorMessage(new MailApiError({ status: 0, code: 'network', message: 'x' }), t),
    ).toMatch(/Нет связи/);
    expect(mailErrorMessage(err(500, 'weird'), t)).toMatch(/Внутренняя/);
    expect(mailErrorMessage(new Error('boom'), t)).toMatch(/Что-то пошло не так/);
  });
});
