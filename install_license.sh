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
# Read the current audio path from docker-compose.yml
CURRENT_AUDIO_PATH=$(grep ':/app/qlab-audio:ro' "$SCRIPT_DIR/docker-compose.yml" | sed 's|^[[:space:]]*- ||' | sed 's|:/app/qlab-audio:ro$||')

# Treat the placeholder as empty (fresh install)
if [ "$CURRENT_AUDIO_PATH" = "/path/to/qlab-audio" ]; then
    CURRENT_AUDIO_PATH=""
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
    # Write the path directly into docker-compose.yml using python
    # to avoid sed escaping issues with special characters in paths
    python3 -c "
import sys
path = sys.argv[1]
compose = sys.argv[2]
with open(compose, 'r') as f:
    lines = f.readlines()
new_lines = []
for line in lines:
    if ':/app/qlab-audio:ro' in line:
        indent = line[:len(line) - len(line.lstrip())]
        new_lines.append(indent + '- ' + path + ':/app/qlab-audio:ro\n')
    else:
        new_lines.append(line)
with open(compose, 'w') as f:
    f.writelines(new_lines)
" "$AUDIO_INPUT" "$SCRIPT_DIR/docker-compose.yml"

    echo "  Audio folder updated to:"
    echo "  $AUDIO_INPUT"
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
