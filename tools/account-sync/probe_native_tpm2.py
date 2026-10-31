#!/usr/bin/env python3
"""Inspect TPM2 availability without touching the TPM or reading account secrets.

A detected TPM2 is NOT proof that PIN-backed reboot persistence is secure.
No key creation, enrollment, unsealing or filesystem mutation occurs here.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "system/surface/runtime"))
from native_account_vault import tpm2_pin_preflight


def main() -> int:
    print(json.dumps(tpm2_pin_preflight(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
