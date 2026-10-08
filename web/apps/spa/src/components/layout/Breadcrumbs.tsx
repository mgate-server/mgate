import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@mgate/ui';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

interface BreadcrumbsContextType {
  customCrumbs: BreadcrumbItem[] | null;
  setBreadcrumbs: (crumbs: BreadcrumbItem[] | null) => void;
}

const BreadcrumbsContext = createContext<BreadcrumbsContextType>({
  customCrumbs: null,
  setBreadcrumbs: () => {},
});

export function BreadcrumbsProvider({ children }: { children: ReactNode }) {
  const [customCrumbs, setCustomCrumbsState] = useState<BreadcrumbItem[] | null>(null);
  const location = useLocation();

  const setBreadcrumbs = useCallback((crumbs: BreadcrumbItem[] | null) => {
    setCustomCrumbsState((prev) => {
      if (prev === crumbs) return prev;
      if (!prev && !crumbs) return prev;
      if (prev && crumbs && prev.length === crumbs.length) {
        const isSame = prev.every((p, i) => p.label === crumbs[i]?.label && p.to === crumbs[i]?.to);
        if (isSame) return prev;
      }
      return crumbs;
    });
  }, []);

  // Reset custom crumbs on navigation. Derived during render (React's "adjust state when a prop
  // changes" pattern) instead of in an effect, to avoid a cascading second render.
  const [crumbsPath, setCrumbsPath] = useState(location.pathname);
  if (crumbsPath !== location.pathname) {
    setCrumbsPath(location.pathname);
    setCustomCrumbsState(null);
  }

  const value = useMemo(() => ({ customCrumbs, setBreadcrumbs }), [customCrumbs, setBreadcrumbs]);

  return <BreadcrumbsContext.Provider value={value}>{children}</BreadcrumbsContext.Provider>;
}

export function useBreadcrumbs(crumbs?: BreadcrumbItem[] | null) {
  const { setBreadcrumbs } = useContext(BreadcrumbsContext);
  const serialized = crumbs ? JSON.stringify(crumbs) : '';

  useEffect(() => {
    if (crumbs) {
      setBreadcrumbs(crumbs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, setBreadcrumbs]);

  return { setBreadcrumbs };
}

const ROUTE_LABELS: Record<string, string> = {
  admin: 'Администрирование',
  account: 'Личный кабинет',
  mail: 'Почта',
  domains: 'Домены',
  mailboxes: 'Почтовые ящики',
  aliases: 'Алиасы',
  forwardings: 'Пересылки',
  lists: 'Списки рассылки',
  'catch-all': 'Catch-All',
  queue: 'Очередь писем',
  logs: 'Журнал событий',
  statistics: 'Статистика',
  certificates: 'SSL-сертификаты',
  security: 'Безопасность',
  admins: 'Администраторы',
  settings: 'Настройки сервера',
  license: 'Лицензия',
  password: 'Пароль',
  '2fa': '2FA (в разработке)',
  'app-passwords': 'Пароли приложений',
  vacation: 'Автоответчик',
  filters: 'Фильтры писем',
  forwarding: 'Пересылка',
  sessions: 'Активные сессии',
  inbox: 'Входящие',
  sent: 'Отправленные',
  drafts: 'Черновики',
  spam: 'Спам',
  trash: 'Корзина',
  archive: 'Архив',
  contacts: 'Контакты',
  compose: 'Новое письмо',
};

export function Breadcrumbs({ className }: { className?: string }) {
  const { customCrumbs } = useContext(BreadcrumbsContext);
  const location = useLocation();
  const queryClient = useQueryClient();

  const items: BreadcrumbItem[] = (() => {
    if (customCrumbs && customCrumbs.length > 0) {
      return customCrumbs;
    }

    const segments = location.pathname.split('/').filter(Boolean);
    if (segments.length === 0) {
      return [{ label: 'Главная', to: '/' }];
    }

    const result: BreadcrumbItem[] = [{ label: 'Главная', to: '/' }];
    let currentPath = '';

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg) continue;
      currentPath += `/${seg}`;

      const prevSeg = i > 0 ? (segments[i - 1] ?? '') : '';
      const mappedLabel = ROUTE_LABELS[seg];

      if (mappedLabel) {
        result.push({
          label: mappedLabel,
          to: currentPath,
        });
      } else if (prevSeg === 'domains') {
        // Try looking up domain name from TanStack cache
        const domainData = queryClient.getQueryData<{ name?: string }>(['admin', 'domains', seg]);
        result.push({
          label: domainData?.name || seg,
          to: currentPath,
        });
      } else if (prevSeg === 'mailboxes') {
        // Try looking up mailbox address from TanStack cache
        const mbData = queryClient.getQueryData<{ address?: string }>(['admin', 'mailboxes', seg]);
        result.push({
          label: mbData?.address || seg,
          to: currentPath,
        });
      } else {
        result.push({
          label: seg,
          to: currentPath,
        });
      }
    }

    return result;
  })();

  if (items.length <= 1 && items[0]?.to === location.pathname) {
    // Single item on dashboard/index still nice to show context
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('text-mg-text-muted flex items-center text-xs select-none', className)}
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="flex items-center gap-1.5">
              {idx > 0 && <ChevronRight className="text-mg-border h-3 w-3 shrink-0" />}
              {isLast || !item.to ? (
                <span className="text-mg-text max-w-[260px] truncate font-semibold">
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="hover:text-mg-primary flex items-center gap-1 font-medium underline-offset-4 transition-colors hover:underline"
                >
                  {idx === 0 && <Home className="h-3 w-3 shrink-0" />}
                  <span>{item.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
