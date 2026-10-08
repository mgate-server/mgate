# Разработка SPA

Этот документ — единственное, что нужно знать, чтобы собрать, изменить, протестировать и
задеплоить фронтенд MGate. **Разработка самого backend-сервиса сюда не входит** — его исходный
код закрыт и распространяется только в виде готового образа `ghcr.io/mgate-server/mgate`
(бэкенд для SPA — «чёрный ящик», см. `docs/ARCHITECTURE.md` §7). В этом репозитории нет
бэкенд-кода, а разработка бэкенда в него не входит.

## 1. Что это за приложение

Одна SPA (React 19 + TypeScript strict + Vite + Tailwind CSS v4 + React Router 7 +
TanStack Query + i18next + zod) с тремя областями и общей оболочкой:

| Область | Маршруты | Аудитория |
|---|---|---|
| Админ-панель (+ Pro-страницы) | `/admin/*`, `/admin/pro/*` | SuperAdmin, DomainAdmin |
| Личный кабинет | `/account/*` | User (self-service) |
| Веб-почта | `/mail/*` | User (webmail) |
| Вход | `/login` | все роли |

Обоснование единой SPA — `docs/adr/0012-*.md`. Pro-страницы (`/admin/pro/*`) — обычные
страницы этой же SPA, не отдельный пакет и не отдельная сборка: они гейтятся в рантайме по
ответу `GET /api/v1/system/entitlements`, а не флагом сборки (см. §5 ниже).

## 2. Структура рабочей области (`web/`)

```
web/
├── package.json              # npm workspaces root
├── apps/spa/                 # приложение (единственное)
│   ├── src/
│   │   ├── pro/               # Pro-страницы, дашборд-виджеты, настройки — entitlement-gated
│   │   ├── lib/                # runtimeConfig.ts, apiClient.ts, entitlements.ts, versionCheck.ts
│   │   └── ...
│   └── dist/                  # production-бандл (`make build-web`), копируется в образ `web`
├── packages/
│   ├── ui/                    # общие UI-компоненты
│   ├── api-client/            # openapi.json + сгенерированный TS-клиент, README.md (openapi-sync flow)
│   └── extensions/            # ExtensionRegistry, <ProFeature>, типы для Pro-страниц
```

Никакого Rust, никакого `Cargo.toml` нигде в `web/` или во всём этом репозитории.

## 3. Быстрый старт

Бэкенд в этом репозитории не собирается — для разработки SPA нужен работающий стек с
готовым образом бэкенда (он скачивается из `MGATE_REGISTRY`). Dev-оверлей
`docker-compose.dev.yml` дополнительно публикует `api` и `webmail` только на loopback
(`127.0.0.1:8080` и `127.0.0.1:8082`), чтобы Vite dev-сервер мог ходить к ним напрямую:

```sh
make init            # один раз: создать .env со случайными секретами
make dev             # dev-стек: БД, Valkey, почта, Traefik, mailpit + api/webmail/worker
make dev-web         # Vite dev-сервер: /api -> 127.0.0.1:8080, /api/v1/mail -> 127.0.0.1:8082
make dev-down        # остановить dev-стек
```

Если порты по умолчанию заняты, задайте `MGATE_DEV_API_PORT` / `MGATE_DEV_WEBMAIL_PORT` в
`.env` и укажите те же адреса для Vite через `VITE_API_URL` / `VITE_WEBMAIL_URL`.

`make up` (обычный стек из `docker-compose.yml`) порты `api`/`webmail` на хост **не**
публикует, поэтому `make dev-web` рассчитан на dev-стек. Альтернатива — направить Vite на
уже работающий стек через Traefik, задав один и тот же адрес в `VITE_API_URL` и
`VITE_WEBMAIL_URL` (Traefik отдаёт и `/api`, и `/api/v1/mail`), например
`VITE_API_URL=https://<хост> VITE_WEBMAIL_URL=https://<хост> make dev-web`; при
самоподписанном сертификате добавьте `NODE_TLS_REJECT_UNAUTHORIZED=0` (только для локальной
разработки). Этот режим зависит от настроек cookie и CSRF-проверок вашего стека; основной
поддерживаемый путь — `make dev`.

Полноценная замена реального бэкенда локальным моком не предусмотрена: SPA рассчитана на
работу против настоящего API (пулленого образа), а не против заглушки — все данные (домены,
ящики, entitlements) реальны и приходят из PostgreSQL за API.

## 4. Runtime-конфигурация (`/config.json`)

Собранный бандл **не знает во время сборки** адрес API — это значение
подставляется образом `web` (`docker/web/entrypoint.sh`) в рантайме из переменных окружения
контейнера (`MGATE_API_BASE_URL`, а также опциональные
`MGATE_PRICING_URL` и `MGATE_VENDOR_PORTAL_URL`) в файл
`/config.json`, который SPA запрашивает перед первым рендером
(`apps/spa/src/lib/runtimeConfig.ts`). Опциональный объект `links` (`pricingUrl`, `vendorPortalUrl`) присутствует в
`/config.json`, только если соответствующая переменная непустая (если обе пусты — `links`
опускается целиком); SPA показывает ссылки на тарифы / портал вендора только при заданном URL,
хостнеймов в коде SPA нет. Один и тот же собранный образ работает под любым
доменом без пересборки. (Название и логотип продукта — Pro-модуль white-label — приходят не из
`/config.json`, а из API: `GET /api/v1/system/branding`.) При локальной разработке (`make dev-web`, Vite dev-сервер)
`/config.json` может отсутствовать — `runtimeConfig.ts` откатывается на дефолты (см. код).

**Правило:** если вы меняете форму `RuntimeConfig` в `runtimeConfig.ts`, обязательно
синхронно поменяйте `docker/web/entrypoint.sh` — эти два файла должны оставаться согласованными.

## 5. Как устроен Pro-гейтинг (`packages/extensions`)

- `ExtensionRegistry` — статический реестр UI-вкладов (пункты навигации, панели настроек,
  виджеты дашборда), регистрируется один раз при старте.
- `setEntitlementFlags()` — живой оверлей поверх реестра, обновляемый
  `apps/spa/src/lib/entitlements.ts` (`useEntitlementsSync`, смонтирован один раз в `App.tsx`)
  по ответу `GET /api/v1/system/entitlements` через TanStack Query.
- `<ProFeature flag>` — компонент-гейт, подписан на живой список через
  `useSyncExternalStore`: страница, отрендеренная до того, как ответ энтайтлментов пришёл,
  обновляется на месте, без перезагрузки.

Это **чисто косметический** гейт: он существует, чтобы не показывать пользователю
неактивную функцию, а не чтобы что-то запрещать технически. SPA полностью открыта — кто
угодно может собрать версию, которая всегда показывает Pro-контент; это ничего не даёт,
потому что реальные Pro-эндпойнты `/api/v1/pro/*` отклоняют запрос без валидного
энтайтлмента на сервере, независимо от того, что показывает браузер. Никогда не
рассматривайте `<ProFeature>` или любой другой клиентский гейт как контроль безопасности —
см. `docs/LICENSING.md` и `docs/adr/0018-*.md`.

**Pro-модули «в разработке».** Источник правды о том, какие Pro-модули реально работают, —
`apps/spa/src/pro/features.ts` (`implemented`) вместе с бэкендом: нереализованный модуль
(`pro.backup_center`, `pro.advanced_dashboard`, `pro.multi_tenant_rbac`, `pro.priority_updates`)
отвечает `501 not_implemented`, а его страница `/admin/pro/<slug>` (`BacklogFeaturePage`)
всегда показывает состояние «В разработке» — без вымышленных данных и без предложения
купить Pro. Когда модуль реализуют, выставьте `implemented: true`, добавьте `href` (или
собственный маршрут) и обновите `docs/LICENSING.md` §2.2.

## 6. API-клиент и синхронизация со схемой бэкенда

API-клиент генерируется из **опубликованного бэкендом** OpenAPI-документа
— не из локальной сборки Rust (которой в этом репозитории больше нет и быть не может):

```sh
make openapi-sync     # docker run --rm $MGATE_IMAGE openapi > web/packages/api-client/openapi.json
make web-client-gen   # openapi-typescript -> packages/api-client/src/generated/schema.d.ts
```

Подробности двухшагового потока (зачем два шага, что делает каждый) —
`web/packages/api-client/README.md`. Ни один шаг не предполагает наличие локального `cargo`
или Rust-исходников — этого требует и сам факт, что бэкенд закрыт.

`apps/spa/src/lib/apiClient.ts` оборачивает сгенерированный клиент в ленивый `Proxy`, чтобы
реальный `baseUrl` (из `/config.json`, §4) подставлялся уже после того, как модуль
импортирован — единственная точка, где рантайм-конфигурация встречается со
статически сгенерированным клиентом.

## 7. Проверка совместимости версий SPA/API

`apps/spa/src/lib/versionCheck.ts` + `components/UpdateRequiredBanner.tsx` (смонтирован в
`App.tsx`) реализуют сравнение версий SPA и API: баннер «требуется обновление» должен
показываться, если `GET /api/v1/system/info` вернёт `spa_min_version`, превышающую версию
SPA. Сейчас эти поля в опубликованной схеме API отсутствуют, поэтому проверка **не действует**
и баннер не показывается (запланировано); код активируется после обновления схемы
(`make openapi-sync`) без правок в SPA. Локальные сборки (`dev`, `0.0.0-dev`) из проверки
исключены.

## 8. Сборка образа `web`

```sh
make image-web         # docker build -f docker/web/Dockerfile
make build-web          # только production-бандл apps/spa/dist, без образа
```

Двухстадийный `docker/web/Dockerfile`: `node:24-alpine` (npm ci + `npm run build -w apps/spa`)
→ `nginx:1.29-alpine`, non-root (uid 101), читает статику из `/usr/share/nginx/html`, пишет
только в tmpfs (`/tmp`, `/var/cache/nginx` — read-only root filesystem в compose/Helm).
Образ не содержит секретов и не содержит никакой серверной логики — ни один лимит (домены,
Pro-функции) не проверяется здесь, только в закрытом бэкенде (см. `docs/LICENSING.md`).

## 9. Тесты, линт, типы

```sh
make test-web        # unit/component-тесты
make lint-web         # ESLint
make typecheck-web    # tsc --strict, без эмита
```

Все три проверяются в CI этого репозитория (`.github/workflows/ci.yml`).

## 10. Соглашения

- UI-строки — только через i18next (`ru` по умолчанию, `en` вторым); никогда не хардкодить
  текст в JSX.
- Документация в этом репозитории — на русском; идентификаторы кода и комментарии — на
  английском.
- `TODO(S<N>): <конкретная задача>` — как везде в проекте, `N` — стадия из
  `docs/ROADMAP.md`.
- Не добавляйте зависимость этого workspace на закрытый код бэкенда — публичный код
  взаимодействует с бэкендом только через опубликованный OpenAPI и HTTP.
