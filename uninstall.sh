#!/bin/bash

# ============================================================
#  Chart Toppers — Uninstall
#  Removes all containers, images, volumes, and project files.
#  Drag this file into a Terminal window and press Enter.
# ============================================================

PROJECT_NAME="chart-toppers"

echo ""
echo "  ========================================"
echo "    Chart Toppers - Uninstall"
echo "  ========================================"
echo ""
echo "  This will permanently remove:"
echo ""
echo "    - Docker containers (chart-toppers, osc-bridge)"
echo "    - Docker images"
echo "    - Docker volumes (license, activity logs, settings)"
echo "    - The chart-toppers project folder"
echo ""
echo "  This cannot be undone."
echo ""
read -p "  Type YES to confirm: " CONFIRM

if [ "$CONFIRM" != "YES" ]; then
    echo ""
    echo "  Uninstall cancelled."
    echo ""
    read -p "  Press Enter to exit..."
    exit 0
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "  Stopping containers..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null

echo "  Removing Docker images..."
docker rmi chart-toppers-chart-toppers 2>/dev/null
docker rmi chart-toppers-osc-bridge 2>/dev/null

echo "  Removing Docker volumes..."
docker volume rm chart-toppers_chart-toppers-data 2>/dev/null

echo "  Removing project folder..."
rm -rf "$SCRIPT_DIR"

echo ""
echo "  ========================================"
echo "    UNINSTALL COMPLETE"
echo "  ========================================"
echo ""
echo "  Chart Toppers has been removed from"
echo "  this machine."
echo ""
echo "  To reinstall, visit:"
echo "  https://github.com/TwistedMelonIO/chart-toppers"
echo ""
read -p "  Press Enter to exit..."
