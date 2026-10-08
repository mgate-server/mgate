# Postfix (MTA) в MGate

Образ `${MGATE_REGISTRY}/postfix` — почтовый транспорт платформы: приём почты из интернета
(порт 25), отправка писем пользователей (submission 587 и 465, а также внутренний порт 2587 для
веб-почты), доставка в Dovecot по LMTP и
отправка во внешний мир с DANE/opportunistic TLS. Внутри контейнера рядом с Postfix работает
`mgate-agent` (syslog-сервер, API управления очередью, наблюдение за сертификатами).

Исходники: `docker/postfix/` (Dockerfile + `rootfs/`). Имена, порты и переменные —
`docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`. Связанные документы:
[`dovecot.md`](dovecot.md), [`rspamd.md`](rspamd.md), [`antivirus-dns.md`](antivirus-dns.md).

## 1. Версии и состав образа

| Компонент | Версия (проверено при сборке) | Источник |
|-----------|----------------------------------|----------|
| Базовый образ | `debian:trixie-slim` (Debian 13) | Docker Hub |
| Postfix | 3.10.13 (`postconf mail_version`), пакеты `postfix`, `postfix-pgsql` | Debian trixie |
| OpenSSL | 3.5.x | Debian trixie |
| s6-overlay | v3.2.3.2 (noarch + x86_64/aarch64, sha256 закреплены в `ARG`) | GitHub releases |
| mgate-agent | готовый образ `MGATE_AGENT_IMAGE` (`ghcr.io/mgate-server/mgate-agent`) | стадия `mgate-agent` |

Стадии `docker/postfix/Dockerfile` (контекст сборки — корень репозитория):

1. **`mgate-agent`** — именованная стадия `FROM ${MGATE_AGENT_IMAGE}` (по умолчанию
   `ghcr.io/mgate-server/mgate-agent:${MGATE_VERSION}`): агент не собирается в этом репозитории,
   из готового образа копируется только бинарник (общий с образом Dovecot).
2. **`base`** — пакеты, s6-overlay (выбор архива по `TARGETARCH`: `amd64` → `x86_64`,
   `arm64` → `aarch64`), конфигурация и скрипты. Всё, кроме бинарника агента. Используется для
   проверки конфигов без бинарника агента: `docker build -f docker/postfix/Dockerfile --target base .`
3. **`final`** (по умолчанию) — `base` + `COPY --from=mgate-agent /usr/local/bin/mgate-agent`.

## 2. Процессы и порядок запуска (s6-overlay v3)

```
/init (s6-overlay)
 └─ s6-rc bundle "user"  (/etc/s6-overlay/user-bundles.d/user/contents.d)
     ├─ mgate-init   oneshot  → /usr/local/bin/mgate-postfix-init   (рендер конфигурации)
     ├─ mgate-agent  longrun  → mgate-agent --role postfix            (зависит от mgate-init)
     └─ postfix      longrun  → postfix start-fg                      (зависит от mgate-init и mgate-agent)
```

- `mgate-init` выполняется при каждом старте контейнера; при ошибке контейнер останавливается
  (`S6_BEHAVIOUR_IF_STAGE2_FAILS=2`) — лучше явный отказ, чем MTA с неполной конфигурацией.
- `mgate-agent` стартует **до** Postfix, потому что обслуживает syslog-сокет `/dev/log`.
  Скрипт запуска Postfix ждёт появления сокета до 15 секунд (агент поднимает его асинхронно),
  затем запускает master в любом случае (почта важнее логов). TODO(S1): readiness-уведомление
  агента через `notification-fd` s6 вместо ожидания сокета.
- Остановка: s6 шлёт SIGTERM master-процессу, даётся `S6_SERVICES_GRACETIME=20000` мс на
  завершение SMTP-сессий. `stop_grace_period` в compose должен быть больше (сейчас 60s).

### Логирование

По умолчанию Postfix пишет в syslog (`/dev/log`), сокет обслуживает `mgate-agent`: каждая строка
дублируется в stdout контейнера (видна в `docker compose logs postfix`) и добавляется в поток
Valkey `mgate:logs` (поля `src ts host prog pid sev msg`), откуда `worker` строит Live Logs
и статистику.

Для отладки без агента: `MGATE_LOG_STDOUT=1` → `maillog_file = /dev/stdout` (через `postlogd`),
ожидание `/dev/log` пропускается.

## 3. Порты

| Порт | Сервис master.cf | Назначение | Доступность |
|------|------------------|-----------|-------------|
| 25 | `smtp` → postscreen → `smtpd` | приём почты из интернета (STARTTLS opportunistic) | публикуется |
| 587 | `submission` | отправка пользователями, STARTTLS обязателен, SASL | публикуется |
| 465 | `smtps` | отправка пользователями, неявный TLS (wrapper mode), SASL | публикуется |
| 2587 | `2587` (`syslog_name = postfix/submission-webmail`) | отправка из веб-почты (сервис `webmail`): как 587, но SASL-сервис `smtp-webmail`, подключаться могут только сети из `webmail_clients.cidr`, и для них нет лимитов anvil на IP клиента | только внутри стека (не публикуется; в compose — имя `postfix-backend:2587` в сети `backend`; в Helm NetworkPolicy пускает только поды `webmail`) |
| 7070 | mgate-agent | control API (очередь, reload), `Authorization: Bearer ${MGATE_INTERNAL_TOKEN}` | только backend |

Исходящие соединения: `dovecot:24` (LMTP), `dovecot:12345` (SASL), `dovecot:12340`
(quota-status), `api:10040` (policy), `rspamd:11332` (milter), `postgres:5432` (lookup-таблицы),
DNS через unbound, внешние MX (25).

## 4. Переменные окружения

| Переменная | Обязательна | По умолчанию | Использование |
|------------|-------------|--------------|---------------|
| `MGATE_HOSTNAME` | да | — | `myhostname`, баннер, HELO, CN bootstrap-сертификата, `/etc/mailname` |
| `POSTGRES_MAIL_PASSWORD` | да | — | пароль роли `mgate_mail` в `/etc/postfix/pgsql/*.cf` |
| `POSTGRES_MAIL_USER` | нет | `mgate_mail` | роль для SELECT по `v_postfix_*` |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` | нет | `postgres` / `5432` / `mgate` | подключение lookup-таблиц |
| `MGATE_MESSAGE_SIZE_LIMIT` | нет | `52428800` | `message_size_limit` (байты) |
| `MGATE_BACKEND_SUBNET` | нет | `172.30.1.0/24` | добавляется в `mynetworks` (relay без SASL для внутренних сервисов); значение по умолчанию для `MGATE_WEBMAIL_CLIENT_NETS` |
| `MGATE_WEBMAIL_CLIENT_NETS` | нет | `$MGATE_BACKEND_SUBNET` | сети (CIDR через пробел или запятую, IPv6 без скобок), которым разрешено подключаться к порту 2587; loopback добавляется всегда. Отдельно от `mynetworks`: эти сети не получают права релея |
| `MGATE_ADMIN_EMAIL` | нет | — | куда направлять `postmaster@`, `abuse@`, `root@`, `hostmaster@` `$MGATE_HOSTNAME` |
| `MGATE_RELAYHOST` | нет | пусто | `relayhost` (dev: `[mailpit]:1025`); пусто = прямая доставка по MX |
| `MGATE_INTERNAL_TOKEN` | для агента | — | авторизация control API mgate-agent |
| `MGATE_LOG_STDOUT` | нет | `0` | `1` — логи Postfix в stdout без агента (отладка) |
| `MGATE_CERTS_OWNER` | нет | `10001:10001` | владелец `/certs`, `/certs/default` и bootstrap-сертификата (uid процесса `mgate`, который пишет сертификаты) |
| `TZ`, `MGATE_LOG_LEVEL` | нет | `UTC`, `info` | время в логах; уровень логов агента |

Пароль попадает только в файлы `/etc/postfix/pgsql/*.cf` (режим `0640 root:postfix`, каталог
`0750 root:postfix`) и никогда не пишется в лог.

## 5. Карта конфигурации

| Файл | Откуда | Назначение |
|------|--------|-----------|
| `/etc/postfix/main.cf` | образ + `postconf -e` из `mgate-postfix-init` | все параметры; строки с пометкой `rendered` меняются при старте |
| `/etc/postfix/master.cf` | образ | сервисы; `chroot = n` у всех (изоляция — сам контейнер; демонам нужны `/certs`, DNS) |
| `/etc/postfix/pgsql/{virtual_domains,virtual_mailboxes,virtual_aliases,sender_login}.cf` | рендер из `/usr/local/share/mgate/postfix/pgsql/*.cf.in` | lookup-таблицы PostgreSQL с учётными данными |
| `/etc/postfix/system_aliases` | рендер | `texthash`: RFC 2142 адреса `@$MGATE_HOSTNAME` → `MGATE_ADMIN_EMAIL` |
| `/etc/postfix/submission_header_cleanup.regexp` | образ | `header_checks` сервиса `cleanup-submission`: удаление `Received ... with ESMTPSA`, `X-Originating-IP`, `X-Forwarded-For` |
| `/etc/postfix/authres_strip.regexp` | рендер (`MGATE_HOSTNAME`) | `header_checks` обоих cleanup: удаление входящих `Authentication-Results` с authserv-id `MGATE_HOSTNAME` (§6) |
| `/etc/postfix/webmail_clients.cidr` | рендер (`MGATE_WEBMAIL_CLIENT_NETS`) | клиенты порта 2587: `check_client_access` и исключения из лимитов anvil (`$mgate_webmail_clients`) |
| `/etc/postfix/postscreen_access.cidr` | образ | ручные allow/deny для postscreen (TODO(S4): генерировать из админки) |
| `/etc/mailname` | рендер | `MGATE_HOSTNAME` |
| `/certs/default/{fullchain,privkey}.pem` | volume `certs` | сертификат сервера; bootstrap self-signed, если отсутствует |
| `/usr/local/bin/mgate-postfix-init` | образ | рендер конфигурации (cont-init) |
| `/usr/local/bin/mgate-healthcheck` | образ | healthcheck: `postfix status` + баннер `220` на `127.0.0.1:25` |
| `/usr/local/lib/mgate/common.sh` | образ | общие функции init-скриптов (также копируется в образ Dovecot) |
| `/etc/s6-overlay/s6-rc.d/*` | образ | определения сервисов s6 |

### Запросы к представлениям (роль `mgate_mail`)

Все таблицы подключены через `proxy:pgsql:` (пул соединений в `proxymap`):

| Параметр | Файл | Запрос |
|----------|------|--------|
| `virtual_mailbox_domains` | `virtual_domains.cf` | `SELECT domain FROM v_postfix_virtual_domains WHERE domain = '%s'` |
| `virtual_mailbox_maps` | `virtual_mailboxes.cf` | `SELECT maildir FROM v_postfix_virtual_mailboxes WHERE address = '%s'` |
| `virtual_alias_maps` | `virtual_aliases.cf` | `SELECT destination FROM v_postfix_virtual_aliases WHERE source = '%s'` |
| `smtpd_sender_login_maps` | `sender_login.cf` | `SELECT login FROM v_postfix_sender_login WHERE sender = '%s'` |

`virtual_mailbox_maps` используется только для проверки получателя (`reject_unlisted_recipient`);
сама доставка — `virtual_transport = lmtp:inet:dovecot:24`, путь Maildir определяет Dovecot.
Домены со статусом `suspended_license`/`pending_dns` остаются в `v_postfix_virtual_domains`,
чтобы policy-сервис отвечал `450 4.7.1`, а не «relay access denied».

## 6. Путь письма

**Входящее (25):** postscreen (allowlist `mynetworks` + `postscreen_access.cidr`, pregreet-тест,
DNSBL с весами) → `smtpd` → `smtpd_*_restrictions` → `check_policy_service inet:api:10040`
(rate limit, лицензионная приостановка домена, права на рассылки) → `check_policy_service
inet:dovecot:12340` (квота) → `cleanup` (`header_checks`) → milter Rspamd (`inet:rspamd:11332`) →
очередь → LMTP в Dovecot.

**Чужие `Authentication-Results`.** Шлюз веб-почты показывает результат SPF/DKIM/DMARC из самого
верхнего `Authentication-Results`, если его authserv-id равен `MGATE_HOSTNAME` (и письмо прошло
через Rspamd, см. ниже). Ставить такой заголовок может только Rspamd (authserv-id = макрос
`{daemon_name}` = `$myhostname`, явно задан в `milter_macro_daemon_name`; на портах отправки —
`ORIGINATING`). Поэтому `mgate-postfix-init`
рендерит `/etc/postfix/authres_strip.regexp` с правилом `IGNORE` для любого входящего
`Authentication-Results`, в authserv-части которого (до первой `;`) стоит `MGATE_HOSTNAME` — в
любом регистре, после комментария (без `;` внутри него) или в кавычках, с точкой на конце или
без, в свёрнутом (многострочном) заголовке тоже (RFC 8601 §5). Таблица подключена как
`header_checks` обычного `cleanup` (25, bounce, Sieve redirect, `sendmail`) и `cleanup-submission`
(587/465/2587). Заголовки, добавленные milter, `header_checks` не обрабатывает, поэтому заголовок
Rspamd сохраняется. Это первый рубеж, а не единственная защита: регулярное выражение работает по
тексту заголовка и не покрывает все формы записи (например, комментарий с `;` перед authserv-id:
`(a;b) mail.example.com;` правило не совпадает). Если правило не сработало, а Rspamd письмо не
обработал (на 25 при недоступном Rspamd письмо принимается без проверки), шлюз всё равно не
покажет такой заголовок как проверенный: его защищает требование служебного заголовка Rspamd
(см. ниже), а сам шлюз отвергает authserv-id с ведущим комментарием, который Rspamd не пишет.

Заголовки с authserv-id других серверов `header_checks` не трогает, но и до ящика они обычно не
доходят: добавляя свой `Authentication-Results`, Rspamd удаляет все уже имеющиеся (проверено:
из письма, принятого на 25 с несколькими чужими и поддельными заголовками, в ящике остаётся ровно
один `Authentication-Results` — заголовок Rspamd). Чужой заголовок сохраняется, только если Rspamd
письмо не обработал: недоступен или не ответил вовремя (на 25 действует
`milter_default_action = accept`), отказался проверять из-за размера. Шлюз веб-почты такому
заголовку не доверяет: результат SPF/DKIM/DMARC он показывает только из самого верхнего
`Authentication-Results`, чей authserv-id равен `MGATE_HOSTNAME`, и только если в письме есть
служебный заголовок, который Rspamd добавляет при проверке (`X-Rspamd-Queue-Id` или
`X-Rspamd-Server`), то есть письмо действительно прошло через Rspamd. Где этот заголовок стоит,
не важно (Rspamd вставляет свой `Authentication-Results` наверх, а служебные заголовки дописывает
в конец). Чтобы его нельзя было подделать, та же таблица `authres_strip.regexp` удаляет из
входящих писем все `X-Rspamd-Queue-Id` и `X-Rspamd-Server` — остаются только добавленные milter.
Подробнее о стороне Rspamd — [`rspamd.md`](rspamd.md).

**Отправка (587/465/2587):** TLS обязателен → SASL `smtpd_sasl_type = dovecot`,
`smtpd_sasl_path = inet:dovecot:12345` (Dovecot проверяет пароль через API) →
`reject_sender_login_mismatch` по `v_postfix_sender_login` → policy (RCPT и END-OF-MESSAGE) →
`cleanup-submission` (удаление клиентских заголовков) → milter Rspamd (DKIM/ARC-подпись) →
доставка по MX с DANE/TLS.

**Отправка из веб-почты (2587):** тот же путь, что и у 587. Шлюз `webmail` подключается к
2587 (в compose — `postfix-backend:2587`: псевдоним только в сети `backend`, имя `postfix` могло бы
дать адрес в сети `public`, а такие клиенты на 2587 не допускаются; в Helm — `postfix:2587`) по
STARTTLS и проходит SMTP AUTH (PLAIN) с краткоживущими учётными данными своей веб-сессии; их
проверяет бэкенд через тот же SASL → Dovecot → passdb, что и пароли почтовых клиентов, поэтому
статус ящика/домена и приостановка отправки действуют так же. Отличия от 587:

- `smtpd_sasl_service = smtp-webmail`: Postfix передаёт имя сервиса в Dovecot, и passdb видит
  `protocol` = `smtp-webmail`. Учётные данные шлюза бэкенд принимает только так (и на
  внутреннем IMAP-порту Dovecot 1143), а обычные пароли и пароли приложений на этом пути
  отклоняет.
- Подключаться могут только loopback и сети из `MGATE_WEBMAIL_CLIENT_NETS` (по умолчанию
  `MGATE_BACKEND_SUBNET`): `smtpd_client_restrictions = $mua_webmail_client_restrictions`
  (`check_client_access cidr:/etc/postfix/webmail_clients.cidr, reject`) и
  `smtpd_delay_reject = no`, т.е. проверка выполняется сразу при подключении, до AUTH; остальные
  получают `554 5.7.1 ... Client host rejected`.

Дальше — `reject_sender_login_mismatch`, policy, `cleanup-submission`, DKIM-подпись в Rspamd.

**Сгенерированная внутри** (bounce, `postmaster@`, Sieve redirect/vacation из Dovecot через
`postfix:25` из backend-подсети): `non_smtpd_milters = $smtpd_milters`, т.е. тоже проходит Rspamd.

### Политики отказа

| Ситуация | Порт 25 | 587/465/2587 |
|----------|---------|---------|
| `api:10040` недоступен | `DUNNO` (почта принимается) | `451 4.3.5` (временная ошибка: без rate limit не отправляем) |
| Rspamd недоступен | `milter_default_action = accept` | `tempfail` (неподписанная DKIM почта не уходит) |
| `dovecot:12340` недоступен | `DUNNO` | `DUNNO` |
| Postgres недоступен | временная ошибка lookup → 4xx | то же |

Таймауты policy: `timeout=10s, max_idle=300s, max_ttl=1000s, try_limit=2` (синтаксис Postfix 3.x
`check_policy_service { ... }`; значение с пробелами в `default_action` заключено в `{ }`).

### Лимиты (anvil)

`smtpd_client_connection_count_limit = 20`, `..._connection_rate_limit = 60`/мин,
`..._message_rate_limit = 120`, `..._recipient_rate_limit = 600`, `..._auth_rate_limit = 30`,
`..._new_tls_session_rate_limit = 120`; `mynetworks` не ограничивается. Лимиты на ящик/домен
(«в час/в день») реализует policy-сервис бэкенда (TODO(S2)).

**Порт 2587:** допущенные клиенты (`webmail_clients.cidr`, IPv4 и IPv6) освобождены от всех этих
лимитов (`-o smtpd_client_event_limit_exceptions=$mgate_webmail_clients` в `master.cf`): все
пользователи веб-почты подключаются с одного адреса шлюза, и общий лимит 30 AUTH/мин или 20
соединений на IP ограничивал бы всю инсталляцию. По той же причине в Dovecot выключена встроенная
задержка после неудачных входов с одного IP (anvil, [`dovecot.md`](dovecot.md) §6.3): несколько
неверных SASL-попыток с адреса шлюза иначе задерживали бы AUTH всех пользователей веб-почты дольше
10-секундного таймаута SASL. Лимиты на ящик и домен policy-сервиса действуют
по `sasl_username`, как на 587. Запросы к policy-сервису с этого порта приходят с атрибутом
`policy_context=submission-webmail` (`smtpd_policy_service_policy_context`), чтобы его можно было
отличить от 587/465. Порт 2587 никогда не публикуется наружу; в Kubernetes, где `MGATE_BACKEND_SUBNET`
обычно не задан, чарт передаёт `MGATE_WEBMAIL_CLIENT_NETS` из `postfix.webmailClientNets` /
`config.backendSubnet`, а без них допускает любой источник и полагается на NetworkPolicy
(`deploy/helm/mgate/README.md`, «Веб-почта»).

Также: `smtpd_forbid_bare_newline = normalize` и `smtpd_forbid_unauth_pipelining = yes`
(защита от SMTP smuggling), `disable_vrfy_command = yes`, `smtputf8_enable = yes`,
`inet_protocols = ipv4` (IPv6 для исходящей почты требует отдельных PTR/SPF, TODO(S1)).

## 7. TLS

**Сервер:** `smtpd_tls_chain_files = /certs/default/privkey.pem, /certs/default/fullchain.pem`,
протоколы `>=TLSv1.2`; TLS 1.3 выбирается автоматически, если его поддерживает клиент.
Порт 25 — opportunistic (`may`, шифры `medium`: альтернатива — открытый текст, поэтому TLS 1.2 с
широким набором шифров обязателен по смыслу). 587/465/2587 —
`encrypt` с `smtpd_tls_mandatory_ciphers = high` (список Mozilla «intermediate»).
AUTH разрешён только поверх TLS (`smtpd_tls_auth_only = yes`, `noplaintext`).

**Клиент (исходящая):** `smtp_dns_support_level = dnssec` + `smtp_tls_security_level = dane`:
DANE для доменов с DNSSEC-подписанными TLSA, иначе автоматический откат к `may`. Требуется
валидирующий резолвер (unbound, `MGATE_RESOLVER_IP`) и бит AD, дошедший до Postfix: в compose
для сервиса postfix нужен `dns_opt: ["trust-ad"]` (glibc ≥ 2.31 иначе сбрасывает AD).
Проверка: в логе не должно быть предупреждений `dnssec_probe`. TODO(S1): проверить, что
встроенный DNS Docker (127.0.0.11) пропускает бит AD от unbound; MTA-STS через
`smtp_tls_policy_maps`.

**Bootstrap-сертификат:** если в `/certs/default` нет пары файлов, `mgate-postfix-init` создаёт
self-signed ECDSA P-256 на 90 дней для `MGATE_HOSTNAME` (+ маркер `BOOTSTRAP`). Postfix и Dovecot
стартуют одновременно на общем volume, поэтому генерация сериализуется `flock` на
`/certs/.bootstrap.lock`, наличие файлов перепроверяется под блокировкой, файлы кладутся
атомарным `rename` (сначала ключ). Позже бэкенд `mgate` заменяет пару, а `mgate-agent`
видит изменение и делает `postfix reload`. Контейнеры `api`/`worker` работают под uid 10001,
поэтому init-скрипт передаёт `/certs`, `/certs/default` (если они принадлежат root, т.е. volume
только что создан) и bootstrap-файлы владельцу `MGATE_CERTS_OWNER` (по умолчанию
`10001:10001`; пустое значение — оставить root). Postfix/Dovecot читают ключ как root. Для Kubernetes с RWX-томом на NFS `flock` может не
работать — там сертификат должен выпускаться до старта (TODO(S8)).

## 8. Требования к контейнеру (capabilities)

Compose запускает сервис с `cap_drop: [ALL]` и `no-new-privileges`. Минимальный набор,
проверенный при сборке (запуск базового образа с этими флагами, приём на 25, отправка через 587/465,
доставка в Dovecot): `NET_BIND_SERVICE, CHOWN, SETUID, SETGID, DAC_OVERRIDE, FOWNER`.
`FOWNER` обязателен: `postfix check`/`set-permissions` выполняют `chmod` каталогов очереди,
принадлежащих пользователю `postfix` (без него init падает с «unable to create missing queue
directories»).

## 9. Сборка и проверка

```bash
# только конфиги (без бинарника агента), затем проверки внутри контейнера с фиктивным окружением
docker build -f docker/postfix/Dockerfile --target base -t mgate-check/postfix:base .
docker run --rm --entrypoint bash \
  -e MGATE_HOSTNAME=mail.example.com -e POSTGRES_MAIL_PASSWORD=dummy \
  mgate-check/postfix:base -c 'mgate-postfix-init && postfix check && postconf -n && postconf -M'
# параметры внутреннего порта веб-почты (должны совпадать с submission, кроме syslog_name,
# smtpd_sasl_service, smtpd_delay_reject, smtpd_client_restrictions,
# smtpd_client_event_limit_exceptions и smtpd_policy_service_policy_context)
docker run --rm --entrypoint bash -e MGATE_HOSTNAME=mail.example.com -e POSTGRES_MAIL_PASSWORD=dummy \
  mgate-check/postfix:base -c 'mgate-postfix-init >/dev/null && postconf -P | grep -E "^(submission|2587)/"'
# отрендеренные таблицы: удаление входящих Authentication-Results с нашим authserv-id и клиенты 2587
docker run --rm --entrypoint bash -e MGATE_HOSTNAME=mail.example.com -e POSTGRES_MAIL_PASSWORD=dummy \
  mgate-check/postfix:base -c 'mgate-postfix-init >/dev/null &&
    postmap -q "Authentication-Results: mail.example.com; dkim=pass" regexp:/etc/postfix/authres_strip.regexp &&
    postmap -q 172.30.1.20 cidr:/etc/postfix/webmail_clients.cidr'
# IGNORE
# OK

# полный образ (с mgate-agent)
docker build -f docker/postfix/Dockerfile -t mgate/postfix .
```

`make validate-configs` вызывает те же проверки для всех почтовых образов.

## 10. Отладка

```bash
docker compose logs -f postfix                  # поток логов (через mgate-agent)
docker compose exec postfix postconf -n         # фактическая конфигурация
docker compose exec postfix postconf -M         # сервисы master.cf
docker compose exec postfix postconf -P | grep '^2587/'   # параметры порта веб-почты
docker compose exec postfix cat /etc/postfix/webmail_clients.cidr   # кто допущен на 2587
docker compose logs postfix | grep submission-webmail     # сессии шлюза веб-почты
docker compose exec postfix postqueue -p        # очередь (или GET :7070/v1/queue)
docker compose exec postfix postcat -vq <ID>    # содержимое письма в очереди
docker compose exec postfix postmap -q example.com pgsql:/etc/postfix/pgsql/virtual_domains.cf
docker compose exec postfix postmap -q user@example.com pgsql:/etc/postfix/pgsql/virtual_aliases.cf
docker compose exec postfix mgate-healthcheck
# проверка TLS и AUTH снаружи
openssl s_client -starttls smtp -connect mail.example.com:587 -crlf
openssl s_client -connect mail.example.com:465 -crlf
```

Типичные проблемы:

- `warning: connect to Milter service inet:rspamd:11332` — Rspamd не запущен; на 587/465
  это даёт `451 4.7.1` (так задумано).
- `451 4.3.5 Policy service unavailable` на 587 — недоступен `api:10040`.
- `SASL authentication failure` — смотрите логи Dovecot (`auth:`) и ответ
  `/internal/v1/dovecot/passdb`.
- `554 5.7.1 ... Client host rejected: Access denied` на 2587 — адрес клиента не входит в
  `webmail_clients.cidr`: в compose шлюз должен подключаться к `postfix-backend:2587`, в
  Kubernetes проверьте `postfix.webmailClientNets` / `config.backendSubnet`.
- Временно включить подробный лог для одного клиента: `postconf -e debug_peer_list=1.2.3.4`
  и `postfix reload` (не забыть вернуть).

## 11. Что осталось (TODO)

- TODO(S1): readiness агента через `notification-fd`; IPv6 opt-in; MTA-STS
  (`smtp_tls_policy_maps`); шаблоны
  bounce/DSN на русском и английском (`bounce_template_file`); SRS для пересылок; проверка
  прохождения бита AD через DNS Docker; маршрут для DMARC-отчётов в обход Rspamd.
  *(Ключ Spamhaus DQS и маскирование `postscreen_dnsbl_reply_map` реализованы в `mgate-postfix-init`)*.
- TODO(S2): реализация policy-сервиса бэкенда (протокол Postfix policy delegation: состояния
  `RCPT` и `END-OF-MESSAGE`, ответы `DUNNO`/`DEFER_IF_PERMIT`/`450 4.7.1`/`REJECT`).
- TODO(S4): генерация `postscreen_access.cidr` из банов/allowlist админки.
- TODO(S5): опция удаления `User-Agent`/`X-Mailer` на submission.
- TODO(S8): PROXY protocol (`postscreen_upstream_proxy_protocol`, `smtpd_upstream_proxy_protocol`)
  за балансировщиком в Kubernetes; сертификаты без `flock` на сетевых томах.
