#!/bin/bash

# ============================================================
#  Chart Toppers — Stop Everything
#  Stops Docker containers + QLab Buzzer bridge.
#  Run: ./stop.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUZZER_DIR="$SCRIPT_DIR/buzzer"
PID_FILE="$BUZZER_DIR/.pid"

echo ""
echo "  ========================================"
echo "    Chart Toppers — Shutting Down"
echo "  ========================================"
echo ""

# ── 1. Stop Buzzer ─────────────────────────────────────────
if [ -f "$PID_FILE" ]; then
    BUZZER_PID=$(cat "$PID_FILE")
    if kill -0 "$BUZZER_PID" 2>/dev/null; then
        kill "$BUZZER_PID" 2>/dev/null
        echo "  ✓ QLab Buzzer stopped (PID $BUZZER_PID)"
    else
        echo "  ✓ QLab Buzzer was not running"
    fi
    rm -f "$PID_FILE"
else
    echo "  ✓ QLab Buzzer was not running"
fi

# ── 2. Stop Docker Containers ─────────────────────────────
echo "  Stopping Docker containers..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" stop 2>&1
echo "  ✓ Docker containers stopped"

echo ""
echo "  ========================================"
echo "    Chart Toppers stopped."
echo "  ========================================"
echo ""
echo "  To start again:  ./start.sh"
echo ""
