#!/bin/bash
# Builds "QLab Buzzer.app" from qlab_buzzer.py via PyInstaller.
# Output: ./dist/QLab Buzzer.app
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -x venv/bin/python3 ]]; then
  echo "  ✗ venv missing — run: python3 -m venv venv && ./venv/bin/pip install -r requirements.txt"
  exit 1
fi

# Make sure pyinstaller is in the venv (separate from runtime deps)
if ! ./venv/bin/python3 -c "import PyInstaller" 2>/dev/null; then
  echo "  • Installing PyInstaller…"
  ./venv/bin/pip install --quiet pyinstaller
fi

# Clean previous build artifacts.
rm -rf build dist "QLab Buzzer.spec"

# Build the .app. --windowed produces a proper macOS .app bundle.
# config.json is bundled in so the .app is self-contained.
./venv/bin/pyinstaller \
  --windowed \
  --name "QLab Buzzer" \
  --osx-bundle-identifier com.twistedmelon.qlab-buzzer \
  --add-data "config.json:." \
  --noconfirm \
  qlab_buzzer.py >/dev/null

APP="$SCRIPT_DIR/dist/QLab Buzzer.app"
PLIST="$APP/Contents/Info.plist"

# Mark as a background-only agent (no Dock icon, no menu bar).
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$PLIST"

# iCloud / Finder can leave xattrs on the build that block codesign.
xattr -cr "$APP"

# Re-sign with ad-hoc signature so macOS will run it locally.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "  ✓ Built: $APP"
