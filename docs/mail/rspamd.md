# Rspamd — антиспам, DKIM/ARC, антивирусная интеграция

Образ: `docker/rspamd/` (`FROM rspamd/rspamd:4.1.5`, тег проверен на Docker Hub 12.09.2026 —
репозиторий `rspamd/rspamd` уже содержит ветку `4.x`; здесь пин точной
патч-версии для воспроизводимой сборки). Конфигурация — только `local.d/`/`override.d/`
(мягкие/жёсткие оверрайды поверх стокового `/etc/rspamd/*.conf`, сам `rspamd.conf` не трогается,
поэтому апстримные security-фиксы в стоковых файлах продолжают применяться при пересборке образа).

## Что изменилось в Rspamd 4.x и почему это важно для конфигурации

- **Новый движок шаблонов конфигурации** (Jinja2-совместимый, библиотека Lupa) — заменяет/
  дополняет старую подстановку `$VARIABLE` в UCL. Синтаксис: `{= выражение =}` — вывод значения,
  `{% ... %}` — управляющие конструкции (`if`/`endif`), `{# ... #}` — комментарий шаблонизатора
  (не путать с `##` — обычным комментарием UCL). **Важно**: любой текст файла, включая обычные
  UCL-комментарии, проходит через препроцессор шаблонов раньше парсера UCL — если в комментарии
  случайно встретится подстрока вида `` `{= что-то =}` ``, шаблонизатор попытается её вычислить и
  конфиг не пройдёт `rspamadm configtest` с ошибкой вида `'<name>' expected near '*'`. Это реальная
  ошибка, пойманная при валидации этого образа (см. `docker/rspamd/local.d/metadata_exporter.conf`,
  git-история) — при написании комментариев, поясняющих сам механизм шаблонов, никогда не
  используйте фигурные скобки `{= =}`/`{% %}` буквально, только словами.
- **Переменные окружения**: при старте Rspamd сканирует ОС-окружение процесса и собирает
  переменные с префиксом `RSPAMD_` в таблицу `env` (префикс отбрасывается) — `RSPAMD_REDIS_HOST=x`
  становится доступен в конфиге как `{= env.REDIS_HOST =}`. Переменные **без** префикса `RSPAMD_`
  недоступны шаблонам вообще — это осознанный фильтр от случайной утечки посторонних переменных
  (`PATH`, `HOME` и т.п.) в конфигурацию. Отсюда вся таблица переменных, которые
  `docker-compose.yml` должен передать сервису `rspamd` (см. ниже "Переменные окружения").
- **`local.d/<module>.conf` мёржится ВНУТРЬ секции модуля с тем же именем** (например,
  содержимое `local.d/actions.conf` подставляется внутрь уже существующей `actions { ... }`,
  `local.d/metadata_exporter.conf` — внутрь `metadata_exporter { ... }`) — оборачивать содержимое
  этих файлов ещё раз в `actions { }`/`metadata_exporter { }` **нельзя**, `rspamadm configtest`
  падает с "nested section" (тоже поймано при валидации, см. `actions.conf`,
  `metadata_exporter.conf`, `override.d/neural.conf`). Файлы `options.inc`, `worker-*.inc`,
  `dkim_signing.conf`, `arc.conf`, `antivirus.conf`, `classifier-bayes.conf`, `multimap.conf`,
  `milter_headers.conf`, `greylist.conf`, `history_redis.conf`, `redis.conf`, `logging.inc`
  устроены так же — везде плоские ключи без повторной обёртки именем файла/модуля.
- **Token bucket по умолчанию** для распределения нагрузки между upstream-серверами
  `rspamd_proxy` (вместо round-robin в 3.x) — нас не касается напрямую, т.к. используется
  self-scan (один узел, см. ниже), но важно при переходе на proxy-режим (TODO(S8)).

## Воркеры

| Воркер | Порт | Режим | Файл |
|---|---|---|---|
| `rspamd_proxy` | 11332 | Milter, **self-scan** (один узел сканирует сам, без отдельного слоя scan-воркеров) | `local.d/worker-proxy.inc` |
| normal | 11333 | HTTP, не на горячем пути в self-scan, но включён для `rspamc`/диагностики | `local.d/worker-normal.inc` |
| controller | 11334 | Web UI + управляющий HTTP API, пароль обязателен | `local.d/worker-controller.inc` |

Postfix обращается к Rspamd **только** через milter на 11332 (`smtpd_milters =
inet:rspamd:11332`, см. `docker/postfix`). TODO(S8): переход на
"proxy mode" (несколько normal-воркеров за прокси с балансировкой token bucket) описан
как TODO прямо в `worker-proxy.inc` — self-scan достаточен для одного инстанса MGate.

## Переменные окружения (передаются сервису `rspamd`)

Все указаны с префиксом `RSPAMD_`, как того требует шаблонизатор (см. выше) — это **не** те же
имена, что `MGATE_*` в `docs/CONFIGURATION.md`, их нужно смаппить в environment-секции сервиса
`rspamd` в `docker-compose.yml`:

```yaml
environment:
  RSPAMD_CONTROLLER_PASSWORD: "${RSPAMD_CONTROLLER_PASSWORD}"   # уже с нужным префиксом
  RSPAMD_INTERNAL_TOKEN: "${MGATE_INTERNAL_TOKEN}"               # бирер-токен для metadata_exporter
  RSPAMD_REDIS_HOST: "valkey"
  RSPAMD_REDIS_PASSWORD: "${VALKEY_PASSWORD}"
  RSPAMD_REDIS_DB: "1"                                           # опционально, дефолт уже 1
  RSPAMD_CLAMAV_SERVERS: "clamav:3310"                           # опционально, это и есть дефолт
  RSPAMD_MESSAGE_SIZE_LIMIT: "${MGATE_MESSAGE_SIZE_LIMIT}"
  RSPAMD_EVENTS_URL: "http://api:8081/internal/v1/events/rspamd" # опционально, это и есть дефолт
  RSPAMD_LOCAL_ADDRS: "${MGATE_BACKEND_SUBNET}"                  # опционально
  RSPAMD_LOG_LEVEL: "notice"                                     # опционально
```
`RSPAMD_CONTROLLER_PASSWORD` и `RSPAMD_INTERNAL_TOKEN` **обязательны** — без них
`rspamadm configtest` падает намеренно (см. `worker-controller.inc`/`metadata_exporter.conf`):
конфиг без пароля контроллера или без bearer-токена для событий — это конфигурационная ошибка,
а не что-то, что можно молча пропустить с небезопасным дефолтом.

## DKIM/ARC: ключи только в Valkey, никогда на диске

`local.d/dkim_signing.conf` и `local.d/arc.conf` используют `use_redis = true` с **одними и теми
же** именами хэшей (сознательное упрощение — один ключ на домен обслуживает и DKIM-подпись,
и ARC-печать):

- `key_prefix = "DKIM_KEYS"` — хэш `HSET DKIM_KEYS "<selector>.<domain>" "<PEM-приватный ключ>"`
- `selector_prefix = "DKIM_SELECTORS"` — хэш `HSET DKIM_SELECTORS "<domain>" "<selector>"`

Это **стабильный контракт между бэкендом и образом rspamd** — бэкенд (генерация/публикация
DKIM-ключей) должен писать именно эти два имени хэшей в
Valkey db 1 (`redis://valkey:6379/1`, тот же коннекшн, что в `local.d/redis.conf`) при создании
домена / ротации ключа. Формат значения приватного ключа — то же, что выдаёт `rspamadm
dkim_keygen` (PEM `PRIVATE KEY`, для RSA; допустим и Ed25519, тип ключа Rspamd определяет
автоматически по содержимому PEM).

`allow_username_mismatch = true` — почтовые ящики MGate могут отправлять от лица адреса,
отличного от их собственного логина (например, служебный ящик от имени рассылки), поэтому
проверка "SASL-логин == домен подписи" на стороне DKIM-модуля ослаблена. `v_postfix_sender_login`
на уровне Postfix (`reject_sender_login_mismatch`, см. `docs/mail/postfix.md`) проверяет только
SMTP envelope `MAIL FROM` против разрешённых логинов — она НЕ проверяет заголовок RFC5322 `From`,
по которому DKIM выбирает домен подписи. Поэтому `allow_username_mismatch = true` фактически НЕ
защищён этой проверкой от подмены заголовка `From` в пределах доменов, на которые у логина есть
право envelope-from: DKIM здесь подписывает письмо доменным ключом того домена, что указан в
заголовке `From`, независимо от того, что реально проверил Postfix на уровне envelope. Если
изоляция между почтовыми ящиками одного домена важна, следует дополнительно ограничивать
заголовок `From` на уровне политики письма (например, policy-сервисом бэкенда), а не полагаться на
`v_postfix_sender_login`.

## Антивирус (ClamAV)

`local.d/antivirus.conf` — правило `clamav { servers = "clamav:3310"; ... }`. Деградация при
выключенном профиле `clamav` (профиль `clamav`, см. `docs/ARCHITECTURE.md` §2.1) — **мягкая**: недоступность
DNS-имени/порта даёт символ `CLAM_VIRUS_FAIL` (нейтральный скор по умолчанию), а не жёсткий отказ
проверки письма целиком. См. `docs/mail/antivirus-dns.md` для деталей самого ClamAV.

## Redis/Valkey — общий бэкенд (db 1)

`local.d/redis.conf` — один коннекшн для ВСЕХ модулей, которые умеют работать с Redis: Bayes
(`classifier-bayes.conf`), greylisting (`greylist.conf`), DKIM/ARC-ключи, multimap-списки,
`history_redis.conf` (история Web UI), DMARC-репортинг (пока выключен, см. ниже). db 0 в той же
Valkey — территория бэкенда `mgate` (см. `docs/ARCHITECTURE.md` §2), db 1 — целиком Rspamd.

### Multimap — админские allow/deny-списки (управляются `mgate`, не файлами)

`local.d/multimap.conf` — пять правил на Redis-картах (`map = "redis://<hashkey>"`, member
хэша = `HSET <hashkey> <значение> 1`, см. https://docs.rspamd.com/modules/multimap/). Точные
имена хэшей — тоже стабильный контракт для админ-панели (`web/apps/spa`, раздел "Security",
TODO(S4)) и бэкенда:

| Хэш в Valkey (db 1) | Что проверяется | Действие при совпадении |
|---|---|---|
| `rspamd:mm:senders:allow` | envelope-from | `accept` (prefilter) |
| `rspamd:mm:senders:deny` | envelope-from | `reject` (prefilter) |
| `rspamd:mm:rcpt:deny` | envelope-to | `reject` (prefilter) |
| `rspamd:mm:ip:allow` | IP отправителя | `accept` (prefilter) |
| `rspamd:mm:ip:deny` | IP отправителя (CIDR как member хэша) | `reject` (prefilter) |

TODO(S2): админ-API обязан гарантировать взаимоисключение allow/deny для одного и того же
адреса/IP — Rspamd не даёт строгой гарантии, какое из двух prefilter-правил "выиграет", если оба
совпали для одного письма (см. комментарий в `multimap.conf`).

### Bayes (байесовский классификатор)

`local.d/classifier-bayes.conf` — backend `redis`, `new_schema = true` (актуальная схема данных),
autolearn-пороги (`spam_threshold = 6.0`, `ham_threshold = -0.5`, `check_balance = true`).
"Пометить как спам/не спам" в вебмейле должно вызывать `rspamc learn_spam`/
`learn_ham` через контроллер (11334, тот же пароль `RSPAMD_CONTROLLER_PASSWORD`) — TODO(S1)/(S5).

## Пороги действий (`local.d/actions.conf`)

```
reject = 15;      # финальный отказ (SMTP 5xx через milter)
add_header = 6;    # проставить заголовки спама, письмо доставляется
greylist = 4;      # triggers "soft reject" (временный 4xx, см. greylist.conf)
```
Намеренно консервативные дефолты — пересмотр после тестов доставляемости
(`docs/TESTING.md`, mail-tester.com 10/10).

## Заголовки для Dovecot Sieve и вебмейла (`local.d/milter_headers.conf`)

`extended_spam_headers = true` (добавляет `X-Spamd-Result`, `X-Rspamd-Server`,
`X-Rspamd-Queue-Id`, `X-Rspamd-Action`) + `use = ["authentication-results", "x-spamd-bar"]`.
`Authentication-Results` — источник индикатора SPF/DKIM/DMARC во входящем письме для вебмейла
(шлюз `webmail` парсит этот заголовок); `X-Spamd-Result`/`X-Spam` — то, на что должен смотреть
`sieve_before`-скрипт Dovecot при раскладывании спама в Junk (`docker/dovecot`).

Доверие к `Authentication-Results` устроено так:

- **authserv-id** заголовка Rspamd берёт из milter-макроса Postfix `{daemon_name}`. На порту 25 и
  для почты, созданной самим Postfix, это `$myhostname` = `MGATE_HOSTNAME`
  (`milter_macro_daemon_name` в `main.cf`); на портах отправки 587/465/2587 — `ORIGINATING`.
  Шлюз веб-почты показывает результат проверки только из **самого верхнего**
  `Authentication-Results`, и только если его authserv-id равен `MGATE_HOSTNAME`.
- `local_headers = ["authentication-results"]`: заголовок ставится и для клиентов из
  `local_addrs` (`options.inc`). Иначе стоковое `skip_local = true` пропускает его для «локальных»
  адресов, а за rootless Docker или NAT балансировщика локальным выглядит любое входящее
  соединение. Добавляя свой заголовок, Rspamd удаляет все уже имеющиеся
  `Authentication-Results` (стоковое `remove = 0` у этого заголовка).
- Если Rspamd письмо не проверил (недоступен, а порт 25 работает с
  `milter_default_action = accept`), чужой заголовок с нашим authserv-id обычно не дойдёт до
  ящика: Postfix удаляет такие заголовки ещё до milter (`header_checks`, см.
  [`postfix.md`](postfix.md) §6). Заголовки, добавленные milter, `header_checks` не
  обрабатывает, поэтому заголовок Rspamd сохраняется. Правило Postfix совпадает не со всеми
  формами записи заголовка (например, не пересекает `;` внутри комментария перед authserv-id),
  поэтому на него одного положиться нельзя: от показа подделки как проверенной защищает
  требование служебного заголовка Rspamd (`X-Rspamd-Queue-Id` или `X-Rspamd-Server`, Postfix
  удаляет такие заголовки из входящих писем, а добавляет их только milter). Дополнительно шлюз
  принимает только authserv-id без ведущего комментария: Rspamd комментарий там не пишет.

## События в бэкенд (`local.d/metadata_exporter.conf`)

Стоковый backend `http` не умеет добавлять произвольные заголовки (только HTTP Basic через
`user`/`password`), а внутренний API требует `Authorization: Bearer ${MGATE_INTERNAL_TOKEN}` на каждый
`/internal/v1/*`-вызов (см. `docs/ARCHITECTURE.md` §3) — поэтому зарегистрирован небольшой кастомный
Lua-пушер (`custom_push`), напрямую вызывающий `rspamd_http.request` с нужным заголовком. Отправляет
JSON-вердикт **каждого** проверенного письма (`selector = "default"`) на
`POST http://api:8081/internal/v1/events/rspamd` — источник для Live Logs и статистики
(`worker`, таблица `mail_events`).

## DMARC-репортинг — сознательно выключен

`local.d/dmarc.conf` — политика (`reject`/`quarantine`/`softfail`) активна сразу, а вот отправка
агрегированных rua/ruf-отчётов другим доменам (`reporting { enabled = ... }`) выключена: нужен
отдельный путь исходящей почты, который **не проходит через сам Rspamd** (иначе отчётное письмо
само попадёт на проверку и может зациклиться/быть отклонено), плюс знание primary-домена
инсталляции. TODO(S1): включить, когда у Postfix появится transport, обходящий Rspamd для этого
класса писем.

## Что намеренно выключено (проверено/пересмотрено)

- **Neural network module** (`override.d/neural.conf`, `enabled = false`) — выключен и апстримом
  по умолчанию, но зафиксирован явно в `override.d/` (выигрывает у любой будущей правки в
  `local.d/`), т.к. модулю нужна обученная модель и заметный объём почтовой истории, чтобы быть
  полезным — не имеет смысла на свежей инсталляции.
- **Fuzzy check** — оставлен как есть (стоковый дефолт апстрима, публичные fuzzy-хранилища
  rspamd.com включены "из коробки") — осмысленный стандартный источник сигнала, отдельно
  переопределять не нужно.

## Верификация

```sh
# Собирается из корня репозитория (COPY docker/rspamd/... внутри Dockerfile ссылается
# на путь относительно контекста сборки — контекст НЕ docker/rspamd/, а корень репо):
docker build -f docker/rspamd/Dockerfile -t mgate-check/rspamd .
docker run --rm \
  -e RSPAMD_CONTROLLER_PASSWORD=... -e RSPAMD_INTERNAL_TOKEN=... \
  -e RSPAMD_REDIS_HOST=valkey -e RSPAMD_REDIS_PASSWORD=... \
  -e RSPAMD_MESSAGE_SIZE_LIMIT=52428800 -e RSPAMD_CLAMAV_SERVERS=clamav:3310 \
  mgate-check/rspamd rspamadm configtest        # -> syntax OK
docker run --rm ... mgate-check/rspamd rspamadm configdump dkim_signing
```
`configdump dkim_signing` подтверждает `use_redis = true; key_prefix = "DKIM_KEYS"; selector_prefix
= "DKIM_SELECTORS"; allow_username_mismatch = true;` — именно то, что задокументировано выше.
