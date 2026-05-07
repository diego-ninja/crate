#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_USER="${SERVER_USER:-root}"
SERVER_HOST="${SERVER_HOST:-104.152.210.73}"
SERVER_PATH="${SERVER_PATH:-/home/crate/crate}"
REMOTE="${SERVER_USER}@${SERVER_HOST}"
DEPLOY_ID="${DEPLOY_ID:-$(date -u +%Y%m%d-%H%M%S)}"
DEPLOY_REF="${DEPLOY_REF:-origin/main}"
DEPLOY_IMAGE_OWNER="${DEPLOY_IMAGE_OWNER:-}"
DEPLOY_IMAGE_REGISTRY="${DEPLOY_IMAGE_REGISTRY:-}"
DEPLOY_PUBLIC_CHECKS="${DEPLOY_PUBLIC_CHECKS:-1}"
DEPLOY_SKIP_IMAGE_CHECK="${DEPLOY_SKIP_IMAGE_CHECK:-0}"
DEPLOY_IMAGE_WAIT_SECONDS="${DEPLOY_IMAGE_WAIT_SECONDS:-900}"
DEPLOY_IMAGE_WAIT_INTERVAL="${DEPLOY_IMAGE_WAIT_INTERVAL:-20}"
REMOTE_SCRIPT_PATH="${SERVER_PATH}/.deploy/deploy-remote.sh"
TMP_DIR=""
REQUIRED_IMAGE_NAMES=(
  crate-api
  crate-readplane
  crate-worker
  crate-media-worker
  crate-ui
  crate-listen
  crate-site
  crate-docs
)

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
    "SERVER_PATH='$SERVER_PATH' DEPLOY_ID='$DEPLOY_ID' DEPLOY_IMAGE_TAG='$DEPLOY_IMAGE_TAG' DEPLOY_IMAGE_OWNER='$DEPLOY_IMAGE_OWNER' DEPLOY_IMAGE_REGISTRY='$DEPLOY_IMAGE_REGISTRY' DEPLOY_PUBLIC_CHECKS='$DEPLOY_PUBLIC_CHECKS' DEPLOY_IMAGE_WAIT_SECONDS='$DEPLOY_IMAGE_WAIT_SECONDS' DEPLOY_IMAGE_WAIT_INTERVAL='$DEPLOY_IMAGE_WAIT_INTERVAL' '$REMOTE_SCRIPT_PATH' '$1'"
}

env_file_value() {
  local file="$1"
  local key="$2"
  local value

  value="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
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

resolve_repo_owner_from_remote() {
  local url
  url="$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || true)"
  if [[ "$url" =~ github\.com[:/]([^/]+)/crate(\.git)?$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return
  fi
  printf 'thecrateapp'
}

resolve_image_tag() {
  if [[ "${DEPLOY_SKIP_GIT_FETCH:-0}" != "1" ]]; then
    git -C "$ROOT_DIR" fetch --quiet origin main
  fi

  if [[ -z "${DEPLOY_IMAGE_TAG:-}" ]]; then
    DEPLOY_IMAGE_TAG="$(git -C "$ROOT_DIR" rev-parse --short=7 "$DEPLOY_REF")"
  fi

  DEPLOY_IMAGE_SHA="$(git -C "$ROOT_DIR" rev-parse "$DEPLOY_REF" 2>/dev/null || true)"

  if [[ -z "${DEPLOY_IMAGE_OWNER:-}" ]]; then
    DEPLOY_IMAGE_OWNER="$(env_file_value "$ROOT_DIR/.env" CRATE_IMAGE_OWNER)"
  fi
  if [[ -z "${DEPLOY_IMAGE_OWNER:-}" ]]; then
    DEPLOY_IMAGE_OWNER="$(resolve_repo_owner_from_remote)"
  fi

  if [[ -z "${DEPLOY_IMAGE_REGISTRY:-}" ]]; then
    DEPLOY_IMAGE_REGISTRY="$(env_file_value "$ROOT_DIR/.env" CRATE_IMAGE_REGISTRY)"
  fi
  DEPLOY_IMAGE_REGISTRY="${DEPLOY_IMAGE_REGISTRY:-ghcr.io}"

  export DEPLOY_IMAGE_TAG DEPLOY_IMAGE_SHA DEPLOY_IMAGE_OWNER DEPLOY_IMAGE_REGISTRY
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
  set_env_value "$TMP_DIR/.env" CRATE_IMAGE_OWNER "$DEPLOY_IMAGE_OWNER"
  set_env_value "$TMP_DIR/.env" CRATE_IMAGE_REGISTRY "$DEPLOY_IMAGE_REGISTRY"
}

check_image_manifests() {
  local image
  local image_name
  local failures=0
  local prefix="${DEPLOY_IMAGE_REGISTRY}/${DEPLOY_IMAGE_OWNER}"

  if [[ "$DEPLOY_SKIP_IMAGE_CHECK" == "1" ]]; then
    log "Skipping local image manifest checks"
    return
  fi

  require_command docker
  log "Checking image manifests for ${prefix}/*:${DEPLOY_IMAGE_TAG}"

  for image_name in "${REQUIRED_IMAGE_NAMES[@]}"; do
    image="${prefix}/${image_name}:${DEPLOY_IMAGE_TAG}"
    if ! docker manifest inspect "$image" >/dev/null 2>&1; then
      printf 'Missing or inaccessible image: %s\n' "$image" >&2
      failures=$((failures + 1))
    fi
  done

  if [[ "$failures" -gt 0 ]]; then
    fail "${failures} required image manifest(s) are missing or not pullable. Check that the image workflow finished and GHCR packages are public/pullable, or set DEPLOY_SKIP_IMAGE_CHECK=1 only if the remote host is authenticated to the registry."
  fi
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

  check_image_manifests
  log "Deploying ${DEPLOY_IMAGE_REGISTRY}/${DEPLOY_IMAGE_OWNER} image tag ${DEPLOY_IMAGE_TAG}${DEPLOY_IMAGE_SHA:+ (${DEPLOY_IMAGE_SHA})}"
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
