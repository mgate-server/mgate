import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Search,
  BookOpen,
  Globe,
  Mail,
  ShieldCheck,
  Smartphone,
  Inbox,
  RefreshCw,
  Layers,
  Lock,
  Copy,
  Check,
  ExternalLink,
  ChevronRight,
  Info,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { Button, Card, Input, PageHeader, Badge } from '@mgate/ui';
import { SPA_VERSION } from '../../lib/versionCheck';

type DocSectionId =
  | 'overview'
  | 'domains'
  | 'mailboxes'
  | 'security'
  | 'clients'
  | 'webmail'
  | 'migration'
  | 'queue-logs'
  | 'ssl-backup';

interface DocSectionMeta {
  id: DocSectionId;
  title: string;
  icon: typeof BookOpen;
  badge?: string;
  desc: string;
}

export function DocumentationPage() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<DocSectionId>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const sections: DocSectionMeta[] = [
    {
      id: 'overview',
      title: 'Быстрый старт и схема работы',
      icon: BookOpen,
      desc: 'Архитектура почтового потока компании, роли пользователей и первый запуск',
    },
    {
      id: 'domains',
      title: 'Почтовые домены и DNS',
      icon: Globe,
      desc: 'Подключение домена, MX, SPF, DKIM, DMARC, проверка статуса',
    },
    {
      id: 'mailboxes',
      title: 'Ящики, алиасы и группы',
      icon: Mail,
      desc: 'Создание пользователей, квоты, псевдонимы, права Send-As, списки рассылки',
    },
    {
      id: 'security',
      title: 'Безопасность и 2FA',
      icon: ShieldCheck,
      badge: '2FA — в разработке',
      desc: 'Пароли приложений, защита от перебора, сессии и антиспам; двухфакторная защита (TOTP) — в разработке',
    },
    {
      id: 'clients',
      title: 'Настройка почтовых клиентов',
      icon: Smartphone,
      desc: 'Параметры IMAP/SMTP, инструкции для Outlook, Apple Mail, Thunderbird',
    },
    {
      id: 'webmail',
      title: 'Веб-почта (Webmail)',
      icon: Inbox,
      desc: 'Интерфейс работы с письмами, папки, поиск, контакты и правила',
    },
    {
      id: 'migration',
      title: 'Бесшовная миграция почты',
      icon: RefreshCw,
      badge: 'Zero Downtime',
      desc: 'Перенос писем с Яндекс 360, Google Workspace, Mail.ru и любых IMAP-серверов',
    },
    {
      id: 'queue-logs',
      title: 'Очереди, логи и мониторинг',
      icon: Layers,
      desc: 'Управление очередью Postfix, живые логи, аналитика доставляемости',
    },
    {
      id: 'ssl-backup',
      title: 'SSL-сертификаты и бэкапы',
      icon: Lock,
      desc: 'Самоподписанный сертификат по умолчанию, загрузка собственного сертификата, резервные снимки (автовыпуск Let’s Encrypt — в разработке)',
    },
  ];

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredSections = searchQuery.trim()
    ? sections.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.desc.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sections;

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={t('admin.docs.title', 'Документация и руководство пользователя')}
        description={t(
          'admin.docs.subtitle',
          'Полное практическое руководство по настройке почтовой платформы MGate для администраторов и сотрудников',
        )}
      />

      {/* Top Search & Highlights */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="relative w-full flex-1">
            <Search className="text-mg-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Поиск по статьям и инструкциям (например: DKIM, Outlook, миграция, квота)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-mg-surface border-mg-border-subtle focus:border-mg-primary text-mg-text w-full rounded-md border py-2 pr-4 pl-9 text-sm focus:outline-none"
            />
          </div>
          <div className="text-mg-text-muted flex items-center gap-2 self-start font-mono text-xs whitespace-nowrap sm:self-auto">
            <Badge tone="success">v{SPA_VERSION}</Badge>
            <span className="hidden md:inline">· 100% On-Premise</span>
          </div>
        </div>
      </Card>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Left: Category Sidebar */}
        <div className="space-y-2 lg:col-span-4">
          <div className="text-mg-text-muted px-2 py-1 text-xs font-semibold tracking-wider uppercase">
            Разделы справочника
          </div>
          <div className="space-y-1">
            {filteredSections.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => setActiveSection(sec.id)}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all ${
                    isActive
                      ? 'bg-mg-surface border-mg-border shadow-xs'
                      : 'hover:bg-mg-surface-subtle hover:border-mg-border-subtle border-transparent bg-transparent'
                  }`}
                >
                  <div
                    className={`mt-0.5 shrink-0 rounded-md p-2 ${
                      isActive
                        ? 'bg-mg-primary text-mg-primary-contrast'
                        : 'bg-mg-surface-subtle text-mg-text-muted'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`truncate text-sm font-semibold ${
                          isActive ? 'text-mg-text' : 'text-mg-text-muted'
                        }`}
                      >
                        {sec.title}
                      </span>
                      {sec.badge && (
                        <span className="bg-mg-surface-subtle text-mg-primary border-mg-border-subtle rounded border px-1.5 py-0.5 font-mono text-[10px]">
                          {sec.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-mg-text-muted mt-0.5 line-clamp-1 text-xs">{sec.desc}</p>
                  </div>
                  <ChevronRight
                    className={`mt-2 h-4 w-4 shrink-0 transition-transform ${
                      isActive ? 'text-mg-primary rotate-90' : 'text-mg-text-muted opacity-40'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* Quick Client Jump Box */}
          <div className="bg-mg-surface-subtle border-mg-border-subtle mt-4 rounded-lg border p-4">
            <div className="text-mg-text mb-2 flex items-center gap-2 text-xs font-semibold">
              <ExternalLink className="text-mg-primary h-3.5 w-3.5" />
              Быстрый переход в веб-интерфейс
            </div>
            <p className="text-mg-text-muted mb-3 text-xs">
              Для перехода в почтовый ящик сотрудника используйте веб-клиент:
            </p>
            <a
              href="/mail"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-mg-primary text-mg-primary-contrast inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
            >
              <span>Открыть Веб-почту (/mail)</span>
              <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Right: Article Details Content */}
        <div className="lg:col-span-8">
          {activeSection === 'overview' && (
            <Card className="space-y-6 p-6">
              <div className="border-mg-border-subtle flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <h2 className="text-mg-text text-xl font-bold">
                    1. Быстрый старт и схема работы почты
                  </h2>
                  <p className="text-mg-text-muted mt-1 text-sm">
                    Сквозной путь сообщения от внешнего сервера до почтового ящика сотрудника
                  </p>
                </div>
                <Badge tone="primary">Архитектура</Badge>
              </div>

              {/* Mail Flow SVG Pipeline */}
              <div className="bg-mg-surface-subtle border-mg-border-subtle overflow-x-auto rounded-lg border p-4">
                <div className="text-mg-text mb-3 text-xs font-bold tracking-wider uppercase">
                  Схема сквозного почтового потока компании (Mail Pipeline)
                </div>
                <svg viewBox="0 0 760 160" className="h-auto w-full min-w-[700px] font-sans">
                  {/* Step 1: Sender */}
                  <rect
                    x="10"
                    y="35"
                    width="120"
                    height="85"
                    rx="6"
                    fill="#ffffff"
                    stroke="#cbd5e1"
                    strokeWidth="1.5"
                  />
                  <text
                    x="70"
                    y="65"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#0f172a"
                  >
                    Отправитель
                  </text>
                  <text x="70" y="85" textAnchor="middle" fontSize="9" fill="#64748b">
                    Внешний MTA
                  </text>
                  <text
                    x="70"
                    y="102"
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="monospace"
                    fill="#0284c7"
                  >
                    SMTP :25
                  </text>

                  <line x1="130" y1="77" x2="165" y2="77" stroke="#94a3b8" strokeWidth="2" />

                  {/* Step 2: Postscreen & Policy */}
                  <rect
                    x="165"
                    y="25"
                    width="135"
                    height="105"
                    rx="6"
                    fill="#ffffff"
                    stroke="#0f172a"
                    strokeWidth="2"
                  />
                  <rect x="165" y="25" width="135" height="22" rx="6" fill="#0f172a" />
                  <text
                    x="232"
                    y="40"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#ffffff"
                  >
                    Входной фильтр
                  </text>
                  <text
                    x="232"
                    y="66"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="600"
                    fill="#0f172a"
                  >
                    Postscreen
                  </text>
                  <text x="232" y="84" textAnchor="middle" fontSize="9" fill="#64748b">
                    DNSBL списки
                  </text>
                  <text x="232" y="100" textAnchor="middle" fontSize="9" fill="#64748b">
                    SPF / HELO анализ
                  </text>
                  <text x="232" y="118" textAnchor="middle" fontSize="8" fill="#059669">
                    ● Защита от ботов
                  </text>

                  <line x1="300" y1="77" x2="335" y2="77" stroke="#94a3b8" strokeWidth="2" />

                  {/* Step 3: Rspamd & ClamAV */}
                  <rect
                    x="335"
                    y="25"
                    width="145"
                    height="105"
                    rx="6"
                    fill="#ffffff"
                    stroke="#d97706"
                    strokeWidth="2"
                  />
                  <rect x="335" y="25" width="145" height="22" rx="6" fill="#d97706" />
                  <text
                    x="407"
                    y="40"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#ffffff"
                  >
                    Антиспам & Антивирус
                  </text>
                  <text
                    x="407"
                    y="66"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="600"
                    fill="#0f172a"
                  >
                    Rspamd + ClamAV
                  </text>
                  <text x="407" y="84" textAnchor="middle" fontSize="9" fill="#64748b">
                    DKIM / ARC проверка
                  </text>
                  <text x="407" y="100" textAnchor="middle" fontSize="9" fill="#64748b">
                    Байесовский скоринг
                  </text>
                  <text x="407" y="118" textAnchor="middle" fontSize="8" fill="#d97706">
                    ● Потоковый скан
                  </text>

                  <line x1="480" y1="77" x2="515" y2="77" stroke="#94a3b8" strokeWidth="2" />

                  {/* Step 4: Storage */}
                  <rect
                    x="515"
                    y="25"
                    width="125"
                    height="105"
                    rx="6"
                    fill="#ffffff"
                    stroke="#0284c7"
                    strokeWidth="2"
                  />
                  <rect x="515" y="25" width="125" height="22" rx="6" fill="#0284c7" />
                  <text
                    x="577"
                    y="40"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#ffffff"
                  >
                    Хранилище писем
                  </text>
                  <text
                    x="577"
                    y="66"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="600"
                    fill="#0f172a"
                  >
                    Dovecot MDA
                  </text>
                  <text x="577" y="84" textAnchor="middle" fontSize="9" fill="#64748b">
                    LMTP протокол
                  </text>
                  <text x="577" y="100" textAnchor="middle" fontSize="9" fill="#64748b">
                    Sieve-правила
                  </text>
                  <text x="577" y="118" textAnchor="middle" fontSize="8" fill="#0284c7">
                    ● Автоответчик
                  </text>

                  <line x1="640" y1="77" x2="675" y2="77" stroke="#94a3b8" strokeWidth="2" />

                  {/* Step 5: Clients */}
                  <rect
                    x="675"
                    y="35"
                    width="75"
                    height="85"
                    rx="6"
                    fill="#ffffff"
                    stroke="#cbd5e1"
                    strokeWidth="1.5"
                  />
                  <text
                    x="712"
                    y="60"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#0f172a"
                  >
                    Клиент
                  </text>
                  <text x="712" y="78" textAnchor="middle" fontSize="9" fill="#64748b">
                    Webmail
                  </text>
                  <text x="712" y="94" textAnchor="middle" fontSize="9" fill="#64748b">
                    Outlook
                  </text>
                  <text x="712" y="110" textAnchor="middle" fontSize="8" fill="#059669">
                    IMAP :993
                  </text>
                </svg>
              </div>

              <div className="text-mg-text-muted space-y-3 text-sm leading-relaxed">
                <p>
                  <strong>MGate</strong> — полностью автономный почтовый комплекс. Входящие письма
                  принимаются службой Postfix, валидируются на подлинность домена отправителя
                  (SPF/DKIM/DMARC), проверяются антивирусом ClamAV и антиспамом Rspamd.
                </p>
                <p>
                  При отсутствии угроз сообщение передается через LMTP в хранилище Dovecot, где
                  срабатывают пользовательские фильтры сортировки (Sieve) и автоответчики.
                  Пользователь получает уведомление мгновенно (IMAP IDLE Push).
                </p>
              </div>

              {/* Roles Table */}
              <div>
                <h3 className="text-mg-text mb-3 text-base font-bold">
                  Роли пользователей в системе
                </h3>
                <div className="border-mg-border-subtle overflow-hidden rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-mg-surface-subtle border-mg-border-subtle text-mg-text border-b text-left font-semibold">
                      <tr>
                        <th className="p-3">Роль</th>
                        <th className="p-3">Область доступа</th>
                        <th className="p-3">Возможности</th>
                      </tr>
                    </thead>
                    <tbody className="divide-mg-border-subtle text-mg-text-muted divide-y">
                      <tr>
                        <td className="text-mg-text p-3 font-semibold">Суперадминистратор</td>
                        <td className="p-3">Вся система (/admin)</td>
                        <td className="p-3">
                          Создание доменов, сертификаты SSL, управление очередью писем, логи,
                          бэкапы.
                        </td>
                      </tr>
                      <tr>
                        <td className="text-mg-text p-3 font-semibold">Администратор домена</td>
                        <td className="p-3">Только свой домен</td>
                        <td className="p-3">
                          Создание ящиков сотрудников, управление квотами, алиасами и группами
                          рассылки.
                        </td>
                      </tr>
                      <tr>
                        <td className="text-mg-text p-3 font-semibold">Сотрудник (User)</td>
                        <td className="p-3">Веб-почта (/mail, /account)</td>
                        <td className="p-3">
                          Чтение/отправка почты, пароли приложений, автоответчик «В отпуске».
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3 pt-2">
                <Link to="/admin/domains">
                  <Button variant="primary" size="sm">
                    Управление доменами
                  </Button>
                </Link>
                <Link to="/admin/mailboxes">
                  <Button variant="secondary" size="sm">
                    Почтовые ящики
                  </Button>
                </Link>
              </div>
            </Card>
          )}

          {activeSection === 'domains' && (
            <Card className="space-y-6 p-6">
              <div className="border-mg-border-subtle flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <h2 className="text-mg-text text-xl font-bold">
                    2. Почтовые домены и настройка DNS
                  </h2>
                  <p className="text-mg-text-muted mt-1 text-sm">
                    Подключение корпоративного домена, создание записей MX, SPF, DKIM и DMARC
                  </p>
                </div>
                <Link to="/admin/domains">
                  <Button variant="secondary" size="sm">
                    Открыть Домены
                  </Button>
                </Link>
              </div>

              <div className="text-mg-text-muted space-y-4 text-sm">
                <p>
                  Корректно настроенные DNS-записи гарантируют, что ваши письма будут безоговорочно
                  приниматься почтовыми сервисами Яндекс, Mail.ru, Gmail и корпоративными шлюзами
                  контрагентов.
                </p>

                {/* DNS Records Reference Table */}
                <div className="border-mg-border-subtle overflow-hidden rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-mg-surface-subtle border-mg-border-subtle text-mg-text border-b text-left font-semibold">
                      <tr>
                        <th className="p-3">Запись</th>
                        <th className="p-3">Имя поддомена</th>
                        <th className="p-3">Значение для DNS</th>
                        <th className="p-3">Копировать</th>
                      </tr>
                    </thead>
                    <tbody className="divide-mg-border-subtle divide-y font-mono">
                      <tr>
                        <td className="text-mg-text p-3 font-semibold">MX (Mail Exchanger)</td>
                        <td className="p-3">@</td>
                        <td className="text-mg-primary p-3">10 mail.example.com.</td>
                        <td className="p-3">
                          <button
                            onClick={() => handleCopy('10 mail.example.com.', 'mx')}
                            className="hover:text-mg-primary p-1"
                          >
                            {copiedKey === 'mx' ? (
                              <Check className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                      </tr>
                      <tr>
                        <td className="text-mg-text p-3 font-semibold">A (Хост сервера)</td>
                        <td className="p-3">mail</td>
                        <td className="text-mg-primary p-3">198.51.100.25 (IP вашего сервера)</td>
                        <td className="p-3">
                          <button
                            onClick={() => handleCopy('198.51.100.25', 'a')}
                            className="hover:text-mg-primary p-1"
                          >
                            {copiedKey === 'a' ? (
                              <Check className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                      </tr>
                      <tr>
                        <td className="text-mg-text p-3 font-semibold">TXT (SPF)</td>
                        <td className="p-3">@</td>
                        <td className="text-mg-primary p-3">"v=spf1 mx a:mail.example.com ~all"</td>
                        <td className="p-3">
                          <button
                            onClick={() => handleCopy('"v=spf1 mx a:mail.example.com ~all"', 'spf')}
                            className="hover:text-mg-primary p-1"
                          >
                            {copiedKey === 'spf' ? (
                              <Check className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                      </tr>
                      <tr>
                        <td className="text-mg-text p-3 font-semibold">TXT (DKIM)</td>
                        <td className="p-3">mgate._domainkey</td>
                        <td className="text-mg-primary max-w-[200px] truncate p-3">
                          "v=DKIM1; k=rsa; p=MIIB..."
                        </td>
                        <td className="p-3">
                          <span className="text-mg-text-muted font-sans text-[10px]">
                            Генерируется в домене
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="text-mg-text p-3 font-semibold">TXT (DMARC)</td>
                        <td className="p-3">_dmarc</td>
                        <td className="text-mg-primary p-3">
                          "v=DMARC1; p=quarantine; sp=quarantine; pct=100"
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() =>
                              handleCopy(
                                '"v=DMARC1; p=quarantine; sp=quarantine; pct=100"',
                                'dmarc',
                              )
                            }
                            className="hover:text-mg-primary p-1"
                          >
                            {copiedKey === 'dmarc' ? (
                              <Check className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* DKIM Rotation Explainer */}
                <div className="bg-mg-surface-subtle border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <div className="text-mg-text text-xs font-bold tracking-wider uppercase">
                    Регламент плановой ротации DKIM-ключей
                  </div>
                  <p className="text-mg-text-muted text-xs">
                    Рекомендуется периодически (например, раз в 6 месяцев) заменять ключ DKIM.
                    Ротация выполняется вручную кнопкой «Ротировать DKIM» на вкладке DNS домена:
                    сервер генерирует новый ключ (RSA-2048) с новым селектором и сразу начинает
                    подписывать им письма, поэтому опубликуйте новую TXT-запись в DNS сразу после
                    ротации. Запись со старым селектором оставьте в DNS не менее 14 дней, чтобы
                    проверялись письма, уже находящиеся в пути.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {activeSection === 'mailboxes' && (
            <Card className="space-y-6 p-6">
              <div className="border-mg-border-subtle flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <h2 className="text-mg-text text-xl font-bold">
                    3. Почтовые ящики, алиасы и группы
                  </h2>
                  <p className="text-mg-text-muted mt-1 text-sm">
                    Управление учетными записями сотрудников, дисковыми квотами, псевдонимами и
                    рассылками
                  </p>
                </div>
                <Link to="/admin/mailboxes">
                  <Button variant="secondary" size="sm">
                    Список ящиков
                  </Button>
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="border-mg-border-subtle bg-mg-surface space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">Почтовый ящик и квоты</h4>
                  <p className="text-mg-text-muted text-xs leading-relaxed">
                    Каждому сотруднику задается персональный лимит диска (например, 10 GB или 50
                    GB). При переполнении новые письма временно задерживаются в очереди без
                    удаления.
                  </p>
                </div>

                <div className="border-mg-border-subtle bg-mg-surface space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">Алиасы (псевдонимы)</h4>
                  <p className="text-mg-text-muted text-xs leading-relaxed">
                    Позволяют привязать к одному ящику несколько адресов (например,{' '}
                    <code>ceo@example.com</code> и <code>john.doe@example.com</code>). Не расходуют
                    дисковое пространство и бесплатны в лицензировании.
                  </p>
                </div>

                <div className="border-mg-border-subtle bg-mg-surface space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">Права отправки (Send-As)</h4>
                  <p className="text-mg-text-muted text-xs leading-relaxed">
                    Администратор может разрешить доверенным сотрудникам отправлять письма от имени
                    общего адреса (например, <code>info@example.com</code> или{' '}
                    <code>sales@example.com</code>).
                  </p>
                </div>

                <div className="border-mg-border-subtle bg-mg-surface space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">
                    Списки рассылки (Distribution Lists)
                  </h4>
                  <p className="text-mg-text-muted text-xs leading-relaxed">
                    Общие корпоративные адреса для отделов (<code>dev@example.com</code>,{' '}
                    <code>buh@example.com</code>). Поддерживают режим «только внутри компании» для
                    защиты от нежелательного спама.
                  </p>
                </div>
              </div>

              {/* Catch-All Info */}
              <div className="bg-mg-surface-subtle border-mg-border-subtle space-y-1 rounded-lg border p-4">
                <span className="text-mg-text text-xs font-bold tracking-wider uppercase">
                  Функция Catch-All
                </span>
                <p className="text-mg-text-muted text-xs">
                  Перехватывает сообщения, отправленные на ошибочные или опечатанные адреса вашего
                  домена. Письма перенаправляются на указанный дежурный ящик компании.
                </p>
              </div>
            </Card>
          )}

          {activeSection === 'security' && (
            <Card className="space-y-6 p-6">
              <div className="border-mg-border-subtle flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <h2 className="text-mg-text text-xl font-bold">
                    4. Безопасность и двухфакторная аутентификация
                  </h2>
                  <p className="text-mg-text-muted mt-1 text-sm">
                    Защита учетных записей от взлома: пароли приложений, защита от перебора и аудит
                    сессий. Двухфакторная аутентификация (TOTP) — в разработке
                  </p>
                </div>
                <Link to="/admin/security">
                  <Button variant="secondary" size="sm">
                    Политики безопасности
                  </Button>
                </Link>
              </div>

              <div className="text-mg-text-muted space-y-4 text-sm leading-relaxed">
                <div className="border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">
                    Двухфакторная защита (TOTP) — в разработке
                  </h4>
                  <p className="text-xs">
                    В этой версии вход в веб-интерфейс выполняется только по паролю: одноразовый код
                    TOTP при входе не запрашивается и не проверяется, поэтому подключение 2FA в
                    личном кабинете временно недоступно, а принудительное включение 2FA для ящиков
                    не работает. Для защиты используйте длинные уникальные пароли и отдельные пароли
                    приложений для почтовых программ.
                  </p>
                </div>

                <div className="border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">
                    Пароли приложений (App Passwords)
                  </h4>
                  <p className="text-xs">
                    Внешние клиенты (Outlook, Apple Mail, Thunderbird) подключаются с отдельными
                    криптографическими паролями приложений. Основной мастер-пароль сотрудника не
                    вводится в сторонние программы, а доступ с конкретного устройства можно отозвать
                    в любой момент без смены пароля от ящика.
                  </p>
                </div>

                <div className="border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">
                    Защита от перебора паролей (Brute-Force)
                  </h4>
                  <p className="text-xs">
                    Встроенная защита от перебора паролей автоматически временно блокирует IP-адрес
                    после серии неудачных попыток входа; повторные нарушения удлиняют блокировку.
                    Администратор видит активные блокировки в разделе «Безопасность».
                  </p>
                </div>
              </div>
            </Card>
          )}

          {activeSection === 'clients' && (
            <Card className="space-y-6 p-6">
              <div className="border-mg-border-subtle flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <h2 className="text-mg-text text-xl font-bold">
                    5. Настройка внешних почтовых клиентов
                  </h2>
                  <p className="text-mg-text-muted mt-1 text-sm">
                    Единые параметры подключения по протоколам IMAP и SMTP с обязательным
                    шифрованием
                  </p>
                </div>
                <Badge tone="success">TLS 1.3</Badge>
              </div>

              {/* Protocol Parameters Matrix */}
              <div className="border-mg-border-subtle overflow-hidden rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-mg-surface-subtle border-mg-border-subtle text-mg-text border-b text-left font-semibold">
                    <tr>
                      <th className="p-3">Служба</th>
                      <th className="p-3">Сервер</th>
                      <th className="p-3">Порт</th>
                      <th className="p-3">Шифрование</th>
                      <th className="p-3">Логин / Пароль</th>
                    </tr>
                  </thead>
                  <tbody className="divide-mg-border-subtle text-mg-text-muted divide-y font-mono">
                    <tr>
                      <td className="text-mg-text p-3 font-sans font-semibold">Входящие (IMAP)</td>
                      <td className="text-mg-primary p-3">mail.example.com</td>
                      <td className="p-3 font-bold">993</td>
                      <td className="p-3 font-sans font-semibold text-emerald-600">SSL / TLS</td>
                      <td className="p-3 font-sans">Полный email + пароль приложения</td>
                    </tr>
                    <tr>
                      <td className="text-mg-text p-3 font-sans font-semibold">Исходящие (SMTP)</td>
                      <td className="text-mg-primary p-3">mail.example.com</td>
                      <td className="p-3 font-bold">465</td>
                      <td className="p-3 font-sans font-semibold text-emerald-600">SSL / TLS</td>
                      <td className="p-3 font-sans">Требуется авторизация (как для IMAP)</td>
                    </tr>
                    <tr>
                      <td className="text-mg-text p-3 font-sans font-semibold">
                        Альтернативный SMTP
                      </td>
                      <td className="text-mg-primary p-3">mail.example.com</td>
                      <td className="p-3 font-bold">587</td>
                      <td className="p-3 font-sans font-semibold text-blue-600">STARTTLS</td>
                      <td className="p-3 font-sans">Требуется авторизация</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="text-mg-text-muted grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
                <div className="bg-mg-surface-subtle border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">
                    Microsoft Outlook (Windows / Mac)
                  </h4>
                  <p>1. Файл ➔ Добавить учетную запись.</p>
                  <p>
                    2. Укажите email: <code>user@example.com</code>.
                  </p>
                  <p>3. Выберите «Настройка вручную ➔ IMAP».</p>
                  <p>
                    4. Входящий сервер: <code>mail.example.com</code> (993 SSL/TLS).
                  </p>
                  <p>
                    5. Исходящий сервер: <code>mail.example.com</code> (465 SSL/TLS).
                  </p>
                  <p>6. Пароль: введите пароль приложения из личного кабинета.</p>
                </div>

                <div className="bg-mg-surface-subtle border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">
                    Apple Mail (iPhone / iPad / Mac)
                  </h4>
                  <p>1. Настройки ➔ Почта ➔ Учетные записи.</p>
                  <p>2. «Добавить учетную запись» ➔ Другое.</p>
                  <p>3. Укажите имя, полный адрес и пароль приложения.</p>
                  <p>
                    4. Сервер входящей/исходящей почты: <code>mail.example.com</code>.
                  </p>
                  <p>5. Нажмите «Готово». Синхронизация начнется автоматически.</p>
                </div>
              </div>
            </Card>
          )}

          {activeSection === 'webmail' && (
            <Card className="space-y-6 p-6">
              <div className="border-mg-border-subtle flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <h2 className="text-mg-text text-xl font-bold">
                    6. Веб-интерфейс почты (Webmail)
                  </h2>
                  <p className="text-mg-text-muted mt-1 text-sm">
                    Быстрый клиент для работы с почтой в браузере без установки программ
                  </p>
                </div>
                <a href="/mail" target="_blank" rel="noopener noreferrer">
                  <Button variant="primary" size="sm">
                    Открыть Webmail
                  </Button>
                </a>
              </div>

              <div className="text-mg-text-muted grid grid-cols-1 gap-4 text-xs md:grid-cols-3">
                <div className="border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">Управление папками</h4>
                  <p className="leading-relaxed">
                    Создание вложенных пользовательских папок, системные корзины, архив и папка
                    Спам. Мгновенная синхронизация с телефоном.
                  </p>
                </div>

                <div className="border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">Редактор сообщений</h4>
                  <p className="leading-relaxed">
                    Rich-Text форматирование, прикрепление файлов drag-and-drop, предпросмотр
                    изображений и автосохранение черновиков каждые 30 секунд.
                  </p>
                </div>

                <div className="border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">Полнотекстовый поиск</h4>
                  <p className="leading-relaxed">
                    Быстрый поиск по заголовкам, тексту письма, контактам и именам вложений в ящиках
                    любого объема.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {activeSection === 'migration' && (
            <Card className="space-y-6 p-6">
              <div className="border-mg-border-subtle flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <h2 className="text-mg-text text-xl font-bold">
                    7. Бесшовная миграция почты без остановки работы
                  </h2>
                  <p className="text-mg-text-muted mt-1 text-sm">
                    Автоматический перенос истории писем и папок из внешних провайдеров
                  </p>
                </div>
                <Link to="/admin/migration">
                  <Button variant="secondary" size="sm">
                    Мастер миграции
                  </Button>
                </Link>
              </div>

              {/* Migration SVG Scheme */}
              <div className="bg-mg-surface-subtle border-mg-border-subtle overflow-x-auto rounded-lg border p-4">
                <div className="text-mg-text mb-3 text-xs font-bold tracking-wider uppercase">
                  Процесс миграции без простоя (Zero Downtime)
                </div>
                <svg viewBox="0 0 720 130" className="h-auto w-full min-w-[650px] font-sans">
                  {/* Step 1 */}
                  <rect
                    x="10"
                    y="20"
                    width="150"
                    height="90"
                    rx="6"
                    fill="#ffffff"
                    stroke="#cbd5e1"
                    strokeWidth="1.5"
                  />
                  <text
                    x="85"
                    y="45"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#0f172a"
                  >
                    1. Подготовка
                  </text>
                  <text x="85" y="65" textAnchor="middle" fontSize="9" fill="#64748b">
                    Импорт списка ящиков
                  </text>
                  <text x="85" y="82" textAnchor="middle" fontSize="9" fill="#64748b">
                    Создание учетных записей
                  </text>

                  <line x1="160" y1="65" x2="195" y2="65" stroke="#94a3b8" strokeWidth="2" />

                  {/* Step 2 */}
                  <rect
                    x="195"
                    y="15"
                    width="165"
                    height="100"
                    rx="6"
                    fill="#ffffff"
                    stroke="#0284c7"
                    strokeWidth="2"
                  />
                  <rect x="195" y="15" width="165" height="20" rx="6" fill="#0284c7" />
                  <text
                    x="277"
                    y="29"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#ffffff"
                  >
                    2. Фоновый перенос
                  </text>
                  <text x="277" y="55" textAnchor="middle" fontSize="9" fill="#64748b">
                    Синхронизация IMAP архива
                  </text>
                  <text x="277" y="72" textAnchor="middle" fontSize="9" fill="#64748b">
                    Письма, папки, флаги
                  </text>
                  <text
                    x="277"
                    y="95"
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="600"
                    fill="#059669"
                  >
                    ● Работа продолжается
                  </text>

                  <line x1="360" y1="65" x2="395" y2="65" stroke="#94a3b8" strokeWidth="2" />

                  {/* Step 3 */}
                  <rect
                    x="395"
                    y="15"
                    width="155"
                    height="100"
                    rx="6"
                    fill="#ffffff"
                    stroke="#0f172a"
                    strokeWidth="2"
                  />
                  <rect x="395" y="15" width="155" height="20" rx="6" fill="#0f172a" />
                  <text
                    x="472"
                    y="29"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#ffffff"
                  >
                    3. Переключение MX
                  </text>
                  <text x="472" y="55" textAnchor="middle" fontSize="9" fill="#64748b">
                    Смена записи MX в DNS
                  </text>
                  <text x="472" y="72" textAnchor="middle" fontSize="9" fill="#64748b">
                    Прием новых писем в MGate
                  </text>
                  <text
                    x="472"
                    y="95"
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="600"
                    fill="#059669"
                  >
                    ✓ 0 секунд простоя
                  </text>

                  <line x1="550" y1="65" x2="585" y2="65" stroke="#94a3b8" strokeWidth="2" />

                  {/* Step 4 */}
                  <rect
                    x="585"
                    y="20"
                    width="125"
                    height="90"
                    rx="6"
                    fill="#ffffff"
                    stroke="#059669"
                    strokeWidth="1.5"
                  />
                  <text
                    x="647"
                    y="45"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#059669"
                  >
                    4. Досинхронизация
                  </text>
                  <text x="647" y="65" textAnchor="middle" fontSize="9" fill="#64748b">
                    Перенос остаточных писем
                  </text>
                  <text x="647" y="82" textAnchor="middle" fontSize="9" fill="#64748b">
                    100% данных перенесено
                  </text>
                </svg>
              </div>

              <div className="text-mg-text-muted space-y-3 text-xs leading-relaxed">
                <p>
                  Мастер миграции подключается к исходному серверу по протоколу{' '}
                  <strong>IMAP</strong>: для <strong>Яндекс 360</strong>,{' '}
                  <strong>Google Workspace</strong> и <strong>Mail.ru</strong> есть готовые шаблоны,
                  остальные серверы (в том числе Microsoft Exchange с включённым IMAP) указываются
                  вручную. Список ящиков можно вставить из CSV или буфера обмена. Для провайдеров с
                  двухфакторной защитой используйте пароль приложения.
                </p>
                <p>
                  Перенос выполняется в фоне средствами Dovecot (<code>doveadm backup</code> по
                  IMAP); пока идёт синхронизация, пользователи продолжают работать на старом
                  сервере, а перед переключением MX синхронизацию можно повторить. Статус каждого
                  ящика виден в мастере миграции; скорость зависит от исходного сервера и канала.
                </p>
              </div>
            </Card>
          )}

          {activeSection === 'queue-logs' && (
            <Card className="space-y-6 p-6">
              <div className="border-mg-border-subtle flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <h2 className="text-mg-text text-xl font-bold">
                    8. Очереди сообщений, логи и мониторинг
                  </h2>
                  <p className="text-mg-text-muted mt-1 text-sm">
                    Оперативный контроль доставки писем, решение проблем и аудит событий
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link to="/admin/queue">
                    <Button variant="secondary" size="sm">
                      Очередь
                    </Button>
                  </Link>
                  <Link to="/admin/logs">
                    <Button variant="secondary" size="sm">
                      Логи
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="text-mg-text-muted space-y-4 text-xs leading-relaxed">
                <div className="border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">Операции с очередью Postfix</h4>
                  <ul className="list-disc space-y-1 pl-4">
                    <li>
                      <strong>Flush (Принудительная отправка):</strong> Немедленная повторная
                      попытка отправки всех отложенных писем из очереди.
                    </li>
                    <li>
                      <strong>Hold (Удержание):</strong> Заморозка отправки подозрительного
                      сообщения для проверки администратором.
                    </li>
                    <li>
                      <strong>Release (Снятие удержания):</strong> Возврат сообщения в очередь
                      отправки.
                    </li>
                    <li>
                      <strong>Delete (Удаление):</strong> Удаление сообщения из очереди без отправки
                      получателю.
                    </li>
                  </ul>
                </div>

                <div className="border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">
                    Живой журнал событий (Live Logs)
                  </h4>
                  <p>
                    В разделе «Журнал событий» администратор может в реальном времени отследить
                    статус прохождения любого письма по его Message-ID, адресу отправителя или коду
                    ошибки SMTP (например, 550 User Unknown или 451 Greylisted).
                  </p>
                </div>
              </div>
            </Card>
          )}

          {activeSection === 'ssl-backup' && (
            <Card className="space-y-6 p-6">
              <div className="border-mg-border-subtle flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <h2 className="text-mg-text text-xl font-bold">
                    9. SSL-сертификаты и резервное копирование
                  </h2>
                  <p className="text-mg-text-muted mt-1 text-sm">
                    Защита почтовых каналов шифрованием и надежная сохранность данных компании
                  </p>
                </div>
                <Link to="/admin/certificates">
                  <Button variant="secondary" size="sm">
                    Сертификаты
                  </Button>
                </Link>
              </div>

              <div className="text-mg-text-muted grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
                <div className="border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">Управление SSL/TLS</h4>
                  <p className="leading-relaxed">
                    По умолчанию сервер использует самоподписанный сертификат — почтовые клиенты и
                    браузеры будут предупреждать о недоверенном сертификате. Для рабочей
                    эксплуатации загрузите собственный сертификат (цепочка PEM и приватный ключ, в
                    том числе wildcard) на странице «Сертификаты». Автоматический выпуск и продление
                    сертификатов Let's Encrypt — в разработке.
                  </p>
                </div>

                <div className="border-mg-border-subtle space-y-2 rounded-lg border p-4">
                  <h4 className="text-mg-text text-sm font-bold">Резервное копирование (Backup)</h4>
                  <p className="leading-relaxed">
                    Ежедневные дедуплицированные снимки хранилища почты и базы PostgreSQL.
                    Возможность восстановления всей базы или отдельного почтового ящика сотрудника
                    без остановки сервиса. Поддержка выгрузки в S3-хранилища.
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
