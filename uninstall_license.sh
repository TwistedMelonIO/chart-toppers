#!/bin/bash

# ============================================================
#  Chart Toppers — License Uninstaller
#  Drag this file into a Terminal window and press Enter.
# ============================================================

PROJECT_NAME="chart-toppers"
CONTAINER_NAME="chart-toppers"

echo ""
echo "  ========================================"
echo "    Chart Toppers - Uninstall License"
echo "  ========================================"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "  This will:"
echo "    - Stop the container"
echo "    - Remove the license key"
echo "    - Restart without a license"
echo ""
read -p "  Are you sure? (y/N): " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo ""
    echo "  Cancelled."
    echo ""
    read -p "  Press Enter to exit..."
    exit 0
fi

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
    echo ""
    echo "  Docker is not running!"
    echo "  Please start Docker Desktop and try again."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

# Stop the container
echo ""
echo "  Stopping container..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null

# Restart without license key
echo "  Restarting without license..."
unset LICENSE_KEY
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d 2>&1

echo ""
echo "  ========================================"
echo "    LICENSE REMOVED"
echo "  ========================================"
echo ""
echo "  The container has been restarted without a license."
echo "  Run install_license.sh to apply a new license."
echo ""
read -p "  Press Enter to exit..."
