#!/usr/bin/env bash
set -euo pipefail

CRATE_REPO="${CRATE_REPO:-thecrateapp/crate}"
CRATE_REF="${CRATE_REF:-main}"
CRATE_RAW_BASE="${CRATE_RAW_BASE:-https://raw.githubusercontent.com/${CRATE_REPO}/${CRATE_REF}}"
CRATE_INSTALL_DIR="${CRATE_INSTALL_DIR:-${HOME}/crate}"
CRATE_ASSUME_YES="${CRATE_ASSUME_YES:-0}"
CRATE_DRY_RUN="${CRATE_DRY_RUN:-0}"
CRATE_SKIP_START="${CRATE_SKIP_START:-0}"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  CYAN=$'\033[0;36m'
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[1;33m'
  RED=$'\033[0;31m'
  BOLD=$'\033[1m'
  NC=$'\033[0m'
else
  CYAN=""
  GREEN=""
  YELLOW=""
  RED=""
  BOLD=""
  NC=""
fi

TTY_FD=""
if [[ -r /dev/tty ]]; then
  if { exec 3</dev/tty; } 2>/dev/null; then
    TTY_FD=3
  fi
fi

DOCKER_CMD=(docker)
COMPOSE_CMD=()
GENERATED_ADMIN_PASSWORD=""

log() {
  printf "%b\n" "$*"
}

info() {
  log "${CYAN}==>${NC} $*"
}

success() {
  log "${GREEN}✓${NC} $*"
}

warn() {
  log "${YELLOW}!${NC} $*"
}

die() {
  log "${RED}Error:${NC} $*" >&2
  exit 1
}

run() {
  if [[ "${CRATE_DRY_RUN}" == "1" ]]; then
    printf "[dry-run]"
    printf " %q" "$@"
    printf "\n"
    return 0
  fi
  "$@"
}

can_prompt() {
  [[ -n "${TTY_FD}" && "${CRATE_ASSUME_YES}" != "1" ]]
}

read_from_tty() {
  local prompt="$1"
  local value=""
  if can_prompt; then
    printf "%b" "${prompt}" >/dev/tty
    IFS= read -r -u "${TTY_FD}" value || true
  fi
  printf "%s" "${value}"
}

prompt_default() {
  local label="$1"
  local default="$2"
  local value=""
  value="$(read_from_tty "${BOLD}${label}${NC} [${default}]: ")"
  if [[ -z "${value}" ]]; then
    value="${default}"
  fi
  printf "%s" "${value}"
}

prompt_secret_optional() {
  local label="$1"
  local value=""
  if can_prompt; then
    printf "%b" "${BOLD}${label}${NC} (leave empty to auto-generate): " >/dev/tty
    stty -echo < /dev/tty || true
    IFS= read -r -u "${TTY_FD}" value || true
    stty echo < /dev/tty || true
    printf "\n" >/dev/tty
  fi
  printf "%s" "${value}"
}

confirm() {
  local label="$1"
  local default="${2:-yes}"
  local suffix="[Y/n]"
  local answer=""
  if [[ "${default}" == "no" ]]; then
    suffix="[y/N]"
  fi
  if ! can_prompt; then
    [[ "${default}" == "yes" ]]
    return $?
  fi
  answer="$(read_from_tty "${BOLD}${label}${NC} ${suffix}: ")"
  if [[ -z "${answer}" ]]; then
    answer="${default}"
  fi
  case "${answer}" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

expand_path() {
  local path="$1"
  case "${path}" in
    "~") printf "%s" "${HOME}" ;;
    "~/"*) printf "%s/%s" "${HOME}" "${path#~/}" ;;
    *) printf "%s" "${path}" ;;
  esac
}

absolute_path() {
  local path
  path="$(expand_path "$1")"
  if [[ "${path}" == /* ]]; then
    printf "%s" "${path}"
  else
    printf "%s/%s" "$(pwd)" "${path}"
  fi
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

quote_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\\$}"
  value="${value//\`/\\\`}"
  printf '"%s"' "${value}"
}

detect_timezone() {
  if [[ -n "${TZ:-}" ]]; then
    printf "%s" "${TZ}"
  elif command -v timedatectl >/dev/null 2>&1; then
    timedatectl show -p Timezone --value 2>/dev/null || printf "UTC"
  elif [[ -f /etc/timezone ]]; then
    sed -n '1p' /etc/timezone
  else
    printf "UTC"
  fi
}

detect_os() {
  local kernel
  kernel="$(uname -s)"
  case "${kernel}" in
    Linux)
      OS_FAMILY="linux"
      OS_ID="unknown"
      if [[ -r /etc/os-release ]]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        OS_ID="${ID:-unknown}"
      fi
      ;;
    Darwin)
      OS_FAMILY="macos"
      OS_ID="macos"
      ;;
    *)
      OS_FAMILY="unsupported"
      OS_ID="${kernel}"
      ;;
  esac
}

download() {
  local url="$1"
  local dest="$2"
  local tmp="${dest}.tmp"
  if command -v curl >/dev/null 2>&1; then
    run curl -fsSL "${url}" -o "${tmp}"
  elif command -v wget >/dev/null 2>&1; then
    run wget -qO "${tmp}" "${url}"
  else
    die "curl or wget is required to download Crate files."
  fi
  run mv "${tmp}" "${dest}"
}

docker() {
  "${DOCKER_CMD[@]}" "$@"
}

compose() {
  "${COMPOSE_CMD[@]}" "$@"
}

docker_is_usable() {
  "${DOCKER_CMD[@]}" info >/dev/null 2>&1
}

install_docker_linux() {
  if ! confirm "Docker is missing. Install Docker now using Docker's official installer?" "yes"; then
    die "Docker is required. Install Docker Desktop/Engine and rerun this installer."
  fi

  local installer="/tmp/crate-get-docker.sh"
  info "Downloading Docker installer..."
  if command -v curl >/dev/null 2>&1; then
    run curl -fsSL https://get.docker.com -o "${installer}"
  elif command -v wget >/dev/null 2>&1; then
    run wget -qO "${installer}" https://get.docker.com
  else
    die "curl or wget is required to install Docker automatically."
  fi
  run sudo sh "${installer}"
  run rm -f "${installer}"
}

install_compose_plugin_linux() {
  if ! confirm "Docker Compose v2 is missing. Try to install the Compose plugin now?" "yes"; then
    die "Docker Compose v2 is required."
  fi

  case "${OS_ID}" in
    ubuntu|debian|raspbian)
      run sudo apt-get update
      run sudo apt-get install -y docker-compose-plugin
      ;;
    fedora)
      run sudo dnf install -y docker-compose-plugin
      ;;
    arch|manjaro)
      run sudo pacman -Sy --noconfirm docker-compose
      ;;
    *)
      die "Automatic Compose installation is not supported for ${OS_ID}. Install Docker Compose v2 and rerun."
      ;;
  esac
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    case "${OS_FAMILY}" in
      linux)
        install_docker_linux
        ;;
      macos)
        if command -v brew >/dev/null 2>&1 && confirm "Docker Desktop is missing. Install it with Homebrew Cask?" "no"; then
          run brew install --cask docker
          die "Docker Desktop was installed. Open it once, wait until it is running, then rerun this installer."
        fi
        die "Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and rerun this installer."
        ;;
      *)
        die "Unsupported OS: ${OS_ID}. Crate's one-line installer supports Linux and macOS."
        ;;
    esac
  fi

  if ! docker_is_usable; then
    if [[ "${OS_FAMILY}" == "linux" ]] && command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
      DOCKER_CMD=(sudo docker)
    elif [[ "${OS_FAMILY}" == "linux" ]] && command -v systemctl >/dev/null 2>&1; then
      warn "Docker is installed but not reachable. Trying to start the daemon."
      run sudo systemctl enable --now docker
      if ! docker_is_usable && sudo -n docker info >/dev/null 2>&1; then
        DOCKER_CMD=(sudo docker)
      fi
    fi
  fi

  if ! docker_is_usable; then
    die "Docker is installed but this user cannot reach the daemon. Start Docker Desktop or add your user to the docker group."
  fi

  if "${DOCKER_CMD[@]}" compose version >/dev/null 2>&1; then
    COMPOSE_CMD=("${DOCKER_CMD[@]}" compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
  else
    if [[ "${OS_FAMILY}" == "linux" ]]; then
      install_compose_plugin_linux
    else
      die "Docker Compose v2 is required. Update Docker Desktop and rerun."
    fi
    COMPOSE_CMD=("${DOCKER_CMD[@]}" compose)
  fi

  success "Docker is ready: $("${DOCKER_CMD[@]}" --version)"
  success "Compose is ready: $("${COMPOSE_CMD[@]}" version --short 2>/dev/null || "${COMPOSE_CMD[@]}" version)"
}

write_env_file() {
  local env_path="$1"
  local install_dir="$2"
  local default_tz default_music_dir default_data_dir default_downloads_dir
  local domain cf_token admin_password jwt_secret postgres_password puid pgid docker_gid image_owner image_registry

  default_tz="$(detect_timezone)"
  default_music_dir="${install_dir}/media/music"
  default_data_dir="${install_dir}/data"
  default_downloads_dir="${install_dir}/media/downloads/soulseek"

  CRATE_MUSIC_DIR="${CRATE_MUSIC_DIR:-$(prompt_default "Music library path" "${default_music_dir}")}"
  CRATE_DATA_DIR="${CRATE_DATA_DIR:-$(prompt_default "Crate data path" "${default_data_dir}")}"
  CRATE_DOWNLOADS_DIR="${CRATE_DOWNLOADS_DIR:-$(prompt_default "Download/import path" "${default_downloads_dir}")}"
  TZ_VALUE="${TZ:-$(prompt_default "Timezone" "${default_tz}")}"
  domain="${CRATE_DOMAIN:-$(prompt_default "Base domain for HTTPS (empty = local-only)" "")}"

  cf_token="${CF_DNS_API_TOKEN:-}"
  if [[ -n "${domain}" && -z "${cf_token}" ]]; then
    cf_token="$(prompt_secret_optional "Cloudflare DNS API token")"
    if [[ -z "${cf_token}" ]]; then
      warn "No Cloudflare token configured. Local ports will work, but HTTPS certificates will not be issued yet."
    fi
  fi

  admin_password="${DEFAULT_ADMIN_PASSWORD:-$(prompt_secret_optional "Initial admin password")}"
  if [[ -z "${admin_password}" ]]; then
    admin_password="$(generate_secret | cut -c1-24)"
    GENERATED_ADMIN_PASSWORD="${admin_password}"
  fi

  jwt_secret="${JWT_SECRET:-$(generate_secret)}"
  postgres_password="${CRATE_POSTGRES_PASSWORD:-$(generate_secret | cut -c1-32)}"
  puid="${PUID:-$(id -u 2>/dev/null || printf "1000")}"
  pgid="${PGID:-$(id -g 2>/dev/null || printf "1000")}"
  docker_gid="${DOCKER_GID:-$(stat -c '%g' /var/run/docker.sock 2>/dev/null || stat -f '%g' /var/run/docker.sock 2>/dev/null || printf "988")}"
  image_owner="${CRATE_IMAGE_OWNER:-${CRATE_REPO%%/*}}"
  image_registry="${CRATE_IMAGE_REGISTRY:-ghcr.io}"

  CRATE_MUSIC_DIR="$(absolute_path "${CRATE_MUSIC_DIR}")"
  CRATE_DATA_DIR="$(absolute_path "${CRATE_DATA_DIR}")"
  CRATE_DOWNLOADS_DIR="$(absolute_path "${CRATE_DOWNLOADS_DIR}")"

  run mkdir -p "${CRATE_MUSIC_DIR}" "${CRATE_DATA_DIR}" "${CRATE_DOWNLOADS_DIR}"

  if [[ -f "${env_path}" && "${CRATE_FORCE_ENV:-0}" != "1" ]]; then
    warn ".env already exists; keeping it unchanged. Set CRATE_FORCE_ENV=1 to regenerate it."
    return
  fi

  info "Writing ${env_path}"
  if [[ "${CRATE_DRY_RUN}" == "1" ]]; then
    log "[dry-run] write ${env_path}"
    return
  fi

  umask 077
  cat > "${env_path}" <<EOF
# Crate home installation
TZ=$(quote_env_value "${TZ_VALUE}")
PUID=$(quote_env_value "${puid}")
PGID=$(quote_env_value "${pgid}")
DOCKER_GID=$(quote_env_value "${docker_gid}")
LANGUAGE=$(quote_env_value "${LANGUAGE:-en}")

CRATE_IMAGE_TAG=$(quote_env_value "${CRATE_IMAGE_TAG:-latest}")
CRATE_IMAGE_OWNER=$(quote_env_value "${image_owner}")
CRATE_IMAGE_REGISTRY=$(quote_env_value "${image_registry}")
DOMAIN=$(quote_env_value "${domain:-localhost}")
CRATE_CONFIG_FILE=$(quote_env_value "${CRATE_CONFIG_FILE:-./config.yaml}")

DATA_DIR=$(quote_env_value "${CRATE_DATA_DIR}")
MUSIC_DIR=$(quote_env_value "${CRATE_MUSIC_DIR}")
DOWNLOADS_DIR=$(quote_env_value "${CRATE_DOWNLOADS_DIR}")

TRAEFIK_HTTP_PORT=$(quote_env_value "${TRAEFIK_HTTP_PORT:-80}")
TRAEFIK_HTTPS_PORT=$(quote_env_value "${TRAEFIK_HTTPS_PORT:-443}")
CRATE_API_PORT=$(quote_env_value "${CRATE_API_PORT:-8585}")
CRATE_ADMIN_PORT=$(quote_env_value "${CRATE_ADMIN_PORT:-8580}")
CRATE_LISTEN_PORT=$(quote_env_value "${CRATE_LISTEN_PORT:-8581}")

CF_DNS_API_TOKEN=$(quote_env_value "${cf_token}")

POSTGRES_SUPERUSER_USER=$(quote_env_value "${POSTGRES_SUPERUSER_USER:-crate}")
POSTGRES_SUPERUSER_PASSWORD=$(quote_env_value "${POSTGRES_SUPERUSER_PASSWORD:-${postgres_password}}")
POSTGRES_SUPERUSER_DB=$(quote_env_value "${POSTGRES_SUPERUSER_DB:-crate}")

CRATE_POSTGRES_USER=$(quote_env_value "${CRATE_POSTGRES_USER:-crate}")
CRATE_POSTGRES_PASSWORD=$(quote_env_value "${postgres_password}")
CRATE_POSTGRES_DB=$(quote_env_value "${CRATE_POSTGRES_DB:-crate}")

JWT_SECRET=$(quote_env_value "${jwt_secret}")
DEFAULT_ADMIN_PASSWORD=$(quote_env_value "${admin_password}")
GOOGLE_CLIENT_ID=$(quote_env_value "${GOOGLE_CLIENT_ID:-}")
GOOGLE_CLIENT_SECRET=$(quote_env_value "${GOOGLE_CLIENT_SECRET:-}")

LASTFM_APIKEY=$(quote_env_value "${LASTFM_APIKEY:-}")
LASTFM_API_SECRET=$(quote_env_value "${LASTFM_API_SECRET:-}")
FANART_API_KEY=$(quote_env_value "${FANART_API_KEY:-}")
SPOTIFY_ID=$(quote_env_value "${SPOTIFY_ID:-}")
SPOTIFY_SECRET=$(quote_env_value "${SPOTIFY_SECRET:-}")
SETLISTFM_API_KEY=$(quote_env_value "${SETLISTFM_API_KEY:-}")
DISCOGS_CONSUMER_KEY=$(quote_env_value "${DISCOGS_CONSUMER_KEY:-}")
DISCOGS_CONSUMER_SECRET=$(quote_env_value "${DISCOGS_CONSUMER_SECRET:-}")
TICKETMASTER_API_KEY=$(quote_env_value "${TICKETMASTER_API_KEY:-}")

SLSKD_URL=$(quote_env_value "${SLSKD_URL:-}")
SLSKD_API_KEY=$(quote_env_value "${SLSKD_API_KEY:-}")

READPLANE_ENABLED=$(quote_env_value "${READPLANE_ENABLED:-true}")
READPLANE_ENABLE_SSE=$(quote_env_value "${READPLANE_ENABLE_SSE:-true}")
READPLANE_ROUTE_MODE=$(quote_env_value "${READPLANE_ROUTE_MODE:-shadow}")
READPLANE_FALLBACK_ENABLED=$(quote_env_value "${READPLANE_FALLBACK_ENABLED:-true}")
EOF
}

write_traefik_config() {
  local data_dir="$1"
  local domain="$2"
  local email="${CRATE_ACME_EMAIL:-admin@${domain:-localhost}}"
  local traefik_dir="${data_dir}/traefik"

  run mkdir -p "${traefik_dir}/conf" "${traefik_dir}/logs"
  if [[ "${CRATE_DRY_RUN}" == "1" ]]; then
    log "[dry-run] write ${traefik_dir}/traefik.yml"
    log "[dry-run] write ${traefik_dir}/conf/dynamic.yml"
    return
  fi

  cat > "${traefik_dir}/traefik.yml" <<EOF
global:
  checkNewVersion: true
  sendAnonymousUsage: false

log:
  level: INFO
  filePath: "/var/log/traefik/traefik.log"

accessLog:
  filePath: "/var/log/traefik/access.log"
  bufferingSize: 100

api:
  dashboard: true

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true

  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    network: crate
    exposedByDefault: false

  file:
    directory: /conf
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: ${email}
      storage: /acme.json
      keyType: EC384
      dnsChallenge:
        provider: cloudflare
        resolvers:
          - "1.1.1.1:53"
          - "1.0.0.1:53"

tls:
  options:
    default:
      minVersion: VersionTLS12
EOF

  cat > "${traefik_dir}/conf/dynamic.yml" <<'EOF'
http:
  middlewares: {}
EOF

  touch "${traefik_dir}/acme.json"
  chmod 600 "${traefik_dir}/acme.json"
}

install_crate_files() {
  local install_dir="$1"
  run mkdir -p "${install_dir}"

  info "Downloading Crate compose files from ${CRATE_REPO}@${CRATE_REF}"
  download "${CRATE_RAW_BASE}/docker-compose.home.yaml" "${install_dir}/docker-compose.yaml"
  download "${CRATE_RAW_BASE}/app/config.yaml" "${install_dir}/config.yaml"
  success "Installer files are in ${install_dir}"
}

start_crate() {
  local install_dir="$1"
  if [[ "${CRATE_SKIP_START}" == "1" ]]; then
    warn "Skipping startup because CRATE_SKIP_START=1."
    return
  fi

  info "Pulling Crate images..."
  (cd "${install_dir}" && compose -f docker-compose.yaml pull)

  info "Starting Crate..."
  (cd "${install_dir}" && compose -f docker-compose.yaml up -d --remove-orphans)
  (cd "${install_dir}" && compose -f docker-compose.yaml ps)
}

print_next_steps() {
  local domain="$1"
  local admin_port="${CRATE_ADMIN_PORT:-8580}"
  local listen_port="${CRATE_LISTEN_PORT:-8581}"
  local api_port="${CRATE_API_PORT:-8585}"
  local install_dir_display
  printf -v install_dir_display "%q" "${CRATE_INSTALL_DIR}"

  log ""
  success "Crate is installed."
  log ""
  log "${BOLD}Local URLs:${NC}"
  log "  Admin:  http://localhost:${admin_port}"
  log "  Listen: http://localhost:${listen_port}"
  log "  API:    http://localhost:${api_port}/api/status"

  if [[ -n "${domain}" && "${domain}" != "localhost" ]]; then
    log ""
    log "${BOLD}Public URLs:${NC}"
    log "  Admin:  https://admin.${domain}"
    log "  Listen: https://listen.${domain}"
    log "  API:    https://api.${domain}"
  fi

  log ""
  log "${BOLD}Default admin user:${NC} admin@cratemusic.app"
  if [[ -n "${GENERATED_ADMIN_PASSWORD}" ]]; then
    log "${BOLD}Generated admin password:${NC} ${GENERATED_ADMIN_PASSWORD}"
  else
    log "Use the admin password you entered during installation."
  fi
  log ""
  log "Manage the stack from the install directory:"
  log "  cd ${install_dir_display}"
  log "  docker compose -f docker-compose.yaml ps"
}

main() {
  log ""
  log "${CYAN}${BOLD}Crate one-line installer${NC}"
  log ""

  detect_os
  info "Detected OS: ${OS_ID}"
  if [[ "${CRATE_DRY_RUN}" == "1" || "${CRATE_SKIP_START}" == "1" ]]; then
    warn "Skipping Docker validation because containers will not be started."
  else
    ensure_docker
  fi

  CRATE_INSTALL_DIR="$(absolute_path "$(prompt_default "Install directory" "${CRATE_INSTALL_DIR}")")"
  install_crate_files "${CRATE_INSTALL_DIR}"
  write_env_file "${CRATE_INSTALL_DIR}/.env" "${CRATE_INSTALL_DIR}"

  if [[ "${CRATE_DRY_RUN}" == "1" ]]; then
    warn "Dry-run complete; no files were written and no containers were started."
    return
  fi

  # shellcheck disable=SC1091
  set -a
  . "${CRATE_INSTALL_DIR}/.env"
  set +a

  write_traefik_config "${DATA_DIR}" "${DOMAIN}"
  start_crate "${CRATE_INSTALL_DIR}"
  print_next_steps "${DOMAIN}"
}

main "$@"
