#!/usr/bin/env python3
"""Resolve the reviewed Supabase destination for the OrdaX account gateway.

This resolver is deliberately different from the public Auth target resolver: the
account gateway destination can be prepared before public Auth cutover, but it must
never change the public provider/cutover flags by implication.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HARDENING = Path("docs/contracts/public-auth-hardening.json")
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


def resolve_destination(root: Path) -> tuple[str, str]:
    hardening = read_object(root, HARDENING)
    plan = read_object(root, DESTINATION_PLAN)
    destination = hardening.get("postgresql_destination")
    if not isinstance(destination, dict):
        raise ValueError("destination contract missing")

    contract_name = destination.get("project_name")
    contract_ref = project_ref(destination.get("project_ref"), "destination contract")
    planned_name = plan.get("destination_project_name")
    planned_ref = project_ref(plan.get("destination_project_ref"), "destination plan")
    if contract_name != "ordax-platform" or planned_name != contract_name:
        raise ValueError("destination project name conflicts with account migration SSOT")
    if planned_ref != contract_ref:
        raise ValueError("destination project ref conflicts with account migration SSOT")

    if destination.get("functional_provider_cutover_complete") is not False:
        raise ValueError("destination gateway deploy must not imply completed public Auth cutover")
    if destination.get("public_registration_enabled") is not False:
        raise ValueError("destination gateway deploy requires public registration to remain disabled")
    return contract_ref, contract_name


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        ref, name = resolve_destination(args.root)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"ACCOUNT_GATEWAY_DESTINATION=BLOCKED reason={exc}", file=sys.stderr)
        return 1
    print(f"SUPABASE_PROJECT_REF={ref}")
    print(f"ORDAX_ACCOUNT_GATEWAY_DESTINATION={name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
