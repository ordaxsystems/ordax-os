#!/usr/bin/env python3
"""Publish the exact verified Stable v4 candidate to canonical GitHub HTTPS.

This is an operator-invoked publisher, NOT a physical USB writer, release
activator, signing authority, or Stable channel promotion.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

from validate_v4_publication_staging import (
    AdmissionError,
    FILES,
    REPO,
    digest,
    verified_plan,
)

ASSET_NAMES = ("release-manifest.json", "release-envelope.json", *FILES)
TRUST_PATH = "bootstrap/trust/release-ed25519.json"
REPORT_SCHEMA = "prototype-ordax.canonical-v4-https-publication/1"


def command(args: list[str], *, cwd: Path | None = None) -> str:
    try:
        completed = subprocess.run(
            args, cwd=cwd, capture_output=True, text=True, encoding="utf-8",
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        # Do not dump auth headers, tokens, shell environment or subprocess output.
        raise AdmissionError(f"required verification command failed: {args[0]}") from exc
    return completed.stdout.strip()


def validate_local(*, source_root: Path, bundle: Path, request: Path,
                   receipt: Path, trust: Path, agent: Path,
                   source_commit: str) -> dict:
    if re.fullmatch(r"[0-9a-f]{40}", source_commit) is None:
        raise AdmissionError("invalid frozen source SHA")
    if not agent.is_file() or agent.is_symlink():
        raise AdmissionError("release-agent binary not a regular file")
    # The pinned trust must be read from the frozen source's Git object.
    pinned_blob_id = command([
        "git", "-C", str(source_root), "rev-parse",
        source_commit + ":" + TRUST_PATH,
    ])
    pinned_sha = hashlib.sha256(subprocess_git_blob(source_root, pinned_blob_id)).hexdigest()
    if digest(trust)[0] != pinned_sha:
        raise AdmissionError("local public trust differs from signed source")
    command([str(agent), "verify-envelope",
             "--envelope", str(bundle / "release-envelope.json"),
             "--trust", str(trust)])
    plan = verified_plan(
        bundle=bundle, request=request, receipt=receipt,
        trust=trust, source_commit=source_commit,
    )
    if tuple(asset["name"] for asset in plan["assets"]) != ASSET_NAMES:
        raise AdmissionError("publication asset list is not exact")
    return plan


def subprocess_git_blob(source_root: Path, object_id: str) -> bytes:
    if re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", object_id) is None:
        raise AdmissionError("invalid source trust blob")
    try:
        return subprocess.run(
            ["git", "-C", str(source_root), "cat-file", "blob", object_id],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ).stdout
    except (OSError, subprocess.CalledProcessError) as exc:
        raise AdmissionError("unable to read pinned public trust bytes") from exc


def verify_uploaded_release(release: dict, plan: dict, *, draft: bool) -> None:
    if (not isinstance(release, dict)
        or release.get("tag_name") != plan["release_tag"]
        or release.get("target_commitish") != plan["source_commit"]
        or release.get("draft") is not draft
        or release.get("prerelease") is not True):
        raise AdmissionError("published release identity or state differs")
    uploaded = release.get("assets")
    if (not isinstance(uploaded, list) or len(uploaded) != len(ASSET_NAMES)
        or not all(isinstance(item, dict) for item in uploaded)):
        raise AdmissionError("published release artifact inventory differs")
    if set(item.get("name") for item in uploaded) != set(ASSET_NAMES):
        raise AdmissionError("unexpected public release artifact name")
    expected = {item["name"]: item for item in plan["assets"]}
    for item in uploaded:
        match = expected[item["name"]]
        if (item.get("state") != "uploaded"
            or item.get("size") != match["size"]
            or item.get("digest") != "sha256:" + match["sha256"]):
            raise AdmissionError("public release artifact digest mismatch: " + item["name"])


def remote_release(tag: str) -> dict | None:
    """Locate exact releases, including drafts hidden by the tag endpoint.

    The authenticated collection is the single source of metadata before
    and after publication. Refuse ambiguous or incomplete inventories.
    """
    found = []
    for page in range(1, 21):
        try:
            page_data = json.loads(command([
                "gh", "api", f"repos/{REPO}/releases?per_page=100&page={page}",
            ]))
        except (ValueError, json.JSONDecodeError) as exc:
            raise AdmissionError("cannot parse canonical releases inventory") from exc
        if not isinstance(page_data, list) or len(page_data) > 100:
            raise AdmissionError("invalid canonical releases inventory")
        for release in page_data:
            if not isinstance(release, dict):
                raise AdmissionError("invalid release inventory entry")
            if release.get("tag_name") == tag:
                found.append(release)
        if len(found) > 1:
            raise AdmissionError("ambiguous canonical release tag")
        if len(page_data) < 100:
            return found[0] if found else None
    raise AdmissionError("canonical releases inventory exceeds review limit")


def exact_release_id(release: dict) -> int:
    release_id = release.get("id") if isinstance(release, dict) else None
    if type(release_id) is not int or release_id <= 0:
        raise AdmissionError("canonical release has no valid immutable ID")
    return release_id


def require_tag_absent(tag: str) -> None:
    # Check GitHub's canonical tag ref, not a possibly unrelated local remote.
    try:
        proc = subprocess.run(
            ["gh", "api", "--include", f"repos/{REPO}/git/ref/tags/{tag}"],
            capture_output=True, text=True, encoding="utf-8",
        )
    except OSError as exc:
        raise AdmissionError("GitHub tag preflight unavailable") from exc
    statuses = re.findall(r"^HTTP/\S+\s+(\d{3})\b", proc.stdout, re.MULTILINE)
    if proc.returncode != 0 and statuses == ["404"]:
        return
    raise AdmissionError("canonical release tag already exists or cannot be checked")


def publish_reviewed(plan: dict, bundle: Path, *, confirmed_tag: str) -> dict:
    tag = plan["release_tag"]
    if confirmed_tag != tag:
        raise AdmissionError("explicit confirmation does not match frozen tag")

    existing = remote_release(tag)
    if existing is not None:
        # A prior attempt may have staged all five assets, but failed when
        # GitHub's releases/tags endpoint hid the draft. Resume only the
        # exact verified draft: no clobber, reupload or parallel release.
        verify_uploaded_release(existing, plan, draft=True)
        release = existing
    else:
        require_tag_absent(tag)
        args = [
            "gh", "release", "create", tag,
            *(str(bundle / name) for name in ASSET_NAMES),
            "--repo", REPO, "--target", plan["source_commit"],
            "--title", "OrdaX Stable v4 candidate " + plan["source_commit"][:12],
            "--notes", ("Canonical signed candidate for HTTPS materialization; "
                        "USB physical write and Stable channel promotion remain blocked."),
            "--draft", "--prerelease",
        ]
        command(args)
        release = remote_release(tag)
        verify_uploaded_release(release, plan, draft=True)

    release_id = exact_release_id(release)
    # Resolve the exact draft by its immutable ID; the tag endpoint can 404.
    # -F sends typed booleans, not strings, to GitHub's PATCH API.
    command(["gh", "api", "--method", "PATCH",
             f"repos/{REPO}/releases/{release_id}",
             "-F", "draft=false", "-F", "prerelease=true"])
    verified_public = remote_release(tag)
    if exact_release_id(verified_public) != release_id:
        raise AdmissionError("canonical release identity changed after publish")
    verify_uploaded_release(verified_public, plan, draft=False)
    return {
        "schema": REPORT_SCHEMA,
        "source_commit": plan["source_commit"],
        "release_tag": tag,
        "status": "published-prerelease-verifiable-https",
        "release_published": True,
        "release_activated": False,
        "physical_write_authorized": False,
        "physical_write_performed": False,
        "assets": plan["assets"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--signing-request", type=Path, required=True)
    parser.add_argument("--signed-receipt", type=Path, required=True)
    parser.add_argument("--trust", type=Path, required=True)
    parser.add_argument("--release-agent", type=Path, required=True)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--confirm-tag", default="")
    args = parser.parse_args()
    try:
        plan = validate_local(
            source_root=args.source_root, bundle=args.bundle_dir,
            request=args.signing_request, receipt=args.signed_receipt,
            trust=args.trust, agent=args.release_agent,
            source_commit=args.source_commit,
        )
        if args.publish:
            result = publish_reviewed(
                plan, args.bundle_dir, confirmed_tag=args.confirm_tag,
            )
        else:
            if args.confirm_tag:
                raise AdmissionError("confirmation is accepted only with --publish")
            result = plan
    except (AdmissionError, OSError) as exc:
        print(json.dumps({
            "schema": REPORT_SCHEMA, "status": "blocked", "error": str(exc),
        }), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
