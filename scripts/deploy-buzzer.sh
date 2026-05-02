#!/usr/bin/env bash
# Deploy QLab Buzzer.app to a remote show machine over SSH.
# Run from the dev machine. The .app is copied (no GitHub auth needed
# on the target), unzipped to ~/Applications, and registered with
# launchd. After this, the user grants Accessibility on the target Mac
# once and it sticks forever (same binary = same fingerprint).
#
# Usage:
#   ./scripts/deploy-buzzer.sh user@host [user@host ...]
#
# Examples:
#   ./scripts/deploy-buzzer.sh dpt@192.168.1.216
#   ./scripts/deploy-buzzer.sh dpt@192.168.1.216 dpt@192.168.1.217
#
# Prerequisites on the target Mac:
#   • SSH (Remote Login) enabled
#   • Your SSH key already authorized (`ssh-copy-id user@host`)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_ZIP="$REPO_DIR/buzzer/dist/QLab Buzzer.app.zip"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC}   $*"; }
err()  { echo -e "${RED}[err]${NC}    $*" >&2; }

if [[ $# -eq 0 ]]; then
  err "no targets given"
  echo "Usage: $0 user@host [user@host ...]"
  exit 1
fi

# If the local .app.zip is missing, build it.
if [[ ! -f "$APP_ZIP" ]]; then
  log "Local $APP_ZIP not found — building…"
  "$REPO_DIR/buzzer/build_app.sh"
  ( cd "$REPO_DIR/buzzer/dist" && \
    rm -f "QLab Buzzer.app.zip" && \
    ditto -c -k --keepParent "QLab Buzzer.app" "QLab Buzzer.app.zip" )
fi

deploy_one() {
  local target="$1"
  log "→ $target"

  # 1. SSH check
  if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$target" "true" 2>/dev/null; then
    err "$target: SSH connection failed (Remote Login enabled? key authorized?)"
    return 1
  fi

  # 2. Copy the .app
  log "$target: copying $(du -h "$APP_ZIP" | cut -f1) of buzzer .app…"
  scp -q "$APP_ZIP" "$target:/tmp/qlab-buzzer-app.zip"

  # 3. Install + LaunchAgent
  log "$target: installing .app + LaunchAgent…"
  ssh "$target" 'bash -s' <<'REMOTE'
set -euo pipefail
APP_DST="$HOME/Applications/QLab Buzzer.app"
PLIST_DST="$HOME/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist"
ZIP_TMP="/tmp/qlab-buzzer-app.zip"
EXTRACT_DIR="/tmp/qlab-buzzer-app-extracted"

mkdir -p "$HOME/Applications" "$HOME/Library/LaunchAgents"
rm -rf "$APP_DST" "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
ditto -x -k "$ZIP_TMP" "$EXTRACT_DIR"
ditto "$EXTRACT_DIR/QLab Buzzer.app" "$APP_DST"
xattr -dr com.apple.quarantine "$APP_DST" 2>/dev/null || true

launchctl unload "$PLIST_DST" 2>/dev/null || true
cat > "$PLIST_DST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.twistedmelon.qlab-buzzer</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/open</string>
        <string>-W</string>
        <string>-a</string>
        <string>$APP_DST</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
PLIST
launchctl load "$PLIST_DST"

rm -f "$ZIP_TMP"
rm -rf "$EXTRACT_DIR"
echo "OK installed at $APP_DST"
REMOTE

  log "$target: ✓ installed"
  echo ""
  echo "  ────────────────────────────────────────────"
  echo "  ON $target — ONE-TIME Accessibility step:"
  echo "  ────────────────────────────────────────────"
  echo "    System Settings → Privacy & Security → Accessibility"
  echo "      1. Click the +"
  echo "      2. Add: ~/Applications/QLab Buzzer.app"
  echo "      3. Toggle it ON"
  echo ""
  echo "    Then on the dev machine, restart it remotely:"
  echo "      ssh $target 'launchctl unload ~/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist && launchctl load ~/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist'"
  echo ""
}

for target in "$@"; do
  deploy_one "$target" || warn "$target: deploy failed, continuing…"
done

log "All done."
