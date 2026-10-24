# Документация MGate — индекс

Вся документация в этом каталоге — на русском языке (код и комментарии в
коде — на английском). Начните с [`../README.md`](../README.md): там описаны
установка, образы, версии и обновление.

**Важно.** Этот репозиторий — deploy kit + почтовый стек + **исходный код SPA**. Он не
содержит исходного кода backend-сервиса: backend распространяется только как готовый образ
`ghcr.io/mgate-server/mgate` (и агент `ghcr.io/mgate-server/mgate-agent`).
[`ARCHITECTURE.md`](ARCHITECTURE.md) документирует backend как «чёрный ящик»: порты,
эндпоинты, переменные окружения, какие данные он хранит и отправляет — этого достаточно для
эксплуатации и интеграции платформы.

## Общее

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — архитектура платформы, диаграммы
  компонентов и потоков данных; backend описан как чёрный ящик.
- [`ROADMAP.md`](ROADMAP.md) — публичная дорожная карта.
- [`../CHANGELOG.md`](../CHANGELOG.md) — история изменений.

## Установка и эксплуатация

- [`UPDATES.md`](UPDATES.md) — обновление Docker Compose через CLI и административную панель,
  хостовая служба, обязательная копия базы и настроек, первый переход и восстановление.

- [`DEPLOYMENT.md`](DEPLOYMENT.md) — установка через docker-compose в
  продакшене: firewall, DNS/PTR, первый вход, версии (CalVer `YYYY.M.N`),
  обновления, пиннинг и откат, обзор Helm, all-in-one образ (запланирован),
  внешние PostgreSQL/Valkey, варианты хранилища, TLS (HTTP-01/DNS-01, ZeroSSL EAB).
- [`CONFIGURATION.md`](CONFIGURATION.md) — таблица всех переменных
  окружения (`.env`), включая те, что читает закрытый образ backend; раздел
  «Реестр образов, сервер лицензий и другие адреса» — точный список мест (`.env`, Helm
  `values.yaml`), где задаются реестр (по умолчанию `ghcr.io/mgate-server`), версия, адрес
  сервера лицензий и ссылки в интерфейсе.
- [`DNS.md`](DNS.md) — DNS-записи, которые генерирует мастер доменов (MX,
  SPF, DKIM, DMARC, MTA-STS/TLS-RPT, autoconfig/autodiscover, PTR) с примерами
  для `example.com`; BIMI и DANE TLSA описаны как ручные необязательные шаги.
- [`BACKUP.md`](BACKUP.md) — что бэкапится, restic (локально/S3),
  расписание, ретеншн, восстановление, DR-учения.
- [`OPERATIONS.md`](OPERATIONS.md) — управление очередью писем, логи,
  статистика, продление сертификатов, ротация DKIM, обновления,
  масштабирование, мониторинг `/metrics`, типовые инциденты.
- [`HA.md`](HA.md) — отказоустойчивость и кластеризация: сценарии отказов
  и параметры общего хранилища.
- [`../deploy/helm/mgate/README.md`](../deploy/helm/mgate/README.md) — Helm-чарт для Kubernetes.

## Разработка

- [`UI-DEVELOPMENT.md`](UI-DEVELOPMENT.md) — локальная разработка SPA: предпосылки,
  `make dev-web`, runtime-конфигурация (`/config.json`), синхронизация с OpenAPI-схемой
  backend (`make openapi-sync`), Pro-гейтинг, сборка образа `web`, тесты/линт.
- [`TESTING.md`](TESTING.md) — unit/integration/e2e-тесты, методология
  нагрузочного теста (50 сообщений/с), чек-лист доставляемости 10/10,
  тесты безопасности.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — как предложить изменение.

## Безопасность и лицензирование

- [`SECURITY.md`](SECURITY.md) — модель угроз почтовой платформы (не
  путать с политикой раскрытия уязвимостей — она в корне репозитория,
  [`../SECURITY.md`](../SECURITY.md)).
- [`LICENSING.md`](LICENSING.md) — редакции, активация лицензии, какие
  данные передаются серверу лицензий (и какие — никогда), поведение офлайн.
- [`../EULA.md`](../EULA.md) — лицензионное соглашение на распространяемые образы
  (черновик, требует юриста — см. пометки в самом файле); [`../LICENSE`](../LICENSE) и
  [`../NOTICE`](../NOTICE) — права на репозиторий и сторонние компоненты.
- [`adr/`](adr/) — architecture decision records, включая ADR-0014 (лицензия этого
  репозитория и EULA на образы) и ADR-0018 (SPA публична, ограничения исполняются
  только на сервере).

## API и почтовые демоны

REST API backend описан его собственным OpenAPI-документом
(`web/packages/api-client/openapi.json`, обновляется `make openapi-sync` — см.
[`UI-DEVELOPMENT.md`](UI-DEVELOPMENT.md)).

- [`mail/postfix.md`](mail/postfix.md), [`mail/dovecot.md`](mail/dovecot.md),
  [`mail/rspamd.md`](mail/rspamd.md),
  [`mail/antivirus-dns.md`](mail/antivirus-dns.md) — конфигурация и интеграция
  почтовых демонов, антивируса и DNS-резолвера (открыты полностью — этот код целиком
  в данном репозитории).
