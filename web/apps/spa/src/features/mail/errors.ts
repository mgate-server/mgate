import type { TFunction } from 'i18next';
import { isMailApiError } from './mailApi';
import { formatBytes } from './format';

/** Codes with a dedicated message under `mail.errors.<code>` (design §11). */
export const KNOWN_ERROR_CODES = new Set([
  'unauthorized',
  'csrf_token_invalid',
  'webmail_requires_mailbox',
  'mailbox_disabled',
  'domain_disabled',
  'not_found',
  'conflict',
  'validation_failed',
  'attachment_too_large',
  'message_too_large',
  'upload_quota_exceeded',
  'quota_exceeded',
  'spool_full',
  'sender_not_allowed',
  'rate_limited',
  'sending_suspended',
  'recipient_rejected',
  'upstream_unavailable',
  'upstream_busy',
  'not_implemented',
  'attachment_not_found',
  'internal',
]);

/** User-facing (localised) text for a failed webmail call. Never leaks server internals. */
export function mailErrorMessage(e: unknown, t: TFunction): string {
  if (!isMailApiError(e)) return t('mail.errors.unknown');
  if (e.code === 'network' || e.status === 0) return t('mail.errors.network');

  const details = e.details ?? {};
  const maxBytes = typeof details.max_bytes === 'number' ? formatBytes(details.max_bytes) : '';
  const recipient = typeof details.recipient === 'string' ? details.recipient : '';

  if (e.code === 'not_found' && details.reason === 'stale_id') return t('mail.errors.stale_id');
  if (e.code === 'conflict' && details.reason === 'system_folder') {
    return t('mail.errors.system_folder');
  }
  if (e.code === 'validation_failed' && typeof details.reason === 'string' && details.reason) {
    return details.reason;
  }
  if (e.code && KNOWN_ERROR_CODES.has(e.code)) {
    return t(`mail.errors.${e.code}`, {
      max: maxBytes,
      recipient,
      seconds: e.retryAfter ?? 5,
    });
  }
  if (e.status >= 500) return t('mail.errors.internal');
  return e.message || t('mail.errors.unknown');
}
