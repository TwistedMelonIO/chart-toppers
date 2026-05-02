#!/usr/bin/env bash
# Pull the latest GitHub release of Chart Toppers, Win It In A Minute,
# and Docforge, and rebuild their Docker stacks. Named Docker volumes
# (license, machine ID, pack settings) are preserved across the rebuild.
#
# First run on a new machine: clones the repos into $BASE_DIR.
# Subsequent runs: fetches tags and checks out the newest vX.Y.Z release.
#
# Usage:
#   ./update-dockers.sh                # update all three
#   ./update-dockers.sh chart          # only chart-toppers
#   ./update-dockers.sh wim            # only win-it-in-a-minute
#   ./update-dockers.sh docforge       # only docforge
#   BASE_DIR=~/twistedmelon ./update-dockers.sh
#
# Auth: requires either `gh auth login` or git credentials with access
# to the private TwistedMelonIO repos.

set -euo pipefail

BASE_DIR="${BASE_DIR:-$HOME/TwistedMelon}"
CHART_REPO="TwistedMelonIO/chart-toppers"
WIM_REPO="TwistedMelonIO/win-it-in-a-minute"
DOCFORGE_REPO="TwistedMelonIO/docforge"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[update]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC}  $*"; }
err()  { echo -e "${RED}[err]${NC}   $*" >&2; }

command -v git    >/dev/null 2>&1 || { err "git not installed"; exit 1; }
command -v docker >/dev/null 2>&1 || { err "docker not installed"; exit 1; }

if ! docker info >/dev/null 2>&1; then
  err "Docker is not running. Start Docker Desktop and re-run."
  exit 1
fi

mkdir -p "$BASE_DIR"

update_one() {
  local name="$1"
  local repo="$2"
  local dir="$BASE_DIR/$name"

  if [[ ! -d "$dir/.git" ]]; then
    log "$name: cloning $repo into $dir"
    git clone "https://github.com/${repo}.git" "$dir"
  fi

  cd "$dir"

  if ! git diff --quiet || ! git diff --cached --quiet; then
    err "$name: uncommitted changes in $dir — stash or commit before updating"
    return 1
  fi

  log "$name: fetching tags"
  git fetch --tags --prune origin

  local latest_tag
  latest_tag=$(git tag -l 'v*' --sort=-v:refname | head -1)
  if [[ -z "$latest_tag" ]]; then
    err "$name: no version tags found in $repo"
    return 1
  fi

  local current
  current=$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)

  if [[ "$current" == "$latest_tag" ]]; then
    log "$name: already on $latest_tag — rebuilding to ensure container matches"
  else
    log "$name: $current -> $latest_tag"
    git checkout --quiet "$latest_tag"
  fi

  if [[ ! -f "$dir/docker-compose.yml" ]]; then
    err "$name: no docker-compose.yml at $dir"
    return 1
  fi

  log "$name: docker compose up -d --build"
  docker compose up -d --build

  log "$name: status"
  docker compose ps
}

TARGET="${1:-all}"

case "$TARGET" in
  all)
    update_one "chart-toppers"      "$CHART_REPO"
    update_one "win-it-in-a-minute" "$WIM_REPO"
    update_one "docforge"           "$DOCFORGE_REPO"
    ;;
  chart|chart-toppers)
    update_one "chart-toppers"      "$CHART_REPO"
    ;;
  wim|win|win-it-in-a-minute)
    update_one "win-it-in-a-minute" "$WIM_REPO"
    ;;
  docforge|forge|df)
    update_one "docforge"           "$DOCFORGE_REPO"
    ;;
  *)
    err "unknown target: $TARGET (use: all | chart | wim | docforge)"
    exit 1
    ;;
esac

log "done. License keys, machine IDs, and persistent settings are preserved (named volumes)."
