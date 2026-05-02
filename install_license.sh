#!/bin/bash

# ============================================================
#  Chart Toppers — Full Installer
#  One script does everything: dependencies, Docker, buzzer,
#  license activation. Just run it and follow the prompts.
#
#  Usage: cd ~/chart-toppers && ./install_license.sh
# ============================================================

PROJECT_NAME="chart-toppers"
CONTAINER_NAME="chart-toppers"
WEB_PORT=3200
API_URL="http://localhost:${WEB_PORT}"

echo ""
echo "  ========================================"
echo "    Chart Toppers — Full Setup"
echo "    Engineering the live experience."
echo "  ========================================"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
BUZZER_DIR="$SCRIPT_DIR/buzzer"

# ══════════════════════════════════════════════════════════════
#  STEP 1: Prerequisites
# ══════════════════════════════════════════════════════════════
echo "  ── Step 1: Checking prerequisites ──────"
echo ""

# ── 1a. Homebrew ───────────────────────────────────────────
if command -v /opt/homebrew/bin/brew > /dev/null 2>&1; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo "  ✓ Homebrew installed"
elif command -v /usr/local/bin/brew > /dev/null 2>&1; then
    eval "$(/usr/local/bin/brew shellenv)"
    echo "  ✓ Homebrew installed"
else
    echo "  Installing Homebrew (required for Python)..."
    echo "  You may be asked for your password."
    echo ""
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add to path for this session
    if [ -f /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -f /usr/local/bin/brew ]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi

    if command -v brew > /dev/null 2>&1; then
        echo "  ✓ Homebrew installed"
    else
        echo "  ✗ Homebrew installation failed."
        echo "    Install manually: https://brew.sh"
        echo ""
        read -p "  Press Enter to exit..."
        exit 1
    fi
fi

# ── 1b. Python 3.12 ───────────────────────────────────────
PYTHON_BIN=""
if command -v /opt/homebrew/bin/python3.12 > /dev/null 2>&1; then
    PYTHON_BIN="/opt/homebrew/bin/python3.12"
elif command -v /opt/homebrew/bin/python3 > /dev/null 2>&1; then
    PY_VER=$(/opt/homebrew/bin/python3 --version 2>&1 | awk '{print $2}' | cut -d. -f1,2)
    if [ "$(echo "$PY_VER >= 3.10" | bc 2>/dev/null)" = "1" ] 2>/dev/null; then
        PYTHON_BIN="/opt/homebrew/bin/python3"
    fi
fi

if [ -z "$PYTHON_BIN" ]; then
    echo "  Installing Python 3.12 (required for buzzers)..."
    brew install python@3.12 2>&1 | tail -3
    if command -v /opt/homebrew/bin/python3.12 > /dev/null 2>&1; then
        PYTHON_BIN="/opt/homebrew/bin/python3.12"
        echo "  ✓ Python 3.12 installed"
    else
        echo "  ✗ Python installation failed."
        echo "    Install manually: brew install python@3.12"
        echo "    Docker setup will continue without buzzer support."
        echo ""
    fi
else
    echo "  ✓ Python ready ($($PYTHON_BIN --version 2>&1))"
fi

# ── 1c. Docker ─────────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
    echo ""
    echo "  ✗ Docker is not running!"
    echo "    Please start Docker Desktop and try again."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi
echo "  ✓ Docker is running"

# ── 1d. docker-compose.yml ─────────────────────────────────
if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    echo ""
    echo "  ✗ docker-compose.yml not found!"
    echo "    Make sure this script is in the project root."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

echo ""

# ══════════════════════════════════════════════════════════════
#  STEP 2: Hardware ID
# ══════════════════════════════════════════════════════════════
echo "  ── Step 2: Hardware ID ─────────────────"
echo ""

HW_UUID=""
if [ "$(uname)" = "Darwin" ]; then
    HW_UUID=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4}')
elif [ -f /etc/machine-id ]; then
    HW_UUID=$(cat /etc/machine-id 2>/dev/null)
elif [ -f /var/lib/dbus/machine-id ]; then
    HW_UUID=$(cat /var/lib/dbus/machine-id 2>/dev/null)
fi

if [ -n "$HW_UUID" ]; then
    if [ -f "$ENV_FILE" ]; then
        grep -v '^HOST_HARDWARE_ID=' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
        mv "$ENV_FILE.tmp" "$ENV_FILE"
    fi
    echo "HOST_HARDWARE_ID=$HW_UUID" >> "$ENV_FILE"
    echo "  ✓ Hardware ID locked: ${HW_UUID:0:8}..."
else
    echo "  ⚠ Could not detect hardware UUID."
fi

echo ""

# ══════════════════════════════════════════════════════════════
#  STEP 3: QLab Audio Folder
# ══════════════════════════════════════════════════════════════
echo "  ── Step 3: QLab Audio Folder ───────────"
echo ""

CURRENT_AUDIO_PATH=""
if [ -f "$ENV_FILE" ]; then
    CURRENT_AUDIO_PATH=$(grep '^QLAB_AUDIO_PATH=' "$ENV_FILE" 2>/dev/null | sed 's/^QLAB_AUDIO_PATH=//')
fi

if [ -n "$CURRENT_AUDIO_PATH" ] && [ -d "$CURRENT_AUDIO_PATH" ]; then
    echo "  Current path:"
    echo "  $CURRENT_AUDIO_PATH"
    echo ""
    echo "  Press Enter to keep, or drag a new folder."
else
    echo "  Drag your QLab audio folder into this"
    echo "  Terminal window and press Enter."
fi
echo ""
read -r -p "  Audio folder: " AUDIO_INPUT

AUDIO_INPUT="$(echo "$AUDIO_INPUT" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
AUDIO_INPUT="$(echo "$AUDIO_INPUT" | sed "s/^['\"]//;s/['\"]$//")"
AUDIO_INPUT="$(echo "$AUDIO_INPUT" | sed 's/\\ / /g')"
AUDIO_INPUT="$(echo "$AUDIO_INPUT" | sed 's|/$||')"

if [ -z "$AUDIO_INPUT" ] && [ -n "$CURRENT_AUDIO_PATH" ]; then
    echo "  ✓ Keeping existing audio path."
elif [ -z "$AUDIO_INPUT" ] && [ -z "$CURRENT_AUDIO_PATH" ]; then
    echo "  ⚠ No audio folder provided. Set later in Settings."
elif [ -d "$AUDIO_INPUT" ]; then
    if [ -f "$ENV_FILE" ]; then
        grep -v '^QLAB_AUDIO_PATH=' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
        mv "$ENV_FILE.tmp" "$ENV_FILE"
    fi
    echo "QLAB_AUDIO_PATH=$AUDIO_INPUT" >> "$ENV_FILE"
    echo "  ✓ Audio folder saved."
else
    echo "  ✗ Folder not found: $AUDIO_INPUT"
    echo "    You can set this later in Settings."
fi

echo ""

# ══════════════════════════════════════════════════════════════
#  STEP 4: Build & Start Docker
# ══════════════════════════════════════════════════════════════
echo "  ── Step 4: Building Docker containers ──"
echo ""

docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null
BUILD_OUTPUT=$(docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build 2>&1)
echo "$BUILD_OUTPUT"

if echo "$BUILD_OUTPUT" | grep -qi "mounts denied\|not shared\|not allowed"; then
    echo ""
    echo "  ✗ Docker cannot access your audio folder."
    echo "    Copy it to ~/Desktop/qlab-audio and re-run."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

echo ""
echo "  ✓ Docker containers started"

# ══════════════════════════════════════════════════════════════
#  STEP 5: Buzzer Setup
# ══════════════════════════════════════════════════════════════
echo ""
echo "  ── Step 5: QLab Buzzer Setup ───────────"
echo ""

BUZZER_OK=false

if [ -d "$BUZZER_DIR" ] && [ -f "$BUZZER_DIR/qlab_buzzer.py" ] && [ -n "$PYTHON_BIN" ]; then
    # Create venv if needed
    if [ ! -d "$BUZZER_DIR/venv" ]; then
        echo "  Creating buzzer environment..."
        "$PYTHON_BIN" -m venv "$BUZZER_DIR/venv" 2>/dev/null
        "$BUZZER_DIR/venv/bin/pip" install --upgrade pip > /dev/null 2>&1
    fi

    # Always (re)install dependencies so an existing venv can't fall behind requirements.txt
    echo "  Ensuring buzzer dependencies are up to date..."
    "$BUZZER_DIR/venv/bin/pip" install -q -r "$BUZZER_DIR/requirements.txt"
    if [ $? -eq 0 ]; then
        echo "  ✓ Buzzer environment ready"
        BUZZER_OK=true
    else
        echo "  ✗ Failed to install buzzer dependencies."
    fi

    # Install launchd service — generate plist with absolute paths so it works
    # regardless of where the repo lives (iCloud, ~/chart-toppers, anywhere)
    if [ "$BUZZER_OK" = true ]; then
        PLIST_DST="$HOME/Library/LaunchAgents/com.twistedmelon.qlab-buzzer.plist"
        launchctl unload "$PLIST_DST" 2>/dev/null
        cat > "$PLIST_DST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.twistedmelon.qlab-buzzer</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BUZZER_DIR}/venv/bin/python3</string>
        <string>${BUZZER_DIR}/qlab_buzzer.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${BUZZER_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>/tmp/qlab-buzzer.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/qlab-buzzer.log</string>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
EOF
        launchctl load "$PLIST_DST"
        echo "  ✓ Buzzer service installed (starts on login, auto-restarts if it dies)"
    fi

    # Accessibility permissions
    echo ""
    echo "  ========================================"
    echo "    ACCESSIBILITY PERMISSION REQUIRED"
    echo "  ========================================"
    echo ""
    echo "  The buzzer needs permission to read keypresses."
    echo ""
    echo "  A System Settings window will open."
    echo "  1. Click the + button"
    echo "  2. Add 'Terminal' (or your terminal app)"
    echo "  3. Make sure the toggle is ON"
    echo ""
    read -p "  Press Enter to open System Settings..."
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null
    echo ""
    echo "  After granting permission, the buzzer will"
    echo "  work automatically — no restart needed."
    echo ""
elif [ -z "$PYTHON_BIN" ]; then
    echo "  ⚠ Skipping buzzer (Python not available)."
    echo "    Install Python and re-run to enable buzzers."
else
    echo "  ⚠ Buzzer files not found — skipping."
fi

# ══════════════════════════════════════════════════════════════
#  STEP 6: License Activation
# ══════════════════════════════════════════════════════════════
echo ""
echo "  ── Step 6: License Activation ──────────"
echo ""
echo "  Waiting for container to start..."
sleep 5

MACHINE_ID=""
for i in {1..10}; do
    MACHINE_ID=$(curl -s "${API_URL}/api/license_status" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('machine_id',''))" 2>/dev/null)
    if [ -n "$MACHINE_ID" ]; then
        break
    fi
    sleep 2
done

if [ -z "$MACHINE_ID" ]; then
    echo "  ✗ Could not retrieve Machine ID."
    echo "    The container may still be starting."
    echo "    Try running this script again."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

echo ""
echo "  ========================================"
echo "    YOUR MACHINE ID"
echo "  ========================================"
echo ""
echo "  $MACHINE_ID"
echo ""
echo "  ========================================"
echo ""

echo "$MACHINE_ID" | pbcopy 2>/dev/null
if [ $? -eq 0 ]; then
    echo "  ✓ Copied to clipboard!"
    echo ""
fi

echo "  Send this to your license provider."
echo "  If you have a key, paste it below."
echo "  Otherwise, press Enter to skip."
echo ""
read -p "  License Key: " LICENSE_KEY

if [ -z "$LICENSE_KEY" ]; then
    echo ""
    echo "  No license key entered."
    echo "  Re-run this script when you have one."
    echo ""
    echo "  ========================================"
    echo "    SETUP COMPLETE"
    echo "  ========================================"
    echo ""
    echo "  Dashboard:  http://localhost:3200"
    echo "  Settings:   Password 8888"
    echo "  Buzzers:    Key 1 = Icon, Key 2 = Anthem"
    echo ""
    echo "  To start:   ./start.sh"
    echo "  To stop:    ./stop.sh"
    echo ""
    read -p "  Press Enter to exit..."
    exit 0
fi

echo ""
echo "  Applying license key..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null
export LICENSE_KEY="$LICENSE_KEY"
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d 2>&1

echo ""
echo "  Verifying license..."
sleep 5

LICENSE_STATUS=""
for i in {1..10}; do
    LICENSE_STATUS=$(curl -s "${API_URL}/api/license_status" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('VALID' if d.get('valid') else d.get('error','UNKNOWN'))" 2>/dev/null)
    if [ -n "$LICENSE_STATUS" ]; then
        break
    fi
    sleep 2
done

echo ""
if [ "$LICENSE_STATUS" = "VALID" ]; then
    echo "  ========================================"
    echo "    SETUP COMPLETE — LICENSE ACTIVE!"
    echo "  ========================================"
    echo ""
    echo "  Dashboard:  http://localhost:3200"
    echo "  Settings:   Password 8888"
    echo "  Buzzers:    Key 1 = Icon, Key 2 = Anthem"
    echo ""
    echo "  Everything starts automatically on login."
    echo "  To manually start/stop: ./start.sh ./stop.sh"
    echo ""

    # ── Docforge Export (always) ─────────────────────────────
    echo "  ── Certificate details ─────────────────"
    echo "  (press Enter to skip a field)"
    echo ""
    read -p "  Licensee name (e.g. MSC Poesia): " LICENSEE_NAME
    read -p "  Expiry days (blank = permanent): " EXPIRY_DAYS

    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S+00:00")
    DOCFORGE_FILE="$HOME/Desktop/chart-toppers-license.docforge"

    python3 -c "
import json, sys

data = {
    'docforge_version': '1.0',
    'type': 'license',
    'name': 'chart-toppers',
    'created_at': sys.argv[1],
    'updated_at': sys.argv[1],
    'data': {
        'project_id': 'chart-toppers',
        'machine_id': sys.argv[2],
        'licensee': sys.argv[3],
        'expiry_days': sys.argv[4] if sys.argv[4] else '',
        'license_key': sys.argv[5]
    }
}

with open(sys.argv[6], 'w') as f:
    json.dump(data, f, indent=2)
" "$TIMESTAMP" "$MACHINE_ID" "$LICENSEE_NAME" "$EXPIRY_DAYS" "$LICENSE_KEY" "$DOCFORGE_FILE"

    if [ -f "$DOCFORGE_FILE" ]; then
        echo ""
        echo "  ✓ Docforge file: $DOCFORGE_FILE"
    else
        echo ""
        echo "  ✗ Failed to create .docforge file."
    fi
else
    echo "  ========================================"
    echo "    LICENSE ACTIVATION FAILED"
    echo "  ========================================"
    echo ""
    echo "  Error: $LICENSE_STATUS"
    echo "  Check your key and re-run this script."
fi

echo ""
read -p "  Press Enter to exit..."
