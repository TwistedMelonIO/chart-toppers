#!/usr/bin/env python3
"""QLab Buzzer Bridge — Routes USB buzzer keypresses to QLab via AppleScript."""

import json
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
from pathlib import Path

from pynput import keyboard
from pythonosc import udp_client

# When frozen by PyInstaller, sys._MEIPASS points at the bundled
# resources dir (where --add-data ends up). Otherwise, fall back to the
# script's own directory.
SCRIPT_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))

# When frozen and launched via Launch Services (--windowed .app),
# stdout/stderr are detached. Redirect them to a file so we still get
# logs when the LaunchAgent uses `open -a` to start the .app.
if getattr(sys, "frozen", False):
    try:
        _log = open("/tmp/qlab-buzzer.log", "a", buffering=1)
        sys.stdout = _log
        sys.stderr = _log
    except OSError:
        pass

APPLESCRIPT_TEMPLATES = {
    "start": 'tell application id "{bundle_id}" to tell front workspace to start cue "{cue}"',
    "go": 'tell application id "{bundle_id}" to tell front workspace to go',
    "stop": 'tell application id "{bundle_id}" to tell front workspace to stop cue "{cue}"',
    "panic": 'tell application id "{bundle_id}" to tell front workspace to panic',
}


def load_config():
    config_path = SCRIPT_DIR / "config.json"
    if not config_path.exists():
        print(f"ERROR: Config file not found: {config_path}")
        print("Create a config.json file next to this script.")
        sys.exit(1)

    try:
        config = json.loads(config_path.read_text())
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in config.json: {e}")
        sys.exit(1)

    version = config.get("qlab_version", 5)
    if version not in (4, 5):
        print(f"ERROR: qlab_version must be 4 or 5, got {version}")
        sys.exit(1)

    mappings = config.get("key_mappings", {})
    if not mappings:
        print("WARNING: No key_mappings defined in config.json")

    for key, mapping in mappings.items():
        action = mapping.get("action")
        if action not in ("start", "go", "stop", "panic"):
            print(f"ERROR: Invalid action '{action}' for key '{key}'. Must be start, go, stop, or panic.")
            sys.exit(1)
        if action in ("start", "stop") and "cue" not in mapping:
            print(f"ERROR: Action '{action}' for key '{key}' requires a 'cue' field.")
            sys.exit(1)

    return config


def check_qlab_running(bundle_id):
    try:
        result = subprocess.run(
            ["osascript", "-e", f'tell application id "{bundle_id}" to return name of front workspace'],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            workspace = result.stdout.strip()
            print(f"  QLab connected — workspace: {workspace}")
            return True
        else:
            print(f"  WARNING: QLab not responding. Is it running with a workspace open?")
            print(f"  (Will keep listening — start QLab when ready)")
            return False
    except subprocess.TimeoutExpired:
        print(f"  WARNING: QLab timed out. It may be busy or frozen.")
        return False


def send_to_qlab(bundle_id, action, cue=None):
    template = APPLESCRIPT_TEMPLATES[action]
    script = template.format(bundle_id=bundle_id, cue=cue or "")

    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            error = result.stderr.strip()
            print(f"  QLab error: {error}")
            return False
        return True
    except subprocess.TimeoutExpired:
        print("  QLab timed out — is it frozen?")
        return False


def make_handler(config, bundle_id, osc_client=None):
    mappings = config.get("key_mappings", {})
    debounce_sec = config.get("debounce_ms", 150) / 1000.0
    log_all = config.get("log_all_keys", False)
    last_trigger = {}

    def on_press(key):
        try:
            char = key.char
        except AttributeError:
            char = key.name

        if char is None:
            return

        char = char.lower()

        if log_all:
            print(f"  [key] {char}")

        mapping = mappings.get(char)
        if mapping is None:
            return

        now = time.monotonic()

        # Per-key lockout — uses lockout_ms from the key mapping, falls back to debounce
        lockout_ms = mapping.get("lockout_ms", 0)
        cooldown = lockout_ms / 1000.0 if lockout_ms > 0 else debounce_sec

        if now - last_trigger.get(char, 0) < cooldown:
            if lockout_ms > 0:
                remaining = cooldown - (now - last_trigger.get(char, 0))
                print(f"  [locked out] {char} ignored ({remaining:.1f}s remaining)")
            return
        last_trigger[char] = now

        action = mapping["action"]
        cue = mapping.get("cue")

        if cue:
            print(f"  >> {action} cue {cue}  (key: {char})")
        else:
            print(f"  >> {action}  (key: {char})")

        send_to_qlab(bundle_id, action, cue)

        # Notify chart-toppers server of buzz event
        if osc_client:
            try:
                team = mapping.get("team", "unknown")
                osc_client.send_message("/chart-toppers/buzz", team)
                print(f"  [OSC] Sent /chart-toppers/buzz {team}")
            except Exception as e:
                print(f"  [OSC] Failed to send buzz: {e}")

    return on_press


def start_heartbeat(config):
    """Send periodic heartbeat to Chart Toppers server so dashboard knows buzzer is alive."""
    heartbeat_url = config.get("heartbeat_url", "http://localhost:3200/api/buzzer/heartbeat")
    interval = config.get("heartbeat_interval", 5)

    def heartbeat_loop():
        while True:
            try:
                req = urllib.request.Request(heartbeat_url, method="POST",
                    data=b'{}', headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=3)
            except (urllib.error.URLError, OSError):
                pass  # Server not available yet — keep trying
            time.sleep(interval)

    thread = threading.Thread(target=heartbeat_loop, daemon=True)
    thread.start()


def main():
    config = load_config()
    version = config.get("qlab_version", 5)
    bundle_id = f"com.figure53.QLab.{version}"
    mappings = config.get("key_mappings", {})

    print("QLab Buzzer Bridge")
    print(f"  QLab version: {version}")
    print(f"  Mappings: {len(mappings)} keys configured")
    for key, m in mappings.items():
        cue_info = f" cue {m['cue']}" if "cue" in m else ""
        lockout_info = f" (lockout: {m['lockout_ms']}ms)" if "lockout_ms" in m else ""
        print(f"    [{key}] -> {m['action']}{cue_info}{lockout_info}")
    print(f"  Debounce: {config.get('debounce_ms', 150)}ms")
    print(f"  Log all keys: {config.get('log_all_keys', False)}")
    print()

    check_qlab_running(bundle_id)

    # Start heartbeat to Chart Toppers dashboard
    start_heartbeat(config)
    print(f"  Heartbeat: every {config.get('heartbeat_interval', 5)}s → {config.get('heartbeat_url', 'http://localhost:3200/api/buzzer/heartbeat')}")

    # OSC client for chart-toppers server notifications
    osc_host = config.get("osc_host", "127.0.0.1")
    osc_port = config.get("osc_port", 53536)
    osc_client = None
    try:
        osc_client = udp_client.SimpleUDPClient(osc_host, osc_port)
        print(f"  OSC client: {osc_host}:{osc_port}")
    except Exception as e:
        print(f"  WARNING: OSC client failed to init: {e}")
        print("  (Buzzer will still work, but chart-toppers won't receive buzz events)")

    print("\nListening for keypresses... (Ctrl+C to quit)\n")

    def shutdown(signum, frame):
        print("\nShutting down...")
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)

    try:
        with keyboard.Listener(on_press=make_handler(config, bundle_id, osc_client)) as listener:
            listener.join()
    except KeyboardInterrupt:
        print("\nShutting down...")


if __name__ == "__main__":
    main()
