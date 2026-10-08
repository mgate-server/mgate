# Конфигурация (переменные окружения)

Все переменные задаются в файле `.env` (создаётся из `.env.example` командой
`make init`, секреты генерирует `scripts/gen-secrets.sh`). Эта таблица —
справочник по всем переменным с описанием, кто использует переменную;
`.env.example` содержит тот же набор со встроенными комментариями. Значения `<generated>` — заполняются
`scripts/gen-secrets.sh` при `make init`, никогда не коммитятся с реальным
значением (в `.env.example` эти поля пустые).

Кроме переменных окружения `mgate` также читает опциональный TOML-файл
`/etc/mgate/mgate.toml`; переменные окружения имеют приоритет. Для секретов
поддерживаются варианты `<ИМЯ>_FILE` (путь к файлу с значением) — так же,
как это принято у официальных образов Postgres/Docker-secrets, чтобы не
передавать секрет напрямую через переменную окружения там, где это важно
(например, в Kubernetes/Helm с `secretKeyRef`+`envFrom`, или в Docker
Swarm secrets).

## Общие

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `MGATE_HOSTNAME` | — (обязательна) | FQDN сервера: цель MX, HELO/EHLO, хост админки/webmail/автонастройки | api, webmail, postfix, dovecot, traefik |
| `MGATE_ADMIN_EMAIL` | — (обязательна) | Email первого суперадминистратора; на него пересылаются `postmaster@`/`abuse@` `MGATE_HOSTNAME`. Зарезервирован как контакт ACME-аккаунта для автоматического выпуска сертификатов (в разработке, см. [ACME / TLS](#acme--tls)) | migrate (bootstrap), api, postfix, dovecot |
| `MGATE_ADMIN_PASSWORD` | *(пусто)* | Пароль первого суперадминистратора; если пусто — пароль генерируется при первом запуске и **один раз** печатается в лог сервиса `migrate` (`docker compose logs migrate \| grep -A2 'initial superadmin'`). Сброс забытого пароля: `docker compose exec api mgate admin reset-password <email>` | migrate |
| `TZ` | `UTC` | Часовой пояс контейнеров (логи, cron бэкапов) | все |
| `MGATE_REGISTRY` | `ghcr.io/mgate-server` | Реестр образов (`<registry>/<service>:<version>`); публичный, скачивание без авторизации. Менять нужно только для собственного зеркала | compose |
| `MGATE_VERSION` | `latest` в compose-файле; в `.env.example` релиза — версия этого релиза | Тег **всех** образов в формате CalVer `YYYY.M.N` (например, `2026.10.1`, **без** префикса `v`; git-тег при этом `v2026.10.1`). Одна версия на весь продукт. **Зафиксируйте конкретную версию в продакшене** (см. [`DEPLOYMENT.md`](DEPLOYMENT.md#5-обновления-и-пиннинг-версий)). Доступны также плавающий тег месяца (`2026.10`) и `latest` | compose |
| `MGATE_IMAGE` | `${MGATE_REGISTRY}/mgate` | Переопределяет полный образ бэкенда (без тега — тег всегда `:${MGATE_VERSION}`); нужен только для нестандартных сборок (например, собственное зеркало или локально собранный образ) | compose |
| `MGATE_AGENT_IMAGE` | `${MGATE_REGISTRY}/mgate-agent:${MGATE_VERSION}` | Переопределяет полный образ (с тегом) агента, из которого `postfix`/`dovecot`/`firewall` копируют бинарник `mgate-agent` при сборке (`docker-compose.build.yml`, `COPY --from=`) | build |
| `MGATE_BIND_ADDRESS` | `0.0.0.0` | Адрес прослушивания HTTP(S)/почтовых портов внутри контейнеров | api, webmail, postfix, dovecot, traefik |
| `MGATE_HTTP_PORT` | `80` | Внешний порт HTTP (редирект на HTTPS; в будущем — ACME HTTP-01) | traefik |
| `MGATE_HTTPS_PORT` | `443` | Внешний порт HTTPS (админка, webmail, API) | traefik |
| `MGATE_SMTP_PORT` | `25` | Публикуемый на хосте порт SMTP (внутри контейнера всегда 25) | postfix |
| `MGATE_SUBMISSIONS_PORT` | `465` | Публикуемый порт SMTPS (wrapper-TLS, внутри контейнера 465) | postfix |
| `MGATE_SUBMISSION_PORT` | `587` | Публикуемый порт Submission (STARTTLS, внутри контейнера 587) | postfix |
| `MGATE_IMAP_PORT` | `143` | Публикуемый порт IMAP | dovecot |
| `MGATE_IMAPS_PORT` | `993` | Публикуемый порт IMAPS | dovecot |
| `MGATE_POP3_PORT` | `110` | Публикуемый порт POP3 | dovecot |
| `MGATE_POP3S_PORT` | `995` | Публикуемый порт POP3S | dovecot |
| `MGATE_MANAGESIEVE_PORT` | `4190` | Публикуемый порт ManageSieve | dovecot |
| `MGATE_TRAEFIK_FILE_WATCH` | `true` | `false` отключает inotify-watch провайдера файлов Traefik (нужно на хостах с исчерпанным `fs.inotify.max_user_instances` — статическая копия конфигурации читается один раз при старте, после записи `10-certs.yml` нужен перезапуск контейнера) | traefik |
| `MGATE_TRAEFIK_CERT_WAIT` | `20` | Сколько секунд entrypoint Traefik ждёт появления bootstrap-сертификата почтовых контейнеров (`/certs/default`) перед тем как опубликовать `05-bootstrap-certs.yml` без него | traefik |

## База данных и кэш

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `POSTGRES_DB` | `mgate` | Имя базы данных PostgreSQL | postgres, api, worker, webmail |
| `POSTGRES_USER` | `mgate` | Роль-владелец БД (полный доступ) | postgres, api, worker, webmail |
| `POSTGRES_PASSWORD` | `<generated>` | Пароль роли `mgate` | postgres, api, worker, webmail |
| `POSTGRES_MAIL_USER` | `mgate_mail` | Роль только для чтения (`SELECT` на `v_postfix_*`/`v_dovecot_*`), используется Postfix/Dovecot lookup-картами | postgres, postfix, dovecot |
| `POSTGRES_MAIL_PASSWORD` | `<generated>` | Пароль роли `mgate_mail` | postgres, postfix, dovecot |
| `VALKEY_PASSWORD` | `<generated>` | Пароль Valkey (`requirepass`) | valkey, api, worker, webmail, rspamd |
| `MGATE_DATABASE_URL` | задаётся в compose из `POSTGRES_*` (`postgres://mgate:${POSTGRES_PASSWORD}@postgres:5432/mgate`) | Полная строка подключения к PostgreSQL; переопределяется для внешней БД (`docs/DEPLOYMENT.md` §8) | api, worker, webmail, migrate |
| `MGATE_REDIS_URL` | задаётся в compose из `VALKEY_PASSWORD` (`redis://:${VALKEY_PASSWORD}@valkey:6379/0`) | Строка подключения к Valkey, db 0 (`mgate:` префикс ключей; db 1 — Rspamd) | api, worker, webmail |

## Секреты и внутренняя аутентификация

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `MGATE_SECRET_KEY` | `<generated base64, 32 bytes>` | Ключ шифрования данных at-rest (секреты инстанса, DKIM-ключи, TOTP-секреты); веб-почта использует его для краткоживущих учётных данных сессий (см. [Веб-почта](#веб-почта-сервис-webmail)). Не меняйте ключ на работающей инсталляции: данные, зашифрованные прежним ключом, станут нечитаемыми | api, worker, webmail |
| `MGATE_INTERNAL_TOKEN` | `<generated>` | Bearer-токен для всех вызовов `/internal/v1/*` и control API `mgate-agent` — **никогда не выставляется наружу** | api, worker, postfix (mgate-agent), dovecot (mgate-agent) |
| `DOVEADM_API_KEY` | `<generated>` | Ключ доступа к Dovecot doveadm HTTP API (порт 8080 внутри контейнера dovecot, backend-only) | dovecot, api, worker |
| `RSPAMD_CONTROLLER_PASSWORD` | `<generated>` | Пароль контроллера Rspamd (порт 11334, backend-only) | rspamd, api, worker |

## ACME / TLS

> **Автоматический выпуск сертификатов (ACME: Let's Encrypt, ZeroSSL) в этой версии не
> реализован — в разработке.** Переменные `MGATE_ACME_*` зарезервированы под эту функцию:
> сейчас они ничего не выпускают и не продлевают, при любых значениях.

Как работает TLS в этой версии:

- По умолчанию HTTPS (Traefik), SMTP (Postfix) и IMAP/POP3/ManageSieve (Dovecot) отдают
  **самоподписанный сертификат** для `MGATE_HOSTNAME`, который почтовые контейнеры создают при
  первом запуске в томе `certs` (`/certs/default`). Браузеры и почтовые клиенты показывают
  предупреждение о недоверенном сертификате. Этот сертификат выпускается на **90 дней** и
  автоматически не перевыпускается; после истечения срока клиенты, проверяющие сертификат (в том
  числе встроенная веб-почта), перестают устанавливать с ним TLS-соединения.
- Для рабочей эксплуатации загрузите **собственный сертификат** в админке: «Сертификаты» →
  «Загрузить сертификат» — цепочка PEM (сертификат сервера первым, затем промежуточные) и
  незашифрованный закрытый ключ PEM (PKCS#12 не принимается). Сертификат, покрывающий
  `MGATE_HOSTNAME`, становится сертификатом по умолчанию для всех сервисов, обычно в течение
  минуты и без перезапуска контейнеров.
- Продление — тоже вручную: загрузите новый сертификат под тем же именем до истечения срока
  прежнего. Получить сертификат можно любым ACME-клиентом на отдельной машине.

Подробности — [`DEPLOYMENT.md`](DEPLOYMENT.md#4-tls-http-01-vs-dns-01-zerossl-eab).

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `MGATE_ACME_ENABLED` | `true` | Зарезервировано: включение автоматического выпуска/продления (в разработке). В этой версии сертификаты не выпускаются при любом значении | api, worker |
| `MGATE_ACME_DIRECTORY` | `letsencrypt` | Зарезервировано: каталог ACME — `letsencrypt` \| `letsencrypt-staging` \| `zerossl` \| URL директории (в разработке) | api, worker |
| `MGATE_ACME_CHALLENGE` | `http-01` | Зарезервировано: способ подтверждения домена — `http-01` \| `dns-01` (в разработке) | api, worker |
| `MGATE_ACME_DNS_PROVIDER` | *(пусто)* | Зарезервировано: DNS-провайдер для `dns-01` (в разработке) | api, worker |
| `MGATE_ACME_EAB_KID` | *(пусто)* | Зарезервировано: External Account Binding Key ID для ZeroSSL (в разработке) | api, worker |
| `MGATE_ACME_EAB_HMAC` | *(пусто)* | Зарезервировано: External Account Binding HMAC key для ZeroSSL (в разработке) | api, worker |

## Лицензирование

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `MGATE_LICENSE_SERVER` | `https://cloud.mgate.example` (плейсхолдер-домен) | Базовый URL сервера лицензий (что именно передаётся — см. [`LICENSING.md`](LICENSING.md)). Нужен только для активации Pro: Community работает без него. Адрес для активации вендор сообщает вместе с подпиской; пока указан плейсхолдер, попытки активации завершаются сетевой ошибкой | api, worker |

## Почта и лимиты

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `MGATE_MESSAGE_SIZE_LIMIT` | `52428800` (50 MiB) | Максимальный размер сообщения в байтах (Postfix `message_size_limit`, проверка при отправке через webmail). Вложения кодируются base64 (+⅓ к размеру), поэтому один файл, прикреплённый в веб-почте, может занимать не больше ¾ от (лимит − 64 KiB) — ≈ 37,5 MiB при значении по умолчанию | postfix, webmail |
| `MGATE_SPAMHAUS_DQS_KEY` | *(пусто)* | Ключ Spamhaus Data Query Service ([DQS](https://www.spamhaus.com/dqs/)); только буквы и цифры. Если задан, Postfix postscreen запрашивает DNSBL-зону Spamhaus через выделенный ключ, а в ответах `550 reject` ключ скрывается. Пусто — используются бесплатные публичные зоны Spamhaus | postfix |

## Веб-почта (сервис `webmail`)

Веб-почта — отдельный процесс того же образа `mgate` (`serve --components webmail`, порт 8082,
маршрут `/api/v1/mail/*` через Traefik). Он работает только с сессиями владельцев почтовых
ящиков и обращается к почте тем же путём, что и обычные почтовые клиенты: к Dovecot по IMAP и к
Postfix по SMTP submission, всегда через STARTTLS. Пароль пользователя шлюз не хранит и общего
«мастер»-доступа ко всем ящикам не имеет: для каждой веб-сессии он использует **краткоживущие
учётные данные, привязанные к этой сессии и проверяемые бэкендом** при каждом входе в IMAP/SMTP.
Поэтому блокировка ящика или домена, приостановка отправки и выход из сессии действуют и на
веб-почту. Dovecot кэширует результат проверки до 5 минут, но сам шлюз проверяет сессию при
каждом запросе браузера.

Сеть и порты:

- **IMAP** — внутренний IMAP-порт Dovecot **1143** (STARTTLS, тот же TLS, что у 143; не
  публикуется на хост, в Kubernetes открыт только подам `webmail`). Учётные данные шлюза
  принимаются только на этом порту и для внутренней отправки, а обычные пароли и app-пароли на
  нём не принимаются; на публичных портах (143, 993 и др.) учётные данные шлюза, наоборот,
  не работают. В compose шлюз подключается к имени `dovecot-backend` (псевдоним
  Dovecot только в сети `backend`): так адрес шлюза попадает в `MGATE_BACKEND_SUBNET`
  (`login_trusted_networks` Dovecot), и в журналах входа и в auth policy виден реальный IP
  пользователя, а не адрес контейнера.
- **SMTP** — внутренний порт отправки Postfix **2587** (не публикуется на хост, принимает
  соединения только из сети бэкенда): те же TLS, SASL,
  ограничения отправителя, policy-сервис и Rspamd (DKIM-подпись), что и у 587, но без лимитов
  anvil на IP клиента — все пользователи веб-почты подключаются с одного адреса шлюза. Лимиты на
  ящик/домен действуют как обычно. См. [`mail/postfix.md`](mail/postfix.md) §3.
- **TLS** проверяется: по умолчанию шлюз доверяет только сертификату из
  `/certs/default/fullchain.pem` (самоподписанному по умолчанию или загруженному в админке) и
  сверяет имя `MGATE_HOSTNAME`. Режима без проверки нет.

Все переменные ниже необязательны — значения по умолчанию подходят для compose и Helm. Пустое
значение равносильно значению по умолчанию. В Helm задавайте их через `webmail.extraEnv`
(адреса и спул — через `webmail.upstream` и `webmail.spool`), в compose — для сервиса `webmail`
в `docker-compose.override.yml`:

```yaml
# docker-compose.override.yml
services:
  webmail:
    environment:
      MGATE_WEBMAIL_MAX_CONNECTIONS: "800"
```

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `MGATE_IMAP_ADDR` | `dovecot-backend:1143` | Внутренний IMAP-порт (`host:port`), к которому подключается шлюз; всегда STARTTLS. Не указывайте публичный порт 143: учётные данные шлюза на нём не принимаются | webmail |
| `MGATE_SUBMISSION_ADDR` | `postfix:2587` | Submission-сервер (`host:port`) для отправки из веб-почты; всегда STARTTLS + SMTP AUTH. Внутренний порт 2587 — только для шлюза | webmail |
| `MGATE_WEBMAIL_UPSTREAM_TLS` | `pinned` | Проверка сертификата IMAP/SMTP-сервера: `pinned` — доверять только сертификатам из `/certs/default/fullchain.pem` (работает и с самоподписанным сертификатом по умолчанию); `webpki` — проверка по публичным корневым CA (если почтовые серверы вынесены за пределы стека и имеют публичный сертификат) | webmail |
| `MGATE_WEBMAIL_TLS_SERVER_NAME` | значение `MGATE_HOSTNAME` | Имя сервера для SNI и проверки сертификата IMAP/SMTP | webmail |
| `MGATE_WEBMAIL_SPOOL_DIR` | `/var/lib/mgate/webmail-spool` (том `mgate-data`; в Helm — отдельный `emptyDir`) | Каталог временного хранения загруженных вложений до отправки письма | webmail |
| `MGATE_WEBMAIL_SPOOL_MAX` | `2147483648` (2 GiB; в Helm — `webmail.spool.maxBytes`, 1,5 GiB) | Общий объём загруженных, но ещё не отправленных вложений; сверх него новые загрузки отклоняются | webmail |
| `MGATE_WEBMAIL_UPLOAD_QUOTA` | 2 × `MGATE_MESSAGE_SIZE_LIMIT` | Такой же лимит на один почтовый ящик (кроме того, не больше 30 файлов на ящик) | webmail |
| `MGATE_WEBMAIL_UPLOAD_TTL` | `86400` | Через сколько секунд неотправленные загруженные вложения удаляются | webmail |
| `MGATE_WEBMAIL_MAX_CONNECTIONS` | `400` | Максимум одновременных IMAP-соединений шлюза (включая соединения для push-уведомлений о новой почте); не больше `100000` | webmail |
| `MGATE_WEBMAIL_MAX_CONNECTIONS_PER_USER` | `3` | IMAP-соединений на один ящик для обработки запросов (плюс одно для push); не больше `19` (Dovecot допускает 20 соединений на пользователя и IP) и меньше `MGATE_WEBMAIL_MAX_CONNECTIONS` | webmail |
| `MGATE_WEBMAIL_IDLE_TIMEOUT` | `300` | Через сколько секунд простоя IMAP-соединение шлюза закрывается | webmail |
| `MGATE_WEBMAIL_RENDER_BUDGET` | `268435456` (256 MiB) | Сколько байт писем шлюз может одновременно разбирать для показа; при исчерпании запрос получает `503` и повторяется позже | webmail |
| `MGATE_WEBMAIL_MAX_RENDER_BYTES` | min(2 × `MGATE_MESSAGE_SIZE_LIMIT`, 128 MiB) | Письма крупнее этого размера показываются только с заголовками, без тела; не больше `MGATE_WEBMAIL_RENDER_BUDGET` | webmail |
| `MGATE_WEBMAIL_TRUSTED_PROXIES` | `10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, fc00::/7, ::1/128` | Подсети доверенных прокси (CIDR через запятую) между пользователями и MGate: Traefik в compose, ingress-контроллер в Kubernetes, а также CDN или L7-балансировщик перед ними. IP пользователя (журналы, защита веб-входа и смены пароля от подбора паролей) берётся из `X-Forwarded-For`, только если TCP-пир входит в список: заголовок читается справа налево, адреса из списка пропускаются, первый адрес вне списка и есть клиент. Поэтому в списке должен быть **каждый** прокси цепочки (подробнее — [`DEPLOYMENT.md`](DEPLOYMENT.md) §9). Адрес, который сам попадает в список (например, общий адрес балансировщика, подменяющего адреса источников), считается общим для многих пользователей: его блокируют только 100 неверных паролей за 10 минут (вместо 10), одновременно с него проверяется не больше 16 паролей, а «знакомым» для логина он не бывает. Защита при этом действует, но сотня неверных паролей от кого угодно за таким адресом закроет веб-вход всем за ним; если пользователи подключаются из частной сети напрямую, сузьте список до подсетей прокси | api, webmail |
| `MGATE_WEBMAIL_WS_ALLOWED_ORIGINS` | *(пусто — только `https://${MGATE_HOSTNAME}`)* | Дополнительные `Origin` (через запятую, `scheme://host[:port]`), с которых разрешено WebSocket-подключение `/api/v1/mail/ws`; нужно только для разработки | webmail |
| `MGATE_WEBMAIL_AUTHSERV_ID` | значение `MGATE_HOSTNAME` | authserv-id заголовка `Authentication-Results`, которому веб-почта доверяет при показе результатов SPF/DKIM/DMARC; такие же заголовки с другим идентификатором (например, подделанные отправителем) игнорируются | webmail |

Kubernetes (Helm): загруженные вложения хранятся локально в реплике (`emptyDir`), поэтому
`webmail.replicaCount` больше 1 требует привязки сессии браузера к реплике на ingress
(cookie affinity). Чтобы Dovecot видел реальный IP пользователей веб-почты, `config.backendSubnet`
должен включать IP подов `webmail`; иначе вход работает, но в журналах виден IP пода. Порт 2587
Postfix NetworkPolicy открывает только для подов `webmail`.

## Логирование

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `MGATE_LOG_LEVEL` | `info` | Уровень логирования (`trace`\|`debug`\|`info`\|`warn`\|`error`) | api, worker, webmail, mgate-agent |
| `MGATE_LOG_FORMAT` | `json` | Формат вывода логов: `json` (продакшен, парсится log-агрегатором) \| `pretty` (для разработки) | api, worker, webmail |

## Профили и сеть

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `COMPOSE_PROFILES` | `clamav` | Активные необязательные профили compose: `clamav`, `backup`, `firewall` (через запятую) | docker compose |
| `MGATE_BACKEND_SUBNET` | `172.30.1.0/24` | Подсеть внутренней сети `backend` (`internal: true`) | docker compose |
| `MGATE_RESOLVER_IP` | `172.30.1.53` | Статический IP контейнера `unbound` в сети `backend`; все контейнеры, резолвящие внешние имена, используют его как DNS | docker compose, unbound, все сервисы |
| `MGATE_VALKEY_IP` | `172.30.1.10` | Статический IP контейнера `valkey` в сети `backend`; нужен только сервису `firewall` (`network_mode: host`, без compose DNS), чтобы обращаться к pubsub-каналу `mgate:bans:events` по IP — остальные сервисы используют имя `valkey` через `MGATE_REDIS_URL` | docker compose, firewall |

### Расширение конфигурации Unbound (`/etc/unbound/conf.d`)

Образ `unbound` не содержит ничего специфичного для конкретной инсталляции: ни `forward-zone`,
ни адресов внутренних резолверов. Чтобы, например, отправлять запросы для приватной зоны
(`corp.example`) на ваш внутренний DNS, положите свои файлы `*.conf` в каталог на хосте и
смонтируйте его в контейнер **только для чтения**:

```yaml
# docker-compose.override.yml
services:
  unbound:
    volumes:
      - ./unbound.d:/etc/unbound/conf.d:ro
```

Подключаются все файлы `*.conf` (в алфавитном порядке); пустой каталог — штатная ситуация.
Файлы должны быть читаемы пользователем `unbound`; изменения применяются после
`docker compose restart unbound`. Пример файла с `forward-zone` и подробности — в
[`docker/unbound/README.md`](../docker/unbound/README.md).

## Web / SPA (сервис `web`)

Читаются `docker/web/entrypoint.sh` при старте контейнера и рендерятся в `/config.json`,
который SPA запрашивает перед первым рендером ([`UI-DEVELOPMENT.md`](UI-DEVELOPMENT.md)) — один и тот же
образ `web` работает под любым доменом без пересборки. Название и логотип продукта (white-label) настраиваются не здесь, а в админке — это Pro-модуль (см. [`LICENSING.md`](LICENSING.md) §2.2).

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `MGATE_API_BASE_URL` | *(пусто → относительные пути)* | Базовый URL, который SPA использует для вызовов `/api/v1/*` | web |
| `MGATE_PRICING_URL` | *(пусто)* | Необязательно. URL страницы с тарифами; если задан, SPA показывает ссылку на страницу тарифов (в `/config.json` — `links.pricingUrl`). Пусто — ссылка скрыта | web |
| `MGATE_VENDOR_PORTAL_URL` | *(пусто)* | Необязательно. URL портала вендора (личный кабинет подписки); если задан, SPA показывает ссылку на портал вендора (в `/config.json` — `links.vendorPortalUrl`). Пусто — ссылка скрыта | web |

Если обе переменные пусты, секция `links` в `/config.json` отсутствует, а в интерфейсе нет ни
одной ссылки на внешние сайты вендора.

## Прокси для исходящих соединений

Нужны, если сервер выходит в интернет только через HTTP(S)-прокси (в первую очередь для связи с
сервером лицензий при активации и продлении Pro, см. [`LICENSING.md`](LICENSING.md) §5.4).
Задайте переменные в `.env` — `docker-compose.yml` передаёт их сервисам `api` и `worker`;
`make init` при повторном запуске сохраняет их.

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `HTTPS_PROXY` | *(пусто)* | Прокси для исходящих HTTPS-соединений, например `http://proxy.corp:3128` | api, worker |
| `HTTP_PROXY` | *(пусто)* | Прокси для исходящих HTTP-соединений | api, worker |
| `NO_PROXY` | *(пусто)* | Список хостов и подсетей через запятую, к которым обращаться напрямую, минуя прокси. Обязательно включите внутренние сервисы стека, иначе их вызовы уйдут в прокси: `localhost,127.0.0.1,api,worker,postfix,dovecot,rspamd,unbound,valkey,postgres` | api, worker |

## Резервное копирование

| Переменная | По умолчанию | Описание | Сервис(ы) |
|---|---|---|---|
| `MGATE_BACKUP_DIR` | `./backups` | Путь на хосте, монтируемый в `/backups` внутри контейнера `backup` | backup |
| `BACKUP_SCHEDULE` | `0 3 * * *` | Cron-расписание запуска бэкапа (см. `docker/backup/crontab`) | backup |
| `RESTIC_REPOSITORY` | `/backups/restic` | Репозиторий restic: локальный путь или `s3:https://...` | backup |
| `RESTIC_PASSWORD` | `<generated>` | Пароль шифрования репозитория restic — **сохраните отдельно от `.env`**, без него восстановление невозможно | backup |
| `AWS_ACCESS_KEY_ID` | *(пусто)* | Ключ доступа S3 (если `RESTIC_REPOSITORY` указывает на S3) | backup |
| `AWS_SECRET_ACCESS_KEY` | *(пусто)* | Секретный ключ S3 | backup |
| `AWS_DEFAULT_REGION` | *(пусто)* | Регион S3 | backup |
| `BACKUP_KEEP_DAILY` | `7` | Сколько ежедневных снапшотов хранить (`restic forget --keep-daily`) | backup |
| `BACKUP_KEEP_WEEKLY` | `4` | Сколько еженедельных снапшотов хранить | backup |
| `BACKUP_KEEP_MONTHLY` | `6` | Сколько ежемесячных снапшотов хранить | backup |

Подробности процедуры бэкапа/восстановления — `docs/BACKUP.md`.

## Только для разработки (`docker-compose.dev.yml`)

Не используются в production-развёртывании (`docker-compose.yml` без dev-оверлея).

| Переменная | По умолчанию | Описание |
|---|---|---|
| `MGATE_RELAYHOST` | *(зафиксировано dev-оверлеем как `[mailpit]:1025`)* | Postfix `relayhost` в dev-режиме: вся исходящая почта перенаправляется в Mailpit вместо реального интернета |
| `MGATE_DEV_MAILPIT_PORT` | `8025` | Порт веб-интерфейса Mailpit на `127.0.0.1` |
| `MGATE_DEV_POSTGRES_PORT` | `5432` | Порт PostgreSQL на `127.0.0.1` (для локального psql/DBeaver) |
| `MGATE_DEV_VALKEY_PORT` | `6379` | Порт Valkey на `127.0.0.1` |
| `MGATE_DEV_RSPAMD_PORT` | `11334` | Порт контроллера Rspamd на `127.0.0.1` |

## Примечания

- Значения, помеченные `<generated>`, заполняются `scripts/gen-secrets.sh`
  при `make init` и должны быть уникальны для каждой инсталляции — никогда
  не копируйте `.env` между инсталляциями без пересоздания секретов.
- `.env.example` в репозитории документирует каждую переменную встроенным
  комментарием — эта таблица дублирует то же содержание в более
  структурированном виде для документации; при добавлении новой переменной
  обновите оба места в одном PR.
- Переменные, специфичные для отдельных Docker-образов внутренней сборки
  (например, аргументы `ARG` в `docker/*/Dockerfile`), не являются частью
  рантайм-конфигурации `.env` и здесь не описываются — см. комментарии в
  соответствующем `Dockerfile`.

## Реестр образов, сервер лицензий и другие адреса, задаваемые конфигурацией

Ни один хост и ни имя реестра не зашиты в код образов, шаблоны Helm или compose-файлы — везде
используются переменные окружения или значения чарта. Значения по умолчанию:

- реестр образов — `ghcr.io/mgate-server` (публичный, `linux/amd64`);
- сервер лицензий — плейсхолдер из `.env.example` (`MGATE_LICENSE_SERVER`). Community работает
  без него; адрес для активации Pro вендор сообщает вместе с подпиской — укажите его там же. Пока
  указан плейсхолдер, попытки активации завершаются сетевой ошибкой;
- хост инсталляции и email администратора — всегда ваши собственные значения.

Если вы видите буквальное имя реестра или хоста вендора внутри шаблона/кода (а не в
`.env.example`, `values.yaml` или их комментариях/примерах команд), это дефект — заведите issue.

Где менять:

| Что | Где менять | Значение по умолчанию | Пример своего значения |
|---|---|---|---|
| Реестр образов | `.env` → `MGATE_REGISTRY` | `ghcr.io/mgate-server` | `registry.example-vendor.com/mgate` (собственное зеркало) |
| Образ backend | `.env` → `MGATE_IMAGE` (переопределяет `${MGATE_REGISTRY}/mgate`; тег берётся из `MGATE_VERSION`) | не задан (наследует `MGATE_REGISTRY`) | `registry.example-vendor.com/mgate/mgate` |
| Образ агента | `.env` → `MGATE_AGENT_IMAGE` (переопределяет `${MGATE_REGISTRY}/mgate-agent:${MGATE_VERSION}`) | не задан (наследует `MGATE_REGISTRY`) | `registry.example-vendor.com/mgate/mgate-agent:2026.10.1` |
| Версия образов | `.env` → `MGATE_VERSION` | см. выше | `2026.10.1` |
| Сервер лицензий | `.env` → `MGATE_LICENSE_SERVER` | `https://cloud.mgate.example` (плейсхолдер из `.env.example`) | адрес, выданный вендором вместе с подпиской (без него Community работает, активация Pro завершается сетевой ошибкой) |
| Хост инсталляции | `.env` → `MGATE_HOSTNAME` | не задан, оператор всегда указывает свой | `mail.example.org` |
| Реестр образов (Helm) | `deploy/helm/mgate/values.yaml` → `global.imageRegistry` (или `--set global.imageRegistry=...`) | `ghcr.io/mgate-server` | `registry.example-vendor.com/mgate` |
| Хост/email инсталляции (Helm) | `deploy/helm/mgate/values.yaml` → `config.hostname`, `config.adminEmail` | `mail.example.com`, `admin@example.com` | значения конкретного оператора |
| Сервер лицензий (Helm) | `deploy/helm/mgate/values.yaml` → `config.licenseServer` | `https://cloud.mgate.example` | адрес, выданный вендором |
| Ссылки в интерфейсе | `.env` → `MGATE_PRICING_URL`, `MGATE_VENDOR_PORTAL_URL` | пусто (ссылки скрыты) | URL ваших страниц |
| Домены в примерах команд/README/DNS | `README.md`, `docs/DNS.md`, `docs/DEPLOYMENT.md` (`example.com`, `mail.example.com` и т.п.) | иллюстративные `example.com`-домены | ваш домен — подставляется по инструкции |

Изменение любой строки выше **не требует пересборки образов**. См. также
[`deploy/helm/mgate/README.md`](../deploy/helm/mgate/README.md) (полная таблица `values`).
