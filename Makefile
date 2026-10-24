# MGate — единая точка входа для сборки, запуска и проверки проекта.
# Имена целей стабильны (на них ссылаются CI и документация) — не переименовывать.
# `make help` печатает список целей с описаниями на русском (см. `## описание` в конце строки).

SHELL := /bin/bash
.DEFAULT_GOAL := help
export DOCKER_BUILDKIT := 1
export COMPOSE_DOCKER_CLI_BUILD := 1
# Keep in sync with .github/workflows/ci.yml's HELM_IMAGE.
HELM_IMAGE ?= alpine/helm:4.3.0

# Явный `-f` отключает автозагрузку docker-compose.override.yml, поэтому подключаем его здесь сами
# (как это делает голый `docker compose`): локальные расширения оператора работают и через make.
COMPOSE       = docker compose -f docker-compose.yml $(if $(wildcard docker-compose.override.yml),-f docker-compose.override.yml,)
COMPOSE_BUILD = $(COMPOSE) -f docker-compose.build.yml
COMPOSE_DEV   = $(COMPOSE_BUILD) -f docker-compose.dev.yml

.PHONY: help init remake up down restart ps logs pull build images \
	image-web image-postfix image-dovecot image-rspamd image-unbound \
	image-traefik image-backup image-firewall image-aio \
	dev dev-down dev-web \
	test-web test-installer lint-web typecheck-web build-web web-client-gen openapi-sync \
	migrate db-shell valkey-shell \
	compose-config validate-configs helm-lint helm-template smoke \
	backup restore clean

help: ## Показать список целей с описанием
	@echo "MGate — доступные цели make:"
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# --- Жизненный цикл продакшн-стека (docker-compose.yml, образы из реестра) --

init: ## Сгенерировать .env из .env.example со случайными секретами (идемпотентно)
	@./scripts/gen-secrets.sh

remake: init ## Пересобрать/актуализировать .env (проверка свободных подсетей и секретов)

up: ## Поднять полный стек (образы из MGATE_REGISTRY, без сборки)
	$(COMPOSE) up -d

down: ## Остановить и удалить контейнеры стека (volumes сохраняются)
	$(COMPOSE) down

restart: ## Перезапустить все сервисы стека
	$(COMPOSE) restart

ps: ## Показать статус контейнеров
	$(COMPOSE) ps

logs: ## Стримить логи всех сервисов (Ctrl+C для выхода)
	$(COMPOSE) logs -f --tail=200

pull: ## Скачать актуальные образы из MGATE_REGISTRY
	$(COMPOSE) pull

# --- Сборка образов из исходников (docker-compose.build.yml) ----------------

build: ## Собрать все образы первой стороны из исходников
	$(COMPOSE_BUILD) build

images: build ## Синоним `build` (все образы первой стороны)

image-web: ## Собрать только образ web (nginx + SPA)
	$(COMPOSE_BUILD) build web

image-postfix: ## Собрать только образ postfix
	$(COMPOSE_BUILD) build postfix

image-dovecot: ## Собрать только образ dovecot
	$(COMPOSE_BUILD) build dovecot

image-rspamd: ## Собрать только образ rspamd
	$(COMPOSE_BUILD) build rspamd

image-unbound: ## Собрать только образ unbound
	$(COMPOSE_BUILD) build unbound

image-traefik: ## Собрать только образ traefik
	$(COMPOSE_BUILD) build traefik

image-backup: ## Собрать только образ backup
	$(COMPOSE_BUILD) build backup

image-firewall: ## Собрать только образ firewall (профиль firewall)
	$(COMPOSE_BUILD) --profile firewall build firewall

image-aio: ## Собрать экспериментальный all-in-one образ (не для продакшна)
	docker build -f docker/aio/Dockerfile -t mgate/aio:dev .

# --- Разработка (инфраструктура в контейнерах; backend — закрытый образ, он только
#     скачивается и никогда не собирается из этого репозитория) ---

dev: ## Поднять dev-стек (БД/Valkey/почта/traefik/mailpit + api/webmail/worker; api:8080, webmail:8082 на 127.0.0.1)
	$(COMPOSE_DEV) up -d postgres valkey migrate traefik postfix dovecot rspamd unbound mailpit api webmail worker

dev-down: ## Остановить dev-стек
	$(COMPOSE_DEV) down

dev-web: ## Запустить Vite dev-сервер SPA (проксирует /api на 127.0.0.1:8080)
	@test -f web/package.json || { echo "web/package.json ещё не создан (см. область frontend)"; exit 1; }
	cd web && npm run dev

# --- Качество кода фронтенда (Rust-исходников в этом репозитории нет: backend распространяется
#     только как готовый образ) -------

test-web: ## Тесты фронтенда (npm workspaces)
	@test -f web/package.json || { echo "web/package.json ещё не создан (см. область frontend)"; exit 1; }
	cd web && npm run test

test-installer: ## Проверить установщик в изоляции (без установки пакетов и запуска контейнеров)
	python3 -m unittest discover -s tests/installer -v

.PHONY: update update-check updater-install test-updater test-updater-docker
update: ## Обновить MGate до стабильного релиза с копией базы и настроек
	./scripts/update.sh $(if $(VERSION),--version $(VERSION),)

update-check: ## Проверить доступность новой версии MGate
	./scripts/update.sh --check

updater-install: ## Подключить хостовую службу обновления для административной панели (sudo)
	./scripts/update.sh --install-service

test-updater: ## Изолированные тесты механизма обновления
	python3 -m unittest discover -s tests/updater -v

test-updater-docker: ## Проверить обновление и восстановление на одноразовом Compose-стенде
	MGATE_UPDATER_DOCKER_TEST=1 python3 -m unittest discover -s tests/updater -p test_docker.py -v

lint-web: ## ESLint для фронтенда
	@test -f web/package.json || { echo "web/package.json ещё не создан (см. область frontend)"; exit 1; }
	cd web && npm run lint

typecheck-web: ## Проверка типов TypeScript (strict)
	@test -f web/package.json || { echo "web/package.json ещё не создан (см. область frontend)"; exit 1; }
	cd web && npm run typecheck

build-web: ## Собрать production-бандл SPA (web/apps/spa/dist)
	@test -f web/package.json || { echo "web/package.json ещё не создан (см. область frontend)"; exit 1; }
	cd web && npm ci --no-audit --no-fund && npm run build

# --- База данных / кэш --------------------------------------------------------

migrate: ## Применить миграции БД (одноразовый сервис migrate)
	$(COMPOSE) run --rm migrate

db-shell: ## Открыть psql-консоль внутри контейнера postgres
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

valkey-shell: ## Открыть valkey-cli консоль внутри контейнера valkey
	$(COMPOSE) exec valkey sh -c 'valkey-cli -a "$$VALKEY_PASSWORD" --no-auth-warning'

# --- Валидация конфигурации ---------------------------------------------------

compose-config: ## Отрендерить и провалидировать все варианты compose (base/build/dev, все профили)
	$(COMPOSE) --profile clamav --profile backup --profile restore --profile firewall config -q
	$(COMPOSE_BUILD) --profile clamav --profile backup --profile restore --profile firewall config -q
	$(COMPOSE_DEV) --profile clamav --profile backup --profile restore --profile firewall config -q
	@echo "compose config OK (base + build + dev, all profiles)"

validate-configs: ## Провалидировать конфиги демонов внутри собранных образов
	@./scripts/validate-configs.sh

helm-lint: ## Линт Helm-чарта (через образ $(HELM_IMAGE), без локального helm)
	@test -d deploy/helm/mgate || { echo "deploy/helm/mgate ещё не создан (см. область packaging)"; exit 1; }
	docker run --rm -v "$$(pwd):/work" -w /work $(HELM_IMAGE) lint deploy/helm/mgate

helm-template: ## Отрендерить манифесты Helm-чарта в stdout
	@test -d deploy/helm/mgate || { echo "deploy/helm/mgate ещё не создан (см. область packaging)"; exit 1; }
	docker run --rm -v "$$(pwd):/work" -w /work $(HELM_IMAGE) template mgate deploy/helm/mgate

# --- Тестирование сквозного сценария и доставляемости -------------------------

smoke: ## Дымовой тест доставки почты (SMTP/Submission/IMAP), см. docs/TESTING.md
	@./scripts/smoke-test.sh

# --- Резервное копирование ----------------------------------------------------

backup: ## Выполнить резервное копирование прямо сейчас (профиль backup)
	$(COMPOSE) --profile backup run --rm backup /usr/local/bin/backup.sh

# Отдельный сервис `restore` (профиль restore): тома vmail/certs на запись и capabilities для
# восстановления владельцев файлов; у планового `backup` они только для чтения. Снапшот по
# умолчанию — latest, другой: `make restore SNAPSHOT=<id>` (список: см. docs/BACKUP.md).
restore: ## Восстановить из резервной копии (интерактивно; SNAPSHOT=<id>, по умолчанию latest)
	$(COMPOSE) --profile restore run --rm restore /usr/local/bin/restore.sh $(SNAPSHOT)

verify-backup: ## Проверить целостность репозитория бэкапов и валидность дампа БД
	$(COMPOSE) --profile backup run --rm backup /usr/local/bin/verify-backup.sh $(SNAPSHOT)

# --- Генерация API-контракта (нет локального cargo: `mgate openapi` запускается
#     внутри скачанного образа backend'а) -----------------------------------------------------

openapi-sync: ## Обновить web/packages/api-client/openapi.json из образа MGATE_IMAGE (mgate openapi)
	docker run --rm "$${MGATE_IMAGE:-$${MGATE_REGISTRY:-ghcr.io/mgate-server}/mgate}:$${MGATE_VERSION:-latest}" openapi > web/packages/api-client/openapi.json
	@echo "Не забудьте закоммитить обновлённый openapi.json и выполнить 'make web-client-gen'."

web-client-gen: ## Сгенерировать TS-клиент из OpenAPI-спецификации (openapi-typescript)
	@test -f web/package.json || { echo "web/package.json ещё не создан (см. область frontend)"; exit 1; }
	cd web && npm run gen

# --- Уборка ---------------------------------------------------------------------

clean: ## Остановить все стеки и убрать сборочные артефакты (volumes НЕ удаляются)
	-$(COMPOSE_DEV) down --remove-orphans
	-$(COMPOSE) down --remove-orphans
	-rm -rf web/apps/spa/dist web/**/node_modules
