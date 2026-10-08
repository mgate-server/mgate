import { useTranslation } from 'react-i18next';
import { Badge } from '@mgate/ui';
import type { BadgeTone } from '@mgate/ui';
import {
  parseAuthenticationResults,
  type AuthMechanism,
  type AuthResultValue,
} from './authResults';

export interface AuthResultsBadgeProps {
  /** Raw `Authentication-Results` header value of the message being viewed. */
  authenticationResults: string | null | undefined;
  className?: string;
}

function toneFor(value: AuthResultValue | null): BadgeTone {
  switch (value) {
    case 'pass':
      return 'success';
    case 'fail':
    case 'permerror':
      return 'danger';
    case 'softfail':
    case 'temperror':
    case 'policy':
    case 'neutral':
      return 'warning';
    case 'none':
    default:
      return 'neutral';
  }
}

const MECHANISMS: AuthMechanism[] = ['spf', 'dkim', 'dmarc'];

/** SPF/DKIM/DMARC indicator for the message reader. */
export function AuthResultsBadge({ authenticationResults, className }: AuthResultsBadgeProps) {
  const { t } = useTranslation();
  const parsed = parseAuthenticationResults(authenticationResults);

  return (
    <div className={className} role="group" aria-label={t('mail.authResults.spf', 'SPF')}>
      <div className="flex gap-1.5">
        {MECHANISMS.map((mechanism) => {
          const value = parsed[mechanism];
          return (
            <Badge key={mechanism} tone={toneFor(value)} title={value ?? 'none'}>
              {t(`mail.authResults.${mechanism}`)}: {value ?? '—'}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
