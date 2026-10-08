# docker/postgres — инициализация роли `mgate_mail`

Этот каталог не собирает отдельный образ: сервис `postgres` в docker-compose использует
официальный `postgres:18-alpine` и монтирует `docker/postgres/initdb/` в
`/docker-entrypoint-initdb.d/` (см. [документацию образа](https://hub.docker.com/_/postgres),
раздел "Initialization scripts").

## Что делает `initdb/10-create-mail-role.sh`

При **первой** инициализации пустого volume `pg-data` официальный образ Postgres выполняет
скрипты из `/docker-entrypoint-initdb.d/` по алфавиту, от имени `POSTGRES_USER`, в базе
`POSTGRES_DB`. Наш скрипт создаёт роль, которой пользуются Postfix и Dovecot для SQL-запросов к
`v_postfix_*` / `v_dovecot_*` (см. `docs/ARCHITECTURE.md`):

- имя роли — `POSTGRES_MAIL_USER` (по умолчанию `mgate_mail`);
- пароль — `POSTGRES_MAIL_PASSWORD` (обязателен, скрипт завершится с ошибкой, если он пуст);
- роль получает **только** `LOGIN` и `CONNECT` на `POSTGRES_DB` — никаких прав на схемы или
  таблицы. Право `SELECT` на конкретные представления `v_postfix_*`/`v_dovecot_*` выдаётся позже
  миграциями бэкенда (сервис `migrate`), через `DO`-блок с проверкой
  `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mgate_mail')` — благодаря этой проверке
  миграции можно применять независимо от того, когда именно была создана роль.

Скрипт идемпотентен (использует `CREATE ROLE`/`ALTER ROLE` в зависимости от того, существует ли
роль), но официальный образ Postgres в любом случае выполняет `/docker-entrypoint-initdb.d/`
только один раз — при инициализации пустого каталога данных. При смене
`POSTGRES_MAIL_PASSWORD` на уже существующей инсталляции пароль роли нужно обновить вручную
(см. ниже) или пересоздать volume.

## Внешний (self-hosted) кластер PostgreSQL

Если PostgreSQL не поднимается через compose из этого репозитория (например, используется
managed-кластер), `docker-entrypoint-initdb.d` не выполняется. Администратор внешнего кластера
должен вручную создать эквивалентную роль **до** первого запуска сервиса `migrate`:

```sql
CREATE ROLE mgate_mail LOGIN PASSWORD '<POSTGRES_MAIL_PASSWORD>';
GRANT CONNECT ON DATABASE mgate TO mgate_mail;
```

(подставив реальные значения `POSTGRES_MAIL_USER`/`POSTGRES_MAIL_PASSWORD`/`POSTGRES_DB` из
`.env`). Права `SELECT` на представления `mgate` выдаст сам `migrate`
при первом запуске — дополнительных ручных `GRANT` на таблицы/представления не
требуется и делать их не нужно (роль обязана оставаться read-only и ограниченной списком
`v_postfix_*`/`v_dovecot_*`, см. `docs/ARCHITECTURE.md`).

## Почему не Dockerfile

`postgres` в топологии — это неизменённый `postgres:18-alpine`; сборка
собственного образа не нужна и добавила бы лишнюю точку обновления версии Postgres. Если в
будущем понадобятся нестандартные `postgresql.conf`/расширения — они добавляются либо через
volume-конфиг, либо (TODO(S8), обсуждение масштабирования) через отдельный `Dockerfile FROM
postgres:18-alpine` в этом же каталоге.
