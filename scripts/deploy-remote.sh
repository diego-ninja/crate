#!/usr/bin/env bash
set -Eeuo pipefail

SERVER_PATH="${SERVER_PATH:?SERVER_PATH is required}"
DEPLOY_ID="${DEPLOY_ID:?DEPLOY_ID is required}"
DEPLOY_IMAGE_TAG="${DEPLOY_IMAGE_TAG:?DEPLOY_IMAGE_TAG is required}"
DEPLOY_PUBLIC_CHECKS="${DEPLOY_PUBLIC_CHECKS:-1}"
DEPLOY_IMAGE_WAIT_SECONDS="${DEPLOY_IMAGE_WAIT_SECONDS:-900}"
DEPLOY_IMAGE_WAIT_INTERVAL="${DEPLOY_IMAGE_WAIT_INTERVAL:-20}"
BACKUP_ROOT="${SERVER_PATH}/.deploy-backups"
BACKUP_DIR="${BACKUP_ROOT}/${DEPLOY_ID}"
ROLLBACK_TAG="rollback-${DEPLOY_ID}"

cd "$SERVER_PATH"

COMPOSE=(docker compose -f docker-compose.yaml -f docker-compose.project.yaml)
PROJECT_SERVICES=(crate-api crate-readplane crate-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker crate-ui crate-listen crate-site crate-docs crate-reference)
HEALTHY_SERVICES=(crate-redis crate-postgres crate-api)
RUNNING_SERVICES=(crate-readplane crate-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker crate-ui crate-listen crate-site crate-docs crate-reference)
PROJECT_IMAGES=(
  ghcr.io/diego-ninja/crate-api
  ghcr.io/diego-ninja/crate-readplane
  ghcr.io/diego-ninja/crate-worker
  ghcr.io/diego-ninja/crate-media-worker
  ghcr.io/diego-ninja/crate-ui
  ghcr.io/diego-ninja/crate-listen
  ghcr.io/diego-ninja/crate-site
  ghcr.io/diego-ninja/crate-docs
  ghcr.io/diego-ninja/crate-reference
)

declare -A SERVICE_IMAGE_REPOS=(
  [crate-api]=ghcr.io/diego-ninja/crate-api
  [crate-readplane]=ghcr.io/diego-ninja/crate-readplane
  [crate-worker]=ghcr.io/diego-ninja/crate-worker
  [crate-projector]=ghcr.io/diego-ninja/crate-worker
  [crate-maintenance-worker]=ghcr.io/diego-ninja/crate-worker
  [crate-analysis-worker]=ghcr.io/diego-ninja/crate-worker
  [crate-playback-worker]=ghcr.io/diego-ninja/crate-worker
  [crate-media-worker]=ghcr.io/diego-ninja/crate-media-worker
  [crate-ui]=ghcr.io/diego-ninja/crate-ui
  [crate-listen]=ghcr.io/diego-ninja/crate-listen
  [crate-site]=ghcr.io/diego-ninja/crate-site
  [crate-docs]=ghcr.io/diego-ninja/crate-docs
  [crate-reference]=ghcr.io/diego-ninja/crate-reference
)

log() {
  printf '\n[remote] %s\n' "$*"
}

dc() {
  "${COMPOSE[@]}" "$@"
}

env_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

compose_has_service() {
  local service="$1"
  dc config --services | grep -qx "$service"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp

  tmp="$(mktemp)"
  if [[ -f .env && "$(grep -c -E "^${key}=" .env || true)" -gt 0 ]]; then
    sed -E "s|^${key}=.*|${key}=${value}|" .env > "$tmp"
  else
    if [[ -f .env ]]; then
      cp .env "$tmp"
    fi
    printf '\n%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" .env
}

wait_for_container_running() {
  local container="$1"
  local deadline=$((SECONDS + 120))

  until [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" == "true" ]]; do
    if (( SECONDS >= deadline )); then
      log "Container ${container} did not become running"
      docker logs --tail=80 "$container" 2>/dev/null || true
      return 1
    fi
    sleep 3
  done
}

wait_for_container_healthy() {
  local container="$1"
  local deadline=$((SECONDS + 180))
  local status

  while true; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Running}}{{end}}' "$container" 2>/dev/null || true)"
    if [[ "$status" == "healthy" || "$status" == "true" ]]; then
      return 0
    fi
    if [[ "$status" == "unhealthy" ]]; then
      log "Container ${container} is unhealthy"
      docker logs --tail=120 "$container" 2>/dev/null || true
      return 1
    fi
    if (( SECONDS >= deadline )); then
      log "Container ${container} did not become healthy; last status: ${status:-unknown}"
      docker logs --tail=120 "$container" 2>/dev/null || true
      return 1
    fi
    sleep 3
  done
}

check_public_url() {
  local url="$1"
  curl -fsSIL --max-time 10 --retry 3 --retry-delay 2 "$url" >/dev/null
}

check_public_get_url() {
  local url="$1"
  curl -fsSL --max-time 10 --retry 3 --retry-delay 2 "$url" >/dev/null
}

cmd_preflight() {
  local puid
  local pgid

  log "Checking docker compose and required remote files"
  command -v docker >/dev/null
  docker compose version >/dev/null
  test -f docker-compose.yaml
  test -f docker-compose.project.yaml
  test -f .env

  puid="$(env_value PUID)"
  pgid="$(env_value PGID)"
  mkdir -p media/downloads/soulseek/incomplete media/downloads/tidal/incomplete
  chown -R "${puid:-1000}:${pgid:-1000}" media/downloads 2>/dev/null || true

  mkdir -p data/crate/stream-cache data/crate/playlist-covers
  chown -R "${puid:-1000}:${pgid:-1000}" \
    data/crate/stream-cache \
    data/crate/playlist-covers \
    2>/dev/null || true

  mkdir -p "$BACKUP_ROOT"
  dc config -q
}

cmd_backup() {
  local service
  local repo
  local image_id

  log "Creating rollback snapshot ${DEPLOY_ID}"
  mkdir -p "$BACKUP_DIR"

  for file in docker-compose.yaml docker-compose.project.yaml .env; do
    if [[ -f "$file" ]]; then
      cp -a "$file" "$BACKUP_DIR/$file"
    fi
  done

  printf '%s\n' "$ROLLBACK_TAG" > "$BACKUP_DIR/rollback_tag"

  for service in "${PROJECT_SERVICES[@]}"; do
    if ! compose_has_service "$service"; then
      continue
    fi
    repo="${SERVICE_IMAGE_REPOS[$service]}"
    image_id="$(docker inspect -f '{{.Image}}' "$service" 2>/dev/null || true)"
    if [[ -n "$image_id" ]]; then
      docker tag "$image_id" "${repo}:${ROLLBACK_TAG}"
    fi
  done
}

cmd_config() {
  log "Validating compose configuration for CRATE_IMAGE_TAG=${DEPLOY_IMAGE_TAG}"
  set_env_value CRATE_IMAGE_TAG "$DEPLOY_IMAGE_TAG"
  dc config -q
}

cmd_pull() {
  local start
  local failures
  local image

  log "Pulling GHCR images for tag ${DEPLOY_IMAGE_TAG}"
  start="$SECONDS"

  while true; do
    failures=0
    for image in "${PROJECT_IMAGES[@]}"; do
      if ! docker pull -q "${image}:${DEPLOY_IMAGE_TAG}" >/dev/null; then
        failures=$((failures + 1))
      fi
    done

    if [[ "$failures" -eq 0 ]]; then
      break
    fi

    if (( SECONDS - start >= DEPLOY_IMAGE_WAIT_SECONDS )); then
      log "Timed out waiting for ${failures} image(s) with tag ${DEPLOY_IMAGE_TAG}"
      return 1
    fi

    log "Waiting for GitHub images to become available (${failures} missing)"
    sleep "$DEPLOY_IMAGE_WAIT_INTERVAL"
  done

  log "Pulling external images"
  dc pull --ignore-buildable --ignore-pull-failures
}

cmd_up() {
  log "Starting updated stack without building on the server"
  dc up -d --no-build --remove-orphans
}

cmd_verify() {
  local domain
  domain="$(env_value DOMAIN)"

  log "Waiting for service health checks"
  for service in "${HEALTHY_SERVICES[@]}"; do
    if ! compose_has_service "$service"; then
      continue
    fi
    wait_for_container_healthy "$service"
  done

  log "Waiting for web and worker containers"
  for service in "${RUNNING_SERVICES[@]}"; do
    if ! compose_has_service "$service"; then
      continue
    fi
    wait_for_container_running "$service"
  done

  log "Checking API from inside the backend container"
  docker exec crate-api python - <<'PY'
import urllib.request

with urllib.request.urlopen("http://127.0.0.1:8585/api/status", timeout=5) as response:
    if response.status >= 400:
        raise SystemExit(f"unexpected status {response.status}")
PY

  if compose_has_service crate-readplane; then
    log "Checking readplane readiness from inside the backend container"
    docker exec crate-api python - <<'PY'
import urllib.request

with urllib.request.urlopen("http://crate-readplane:8686/readyz", timeout=5) as response:
    if response.status >= 400:
        raise SystemExit(f"unexpected status {response.status}")
PY
  fi

  if [[ "$DEPLOY_PUBLIC_CHECKS" != "0" && -n "$domain" ]]; then
    command -v curl >/dev/null
    log "Checking public routes through Traefik"
    check_public_get_url "https://api.${domain}/api/status"
    check_public_url "https://admin.${domain}"
    check_public_url "https://listen.${domain}"
    check_public_url "https://cratemusic.app"
    check_public_url "https://docs.cratemusic.app"
    check_public_url "https://reference.cratemusic.app"
  fi
}

cmd_rollback() {
  local rollback_tag
  local rollback_services=()
  local service

  if [[ ! -d "$BACKUP_DIR" ]]; then
    log "No rollback snapshot found for ${DEPLOY_ID}"
    return 1
  fi

  rollback_tag="$(cat "$BACKUP_DIR/rollback_tag" 2>/dev/null || true)"
  if [[ -z "$rollback_tag" ]]; then
    rollback_tag="$ROLLBACK_TAG"
  fi

  log "Restoring compose/env from rollback snapshot ${DEPLOY_ID}"
  for file in docker-compose.yaml docker-compose.project.yaml .env; do
    if [[ -f "$BACKUP_DIR/$file" ]]; then
      cp -a "$BACKUP_DIR/$file" "$file"
    fi
  done

  set_env_value CRATE_IMAGE_TAG "$rollback_tag"
  dc config -q

  log "Restarting previous images with CRATE_IMAGE_TAG=${rollback_tag}"
  for service in "${PROJECT_SERVICES[@]}"; do
    if compose_has_service "$service"; then
      rollback_services+=("$service")
    fi
  done
  CRATE_IMAGE_TAG="$rollback_tag" "${COMPOSE[@]}" up -d --no-build --remove-orphans "${rollback_services[@]}"
  DEPLOY_PUBLIC_CHECKS=0 cmd_verify
}

cmd_cleanup() {
  local snapshots=()
  local index

  log "Keeping the latest 5 deploy snapshots"
  if [[ -d "$BACKUP_ROOT" ]]; then
    mapfile -t snapshots < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -print | sort -r)
    for index in "${!snapshots[@]}"; do
      if (( index >= 5 )); then
        rm -rf "${snapshots[$index]}"
      fi
    done
  fi
}

cmd_ps() {
  dc ps
}

cmd_diagnose() {
  dc ps || true
  dc logs --tail=120 crate-api crate-readplane crate-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-media-worker crate-ui crate-listen crate-site crate-docs crate-reference || true
}

case "${1:-}" in
  preflight) cmd_preflight ;;
  backup) cmd_backup ;;
  config) cmd_config ;;
  pull) cmd_pull ;;
  up) cmd_up ;;
  verify) cmd_verify ;;
  rollback) cmd_rollback ;;
  cleanup) cmd_cleanup ;;
  ps) cmd_ps ;;
  diagnose) cmd_diagnose ;;
  *)
    printf 'Usage: %s {preflight|backup|config|pull|up|verify|rollback|cleanup|ps|diagnose}\n' "$0" >&2
    exit 2
    ;;
esac
