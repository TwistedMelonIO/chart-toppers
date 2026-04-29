#!/bin/bash
# Chart Toppers — full auto-test suite.
#
# Runs every automated test in order. Stops at the first failing suite —
# game-logic tests are skipped if license persistence is broken because
# the destructive license tests leave the container in a known-good state.
#
# Usage:
#     bash scripts/test-all.sh
#
# Exit 0 = all suites passed, 1 = at least one failed.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN=$'\033[32m'
RED=$'\033[31m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

cd "$PROJECT_DIR"

echo ""
echo "${YELLOW}╔════════════════════════════════════════════════════╗"
echo "║  Chart Toppers — Full Auto-Test Suite              ║"
echo "╚════════════════════════════════════════════════════╝${RESET}"

# ── Suite 1: License persistence ────────────────────────────────
echo ""
echo "${YELLOW}▶ Suite 1/2 — License persistence${RESET}"
if ! bash "$SCRIPT_DIR/test-license-persistence.sh"; then
  echo ""
  echo "${RED}✗ License persistence suite FAILED. Skipping game-logic tests.${RESET}"
  echo "${RED}  Do not roll out — fix license persistence first.${RESET}"
  exit 1
fi

# ── Suite 2: Game logic (round flow) ────────────────────────────
echo ""
echo "${YELLOW}▶ Suite 2/2 — Game logic (round flow)${RESET}"
if ! python3 "$SCRIPT_DIR/test-rounds.py"; then
  echo ""
  echo "${RED}✗ Game-logic suite FAILED.${RESET}"
  exit 1
fi

# ── All passed ──────────────────────────────────────────────────
echo ""
echo "${GREEN}╔════════════════════════════════════════════════════╗"
echo "║  All automated test suites passed.                 ║"
echo "╚════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "Manual rollout checks still required:"
echo "  • T6 — Mac mini reboot (auto-start)"
echo "  • T8 — Docker Desktop factory reset (optional)"
echo "  • Visual / audio walkthrough (TEST_CHECKLIST.md)"
exit 0
