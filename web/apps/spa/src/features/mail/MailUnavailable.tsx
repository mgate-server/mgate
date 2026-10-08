import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, EmptyState } from '@mgate/ui';
import { useAuth } from '../../auth/AuthContext';

export type MailBlockReason = 'webmail_requires_mailbox' | 'mailbox_disabled' | 'domain_disabled';

/**
 * Full-pane notice for sessions that cannot use webmail: an administrator session (the gateway
 * serves mailbox sessions only), or a mailbox/domain that has been disabled.
 */
export function MailUnavailable({ reason }: { reason: MailBlockReason }) {
  const { t } = useTranslation();
  const { logout, hasAtLeastRole } = useAuth();

  return (
    <div className="flex h-full items-center justify-center p-6" data-testid="mail-unavailable">
      <EmptyState
        title={t(`mail.unavailable.${reason}.title`)}
        description={t(`mail.unavailable.${reason}.description`)}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            {reason === 'webmail_requires_mailbox' && hasAtLeastRole('DomainAdmin') ? (
              <Link to="/admin">
                <Button variant="secondary">{t('mail.unavailable.toAdmin')}</Button>
              </Link>
            ) : null}
            <Button onClick={() => void logout()}>{t('mail.unavailable.signOut')}</Button>
          </div>
        }
      />
    </div>
  );
}
