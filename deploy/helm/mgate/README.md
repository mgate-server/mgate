# MGate Helm chart

*English summary: Kubernetes packaging for MGate (Postfix + Dovecot 2.4 + Rspamd + ClamAV +
PostgreSQL + Valkey + a closed-source Rust backend shipped only as a vendor image + React SPA),
mirroring the docker-compose topology of this repository. There is exactly one backend
build — no community/official image choice anywhere in this chart. See below (in Russian) for
install instructions, the values table, DNS guidance and known limitations.*

Этот чарт разворачивает MGate в Kubernetes, повторяя топологию из `docker-compose.yml`
(см. `docs/ARCHITECTURE.md`): Deployment'ы для
api/webmail/worker (образ вендора `image.backend`, закрытый исходный код),
web/rspamd/unbound (образы из публичного репозитория), StatefulSet'ы для postfix (том очереди) и
dovecot (том почтовых ящиков), опциональные встроенные PostgreSQL и Valkey, миграции схемы БД
(initContainer `migrate` в api/webmail/worker плюс Job-хук post-install/pre-upgrade, см. ниже),
NetworkPolicy, повторяющие сегментацию `public`/`backend` из compose,
и три режима работы с TLS-сертификатами. Единственная сборка backend'а: выбора
community/official-образа нигде в чарте нет — редакция (Community/Pro) определяется во время
выполнения проверкой лицензии внутри самого образа.

## Быстрый старт

```bash
helm install mgate deploy/helm/mgate \
  --set config.hostname=mail.example.com \
  --set config.adminEmail=admin@example.com \
  --namespace mgate --create-namespace --timeout 15m
```

`--timeout 15m` нужен потому, что `helm install` ждёт завершения Job миграции, а при самой первой
установке встроенный PostgreSQL ещё скачивает образ и создаёт том — стандартных 5 минут Helm на
медленном кластере может не хватить.

Это поднимет полный стек с **встроенными** PostgreSQL и Valkey (StatefulSet с PVC) и
файловым хранилищем сертификатов на PVC (`certs.mode: mgate`): по умолчанию отдаётся самоподписанный сертификат, собственный сертификат загружается в админке. Автоматический выпуск Let's Encrypt — в разработке и в этой версии не работает. Автоматический выпуск в Kubernetes можно получить через `certs.mode: cert-manager` (см. «Режимы сертификатов»). Пароли и токены
(`MGATE_SECRET_KEY`, `MGATE_INTERNAL_TOKEN`, пароли БД и т.д.) генерируются автоматически при
первой установке и **сохраняются** при последующих `helm upgrade` (см. раздел «Секреты» ниже) —
менять их вручную не нужно.

### Миграции и первый вход

Схема БД обновляется в два слоя:

- **initContainer `migrate`** в подах api/webmail/worker выполняет `mgate migrate` до старта
  основного контейнера (аналог `depends_on: migrate` в compose): ни один компонент не стартует на
  пустой или устаревшей схеме. Повторный запуск безопасен — одновременные миграторы ждут друг
  друга на advisory-блокировке PostgreSQL, а пока БД недоступна, initContainer перезапускается.
- **Job `<release>-migrate`** — Helm-хук `post-install,pre-upgrade`, выполняет
  `mgate migrate --bootstrap`. При установке он запускается после создания всех ресурсов чарта и
  создаёт первого суперадмина и идентификатор инстанса; `helm install` считается успешным только
  после его завершения. При `helm upgrade` он применяет миграции новой версии образа **до** раскатки
  новых подов. Успешный Job удаляется, упавший остаётся для `kubectl -n mgate logs job/mgate-migrate`.

Логин первого суперадмина — `config.adminEmail`. Пароль, если `secrets.adminPassword` не задан
явно, чарт генерирует сам и хранит в Secret релиза (при `secrets.existingSecret` — в вашем
Secret, ключ `MGATE_ADMIN_PASSWORD` обязателен):

```bash
kubectl -n mgate get secret mgate-secrets -o jsonpath='{.data.MGATE_ADMIN_PASSWORD}' | base64 -d; echo
```

Значение используется только при создании первого суперадмина. Сбросить забытый пароль (новый
пароль печатается в вывод команды):

```bash
kubectl -n mgate exec deploy/mgate-api -c api -- mgate admin reset-password admin@example.com
```

## Продакшн: внешние PostgreSQL/Valkey, cert-manager, Ingress

```bash
helm install mgate deploy/helm/mgate -f my-production-values.yaml
```

```yaml
# my-production-values.yaml
config:
  hostname: mail.example.com
  adminEmail: admin@example.com
postgresql:
  enabled: false
valkey:
  enabled: false
externalDatabase:
  host: pg.internal.example.com
  existingSecret: mgate-postgres-external   # ключ "password"
externalValkey:
  host: valkey.internal.example.com
  existingSecret: mgate-valkey-external     # ключ "password"
certs:
  mode: cert-manager
  certManager:
    issuerRef: { name: letsencrypt-prod, kind: ClusterIssuer }
ingress:
  className: nginx
```

## Режимы сертификатов (`certs.mode`)

| Режим | Как работает | Ограничение |
|---|---|---|
| `mgate` (по умолчанию) | Самоподписанный сертификат по умолчанию и сертификаты, загруженные в админке («Сертификаты»), хранятся как файлы на общем PVC (`/certs/live/<host>/...`, `/certs/default/...`) — так же, как в compose, где эти файлы читают Postfix/Dovecot напрямую. PVC должен поддерживать `ReadWriteMany`, если Postfix/Dovecot когда-либо будут работать в нескольких репликах (TODO(S8)); при одной реплике каждого достаточно и `ReadWriteOnce`, если под worker (он пишет файлы) и поды-читатели физически совпадают — для надёжности используйте RWX StorageClass (NFS/CephFS/JuiceFS). | Объект `Ingress` в этом режиме **не получает** TLS от chart'а (обычный `Ingress` умеет брать TLS только из Kubernetes Secret, а не из файлов на PVC) — при `ingress.enabled=true` контроллер отдаёт свой сертификат по умолчанию, либо TLS терминируется вне кластера. |
| `cert-manager` | Chart создаёт объект `Certificate` (нужен установленный cert-manager + готовый `Issuer`/`ClusterIssuer`); результат — Kubernetes Secret с `tls.crt`/`tls.key`, который chart монтирует как `/certs/default/{fullchain,privkey}.pem` и использует для `Ingress.tls`. | Покрывает только основной `MGATE_HOSTNAME` (+ `ingress.extraHosts`); сертификаты, загруженные в админке, применяются только при `certs.mode: mgate` — совмещение обоих режимов одновременно не реализовано (TODO(S8)). |
| `existingSecret` | Свой Secret (`tls.crt`/`tls.key`). | Тот же охват (только один хост), что и `cert-manager`. |

## Секреты (lookup-preserve)

По умолчанию (`secrets.existingSecret: ""`) chart сам создаёт Secret `<release>-secrets` со
случайными значениями при первой установке. При `helm upgrade` шаблон ищет уже существующий Secret
(`lookup "v1" "Secret" ...`) и **переиспользует** сохранённые в нём значения вместо генерации новых
— иначе каждый `upgrade` менял бы `MGATE_SECRET_KEY`/пароли БД и ронял бы уже работающую
инсталляцию. Это работает только при обращении к реальному кластеру (`helm install`/`upgrade`);
офлайновый `helm template` всегда генерирует новые случайные значения — ожидаемо для рендеринга
шаблонов, не для реальных инсталляций. Передайте `secrets.existingSecret: <name>` для полностью
своего Secret (ключи — как в `templates/secret.yaml`).

## DNS

После установки получите готовые DNS-записи (MX/A/SPF/DKIM/DMARC/autoconfig) через:

```bash
kubectl -n mgate exec -it deploy/mgate-api -- mgate dns records <домен>
```

Публичные IP для MX-записи — `EXTERNAL-IP` сервисов `<release>-postfix-public` (порты 25/465/587)
и `<release>-dovecot-public` (143/993/110/995/4190):

```bash
kubectl -n mgate get svc mgate-postfix-public mgate-dovecot-public
```

Веб-интерфейс (admin/account/mail — SPA, сервис `web`) резолвится через `config.hostname` на
Ingress (`ingress.enabled: true`, `ingress.className`); маршрутизация Ingress:
`/api/v1/mail*` → `webmail`, `/api` и `/.well-known` → `api`, всё остальное → `web`.

## Веб-почта

Сервис `webmail` (REST/WebSocket веб-почты за маршрутом `/api/v1/mail*` на Ingress) работает с
почтой пользователя по IMAP и SMTP через два **внутренних** порта:

- Dovecot `1143` (`webmail.upstream.imapAddr`, по умолчанию `dovecot:1143`) и Postfix `2587`
  (`webmail.upstream.submissionAddr`, по умолчанию `postfix:2587`), оба со STARTTLS и проверкой
  сертификата из `/certs`. Эти порты не входят в публичные Service `*-public`, а NetworkPolicy
  пускает к ним только поды `webmail`. Учётные данные шлюза принимаются только на этих портах:
  не направляйте шлюз на публичные 143/587.
- `postfix.webmailClientNets` — сети, которым Postfix разрешает подключаться к 2587 (CIDR через
  пробел или запятую, IPv6 без скобок; все остальные отклоняются ещё до AUTH). Пусто — берётся
  `config.backendSubnet`, а если пуст и он — любой источник, и тогда на уровне сети порт
  защищает только NetworkPolicy (нужен CNI, который её применяет). Чтобы ограничить 2587 и в
  самом Postfix, не делая сеть доверенной для релея (это делает `config.backendSubnet`), укажите
  здесь Pod CIDR кластера или диапазон адресов подов `webmail`.
- Вложения, загруженные до отправки письма, лежат в `emptyDir` пода (`webmail.spool.sizeLimit`,
  по умолчанию `2Gi`). Собственный общий лимит шлюза — `webmail.spool.maxBytes`
  (`MGATE_WEBMAIL_SPOOL_MAX`, по умолчанию 1.5 GiB); держите его ниже `sizeLimit` с запасом:
  когда `emptyDir` превышает `sizeLimit`, kubelet выселяет под.
- **Больше одной реплики (`webmail.replicaCount` > 1) — только с привязкой сессии на Ingress**
  (cookie affinity): загруженное вложение есть только у той реплики, которая его приняла, и
  письмо, отправленное через другую реплику, его не найдёт. Остальное работает на любой реплике.
  Пример для ingress-nginx (аннотации применяются ко всему объекту Ingress; для `api`/`web`
  привязка безвредна):

  ```yaml
  ingress:
    annotations:
      nginx.ingress.kubernetes.io/affinity: cookie
      nginx.ingress.kubernetes.io/session-cookie-name: mgate-route
  ```

  Для других контроллеров включите аналогичную «sticky session» по cookie для Service `webmail`.
- `webmail.extraEnv` — дополнительные переменные только для контейнера `webmail` (список `EnvVar`
  Kubernetes), например необязательные настройки `MGATE_WEBMAIL_*` из `docs/CONFIGURATION.md`.
- Реальный IP пользователя шлюз передаёт Dovecot, и тот принимает его, только если IP пода
  `webmail` входит в `config.backendSubnet` (`login_trusted_networks`). Иначе журнал входов и
  auth policy видят IP пода; вход при этом работает.

## Доверенные прокси и переменные окружения компонентов (`*.extraEnv`)

Веб-вход и смена пароля ограничивают подбор паролей по IP пользователя, который берётся из
`X-Forwarded-For` только от доверенных прокси (`MGATE_WEBMAIL_TRUSTED_PROXIES`, значение по
умолчанию — частные диапазоны; см. `docs/CONFIGURATION.md` и `docs/DEPLOYMENT.md` §9). Если Pod
CIDR вашего кластера вне этих диапазонов (например, `100.64.0.0/10`) или перед ingress стоит CDN/
L7-балансировщик, список нужно переопределить. Вход обслуживают оба компонента, поэтому задайте
**одно и то же значение** обоим:

```yaml
api:
  extraEnv:
    - { name: MGATE_WEBMAIL_TRUSTED_PROXIES, value: "100.64.0.0/10, 127.0.0.0/8" }
webmail:
  extraEnv:
    - { name: MGATE_WEBMAIL_TRUSTED_PROXIES, value: "100.64.0.0/10, 127.0.0.0/8" }
```

В списке должен быть **каждый** прокси между пользователем и MGate (под ingress-контроллера,
CDN, балансировщик). `api.extraEnv`, `webmail.extraEnv` и `worker.extraEnv` — списки `EnvVar`
Kubernetes только для соответствующего контейнера; они имеют приоритет над общим ConfigMap/Secret.

## Ограничение частоты запросов на Ingress (необязательно)

Встроенная защита от подбора паролей работает в бэкенде и не требует настройки. Дополнительный
слой на Ingress по умолчанию **не включён**. Аннотации `ingress.annotations` применяются ко всему
объекту Ingress (включая SPA и `/api/v1/mail`), поэтому лимит только для `/api/v1/auth` задаётся
отдельным объектом Ingress с тем же хостом и путём `/api/v1/auth` → `api:8080`. Более длинный
путь выигрывает у `/api` основного Ingress. Лимит считается по адресу клиента, каким его видит
ingress-контроллер: за NAT много пользователей делят один лимит, поэтому не занижайте значения;
за L7-балансировщиком настройте у контроллера доверие к `X-Forwarded-For`/PROXY protocol, иначе
лимит будет общим для всех.

ingress-nginx (замените `mail.example.com`, имя TLS-Secret и класс):

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mgate-auth-ratelimit
  namespace: mgate
  annotations:
    nginx.ingress.kubernetes.io/limit-rps: "5"                # запросов в секунду с одного IP
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "4"   # допустимый всплеск = 5 * 4
    nginx.ingress.kubernetes.io/limit-connections: "20"       # одновременных соединений с IP
spec:
  ingressClassName: nginx
  tls:
    - hosts: [mail.example.com]
      secretName: mgate-tls
  rules:
    - host: mail.example.com
      http:
        paths:
          - path: /api/v1/auth
            pathType: Prefix
            backend:
              service: { name: api, port: { number: 8080 } }
```

Traefik: `Middleware` (CRD `traefik.io/v1alpha1`) и тот же отдельный Ingress со ссылкой на него
(формат `<namespace>-<имя>@kubernetescrd`; при кросс-namespace ссылках включите
`allowCrossNamespace` у провайдера):

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: mgate-auth-ratelimit
  namespace: mgate
spec:
  rateLimit:
    average: 5          # запросов в секунду с одного IP
    burst: 20
    sourceCriterion:
      ipStrategy:
        depth: 1        # число доверенных прокси справа в X-Forwarded-For; 0 = TCP-пир
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mgate-auth-ratelimit
  namespace: mgate
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: mgate-mgate-auth-ratelimit@kubernetescrd
spec:
  ingressClassName: traefik
  tls:
    - hosts: [mail.example.com]
      secretName: mgate-tls
  rules:
    - host: mail.example.com
      http:
        paths:
          - path: /api/v1/auth
            pathType: Prefix
            backend:
              service: { name: api, port: { number: 8080 } }
```

Это необязательное дополнение: при `429` от Ingress бэкенд не видит запрос, так что его счётчики
неудачных входов не растут, а легитимные пользователи за общим NAT могут упереться в лимит раньше.

## Известные ограничения

- **Один релиз mgate на namespace.** Service'ы, к которым обращаются сами образы Postfix/
  Dovecot/Rspamd (`postgres`, `valkey`, `rspamd`, `dovecot`, `postfix`, `clamav`, `unbound`, `api`,
  `webmail`, `web`) намеренно созданы с «голыми» именами (без префикса релиза) — это те же имена, что
  Docker Compose резолвит через встроенный DNS, и образы Postfix/Dovecot/
  Rspamd ожидают именно их. Второй релиз в том же namespace
  создаст конфликт имён Service.
- **Без резолвера с фиксированным IP — DNSBL/DANE только частично идут через `unbound`.** Compose
  закрепляет `unbound` за статическим адресом и делает его ЕДИНСТВЕННЫМ `nameserver` каждого
  почтового контейнера (`dns: [...]`, `dns_opt: [trust-ad]`); в Kubernetes
  `dnsConfig.nameservers` обязан быть валидным IP, а не DNS-именем Service, и стабильного IP пода в
  переносимом виде нет. `templates/_helpers.tpl` (`mgate.dnsConfig`) резолвит ТЕКУЩИЙ ClusterIP
  Service `unbound` через `lookup` в момент рендера и добавляет его В ДОПОЛНЕНИЕ к штатному
  `dnsPolicy: ClusterFirst` (не вместо него — иначе сломается резолвинг `postgres`/`dovecot`/
  `valkey` и прочих имён Service, которые `unbound` как чистый рекурсивный резолвер не знает).
  Из-за этого glibc-резолвер по-прежнему сначала спрашивает CoreDNS/kube-dns (а не `unbound`)
  для любого внешнего имени (DNSBL-зона, MX, TLSA) — полноценно это решается только настройкой
  stub-domain/forward в самом CoreDNS (вне зоны ответственности этого чарта). Опция `trust-ad`
  добавляется всегда. При первой установке (`lookup` ещё не находит Service) и при офлайновом
  `helm template` резолвер вообще не добавляется — только `dnsPolicy: ClusterFirst` — и
  самоисправляется на следующем `helm upgrade`.
- **`config.backendSubnet` по умолчанию пуст.** Compose доверяет своей (маленькой, фиксированной)
  docker-бридж-подсети как внутреннему релею без аутентификации (Postfix `mynetworks`, Dovecot
  `login_trusted_networks`) — например, роль `worker` шлёт письма напрямую в `postfix:25` без
  SASL. Pod CIDR в Kubernetes у каждого кластера свой и обычно намного шире `/24` — угадывать его
  здесь означало бы либо no-op (не совпадёт ни с одним реальным IP пода), либо, если случайно
  совпадёт, незапланированно широкое доверенное окно для релея. Поэтому чарт значение не задаёт:
  образы Postfix/Dovecot тогда используют свой встроенный compose-диапазон `172.30.1.0/24`,
  который в типичном кластере не совпадает ни с одним IP пода, — фактически доверяется только
  loopback. Операторам, которым нужен внутренний релей, нужно явно задать `config.backendSubnet`
  в реальный Pod CIDR своего кластера. От этого же значения зависит веб-почта: только из
  `config.backendSubnet` Dovecot принимает реальный IP пользователя, который передаёт шлюз
  (иначе журнал входов и auth policy видят IP пода `webmail`), и, если не задан
  `postfix.webmailClientNets`, только из него Postfix пускает клиентов на внутренний порт 2587
  (без обоих значений — любой источник под защитой NetworkPolicy), см. «Веб-почта».
- **Postfix/Dovecot — только 1 реплика.** Спул очереди Postfix и Maildir'ы Dovecot рассчитаны на
  единственного писателя. В поставляемом Dovecot 2.4 CE нет director (удалён в апстриме), поэтому
  поддерживается только схема «один Dovecot на один том vmail»; несколько реплик Postfix
  потребовали бы кластеризации очереди — см. `TODO(S8)` в `values.yaml`.
- **`helm rollback` через изменение схемы БД не поддерживается.** Миграции применяются только
  вперёд: initContainer `migrate` старой версии откажется работать с базой, в которой уже есть
  миграции более новой версии, и поды не стартуют. Откат на предыдущую версию после обновления —
  только через восстановление БД из резервной копии, сделанной до обновления.
- **`certs.mode=mgate` + `Ingress`**: см. таблицу выше — обычный `Ingress` не может подхватить TLS
  из файлов на PVC, только из Kubernetes Secret.
- **Встроенный PostgreSQL запускает копию `docker/postgres/initdb/10-create-mail-role.sh`**
  (создание роли `mgate_mail` для read-only доступа Postfix/Dovecot к view'ам),
  упакованную как ConfigMap (`templates/postgres/initdb-configmap.yaml`,
  `files/postgres-initdb/10-create-mail-role.sh`) — Helm может читать через `.Files.Get` только
  файлы внутри каталога чарта, поэтому это буквальная копия, а не ссылка на оригинал в
  `docker/postgres/initdb/`. **Синхронность копии проверяет `make validate-configs`** (`scripts/validate-configs.sh`):
  `diff docker/postgres/initdb/10-create-mail-role.sh
  deploy/helm/mgate/files/postgres-initdb/10-create-mail-role.sh` должен быть пустым; без такой
  проверки копия может незаметно разойтись с оригиналом.
- **Резервное копирование (`backup.enabled=true`) читает `/var/vmail` с того же PVC**, что и
  Dovecot (`ReadWriteOnce` по умолчанию) — совместное монтирование гарантированно работает только
  если CSI-драйвер допускает multi-attach в пределах одного узла, либо когда
  `dovecot.persistence.accessMode` переключён на `ReadWriteMany`. Альтернатива (потоковый бэкап
  через `doveadm backup`/`dsync` без общего тома) не реализована — `TODO(S8)`. Под бэкапа
  работает от root с единственной capability `DAC_OVERRIDE` (почтовые каталоги принадлежат
  vmail 5000:5000 и закрыты для остальных), данные монтируются только для чтения; namespace
  должен допускать уровень Pod Security `baseline` (его и так требуют postfix/dovecot/clamav).
  Восстановление в Kubernetes чарт не автоматизирует: используйте `restore.sh` из того же образа
  (см. `docs/BACKUP.md`) в разовом поде с теми же томами, смонтированными на запись.
- **NetworkPolicy — базовая сегментация, не исчерпывающая политика Egress.** По умолчанию задан
  только Ingress-контроль (кто может обращаться к postgres/valkey/rspamd/clamav/unbound/dovecot/
  postfix/api изнутри кластера) плюс egress к DNS; полная egress-изоляция (например, запрет
  исходящих подключений из postgres/valkey куда бы то ни было, кроме кластера) — `TODO(S8)`, после
  того как реальные потребности каждого образа в DNS/сети будут проверены на практике.
- **Лицензия проекта**: этот репозиторий публикуется без лицензии на открытый или
  source-available код — все права защищены, узкое право на развёртывание и эксплуатацию
  официальных образов предоставляет `EULA.md` (см. `docs/adr/0014-license-choice.md`); сверьте с этим текстом аннотацию
  `Chart.yaml` `artifacthub.io/license`, если она когда-либо ссылалась на другую лицензию.

## Таблица values (основное)

| Ключ | По умолчанию | Описание |
|---|---|---|
| `global.imageRegistry` | `ghcr.io/mgate-server` | Реестр образов (публичный, анонимный pull); все 10 образов продукта лежат в одном пространстве имён |
| `global.imageTag` | `""` (= `appVersion` чарта) | Версия образов: CalVer `ГГГГ.М.N` (например, `2026.10.1`), единая для всего продукта; в продакшене фиксируйте точную версию |
| `image.backend.repository`/`.tag` | `mgate` / `""` | Единственный образ вендора (закрытый исходный код); используется api/webmail/worker/migrate |
| `image.agent.repository`/`.tag` | `mgate-agent` / `""` | Образ-вендора с бинарником `mgate-agent`; только для справки (используется как build-arg при сборке образов postfix/dovecot из публичного репозитория, не разворачивается этим чартом как отдельный workload) |
| `web.env.pricingUrl` / `web.env.vendorPortalUrl` | `""` | Необязательные ссылки в админ-панели (`MGATE_PRICING_URL` / `MGATE_VENDOR_PORTAL_URL`); показываются, только если заданы |
| `config.hostname` | `mail.example.com` | FQDN (MX/HELO/admin/webmail хост), `MGATE_HOSTNAME` |
| `config.adminEmail` | `admin@example.com` | Логин (email) первого суперадмина |
| `secrets.adminPassword` | `""` (генерируется) | Пароль первого суперадмина (`MGATE_ADMIN_PASSWORD` в Secret релиза) |
| `config.acme.challenge` | `http-01` | Параметр будущего автоматического выпуска сертификатов — **в разработке**, в этой версии ничего не выпускает |
| `config.proxy.httpsProxy` / `.httpProxy` / `.noProxy` | `""` | Исходящий HTTP(S)-прокси для api/webmail/worker/migrate и бэкапа (`HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`); внутренние имена Service в исключения добавляются автоматически |
| `config.backendSubnet` | `""` | Pod CIDR кластера для доверенного внутреннего релея Postfix/Dovecot и реального IP пользователей веб-почты — см. «Известные ограничения» |
| `secrets.existingSecret` | `""` | Имя своего Secret вместо автогенерации (см. «Секреты») |
| `postgresql.enabled` | `true` | Встроенный PostgreSQL (StatefulSet + PVC) |
| `externalDatabase.*` | — | Координаты внешнего PostgreSQL при `postgresql.enabled: false` |
| `valkey.enabled` | `true` | Встроенный Valkey (StatefulSet + PVC) |
| `externalValkey.*` | — | Координаты внешнего Valkey при `valkey.enabled: false` |
| `clamav.enabled` | `true` | Антивирус (StatefulSet + PVC базы сигнатур) |
| `postfix.replicaCount` | `1` | Не менять до TODO(S8) |
| `postfix.webmailClientNets` | `""` | Сети, допущенные к внутреннему порту веб-почты 2587 (`MGATE_WEBMAIL_CLIENT_NETS`); пусто = `config.backendSubnet`, иначе любой источник под защитой NetworkPolicy — см. «Веб-почта» |
| `webmail.replicaCount` | `1` | Больше 1 — только с cookie affinity на Ingress (см. «Веб-почта») |
| `webmail.upstream.imapAddr` / `.submissionAddr` | `dovecot:1143` / `postfix:2587` | Внутренние IMAP и submission для шлюза веб-почты (`MGATE_IMAP_ADDR` / `MGATE_SUBMISSION_ADDR`), STARTTLS |
| `webmail.spool.sizeLimit` / `.maxBytes` | `2Gi` / `1610612736` | `emptyDir` для вложений до отправки / общий лимит шлюза (`MGATE_WEBMAIL_SPOOL_MAX`), держать ниже `sizeLimit` |
| `webmail.extraEnv` | `[]` | Дополнительные `EnvVar` только для контейнера `webmail` |
| `api.extraEnv` / `worker.extraEnv` | `[]` | То же для контейнеров `api` / `worker`; например `MGATE_WEBMAIL_TRUSTED_PROXIES` (см. «Доверенные прокси») |
| `dovecot.replicaCount` | `1` | Не менять до TODO(S8) |
| `dovecot.persistence.accessMode` | `ReadWriteOnce` | `ReadWriteMany` только для multi-replica (TODO(S8)) |
| `certs.mode` | `mgate` | `mgate` \| `cert-manager` \| `existingSecret` — см. таблицу выше |
| `ingress.enabled` | `true` | HTTP-маршруты api/webmail/web |
| `ingress.className` | `""` | IngressClass (пусто = класс кластера по умолчанию) |
| `networkPolicy.enabled` | `true` | Сегментация public/backend (требует контроллер NetworkPolicy в кластере) |
| `migrate.backoffLimit` / `migrate.activeDeadlineSeconds` | `6` / `900` | Повторы и общий лимит времени Job миграции |
| `backup.enabled` | `false` | CronJob restic + pg_dump |

Полный список — с комментариями к каждому полю — в `values.yaml`; структурная схема — в
`values.schema.json`.

## Валидация

```bash
# HELM_IMAGE must match the Makefile / .github/workflows/ci.yml pin exactly.
docker run --rm -v "$PWD/deploy/helm:/c" -w /c alpine/helm:4.3.0 lint mgate
docker run --rm -v "$PWD/deploy/helm:/c" -w /c alpine/helm:4.3.0 template mgate mgate > /tmp/rendered.yaml
docker run --rm -v /tmp:/t ghcr.io/yannh/kubeconform:v0.8.0 -strict -ignore-missing-schemas -summary /t/rendered.yaml
```

(`make helm-lint` / `make helm-template` в корневом `Makefile` оборачивают только `lint`/`template`;
`kubeconform` пока не подключён ни в `Makefile`, ни в CI — команда выше используется только для
ручной проверки при подготовке этого чарта.)

Также стоит отрендерить чарт со значениями «внешние БД» (`postgresql.enabled: false`,
`valkey.enabled: false` + соответствующие `externalDatabase`/`externalValkey`, см. пример выше) —
некоторые поля (`MGATE_DATABASE_URL`, `POSTGRES_MAIL_PASSWORD` и т.д.) собираются по-разному в этих
двух режимах, и различие проверяется только вторым рендером.
