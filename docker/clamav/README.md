# docker/clamav — конфигурация официального образа

Сервис `clamav` в docker-compose (профиль `clamav`) использует
**официальный** образ `clamav/clamav:1.5.4-debian13-slim` без собственной сборки — этот каталог
не содержит `Dockerfile`, только справочные материалы для секции `environment:`/`healthcheck:`
сервиса `clamav` в `docker-compose.yml` (здесь фиксируются точные имена переменных и их значения).

Версия проверена на Docker Hub 12.09.2026: репозиторий `clamav/clamav` содержит теги
`1.5`, `1.5.4`, `1.5.4-debian13-slim` и т.д. (на момент проверки доступна `1.5` — используем
актуальный minor). Вариант `-debian13-slim` собран на
`debian:trixie-slim` (совпадает с базой остальных образов проекта) и заметно меньше alpine-варианта
без потери функциональности.

## Как официальный образ применяет переменные окружения

Проверено запуском контейнера (`docker run ... clamav/clamav:1.5.4-debian13-slim cat
/etc/clamav/clamd.conf`, ): entrypoint образа (`/init`) при каждом старте проходит
по `env | grep '^CLAMD_CONF_'` и `env | grep '^FRESHCLAM_CONF_'` и патчит соответствующие строки в
`/etc/clamav/clamd.conf` / `/etc/clamav/freshclam.conf` **до** запуска демонов и до первой загрузки
базы сигнатур. Формат: `CLAMD_CONF_<Directive>=<value>` → строка `<Directive> <value>` в
`clamd.conf` (аналогично `FRESHCLAM_CONF_*` → `freshclam.conf`). Директивы, для которых нет
`CLAMD_CONF_*`, остаются как в образе — там уже по умолчанию включены `TCPSocket 3310` и
`TCPAddr 0.0.0.0` (проверено), поэтому Rspamd (`docker/rspamd/local.d/antivirus.conf`,
`servers = "clamav:3310"`) подключается без дополнительной настройки.

## Переменные сервиса `clamav` в `docker-compose.yml`

```yaml
environment:
  # Размер сообщения должен совпадать с MGATE_MESSAGE_SIZE_LIMIT (52428800 байт = 50M).
  # TODO(S1): если MGATE_MESSAGE_SIZE_LIMIT меняется в .env, эти три значения нужно
  # пересчитать вручную (единицы ClamAV — "M"/"G", не байты) -- либо сгенерировать их
  # из entrypoint на старте контейнера вместо статичного compose-файла.
  CLAMD_CONF_StreamMaxLength: "50M"
  CLAMD_CONF_MaxFileSize: "50M"
  # Суммарный объём после распаковки архивов — держим с запасом (2-4x StreamMaxLength).
  CLAMD_CONF_MaxScanSize: "150M"
  CLAMD_CONF_MaxThreads: "4"       # см. "Память" ниже
  CLAMD_CONF_LogTime: "yes"
  CLAMD_CONF_LogVerbose: "no"
  FRESHCLAM_CONF_Checks: "12"      # обновление баз каждые ~2ч вместо дефолтных 24/сутки
  CLAMAV_NO_MILTERD: "true"        # Rspamd говорит с clamd напрямую по INSTREAM (порт 3310),
                                    # clamav-milter (порт 7357) не используется
  TZ: "${TZ:-UTC}"
```

Volume `clamav-db` (`/var/lib/clamav`) обязателен для персистентности базы
сигнатур между рестартами контейнера — без него `freshclam` каждый раз скачивает полный набор
баз заново (см. README образа, раздел "Persisting the virus database").

## Healthcheck

Образ уже содержит собственный `HEALTHCHECK --start-period=6m CMD clamdcheck.sh` (проверено
`docker pull`/inspect образа) — отдельный healthcheck переопределять не нужно, только учитывать
длинный `start-period` (первая загрузка базы сигнатур занимает минуты) при выставлении
`depends_on: condition: service_healthy` для `rspamd`/`postfix`.

## Память

Официальный образ рекомендует ~1.5–2 ГБ RAM на инстанс clamd (база сигнатур + рабочие потоки).
`MaxThreads: 4` выбран консервативно для этого бюджета; рекомендация для `mem_limit` сервиса `clamav`
в compose: `2g`.

## Отключение (профиль `clamav` выключен)

Если профиль `clamav` не активирован, сервис не поднимается — `docker/rspamd/local.d/antivirus.conf`
рассчитан на этот случай: недоступность DNS-имени/порта `clamav:3310` даёт `CLAM_VIRUS_FAIL`
(нейтральный по умолчанию скор) вместо падения проверки почты целиком (см.
`docs/mail/antivirus-dns.md`).
