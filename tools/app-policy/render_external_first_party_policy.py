#!/usr/bin/env python3
"""Generate the runtime external first-party policy from its canonical JSON SSOT."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

POLICY_SCHEMA = "prototype-ordax.runtime-component-package-policy/1"
CANONICAL_OWNER = "ordaxsystems/ordax-apps"
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


class PolicyGenerationError(RuntimeError):
    pass


def load_policy(path: Path) -> tuple[dict[str, str], tuple[str, ...]]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PolicyGenerationError(f"cannot read canonical component policy: {path}") from exc
    if not isinstance(value, dict) or value.get("$schema") != POLICY_SCHEMA:
        raise PolicyGenerationError("canonical component policy schema is invalid")
    # The canonical package-source mapping already names every owner-approved
    # first-party component delivered by ordax-apps. Do not maintain a second
    # curated list of component IDs in the generated runtime policy.
    sources = value.get("canonical_package_source_repository_by_component")
    if not isinstance(sources, dict) or not sources:
        raise PolicyGenerationError("canonical package source repository mapping is missing")
    normalized: dict[str, str] = {}
    for app_id, repository in sorted(sources.items()):
        if not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id):
            raise PolicyGenerationError(f"invalid external first-party app id: {app_id!r}")
        if not isinstance(repository, str) or not REPOSITORY_RE.fullmatch(repository):
            raise PolicyGenerationError(f"invalid external first-party repository for {app_id}")
        if repository != CANONICAL_OWNER:
            raise PolicyGenerationError(
                f"external first-party app {app_id} must be owned by {CANONICAL_OWNER}"
            )
        normalized[app_id] = repository

    # Retain the narrower historical external-source declaration only as a
    # consistency assertion. It is not a second candidate-discovery source.
    historical = value.get("canonical_external_source_repository_by_component")
    if not isinstance(historical, dict):
        raise PolicyGenerationError("legacy external source declaration is invalid")
    for app_id, repository in historical.items():
        if normalized.get(app_id) != repository:
            raise PolicyGenerationError(
                f"external source declaration disagrees with canonical package owner: {app_id}"
            )
    native_ids = value.get("native_loopback_broker_supported_components")
    if (
        not isinstance(native_ids, list)
        or not native_ids
        or any(not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id) for app_id in native_ids)
        or len(native_ids) != len(set(native_ids))
    ):
        raise PolicyGenerationError("Native module-read scope in canonical policy is invalid")
    # These IDs are a necessary (not sufficient) runtime module-read gate.
    # Presence in Store policy or the signed catalog must never invent it.
    module_ready = tuple(sorted(set(normalized).intersection(native_ids)))
    return normalized, module_ready


def render_module(sources: dict[str, str], module_ready: tuple[str, ...]) -> str:
    mapping_lines = "\n".join(
        f'  "{app_id}": "{repository}",' for app_id, repository in sources.items()
    )
    ready_lines = "\n".join(f'  "{app_id}",' for app_id in module_ready)
    return f'''// GENERATED FILE. DO NOT EDIT BY HAND.
// Source of truth: docs/contracts/runtime-component-package.json
// Generator: tools/app-policy/render_external_first_party_policy.py

import {{ validateComponentId }} from "../../contracts/component-manifest.mjs";

export const EXTERNAL_FIRST_PARTY_OWNER = "{CANONICAL_OWNER}";
export const EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT = Object.freeze({{
{mapping_lines}
}});
export const EXTERNAL_FIRST_PARTY_COMPONENT_IDS = Object.freeze(
  Object.keys(EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT),
);

// Generated from the same canonical OS package policy's Native module broker
// scope. Store catalog presence alone does not grant executable-read support.
export const EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS = Object.freeze([
{ready_lines}
]);

const IDS = new Set(EXTERNAL_FIRST_PARTY_COMPONENT_IDS);
const MODULE_READ_IDS = new Set(EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS);
if (MODULE_READ_IDS.size !== EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS.length
  || [...MODULE_READ_IDS].some((appId) => !IDS.has(appId))) {{
  throw new TypeError("External first-party module-read ids disagree with canonical owners");
}}
if (IDS.size !== EXTERNAL_FIRST_PARTY_COMPONENT_IDS.length) {{
  throw new TypeError("External first-party component ids must be unique");
}}
for (const appId of EXTERNAL_FIRST_PARTY_COMPONENT_IDS) {{
  validateComponentId(appId);
  if (EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT[appId] !== EXTERNAL_FIRST_PARTY_OWNER) {{
    throw new TypeError(`External first-party source repository drifted: ${{appId}}`);
  }}
}}

export function listExternalFirstPartyComponentIds() {{
  return EXTERNAL_FIRST_PARTY_COMPONENT_IDS;
}}

export function isExternalFirstPartyComponentId(value) {{
  try {{
    return IDS.has(validateComponentId(value));
  }} catch {{
    return false;
  }}
}}

// A necessary, not sufficient, gate for Store install/update delegation.
// Native trust, health, promotion and rollback gates remain independent.
export function hasNativeExternalFirstPartyModuleRead(value) {{
  try {{
    return MODULE_READ_IDS.has(validateComponentId(value));
  }} catch {{
    return false;
  }}
}}
'''


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--policy",
        type=Path,
        default=Path("docs/contracts/runtime-component-package.json"),
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("system/services/apps/external-first-party-policy.mjs"),
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        sources, module_ready = load_policy(args.policy)
        rendered = render_module(sources, module_ready)
        if args.check:
            try:
                current = args.out.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                raise PolicyGenerationError(f"generated policy is unavailable: {args.out}") from exc
            if current != rendered:
                raise PolicyGenerationError(
                    "generated external first-party policy drifted from canonical JSON SSOT"
                )
            print("ORDAX_EXTERNAL_FIRST_PARTY_POLICY_SSOT=PASS")
            return 0
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered, encoding="utf-8", newline="\n")
        print(f"wrote {args.out}")
        return 0
    except PolicyGenerationError as exc:
        print(f"ORDAX_EXTERNAL_FIRST_PARTY_POLICY_SSOT=FAIL\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
