#!/bin/bash

# ============================================================
#  QLab Buzzer — Uninstall Login Service
# ============================================================

PLIST_DST="$HOME/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist"

echo ""
echo "  ========================================"
echo "    QLab Buzzer — Uninstall Service"
echo "  ========================================"
echo ""

if [ -f "$PLIST_DST" ]; then
    launchctl unload "$PLIST_DST" 2>/dev/null
    rm -f "$PLIST_DST"
    echo "  ✓ Service stopped and removed"
else
    echo "  Service was not installed"
fi

echo ""
