#!/usr/bin/env python3
"""Generate Native metadata-query allowlist from the canonical component policy.

This grants only the ability to ASK the signed helper for verified current/pending
state; it never authorizes runtime module reads, health writes, install or launch.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "docs/contracts/runtime-component-package.json"
OUTPUT = ROOT / "system/surface/runtime/native_store_metadata_policy.py"
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
SOURCE_OWNER = "ordaxsystems/ordax-apps"


class MetadataPolicyError(ValueError):
    pass


def render(payload: dict) -> str:
    if not isinstance(payload, dict) or payload.get("$schema") != "prototype-ordax.runtime-component-package-policy/1":
        raise MetadataPolicyError("canonical runtime component policy is invalid")
    package_sources = payload.get("canonical_package_source_repository_by_component")
    native_ids = payload.get("native_loopback_broker_supported_components")
    if not isinstance(package_sources, dict) or not package_sources:
        raise MetadataPolicyError("canonical package owners are unavailable")
    if not isinstance(native_ids, list) or not native_ids or len(native_ids) != len(set(native_ids)):
        raise MetadataPolicyError("existing Native component broker source is invalid")
    for component_id, owner in package_sources.items():
        if not isinstance(component_id, str) or not APP_ID_RE.fullmatch(component_id) or owner != SOURCE_OWNER:
            raise MetadataPolicyError("invalid canonical external component package source")
    for component_id in native_ids:
        if not isinstance(component_id, str) or not APP_ID_RE.fullmatch(component_id):
            raise MetadataPolicyError("invalid Native component id")
    members = sorted(set(package_sources) | set(native_ids))
    rendered = "\n".join(f'    "{app_id}",' for app_id in members)
    return (
        "# GENERATED FILE. DO NOT EDIT BY HAND.\n"
        "# Source of truth: docs/contracts/runtime-component-package.json\n"
        "# Generator: tools/app-policy/render_native_store_metadata_policy.py\n"
        "# This is METADATA QUERY scope only, not module-read or health authority.\n\n"
        "STORE_METADATA_COMPONENT_IDS = frozenset({\n"
        + rendered + "\n})\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, default=POLICY)
    parser.add_argument("--out", type=Path, default=OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        payload = json.loads(args.policy.read_text(encoding="utf-8"))
        rendered = render(payload)
        if args.check:
            if args.out.read_text(encoding="utf-8") != rendered:
                raise MetadataPolicyError("generated Native Store metadata allowlist drifted from canonical policy")
        else:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(rendered, encoding="utf-8", newline="\n")
    except (OSError, UnicodeError, json.JSONDecodeError, MetadataPolicyError) as exc:
        print("ORDAX_NATIVE_STORE_METADATA_SSOT=FAIL\n" + str(exc), file=sys.stderr)
        return 1
    print("ORDAX_NATIVE_STORE_METADATA_SSOT=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
