#!/usr/bin/env bash
set -euo pipefail

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

header() {
  echo -e "\n${CYAN}╔═══════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║${BOLD}          Crate Installer              ${NC}${CYAN}║${NC}"
  echo -e "${CYAN}╚═══════════════════════════════════════╝${NC}\n"
}

check_deps() {
  echo -e "${BOLD}Checking dependencies...${NC}"
  for cmd in docker git; do
    if ! command -v "$cmd" &>/dev/null; then
      echo -e "${RED}✗ $cmd not found. Please install $cmd first.${NC}"
      exit 1
    fi
    echo -e "  ${GREEN}✓${NC} $cmd"
  done
  if ! docker compose version &>/dev/null && ! docker-compose version &>/dev/null; then
    echo -e "${RED}✗ Docker Compose not found.${NC}"
    exit 1
  fi
  echo -e "  ${GREEN}✓${NC} docker compose"
  echo ""
}

install() {
  header
  check_deps

  # Clone if not already in a crate directory
  if [ ! -f "docker-compose.yaml" ]; then
    echo -e "${BOLD}Cloning Crate...${NC}"
    git clone https://github.com/crate-music/crate.git
    cd crate
    echo -e "  ${GREEN}✓${NC} Cloned to $(pwd)\n"
  fi

  # Run setup
  if [ -f "crate" ]; then
    exec ./crate setup
  else
    echo -e "${RED}Setup script not found. Please run from the crate directory.${NC}"
    exit 1
  fi
}

install "$@"
