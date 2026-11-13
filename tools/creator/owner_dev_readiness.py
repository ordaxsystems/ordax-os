#!/usr/bin/env python3
"""Read-only local readiness audit for direct Owner/Dev image composition."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def audit(root: Path) -> dict:
    kernel = json.loads((root / "bootstrap/kernel/source.json").read_text(encoding="utf-8"))
    version = kernel["version"]
    checks = {
        "kernel": root / "out/kernel" / ("vmlinuz-" + version),
        "initramfs": root / "out/initramfs/initramfs.cpio.gz",
        "dev_rootfs": root / "out/dev-base/rootfs",
        "owner_manifest_recipe": root / "tools/creator/owner_dev_manifest.py",
        "owner_stage_recipe": root / "tools/creator/owner_dev_stage.sh",
        "raw_recipe": root / "tools/creator/owner_dev_raw.py",
    }
    results = {}
    for key, path in checks.items():
        present = path.is_dir() if key == "dev_rootfs" else path.is_file()
        results[key] = {"path": str(path), "present": present}
    return {"status": "inputs-present" if all(x["present"] for x in results.values()) else "incomplete",
            "checks": results, "note": "Presence only; verify provenance, Surface and Creator separately. No build or disk write."}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    result = audit(args.root.resolve())
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["status"] == "inputs-present" else 1


if __name__ == "__main__":
    raise SystemExit(main())
