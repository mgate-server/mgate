# All-in-one образ MGate (AIO)

Единый Docker-образ MGate, объединяющий все компоненты почтового сервера в одном контейнере под управлением супервизора процессов **s6-overlay v3**.

Образ предназначен для быстрого ознакомления, тестирования, окружений без `docker compose` (PaaS/VPS провайдеры с запуском одиночных контейнеров) и компактных однонодовых инсталляций.

---

## 1. Архитектура процессов и s6-overlay

Супервизор процессов **s6-overlay** обеспечивает:
* Четкую очередность и граф зависимостей инициализации (`s6-rc`).
* Изоляцию привилегий (`s6-setuidgid` для каждого демона: `postfix`, `vmail`, `_rspamd`, `postgres`).
* Корректную передачу сигналов (graceful shutdown с отправкой SIGTERM и ожиданием завершения активных сессий при `docker stop`).
* Ротацию и сбор логов stdout/stderr.

### Граф запуска сервисов (`s6-rc` dependency tree):
```
1. base-init (инициализация каталогов и прав на /var/lib/mgate-aio)
   │
   ├──> postgres & valkey (локальные СУБД и кэш)
   │     │
   │     └──> mgate-migrate (oneshot: накат SQL-миграций)
   │           │
   │           ├──> роли бэкенда mgate (api, webmail, worker)
   │           │     │
   │           │     └──> dovecot & postfix (авторизация через API passdb)
   │           │
   ├──> unbound (локальный кэширующий DNSSEC-резолвер)
   │     │
   │     └──> rspamd (+ опциональный clamav)
   │
   └──> traefik / edge-proxy (приём внешнего HTTP/HTTPS и маршрутизация)
```

---

## 2. Раскладка данных (Data Layout)

Все персистентные данные инсталляции изолированы в едином корневом каталоге данных монтирования: `/var/lib/mgate-aio`.

При монтировании единого тома `docker run -v mgate_aio_data:/var/lib/mgate-aio`:

```
/var/lib/mgate-aio/
├── postgres/          # Файлы БД PostgreSQL (PGDATA, права 0700 postgres:postgres)
├── valkey/            # Снимки RDB и AOF-журналы Valkey (права 0700 valkey:valkey)
├── vmail/             # Почтовые ящики пользователей в формате Maildir (права 0700 vmail:vmail)
│   └── domain.com/
│       └── user/
│           ├── cur/
│           ├── new/
│           ├── tmp/
│           └── dovecot.index
├── certs/             # TLS-сертификаты ACME Let's Encrypt / ZeroSSL (права 0750 mgate:mgate)
│   ├── live/
│   └── default/
├── dkim/              # Сгенерированные приватные ключи DKIM (права 0700 _rspamd:_rspamd)
└── rspamd/            # Локальные базы и кэши Rspamd (байес, токены)
```

---

## 3. Рекомендации по ресурсам (Sizing Guidance)

| Профиль | Ресурсы (vCPU / RAM) | ClamAV (`MGATE_AIO_CLAMAV`) | Вместимость | Сценарий использования |
|---|---|---|---|---|
| **Minimal** | 2 vCPU / 4 GB | Отключен (`0`) | до 50 ящиков | Домашний сервер, dev/stage, тестовая среда |
| **Reference** | **4 vCPU / 8 GB** | **Включен (`1`)** | **до 1 000 ящиков** | **Стандартный коммерческий VPS/сервер** |
| **High Load** | 8 vCPU / 16 GB | Включен (`1`) | до 5 000 ящиков | Активная корпоративная почта, большие рассылки |

> **Внимание по памяти**: ClamAV при старте загружает базы антивирусных сигнатур объёмом ~1.5 GB. На серверах с памятью 4 GB рекомендуется отключать встроенный ClamAV (`-e MGATE_AIO_CLAMAV=0`).

---

## 4. Запуск контейнера

```sh
docker run -d \
  --name mgate-aio \
  --restart unless-stopped \
  -p 25:25 \
  -p 80:80 \
  -p 443:443 \
  -p 465:465 \
  -p 587:587 \
  -p 993:993 \
  -p 995:995 \
  -p 4190:4190 \
  -v mgate_aio_data:/var/lib/mgate-aio \
  -e MGATE_HOSTNAME=mail.example.com \
  -e MGATE_ADMIN_EMAIL=admin@example.com \
  -e MGATE_ADMIN_PASSWORD=<generate with scripts/gen-secrets.sh> \
  -e MGATE_SECRET_KEY=<generate with scripts/gen-secrets.sh> \
  -e MGATE_INTERNAL_TOKEN=<generate with scripts/gen-secrets.sh> \
  -e MGATE_AIO_CLAMAV=1 \
  mgate/aio:dev   # локальная сборка: make image-aio (образ не публикуется)
```

---

## 5. Резервное копирование и восстановление (Backup & Disaster Recovery)

### 5.1 Горячий бэкап базы данных и почты
```sh
# 1. Дамп базы данных PostgreSQL
docker exec mgate-aio pg_dump -U mgate -d mgate -Fc > mgate_backup_$(date +%F).dump

# 2. Архивирование почтовых ящиков (vmail) с сохранением прав
docker exec mgate-aio tar -czf - -C /var/lib/mgate-aio vmail > mgate_vmail_$(date +%F).tar.gz

# 3. Архивирование TLS-сертификатов и DKIM-ключей
docker exec mgate-aio tar -czf - -C /var/lib/mgate-aio certs dkim > mgate_keys_$(date +%F).tar.gz
```

### 5.2 Восстановление из резервной копии
1. Остановите контейнер: `docker stop mgate-aio`
2. Распакуйте архивы `vmail` и `keys` в директорию тома данных.
3. Запустите контейнер в режиме восстановления БД:
   ```sh
   docker start mgate-aio
   cat mgate_backup_*.dump | docker exec -i mgate-aio pg_restore -U mgate -d mgate --clean
   ```
4. Перезапустите контейнер для применения восстановленных данных.
