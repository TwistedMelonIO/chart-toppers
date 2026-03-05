#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Machine ID Generator (Simple)
------------------------------
Generates a unique, persistent machine ID for this Docker container.
The ID is based on the container's MAC address and stored in a Docker volume
so it survives container restarts.

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
    """Get existing machine ID or create a new one."""
    # Check for persisted machine ID first
    if os.path.exists(MACHINE_ID_FILE):
        with open(MACHINE_ID_FILE, "r") as f:
            stored_id = f.read().strip()
            if stored_id:
                return stored_id

    # Generate new machine ID
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
    except Exception as e:
        # Silently ignore persistence errors - don't output to stdout
        pass

    return machine_id


if __name__ == "__main__":
    print(get_or_create_machine_id())
