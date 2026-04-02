#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Machine ID Generator (Simple)
------------------------------
Generates a unique, persistent machine ID based on the HOST machine's
hardware UUID. This ensures the same physical machine always produces the
same machine ID, even after a full reinstall (new clone, new Docker volume).

Priority order:
  1. HOST_HARDWARE_ID env var (stable hardware UUID from host, set via .env)
  2. Persisted /app/data/machine_id (survives container restarts)
  3. Fallback to container MAC address (legacy, changes on reinstall)

Usage:
    python3 machine_id_simple.py
    # Prints the machine ID to stdout
"""

import hashlib
import os
import platform
import uuid


MACHINE_ID_FILE = "/app/data/machine_id"


def get_or_create_machine_id():
    """Get existing machine ID or create a new one.

    Once a machine ID is persisted it is NEVER overwritten — this ensures
    license keys remain valid across rebuilds, updates, and env changes.
    """
    # Priority 1: Already persisted — always honour it (license was issued against it)
    if os.path.exists(MACHINE_ID_FILE):
        with open(MACHINE_ID_FILE, "r") as f:
            stored_id = f.read().strip()
            if stored_id:
                return stored_id

    # Priority 2: Generate from host hardware UUID (stable across reinstalls)
    host_hw_id = os.environ.get("HOST_HARDWARE_ID", "").strip()
    if host_hw_id:
        raw = f"chart-toppers-{host_hw_id}"
        machine_id = hashlib.sha256(raw.encode()).hexdigest()
    else:
        # Priority 3: Fallback to container MAC (legacy — changes on reinstall)
        try:
            mac = uuid.getnode()
            mac_str = ':'.join(f'{(mac >> i) & 0xff:02x}' for i in range(0, 48, 8))
        except Exception:
            mac_str = "unknown"
        raw = f"chart-toppers-{platform.system()}-{mac_str}"
        machine_id = hashlib.sha256(raw.encode()).hexdigest()

    # Persist the machine ID
    try:
        os.makedirs(os.path.dirname(MACHINE_ID_FILE), exist_ok=True)
        with open(MACHINE_ID_FILE, "w") as f:
            f.write(machine_id)
    except Exception:
        pass

    return machine_id


if __name__ == "__main__":
    print(get_or_create_machine_id())
