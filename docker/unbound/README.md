# docker/unbound — рекурсивный DNSSEC-резолвер

Собственный образ (`FROM debian:trixie-slim`, тег совпадает с остальными образами проекта).
Устанавливается пакетами Debian trixie (проверено
`apt-cache policy` 12.09.2026): `unbound 1.22.0-2+deb13u3`, `unbound-anchor`, `dns-root-data`
(корневые hints + сид доверенного якоря), `ldnsutils` (`drill`), `gettext-base` (`envsubst`).

## Зачем свой резолвер, а не forwarding на публичный DNS

Каждый почтовый контейнер (`postfix`, `dovecot`, `rspamd`, `api`/`worker`) резолвит внешние имена
через `dns: [${MGATE_RESOLVER_IP:-172.30.1.53}]` (встроенный DNS Docker резолвит служебные имена
compose и форвардит остальное на `unbound`). `unbound` рекурсивен и **не**
форвардит на публичные резолверы принципиально: правила использования DNSBL/RBL-зон (Spamhaus и
аналогичные, их использует модуль RBL в Rspamd) прямо запрещают резолвинг через общие/публичные
форвардеры — они привязывают лимиты и репутацию к исходному IP резолвера. Рекурсия "от себя" плюс
собственная DNSSEC-валидация (`harden-dnssec-stripped`, `qname-minimisation`) также означают, что
mgate не обязан доверять чужому AD-биту.

## Рендеринг конфигурации при старте

`unbound.conf.template` — статичный шаблон, `docker-entrypoint.sh` подставляет через `envsubst`
только `$MGATE_BACKEND_SUBNET` (дефолт `172.30.1.0/24`) и `$LOG_LEVEL`
(дефолт `1`) в готовый `/var/lib/unbound/unbound.conf`, затем запускает `unbound -d -c ...`.
Синтаксис после рендеринга проверяется `unbound-checkconf`.

В `docker-compose.yml` сервису `unbound` передаётся:
```yaml
environment:
  MGATE_BACKEND_SUBNET: "${MGATE_BACKEND_SUBNET:-172.30.1.0/24}"
  LOG_LEVEL: "1"          # 0=тихо, 1=обычно, 2+=отладка (см. unbound.conf(5) verbosity)
networks:
  backend:
    ipv4_address: "${MGATE_RESOLVER_IP:-172.30.1.53}"   # статический IP
cap_add:
  - NET_BIND_SERVICE   # порт 53 в непривилегированном контейнере (USER unbound)
```

## DNSSEC trust anchor

Вместо обращения к IANA через `unbound-anchor -a ...` при каждом старте контейнера (требует сеть
до интернета ещё до того, как резолвер поднялся), сид якоря берётся из пакета `dns-root-data`
(`/usr/share/dns/root.key`) — тот же корневой ключ, обновляется обычными security-апдейтами
Debian. `docker-entrypoint.sh` копирует его в `/var/lib/unbound/root.key` только если файла там ещё
нет; дальше сам Unbound поддерживает его актуальность через RFC 5011 (auto-trust-anchor-file).
`unbound-anchor` всё равно установлен в образе — для ручной ре-инициализации оператором
(`docker exec ... unbound-anchor -a /var/lib/unbound/root.key`), если якорь когда-либо испортится.

`docker-compose.yml` монтирует volume `unbound-data` в `/var/lib/unbound`, поэтому сид копируется
один раз за время жизни тома, а состояние, обновлённое через RFC 5011, переживает пересоздание
контейнера. Без тома `/var/lib/unbound/root.key` живёт в writable-слое контейнера и пересоздаётся
из сида при каждом пересоздании — это безопасно (сид всегда валиден), но ролловер ключа между
пересозданиями не сохраняется.

## Healthcheck и проверка руками

`healthcheck.sh` делает `drill -p 53 @127.0.0.1 . NS` — запрос корневых NS заставляет резолвер
пройти полный путь (root hints → итерация → ответ), не завязываясь на конкретный внешний домен.
Проверить DNSSEC вручную (флаг `ad` появляется только если клиент передал `-D`/`+dnssec`, это
поведение самого Unbound, не баг):
```sh
docker exec <контейнер> drill -p 53 @127.0.0.1 -D cloudflare.com A
```
При корректной работе в ответе есть флаг `ad` и `RRSIG` в ANSWER SECTION.

## Расширение конфигурации: `/etc/unbound/conf.d`

Образ намеренно не содержит ничего специфичного для конкретной инсталляции: ни `forward-zone`,
ни `domain-insecure`, ни адресов внутренних резолверов. Если нужно, например, отправлять запросы
для приватной зоны (`corp.example`, split-horizon DNS) на внутренний резолвер, положите свои
`*.conf` в каталог `/etc/unbound/conf.d` внутри контейнера. Последняя строка шаблона —
`include-toplevel: "/etc/unbound/conf.d/*.conf"`, поэтому подключаются все файлы с расширением
`.conf` (в алфавитном порядке); пустой каталог (ни одного совпадения) — штатная ситуация, резолвер
стартует как обычно. Каждый файл начинается на верхнем уровне конфигурации, т.е. может содержать
собственные клаузы `server:`, `forward-zone:`, `stub-zone:` и т.д.

Пример `./unbound.d/10-private-zone.conf` (адреса — примеры из RFC 1918 / RFC 5737, подставьте
свои):
```
# Приватная зона, которую знает только внутренний резолвер 10.0.0.53.
forward-zone:
    name: "corp.example."
    forward-addr: 10.0.0.53

# Внутренняя зона не подписана DNSSEC — без этого валидатор вернёт SERVFAIL.
server:
    domain-insecure: "corp.example"
```

Подключение в compose — через `docker-compose.override.yml` в корне репозитория (файл не входит в
поставку, создайте его сами):
```yaml
services:
  unbound:
    volumes:
      - ./unbound.d:/etc/unbound/conf.d:ro
```
Корневой `Makefile` вызывает `docker compose -f docker-compose.yml …` и сам добавляет
`-f docker-compose.override.yml`, если файл существует, поэтому `make up`/`make restart` его учитывают.
Если вы запускаете `docker compose` вручную с явными `-f`, укажите файл явно:
`docker compose -f docker-compose.yml -f docker-compose.override.yml up -d`.

Для приватной обратной зоны (например, `10.in-addr.arpa`) одного `forward-zone` недостаточно:
Unbound по умолчанию отвечает на такие запросы NXDOMAIN из встроенных локальных зон. Добавьте в тот же
файл `server:` с `local-zone: "10.in-addr.arpa." transparent` и отдельный `forward-zone` для этой зоны.

Расширение через `conf.d` поддерживается только в docker compose; Helm-чарт пока не предоставляет
способа смонтировать этот каталог.
Файлы должны быть читаемы пользователем `unbound` (достаточно прав `0644`). Конфигурация
перечитывается при старте контейнера: после изменений выполните `docker compose restart unbound`.
Проверить результат можно командой
`docker compose exec unbound unbound-checkconf /var/lib/unbound/unbound.conf`.

Внимание: `forward-zone` для публичных зон (`.` или реальных доменов) ломает исходную идею
образа — DNSBL-провайдеры не обслуживают запросы через общие форвардеры, а AD-бит чужого
резолвера не заменяет собственную DNSSEC-валидацию. Используйте расширение только для приватных
зон.

## Почему не используется `unbound.conf.d` из пакета Debian

Пакет `unbound` кладёт свои сниппеты (в том числе `root-auto-trust-anchor-file.conf`) в
`/etc/unbound/unbound.conf.d/`, но наш рендеренный `unbound.conf` не подключает эту директорию —
конфигурация образа самодостаточна. Поэтому файл `root-auto-trust-anchor-file.conf` удалён на этапе
сборки, чтобы не вводить в заблуждение при чтении образа. Каталог расширения оператора — другой:
`/etc/unbound/conf.d`.
