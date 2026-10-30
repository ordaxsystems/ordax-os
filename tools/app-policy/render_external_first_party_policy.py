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


def load_policy(path: Path) -> tuple[dict[str, str], tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
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

    # The unsigned-candidate verifier has its own narrower source allowlist.
    # Keep it consistent with ownership, without treating it as the registry
    # of every app source or as a Native permission grant.
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
    # Files can be read only through the exact verified slot's device-local
    # File Space capability. Native revalidates the immutable slot identity
    # before each operation; pending probation sees only an empty synthetic
    # root and cannot access or mutate user data.
    scoped_files = value.get("native_files_slot_bound_file_space_enforced")
    if type(scoped_files) is not bool:
        raise PolicyGenerationError("Files Native scoped file-space proof must be boolean")
    if ("files" in normalized or "files" in native_ids) and not scoped_files:
        raise PolicyGenerationError(
            "Files source transfer or module-read requires Native slot-bound "
            "device-local File Space enforcement"
        )
    # These IDs are a necessary (not sufficient) runtime module-read gate.
    # Presence in Store policy or the signed catalog must never invent it.
    module_ready = tuple(sorted(set(normalized).intersection(native_ids)))
    bundled_owner_blocked = value.get("native_external_current_slot_blocked_by_bundled_owner_components")
    if (
        not isinstance(bundled_owner_blocked, list)
        or any(not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id) for app_id in bundled_owner_blocked)
        or len(bundled_owner_blocked) != len(set(bundled_owner_blocked))
        or not set(bundled_owner_blocked).issubset(module_ready)
    ):
        raise PolicyGenerationError("bundled-owner current-slot exclusion is invalid or exceeds module-read scope")
    health_ids = value.get("native_loopback_broker_health_mutation_components")
    probation_ids = value.get("runtime_health_bridge_supported_components")
    for label, ids in (("Native health", health_ids), ("probation", probation_ids)):
        if (
            not isinstance(ids, list)
            or any(not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id) for app_id in ids)
            or len(ids) != len(set(ids))
        ):
            raise PolicyGenerationError(f"{label} scope in canonical policy is invalid")
    if not set(health_ids).issubset(native_ids) or not set(probation_ids).issubset(health_ids):
        raise PolicyGenerationError("probation/health scope exceeds Native module-read scope")
    probation_ready = tuple(sorted(set(module_ready).intersection(health_ids, probation_ids)))
    return normalized, module_ready, probation_ready, tuple(sorted(bundled_owner_blocked))


def render_module(
    sources: dict[str, str], module_ready: tuple[str, ...], probation_ready: tuple[str, ...],
    bundled_owner_blocked: tuple[str, ...],
) -> str:
    mapping_lines = "\n".join(
        f'  "{app_id}": "{repository}",' for app_id, repository in sources.items()
    )
    ready_lines = "\n".join(f'  "{app_id}",' for app_id in module_ready)
    probation_lines = "\n".join(f'  "{app_id}",' for app_id in probation_ready)
    bundled_owner_lines = "\n".join(f'  "{app_id}",' for app_id in bundled_owner_blocked)
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
export const EXTERNAL_FIRST_PARTY_NATIVE_PROBATION_IDS = Object.freeze([
{probation_lines}
]);
export const EXTERNAL_FIRST_PARTY_BUNDLED_SOURCE_BLOCKED_IDS = Object.freeze([
{bundled_owner_lines}
]);

const IDS = new Set(EXTERNAL_FIRST_PARTY_COMPONENT_IDS);
const MODULE_READ_IDS = new Set(EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS);
const PROBATION_IDS = new Set(EXTERNAL_FIRST_PARTY_NATIVE_PROBATION_IDS);
const BUNDLED_SOURCE_BLOCKED_IDS = new Set(EXTERNAL_FIRST_PARTY_BUNDLED_SOURCE_BLOCKED_IDS);
if (PROBATION_IDS.size !== EXTERNAL_FIRST_PARTY_NATIVE_PROBATION_IDS.length
  || [...PROBATION_IDS].some((appId) => !MODULE_READ_IDS.has(appId))) {{
  throw new TypeError("External first-party probation ids disagree with canonical Native read scope");
}}
if (MODULE_READ_IDS.size !== EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS.length
  || [...MODULE_READ_IDS].some((appId) => !IDS.has(appId))) {{
  throw new TypeError("External first-party module-read ids disagree with canonical owners");
}}
if (BUNDLED_SOURCE_BLOCKED_IDS.size !== EXTERNAL_FIRST_PARTY_BUNDLED_SOURCE_BLOCKED_IDS.length
  || [...BUNDLED_SOURCE_BLOCKED_IDS].some((appId) => !MODULE_READ_IDS.has(appId))) {{
  throw new TypeError("External first-party bundled-source exclusions exceed canonical Native read scope");
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

// Required, never sufficient for production activation.
export function hasNativeExternalFirstPartyProbation(value) {{
  try {{
    return PROBATION_IDS.has(validateComponentId(value));
  }} catch {{
    return false;
  }}
}}

// A component may have an Apps owner while its live UI source is still
// bundled in the OS. Do not discover a competing current slot before Gate A.
export function isNativeExternalFirstPartyCurrentSlotBlockedByBundledOwner(value) {{
  try {{
    return BUNDLED_SOURCE_BLOCKED_IDS.has(validateComponentId(value));
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
        sources, module_ready, probation_ready, bundled_owner_blocked = load_policy(args.policy)
        rendered = render_module(sources, module_ready, probation_ready, bundled_owner_blocked)
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
