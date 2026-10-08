import { useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '../cn';

export interface SidebarShellProps {
  sidebar: ReactNode;
  topbar?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
  fullHeight?: boolean;
}

/**
 * Modern Shell:
 * [ GLOBAL TOPBAR (100% width, h-14)                     ]
 * [ FIXED LEFT SIDEBAR (w-64) | MAIN CONTENT (flex-1)    ]
 * Mobile: responsive collapsible drawer with hamburger toggle.
 */
export function SidebarShell({
  sidebar,
  topbar,
  children,
  className,
  noPadding = false,
  fullHeight = false,
}: SidebarShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div
      className={cn(
        'bg-mg-bg text-mg-text flex flex-col h-screen w-screen overflow-hidden',
        className,
      )}
    >
      {/* Top Bar across the entire top edge */}
      {topbar ? (
        <header className="border-b border-mg-border bg-mg-surface flex h-14 shrink-0 items-center z-30 px-2 md:px-0">
          <button
            type="button"
            className="md:hidden mr-2 p-1.5 rounded-lg text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-subtle"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle navigation"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex-1 min-w-0 flex items-center">{topbar}</div>
        </header>
      ) : null}

      {/* Main horizontal split: Sidebar on Left, Content on Right */}
      <div className="flex flex-row flex-1 min-h-0 min-w-0 overflow-hidden relative">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex w-64 shrink-0 border-r border-mg-border bg-mg-surface flex-col h-full overflow-y-auto">
          {sidebar}
        </aside>

        {/* Mobile Drawer Overlay */}
        {mobileOpen && (
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
          >
            <div
              className="w-72 max-w-[85vw] h-full bg-mg-surface border-r border-mg-border shadow-2xl flex flex-col overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-2 flex justify-end border-b border-mg-border">
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="p-1 rounded text-mg-text-muted hover:text-mg-text"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1" onClick={() => setMobileOpen(false)}>
                {sidebar}
              </div>
            </div>
          </div>
        )}

        <main
          className={cn(
            'flex-1 min-w-0 h-full',
            fullHeight ? 'overflow-hidden flex flex-col' : 'overflow-y-auto',
            noPadding ? 'p-0' : 'p-4 md:p-6',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
