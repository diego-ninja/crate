# MusicDock - Stack de musica self-hosted
# =========================================

# Servidor remoto
SERVER_HOST   := 104.152.210.73
SERVER_USER   := root
SERVER_PATH   := /home/crate/crate
SSH           := ssh $(SERVER_USER)@$(SERVER_HOST)
SCP           := scp

# Compose
DC            := docker compose
DC_PROD       := $(DC) -f docker-compose.yaml
DC_LOCAL      := $(DC) -f docker-compose.yaml -f docker-compose.override.yaml

# Dominios locales
LOCAL_DOMAIN  := crate.local
LOCAL_HOSTS   := traefik auth collection play search web api admin ai

# Colores
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RED    := \033[0;31m
NC     := \033[0m

.DEFAULT_GOAL := help

# ===========================================================================
# DEV (entorno de desarrollo local)
# ===========================================================================

DC_DEV := $(DC) -f docker-compose.dev.yaml

.PHONY: dev
dev: ## Levantar backend (Postgres + Redis + API + Worker) + frontend dev servers
	@$(DC_DEV) up -d --build
	@echo "$(GREEN)Backend levantado (Postgres, Redis, API :8585, Worker)$(NC)"
	@echo ""
	@echo "  API:    http://localhost:8585"
	@echo "  Login:  yosoy@diego.ninja / admin"
	@echo ""
	@echo "Arrancando frontends..."
	@cd app/ui && npm install --silent 2>/dev/null; cd ../..
	@cd app/listen && npm install --silent 2>/dev/null; cd ../..
	@(cd app/ui && npx vite --port 5173 --host > /dev/null 2>&1 &)
	@(cd app/listen && npx vite --port 5174 --host > /dev/null 2>&1 &)
	@sleep 2
	@echo "  $(GREEN)Admin:$(NC)  http://localhost:5173"
	@echo "  $(GREEN)Listen:$(NC) http://localhost:5174"
	@echo ""
	@echo "$(GREEN)Todo arrancado. make dev-down para parar.$(NC)"

.PHONY: dev-back
dev-back: ## Solo backend (Postgres + Redis + API + Worker) sin frontends
	@$(DC_DEV) up -d --build
	@echo "$(GREEN)Backend levantado$(NC)"
	@echo "  API: http://localhost:8585"

.PHONY: dev-admin
dev-admin: ## Arrancar solo Admin UI dev server (:5173)
	@cd app/ui && npx vite --port 5173 --host

.PHONY: dev-listen
dev-listen: ## Arrancar solo Listen dev server (:5174)
	@cd app/listen && npx vite --port 5174 --host

.PHONY: dev-down
dev-down: ## Parar todo (backend + frontends)
	@$(DC_DEV) down
	@-pkill -f "vite.*517" 2>/dev/null || true
	@echo "$(GREEN)Todo parado$(NC)"

.PHONY: dev-logs
dev-logs: ## Ver logs de backend (uso: make dev-logs o make dev-logs s=worker)
	@if [ -n "$(s)" ]; then \
		$(DC_DEV) logs -f $(s); \
	else \
		$(DC_DEV) logs -f; \
	fi

.PHONY: dev-rebuild
dev-rebuild: ## Rebuild y restart todo
	@$(DC_DEV) up -d --build --force-recreate
	@-pkill -f "vite.*517" 2>/dev/null || true
	@(cd app/ui && npx vite --port 5173 --host > /dev/null 2>&1 &)
	@(cd app/listen && npx vite --port 5174 --host > /dev/null 2>&1 &)
	@sleep 2
	@echo "$(GREEN)Todo rebuildeado$(NC)"

.PHONY: dev-reset
dev-reset: ## Reset entorno dev (borra datos, para todo)
	@$(DC_DEV) down -v
	@-pkill -f "vite.*517" 2>/dev/null || true
	@echo "$(GREEN)Dev reseteado (datos borrados)$(NC)"

.PHONY: dev-test
dev-test: ## Correr tests en el contenedor dev
	@$(DC_DEV) exec worker pytest tests/ -v

.PHONY: regression-api
regression-api: ## Contratos backend criticos (Explore/search/system playlists)
	@$(DC_DEV) exec worker pytest tests/test_explore_contracts.py tests/test_upload_contracts.py -q

.PHONY: regression-radio
regression-radio: ## Contratos de radio usando una imagen efimera del backend del branch actual
	@docker build -t crate-radio-tests ./app
	@docker run --rm --entrypoint pytest crate-radio-tests tests/test_radio_contracts.py -q

.PHONY: regression-smoke
regression-smoke: ## Smoke real contra el entorno dev autenticado
	@python3 scripts/regression_smoke.py

.PHONY: regression-min
regression-min: regression-api regression-smoke ## Suite minima de regresion antes de tocar listen

# ===========================================================================
# LOCAL (stack completo con Traefik)
# ===========================================================================

.PHONY: up
up: _check-network ## Levantar stack local
	@$(DC_LOCAL) up -d
	@echo "$(GREEN)Stack local levantado$(NC)"
	@echo "Dashboard: https://traefik.$(LOCAL_DOMAIN)"

.PHONY: down
down: ## Parar stack local
	@$(DC_LOCAL) down

.PHONY: restart
restart: down up ## Reiniciar stack local

.PHONY: logs
logs: ## Ver logs (uso: make logs o make logs s=navidrome)
	@if [ -n "$(s)" ]; then \
		$(DC_LOCAL) logs -f $(s); \
	else \
		$(DC_LOCAL) logs -f; \
	fi

.PHONY: ps
ps: ## Estado de los servicios (dev)
	@$(DC_DEV) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
	@echo ""
	@echo "$(YELLOW)Frontends:$(NC)"
	@-pgrep -af "vite.*5173" > /dev/null 2>&1 && echo "  Admin:  http://localhost:5173 (running)" || echo "  Admin:  not running"
	@-pgrep -af "vite.*5174" > /dev/null 2>&1 && echo "  Listen: http://localhost:5174 (running)" || echo "  Listen: not running"

.PHONY: pull
pull: ## Pull de imagenes en local
	@$(DC_LOCAL) pull
	@echo "$(GREEN)Imagenes actualizadas$(NC)"

.PHONY: shell
shell: ## Shell en un servicio (uso: make shell s=navidrome)
	@if [ -z "$(s)" ]; then echo "$(RED)Especifica servicio: make shell s=navidrome$(NC)"; exit 1; fi
	@$(DC_LOCAL) exec $(s) sh

# ===========================================================================
# SETUP LOCAL
# ===========================================================================

.PHONY: setup
setup: _check-deps _create-network _generate-certs _setup-hosts _create-dirs ## Setup inicial del entorno local
	@echo "$(GREEN)Setup completado. Ejecuta 'make up' para levantar el stack$(NC)"

.PHONY: _check-deps
_check-deps:
	@command -v docker >/dev/null 2>&1 || { echo "$(RED)Docker no instalado$(NC)"; exit 1; }
	@command -v mkcert >/dev/null 2>&1 || { echo "$(YELLOW)Instalando mkcert...$(NC)"; brew install mkcert; }
	@mkcert -install 2>/dev/null || true

.PHONY: _create-network
_create-network:
	@docker network inspect crate >/dev/null 2>&1 || docker network create crate
	@echo "$(GREEN)Red crate OK$(NC)"

.PHONY: _check-network
_check-network:
	@docker network inspect crate >/dev/null 2>&1 || { echo "$(RED)Red crate no existe. Ejecuta 'make setup'$(NC)"; exit 1; }

.PHONY: _generate-certs
_generate-certs:
	@echo "$(YELLOW)Generando certificados TLS locales...$(NC)"
	@cd data/traefik/local/certs && mkcert \
		"$(LOCAL_DOMAIN)" \
		"*.$(LOCAL_DOMAIN)" \
		&& mv $(LOCAL_DOMAIN)+1.pem $(LOCAL_DOMAIN).pem \
		&& mv $(LOCAL_DOMAIN)+1-key.pem $(LOCAL_DOMAIN)-key.pem
	@echo "$(GREEN)Certificados generados$(NC)"

.PHONY: _setup-hosts
_setup-hosts:
	@echo "$(YELLOW)Configurando /etc/hosts (requiere sudo)...$(NC)"
	@for host in $(LOCAL_HOSTS); do \
		if ! grep -q "$$host.$(LOCAL_DOMAIN)" /etc/hosts; then \
			echo "127.0.0.1 $$host.$(LOCAL_DOMAIN)" | sudo tee -a /etc/hosts >/dev/null; \
		fi; \
	done
	@echo "$(GREEN)/etc/hosts configurado$(NC)"

.PHONY: _create-dirs
_create-dirs:
	@mkdir -p data/{traefik/local/certs,authelia/{secrets,config,logs},lidarr,navidrome,tidarr,tidalrr,slskd,soulsync/{config,logs},nginx/{html,conf.d,logs}}
	@mkdir -p media/{music,downloads/{tidal/{incomplete,albums,tracks,playlists,videos},soulseek/incomplete}}
	@echo "$(GREEN)Directorios creados$(NC)"

# ===========================================================================
# DEPLOY (produccion)
# ===========================================================================

.PHONY: deploy
deploy: ## Deploy: pull pre-built images from GHCR + sync config + restart
	@echo "$(YELLOW)Asegurando directorios...$(NC)"
	@$(SSH) "mkdir -p $(SERVER_PATH)/media/downloads/soulseek/incomplete $(SERVER_PATH)/media/downloads/tidal/incomplete && chown -R $(shell grep PUID .env 2>/dev/null | cut -d= -f2 || echo 1000):$(shell grep PGID .env 2>/dev/null | cut -d= -f2 || echo 1000) $(SERVER_PATH)/media/downloads"
	@echo "$(YELLOW)Sincronizando config...$(NC)"
	@scp docker-compose.yaml .env $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/
	@rsync -az \
		--exclude='node_modules' --exclude='dist' --exclude='__pycache__' \
		--exclude='.vite' --exclude='*.tsbuildinfo' \
		--exclude='bin/' --exclude='crate/' --exclude='ui/' --exclude='listen/' \
		--exclude='requirements.txt' --exclude='Dockerfile' --exclude='tests/' \
		app/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/app/
	@echo "$(YELLOW)Pulling imagenes (GHCR + externas)...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml pull --ignore-pull-failures"
	@echo "$(YELLOW)Reiniciando servicios (sin build local)...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml up -d --no-build --remove-orphans"
	@echo "$(GREEN)Deploy completado$(NC)"

.PHONY: deploy-build
deploy-build: ## Deploy con build en servidor (sin GHCR, fallback)
	@echo "$(YELLOW)Sincronizando ficheros...$(NC)"
	@scp docker-compose.yaml .env $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/
	@rsync -az --delete \
		--exclude='node_modules' --exclude='dist' --exclude='__pycache__' \
		--exclude='.vite' --exclude='*.tsbuildinfo' \
		--exclude='bin/' \
		app/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/app/
	@echo "$(YELLOW)Building servicios en servidor...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml build crate-api crate-worker crate-ui crate-listen"
	@echo "$(YELLOW)Pulling imagenes externas...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml pull --ignore-buildable"
	@echo "$(YELLOW)Reiniciando servicios...$(NC)"
	@$(SSH) "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml up -d"
	@echo "$(GREEN)Deploy completado$(NC)"

.PHONY: deploy-sync
deploy-sync: ## Solo sincronizar ficheros al servidor (sin restart)
	@scp docker-compose.yaml .env $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/
	@rsync -az --delete \
		--exclude='node_modules' --exclude='dist' --exclude='__pycache__' \
		--exclude='.vite' --exclude='*.tsbuildinfo' \
		--exclude='bin/' \
		app/ $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/app/

.PHONY: deploy-restart
deploy-restart: ## Reiniciar servicios en remoto (sin sync)
	@$(SSH) "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml up -d"

.PHONY: deploy-pull
deploy-pull: ## Pull de imagenes en remoto
	@$(SSH) "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml pull --ignore-buildable"

.PHONY: deploy-logs
deploy-logs: ## Ver logs en remoto (uso: make deploy-logs s=navidrome)
	@if [ -n "$(s)" ]; then \
		$(SSH) "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml logs -f --tail=100 $(s)"; \
	else \
		$(SSH) "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml logs -f --tail=100"; \
	fi

.PHONY: deploy-ps
deploy-ps: ## Estado de servicios en remoto
	@$(SSH) "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml ps --format 'table {{.Name}}\t{{.Status}}'"

.PHONY: deploy-shell
deploy-shell: ## Shell remoto en un servicio (uso: make deploy-shell s=navidrome)
	@if [ -z "$(s)" ]; then echo "$(RED)Especifica servicio: make deploy-shell s=navidrome$(NC)"; exit 1; fi
	@$(SSH) -t "cd $(SERVER_PATH) && docker compose -f docker-compose.yaml exec $(s) sh"

.PHONY: deploy-ssh
deploy-ssh: ## SSH al servidor
	@$(SSH)

.PHONY: _confirm-deploy
_confirm-deploy:
	@echo "$(YELLOW)Deploy a $(SERVER_HOST) ($(SERVER_PATH))$(NC)"
	@read -p "Continuar? [y/N] " confirm && [ "$$confirm" = "y" ] || { echo "Cancelado"; exit 1; }

# ===========================================================================
# UTILIDADES
# ===========================================================================

.PHONY: lib-scan
lib-scan: ## Scan de la biblioteca de musica (busca problemas)
	@$(DC_LOCAL) run --rm crate-worker scan

.PHONY: lib-fix
lib-fix: ## Fix con dry-run (muestra que haria sin tocar nada)
	@$(DC_LOCAL) run --rm crate-worker fix --dry-run

.PHONY: lib-fix-apply
lib-fix-apply: ## Fix real (aplica correcciones con confianza >= umbral)
	@echo "$(RED)ATENCION: Esto modificara ficheros en la biblioteca$(NC)"
	@read -p "Seguro? [y/N] " confirm && [ "$$confirm" = "y" ] || { echo "Cancelado"; exit 1; }
	@$(DC_LOCAL) run --rm crate-worker fix --apply

.PHONY: lib-report
lib-report: ## Genera informe de salud de la biblioteca
	@$(DC_LOCAL) run --rm crate-worker report

.PHONY: lib-build-ui
lib-build-ui: ## Build de la UI del app
	@$(DC_LOCAL) build crate-ui
	@echo "$(GREEN)Librarian UI construida$(NC)"

.PHONY: clean
clean: ## Parar stack y limpiar contenedores/redes huerfanas
	@$(DC_LOCAL) down --remove-orphans
	@echo "$(GREEN)Limpieza completada$(NC)"

.PHONY: nuke
nuke: ## Parar stack, eliminar contenedores, volumenes y redes (DESTRUCTIVO)
	@echo "$(RED)ATENCION: Esto eliminara contenedores y volumenes$(NC)"
	@read -p "Seguro? [y/N] " confirm && [ "$$confirm" = "y" ] || { echo "Cancelado"; exit 1; }
	@$(DC_LOCAL) down -v --remove-orphans

.PHONY: update
update: pull up ## Pull de imagenes + reiniciar

.PHONY: hosts-show
hosts-show: ## Mostrar dominios locales configurados
	@echo "$(GREEN)Dominios locales:$(NC)"
	@for host in $(LOCAL_HOSTS); do \
		echo "  https://$$host.$(LOCAL_DOMAIN)"; \
	done

# ===========================================================================
# LOCAL DNS (*.crate.local wildcard)
# ===========================================================================

.PHONY: dns-setup
dns-setup: ## Setup local DNS wildcard for *.crate.local → 127.0.0.1 (requires sudo)
	@./scripts/setup-local-dns.sh

# ===========================================================================
# CAPACITOR (mobile native builds)
# ===========================================================================

CAP_DIR := app/listen
CAP_IOS_TARGET ?= $(shell cd $(CAP_DIR) && npx cap run ios --list 2>/dev/null | grep "iPhone.*Pro " | head -1 | awk '{print $$NF}')

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
help: ## Mostrar esta ayuda
	@echo ""
	@echo "$(GREEN)MusicDock$(NC) - Stack de musica self-hosted"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "Ejemplo: $(YELLOW)make logs s=navidrome$(NC)"
	@echo ""
