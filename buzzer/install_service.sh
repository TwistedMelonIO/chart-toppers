#!/bin/bash

# ============================================================
#  QLab Buzzer — Install as Login Service
#  Runs the buzzer automatically on login. No Terminal needed.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.twistedmelon.qlab-buzzer.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist"

echo ""
echo "  ========================================"
echo "    QLab Buzzer — Install Service"
echo "  ========================================"
echo ""

# Unload if already running
launchctl unload "$PLIST_DST" 2>/dev/null

# Copy plist to LaunchAgents
cp "$PLIST_SRC" "$PLIST_DST"
echo "  ✓ Service installed to ~/Library/LaunchAgents/"

# Load and start
launchctl load "$PLIST_DST"
echo "  ✓ Service started"

echo ""
echo "  The buzzer will now:"
echo "    • Start automatically on login"
echo "    • Restart if it crashes"
echo "    • Run in the background (no Terminal)"
echo ""
echo "  Log: /tmp/qlab-buzzer.log"
echo ""
echo "  To stop:    launchctl unload ~/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist"
echo "  To restart: launchctl unload ~/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist && launchctl load ~/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist"
echo "  To remove:  ./buzzer/uninstall_service.sh"
echo ""
