#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
License Validator (Simple)
---------------------------
Validates a cryptographically signed license key against:
  - RSA signature (public key)
  - Machine ID binding
  - Expiry date

Usage:
    python3 license_validator_simple.py <machine_id>
    # Reads LICENSE_KEY from environment variable
    # Prints JSON result to stdout
"""

import json
import base64
import os
import sys
from datetime import datetime
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.exceptions import InvalidSignature


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_KEY_PATH = os.path.join(SCRIPT_DIR, "license_public_key.pem")


def load_public_key():
    """Load the RSA public key used for verification."""
    try:
        with open(PUBLIC_KEY_PATH, "rb") as f:
            return load_pem_public_key(f.read())
    except FileNotFoundError:
        return None
    except Exception:
        return None


def validate_license(license_key, machine_id):
    """
    Validate a license key and return a JSON-serialisable dict.

    Returns:
        dict with keys: valid, error, licensee, features, expiration, machine_id
    """
    result = {
        "valid": False,
        "error": None,
        "licensee": None,
        "features": [],
        "expiration": None,
        "machine_id": machine_id,
    }

    # --- no key supplied ---
    if not license_key:
        result["error"] = "No license key provided"
        return result

    # --- load public key ---
    public_key = load_public_key()
    if public_key is None:
        result["error"] = "Public key not found"
        return result

    # --- decode the base64 license ---
    try:
        license_json = base64.b64decode(license_key)
        license_data = json.loads(license_json)
    except Exception:
        result["error"] = "Invalid license key format"
        return result

    # --- extract signature ---
    signature_b64 = license_data.pop("signature", None)
    if not signature_b64:
        result["error"] = "License missing signature"
        return result

    # --- verify RSA signature ---
    try:
        signature = base64.b64decode(signature_b64)
        canonical = json.dumps(license_data, sort_keys=True, separators=(',', ':')).encode()
        public_key.verify(signature, canonical, padding.PKCS1v15(), hashes.SHA256())
    except InvalidSignature:
        result["error"] = "Invalid license signature"
        return result
    except Exception as e:
        result["error"] = f"Signature verification error: {e}"
        return result

    # --- check machine ID ---
    if license_data.get("machine_id") != machine_id:
        result["error"] = "License not valid for this machine"
        return result

    # --- check expiry ---
    expires = license_data.get("expires")
    if expires:
        try:
            expiry_dt = datetime.fromisoformat(expires)
            if datetime.now() > expiry_dt:
                result["error"] = f"License expired on {expires}"
                result["expiration"] = expires
                return result
        except Exception:
            result["error"] = "Invalid expiry date in license"
            return result

    # --- all checks passed ---
    result["valid"] = True
    result["features"] = license_data.get("features", [])
    result["expiration"] = expires
    result["licensee"] = license_data.get("licensee")
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"valid": False, "error": "Usage: license_validator_simple.py <machine_id>"}))
        sys.exit(1)

    mid = sys.argv[1]
    lk = os.environ.get("LICENSE_KEY", "")
    output = validate_license(lk, mid)
    print(json.dumps(output))
    sys.exit(0 if output["valid"] else 1)
