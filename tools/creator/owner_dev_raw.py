#!/usr/bin/env python3
"""Run the existing disposable Owner/Dev RAW proof outside GitHub Actions."""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", required=True, type=Path)
    parser.add_argument("--stage-root", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    args = parser.parse_args()
    return subprocess.call([
        sys.executable, str(ROOT / "tools/creator/proof/disposable_media.py"),
        "--contract", str(args.contract),
        "--stage-root", str(args.stage_root),
        "--output-root", str(args.output_root),
    ], cwd=ROOT)


if __name__ == "__main__":
    sys.exit(main())
