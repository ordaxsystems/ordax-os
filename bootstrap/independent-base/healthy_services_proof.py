#!/usr/bin/env python3
"""Execute the EXISTING signed portable cold-health QEMU authority unchanged.

No mock Surface, no second supervisor, no special product mode. A failure of
real Cage/Wayland/WebKit health remains a failing experimental diagnostic.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OFFICIAL = ROOT / "bootstrap/portable-v2/qemu_cold_health_commit.py"

def option(argv: list[str], name: str) -> str:
    if argv.count(name) != 1 or argv.index(name) + 1 >= len(argv):
        raise ValueError(f"exactly one {name} value required")
    return argv[argv.index(name) + 1]

def prove(argv: list[str]) -> dict:
    if not OFFICIAL.is_file() or OFFICIAL.is_symlink():
        raise ValueError("canonical signed cold-health runner missing or unsafe")
    current = option(argv, "--source-commit")
    previous = option(argv, "--previous-commit")
    if not re.fullmatch("[0-9a-f]{40}", current) or not re.fullmatch("[0-9a-f]{40}", previous) or current == previous:
        raise ValueError("invalid signed candidate / previous source identities")
    output = Path(option(argv, "--out"))
    if output.is_symlink() or output.exists():
        raise ValueError("cold-health proof destination must not preexist")
    run = subprocess.run([sys.executable, str(OFFICIAL), *argv], check=False)
    if run.returncode:
        # Official owner itself writes failure receipt + original serial logs.
        raise ValueError(f"canonical real Surface cold-health proof failed rc={run.returncode}")
    result = json.loads(output.read_text(encoding="utf-8"))
    if (result.get("status") != "pass" or
        result.get("source_commit") != current or
        result.get("previous_commit") != previous or
        result.get("cold_health_commit_proven") is not True or
        result.get("candidate_boot_count") != 1 or
        result.get("committed_current_boot_count") != 1 or
        result.get("virtual_graphics", {}).get("synthetic_health") is not False or
        result.get("guest_disk", {}).get("retained") is not False or
        result.get("physical_target_device_touched") is not False or
        result.get("physical_write_authorized") is not False or
        result.get("physical_usb_boot_proven") is not False or
        result.get("secure_boot_proven") is not False or
        result.get("public_physical_promotion_allowed") is not False or
        not result.get("checks") or not all(result["checks"].values())):
        raise ValueError("canonical cold-health QEMU receipt is incomplete or claims physical evidence")
    return result

def main() -> int:
    try:
        proof = prove(sys.argv[1:])
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"ordax-independent-real-services: ERROR: {exc}", file=sys.stderr)
        return 1
    print("ORDAX_INDEPENDENT_SIGNED_GUARDIAN_SUPERVISOR_SURFACE=PASS")
    print(json.dumps({"source_commit": proof["source_commit"],
                      "cold_health_commit_proven": True, "physical_promotion_authorized": False},
                     sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
