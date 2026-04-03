#!/bin/bash

# ============================================================
#  Chart Toppers — License Installer
#  Drag this file into a Terminal window and press Enter.
# ============================================================

PROJECT_NAME="chart-toppers"
CONTAINER_NAME="chart-toppers"
WEB_PORT=3200
API_URL="http://localhost:${WEB_PORT}"

echo ""
echo "  ========================================"
echo "    Chart Toppers - License Setup"
echo "  ========================================"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

# Detect host hardware UUID and write to .env for stable machine ID
echo "  Detecting hardware ID..."
HW_UUID=""
if [ "$(uname)" = "Darwin" ]; then
    HW_UUID=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4}')
elif [ -f /etc/machine-id ]; then
    HW_UUID=$(cat /etc/machine-id 2>/dev/null)
elif [ -f /var/lib/dbus/machine-id ]; then
    HW_UUID=$(cat /var/lib/dbus/machine-id 2>/dev/null)
fi

if [ -n "$HW_UUID" ]; then
    # Write/update HOST_HARDWARE_ID in .env (preserve other vars)
    if [ -f "$ENV_FILE" ]; then
        # Remove old HOST_HARDWARE_ID line if present
        grep -v '^HOST_HARDWARE_ID=' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
        mv "$ENV_FILE.tmp" "$ENV_FILE"
    fi
    echo "HOST_HARDWARE_ID=$HW_UUID" >> "$ENV_FILE"
    echo "  Hardware ID locked: ${HW_UUID:0:8}..."
else
    echo "  Warning: Could not detect hardware UUID."
    echo "  Machine ID will fall back to container-based (not stable across reinstalls)."
fi
echo ""

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "  Docker is not running!"
    echo "  Please start Docker Desktop and try again."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# Check if docker-compose.yml exists
if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    echo "  docker-compose.yml not found!"
    echo "  Make sure this script is in the project root."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# ── QLab Audio Folder ──────────────────────────────────────
# Read the current audio path from .env (persists across updates)
CURRENT_AUDIO_PATH=""
if [ -f "$ENV_FILE" ]; then
    CURRENT_AUDIO_PATH=$(grep '^QLAB_AUDIO_PATH=' "$ENV_FILE" 2>/dev/null | sed 's/^QLAB_AUDIO_PATH=//')
fi

echo "  ========================================"
echo "    QLab Audio Folder"
echo "  ========================================"
echo ""
if [ -n "$CURRENT_AUDIO_PATH" ] && [ -d "$CURRENT_AUDIO_PATH" ]; then
    echo "  Current path:"
    echo "  $CURRENT_AUDIO_PATH"
    echo ""
    echo "  Press Enter to keep this path, or drag"
    echo "  your QLab audio folder here to change it."
else
    echo "  Drag your QLab audio folder into this"
    echo "  Terminal window and press Enter."
fi
echo ""
read -r -p "  Audio folder: " AUDIO_INPUT

# Clean the input:
# 1. Strip leading/trailing whitespace
AUDIO_INPUT="$(echo "$AUDIO_INPUT" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
# 2. Remove surrounding quotes (copy-paste or drag-drop may add them)
AUDIO_INPUT="$(echo "$AUDIO_INPUT" | sed "s/^['\"]//;s/['\"]$//")"
# 3. Unescape backslash-spaces (drag-drop escapes spaces)
AUDIO_INPUT="$(echo "$AUDIO_INPUT" | sed 's/\\ / /g')"
# 4. Remove trailing slash
AUDIO_INPUT="$(echo "$AUDIO_INPUT" | sed 's|/$||')"

if [ -z "$AUDIO_INPUT" ] && [ -n "$CURRENT_AUDIO_PATH" ]; then
    echo "  Keeping existing audio path."
    echo ""
elif [ -z "$AUDIO_INPUT" ] && [ -z "$CURRENT_AUDIO_PATH" ]; then
    echo "  No audio folder provided."
    echo "  You can set this later by re-running the script."
    echo ""
elif [ -d "$AUDIO_INPUT" ]; then
    # Write the path to .env so it persists across version updates
    # (docker-compose.yml reads it via ${QLAB_AUDIO_PATH} variable)
    if [ -f "$ENV_FILE" ]; then
        grep -v '^QLAB_AUDIO_PATH=' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
        mv "$ENV_FILE.tmp" "$ENV_FILE"
    fi
    echo "QLAB_AUDIO_PATH=$AUDIO_INPUT" >> "$ENV_FILE"

    echo "  Audio folder saved to .env:"
    echo "  $AUDIO_INPUT"
    echo "  (This path persists across version updates)"
    echo ""
else
    echo ""
    echo "  Folder not found: $AUDIO_INPUT"
    echo "  Please check the path and try again."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# ── Build & Start ──────────────────────────────────────────
echo "  Building and starting the container..."
echo ""

# Stop any existing container
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null

# Start without license to get machine ID
BUILD_OUTPUT=$(docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build 2>&1)
echo "$BUILD_OUTPUT"

# Check for Docker file sharing / mount errors
if echo "$BUILD_OUTPUT" | grep -qi "mounts denied\|not shared\|not allowed"; then
    echo ""
    echo "  ========================================"
    echo "    DOCKER FILE SHARING ERROR"
    echo "  ========================================"
    echo ""
    echo "  Docker cannot access your QLab audio folder."
    echo "  This usually happens with iCloud Drive or"
    echo "  restricted folders."
    echo ""
    echo "  To fix this, either:"
    echo ""
    echo "  1. Copy your audio folder to a simpler location:"
    echo "     cp -r /path/to/audio ~/Desktop/qlab-audio"
    echo "     Then re-run this script and drag the new folder."
    echo ""
    echo "  2. Or add the folder in Docker Desktop:"
    echo "     Settings > Resources > File Sharing"
    echo "     Add the parent folder, then re-run this script."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# ── Buzzer Setup ──────────────────────────────────────────
echo ""
echo "  ========================================"
echo "    QLab Buzzer Setup"
echo "  ========================================"
echo ""

BUZZER_DIR="$SCRIPT_DIR/buzzer"

if [ -d "$BUZZER_DIR" ] && [ -f "$BUZZER_DIR/qlab_buzzer.py" ]; then
    if [ ! -d "$BUZZER_DIR/venv" ]; then
        echo "  Setting up QLab Buzzer environment..."

        # Find suitable Python
        PYTHON_BIN=""
        if command -v /opt/homebrew/bin/python3.12 > /dev/null 2>&1; then
            PYTHON_BIN="/opt/homebrew/bin/python3.12"
        elif command -v /opt/homebrew/bin/python3 > /dev/null 2>&1; then
            PYTHON_BIN="/opt/homebrew/bin/python3"
        elif command -v python3 > /dev/null 2>&1; then
            PYTHON_BIN="python3"
        fi

        if [ -n "$PYTHON_BIN" ]; then
            "$PYTHON_BIN" -m venv "$BUZZER_DIR/venv" 2>/dev/null
            "$BUZZER_DIR/venv/bin/pip" install --upgrade pip > /dev/null 2>&1
            "$BUZZER_DIR/venv/bin/pip" install -r "$BUZZER_DIR/requirements.txt" > /dev/null 2>&1

            if [ $? -eq 0 ]; then
                echo "  Buzzer environment ready."
            else
                echo "  Warning: Failed to install buzzer dependencies."
                echo "  Try: brew install python@3.12"
                echo "  Then delete buzzer/venv and run ./start.sh"
            fi
        else
            echo "  Warning: Python 3 not found."
            echo "  Install with: brew install python@3.12"
        fi
    else
        echo "  Buzzer environment already exists."
    fi

    echo ""
    echo "  IMPORTANT: The buzzer needs Accessibility"
    echo "  permissions to read keypresses globally."
    echo ""
    echo "  Go to: System Settings > Privacy & Security"
    echo "         > Accessibility"
    echo "  Add your Terminal app and enable the toggle."
    echo ""
    echo "  Use ./start.sh to launch everything together."
    echo ""
else
    echo "  Buzzer files not found — skipping."
fi

echo ""
echo "  Waiting for container to start..."
sleep 5

# Get the machine ID from the API
echo "  Retrieving Machine ID..."
MACHINE_ID=""
for i in {1..10}; do
    MACHINE_ID=$(curl -s "${API_URL}/api/license_status" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('machine_id',''))" 2>/dev/null)
    if [ -n "$MACHINE_ID" ]; then
        break
    fi
    sleep 2
done

if [ -z "$MACHINE_ID" ]; then
    echo "  Could not retrieve Machine ID."
    echo "  The container may still be starting up."
    echo "  Try running this script again in a moment."
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

# Copy machine ID to clipboard if possible
echo "$MACHINE_ID" | pbcopy 2>/dev/null
if [ $? -eq 0 ]; then
    echo "  Machine ID has been copied to your clipboard!"
    echo ""
fi

echo "  Send this Machine ID to your license provider."
echo "  They will send you a license key."
echo ""
echo "  If you already have a license key, paste it below."
echo "  Otherwise, press Enter to skip for now."
echo ""
read -p "  License Key: " LICENSE_KEY

if [ -z "$LICENSE_KEY" ]; then
    echo ""
    echo "  No license key entered."
    echo "  The app is running at: ${API_URL}"
    echo "  Re-run this script when you have your license key."
    echo ""
    read -p "  Press Enter to exit..."
    exit 0
fi

# Stop the container and restart with the license key
echo ""
echo "  Applying license key..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null

# Set the LICENSE_KEY environment variable and restart
export LICENSE_KEY="$LICENSE_KEY"
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d 2>&1

echo ""
echo "  Waiting for container to start with license..."
sleep 5

# Verify the license
echo "  Verifying license..."
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
    echo "    LICENSE ACTIVATED SUCCESSFULLY!"
    echo "  ========================================"
    echo ""
    echo "  The app is now running at: ${API_URL}"
    echo ""

    # ── Docforge Export ──────────────────────────────────────
    echo "  Would you like to generate a .docforge file"
    echo "  for PDF certificate generation?"
    echo ""
    read -p "  Generate .docforge file? (y/N): " DOCFORGE_CHOICE

    if [ "$DOCFORGE_CHOICE" = "y" ] || [ "$DOCFORGE_CHOICE" = "Y" ]; then
        echo ""
        read -p "  Licensee name (e.g. MSC Poesia): " LICENSEE_NAME
        read -p "  Expiry days (leave blank for permanent): " EXPIRY_DAYS

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
            echo "  ========================================"
            echo "    DOCFORGE FILE CREATED"
            echo "  ========================================"
            echo ""
            echo "  $DOCFORGE_FILE"
            echo ""
            echo "  Drag this file into Docforge to generate"
            echo "  the license PDF certificate."
        else
            echo ""
            echo "  Failed to create .docforge file."
        fi
    fi
else
    echo "  ========================================"
    echo "    LICENSE ACTIVATION FAILED"
    echo "  ========================================"
    echo ""
    echo "  Error: $LICENSE_STATUS"
    echo ""
    echo "  Please check your license key and try again."
fi

echo ""
read -p "  Press Enter to exit..."
