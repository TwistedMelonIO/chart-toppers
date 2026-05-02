#!/bin/bash
set -euo pipefail

# ============================================================
#  QLab Buzzer — Install as Login Service
#
#  Downloads the prebuilt "QLab Buzzer.app" from the latest
#  GitHub release, installs to ~/Applications, and registers a
#  LaunchAgent that launches it on login via Launch Services.
#
#  Using a prebuilt .app means every show machine runs the
#  *same binary* with the *same code-signing fingerprint*, so
#  the macOS Accessibility grant is a one-time step per Mac
#  that sticks forever (until we ship a new buzzer build).
# ============================================================

REPO="TwistedMelonIO/chart-toppers"
APP_NAME="QLab Buzzer"
APP_DST_DIR="$HOME/Applications"
APP_DST="$APP_DST_DIR/$APP_NAME.app"
PLIST_DST="$HOME/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist"
ZIP_TMP="/tmp/qlab-buzzer-app.zip"
ZIP_DIR="/tmp/qlab-buzzer-app-extracted"

echo ""
echo "  ========================================"
echo "    QLab Buzzer — Install Service"
echo "  ========================================"
echo ""

if ! command -v gh >/dev/null 2>&1; then
  echo "  ✗ 'gh' (GitHub CLI) is required to download the buzzer app."
  echo "    Install with: brew install gh"
  echo "    Then auth with: gh auth login"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "  ✗ 'gh' is not authenticated. Run: gh auth login"
  exit 1
fi

echo "  • Downloading $APP_NAME.app from latest GitHub release…"
rm -f "$ZIP_TMP"
rm -rf "$ZIP_DIR"
gh release download \
  --repo "$REPO" \
  --pattern "QLab Buzzer.app.zip" \
  --output "$ZIP_TMP"

mkdir -p "$ZIP_DIR"
ditto -x -k "$ZIP_TMP" "$ZIP_DIR"

# Install (replace existing).
mkdir -p "$APP_DST_DIR"
rm -rf "$APP_DST"
ditto "$ZIP_DIR/$APP_NAME.app" "$APP_DST"
echo "  ✓ Installed: $APP_DST"

# macOS may quarantine the unzipped .app; clear it so it launches cleanly.
xattr -dr com.apple.quarantine "$APP_DST" 2>/dev/null || true

# Unload any existing LaunchAgent.
launchctl unload "$PLIST_DST" 2>/dev/null || true

# Generate LaunchAgent that launches the .app via Launch Services
# (`open -W -a`) — required so macOS associates the running process
# with the .app's bundle identity and the Accessibility grant is
# honoured. `open -W` blocks until the .app exits, keeping the
# process under launchd so KeepAlive can respawn it on crash.
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
echo "    2. Add: $APP_DST"
echo "    3. Toggle it ON"
echo ""
echo "  After granting permission, restart with:"
echo "    launchctl unload \"$PLIST_DST\""
echo "    launchctl load   \"$PLIST_DST\""
echo ""
echo "  Log: /tmp/qlab-buzzer.log"
echo ""

# Cleanup tmp.
rm -f "$ZIP_TMP"
rm -rf "$ZIP_DIR"
