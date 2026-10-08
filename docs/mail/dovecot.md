# Dovecot (IMAP/POP3/LMTP/Sieve) в MGate

Образ `${MGATE_REGISTRY}/dovecot` — хранилище и доступ к почте: IMAP (143/993, внутренний 1143 для
шлюза веб-почты), POP3 (110/995),
ManageSieve (4190), доставка по LMTP от Postfix (24), SASL для Postfix (12345), policy квот
(12340), doveadm HTTP API (8080) и метрики OpenMetrics (9900). Рядом работает `mgate-agent`
(syslog-сервер, health/reload, сброс кэша auth, наблюдение за сертификатами).

Исходники: `docker/dovecot/` (Dockerfile + `rootfs/`). Имена, порты и переменные — `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`.
Связанные документы: [`postfix.md`](postfix.md), [`rspamd.md`](rspamd.md),
`docs/adr/0004-auth-delegated-to-api.md`.

## 1. Версии и состав образа

| Компонент | Версия (проверено при сборке) | Пакеты Debian trixie |
|-----------|----------------------------------|----------------------|
| Dovecot | 2.4.1-4 (`dovecot --version`) | `dovecot-core`, `-imapd`, `-pop3d`, `-lmtpd`, `-pgsql` |
| Pigeonhole | 2.4.1-4 | `dovecot-sieve`, `dovecot-managesieved` |
| Lua passdb | 2.4.1 (Lua 5.4, HTTP-клиент `dovecot.http`) | `dovecot-auth-lua`, `lua-json` |
| FTS | fts_flatcurve (Xapian) | `dovecot-flatcurve` |
| s6-overlay | v3.2.3.2 | GitHub releases (sha256 в `ARG`) |

Конфигурация написана **в синтаксисе Dovecot 2.4** (`dovecot_config_version = 2.4.0`):
`mail_driver`/`mail_path`, булевы списки `mail_plugins { quota = yes }`, `sieve_script <name> { }`,
`ssl_server_cert_file`, `quota "..." { driver = count }` и т.д. Примеры для 2.3 из интернета
здесь не работают. Стоковые `conf.d` Debian удаляются при сборке, конфигурация полностью своя.

Стадии Dockerfile те же, что у Postfix: именованная стадия `mgate-agent` (готовый образ
`MGATE_AGENT_IMAGE`, откуда берётся только бинарник агента), `base`
(пакеты, s6-overlay, конфиги, скомпилированные глобальные Sieve-скрипты, пользователь `vmail`
5000:5000), `final` (+ бинарник `mgate-agent`).

## 2. Процессы и порядок запуска (s6-overlay v3)

```
/init
 └─ bundle "user"
     ├─ mgate-init   oneshot  → /usr/local/bin/mgate-dovecot-init   (рендер, bootstrap-сертификат, sievec)
     ├─ mgate-agent  longrun  → mgate-agent --role dovecot
     └─ dovecot      longrun  → dovecot -F                           (после mgate-init и mgate-agent)
```

Логи: `log_path = syslog` → `/dev/log` (mgate-agent → stdout + Valkey `mgate:logs`).
`MGATE_LOG_STDOUT=1` переключает на `log_path = /dev/stderr`. `MGATE_LOG_LEVEL=debug` добавляет
`log_debug = category=auth OR category=lmtp OR category=sieve`.

## 3. Порты

| Порт | Сервис | Назначение | Доступность |
|------|--------|-----------|-------------|
| 143 / 993 | `imap-login` | IMAP (STARTTLS) / IMAPS | публикуется |
| 1143 | `imap-login` (`inet_listener imap-webmail`) | внутренний IMAP (STARTTLS, те же настройки TLS, что у 143) только для шлюза веб-почты (`dovecot-backend:1143` в compose) | backend; в Helm NetworkPolicy пускает только поды `webmail` |
| 110 / 995 | `pop3-login` | POP3 (STARTTLS) / POP3S | публикуется |
| 4190 | `managesieve-login` | ManageSieve (STARTTLS) | публикуется |
| 24 | `lmtp` | доставка от Postfix (`lmtp:inet:dovecot:24`) | backend |
| 12345 | `auth` (`inet_listener sasl`) | SASL для Postfix (`smtpd_sasl_path = inet:dovecot:12345`) | backend |
| 12340 | `quota-status` | Postfix policy (`check_policy_service inet:dovecot:12340`) | backend |
| 8080 | `doveadm` (`inet_listener http`) | doveadm HTTP API для бэкенда | backend |
| 9900 | `stats` (`inet_listener http`) | OpenMetrics (`GET /metrics`) | backend |
| 7070 | mgate-agent | health/reload, сброс кэша auth (§6.1) и другие команды бэкенда | backend |

«backend» означает: порт не публикуется compose; сервис доступен контейнерам MGate по сети.

## 4. Переменные окружения

| Переменная | Обязательна | По умолчанию | Использование |
|------------|-------------|--------------|---------------|
| `MGATE_HOSTNAME` | да | — | `hostname`, `postmaster_address`, CN bootstrap-сертификата |
| `POSTGRES_MAIL_PASSWORD` | да | — | userdb SQL (роль `mgate_mail`) |
| `MGATE_INTERNAL_TOKEN` | да | — | Bearer для passdb/policy, Basic для экспорта событий, агент |
| `DOVEADM_API_KEY` | да | — | `doveadm_api_key` |
| `RSPAMD_CONTROLLER_PASSWORD` | нет | — | обучение Rspamd при перемещении в/из Junk (без него обучение выключено) |
| `POSTGRES_MAIL_USER` / `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` | нет | `mgate_mail` / `postgres` / `5432` / `mgate` | подключение userdb |
| `MGATE_BACKEND_SUBNET` | нет | `172.30.1.0/24` | `login_trusted_networks` (webmail передаёт реальный IP клиента, см. §6.4) |
| `MGATE_API_INTERNAL_URL` | нет | `http://api:8081` | база URL внутреннего API (для нестандартных развёртываний) |
| `MGATE_LOG_STDOUT`, `MGATE_LOG_LEVEL`, `TZ` | нет | `0`, `info`, `UTC` | логирование |
| `MGATE_CERTS_OWNER` | нет | `10001:10001` | владелец bootstrap-сертификата в `/certs` (см. `postfix.md` §7) |

`MGATE_INTERNAL_TOKEN` и `DOVEADM_API_KEY` должны состоять из символов `[A-Za-z0-9._~+/=-]`
(так их генерирует `scripts/gen-secrets.sh`); init-скрипт отказывается стартовать иначе.

## 5. Карта конфигурации

| Файл | Назначение |
|------|-----------|
| `/etc/dovecot/dovecot.conf` | протоколы, `listen`, логирование; подключает `conf.d/*.conf` и затем `mgate/runtime.conf.ext` |
| `conf.d/10-auth.conf` | механизмы, кэш auth, `passdb lua`, `userdb sql`, настройки auth policy, SASL-листенер 12345, `auth-worker` без root |
| `conf.d/10-mail.conf` | Maildir, `vmail`, детект вложений (`$HasAttachment`), пространство имён и special-use папки, квота (`count`), `quota-status` на 12340 |
| `conf.d/10-master.conf` | листенеры imap (в т.ч. внутренний `imap-webmail` 1143)/pop3/managesieve/lmtp/doveadm, встроенная задержка anvil после неудачных входов выключена (§6.3), лимиты памяти |
| `conf.d/10-ssl.conf` | `ssl = required`, `/certs/default`, `ssl_min_protocol = TLSv1.2`, шифры |
| `conf.d/20-protocols.conf` | плагины по протоколам, `lmtp_rcpt_check_quota`, `submission_host = postfix:25` |
| `conf.d/90-sieve.conf` | личные скрипты, глобальный `spam-to-junk`, extprograms, IMAPSieve |
| `conf.d/90-fts.conf` | fts_flatcurve, языки ru/en |
| `conf.d/95-stats.conf` | OpenMetrics, метрики, экспорт событий `auth_request_finished` в API |
| `/etc/dovecot/mgate/runtime.conf.ext` | **рендер** (0640 root:dovecot): hostname, `login_trusted_networks`, `pgsql <host> { parameters {...} }`, `lua_settings` (URL + токен), `auth_policy_server_url`/`_api_header`/`_hash_nonce`, `doveadm_api_key`, URL экспорта событий |
| `/etc/dovecot/mgate/rspamd-controller.headers` | **рендер** (0640 root:vmail): заголовок `Password:` для curl |
| `/etc/dovecot/lua/mgate-passdb.lua` | Lua passdb → API |
| `/etc/dovecot/sieve/before.d/10-spam-to-junk.sieve` (+`.svbin`) | спам по заголовкам Rspamd → `Junk` |
| `/etc/dovecot/sieve/report-{spam,ham}.sieve` (+`.svbin`) | IMAPSieve: обучение Rspamd |
| `/usr/local/lib/dovecot/sieve-pipe/rspamd-learn` | pipe-программа: `POST http://rspamd:11334/learnspam|learnham` |
| `/usr/local/bin/mgate-dovecot-init` | рендер (cont-init) |
| `/usr/local/bin/mgate-healthcheck` | `doveadm service status` + приветствие `* OK` на `127.0.0.1:143` |

Внимание: `doveconf -n` печатает рендеренные секреты (пароль БД, токен в `lua_settings`) —
не публикуйте его вывод целиком. `doveadm_api_key` скрывается самим doveconf.

## 6. Аутентификация

### 6.1 passdb: Lua → API (выбор механизма)

Возможны два варианта: Lua passdb с HTTP-клиентом Dovecot или `checkpassword` с
`mgate-agent checkpassword`. **Выбран Lua passdb**: пакет `dovecot-auth-lua` есть в trixie,
`libdovecot-lua` содержит `dovecot.http`, а работа проверена end-to-end (userdb из
PostgreSQL с миграциями репозитория, mock API): `doveadm auth test`, IMAP LOGIN через STARTTLS,
SMTP AUTH через Postfix 587/465. Преимущества: без fork/exec процесса на каждую попытку, общий
пул HTTP-соединений в `auth-worker`, кэш Dovecot, никаких дополнительных бинарников.
`mgate-agent checkpassword` остаётся необязательным запасным путём (TODO(S1) — только если
понадобится).

Скрипт работает в режиме проверки пароля (`auth_password_verify`) в процессах `auth-worker`
(`use_worker = yes`, пользователь `dovecot`, не root). Кэш: ключ
`%{user}\t%{protocol}\t%{real_local_port}\t%{password | sha256 | hex}` — пользователь, протокол,
порт листенера, на который реально пришло соединение, и хэш предъявленного пароля. Порт нужен,
потому что ответ API зависит от листенера (см. «Веб-почта» ниже): без него результат, закэшированный
для одного порта, применился бы к другому. Хэш нужен, чтобы закэшированный пароль (пароль ящика,
пароль приложения, учётные данные веб-сессии) не блокировал другой верный пароль того же
пользователя на время жизни кэша. `auth_cache_ttl = 5 mins`, отрицательный — 1 мин.

Userdb (SQL) не кэшируется (`use_cache = no`): представление `v_dovecot_userdb` не содержит
отключённых ящиков и доменов, поэтому вход отключённого ящика по IMAP/POP3/ManageSieve
отклоняется сразу, даже пока его пароль лежит в кэше.

**Сброс кэша при изменениях.** При смене или сбросе пароля, отзыве пароля приложения, отключении
или удалении ящика `mgate` сначала сбрасывает записи этого пользователя в кэше auth (и только
после этого отвечает на запрос, ожидая сброс не дольше 5 секунд), затем завершает его открытые
сессии (`doveadm kick` через HTTP API) и повторяет `kick` после истечения `auth_cache_ttl`.
Поэтому старый пароль, отозванный пароль приложения и пароль отключённого ящика
перестают приниматься сразу — и по IMAP/POP3/ManageSieve, и в SMTP AUTH (Postfix проверяет пароль
через Dovecot без userdb), а клиент, переподключившийся сразу после `kick`, проходит проверку
заново, а не входит из кэша. При отключении или удалении домена сбрасывается весь кэш: записи в
нём привязаны к имени пользователя, а не к домену. Это стоит не больше, чем обычное истечение
кэша: следующий вход каждого пользователя снова проверяется через API.

Сброс выполняет `mgate-agent` (роль dovecot) командой `doveadm auth cache flush <user>` внутри
контейнера — doveadm HTTP API этого не умеет: в Dovecot 2.4.1 его команда `authCacheFlush`
приводит к panic процесса doveadm (`doveadm-cmd-parse.c: assertion failed: (param->type ==
CMD_PARAM_STR)`). Эндпоинт агента — `POST /v1/auth-cache/flush` на порту 7070 (только сеть
backend, `Authorization: Bearer ${MGATE_INTERNAL_TOKEN}`) с телом `{"user": "alice@example.com"}`
(один пользователь) или `{"all": true}` (весь кэш); ответ `{"ok": true, "flushed": <число
удалённых записей>}`. Имя пользователя агент проверяет строго: только строчные `local@domain` из
символов `auth_username_chars` по умолчанию (`a-z 0-9 . - _ @`), первым символом — буква, цифра
или `_`; другие имена Dovecot к входу не допускает, значит, в кэше их быть не может. Команда
запускается без оболочки с фиксированным списком аргументов. Об ошибке агент судит и по stderr:
в Dovecot 2.4.1 `doveadm auth cache flush` завершается с кодом 0 и печатает
`0 cache entries flushed`, даже если не достучался до процесса auth (`Error: auth-master: ...
connect(...) failed`); в этом случае агент отвечает `502`.

Сброс и `kick` — по возможности: если агент или Dovecot недоступны, бэкенд пишет предупреждение в
лог, а действие пользователя или администратора всё равно выполняется. Тогда до истечения
`auth_cache_ttl` (5 минут) прежние учётные данные могут открывать новые сессии из кэша (пароль
отключённого ящика — только в SMTP AUTH; по IMAP/POP3/ManageSieve его не пустит userdb, но в окне
кэша клиент увидит внутреннюю ошибку входа с закрытием соединения вместо обычного отказа), а
повторный `kick` завершит такие сессии. Сбросить кэш вручную:
`docker compose exec dovecot doveadm auth cache flush alice@example.com` (без имени — весь кэш);
`doveadm reload` (HTTP-команда `reload` или `POST /v1/reload` агента) тоже очищает кэш, перезапуская
процесс auth.

**Протокол `POST {MGATE_API_INTERNAL_URL}/internal/v1/dovecot/passdb`** (стабилен):

Заголовки: `Authorization: Bearer ${MGATE_INTERNAL_TOKEN}`, `Content-Type: application/json`.

```json
{
  "user": "alice@example.com",
  "password": "…",
  "protocol": "imap",
  "mechanism": "PLAIN",
  "remote_ip": "203.0.113.7",
  "local_ip": "172.30.1.20",
  "secured": "secured",
  "session": "sFh8xThbKsR/AAAB",
  "client_id": "Thunderbird",
  "local_port": "143",
  "real_rip": "203.0.113.7"
}
```

`protocol`: `imap`, `pop3`, `sieve`, `smtp` (SASL из Postfix 587/465), `smtp-webmail` (SASL из
Postfix 2587, см. `postfix.md` §6), `doveadm`… Значения берутся через
`req:var_expand("%{…}")`, пустые поля передаются пустой строкой. Для SMTP `remote_ip` — адрес
клиента Postfix.

- `local_port` — порт листенера, на который реально пришло TCP-соединение (`%{real_local_port}`):
  `1143` — внутренний IMAP-порт шлюза веб-почты, `143`/`993`/`110`/`995`/`4190` — публичные.
  Берётся именно «реальное» значение: `%{local_port}` клиент из `login_trusted_networks` может
  подменить через IMAP `ID` (`x-connected-port`), а реальный порт — нет (проверено). Пустая строка,
  если порта у запроса нет (SASL из Postfix, `doveadm`); API считает такой запрос пришедшим на
  публичный порт.
- `real_rip` — адрес самого TCP-собеседника (`%{real_remote_ip}`), например пода/контейнера шлюза
  веб-почты; `remote_ip` — адрес клиента, который доверенный прокси передал через IMAP `ID`
  (`x-originating-ip`), а без него совпадает с `real_rip`.

Ответ `200 OK`:

```json
{ "result": "ok", "user": "alice@example.com" }
```

| `result` | Итог в Dovecot |
|----------|----------------|
| `ok` | успех; `user` (необязательно) — каноническое имя, заменяет введённое |
| `password_mismatch` | неверный пароль (учитывается auth policy и `auth_failure_delay`) |
| `user_unknown` | нет такого пользователя |
| `user_disabled` | ящик заблокирован |
| `pass_expired` | пароль просрочен |
| `internal_failure` | временная ошибка (клиент получит «попробуйте позже») |

Любой результат, кроме `ok`, скрипт возвращает Dovecot как отказ без дополнительных полей (так
требует Dovecot 2.4: при отказе второе значение — `nil` или строка), поэтому клиент получает
обычный отказ аутентификации (IMAP `NO [AUTHENTICATIONFAILED]`, SMTP `535 5.7.8`) с задержкой
`auth_failure_delay`, а auth policy — `fail_type` по существу, а не «внутреннюю ошибку».

**Веб-почта.** Шлюз `webmail` не знает паролей пользователей и не использует master-пользователя
Dovecot: для каждой веб-сессии он входит в IMAP (и в SMTP AUTH через Postfix 2587) с
**краткоживущими учётными данными, привязанными к этой сессии и проверяемыми бэкендом** через тот
же passdb. Для IMAP шлюз подключается к отдельному внутреннему листенеру `imap-webmail` на порту
1143 (не публикуется; в Helm доступен только подам `webmail`). Бэкенд принимает учётные данные
шлюза только при `protocol` = `imap` и `local_port` = `1143` либо при `protocol` = `smtp-webmail`
(Postfix 2587); на этих двух путях обычные пароли и пароли приложений отклоняются, а на всех
остальных портах отклоняются учётные данные шлюза. Поэтому `MGATE_IMAP_ADDR` шлюза должен
указывать на 1143, а не на публичный 143. Дальше бэкенд отвечает `ok` только для живой веб-сессии
владельца ящика и применяет те же проверки статуса ящика, домена и приостановки отправки, что и
для пароля. Кэш auth (до 5 минут) действует и здесь: после выхода из веб-сессии уже проверенные
данные могут приниматься Dovecot до истечения кэша, но шлюз сам проверяет сессию при каждом
запросе браузера, а браузеру эти данные не передаются.

Необязательное поле `reason` пишется в лог Dovecot. Любой статус HTTP, кроме 200, таймаут
(`connect_timeout = 2s`, `request_timeout = 5s`, 2 попытки) или невалидный JSON → временная
ошибка (`internal_failure`), а не «неверный пароль». TODO(S2): дополнительные поля ответа
(например, `nologin`/`reason` для приостановленных ящиков).

### 6.2 userdb: PostgreSQL

```sql
SELECT home, uid, gid,
       CASE WHEN quota_bytes IS NULL OR quota_bytes <= 0 THEN 'unlimited'
            ELSE quota_bytes::text || 'B' END AS quota_storage_size
  FROM v_dovecot_userdb WHERE username = '%{user}';
-- iterate_query (doveadm -A):
SELECT username AS user FROM v_dovecot_userdb;
```

Путь к письмам — `mail_path = ~/Maildir`, т.е. `/var/vmail/<domain>/<local>/Maildir`
(`home` из представления); колонка `maildir` представления не используется, чтобы не зависеть от
её формата. LMTP-доставка зависит только от PostgreSQL, не от API.

### 6.3 Auth policy

`auth_policy_server_url = http://api:8081/internal/v1/dovecot/policy` (Dovecot добавляет
`?command=allow` перед проверкой пароля и `?command=report` после неё),
`auth_policy_server_api_header = Authorization: Bearer ${MGATE_INTERNAL_TOKEN}`. Тело — JSON с
атрибутами по умолчанию Dovecot 2.4: `login`, `pwhash` (усечённый SHA-256 пароля с солью
`auth_policy_hash_nonce`), `remote`, `device_id`, `protocol`, `session_id`, `fail_type`, `tls`,
и двумя добавленными в `10-auth.conf` (`auth_policy { request_attributes { … } }`): `real_rip`
(`%{real_remote_ip}`) и `local_port` (`%{real_local_port}`, порт листенера, по нему видны входы
веб-почты через внутренний листенер 1143); в `report` — ещё `success`, `policy_reject`. Ответ API: `{"status": 0, "msg": ""}` — `0`
разрешить, `<0` отклонить (`msg` уйдёт клиенту), `>0` задержать ответ на столько секунд.
`auth_policy_hash_nonce` вычисляется при старте как `sha256("mgate-dovecot-policy:" + token)`
(первые 32 hex-символа) — стабилен в пределах инсталляции. `auth_policy_reject_on_fail = no`:
при недоступности API вход не блокируется политикой (но сам passdb всё равно требует API).

**Встроенная задержка Dovecot выключена.** Сам Dovecot (процесс anvil) после неудачных входов
задерживает каждую следующую аутентификацию с того же IP — 2, 4, 8 и до 15 секунд, даже с верным
паролем. Вся отправка из веб-почты проходит SMTP AUTH через Postfix 2587 с одного адреса — адреса
шлюза, а Postfix ждёт ответа SASL 10 секунд. Поэтому несколько неудачных попыток с этого адреса
сорвали бы отправку всем пользователям веб-почты (`454`), пока задержка не спадёт, а пользователи
за общим NAT с подбирающим пароли адресом получали бы медленный или прерванный по таймауту вход
(шлюз ждёт входа в IMAP 12 секунд). Задержка выключена в `10-master.conf`:

```
service anvil {
  unix_listener anvil-auth-penalty {
    mode = 0
  }
}
```

Без этого сокета процесс auth не обращается к anvil за задержкой (проверено на 2.4.1: пять неверных
паролей подряд с одного IP — каждый отказ за 2 с, верный пароль после них — сразу; с задержкой —
до 17 с и 15 с на верный пароль). Подбор паролей ограничивает auth policy `mgate` (счётчики
неудач по IP и по паре IP + логин, задержки и баны), а `auth_failure_delay = 2 secs`
по-прежнему задерживает каждый отказ. Проверка: `doveconf -n` показывает блок `service anvil` с
`mode = 0`, а в `/run/dovecot` нет сокета `anvil-auth-penalty`.

### 6.4 TLS и доверенные сети

`ssl = required`: аутентификация только поверх TLS (993/995 — неявный TLS; 143/110/4190 —
STARTTLS). `login_trusted_networks = 127.0.0.0/8 ${MGATE_BACKEND_SUBNET}`: webmail из
backend-сети может передать реальный IP пользователя через IMAP `ID` (`x-originating-ip`) — этот
IP видят auth policy и passdb. Шлюз всё равно всегда включает STARTTLS и проверяет сертификат.
В compose у Dovecot есть псевдоним `dovecot-backend`, который резолвится только в сети `backend`,
и шлюз подключается к `dovecot-backend:1143` (`MGATE_IMAP_ADDR`): имя `dovecot` могло бы дать адрес
в сети `public`, и тогда соединение шло бы не из `MGATE_BACKEND_SUBNET`, а `ID` игнорировался бы. Сертификат — тот же
`/certs/default`, что у Postfix (bootstrap self-signed с `flock`, см. `postfix.md` §7), после
замены `mgate-agent` выполняет `doveadm reload`.

## 7. Хранилище, папки, квота

- Maildir под `/var/vmail` (volume `vmail`), владелец `vmail` 5000:5000; init исправляет только
  верхний каталог (никогда не делает `chown -R` по почте).
- Пространство имён `inbox` (разделитель `/`), special-use папки создаются и подписываются
  автоматически: `Drafts`, `Sent`, `Junk` (autoexpunge 30 дней), `Trash` (autoexpunge 30 дней,
  +100M сверх квоты), `Archive`; `Sent Messages` — алиас для Apple Mail.
- Детект вложений: `mail_attachment_detection_options = add-flags
  content-type=!application/*-signature` — при сохранении письма (LMTP, APPEND), а при чтении —
  если это дёшево, письмо помечается ключевым словом `$HasAttachment` или `$HasNoAttachment`.
  Отсоединённые подписи (`application/pgp-signature`, `application/pkcs7-signature`, …) вложениями
  не считаются. Флаги видят IMAP-клиенты и веб-почта (значок вложения в списке писем без загрузки
  структуры письма). Письма, сохранённые до включения опции, получают флаг, только когда Dovecot
  и так разбирает их структуру; до этого у них нет ни одного из двух ключевых слов.
- Квота: плагин `quota`, драйвер `count`, лимит из userdb (`quota_storage_size`); `imap_quota`
  для клиентов. `quota-status` на 12340 отвечает Postfix: `DUNNO` / `552 5.2.2 Mailbox is full`
  / `552 5.2.3 ...` (слишком большое письмо; в 2.4.1 при пустом `quota_status_toolarge` сервис
  возвращает пустой `action=` — поэтому значение задано явно). LMTP дополнительно проверяет квоту
  на RCPT (`lmtp_rcpt_check_quota = yes`). TODO(S1): предупреждения 80/95 % (`quota ... { warning
  ... }` + сервис `quota-warning`, письмо пользователю + событие в API).

## 8. Sieve

- Личные скрипты: `~/sieve`, активный — `~/.dovecot.sieve`; управление через ManageSieve (4190).
  Фильтры, автоответчик и пересылка из личного кабинета генерируются бэкендом
  и загружаются через ManageSieve (TODO(S5)).
- Глобальный `before`-скрипт `10-spam-to-junk.sieve`: письма с `X-Spam: Yes`, `X-Spam-Flag: YES`
  или `X-Rspamd-Action: add header|rewrite subject` (заголовки Rspamd, см. `rspamd.md`) кладутся
  в `Junk`, личный скрипт для них не выполняется. Скрипты компилируются `sievec` при сборке
  образа и перекомпилируются init-скриптом, если `.sieve` новее `.svbin` (vmail не может писать
  в `/etc/dovecot/sieve`).
- Redirect/vacation отправляются через `submission_host = postfix:25` (backend-подсеть входит в
  `mynetworks` Postfix), `sieve_redirect_envelope_from = orig_recipient` сохраняет SPF.
  TODO(S1): SRS.
- IMAPSieve: перемещение письма **в** `Junk` → `rspamd-learn spam`, **из** `Junk` (кроме как в
  `Trash`) → `rspamd-learn ham`. Программа шлёт письмо в контроллер Rspamd
  (`http://rspamd:11334/learnspam|learnham`, заголовок `Password` из файла, пароль не попадает в
  командную строку) и никогда не ломает IMAP MOVE: ошибки только логируются. Проверено с
  mock-контроллером: MOVE в/из Junk порождает `POST /learnspam`/`/learnham` с верным заголовком
  `Password`. TODO(S1): проверить обучение с реальным Rspamd (`rspamc stat`; для записи контроллер
  должен принимать этот пароль как `enable_password`).

## 9. Полнотекстовый поиск

`fts_flatcurve` (Xapian), автоиндексация при доставке (`fts_autoindex = yes`; `Junk`/`Trash`
не индексируются), языки `ru` (по умолчанию) и `en` со snowball и стоп-словами. Индекс лежит
рядом с Maildir (`Maildir/fts-flatcurve/`). Проверено: `SEARCH TEXT` находит письмо.
TODO(S5): извлечение текста из вложений (`fts_decoder_driver = script`) для поиска по вложениям.

## 10. doveadm HTTP API, метрики, события

- doveadm HTTP API: `http://dovecot:8080/doveadm/v1`, заголовок
  `Authorization: X-Dovecot-API <base64(DOVEADM_API_KEY)>`. Пример:
  `curl -H "Authorization: X-Dovecot-API $(printf %s "$DOVEADM_API_KEY" | base64)"
  -d '[["quotaGet",{"user":"alice@example.com"},"t1"]]' http://dovecot:8080/doveadm/v1`.
  Используется бэкендом (квоты, reload, expunge, fts rescan, `kick`; сброс кэша auth — не через
  HTTP API, а через `mgate-agent`, см. §6.1).
- Метрики: `http://dovecot:9900/metrics` — `dovecot_auth_success_total`,
  `dovecot_auth_failure_total`, `dovecot_imap_command_total{cmd_name=...}`,
  `dovecot_mail_delivery_total` и встроенные.
- Экспорт событий: `event_exporter mgate` (драйвер `http-post`, JSON, RFC 3339) отправляет каждое
  `auth_request_finished` на `POST http://api:8081/internal/v1/events/dovecot`. Драйвер не умеет
  добавлять свои заголовки, поэтому токен передаётся через userinfo URL, и HTTP-клиент Dovecot
  шлёт `Authorization: Basic base64("dovecot:" + MGATE_INTERNAL_TOKEN)` (проверено).
  **API должен принимать этот эндпоинт с Basic-авторизацией** (пользователь `dovecot`, пароль —
  внутренний токен) наряду с Bearer. TODO(S2): обработчик в бэкенде.

## 11. Требования к контейнеру (capabilities)

С `cap_drop: [ALL]` + `no-new-privileges` проверенный минимум: `NET_BIND_SERVICE, CHOWN,
SETUID, SETGID, DAC_OVERRIDE, SYS_CHROOT, KILL`. `SYS_CHROOT` нужен процессам `*-login` (Dovecot по
умолчанию chroot'ит их в `/run/dovecot/login`; без него — `chroot(...) failed: Operation not
permitted` и IMAP не отвечает). `KILL` нужен процессам Dovecot, работающим от root, чтобы посылать
сигналы процессам других пользователей: без него `doveadm kick` (им `mgate` завершает сессии
отключённых ящиков) сообщает о сессиях, но не закрывает их — anvil пишет
`kill(...) failed: Operation not permitted`. Отключать chroot login-процессов не рекомендуется: это
изоляция кода, работающего до аутентификации.

## 12. Kubernetes / балансировщики (заметки)

- За TCP-балансировщиком добавить листенеры с `haproxy = yes` (например, 10143/10993) и
  `haproxy_trusted_networks` = адреса балансировщика; иначе все клиенты видны с IP балансировщика
  и auth policy банит его.
- `login_trusted_networks` — только подсеть подов webmail, не весь кластер (в Helm —
  `config.backendSubnet`; пусто по умолчанию, тогда Dovecot видит IP пода webmail вместо IP
  пользователя — вход работает, но журнал входов и auth policy видят адрес пода).
- LMTP/SASL/doveadm/metrics — только ClusterIP; NetworkPolicy ограничивает доступ Postfix/API.
- Внутренний IMAP-порт 1143 есть только в headless Service `dovecot` (не в публичном
  `*-dovecot-public`); NetworkPolicy пускает к нему только поды `webmail`.
- Хранилище: RWO-том или NFS/JuiceFS с учётом блокировок Maildir; bootstrap-сертификат на
  сетевых томах без `flock` не генерировать (выпускать заранее).

## 13. Сборка и проверка

```bash
docker build -f docker/dovecot/Dockerfile --target base -t mgate-check/dovecot:base .
docker run --rm --entrypoint bash \
  -e MGATE_HOSTNAME=mail.example.com -e POSTGRES_MAIL_PASSWORD=dummy \
  -e MGATE_INTERNAL_TOKEN=dummytoken -e DOVEADM_API_KEY=dummykey \
  mgate-check/dovecot:base -c 'mgate-dovecot-init && doveconf -n >/dev/null && echo OK'
# детект вложений включён:
docker run --rm --entrypoint bash -e MGATE_HOSTNAME=mail.example.com -e POSTGRES_MAIL_PASSWORD=dummy \
  -e MGATE_INTERNAL_TOKEN=dummytoken -e DOVEADM_API_KEY=dummykey \
  mgate-check/dovecot:base -c 'mgate-dovecot-init >/dev/null && doveconf -h mail_attachment_detection_options'
# add-flags "content-type=!application/*-signature"
# внутренний листенер шлюза веб-почты:
docker run --rm --entrypoint bash -e MGATE_HOSTNAME=mail.example.com -e POSTGRES_MAIL_PASSWORD=dummy \
  -e MGATE_INTERNAL_TOKEN=dummytoken -e DOVEADM_API_KEY=dummykey \
  mgate-check/dovecot:base -c 'mgate-dovecot-init >/dev/null && doveconf -n | grep -A2 "inet_listener imap-webmail"'
```

## 14. Отладка

```bash
docker compose logs -f dovecot
docker compose exec dovecot doveconf -n                      # (содержит секреты!)
docker compose exec dovecot doveadm user alice@example.com   # userdb из PostgreSQL
docker compose exec dovecot doveadm auth test alice@example.com 'пароль'   # passdb через API
docker compose exec dovecot doveadm auth cache flush alice@example.com   # без имени — весь кэш
docker compose exec dovecot ls /run/dovecot   # anvil-auth-penalty отсутствует (§6.3)
docker compose exec dovecot doveadm quota get -u alice@example.com
docker compose exec dovecot doveadm mailbox list -u alice@example.com
docker compose exec dovecot doveadm service status
openssl s_client -starttls imap -connect mail.example.com:143 -crlf
```

Типичные проблемы: `passdb-lua: script_init() failed` — ошибка в `lua_settings` или скрипте;
`mgate passdb API returned status ...` — API недоступен/отказал (смотрите логи `api`);
`userdb lookup ... Internal error` — нет связи с PostgreSQL или прав у `mgate_mail`.

## 15. Что осталось (TODO)

- TODO(S1): предупреждения квоты; SRS; проверка обучения Rspamd; readiness агента через
  `notification-fd`; при необходимости — `mgate-agent checkpassword` как запасной passdb.
- TODO(S2): эндпоинты `/internal/v1/dovecot/passdb`, `/policy`, `/events/dovecot` (Basic) в бэкенде;
  дополнительные поля ответа passdb.
- TODO(S5): Sieve-генерация фильтров/автоответчика из ЛК; поиск по вложениям.
- TODO(S8): HAProxy PROXY protocol, dual-stack `listen`, хранилище для кластеров.
