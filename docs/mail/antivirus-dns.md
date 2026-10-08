# Антивирус (ClamAV) и DNS-резолвер (Unbound)

## ClamAV

Официальный образ `clamav/clamav:1.5.4-debian13-slim` (проверено на Docker Hub 12.09.2026; вариант `-debian13-slim` собран на
`debian:trixie-slim`, той же базе, что и остальные образы проекта). `docker/clamav/` **не
содержит `Dockerfile`** — только справочные материалы (`README.md`) для секции
`environment:`/`healthcheck:` сервиса `clamav` в `docker-compose.yml` (профиль
`clamav`, см. `docs/ARCHITECTURE.md` §2.1).

### Механизм конфигурации: переменные окружения, не файлы

Проверено запуском образа (`docker run ... cat /etc/clamav/clamd.conf`):
entrypoint образа патчит `/etc/clamav/clamd.conf`/`/etc/clamav/freshclam.conf` по переменным вида
`CLAMD_CONF_<Директива>=<значение>` / `FRESHCLAM_CONF_<Директива>=<значение>` **до** старта
демонов. `TCPSocket 3310` и `TCPAddr 0.0.0.0` уже включены в образе по умолчанию (подтверждено) —
Rspamd (`docker/rspamd/local.d/antivirus.conf`, `servers = "clamav:3310"`) подключается без
дополнительных танцев с сокетами.

Рекомендуемые значения (точный список — `docker/clamav/README.md`):
```
CLAMD_CONF_StreamMaxLength=50M     # = MGATE_MESSAGE_SIZE_LIMIT (52428800 байт = 50 MiB)
CLAMD_CONF_MaxFileSize=50M
CLAMD_CONF_MaxScanSize=150M        # запас на распакованные архивы (2-4x StreamMaxLength)
CLAMD_CONF_MaxThreads=4
FRESHCLAM_CONF_Checks=12
CLAMAV_NO_MILTERD=true             # используем INSTREAM/3310 напрямую, milter (7357) не нужен
```
**Важно**: `StreamMaxLength`/`MaxFileSize` должны отслеживать `MGATE_MESSAGE_SIZE_LIMIT` из
`.env` вручную (единицы ClamAV — `M`/`G`, не байты; автоматического пересчёта из compose нет).
TODO(S1): рассмотреть генерацию этих значений из `MGATE_MESSAGE_SIZE_LIMIT` через entrypoint
самого mgate (или через `mgate-agent`) вместо статичной записи в compose-файле.

### Профиль и деградация

Если профиль `clamav` не активирован (`COMPOSE_PROFILES` без `clamav`), сервис не поднимается —
Rspamd на это рассчитан: недоступность `clamav:3310` даёт символ `CLAM_VIRUS_FAIL` (нейтральный
скор по умолчанию, письмо продолжает обрабатываться остальными модулями) вместо отказа проверки
целиком. См. `docs/mail/rspamd.md` "Антивирус (ClamAV)".

### Память и healthcheck

Рекомендация — `mem_limit: 2g` для сервиса `clamav` (база сигнатур + рабочие потоки, апстрим
рекомендует 1.5–2 ГБ). Образ уже содержит собственный `HEALTHCHECK` (`clamdcheck.sh`,
`start-period` 6 минут — подтверждено `docker inspect`), переопределять не нужно; долгий
start-period стоит учитывать при настройке `depends_on: condition: service_healthy` для
`rspamd`/`postfix`, если они должны ждать готовности антивируса.

Volume `clamav-db` (`/var/lib/clamav`, см. `docs/ARCHITECTURE.md` §5) обязателен для персистентности базы
сигнатур между рестартами — без него `freshclam` каждый раз скачивает полный набор баз заново.

## Unbound — рекурсивный DNSSEC-резолвер

Собственный образ (`docker/unbound/`, `FROM debian:trixie-slim`). Архитектурное решение и
альтернативы см. в `docs/adr/0017-unbound-resolver.md` (BIND9/dnsmasq/публичный резолвер были
отклонены); здесь — только эксплуатационные детали образа.

### Три роли резолвера (см. также `docs/adr/0017-unbound-resolver.md`)

1. **DNSBL/RBL** — Rspamd (модуль RBL) и Postfix `postscreen` делают DNSBL-запросы синхронно на
   каждое соединение; провайдеры (Spamhaus и др.) ограничивают/блокируют запросы с публичных
   резолверов, поэтому `unbound` **никогда не форвардит** — только полная рекурсия от себя
   (`root-hints`, без `forward-zone`, без LAN-адресов резолверов и без `domain-insecure` для
   `.local`/`.mgate`). Приватные зоны оператор подключает сам, см. «Расширение конфигурации» ниже.
2. **DNSSEC** — `qname-minimisation`, `harden-dnssec-stripped`, `harden-algo-downgrade` включены;
   `auto-trust-anchor-file` поддерживает актуальность корневого ключа через RFC 5011 после
   старта. Проверено вручную (см. "Верификация" ниже) — ответ содержит флаг `ad` при DNSSEC-
   валидном домене.
3. **DANE/TLSA** (задел на будущее) — исходящая почта Postfix с `smtp_tls_security_level = dane`
   (TODO(S1)) не имеет смысла без DNSSEC-валидированного резолвера; эта
   инфраструктурная предпосылка уже закрыта.

### Рендеринг конфигурации и bootstrap доверенного якоря

`unbound.conf.template` — статичный шаблон; `docker-entrypoint.sh` подставляет через `envsubst`
только `$MGATE_BACKEND_SUBNET` (allow-лист `access-control`, дефолт `172.30.1.0/24`) и `$LOG_LEVEL`
в `/var/lib/unbound/unbound.conf`, затем запускает `unbound -d -c ...` от непривилегированного
пользователя `unbound` (пакетный, создаётся Debian-пакетом `unbound`).

Доверенный корневой якорь **не** качается с IANA при каждом старте контейнера
(`unbound-anchor -a ...` потребовал бы сети до интернета ещё до готовности резолвера) — вместо
этого используется сид из пакета `dns-root-data` (`/usr/share/dns/root.key`, актуализируется
обычными security-апдейтами Debian), копируемый в `/var/lib/unbound/root.key` при первом старте;
далее сам Unbound поддерживает его через RFC 5011. `unbound-anchor` всё равно установлен в образе
для ручной ре-инициализации оператором при необходимости.

TODO(S1): в `docker-compose.yml` нет отдельного volume для `unbound` — состояние в
`/var/lib/unbound` живёт в writable-слое контейнера и пересоздаётся из сида при каждом пересоздании
контейнера (безопасно, но RFC 5011-ролловер между пересозданиями не сохраняется). Завести
`unbound-data:/var/lib/unbound`, если это станет проблемой на практике.

### Сеть, порт, привилегии

Подключение к обеим сетям (`public` — для рекурсии наружу, `backend` — статический IP
`${MGATE_RESOLVER_IP:-172.30.1.53}`, см. `docs/ARCHITECTURE.md` §3). Порт 53 UDP+TCP — не публикуется
на хост. Контейнер запускается **не от root** (`USER unbound` в Dockerfile); для бинда порта 53
непривилегированным пользователем сервису в compose нужен `cap_add: [NET_BIND_SERVICE]`.

### Расширение конфигурации: приватные зоны

Образ ничего не знает о вашей внутренней сети и никогда не форвардит запросы сам. Если почтовому
стеку нужно резолвить приватную зону (корпоративный `.local`, split-horizon, внутренний DNS
компании), добавьте свои клаузы (`forward-zone`, `stub-zone`, `local-zone`, `domain-insecure`)
отдельными `*.conf`-файлами и смонтируйте их в `/etc/unbound/conf.d/` контейнера `unbound`:
последняя строка шаблона — `include-toplevel: "/etc/unbound/conf.d/*.conf"`. Пустой каталог
допустим (ни одного файла — образ стартует как обычно). Пример и нюансы — в
`docker/unbound/README.md`.

### Healthcheck

`healthcheck.sh` — `drill -p 53 @127.0.0.1 . NS` (запрос корневых NS: заставляет резолвер пройти
весь путь резолвинга без завязки на конкретный внешний домен). `HEALTHCHECK` в Dockerfile:
интервал 30s, `start-period` 15s, 3 попытки.

### Верификация

```sh
# Собирается из корня репозитория (COPY docker/unbound/... внутри Dockerfile ссылается
# на путь относительно контекста сборки — контекст НЕ docker/unbound/, а корень репо):
docker build -f docker/unbound/Dockerfile -t mgate-check/unbound .
# рендеринг + unbound-checkconf
docker run --rm --entrypoint /bin/sh mgate-check/unbound -c \
  'MGATE_BACKEND_SUBNET=172.30.1.0/24 /usr/local/bin/docker-entrypoint.sh true; \
   unbound-checkconf /var/lib/unbound/unbound.conf'
# -> "unbound-checkconf: no errors in /var/lib/unbound/unbound.conf"

docker run -d --name check-unbound --network <любая> mgate-check/unbound
docker exec check-unbound drill -p 53 @127.0.0.1 -D cloudflare.com A
# -> flags: qr rd ra ad ; ANSWER SECTION включает RRSIG -- DNSSEC-валидация подтверждена
docker exec check-unbound /usr/local/bin/healthcheck.sh; echo $?    # -> 0
```
