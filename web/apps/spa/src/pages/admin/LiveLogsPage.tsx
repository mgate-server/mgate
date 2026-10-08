import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, PageHeader, StatusDot } from '@mgate/ui';
import { RefreshCw, Filter, Users, Terminal, Shield } from 'lucide-react';
import { fetchApi } from '../../lib/apiClient';

interface LogEvent {
  ts: string;
  src?: string | null;
  host: string;
  prog: string;
  sev: string;
  msg: string;
}

type ConnectionState = 'connecting' | 'open' | 'closed';

export function LiveLogsPage() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [isPreloading, setIsPreloading] = useState(true);

  // Filters
  const [selectedLevel, setSelectedLevel] = useState('ALL');
  const [selectedProg, setSelectedProg] = useState('ALL');
  const [textFilter, setTextFilter] = useState('');
  const [activeView, setActiveView] = useState<'all' | 'logins' | 'mail' | 'audit'>('all');

  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const pausedRef = useRef(isPaused);
  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Preload recent events from /api/v1/admin/logs. Resolves to null when the request failed.
  const fetchRecentLogs = async (): Promise<LogEvent[] | null> => {
    try {
      const res = await fetchApi('/api/v1/admin/logs?limit=250', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      console.warn('Failed to preload logs:', err);
      return null;
    }
  };

  // Manual reload button.
  const loadRecentLogs = async () => {
    setIsPreloading(true);
    const items = await fetchRecentLogs();
    if (items) setEvents(items);
    setIsPreloading(false);
  };

  // Initial preload. isPreloading starts as true, so no synchronous setState is needed here.
  useEffect(() => {
    let active = true;
    void fetchRecentLogs().then((items) => {
      if (!active) return;
      if (items) setEvents(items);
      setIsPreloading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  // SSE Stream
  useEffect(() => {
    let source: EventSource | null = null;
    try {
      source = new EventSource('/api/v1/admin/logs/stream');

      source.onopen = () => setConnection('open');
      source.onerror = () => setConnection('closed');
      source.onmessage = (event) => {
        if (pausedRef.current) return;
        try {
          const parsed = JSON.parse(event.data) as LogEvent;
          setEvents((prev) => {
            const first = prev[0];
            if (first && first.ts === parsed.ts && first.msg === parsed.msg) {
              return prev;
            }
            return [parsed, ...prev].slice(0, 1000);
          });
        } catch {
          // Ignore ping / keepalive frames
        }
      };
    } catch {
      // Opening the stream failed synchronously (external EventSource API); report it as closed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnection('closed');
    }

    return () => {
      source?.close();
    };
  }, []);

  useEffect(() => {
    if (autoScroll && !isPaused && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = 0;
    }
  }, [events, autoScroll, isPaused]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      // View preset filter
      if (activeView === 'logins') {
        const p = e.prog.toLowerCase();
        const m = e.msg.toLowerCase();
        const isLogin =
          p.includes('auth') ||
          p.includes('login') ||
          m.includes('login') ||
          m.includes('auth') ||
          m.includes('password');
        if (!isLogin) return false;
      } else if (activeView === 'mail') {
        const p = e.prog.toLowerCase();
        const m = e.msg.toLowerCase();
        const isMail =
          [
            'postfix',
            'dovecot',
            'rspamd',
            'opendkim',
            'smtp',
            'qmgr',
            'lmtp',
            'cleanup',
            'bounce',
            'anvil',
          ].some((s) => p.includes(s)) ||
          m.includes('status=') ||
          m.includes('from=<') ||
          m.includes('to=<') ||
          m.includes('client=');
        if (!isMail) return false;
      } else if (activeView === 'audit') {
        const p = e.prog.toLowerCase();
        const m = e.msg.toLowerCase();
        if (!p.includes('audit') && !m.includes('audit')) return false;
      }

      // Dropdown level filter
      if (selectedLevel !== 'ALL') {
        const sev = e.sev.toLowerCase();
        if (
          selectedLevel === 'ERROR' &&
          !['err', 'error', 'crit', 'alert', 'emerg'].includes(sev)
        ) {
          return false;
        }
        if (selectedLevel === 'WARN' && !['warn', 'warning'].includes(sev)) {
          return false;
        }
        if (selectedLevel === 'INFO' && sev !== 'info' && sev !== 'notice') {
          return false;
        }
        if (selectedLevel === 'DEBUG' && sev !== 'debug') {
          return false;
        }
      }

      // Dropdown prog filter
      if (selectedProg !== 'ALL') {
        if (!e.prog.toLowerCase().includes(selectedProg.toLowerCase())) {
          return false;
        }
      }

      // Free text search
      if (textFilter) {
        const q = textFilter.toLowerCase();
        const msgMatch = e.msg.toLowerCase().includes(q);
        const hostMatch = e.host.toLowerCase().includes(q);
        const srcMatch = (e.src ?? '').toLowerCase().includes(q);
        const progMatch = e.prog.toLowerCase().includes(q);
        if (!msgMatch && !hostMatch && !srcMatch && !progMatch) return false;
      }

      return true;
    });
  }, [events, activeView, selectedLevel, selectedProg, textFilter]);

  function getSevColor(sev: string) {
    switch (sev.toLowerCase()) {
      case 'err':
      case 'error':
      case 'crit':
      case 'alert':
      case 'emerg':
        return 'text-mg-danger font-semibold bg-red-500/10 px-1.5 py-0.5 rounded';
      case 'warning':
      case 'warn':
        return 'text-amber-500 font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded';
      case 'debug':
        return 'text-mg-text-muted bg-gray-500/10 px-1.5 py-0.5 rounded';
      case 'info':
      case 'notice':
      default:
        return 'text-emerald-500 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded';
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.admin.logs', 'Системные логи')}
        actions={
          <div className="flex items-center gap-2">
            <StatusDot
              tone={
                connection === 'open'
                  ? 'success'
                  : connection === 'connecting'
                    ? 'warning'
                    : 'danger'
              }
              label={
                connection === 'open'
                  ? 'Поток активен'
                  : connection === 'connecting'
                    ? 'Подключение'
                    : 'Остановлен'
              }
              pulse={connection === 'open' && !isPaused}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={loadRecentLogs}
              isLoading={isPreloading}
              title="Перезагрузить последние события из базы"
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Обновить
            </Button>
            <Button
              size="sm"
              variant={isPaused ? 'primary' : 'secondary'}
              onClick={() => setIsPaused(!isPaused)}
            >
              {isPaused ? t('admin.logs.resume', 'Возобновить') : t('admin.logs.pause', 'Пауза')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEvents([])}>
              {t('admin.logs.clear', 'Очистить')}
            </Button>
          </div>
        }
      />

      {/* Preset View Tabs */}
      <div className="border-mg-border flex items-center gap-1 border-b pb-2">
        <button
          type="button"
          onClick={() => setActiveView('all')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeView === 'all'
              ? 'bg-mg-primary text-white shadow-sm'
              : 'text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-raised'
          }`}
        >
          <Terminal className="h-3.5 w-3.5" />
          Все события ({events.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveView('logins')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeView === 'logins'
              ? 'bg-mg-primary text-white shadow-sm'
              : 'text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-raised'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          Входы пользователей (Авторизации)
        </button>
        <button
          type="button"
          onClick={() => setActiveView('mail')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeView === 'mail'
              ? 'bg-mg-primary text-white shadow-sm'
              : 'text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-raised'
          }`}
        >
          Почтовые сервисы (MTA/IMAP)
        </button>
        <button
          type="button"
          onClick={() => setActiveView('audit')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeView === 'audit'
              ? 'bg-mg-primary text-white shadow-sm'
              : 'text-mg-text-muted hover:text-mg-text hover:bg-mg-surface-raised'
          }`}
        >
          <Shield className="h-3.5 w-3.5" />
          Журнал аудита
        </button>
      </div>

      <Card>
        {/* Filters bar: Dropdowns instead of raw inputs */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-mg-text-muted text-xs font-medium">
              Уровень важности (Level)
            </label>
            <select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
              className="border-mg-border bg-mg-surface text-mg-text focus:border-mg-primary focus:ring-mg-primary w-full rounded-md border px-3 py-1.5 text-xs shadow-sm focus:ring-1 focus:outline-none"
            >
              <option value="ALL">Все уровни (ALL)</option>
              <option value="ERROR">Ошибки (ERROR / CRIT)</option>
              <option value="WARN">Предупреждения (WARN)</option>
              <option value="INFO">Информационные (INFO)</option>
              <option value="DEBUG">Отладка (DEBUG)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-mg-text-muted text-xs font-medium">Компонент системы</label>
            <select
              value={selectedProg}
              onChange={(e) => setSelectedProg(e.target.value)}
              className="border-mg-border bg-mg-surface text-mg-text focus:border-mg-primary focus:ring-mg-primary w-full rounded-md border px-3 py-1.5 text-xs shadow-sm focus:ring-1 focus:outline-none"
            >
              <option value="ALL">Все компоненты</option>
              <option value="postfix">Postfix (MTA / SMTP)</option>
              <option value="dovecot">Dovecot (IMAP / POP3)</option>
              <option value="rspamd">Rspamd (Антиспам)</option>
              <option value="auth">Авторизация (Auth & Logins)</option>
              <option value="audit">Аудит действий (Audit)</option>
              <option value="api">MGate API Backend</option>
              <option value="worker">MGate Worker</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-mg-text-muted text-xs font-medium">
              Поиск по тексту, адресу или IP
            </label>
            <Input
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              placeholder="Например: status=sent, admin@..., IP..."
              className="text-xs"
            />
          </div>
        </div>

        <div className="text-mg-text-muted flex items-center justify-between pb-2 text-xs">
          <span>
            Показано <strong>{filtered.length}</strong> из <strong>{events.length}</strong> событий
            {isPreloading && (
              <span className="text-mg-primary ml-2 animate-pulse">(Загрузка истории...)</span>
            )}
          </span>
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="text-mg-primary focus:ring-mg-primary rounded"
            />
            <span>{t('admin.logs.autoscroll', 'Автоскролл к новым событиям')}</span>
          </label>
        </div>

        <div
          ref={logsContainerRef}
          className="border-mg-border bg-mg-surface-raised max-h-[550px] overflow-y-auto rounded-md border font-mono text-xs"
        >
          {filtered.length === 0 ? (
            <p className="text-mg-text-muted p-6 text-center">
              {events.length === 0
                ? isPreloading
                  ? 'Загрузка недавних событий...'
                  : t(
                      'admin.logs.waiting',
                      'Ожидание событий в реальном времени из потока логов...',
                    )
                : t('admin.logs.noMatches', 'Нет событий, соответствующих выбранным фильтрам.')}
            </p>
          ) : (
            <ul className="divide-mg-border divide-y">
              {filtered.map((e, i) => (
                <li
                  key={`${e.ts}-${i}`}
                  className="hover:bg-mg-surface flex flex-wrap items-baseline gap-2 px-3 py-1.5 transition-colors"
                >
                  <span className="text-mg-text-muted font-sans text-[11px] whitespace-nowrap">
                    {e.ts ? new Date(e.ts).toLocaleTimeString() : ''}
                  </span>
                  <span
                    className={`font-sans text-[10px] tracking-wide uppercase ${getSevColor(e.sev)}`}
                  >
                    {e.sev}
                  </span>
                  <span className="text-mg-primary font-semibold whitespace-nowrap">{e.prog}</span>
                  {e.src ? (
                    <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
                      [{e.src}]
                    </span>
                  ) : null}
                  <span className="text-mg-text flex-1 break-all">{e.msg}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
