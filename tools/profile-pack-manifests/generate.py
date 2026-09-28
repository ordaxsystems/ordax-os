#!/usr/bin/env python3
"""Generate the browser-safe local Profile manifest module from canonical JSON manifests."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST_ROOT = ROOT / "system" / "profile-packs"
TARGET = MANIFEST_ROOT / "manifests.generated.mjs"
SCHEMA = "ordax.profile-pack/1"


def load_manifests() -> list[dict]:
    manifests: list[dict] = []
    identities: set[tuple[str, int]] = set()
    for path in sorted(MANIFEST_ROOT.glob("*/manifest.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or payload.get("$schema") != SCHEMA:
            raise SystemExit(f"{path}: incompatible Profile manifest schema")
        slug = payload.get("slug")
        version = payload.get("version")
        if not isinstance(slug, str) or not slug or path.parent.name != slug:
            raise SystemExit(f"{path}: manifest slug must match its directory")
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise SystemExit(f"{path}: invalid Profile manifest version")
        identity = (slug, version)
        if identity in identities:
            raise SystemExit(f"{path}: duplicate Profile manifest {slug}@{version}")
        identities.add(identity)
        manifests.append(payload)
    manifests.sort(key=lambda item: (item["slug"], item["version"]))
    if not manifests:
        raise SystemExit("no Profile manifests found")
    return manifests


def render() -> str:
    encoded = json.dumps(
        load_manifests(),
        ensure_ascii=False,
        indent=2,
        separators=(",", ": "),
    )
    return (
        "// GENERATED FILE. Source of truth: system/profile-packs/*/manifest.json\n"
        "// Regenerate with: python tools/profile-pack-manifests/generate.py build\n\n"
        f"export const LOCAL_PROFILE_PACK_MANIFESTS = Object.freeze({encoded}.map("
        "(entry) => Object.freeze(entry)));\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("build", "check"))
    args = parser.parse_args()
    expected = render()

    if args.mode == "check":
        if not TARGET.is_file():
            raise SystemExit(f"missing generated Profile manifest module: {TARGET}")
        actual = TARGET.read_text(encoding="utf-8")
        if actual != expected:
            raise SystemExit(
                "generated Profile manifest module is stale; run "
                "python tools/profile-pack-manifests/generate.py build"
            )
        print("PROFILE_PACK_MANIFESTS_GENERATED=PASS")
        return 0

    TARGET.write_text(expected, encoding="utf-8")
    print(TARGET)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
