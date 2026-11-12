#!/usr/bin/env python3
"""Resolve the active hosted Auth probe target from repository-owned contracts.

This is an operator/CI probe of the *current* Auth authority, not authorization
to promote the destination or to enable public registration. It emits only two
validated GitHub Actions environment assignments (no credentials or proofs).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from probe_auth_provider import clean_origin

ROOT = Path(__file__).resolve().parents[2]
HARDENING = Path("docs/contracts/public-auth-hardening.json")
POLICY = Path("docs/contracts/public-auth-provider-policy.json")
DESTINATION_PLAN = Path("infra/supabase/product/account_destination_migration_plan.json")
REF_RE = re.compile(r"[a-z0-9]{20}\Z")


def read_object(root: Path, relative: Path) -> dict:
    value = json.loads((root / relative).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{relative}: object required")
    return value


def project_ref(value: object, label: str) -> str:
    if not isinstance(value, str) or REF_RE.fullmatch(value) is None:
        raise ValueError(f"{label}: invalid project reference")
    return value


def resolve_target(root: Path, requested_origin: str, *, scope: str = "active") -> tuple[str, str]:
    hardening = read_object(root, HARDENING)
    policy = read_object(root, POLICY)
    plan = read_object(root, DESTINATION_PLAN)

    if scope not in ("active", "destination"):
        raise ValueError("unsupported provider probe scope")
    origin = clean_origin(requested_origin)
    redirect_policy = policy.get("redirect_policy")
    if not isinstance(redirect_policy, dict):
        raise ValueError("provider redirect policy missing")
    configured_origin = redirect_policy.get("origin")
    if not isinstance(configured_origin, str) or clean_origin(configured_origin) != configured_origin:
        raise ValueError("canonical provider origin invalid")
    if origin != configured_origin:
        raise ValueError("requested origin does not match canonical provider origin")

    target = hardening.get("target")
    destination = hardening.get("postgresql_destination")
    if not isinstance(target, dict) or target.get("provider") != "supabase":
        raise ValueError("active Supabase Auth owner missing")
    if not isinstance(destination, dict):
        raise ValueError("destination contract missing")
    active_ref = project_ref(target.get("project_ref"), "active target")
    destination_ref = project_ref(destination.get("project_ref"), "destination")
    planned_ref = project_ref(plan.get("destination_project_ref"), "migration plan")
    if plan.get("destination_project_name") != "ordax-platform" or planned_ref != destination_ref:
        raise ValueError("destination project conflicts with migration SSOT")

    promoted = destination.get("functional_provider_cutover_complete")
    if type(promoted) is not bool:
        raise ValueError("provider cutover status must be a boolean")
    if promoted and active_ref != destination_ref:
        raise ValueError("provider cutover marked complete without target switch")
    if not promoted and active_ref == destination_ref:
        raise ValueError("destination target selected before verified cutover")
    if scope == "destination":
        # Read-only provider configuration proof for the prepared destination.
        # This does NOT make the destination the active Auth owner.
        if promoted:
            raise ValueError("destination probe scope unavailable after verified cutover")
        if (destination.get("public_registration_enabled") is not False
                or destination.get("public_login_enabled") is not False
                or destination.get("parallel_identity_write_enabled") is not False):
            raise ValueError("destination probe requires public Auth to remain disabled")
        return destination_ref, origin
    return active_ref, origin


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    parser.add_argument("--scope", choices=("active", "destination"), default="active")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        project, origin = resolve_target(args.root, args.origin, scope=args.scope)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"AUTH_PROVIDER_TARGET=BLOCKED reason={exc}", file=sys.stderr)
        return 1
    print(f"SUPABASE_PROJECT_REF={project}")
    print(f"ORDAX_PUBLIC_ORIGIN={origin}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
