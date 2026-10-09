#!/usr/bin/env python3
"""Build and validate the production Vercel OIDC identity for the OrdaX public site.

The Vercel team/project pair is the source identity. Issuer, audience and subject
are derived deterministically so the repository never carries independent copies
of those claims during migration.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "docs" / "contracts" / "public-site-deployment.json"
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$")
PROJECT_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$")


def load_contract(path: Path = CONTRACT_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_origin(raw: str) -> str:
    value = raw.strip()
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or (parsed.path not in ("", "/"))
    ):
        raise ValueError("invalid-production-origin")
    return f"https://{parsed.netloc}"


def build_identity(team_slug: str, project: str, origin: str) -> dict:
    team_slug = team_slug.strip()
    project = project.strip()
    if not SLUG_RE.fullmatch(team_slug):
        raise ValueError("invalid-vercel-team-slug")
    if not PROJECT_RE.fullmatch(project):
        raise ValueError("invalid-vercel-project")
    origin = normalize_origin(origin)
    return {
        "team_slug": team_slug,
        "project": project,
        "environment": "production",
        "issuer": f"https://oidc.vercel.com/{team_slug}",
        "audience": f"https://vercel.com/{team_slug}",
        "subject": f"owner:{team_slug}:project:{project}:environment:production",
        "origin": origin,
    }


def build_candidate(contract: dict, origin: str) -> dict:
    migration = contract["vercel_migration"]
    if migration.get("personal_scope_allowed") is not False:
        raise ValueError("personal-vercel-scope-must-be-disabled")
    if migration.get("legacy_team_allowed_after_cutover") is not False:
        raise ValueError("legacy-vercel-team-must-be-disabled-after-cutover")
    if migration.get("shared_secret_fallback_allowed") is not False:
        raise ValueError("shared-secret-fallback-must-be-disabled")
    if migration.get("preview_identity_allowed") is not False:
        raise ValueError("preview-identity-must-be-disabled")
    if migration.get("runtime_proof_required_before_public_auth") is not True:
        raise ValueError("runtime-proof-must-gate-public-auth")

    target_team = migration["target_team_slug"]
    adapter_team = contract["vercel_adapter"]["team"]
    if target_team != adapter_team:
        raise ValueError("adapter-team-must-match-target-team")

    # Legacy team is historical evidence in the migration owner, NOT the
    # deployed public Edge's current issuer. Never derive old authority from
    # current deployment state, which must instead match the active target.
    historical_team = migration.get("historical_team_slug")
    if not isinstance(historical_team, str) or not SLUG_RE.fullmatch(historical_team):
        raise ValueError("invalid-legacy-team-evidence")
    if target_team == historical_team:
        raise ValueError("target-team-must-not-equal-legacy-team")

    candidate = build_identity(target_team, migration["target_project"], origin)
    active_edge = contract.get("public_edge_gateway")
    if not isinstance(active_edge, dict) or active_edge.get("deployed") is not True:
        raise ValueError("canonical-public-edge-deployment-required")
    for evidence, candidate_key in (
        ("oidc_issuer", "issuer"),
        ("oidc_audience", "audience"),
        ("oidc_subject", "subject"),
    ):
        if active_edge.get(evidence) != candidate[candidate_key]:
            raise ValueError("canonical-public-edge-oidc-mismatch")
    return candidate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--origin",
        required=True,
        help="Final HTTPS public origin, for example https://ordax.com.br",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    candidate = build_candidate(load_contract(), args.origin)
    if args.json:
        print(json.dumps(candidate, indent=2, sort_keys=True))
    else:
        for key, value in candidate.items():
            print(f"{key}={value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
