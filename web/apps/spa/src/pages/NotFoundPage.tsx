import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, EmptyState } from '@mgate/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <EmptyState
        title="404"
        description={t('notFound.description', 'Страница не найдена')}
        action={
          <Link to="/">
            <Button>{t('common.back')}</Button>
          </Link>
        }
      />
    </div>
  );
}
