#!/usr/bin/env python3
"""Generate the Surface app-package candidate list from the canonical runtime package policy."""

from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

SCHEMA="prototype-ordax.runtime-component-package-policy/1"
REPOSITORY="washingtonmsdj/ordax-apps"
ID_RE=re.compile(r"^[a-z][a-z0-9-]{0,63}$")

def render(policy: Path) -> str:
    value=json.loads(policy.read_text(encoding="utf-8"))
    if value.get("$schema") != SCHEMA:
        raise ValueError("runtime component package policy schema is invalid")
    sources=value.get("canonical_package_source_repository_by_component")
    if not isinstance(sources,dict) or not sources:
        raise ValueError("canonical package sources are missing")
    ids=[]
    for component_id, repository in sorted(sources.items()):
        if not isinstance(component_id,str) or ID_RE.fullmatch(component_id) is None:
            raise ValueError(f"invalid component id: {component_id!r}")
        if repository != REPOSITORY:
            raise ValueError(f"unexpected source repository for {component_id}")
        ids.append(component_id)
    lines=[
        "// GENERATED FILE. DO NOT EDIT BY HAND.",
        "// Source of truth: docs/contracts/runtime-component-package.json",
        "// Generator: tools/app-policy/render_runtime_package_app_policy.py",
        "",
        f'export const CANONICAL_APP_PACKAGE_SOURCE_REPOSITORY = "{REPOSITORY}";',
        "export const CANONICAL_APP_PACKAGE_COMPONENT_IDS = Object.freeze([",
    ]
    lines.extend(f'  "{component_id}",' for component_id in ids)
    lines.extend(["]);",""])
    return "\n".join(lines)

def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument("--policy",type=Path,default=Path("docs/contracts/runtime-component-package.json"))
    parser.add_argument("--out",type=Path,default=Path("system/services/apps/package-source-policy.mjs"))
    parser.add_argument("--check",action="store_true")
    args=parser.parse_args(argv)
    try:
        expected=render(args.policy)
        if args.check:
            current=args.out.read_text(encoding="utf-8")
            if current != expected:
                raise ValueError("generated Surface app package policy drifted from JSON SSOT")
            print("ORDAX_SURFACE_APP_PACKAGE_POLICY_SSOT=PASS")
            return 0
        args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(expected,encoding="utf-8",newline="\n")
        return 0
    except (OSError,UnicodeError,json.JSONDecodeError,ValueError) as exc:
        print(f"ORDAX_SURFACE_APP_PACKAGE_POLICY_SSOT=FAIL\n{exc}",file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
