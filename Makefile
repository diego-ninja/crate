# Crate - Self-hosted music platform
# ==================================

# Remote server
SERVER_HOST   := 95.216.3.27
SERVER_USER   := crate
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

DC_DEV := $(DC) -f docker-compose.dev.yaml -f docker-compose.readplane.dev.yaml
DEV_CONTAINERS := crate-dev-api crate-dev-readplane crate-dev-worker crate-dev-maintenance-worker crate-dev-analysis-worker crate-dev-playback-worker crate-dev-postgres crate-dev-redis crate-dev-slskd crate-dev-caddy crate-dev-readplane-proxy

.PHONY: dev
dev: ## Start backend (Postgres + Redis + API + Worker + Readplane + Caddy) and frontend dev servers
	@# Kill any leftover Vite processes from previous runs via PID files
	@if [ -d .vite ]; then \
		for pidfile in .vite/*.pid; do \
			if [ -f "$$pidfile" ]; then \
				pid=$$(cat "$$pidfile"); \
				kill -9 "$$pid" 2>/dev/null || true; \
				rm -f "$$pidfile"; \
			fi; \
		done; \
	fi
	@-lsof -ti :5173,:5174,:5175,:5176,:5177 2>/dev/null | xargs kill -9 2>/dev/null || true
	@-pkill -f "vite.*--port 5173" 2>/dev/null || true
	@-pkill -f "vite.*--port 5174" 2>/dev/null || true
	@-pkill -f "vite.*--port 5175" 2>/dev/null || true
	@-pkill -f "vite.*--port 5176" 2>/dev/null || true
	@-pkill -f "vite.*--port 5177" 2>/dev/null || true
	@-pkill -f "vite.*app/ui" 2>/dev/null || true
	@-pkill -f "vite.*app/listen" 2>/dev/null || true
	@-pkill -f "vite.*app/docs" 2>/dev/null || true
	@-pkill -f "vite.*app/site" 2>/dev/null || true
	@-pkill -f "vite.*app/reference" 2>/dev/null || true
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@sleep 0.5
	@$(MAKE) --no-print-directory _ensure-dev-certs
	@$(DC_DEV) up -d --build
	@echo "$(GREEN)Backend is up (Postgres, Redis, API, Worker, Readplane, Caddy)$(NC)"
	@echo ""
	@echo "Starting frontends..."
	@rm -rf .vite/deps app/ui/node_modules/.vite app/listen/node_modules/.vite node_modules/.vite 2>/dev/null || true
	@mkdir -p .vite
	@npm install --silent 2>/dev/null
	@cd app/docs && npm install --silent 2>/dev/null; cd ../..
	@cd app/site && npm install --silent 2>/dev/null; cd ../..
	@(nohup npm run --workspace=app/ui dev -- --port 5173 --strictPort --host > .vite/admin.log 2>&1 < /dev/null & echo $$! > .vite/admin.pid)
	@(nohup npm run --workspace=app/listen dev -- --port 5174 --strictPort --host > .vite/listen.log 2>&1 < /dev/null & echo $$! > .vite/listen.pid)
	@(cd app/docs; nohup npm exec vite -- --port 5175 --strictPort --host > ../../.vite/docs.log 2>&1 < /dev/null & echo $$! > ../../.vite/docs.pid)
	@(cd app/site; nohup npm exec vite -- --port 5176 --strictPort --host > ../../.vite/site.log 2>&1 < /dev/null & echo $$! > ../../.vite/site.pid)
	@sleep 2
	@echo ""
	@echo "  $(GREEN)Admin:$(NC)  https://admin.dev.lespedants.org"
	@echo "  $(GREEN)Listen:$(NC) https://listen.dev.lespedants.org"
	@echo "  $(GREEN)Docs:$(NC)   https://docs.dev.cratemusic.app"
	@echo "  $(GREEN)Site:$(NC)   https://www.dev.cratemusic.app"
	@echo "  $(GREEN)API:$(NC)    https://api.dev.lespedants.org"
	@echo "  $(GREEN)Readplane:$(NC) http://localhost:8686"
	@echo "  Login:  admin@cratemusic.app / admin"
	@echo ""
	@echo "$(GREEN)Everything is running. Use make dev-down to stop it.$(NC)"

.PHONY: dev-back
dev-back: ## Start only the backend (Postgres + Redis + API + Worker + Readplane)
	@$(DC_DEV) up -d --build
	@echo "$(GREEN)Backend is up$(NC)"
	@echo "  API: http://localhost:8585"
	@echo "  Readplane: http://localhost:8686"

.PHONY: dev-admin
dev-admin: ## Start only the Admin UI dev server (:5173)
	@npm run --workspace=app/ui dev -- --port 5173 --host

.PHONY: dev-listen
dev-listen: ## Start only the Listen dev server (:5174)
	@npm run --workspace=app/listen dev -- --port 5174 --host

.PHONY: listen-story-card
listen-story-card: ## Render an Instagram Story share-card preview (vars: kind title subtitle image out)
	@node app/listen/scripts/render-instagram-story-card.mjs \
		--kind "$(or $(kind),album)" \
		--title "$(or $(title),FENIAN)" \
		--subtitle "$(or $(subtitle),Album by KNEECAP)" \
		--image "$(image)" \
		--out "$(or $(out),/tmp/crate-instagram-story.svg)"
	@if command -v open >/dev/null 2>&1; then \
		open "$(or $(out),/tmp/crate-instagram-story.svg)" 2>/dev/null || \
		open -a "Google Chrome" "$(or $(out),/tmp/crate-instagram-story.svg)" 2>/dev/null || \
		open -a "Safari" "$(or $(out),/tmp/crate-instagram-story.svg)" 2>/dev/null || \
		echo "Preview: $(or $(out),/tmp/crate-instagram-story.svg)"; \
	elif command -v xdg-open >/dev/null 2>&1; then \
		xdg-open "$(or $(out),/tmp/crate-instagram-story.svg)" >/dev/null 2>&1 || \
		echo "Preview: $(or $(out),/tmp/crate-instagram-story.svg)"; \
	else \
		echo "Preview: $(or $(out),/tmp/crate-instagram-story.svg)"; \
	fi

.PHONY: dev-docs
dev-docs: ## Start only the docs dev server (:5175)
	@cd app/docs && npx vite --port 5175 --host

.PHONY: dev-site
dev-site: ## Start only the site dev server (:5176)
	@cd app/site && npx vite --port 5176 --host

.PHONY: dev-down
dev-down: ## Stop everything (backend + frontends)
	@$(DC_DEV) down
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@if [ -d .vite ]; then \
		for pidfile in .vite/*.pid; do \
			if [ -f "$$pidfile" ]; then \
				pid=$$(cat "$$pidfile"); \
				kill -9 "$$pid" 2>/dev/null || true; \
				rm -f "$$pidfile"; \
			fi; \
		done; \
	fi
	@-lsof -ti :5173,:5174,:5175,:5176,:5177 2>/dev/null | xargs kill -9 2>/dev/null || true
	@-pkill -f "vite.*--port 5173" 2>/dev/null || true
	@-pkill -f "vite.*--port 5174" 2>/dev/null || true
	@-pkill -f "vite.*--port 5175" 2>/dev/null || true
	@-pkill -f "vite.*--port 5176" 2>/dev/null || true
	@-pkill -f "vite.*--port 5177" 2>/dev/null || true
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
	@if [ -d .vite ]; then \
		for pidfile in .vite/*.pid; do \
			if [ -f "$$pidfile" ]; then \
				pid=$$(cat "$$pidfile"); \
				kill -9 "$$pid" 2>/dev/null || true; \
				rm -f "$$pidfile"; \
			fi; \
		done; \
	fi
	@-lsof -ti :5173,:5174,:5175,:5176,:5177 2>/dev/null | xargs kill -9 2>/dev/null || true
	@-pkill -f "vite.*--port 5173" 2>/dev/null || true
	@-pkill -f "vite.*--port 5174" 2>/dev/null || true
	@-pkill -f "vite.*--port 5175" 2>/dev/null || true
	@-pkill -f "vite.*--port 5176" 2>/dev/null || true
	@-pkill -f "vite.*--port 5177" 2>/dev/null || true
	@-pkill -f "vite.*app/ui" 2>/dev/null || true
	@-pkill -f "vite.*app/listen" 2>/dev/null || true
	@-pkill -f "vite.*app/docs" 2>/dev/null || true
	@-pkill -f "vite.*app/site" 2>/dev/null || true
	@-pkill -f "vite.*app/reference" 2>/dev/null || true
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@sleep 0.5
	@$(DC_DEV) up -d --build --force-recreate
	@rm -rf .vite/deps app/ui/node_modules/.vite app/listen/node_modules/.vite node_modules/.vite 2>/dev/null || true
	@mkdir -p .vite
	@(nohup npm run --workspace=app/ui dev -- --port 5173 --strictPort --host > .vite/admin.log 2>&1 < /dev/null & echo $$! > .vite/admin.pid)
	@(nohup npm run --workspace=app/listen dev -- --port 5174 --strictPort --host > .vite/listen.log 2>&1 < /dev/null & echo $$! > .vite/listen.pid)
	@(nohup npm --prefix app/docs exec vite -- --port 5175 --strictPort --host > .vite/docs.log 2>&1 < /dev/null & echo $$! > .vite/docs.pid)
	@(nohup npm --prefix app/site exec vite -- --port 5176 --strictPort --host > .vite/site.log 2>&1 < /dev/null & echo $$! > .vite/site.pid)
	@sleep 2
	@echo "$(GREEN)Everything rebuilt$(NC)"

.PHONY: dev-reset
dev-reset: ## Reset the dev environment (wipe data and stop everything)
	@$(DC_DEV) down -v
	@docker rm -f $(DEV_CONTAINERS) >/dev/null 2>&1 || true
	@if [ -d .vite ]; then \
		for pidfile in .vite/*.pid; do \
			if [ -f "$$pidfile" ]; then \
				pid=$$(cat "$$pidfile"); \
				kill -9 "$$pid" 2>/dev/null || true; \
				rm -f "$$pidfile"; \
			fi; \
		done; \
	fi
	@-lsof -ti :5173,:5174,:5175,:5176,:5177 2>/dev/null | xargs kill -9 2>/dev/null || true
	@-pkill -f "vite.*--port 5173" 2>/dev/null || true
	@-pkill -f "vite.*--port 5174" 2>/dev/null || true
	@-pkill -f "vite.*--port 5175" 2>/dev/null || true
	@-pkill -f "vite.*--port 5176" 2>/dev/null || true
	@-pkill -f "vite.*--port 5177" 2>/dev/null || true
	@-pkill -f "vite.*app/ui" 2>/dev/null || true
	@-pkill -f "vite.*app/listen" 2>/dev/null || true
	@-pkill -f "vite.*app/docs" 2>/dev/null || true
	@-pkill -f "vite.*app/site" 2>/dev/null || true
	@-pkill -f "vite.*app/reference" 2>/dev/null || true
	@echo "$(GREEN)Dev environment reset (data removed)$(NC)"

# ===========================================================================
# FEDERATION DEV (two-node local harness)
# ===========================================================================

DC_FED := COMPOSE_PROJECT_NAME=crate-federation-dev $(DC) -f docker-compose.federation-dev.yaml
FED_CONTAINERS := fed-a-api fed-a-readplane fed-a-worker fed-a-admin fed-a-listen fed-a-postgres fed-a-redis fed-b-api fed-b-readplane fed-b-worker fed-b-postgres fed-b-redis
FED_API_A := http://localhost:18585
FED_API_B := http://localhost:28585
FED_ADMIN_A := http://localhost:15173
FED_LISTEN_A := http://localhost:15174
FED_READPLANE_A := http://localhost:18686
FED_READPLANE_B := http://localhost:28686
FED_NODE_A_SERVICES := node-a-postgres node-a-redis node-a-api node-a-readplane node-a-worker node-a-admin node-a-listen

.PHONY: federation-dev-up-singleton
federation-dev-up-singleton: ## Start a real one-node federation harness
	@echo "$(YELLOW)Checking singleton port availability...$(NC)"
	@for port in 18585 18686 15173 15174 15433 16380; do \
		if lsof -ti :$$port >/dev/null 2>&1; then \
			echo "$(RED)Port $$port is already in use. Stop conflicting services first.$(NC)"; \
			exit 1; \
		fi; \
	done
	@bash scripts/federation-fixture-seed.sh
	@$(DC_FED) up -d --build $(FED_NODE_A_SERVICES)
	@ok=0; \
	for _ in $$(seq 1 60); do \
		if curl -fsS "$(FED_API_A)/api/status" >/dev/null 2>&1; then ok=1; break; fi; \
		sleep 2; \
	done; \
	if [ "$$ok" != "1" ]; then \
		echo "$(RED)Singleton API did not become ready: $(FED_API_A)$(NC)"; \
		exit 1; \
	fi
	@echo "$(GREEN)Singleton harness running: $(FED_API_A)$(NC)"

.PHONY: federation-dev-up
federation-dev-up: ## Start the two-node federation dev harness with Node A Admin and Listen
	@echo "$(YELLOW)Checking port availability...$(NC)"
	@for port in 18585 18686 28585 28686 15173 15174 15433 25433 16380 26380; do \
		if lsof -ti :$$port >/dev/null 2>&1; then \
			echo "$(RED)Port $$port is already in use. Stop conflicting services first.$(NC)"; \
			exit 1; \
		fi; \
	done
	@echo "$(YELLOW)Seeding fixtures...$(NC)"
	@bash scripts/federation-fixture-seed.sh
	@echo "$(YELLOW)Starting federation stack...$(NC)"
	@$(DC_FED) up -d --build
	@echo "$(YELLOW)Waiting for federation services...$(NC)"
	@for url in "$(FED_API_A)/api/status" "$(FED_API_B)/api/status" "$(FED_READPLANE_A)/readyz" "$(FED_READPLANE_B)/readyz"; do \
		ok=0; \
		for _ in $$(seq 1 60); do \
			if curl -fsS "$$url" >/dev/null 2>&1; then ok=1; break; fi; \
			sleep 2; \
		done; \
		if [ "$$ok" != "1" ]; then \
			echo "$(RED)Service did not become ready: $$url$(NC)"; \
			exit 1; \
		fi; \
	done
	@ok=0; \
	for _ in $$(seq 1 60); do \
		if curl -fsS "$(FED_ADMIN_A)" 2>/dev/null | grep -q '<div id="root"'; then ok=1; break; fi; \
		sleep 2; \
	done; \
	if [ "$$ok" != "1" ]; then \
		echo "$(RED)Admin did not become ready: $(FED_ADMIN_A)$(NC)"; \
		exit 1; \
	fi
	@ok=0; \
	for _ in $$(seq 1 60); do \
		if curl -fsS "$(FED_LISTEN_A)" 2>/dev/null | grep -q '<div id="root"'; then ok=1; break; fi; \
		sleep 2; \
	done; \
	if [ "$$ok" != "1" ]; then \
		echo "$(RED)Listen did not become ready: $(FED_LISTEN_A)$(NC)"; \
		exit 1; \
	fi
	@echo ""
	@echo "$(GREEN)Federation dev harness running:$(NC)"
	@echo "  Node A API: $(FED_API_A)"
	@echo "  Node A Readplane: $(FED_READPLANE_A)"
	@echo "  Node A Admin: $(FED_ADMIN_A)"
	@echo "  Node A Listen: $(FED_LISTEN_A)"
	@echo "  Node B API: $(FED_API_B)"
	@echo "  Node B Readplane: $(FED_READPLANE_B)"
	@echo ""
	@echo "  Next: make federation-dev-smoke && make federation-dev-e2e"

.PHONY: federation-dev-down
federation-dev-down: ## Stop the federation dev harness (preserves data volumes)
	@$(DC_FED) down
	@docker rm -f $(FED_CONTAINERS) >/dev/null 2>&1 || true
	@echo "$(GREEN)Federation stack stopped (data preserved)$(NC)"

.PHONY: federation-dev-reset
federation-dev-reset: ## Reset the federation dev harness (wipes data volumes)
	@$(DC_FED) down -v
	@docker rm -f $(FED_CONTAINERS) >/dev/null 2>&1 || true
	@rm -rf test-music-federation
	@echo "$(GREEN)Federation stack reset (volumes + fixtures removed)$(NC)"

.PHONY: federation-dev-seed
federation-dev-seed: ## Re-seed federation fixture directories only
	@rm -rf test-music-federation
	@bash scripts/federation-fixture-seed.sh
	@echo "$(GREEN)Fixtures re-seeded$(NC)"

.PHONY: federation-dev-logs
federation-dev-logs: ## Tail federation harness logs (usage: make federation-dev-logs s=fed-a-api)
	@if [ -n "$(s)" ]; then \
		$(DC_FED) logs -f $(s); \
	else \
		$(DC_FED) logs -f; \
	fi

.PHONY: federation-dev-smoke
federation-dev-smoke: ## Run federation smoke check
	@bash scripts/federation-smoke.sh

.PHONY: federation-dev-e2e
federation-dev-e2e: ## Pair nodes, sync fixtures, and verify cross-node search + playback
	@python3 scripts/federation-dev-e2e.py e2e

.PHONY: federation-dev-global-catalog-e2e
federation-dev-global-catalog-e2e: ## Verify Listen-ready global catalog search, artwork, and playback
	@python3 scripts/federation-dev-e2e.py global-catalog

.PHONY: federation-dev-playback-prepare-e2e
federation-dev-playback-prepare-e2e: ## Verify remote playback prepare, fallback, and ready variant flow
	@python3 scripts/federation-dev-e2e.py playback-prepare

.PHONY: federation-dev-import-e2e
federation-dev-import-e2e: ## Verify signed remote import, local identity, hashes, playback, and cleanup
	@CRATE_RUN_FEDERATION_E2E=1 PYTHONPATH=app uv run pytest app/tests/test_federation_import_e2e.py -q

.PHONY: federation-dev-singleton-e2e
federation-dev-singleton-e2e: ## Verify bootstrap, catalog, taxonomy, and playback with exactly one node
	@python3 scripts/federation-dev-e2e.py singleton

.PHONY: federation-dev-zero-downtime-e2e
federation-dev-zero-downtime-e2e: ## Probe catalog availability during singleton sync and reconciliation
	@python3 scripts/federation-dev-e2e.py zero-downtime

.PHONY: federation-dev-ps
federation-dev-ps: ## Show federation service status
	@$(DC_FED) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# ── Federation dev helpers ────────────────────────────────────────────────

.PHONY: federation-dev-pair
federation-dev-pair: ## Pair node A and B bidirectionally and grant Listen access
	@python3 scripts/federation-dev-e2e.py pair

.PHONY: federation-dev-shell
federation-dev-shell: ## Open a shell in a federation service (usage: make federation-dev-shell s=fed-a-api)
	@if [ -z "$(s)" ]; then echo "$(RED)Specify a service: make federation-dev-shell s=fed-a-api$(NC)"; exit 1; fi
	@$(DC_FED) exec $(s) sh

.PHONY: dev-test
dev-test: dev-test-backend dev-test-readplane dev-test-rust dev-test-frontend ## Run backend, frontend, Go, and Rust checks
	@echo "$(GREEN)All dev checks passed$(NC)"

.PHONY: dev-test-preflight
dev-test-preflight: ## Ensure the dev backend is running before containerized tests
	@missing=0; \
	for svc in postgres redis worker; do \
		if ! $(DC_DEV) ps --services --filter status=running | grep -qx "$$svc"; then \
			echo "$(RED)Missing dev service: $$svc$(NC)"; \
			missing=1; \
		fi; \
	done; \
	if [ "$$missing" -ne 0 ]; then \
		echo "$(YELLOW)Run 'make dev-back' or 'make dev' before make dev-test.$(NC)"; \
		exit 1; \
	fi

DC_TEST := $(DC) -f docker-compose.test.yaml --project-name crate-test

.PHONY: dev-test-backend
dev-test-backend: ## Run Python backend static checks and pytest
	@echo "$(YELLOW)Backend: pyright$(NC)"
	@uv run pyright
	@echo "$(YELLOW)Backend: ruff check$(NC)"
	@uv run ruff check app/crate app/tests
	@echo "$(YELLOW)Backend: ruff format --check$(NC)"
	@uv run ruff format --check app/crate app/tests
	@echo "$(YELLOW)Backend: pytest in an isolated test stack$(NC)"
	@$(DC_DEV) build worker
	@$(DC_TEST) down -v --remove-orphans 2>/dev/null || true
	@$(DC_TEST) up -d --wait
	@docker run --rm --network crate-test_default \
		-v "$(CURDIR):/workspace" -w /workspace \
		-e PYTHONPATH=/workspace/app \
		-e CRATE_POSTGRES_HOST=crate-test-postgres \
		-e CRATE_POSTGRES_PORT=5432 \
		-e CRATE_POSTGRES_USER=crate \
		-e CRATE_POSTGRES_PASSWORD=crate_test \
		-e CRATE_POSTGRES_DB=crate_test \
		-e REDIS_URL=redis://crate-test-redis:6379/0 \
		--entrypoint python \
		musicdock-worker \
		-m pytest app/tests/ -q --durations=20 \
		--ignore=app/tests/test_stats_integration.py \
		--ignore=app/tests/test_user_stats_aggregates.py; \
	EXIT=$$?; \
	$(DC_TEST) down -v --remove-orphans 2>/dev/null || true; \
	exit $$EXIT

.PHONY: dev-test-readplane
dev-test-readplane: ## Run Go readplane tests and vet
	@$(MAKE) readplane-test
	@$(MAKE) readplane-vet

.PHONY: dev-federation-capacity-test
dev-federation-capacity-test: ## Profile a 900/4.4K/48K federated catalog in the isolated test DB
	@$(DC_TEST) down -v --remove-orphans >/dev/null 2>&1 || true
	@$(DC_TEST) up -d --wait postgres redis
	@mkdir -p .artifacts
	@CRATE_POSTGRES_HOST=127.0.0.1 \
		CRATE_POSTGRES_PORT=5434 \
		CRATE_POSTGRES_USER=crate \
		CRATE_POSTGRES_PASSWORD=crate_test \
		CRATE_POSTGRES_DB=crate_test \
		REDIS_URL=redis://127.0.0.1:6381/0 \
		PYTHONPATH=app \
		uv run python app/tests/load/federation_catalog_profile.py \
			--enforce-slo \
			--output .artifacts/federation-capacity.json; \
	EXIT=$$?; \
	$(DC_TEST) down -v --remove-orphans >/dev/null 2>&1 || true; \
	exit $$EXIT

.PHONY: dev-catalog-search-capacity-test
dev-catalog-search-capacity-test: ## Gate local search fallback with a 100K-track fixture
	@$(DC_TEST) down -v --remove-orphans >/dev/null 2>&1 || true
	@$(DC_TEST) up -d --wait postgres redis
	@mkdir -p .artifacts
	@CRATE_POSTGRES_HOST=127.0.0.1 \
		CRATE_POSTGRES_PORT=5434 \
		CRATE_POSTGRES_USER=crate \
		CRATE_POSTGRES_PASSWORD=crate_test \
		CRATE_POSTGRES_DB=crate_test \
		REDIS_URL=redis://127.0.0.1:6381/0 \
		PYTHONPATH=app \
		uv run python app/tests/load/catalog_search_fallback_profile.py \
			--enforce-slo \
			--output .artifacts/catalog-search-fallback-capacity.json; \
	EXIT=$$?; \
	$(DC_TEST) down -v --remove-orphans >/dev/null 2>&1 || true; \
	exit $$EXIT

.PHONY: dev-test-rust
dev-test-rust: ## Run Rust tests for native services/tools
	@echo "$(YELLOW)Rust: media-worker$(NC)"
	@cargo test --manifest-path app/media-worker/Cargo.toml
	@echo "$(YELLOW)Rust: crate-cli$(NC)"
	@if [ "$$(uname -s)" = "Linux" ] && [ "$$(uname -m)" = "x86_64" ]; then \
		cargo test --manifest-path tools/crate-cli/Cargo.toml; \
	else \
		echo "$(YELLOW)crate-cli: host has no prebuilt bliss/aubio bindings; testing analysis build$(NC)"; \
		cargo test --manifest-path tools/crate-cli/Cargo.toml --no-default-features --features analysis; \
	fi
	@echo "$(YELLOW)Rust: listen desktop Tauri shell$(NC)"
	@cargo test --manifest-path app/listen-desktop/src-tauri/Cargo.toml

.PHONY: dev-test-frontend
dev-test-frontend: ## Run frontend lint, typecheck, tests, and builds
	@echo "$(YELLOW)Frontend: @crate/ui typecheck + build$(NC)"
	@npm run --workspace=app/shared/ui typecheck
	@npm run --workspace=app/shared/ui build
	@echo "$(YELLOW)Frontend: admin lint + typecheck + test + build$(NC)"
	@npm run --workspace=app/ui lint
	@npm run --workspace=app/ui typecheck
	@npm run --workspace=app/ui test
	@npm run --workspace=app/ui build
	@echo "$(YELLOW)Frontend: listen lint + typecheck + test + build$(NC)"
	@npm run --workspace=app/listen lint
	@npm run --workspace=app/listen typecheck
	@npm run --workspace=app/listen i18n:check
	@npm run --workspace=app/listen test
	@npm run --workspace=app/listen build
	@echo "$(YELLOW)Frontend: desktop typecheck + build$(NC)"
	@npm run --workspace=app/listen-desktop typecheck
	@npm run --workspace=app/listen-desktop build

.PHONY: i18n-check
i18n-check: ## Validate Listen translation catalogs
	@npm run --workspace=app/listen i18n:check

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

.PHONY: pg-perf-snapshot
pg-perf-snapshot: ## Read-only PostgreSQL performance snapshot as JSON
	@uv run python scripts/postgres_perf_snapshot.py --pretty

.PHONY: regression-min
regression-min: regression-api regression-smoke ## Minimum regression suite before touching Listen

# ===========================================================================
# CRATE CLI (Rust native toolbox)
# ===========================================================================

.PHONY: crate-cli-linux
crate-cli-linux: ## Build crate-cli for production Linux workers into app/bin/
	@mkdir -p app/bin /tmp/crate-cli-build
	@docker build --platform linux/amd64 --output type=local,dest=/tmp/crate-cli-build tools/crate-cli
	@cp /tmp/crate-cli-build/crate-cli app/bin/crate-cli-linux-amd64
	@chmod +x app/bin/crate-cli-linux-amd64
	@echo "$(GREEN)Built app/bin/crate-cli-linux-amd64$(NC)"

# ===========================================================================
# READPLANE (Go read-only acceleration service)
# ===========================================================================

READPLANE_GO_IMAGE ?= golang:1.23-alpine
READPLANE_GO ?= /usr/local/go/bin/go
READPLANE_FASTAPI_BASE ?= http://host.docker.internal:8585
READPLANE_BASE ?= http://host.docker.internal:8686
READPLANE_AUTH_EMAIL ?= admin@cratemusic.app
READPLANE_AUTH_PASSWORD ?= admin
READPLANE_BENCH_REQUESTS ?= 50
READPLANE_BENCH_WARMUP ?= 5

.PHONY: readplane-test
readplane-test: ## Run readplane Go tests in a container
	@docker run --rm \
		-v "$(CURDIR)/app/readplane:/src" \
		-w /src \
		$(READPLANE_GO_IMAGE) \
		$(READPLANE_GO) test -cover -coverprofile=coverage.out ./...

.PHONY: readplane-vet
readplane-vet: ## Run go vet for readplane in a container
	@docker run --rm \
		-v "$(CURDIR)/app/readplane:/src" \
		-w /src \
		$(READPLANE_GO_IMAGE) \
		$(READPLANE_GO) vet ./...

.PHONY: readplane-ci
readplane-ci: readplane-test readplane-vet ## Run readplane local CI checks
	@docker build -t crate-readplane:local app/readplane

.PHONY: readplane-contract-smoke
readplane-contract-smoke: ## Compare readplane P0/P1/P2 responses against local FastAPI
	@docker run --rm \
		--add-host=host.docker.internal:host-gateway \
		-v "$(CURDIR)/app/readplane:/src" \
		-w /src \
		-e FASTAPI_BASE="$(READPLANE_FASTAPI_BASE)" \
		-e READPLANE_BASE="$(READPLANE_BASE)" \
		-e READPLANE_CONTRACT_CHECK_P1="$(READPLANE_CONTRACT_CHECK_P1)" \
		-e READPLANE_CONTRACT_P1_QUERY="$(READPLANE_CONTRACT_P1_QUERY)" \
		-e READPLANE_CONTRACT_MEDIA_PATHS="$(READPLANE_CONTRACT_MEDIA_PATHS)" \
		-e CRATE_AUTH_EMAIL="$(READPLANE_AUTH_EMAIL)" \
		-e CRATE_AUTH_PASSWORD="$(READPLANE_AUTH_PASSWORD)" \
		$(READPLANE_GO_IMAGE) \
		$(READPLANE_GO) run ./cmd/readplane-contract-smoke

.PHONY: readplane-benchmark
readplane-benchmark: ## Compare FastAPI vs readplane latency for a P0 route
	@docker run --rm \
		--add-host=host.docker.internal:host-gateway \
		-v "$(CURDIR)/app/readplane:/src" \
		-w /src \
		-e FASTAPI_BASE="$(READPLANE_FASTAPI_BASE)" \
		-e READPLANE_BASE="$(READPLANE_BASE)" \
		-e CRATE_AUTH_EMAIL="$(READPLANE_AUTH_EMAIL)" \
		-e CRATE_AUTH_PASSWORD="$(READPLANE_AUTH_PASSWORD)" \
		-e READPLANE_BENCH_REQUESTS="$(READPLANE_BENCH_REQUESTS)" \
		-e READPLANE_BENCH_WARMUP="$(READPLANE_BENCH_WARMUP)" \
		$(READPLANE_GO_IMAGE) \
		$(READPLANE_GO) run ./cmd/readplane-benchmark

.PHONY: test-response
test-response: ## Benchmark Listen API routes (auth: CRATE_RESPONSE_TOKEN or EMAIL/PASSWORD)
	@PYTHONPATH=app .venv/bin/python app/tests/load/listen_response_profile.py \
		--base-url "$${CRATE_RESPONSE_BASE_URL:-http://localhost:8585}" \
		--artist-slug "$${CRATE_RESPONSE_ARTIST_SLUG:-pantera}" \
		--genre-slug "$${CRATE_RESPONSE_GENRE_SLUG:-death-metal}" \
		--samples "$${CRATE_RESPONSE_SAMPLES:-5}" \
		--warmups "$${CRATE_RESPONSE_WARMUPS:-1}" \
		--timeout "$${CRATE_RESPONSE_TIMEOUT:-20}" \
		--output "$${CRATE_RESPONSE_OUTPUT:-.artifacts/benchmarks/listen-response.json}" \
		$${CRATE_RESPONSE_REPORT_ONLY:+--report-only} \
		$${CRATE_RESPONSE_SKIP_TLS_VERIFY:+--skip-tls-verify}

.PHONY: dev-federation-stream-benchmark
dev-federation-stream-benchmark: ## Benchmark the selected Go federated stream data plane
	@mkdir -p .artifacts/benchmarks
	@mkdir -p .artifacts/bin
	@cd app/readplane && go build -o ../../.artifacts/bin/federation-benchmark-proxy ./cmd/federation-benchmark-proxy
	@PYTHONPATH=app .venv/bin/python app/tests/load/federation_stream_benchmark.py \
		--file-mib "$${CRATE_BENCHMARK_FILE_MIB:-8}" \
		--concurrency "$${CRATE_BENCHMARK_CONCURRENCY:-1,10,25,50}" \
		--measurement-rounds "$${CRATE_BENCHMARK_ROUNDS:-3}" \
		--go-proxy-binary .artifacts/bin/federation-benchmark-proxy \
		--output .artifacts/benchmarks/federation-stream.json

.PHONY: dev-artwork-delivery-benchmark
dev-artwork-delivery-benchmark: ## Profile materialized artwork delivery
	@PYTHONPATH=app .venv/bin/python app/tests/load/artwork_delivery_profile.py \
		--url "$${CRATE_ARTWORK_BENCHMARK_URL:?set CRATE_ARTWORK_BENCHMARK_URL}" \
		--token "$${CRATE_BENCHMARK_TOKEN:-}" \
		--output .artifacts/benchmarks/artwork-delivery.json $${CRATE_BENCHMARK_SLO:+--enforce-slo}

.PHONY: dev-local-stream-benchmark
dev-local-stream-benchmark: ## Compare FastAPI and native readplane local stream delivery
	@PYTHONPATH=app .venv/bin/python app/tests/load/local_stream_delivery_profile.py \
		--fastapi-url "$${CRATE_FASTAPI_STREAM_BENCHMARK_URL:?set CRATE_FASTAPI_STREAM_BENCHMARK_URL}" \
		--readplane-url "$${CRATE_READPLANE_STREAM_BENCHMARK_URL:?set CRATE_READPLANE_STREAM_BENCHMARK_URL}" \
		--token "$${CRATE_BENCHMARK_TOKEN:-}" \
		--output .artifacts/benchmarks/local-stream-delivery.json $${CRATE_BENCHMARK_SLO:+--enforce-slo}

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
	@-curl -fsS -I http://localhost:5173 >/dev/null 2>&1 && echo "  Admin:  http://localhost:5173 (running)" || echo "  Admin:  not running"
	@-curl -fsS -I http://localhost:5174 >/dev/null 2>&1 && echo "  Listen: http://localhost:5174 (running)" || echo "  Listen: not running"
	@-curl -fsS -I http://localhost:5175 >/dev/null 2>&1 && echo "  Docs:   http://localhost:5175 (running)" || echo "  Docs:   not running"
	@-curl -fsS -I http://localhost:5176 >/dev/null 2>&1 && echo "  Site:   http://localhost:5176 (running)" || echo "  Site:   not running"

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
setup: _check-deps _create-network _generate-certs _generate-dev-certs _setup-hosts _create-dirs ## Initial local environment setup
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

.PHONY: _generate-dev-certs _ensure-dev-certs
_generate-dev-certs:
	@echo "$(YELLOW)Generating mkcert certificate for development domains...$(NC)"
	@mkdir -p data/caddy/certs
	@mkcert \
		-cert-file data/caddy/certs/dev-stack.pem \
		-key-file data/caddy/certs/dev-stack-key.pem \
		admin.dev.lespedants.org \
		listen.dev.lespedants.org \
		api.dev.lespedants.org \
		docs.dev.cratemusic.app \
		reference.dev.cratemusic.app \
		www.dev.cratemusic.app \
		admin-dev.lespedants.org \
		listen-dev.lespedants.org \
		api-dev.lespedants.org
	@echo "$(GREEN)Development certificate generated$(NC)"

_ensure-dev-certs:
	@command -v mkcert >/dev/null 2>&1 || { echo "$(RED)mkcert is required. Run 'make setup' first$(NC)"; exit 1; }
	@if [ ! -s data/caddy/certs/dev-stack.pem ] || [ ! -s data/caddy/certs/dev-stack-key.pem ]; then \
		$(MAKE) --no-print-directory _generate-dev-certs; \
	fi

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

# Resolves the immutable release manifest published for origin/main.
# VERSION=<full-main-sha> pins compose and every application image by OCI digest.
# Lower-level overrides remain available for development and incident recovery:
# DEPLOY_IMAGE_TAG=<tag>, DEPLOY_REF=<git-ref>, DEPLOY_IMAGE_OWNER=<owner>, DEPLOY_PUBLIC_CHECKS=0.
.PHONY: deploy
deploy: ## Deploy a release (usage: make deploy VERSION=<full-main-sha>)
	@SERVER_USER="$(SERVER_USER)" SERVER_HOST="$(SERVER_HOST)" SERVER_PATH="$(SERVER_PATH)" DEPLOY_VERSION='$(strip $(VERSION))' DEPLOY_REF="$(DEPLOY_REF)" DEPLOY_ID="$(DEPLOY_ID)" DEPLOY_IMAGE_OWNER="$(DEPLOY_IMAGE_OWNER)" DEPLOY_IMAGE_REGISTRY="$(DEPLOY_IMAGE_REGISTRY)" scripts/deploy.sh deploy

.PHONY: deploy-preflight
deploy-preflight: ## Validate a release and production readiness without changing the stack
	@test -n "$(strip $(VERSION))" || { echo "$(RED)VERSION=<full-main-sha> is required$(NC)"; exit 1; }
	@SERVER_USER="$(SERVER_USER)" SERVER_HOST="$(SERVER_HOST)" SERVER_PATH="$(SERVER_PATH)" DEPLOY_VERSION='$(strip $(VERSION))' DEPLOY_REF="$(DEPLOY_REF)" DEPLOY_ID="$(DEPLOY_ID)" DEPLOY_IMAGE_OWNER="$(DEPLOY_IMAGE_OWNER)" DEPLOY_IMAGE_REGISTRY="$(DEPLOY_IMAGE_REGISTRY)" scripts/deploy.sh preflight

.PHONY: deploy-recovery-snapshot
deploy-recovery-snapshot: ## Quiesce production and capture DB, durable Redis, config and images
	@test -n "$(strip $(DEPLOY_ID))" || { echo "$(RED)DEPLOY_ID=<release-id> is required$(NC)"; exit 1; }
	@SERVER_USER="$(SERVER_USER)" SERVER_HOST="$(SERVER_HOST)" SERVER_PATH="$(SERVER_PATH)" DEPLOY_ID="$(strip $(DEPLOY_ID))" DEPLOY_IMAGE_OWNER="$(DEPLOY_IMAGE_OWNER)" DEPLOY_IMAGE_REGISTRY="$(DEPLOY_IMAGE_REGISTRY)" scripts/deploy.sh recovery-snapshot

.PHONY: deploy-rollback
deploy-rollback: ## Restore a recovery set (requires CONFIRM=restore-production)
	@test -n "$(strip $(DEPLOY_ID))" || { echo "$(RED)DEPLOY_ID=<release-id> is required$(NC)"; exit 1; }
	@test "$(CONFIRM)" = "restore-production" || { echo "$(RED)CONFIRM=restore-production is required$(NC)"; exit 1; }
	@SERVER_USER="$(SERVER_USER)" SERVER_HOST="$(SERVER_HOST)" SERVER_PATH="$(SERVER_PATH)" DEPLOY_ID="$(strip $(DEPLOY_ID))" DEPLOY_CONFIRM="$(CONFIRM)" DEPLOY_IMAGE_OWNER="$(DEPLOY_IMAGE_OWNER)" DEPLOY_IMAGE_REGISTRY="$(DEPLOY_IMAGE_REGISTRY)" scripts/deploy.sh rollback

.PHONY: deploy-image-rollback
deploy-image-rollback: ## Roll back only application images/config (requires CONFIRM=rollback-images)
	@test -n "$(strip $(DEPLOY_ID))" || { echo "$(RED)DEPLOY_ID=<release-id> is required$(NC)"; exit 1; }
	@test "$(CONFIRM)" = "rollback-images" || { echo "$(RED)CONFIRM=rollback-images is required$(NC)"; exit 1; }
	@SERVER_USER="$(SERVER_USER)" SERVER_HOST="$(SERVER_HOST)" SERVER_PATH="$(SERVER_PATH)" DEPLOY_ID="$(strip $(DEPLOY_ID))" DEPLOY_CONFIRM="$(CONFIRM)" DEPLOY_IMAGE_OWNER="$(DEPLOY_IMAGE_OWNER)" DEPLOY_IMAGE_REGISTRY="$(DEPLOY_IMAGE_REGISTRY)" scripts/deploy.sh image-rollback

.PHONY: deploy-build
deploy-build: ## Deploy by building on the server (GHCR fallback)
	@echo "$(YELLOW)Syncing files...$(NC)"
	@scp docker-compose.yaml docker-compose.project.yaml .env $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/
	@$(SSH) "mkdir -p $(SERVER_PATH)/deploy/traefik"
	@scp deploy/traefik/federation-readplane.yml $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/deploy/traefik/
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
	@$(SSH) "mkdir -p $(SERVER_PATH)/deploy/traefik"
	@scp deploy/traefik/federation-readplane.yml $(SERVER_USER)@$(SERVER_HOST):$(SERVER_PATH)/deploy/traefik/
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
trust-local-ca: ## Trust the mkcert CA for local HTTPS
	@command -v mkcert >/dev/null 2>&1 || { echo "$(RED)mkcert is required. Run 'make setup' first$(NC)"; exit 1; }
	@mkcert -install
	@echo "$(GREEN)mkcert CA trusted. Restart your browser if needed.$(NC)"

# ===========================================================================
# CAPACITOR (mobile native builds)
# ===========================================================================

CAP_DIR := app/listen
CAP_IOS_TARGET ?= $(shell cd $(CAP_DIR) && npx cap run ios --list 2>/dev/null | grep "iPhone.*Pro " | head -1 | awk '{print $$NF}')
CAP_DEBUG_SERVER_URL ?= https://listen.lespedants.org
CAP_ANDROID_OUTPUT_DIR ?= artifacts/capacitor/android
CAP_ANDROID_GRADLE_VARIANT ?= debug
CAP_ANDROID_RELEASE_TAG ?= $(shell git describe --tags --exact-match 2>/dev/null)

# Android Studio JBR + SDK paths (required for Gradle/emulator)
export JAVA_HOME ?= $(HOME)/Applications/Android Studio.app/Contents/jbr/Contents/Home
export ANDROID_HOME ?= $(HOME)/Library/Android/sdk

.PHONY: cap-build
cap-build: ## Build Listen for Capacitor (bakes production API URL)
	@cd $(CAP_DIR) && npm run build:cap
	@echo "$(GREEN)Capacitor build + sync done$(NC)"

.PHONY: cap-ios
cap-ios: ## Build and run Listen on iOS Simulator
	@cd $(CAP_DIR) && VITE_API_URL="$(CAP_DEBUG_SERVER_URL)" npm run build:cap
	@echo "$(YELLOW)Launching iOS Simulator...$(NC)"
	@cd $(CAP_DIR) && npx cap run ios --target "$(CAP_IOS_TARGET)"

.PHONY: cap-ios-open
cap-ios-open: ## Open Listen iOS project in Xcode
	@cd $(CAP_DIR) && npx cap open ios

.PHONY: cap-android
cap-android: ## Build and run Listen on Android Emulator
	@cd $(CAP_DIR) && VITE_API_URL="$(CAP_DEBUG_SERVER_URL)" npm run build:cap
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

.PHONY: cap-android-artifacts
cap-android-artifacts: ## Build Android APK and copy output to a local artifacts folder
	@cd $(CAP_DIR) && VITE_API_URL="$(CAP_DEBUG_SERVER_URL)" npm run build:cap
	@cd $(CAP_DIR)/android && variant="$(CAP_ANDROID_GRADLE_VARIANT)"; \
	task="assemble$$(printf '%s' "$$variant" | awk '{print toupper(substr($$0,1,1)) substr($$0,2)}')"; \
	./gradlew "$$task"
	@mkdir -p "$(CAP_ANDROID_OUTPUT_DIR)"
	@out="$$(ls -1t $(CAP_DIR)/android/app/build/outputs/apk/$(CAP_ANDROID_GRADLE_VARIANT)/app-$(CAP_ANDROID_GRADLE_VARIANT).apk 2>/dev/null || true)"; \
	if [ -z "$$out" ]; then \
		out="$$(ls -1t $(CAP_DIR)/android/app/build/outputs/apk/$(CAP_ANDROID_GRADLE_VARIANT)/*.apk 2>/dev/null | head -n 1 || true)"; \
	fi; \
	if [ -z "$$out" ]; then \
		echo "$(RED)No APK found under $(CAP_DIR)/android/app/build/outputs/apk/$(CAP_ANDROID_GRADLE_VARIANT)$(NC)"; \
		exit 1; \
	fi; \
	ts="$$(date +%Y%m%d-%H%M%S)"; \
	sha="$$(git rev-parse --short HEAD 2>/dev/null || echo local)"; \
	dst="$(CAP_ANDROID_OUTPUT_DIR)/crate-listen-$(CAP_ANDROID_GRADLE_VARIANT)-$${ts}-$${sha}.apk"; \
	cp "$$out" "$$dst"; \
	echo "$(GREEN)Artifact copied to:$$dst$(NC)"

.PHONY: cap-android-release
cap-android-release: ## Build signed/shrunk Android APK+AAB for the exact release tag
	@test -n "$(CAP_ANDROID_RELEASE_TAG)" || { echo "$(RED)CAP_ANDROID_RELEASE_TAG or an exact git tag is required$(NC)"; exit 1; }
	@test -n "$$CRATE_ANDROID_KEYSTORE_FILE" || { echo "$(RED)CRATE_ANDROID_KEYSTORE_FILE is required$(NC)"; exit 1; }
	@test -n "$$CRATE_ANDROID_KEYSTORE_PASSWORD" || { echo "$(RED)CRATE_ANDROID_KEYSTORE_PASSWORD is required$(NC)"; exit 1; }
	@test -n "$$CRATE_ANDROID_KEY_ALIAS" || { echo "$(RED)CRATE_ANDROID_KEY_ALIAS is required$(NC)"; exit 1; }
	@test -n "$$CRATE_ANDROID_KEY_PASSWORD" || { echo "$(RED)CRATE_ANDROID_KEY_PASSWORD is required$(NC)"; exit 1; }
	@cd $(CAP_DIR) && npm run build:cap
	@cd $(CAP_DIR) && eval "$$(node scripts/android-release-version.mjs "$(CAP_ANDROID_RELEASE_TAG)")"; \
	export CRATE_ANDROID_VERSION_NAME CRATE_ANDROID_VERSION_CODE; \
	cd android && ./gradlew bundleRelease assembleRelease lintRelease --no-daemon
	@mkdir -p "$(CAP_ANDROID_OUTPUT_DIR)"
	@safe_tag="$$(printf '%s' "$(CAP_ANDROID_RELEASE_TAG)" | sed 's#[^A-Za-z0-9._-]#-#g')"; \
	cp "$(CAP_DIR)/android/app/build/outputs/apk/release/app-release.apk" \
		"$(CAP_ANDROID_OUTPUT_DIR)/crate-$${safe_tag}.apk"; \
	cp "$(CAP_DIR)/android/app/build/outputs/bundle/release/app-release.aab" \
		"$(CAP_ANDROID_OUTPUT_DIR)/crate-$${safe_tag}.aab"; \
	echo "$(GREEN)Signed Android artifacts copied to $(CAP_ANDROID_OUTPUT_DIR)$(NC)"

# ===========================================================================
# TAURI (desktop native builds)
# ===========================================================================

TAURI_DIR := app/listen-desktop
TAURI_RELEASE_VERSION ?= $(shell git describe --tags --exact-match 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || gh release view --json tagName --jq .tagName 2>/dev/null || node -p "require('./$(TAURI_DIR)/src-tauri/tauri.conf.json').version")
TAURI_MACOS_OUTPUT_DIR ?= desktop-artifacts/$(TAURI_RELEASE_VERSION)-macos-testers
TAURI_MACOS_ARM_APP := $(TAURI_DIR)/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Crate.app
TAURI_MACOS_INTEL_APP := $(TAURI_DIR)/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Crate.app

.PHONY: tauri-dev
tauri-dev: ## Build and run Crate desktop with Tauri dev mode
	@cd $(TAURI_DIR) && npm run tauri:dev

.PHONY: tauri-build-app
tauri-build-app: ## Build Crate desktop macOS .app bundle
	@cd $(TAURI_DIR) && npm run tauri:build:app

.PHONY: tauri-build
tauri-build: ## Build Crate desktop local app bundle
	@cd $(TAURI_DIR) && npm run tauri:build

.PHONY: tauri-build-all
tauri-build-all: ## Build Crate desktop all release bundles
	@cd $(TAURI_DIR) && npm run tauri:build:all

.PHONY: tauri-build-macos-testers
tauri-build-macos-testers: ## Build ARM + Intel macOS .app ZIPs for manual tester distribution
	@if [ "$$(uname -s)" != "Darwin" ]; then \
		echo "$(RED)macOS tester builds must run on macOS.$(NC)"; \
		exit 1; \
	fi
	@echo "$(YELLOW)Building Crate macOS ARM bundle ($(TAURI_RELEASE_VERSION))$(NC)"
	@npm run --workspace=$(TAURI_DIR) tauri -- build --target aarch64-apple-darwin --bundles app
	@echo "$(YELLOW)Building Crate macOS Intel bundle ($(TAURI_RELEASE_VERSION))$(NC)"
	@npm run --workspace=$(TAURI_DIR) tauri -- build --target x86_64-apple-darwin --bundles app
	@mkdir -p "$(TAURI_MACOS_OUTPUT_DIR)"
	@arm_binary="$(TAURI_MACOS_ARM_APP)/Contents/MacOS/crate-desktop"; \
	intel_binary="$(TAURI_MACOS_INTEL_APP)/Contents/MacOS/crate-desktop"; \
	file "$$arm_binary" | grep -q "arm64" || { echo "$(RED)ARM bundle is not arm64$(NC)"; exit 1; }; \
	file "$$intel_binary" | grep -q "x86_64" || { echo "$(RED)Intel bundle is not x86_64$(NC)"; exit 1; }
	@echo "$(YELLOW)Applying minimal ad-hoc macOS signatures$(NC)"
	@xattr -cr "$(TAURI_MACOS_ARM_APP)" "$(TAURI_MACOS_INTEL_APP)" 2>/dev/null || true
	@codesign --force --deep --sign - "$(TAURI_MACOS_ARM_APP)"
	@codesign --force --deep --sign - "$(TAURI_MACOS_INTEL_APP)"
	@codesign --verify --deep --strict --verbose=2 "$(TAURI_MACOS_ARM_APP)"
	@codesign --verify --deep --strict --verbose=2 "$(TAURI_MACOS_INTEL_APP)"
	@ditto -c -k --keepParent "$(TAURI_MACOS_ARM_APP)" "$(TAURI_MACOS_OUTPUT_DIR)/Crate-macos-arm64-$(TAURI_RELEASE_VERSION).app.zip"
	@ditto -c -k --keepParent "$(TAURI_MACOS_INTEL_APP)" "$(TAURI_MACOS_OUTPUT_DIR)/Crate-macos-intel-$(TAURI_RELEASE_VERSION).app.zip"
	@echo "$(GREEN)macOS tester ZIPs ready:$(NC)"
	@ls -lh "$(TAURI_MACOS_OUTPUT_DIR)"

.PHONY: tauri-macos-testers
tauri-macos-testers: tauri-build-macos-testers ## Alias for tauri-build-macos-testers

.PHONY: tauri-collect-artifacts
tauri-collect-artifacts: ## Collect Crate desktop release artifacts into desktop-artifacts/
	@$(TAURI_DIR)/scripts/collect-artifacts.sh local

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
