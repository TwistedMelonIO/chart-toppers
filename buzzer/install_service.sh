#!/bin/bash
set -euo pipefail

# ============================================================
#  QLab Buzzer — Install as Login Service (.app + LaunchAgent)
#
#  Builds "QLab Buzzer.app" via PyInstaller, installs it to
#  ~/Applications, and registers a LaunchAgent that launches it
#  on login. The .app is what the user grants Accessibility to —
#  ONE click per Mac, forever.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="QLab Buzzer"
APP_SRC="$SCRIPT_DIR/dist/$APP_NAME.app"
APP_DST_DIR="$HOME/Applications"
APP_DST="$APP_DST_DIR/$APP_NAME.app"
PLIST_DST="$HOME/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist"

echo ""
echo "  ========================================"
echo "    QLab Buzzer — Install Service"
echo "  ========================================"
echo ""

# Build venv if missing.
if [[ ! -x "$SCRIPT_DIR/venv/bin/python3" ]]; then
  echo "  • Building Python venv (first run)…"
  python3 -m venv "$SCRIPT_DIR/venv"
  "$SCRIPT_DIR/venv/bin/pip" install --quiet -r "$SCRIPT_DIR/requirements.txt"
fi

# Build the .app.
echo "  • Building $APP_NAME.app…"
"$SCRIPT_DIR/build_app.sh" >/dev/null

# Install the .app.
mkdir -p "$APP_DST_DIR"
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"
echo "  ✓ Installed to $APP_DST"

EXEC_PATH="$APP_DST/Contents/MacOS/$APP_NAME"

# Unload any existing LaunchAgent.
launchctl unload "$PLIST_DST" 2>/dev/null || true

# Generate LaunchAgent that launches the .app via Launch Services
# (`open -W -a`). This is required so macOS associates the running
# process with the .app's bundle identity and the Accessibility grant
# is honoured. Direct binary execution skips Launch Services and the
# permission isn't picked up.
# `open -W` blocks until the .app exits, keeping the process under
# launchd so KeepAlive can respawn it on crash.
mkdir -p "$HOME/Library/LaunchAgents"
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

echo "  ✓ LaunchAgent loaded"
echo ""
echo "  ──────────────────────────────────────────"
echo "  ONE-TIME STEP per Mac — Accessibility:"
echo "  ──────────────────────────────────────────"
echo ""
echo "  System Settings → Privacy & Security → Accessibility"
echo "    1. Click the +"
echo "    2. Add this app:"
echo "         $APP_DST"
echo "    3. Toggle it ON"
echo ""
echo "  After granting permission, restart with:"
echo "    launchctl unload \"$PLIST_DST\""
echo "    launchctl load   \"$PLIST_DST\""
echo ""
echo "  Log: /tmp/qlab-buzzer.log"
echo ""
