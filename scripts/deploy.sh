#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_USER="${SERVER_USER:-root}"
SERVER_HOST="${SERVER_HOST:-104.152.210.73}"
SERVER_PATH="${SERVER_PATH:-/home/crate/crate}"
REMOTE="${SERVER_USER}@${SERVER_HOST}"
DEPLOY_ID="${DEPLOY_ID:-$(date -u +%Y%m%d-%H%M%S)}"
DEPLOY_REF="${DEPLOY_REF:-origin/main}"
DEPLOY_PUBLIC_CHECKS="${DEPLOY_PUBLIC_CHECKS:-1}"
DEPLOY_IMAGE_WAIT_SECONDS="${DEPLOY_IMAGE_WAIT_SECONDS:-900}"
DEPLOY_IMAGE_WAIT_INTERVAL="${DEPLOY_IMAGE_WAIT_INTERVAL:-20}"
REMOTE_SCRIPT_PATH="${SERVER_PATH}/.deploy/deploy-remote.sh"
TMP_DIR=""

log() {
  printf '\n==> %s\n' "$*"
}

fail() {
  printf '\nDeploy failed: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

ssh_remote() {
  ssh "$REMOTE" "$@"
}

remote_deploy() {
  ssh_remote \
    "SERVER_PATH='$SERVER_PATH' DEPLOY_ID='$DEPLOY_ID' DEPLOY_IMAGE_TAG='$DEPLOY_IMAGE_TAG' DEPLOY_PUBLIC_CHECKS='$DEPLOY_PUBLIC_CHECKS' DEPLOY_IMAGE_WAIT_SECONDS='$DEPLOY_IMAGE_WAIT_SECONDS' DEPLOY_IMAGE_WAIT_INTERVAL='$DEPLOY_IMAGE_WAIT_INTERVAL' '$REMOTE_SCRIPT_PATH' '$1'"
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  tmp="$(mktemp)"
  if [[ -f "$file" && "$(grep -c -E "^${key}=" "$file" || true)" -gt 0 ]]; then
    sed -E "s|^${key}=.*|${key}=${value}|" "$file" > "$tmp"
  else
    if [[ -f "$file" ]]; then
      cp "$file" "$tmp"
    fi
    printf '\n%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$file"
}

resolve_image_tag() {
  if [[ "${DEPLOY_SKIP_GIT_FETCH:-0}" != "1" ]]; then
    git -C "$ROOT_DIR" fetch --quiet origin main
  fi

  if [[ -z "${DEPLOY_IMAGE_TAG:-}" ]]; then
    DEPLOY_IMAGE_TAG="$(git -C "$ROOT_DIR" rev-parse --short=7 "$DEPLOY_REF")"
  fi

  DEPLOY_IMAGE_SHA="$(git -C "$ROOT_DIR" rev-parse "$DEPLOY_REF" 2>/dev/null || true)"
  export DEPLOY_IMAGE_TAG DEPLOY_IMAGE_SHA
}

prepare_payload() {
  TMP_DIR="$(mktemp -d)"

  if [[ "${DEPLOY_USE_WORKTREE:-0}" == "1" ]]; then
    cp "$ROOT_DIR/docker-compose.yaml" "$TMP_DIR/docker-compose.yaml"
    cp "$ROOT_DIR/docker-compose.project.yaml" "$TMP_DIR/docker-compose.project.yaml"
  else
    git -C "$ROOT_DIR" archive "$DEPLOY_REF" docker-compose.yaml docker-compose.project.yaml \
      | tar -x -C "$TMP_DIR"
  fi

  cp "$ROOT_DIR/.env" "$TMP_DIR/.env"
  set_env_value "$TMP_DIR/.env" CRATE_IMAGE_TAG "$DEPLOY_IMAGE_TAG"
}

local_preflight() {
  log "Running local deploy preflight"
  require_command git
  require_command ssh
  require_command scp
  require_command tar

  test -f "$ROOT_DIR/.env" || fail ".env not found"

  resolve_image_tag
  prepare_payload

  if [[ "${DEPLOY_SKIP_LOCAL_COMPOSE_CHECK:-0}" != "1" ]]; then
    require_command docker
    docker compose \
      --env-file "$TMP_DIR/.env" \
      -f "$TMP_DIR/docker-compose.yaml" \
      -f "$TMP_DIR/docker-compose.project.yaml" \
      config -q
  fi

  log "Deploying image tag ${DEPLOY_IMAGE_TAG}${DEPLOY_IMAGE_SHA:+ (${DEPLOY_IMAGE_SHA})}"
}

sync_config() {
  log "Syncing deploy config from ${DEPLOY_REF}"
  ssh_remote "mkdir -p '$SERVER_PATH' '$SERVER_PATH/.deploy'"

  scp \
    "$TMP_DIR/docker-compose.yaml" \
    "$TMP_DIR/docker-compose.project.yaml" \
    "$TMP_DIR/.env" \
    "$REMOTE:$SERVER_PATH/"

  scp "$ROOT_DIR/scripts/deploy-remote.sh" "$REMOTE:$REMOTE_SCRIPT_PATH"
  ssh_remote "chmod +x '$REMOTE_SCRIPT_PATH'"
}

rollback_on_error() {
  local exit_code=$?
  trap - EXIT

  if [[ "$exit_code" -eq 0 ]]; then
    cleanup
    return
  fi

  printf '\nDeploy step failed. Attempting automatic rollback for %s...\n' "$DEPLOY_ID" >&2
  if remote_deploy rollback; then
    printf 'Rollback completed. Keeping deploy exit code %s so CI/operator sees the failure.\n' "$exit_code" >&2
  else
    printf 'Rollback also failed. Check remote docker compose status and logs.\n' >&2
    remote_deploy diagnose || true
  fi

  cleanup
  exit "$exit_code"
}

main() {
  local_preflight

  log "Checking remote host"
  ssh_remote "mkdir -p '$SERVER_PATH' '$SERVER_PATH/.deploy' && command -v docker >/dev/null && docker compose version >/dev/null"

  scp "$ROOT_DIR/scripts/deploy-remote.sh" "$REMOTE:$REMOTE_SCRIPT_PATH"
  ssh_remote "chmod +x '$REMOTE_SCRIPT_PATH'"

  remote_deploy preflight
  remote_deploy backup
  trap rollback_on_error EXIT

  sync_config
  remote_deploy config
  remote_deploy pull
  remote_deploy up
  remote_deploy verify
  remote_deploy cleanup

  trap - EXIT
  cleanup
  log "Deploy completed successfully"
  remote_deploy ps
}

main "$@"
