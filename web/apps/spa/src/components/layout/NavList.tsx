import type { ComponentType, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@mgate/ui';

export interface NavEntry {
  to: string;
  label: string;
  end?: boolean;
  icon?: ComponentType<{ className?: string }>;
  badge?: ReactNode;
  sectionTitle?: string;
  onClick?: () => void;
}

export type NavItem = NavEntry;

export function NavList({ items, sectionTitle }: { items: NavEntry[]; sectionTitle?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      {sectionTitle ? (
        <div className="text-mg-text-muted px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
          {sectionTitle}
        </div>
      ) : null}
      <nav className="flex flex-col gap-0.5 px-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.to} className="flex flex-col">
              {item.sectionTitle ? (
                <div className="text-mg-text-muted px-2.5 pt-4 pb-1.5 text-[10px] font-bold tracking-wider uppercase select-none">
                  {item.sectionTitle}
                </div>
              ) : null}
              <NavLink
                to={item.to}
                end={item.end}
                onClick={item.onClick}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all',
                    isActive
                      ? 'bg-mg-primary/10 text-mg-primary font-semibold shadow-2xs'
                      : 'text-mg-text-muted hover:bg-mg-surface-subtle hover:text-mg-text',
                  )
                }
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {Icon ? (
                    <Icon className="group-hover:text-mg-text h-4 w-4 shrink-0 transition-colors" />
                  ) : null}
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge ? <span className="ml-2 shrink-0">{item.badge}</span> : null}
              </NavLink>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
