import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, EmptyState } from '@mgate/ui';

export function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <EmptyState
        title="403"
        description={t('forbidden.description', 'Доступ ограничен. Недостаточно прав для просмотра этой страницы.')}
        action={
          <Link to="/admin">
            <Button>{t('common.back', 'Назад')}</Button>
          </Link>
        }
      />
    </div>
  );
}
