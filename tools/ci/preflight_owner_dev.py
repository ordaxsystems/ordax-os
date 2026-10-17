#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OWNER_PATHS = (
    "bootstrap/dev/entrypoint",
    "bootstrap/dev-base/ordax-dev-init",
    "bootstrap/dev-base/ordax-network",
    "bootstrap/dev-base/ordax-pull",
    "bootstrap/dev-base/ordax-rollback",
    "bootstrap/dev-base/ordax-run",
    "bootstrap/dev-base/ordax-diagnose",
    "bootstrap/dev-base/ordax-main-watch",
    "bootstrap/recovery/entrypoint",
    "system/entrypoint",
    "system/supervisor",
)
FORBIDDEN_OWNER_TOKENS = (
    "apk add",
    "apk update",
    "alpine_core",
    "dl-cdn.alpinelinux.org",
)
TESTS = (
    "tests/test_owner_rootfs_capabilities.py",
    "tests/test_dev_git_flow.py",
    "tests/test_dev_network_contract.py",
    "tests/test_owner_surface_health_budget.py",
    "tests/test_system_runtime_contract.py",
)


def run(cmd: list[str]) -> dict[str, object]:
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return {
        "command": cmd,
        "returncode": proc.returncode,
        "output": proc.stdout[-12000:],
    }


def check_owner_isolation() -> dict[str, object]:
    violations: list[dict[str, object]] = []
    missing: list[str] = []
    for rel in OWNER_PATHS:
        path = ROOT / rel
        if not path.is_file() or path.is_symlink():
            missing.append(rel)
            continue
        text = path.read_text(encoding="utf-8")
        for token in FORBIDDEN_OWNER_TOKENS:
            if token in text:
                violations.append({"path": rel, "token": token})
    return {
        "missing": missing,
        "violations": violations,
        "ok": not missing and not violations,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Single fast preflight for Owner Development USB changes."
    )
    parser.add_argument("--skip-tests", action="store_true")
    args = parser.parse_args()

    checks: dict[str, object] = {}
    isolation = check_owner_isolation()
    checks["owner_isolation"] = isolation
    capability = run(
        [
            sys.executable,
            "tools/ci/owner_rootfs_capabilities.py",
            "inventory",
        ]
    )
    checks["rootfs_capabilities"] = capability

    if args.skip_tests:
        tests = {"skipped": True, "returncode": 0, "output": ""}
    else:
        modules = [Path(test).with_suffix("").as_posix().replace("/", ".") for test in TESTS]
        tests = run([sys.executable, "-m", "unittest", "-v", *modules])
    checks["focused_tests"] = tests

    ok = (
        bool(isolation["ok"])
        and capability["returncode"] == 0
        and tests["returncode"] == 0
    )
    result = {
        "$schema": "prototype-ordax.owner-dev-preflight/1",
        "status": "pass" if ok else "fail",
        "checks": checks,
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
