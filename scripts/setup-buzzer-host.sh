#!/bin/bash
# Chart Toppers — Buzzer host one-shot setup.
# Sets up the QLab Buzzer daemon on a fresh show machine. Idempotent.
#
# Usage (from any machine):
#   curl -fsSL https://raw.githubusercontent.com/TwistedMelonIO/chart-toppers/main/scripts/setup-buzzer-host.sh | bash
#
# After it finishes, two manual clicks remain (macOS requires user consent):
#   System Settings → Privacy & Security → Input Monitoring → + → paste path → toggle ON
#   System Settings → Privacy & Security → Accessibility   → + → paste path → toggle ON
# The script copies the path to the clipboard and opens the Settings panel for you.

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
log()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn() { echo -e "${YELLOW}[setup]${NC} $*"; }
fail() { echo -e "${RED}[setup]${NC} $*" >&2; exit 1; }

REPO_URL="https://github.com/TwistedMelonIO/chart-toppers.git"
REPO_DIR="$HOME/chart-toppers"
PLIST_SRC="$REPO_DIR/buzzer/com.twistedmelon.qlab-buzzer.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist"
LABEL="com.twistedmelon.qlab-buzzer"

# 1. Homebrew
if ! command -v brew >/dev/null 2>&1; then
  log "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for this shell
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
else
  log "Homebrew present."
fi

# 2. Python 3.12
if ! brew list python@3.12 >/dev/null 2>&1; then
  log "Installing python@3.12..."
  brew install python@3.12
else
  log "python@3.12 present."
fi

# 3. Repo
if [ ! -d "$REPO_DIR/.git" ]; then
  log "Cloning chart-toppers into $REPO_DIR..."
  git clone "$REPO_URL" "$REPO_DIR"
else
  log "Updating chart-toppers..."
  git -C "$REPO_DIR" pull --ff-only
fi

# 4. venv + python deps
log "Setting up Python venv..."
PY312="$(brew --prefix python@3.12)/bin/python3.12"
"$PY312" -m venv "$REPO_DIR/buzzer/venv"
"$REPO_DIR/buzzer/venv/bin/pip" install --quiet --upgrade pip
"$REPO_DIR/buzzer/venv/bin/pip" install --quiet -r "$REPO_DIR/buzzer/requirements.txt"

# 5. LaunchAgent
log "Installing LaunchAgent..."
mkdir -p "$HOME/Library/LaunchAgents"
launchctl unload "$PLIST_DST" 2>/dev/null || true
cp "$PLIST_SRC" "$PLIST_DST"
> /tmp/qlab-buzzer.log
launchctl load "$PLIST_DST"
sleep 2

# 6. Resolve the Python.app path that needs permissions
PY_FRAMEWORK_APP="$(dirname "$(dirname "$(readlink -f "$REPO_DIR/buzzer/venv/bin/python3")")")/Resources/Python.app"
if [ ! -d "$PY_FRAMEWORK_APP" ]; then
  warn "Could not auto-detect Python.app path. Look under $(brew --prefix python@3.12)/Frameworks/Python.framework/Versions/3.12/Resources/Python.app"
else
  log "Python.app path: $PY_FRAMEWORK_APP"
  printf "%s" "$PY_FRAMEWORK_APP" | pbcopy
  log "Path copied to clipboard."
fi

# 7. Open System Settings to Input Monitoring
log "Opening Privacy → Input Monitoring..."
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent" || true

cat <<EOF

${GREEN}=== Daemon installed and running ===${NC}

Two manual steps remain (one-time per machine):

  1. The Privacy → Input Monitoring panel just opened.
     • Click ${YELLOW}+${NC}, press ${YELLOW}Cmd+Shift+G${NC}, paste (it's already on your clipboard), Open.
     • Toggle the new "Python" entry ${YELLOW}ON${NC}.

  2. Switch to the Accessibility panel in the same window and repeat.

Then the buzzer is set up forever on this machine.
Tail logs with:  tail -f /tmp/qlab-buzzer.log

EOF
