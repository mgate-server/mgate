/** Labels and badge tones for the certificate list (`GET /api/v1/admin/certificates`). */

type Translate = (key: string, fallback: string) => string;

/** Maps the API `source` (`uploaded` | `self_signed` | `acme`) to a label. */
export function sourceLabel(source: string, t: Translate): string {
  switch (source) {
    case 'uploaded':
      return t('admin.certs.sourceUploaded', 'Загруженный');
    case 'self_signed':
      return t('admin.certs.sourceSelfSigned', 'Самоподписанный');
    case 'acme':
      return 'Let’s Encrypt (ACME)';
    default:
      return source;
  }
}

/** Maps the API `status` (`pending` | `valid` | `expiring` | `expired` | `error`) to a badge tone. */
export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'valid':
      return 'success';
    case 'expiring':
      return 'warning';
    case 'expired':
    case 'error':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function statusLabel(status: string, t: Translate): string {
  switch (status) {
    case 'valid':
      return t('admin.certs.statusValid', 'Действителен');
    case 'expiring':
      return t('admin.certs.statusExpiring', 'Скоро истекает');
    case 'expired':
      return t('admin.certs.statusExpired', 'Истёк');
    case 'error':
      return t('admin.certs.statusError', 'Ошибка');
    case 'pending':
      return t('admin.certs.statusPending', 'Ожидает применения');
    default:
      return status;
  }
}
