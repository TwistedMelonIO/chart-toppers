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

# Build and start the container (without license first to get Machine ID)
echo "  Building and starting the container..."
echo ""

# Check if docker-compose.yml exists
if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    echo "  docker-compose.yml not found!"
    echo "  Make sure this script is in the project root."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# Stop any existing container
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null

# Start without license to get machine ID
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build 2>&1

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
