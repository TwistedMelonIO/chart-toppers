#!/bin/bash
set -euo pipefail

# ============================================================
#  QLab Buzzer — Install as Login Service
#  Generates a LaunchAgent plist with absolute paths to THIS
#  buzzer install, so it survives the repo being cloned to a
#  non-default location (e.g. ~/TwistedMelon/chart-toppers).
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_DST="$HOME/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist"
PYTHON="$SCRIPT_DIR/venv/bin/python3"
SCRIPT="$SCRIPT_DIR/qlab_buzzer.py"

echo ""
echo "  ========================================"
echo "    QLab Buzzer — Install Service"
echo "  ========================================"
echo ""
echo "  Buzzer dir: $SCRIPT_DIR"

# Sanity-check that the venv + script actually exist at the resolved paths.
if [[ ! -x "$PYTHON" ]]; then
  echo "  ✗ Python venv not found at $PYTHON"
  echo "    Build it with: python3 -m venv $SCRIPT_DIR/venv && $SCRIPT_DIR/venv/bin/pip install -r $SCRIPT_DIR/requirements.txt"
  exit 1
fi
if [[ ! -f "$SCRIPT" ]]; then
  echo "  ✗ qlab_buzzer.py not found at $SCRIPT"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

# Unload any existing version (ignore errors — may not be loaded).
launchctl unload "$PLIST_DST" 2>/dev/null || true

# Generate plist with the resolved absolute paths baked in.
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
        <string>$PYTHON</string>
        <string>$SCRIPT</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/tmp/qlab-buzzer.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/qlab-buzzer.log</string>

    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
PLIST

echo "  ✓ Plist written to $PLIST_DST"

launchctl load "$PLIST_DST"
echo "  ✓ Service loaded and started"

echo ""
echo "  The buzzer will now:"
echo "    • Start automatically on login"
echo "    • Restart if it crashes (KeepAlive)"
echo "    • Run in the background (no Terminal)"
echo ""
echo "  Log: /tmp/qlab-buzzer.log"
echo ""
echo "  To stop:    launchctl unload $PLIST_DST"
echo "  To restart: launchctl unload $PLIST_DST && launchctl load $PLIST_DST"
echo "  To remove:  $SCRIPT_DIR/uninstall_service.sh"
echo ""
