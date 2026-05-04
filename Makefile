# Crate - Self-hosted music platform
# ==================================

# Remote server
SERVER_HOST   := 104.152.210.73
SERVER_USER   := root
SERVER_PATH   := /home/crate/crate
SSH           := ssh $(SERVER_USER)@$(SERVER_HOST)

# Compose
DC            := docker compose
DC_LOCAL      := $(DC) -f docker-compose.yaml -f docker-compose.local-stack.yaml
REMOTE_DC     := docker compose -f docker-compose.yaml -f docker-compose.project.yaml

# Local domains
LOCAL_DOMAIN  := crate.local
LOCAL_HOSTS   := traefik auth collection search web api admin

# Colors
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RED    := \033[0;31m
NC     := \033[0m

.DEFAULT_GOAL := help

# ===========================================================================
# DEV (local development environment)
# ===========================================================================

DC_DEV := $(DC) -f docker-compose.dev.yaml
DEV_CONTAINERS := crate-dev-api crate-dev-worker crate-dev-playback-worker crate-dev-postgres crate-dev-redis crate-dev-slskd crate-dev-caddy

.PHONY: dev
dev: ## Start backend (Postgres + Redis + API + Worker + Caddy) and frontend dev servers
	@# Kill any leftover Vite processes from previous runs (by port AND pattern)
	@-lsof -ti :5173,:5174,:5175,:5176,:5177 2>/dev/null | xargs kill -9 2>/dev/null || true
	@-pkill -f "vite.*app/ui" 2>/dev/null || true
	@-pkill -f "vite.*app/listen" 2>/dev/null || true
	@-pkill -f "vite.*app/docs" 2>/dev/null || true
	@-pkill -f "vite.*app/site" 2>/dev/null || true
	@-pkill -f "vite.*app/reference" 2>/dev/null || true
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@sleep 0.5
	@$(DC_DEV) up -d --build
	@echo "$(GREEN)Backend is up (Postgres, Redis, API, Worker, Caddy)$(NC)"
	@echo ""
	@echo "Starting frontends..."
	@rm -rf app/ui/node_modules/.vite app/listen/node_modules/.vite node_modules/.vite 2>/dev/null || true
	@npm install --silent 2>/dev/null
	@cd app/docs && npm install --silent 2>/dev/null; cd ../..
	@cd app/site && npm install --silent 2>/dev/null; cd ../..
	@cd app/reference && npm install --silent 2>/dev/null; cd ../..
	@(npm run --workspace=app/ui dev -- --port 5173 --strictPort --host > /dev/null 2>&1 &)
	@(npm run --workspace=app/listen dev -- --port 5174 --strictPort --host > /dev/null 2>&1 &)
	@(cd app/docs && npx vite --port 5175 --strictPort --host > /dev/null 2>&1 &)
	@(cd app/site && npx vite --port 5176 --strictPort --host > /dev/null 2>&1 &)
	@(cd app/reference && npx vite --port 5177 --strictPort --host > /dev/null 2>&1 &)
	@sleep 2
	@echo ""
	@echo "  $(GREEN)Admin:$(NC)  https://admin.dev.lespedants.org"
	@echo "  $(GREEN)Listen:$(NC) https://listen.dev.lespedants.org"
	@echo "  $(GREEN)Docs:$(NC)   https://docs.dev.cratemusic.app"
	@echo "  $(GREEN)API Ref:$(NC) https://reference.dev.cratemusic.app"
	@echo "  $(GREEN)Site:$(NC)   https://www.dev.cratemusic.app"
	@echo "  $(GREEN)API:$(NC)    https://api.dev.lespedants.org"
	@echo "  Login:  admin@cratemusic.app / admin"
	@echo ""
	@echo "$(GREEN)Everything is running. Use make dev-down to stop it.$(NC)"

.PHONY: dev-back
dev-back: ## Start only the backend (Postgres + Redis + API + Worker)
	@$(DC_DEV) up -d --build
	@echo "$(GREEN)Backend is up$(NC)"
	@echo "  API: http://localhost:8585"

.PHONY: dev-admin
dev-admin: ## Start only the Admin UI dev server (:5173)
	@npm run --workspace=app/ui dev -- --port 5173 --host

.PHONY: dev-listen
dev-listen: ## Start only the Listen dev server (:5174)
	@npm run --workspace=app/listen dev -- --port 5174 --host

.PHONY: dev-docs
dev-docs: ## Start only the docs dev server (:5175)
	@cd app/docs && npx vite --port 5175 --host

.PHONY: dev-site
dev-site: ## Start only the site dev server (:5176)
	@cd app/site && npx vite --port 5176 --host

.PHONY: dev-reference
dev-reference: ## Start only the Scalar reference dev server (:5177)
	@cd app/reference && npx vite --port 5177 --host

.PHONY: dev-down
dev-down: ## Stop everything (backend + frontends)
	@$(DC_DEV) down
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@-lsof -ti :5173,:5174,:5175,:5176,:5177 2>/dev/null | xargs kill -9 2>/dev/null || true
	@-pkill -f "vite.*app/ui" 2>/dev/null || true
	@-pkill -f "vite.*app/listen" 2>/dev/null || true
	@-pkill -f "vite.*app/docs" 2>/dev/null || true
	@-pkill -f "vite.*app/site" 2>/dev/null || true
	@-pkill -f "vite.*app/reference" 2>/dev/null || true
	@echo "$(GREEN)Everything stopped$(NC)"

.PHONY: dev-logs
dev-logs: ## Tail backend logs (usage: make dev-logs or make dev-logs s=worker)
	@if [ -n "$(s)" ]; then \
		$(DC_DEV) logs -f $(s); \
	else \
		$(DC_DEV) logs -f; \
	fi

.PHONY: dev-rebuild
dev-rebuild: ## Rebuild and restart everything
	@-pkill -f "vite.*app/ui" 2>/dev/null || true
	@-pkill -f "vite.*app/listen" 2>/dev/null || true
	@-pkill -f "vite.*app/docs" 2>/dev/null || true
	@-pkill -f "vite.*app/site" 2>/dev/null || true
	@-pkill -f "vite.*app/reference" 2>/dev/null || true
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@sleep 0.5
	@$(DC_DEV) up -d --build --force-recreate
	@(npm run --workspace=app/ui dev -- --port 5173 --strictPort --host > /dev/null 2>&1 &)
	@(npm run --workspace=app/listen dev -- --port 5174 --strictPort --host > /dev/null 2>&1 &)
	@(cd app/docs && npx vite --port 5175 --strictPort --host > /dev/null 2>&1 &)
	@(cd app/site && npx vite --port 5176 --strictPort --host > /dev/null 2>&1 &)
	@(cd app/reference && npx vite --port 5177 --strictPort --host > /dev/null 2>&1 &)
	@sleep 2
	@echo "$(GREEN)Everything rebuilt$(NC)"

.PHONY: dev-reset
dev-reset: ## Reset the dev environment (wipe data and stop everything)
	@$(DC_DEV) down -v
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@-pkill -f "vite.*517" 2>/dev/null || true
	@echo "$(GREEN)Dev environment reset (data removed)$(NC)"

.PHONY: dev-test
dev-test: ## Run tests inside the dev container
	@$(DC_DEV) exec worker pytest tests/ -v

.PHONY: regression-api
regression-api: ## Critical backend contracts (Explore/search/system playlists)
	@$(DC_DEV) exec worker pytest tests/test_explore_contracts.py tests/test_upload_contracts.py -q

.PHONY: regression-radio
regression-radio: ## Radio contracts using a temporary backend image from the current branch
	@docker build -t crate-radio-tests ./app
	@docker run --rm --entrypoint pytest crate-radio-tests tests/test_radio_contracts.py -q

.PHONY: regression-smoke
regression-smoke: ## Real smoke test against the authenticated dev environment
	@python3 scripts/regression_smoke.py

.PHONY: regression-min
regression-min: regression-api regression-smoke ## Minimum regression suite before touching Listen

# ===========================================================================
# LOCAL (full stack with Traefik)
# ===========================================================================

.PHONY: up
up: _check-network ## Start the local stack
	@$(DC_LOCAL) up -d
	@echo "$(GREEN)Local stack is up$(NC)"
	@echo "Dashboard: https://traefik.$(LOCAL_DOMAIN)"

.PHONY: down
down: ## Stop the local stack
	@$(DC_LOCAL) down

.PHONY: restart
restart: down up ## Restart the local stack

.PHONY: logs
logs: ## Tail logs (usage: make logs or make logs s=crate-api)
	@if [ -n "$(s)" ]; then \
		$(DC_LOCAL) logs -f $(s); \
	else \
		$(DC_LOCAL) logs -f; \
	fi

.PHONY: ps
ps: ## Show dev service status
	@$(DC_DEV) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
	@echo ""
	@echo "$(YELLOW)Frontends:$(NC)"
	@-pgrep -af "vite.*5173" > /dev/null 2>&1 && echo "  Admin:  http://localhost:5173 (running)" || echo "  Admin:  not running"
	@-pgrep -af "vite.*5174" > /dev/null 2>&1 && echo "  Listen: http://localhost:5174 (running)" || echo "  Listen: not running"
	@-pgrep -af "vite.*5175" > /dev/null 2>&1 && echo "  Docs:   http://localhost:5175 (running)" || echo "  Docs:   not running"
	@-pgrep -af "vite.*5176" > /dev/null 2>&1 && echo "  Site:   http://localhost:5176 (running)" || echo "  Site:   not running"
	@-pgrep -af "vite.*5177" > /dev/null 2>&1 && echo "  APIRef: http://localhost:5177 (running)" || echo "  APIRef: not running"

.PHONY: pull
pull: ## Pull images for the local stack
	@$(DC_LOCAL) pull
	@echo "$(GREEN)Images updated$(NC)"

.PHONY: shell
shell: ## Open a shell in a service (usage: make shell s=crate-api)
	@if [ -z "$(s)" ]; then echo "$(RED)Specify a service: make shell s=crate-api$(NC)"; exit 1; fi
	@$(DC_LOCAL) exec $(s) sh

# ===========================================================================
# SETUP LOCAL
# ===========================================================================

.PHONY: setup
setup: _check-deps _create-network _generate-certs _setup-hosts _create-dirs ## Initial local environment setup
	@echo "$(GREEN)Setup complete. Run 'make up' to start the stack$(NC)"

.PHONY: _check-deps
_check-deps:
	@command -v docker >/dev/null 2>&1 || { echo "$(RED)Docker is not installed$(NC)"; exit 1; }
	@command -v mkcert >/dev/null 2>&1 || { echo "$(YELLOW)Installing mkcert...$(NC)"; brew install mkcert; }
	@mkcert -install 2>/dev/null || true

.PHONY: _create-network
_create-network:
	@docker network inspect crate >/dev/null 2>&1 || docker network create crate
	@echo "$(GREEN)crate network ready$(NC)"

.PHONY: _check-network
_check-network:
	@docker network inspect crate >/dev/null 2>&1 || { echo "$(RED)The crate network does not exist. Run 'make setup'$(NC)"; exit 1; }

.PHONY: _generate-certs
_generate-certs:
	@echo "$(YELLOW)Generating local TLS certificates...$(NC)"
	@cd data/traefik/local/certs && mkcert \
		"$(LOCAL_DOMAIN)" \
		"*.$(LOCAL_DOMAIN)" \
		&& mv $(LOCAL_DOMAIN)+1.pem $(LOCAL_DOMAIN).pem \
		&& mv $(LOCAL_DOMAIN)+1-key.pem $(LOCAL_DOMAIN)-key.pem
	@echo "$(GREEN)Certificates generated$(NC)"

.PHONY: _setup-hosts
_setup-hosts:
	@echo "$(YELLOW)Configuring /etc/hosts (requires sudo)...$(NC)"
	@for host in $(LOCAL_HOSTS); do \
		if ! grep -q "$$host.$(LOCAL_DOMAIN)" /etc/hosts; then \
			echo "127.0.0.1 $$host.$(LOCAL_DOMAIN)" | sudo tee -a /etc/hosts >/dev/null; \
		fi; \
	done
	@echo "$(GREEN)/etc/hosts configured$(NC)"

.PHONY: _create-dirs
_create-dirs:
	@mkdir -p data/{traefik/local/certs,tidarr,tidalrr,slskd,soulsync/{config,logs},nginx/{html,conf.d,logs}}
	@mkdir -p media/{music,downloads/{tidal/{incomplete,albums,tracks,playlists,videos},soulseek/incomplete}}
	@echo "$(GREEN)Directories created$(NC)"

# ===========================================================================
# DEPLOY (production)
# ===========================================================================

.PHONY: deploy
deploy: ## Deploy by pulling pre-built images from GHCR, syncing config, and restarting
	@echo "$(YELLOW)Ensuring directories exist...$(NC)"
	@$(SSH) "mkdir -p $(SERVER_PATH)/media/downloads/soulseek/incomplete $(SERVER_PATH)/media/downloads/tidal/incomplete && chown -R $(shell grep PUID .env 2>/dev/null | cut -d= -f2 || echo 1000):$(shell grep PGID .env 2>/dev/null | cut -d= -f2 || echo 1000) $(SERVER_PATH)/media/downloads"
	@echo "$(YELLOW)Syncing config...$(NC)"
	@# docker-compose.project.yaml is the overlay that adds crate-site
	@# and crate-docs (the official project surfaces). The remote commands
	@# below include it explicitly so deploys do not depend on COMPOSE_FILE
	@# being present in the server's .env.
	@scp docker-compose.yaml docker-compose.project.yaml .env $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/
	@rsync -az \
		--exclude='node_modules' --exclude='dist' --exclude='__pycache__' \
		--exclude='.vite' --exclude='*.tsbuildinfo' \
		--exclude='bin/' --exclude='crate/' --exclude='ui/' --exclude='listen/' \
		--exclude='requirements.txt' --exclude='Dockerfile' --exclude='tests/' \
		app/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/app/
	@# docs/ is consumed by the crate-docs build via COPY docs/ /docs/,
	@# so it must exist on the server whenever we might re-build (fallback
	@# path). Synced here so the server stays consistent even on pull-only
	@# deploys.
	@rsync -az --delete docs/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/docs/
	@echo "$(YELLOW)Pulling images (GHCR + external services)...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) pull --ignore-pull-failures"
	@echo "$(YELLOW)Restarting services (no local build)...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) up -d --no-build --remove-orphans"
	@echo "$(GREEN)Deploy complete$(NC)"

.PHONY: deploy-build
deploy-build: ## Deploy by building on the server (GHCR fallback)
	@echo "$(YELLOW)Syncing files...$(NC)"
	@scp docker-compose.yaml docker-compose.project.yaml .env $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/
	@rsync -az --delete \
		--exclude='node_modules' --exclude='dist' --exclude='__pycache__' \
		--exclude='.vite' --exclude='*.tsbuildinfo' \
		--exclude='bin/' \
		app/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/app/
	@# crate-docs Dockerfile uses the repo root as build context and needs
	@# the top-level docs/ directory for the markdown files embedded at
	@# build time. Without this the build fails on COPY docs/ /docs/.
	@rsync -az --delete docs/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/docs/
	@echo "$(YELLOW)Building services on the server...$(NC)"
	@# Build every buildable service in the canonical project stack,
	@# including the project overlay that defines crate-site + crate-docs.
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) build"
	@echo "$(YELLOW)Pulling external images...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) pull --ignore-buildable"
	@echo "$(YELLOW)Restarting services...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) up -d"
	@echo "$(GREEN)Deploy complete$(NC)"

.PHONY: deploy-sync
deploy-sync: ## Sync files to the server without restarting services
	@scp docker-compose.yaml docker-compose.project.yaml .env $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/
	@rsync -az --delete \
		--exclude='node_modules' --exclude='dist' --exclude='__pycache__' \
		--exclude='.vite' --exclude='*.tsbuildinfo' \
		--exclude='bin/' \
		app/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/app/
	@rsync -az --delete docs/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/docs/

.PHONY: deploy-restart
deploy-restart: ## Restart remote services without syncing files
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) up -d"

.PHONY: deploy-pull
deploy-pull: ## Pull images on the remote server
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) pull --ignore-buildable"

.PHONY: deploy-logs
deploy-logs: ## Tail remote logs (usage: make deploy-logs s=crate-api)
	@if [ -n "$(s)" ]; then \
		$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) logs -f --tail=100 $(s)"; \
	else \
		$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) logs -f --tail=100"; \
	fi

.PHONY: deploy-ps
deploy-ps: ## Show remote service status
	@$(SSH) "cd $(SERVER_PATH) && $(REMOTE_DC) ps --format 'table {{.Name}}\t{{.Status}}'"

.PHONY: deploy-shell
deploy-shell: ## Open a remote shell in a service (usage: make deploy-shell s=crate-api)
	@if [ -z "$(s)" ]; then echo "$(RED)Specify a service: make deploy-shell s=crate-api$(NC)"; exit 1; fi
	@$(SSH) -t "cd $(SERVER_PATH) && $(REMOTE_DC) exec $(s) sh"

.PHONY: deploy-ssh
deploy-ssh: ## Open an SSH session to the server
	@$(SSH)

# ===========================================================================
# UTILIDADES
# ===========================================================================

.PHONY: lib-scan
lib-scan: ## Scan the music library for issues
	@$(DC_LOCAL) run --rm crate-worker scan

.PHONY: lib-fix
lib-fix: ## Run fixers in dry-run mode
	@$(DC_LOCAL) run --rm crate-worker fix --dry-run

.PHONY: lib-fix-apply
lib-fix-apply: ## Apply fixer changes to the library
	@echo "$(RED)WARNING: This will modify files in the music library$(NC)"
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || { echo "Cancelled"; exit 1; }
	@$(DC_LOCAL) run --rm crate-worker fix --apply

.PHONY: lib-report
lib-report: ## Generate a library health report
	@$(DC_LOCAL) run --rm crate-worker report

.PHONY: lib-build-ui
lib-build-ui: ## Build the admin UI image
	@$(DC_LOCAL) build crate-ui
	@echo "$(GREEN)Admin UI image built$(NC)"

.PHONY: clean
clean: ## Stop the local stack and clean up orphaned resources
	@$(DC_LOCAL) down --remove-orphans
	@echo "$(GREEN)Cleanup complete$(NC)"

.PHONY: nuke
nuke: ## Stop the local stack and remove containers, volumes, and orphaned resources (DESTRUCTIVE)
	@echo "$(RED)WARNING: This will remove containers and volumes$(NC)"
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || { echo "Cancelled"; exit 1; }
	@$(DC_LOCAL) down -v --remove-orphans

.PHONY: update
update: pull up ## Pull images and restart the local stack

.PHONY: hosts-show
hosts-show: ## Show configured local domains
	@echo "$(GREEN)Local domains:$(NC)"
	@for host in $(LOCAL_HOSTS); do \
		echo "  https://$$host.$(LOCAL_DOMAIN)"; \
	done

# ===========================================================================
# LOCAL DNS (*.crate.local wildcard)
# ===========================================================================

.PHONY: dns-setup
dns-setup: ## Setup local DNS wildcard for *.crate.local → 127.0.0.1 (requires sudo)
	@./scripts/setup-local-dns.sh

.PHONY: trust-local-ca
trust-local-ca: ## Trust Caddy's local CA for HTTPS (run after first 'make dev', requires sudo)
	@docker cp crate-dev-caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt
	@sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt
	@echo "$(GREEN)Caddy local CA trusted. Restart your browser.$(NC)"

# ===========================================================================
# CAPACITOR (mobile native builds)
# ===========================================================================

CAP_DIR := app/listen
CAP_IOS_TARGET ?= $(shell cd $(CAP_DIR) && npx cap run ios --list 2>/dev/null | grep "iPhone.*Pro " | head -1 | awk '{print $$NF}')

# Android Studio JBR + SDK paths (required for Gradle/emulator)
export JAVA_HOME ?= $(HOME)/Applications/Android Studio.app/Contents/jbr/Contents/Home
export ANDROID_HOME ?= $(HOME)/Library/Android/sdk

.PHONY: cap-build
cap-build: ## Build Listen for Capacitor (bakes production API URL)
	@cd $(CAP_DIR) && npm run build:cap
	@echo "$(GREEN)Capacitor build + sync done$(NC)"

.PHONY: cap-ios
cap-ios: ## Build and run Listen on iOS Simulator
	@cd $(CAP_DIR) && npm run build:cap
	@echo "$(YELLOW)Launching iOS Simulator...$(NC)"
	@cd $(CAP_DIR) && npx cap run ios --target "$(CAP_IOS_TARGET)"

.PHONY: cap-ios-open
cap-ios-open: ## Open Listen iOS project in Xcode
	@cd $(CAP_DIR) && npx cap open ios

.PHONY: cap-android
cap-android: ## Build and run Listen on Android Emulator
	@cd $(CAP_DIR) && npm run build:cap
	@echo "$(YELLOW)Launching Android Emulator...$(NC)"
	@cd $(CAP_DIR) && npx cap run android

.PHONY: cap-android-open
cap-android-open: ## Open Listen Android project in Android Studio
	@cd $(CAP_DIR) && npx cap open android

.PHONY: cap-ios-list
cap-ios-list: ## List available iOS Simulator targets
	@cd $(CAP_DIR) && npx cap run ios --list

.PHONY: cap-android-list
cap-android-list: ## List available Android Emulator targets
	@cd $(CAP_DIR) && npx cap run android --list

# ===========================================================================
# HELP
# ===========================================================================

.PHONY: help
help: ## Show this help
	@echo ""
	@echo "$(GREEN)Crate$(NC) - Self-hosted music platform"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "Example: $(YELLOW)make logs s=crate-api$(NC)"
	@echo ""
