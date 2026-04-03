#!/bin/bash

# ============================================================
#  Chart Toppers — Start Everything
#  Launches Docker containers + QLab Buzzer bridge.
#  Run: ./start.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUZZER_DIR="$SCRIPT_DIR/buzzer"
PID_FILE="$BUZZER_DIR/.pid"
BUZZER_LOG="$BUZZER_DIR/buzzer.log"

echo ""
echo "  ========================================"
echo "    Chart Toppers — Starting Up"
echo "  ========================================"
echo ""

# ── 1. Check Docker ────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
    echo "  ✗ Docker is not running!"
    echo "    Please start Docker Desktop and try again."
    echo ""
    exit 1
fi
echo "  ✓ Docker is running"

# ── 2. Start Docker Containers ─────────────────────────────
echo ""
echo "  Starting Docker containers..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build 2>&1 | tail -5
echo ""
echo "  ✓ Docker containers started"
echo "    Dashboard: http://localhost:3200"

# ── 3. Set Up Buzzer (if not already set up) ───────────────
if [ ! -d "$BUZZER_DIR/venv" ]; then
    echo ""
    echo "  Setting up QLab Buzzer for first time..."

    # Find a suitable Python 3 (prefer Homebrew, fall back to system)
    PYTHON_BIN=""
    if command -v /opt/homebrew/bin/python3.12 > /dev/null 2>&1; then
        PYTHON_BIN="/opt/homebrew/bin/python3.12"
    elif command -v /opt/homebrew/bin/python3 > /dev/null 2>&1; then
        PYTHON_BIN="/opt/homebrew/bin/python3"
    elif command -v python3 > /dev/null 2>&1; then
        PYTHON_BIN="python3"
    fi

    if [ -z "$PYTHON_BIN" ]; then
        echo "  ✗ Python 3 not found!"
        echo "    Install with: brew install python@3.12"
        echo "    Docker containers are running but buzzer is not."
        echo ""
        exit 0
    fi

    PYTHON_VER=$("$PYTHON_BIN" --version 2>&1 | awk '{print $2}')
    echo "  Using Python: $PYTHON_BIN ($PYTHON_VER)"

    "$PYTHON_BIN" -m venv "$BUZZER_DIR/venv"
    "$BUZZER_DIR/venv/bin/pip" install --upgrade pip > /dev/null 2>&1
    "$BUZZER_DIR/venv/bin/pip" install -r "$BUZZER_DIR/requirements.txt" 2>&1 | tail -3

    if [ $? -ne 0 ]; then
        echo ""
        echo "  ✗ Failed to install buzzer dependencies."
        echo "    Try: brew install python@3.12"
        echo "    Then delete buzzer/venv and run ./start.sh again."
        echo "    Docker containers are running but buzzer is not."
        echo ""
        exit 0
    fi

    echo "  ✓ Buzzer environment created"
fi

# ── 4. Stop Existing Buzzer (if running) ───────────────────
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        kill "$OLD_PID" 2>/dev/null
        sleep 1
        echo "  Stopped previous buzzer (PID $OLD_PID)"
    fi
    rm -f "$PID_FILE"
fi

# ── 5. Start Buzzer ────────────────────────────────────────
echo ""
echo "  Starting QLab Buzzer bridge..."
nohup "$BUZZER_DIR/venv/bin/python3" "$BUZZER_DIR/qlab_buzzer.py" > "$BUZZER_LOG" 2>&1 &
BUZZER_PID=$!
echo "$BUZZER_PID" > "$PID_FILE"

# Brief pause to check it started OK
sleep 2

if kill -0 "$BUZZER_PID" 2>/dev/null; then
    # Check for accessibility error
    if grep -qi "not trusted" "$BUZZER_LOG" 2>/dev/null; then
        echo "  ⚠ Buzzer started but needs Accessibility permissions."
        echo ""
        echo "  ========================================"
        echo "    ACCESSIBILITY PERMISSION REQUIRED"
        echo "  ========================================"
        echo ""
        echo "  The buzzer needs permission to read keypresses."
        echo ""
        echo "  1. Go to: System Settings > Privacy & Security"
        echo "            > Accessibility"
        echo "  2. Click the + button"
        echo "  3. Add your Terminal app (Terminal, iTerm2, etc.)"
        echo "  4. Make sure the toggle is ON"
        echo "  5. Run ./stop.sh then ./start.sh again"
        echo ""

        # Try to open System Settings directly
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null
    else
        echo "  ✓ QLab Buzzer running (PID $BUZZER_PID)"
        echo "    Key 1 → IBUZZ (Icon Buzzer)"
        echo "    Key 2 → ABUZZ (Anthem Buzzer)"
        echo "    Log: buzzer/buzzer.log"
    fi
else
    echo "  ✗ Buzzer failed to start. Check buzzer/buzzer.log"
fi

# ── Done ───────────────────────────────────────────────────
echo ""
echo "  ========================================"
echo "    Chart Toppers is ready!"
echo "  ========================================"
echo ""
echo "  Dashboard:  http://localhost:3200"
echo "  Settings:   Password 8888"
echo "  OSC Input:  Port 53536"
echo "  Buzzer:     Active (keys 1 & 2)"
echo ""
echo "  To stop:    ./stop.sh"
echo ""
