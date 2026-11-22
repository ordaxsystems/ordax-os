#!/usr/bin/env python3
"""Publish only an attested Site change; no build/owner policy is duplicated here.

Only invoked after the existing Public Site Candidate workflow passes on main.
The Vercel Git webhook must be disabled for this *project* before enabling this
pipeline. Never run in parallel with Git-triggered production deployments.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
SITE_IMPACT = ROOT / "site" / "scripts" / "build_impact.py"
PROJECT_ID = "prj_mA9ew6hOfjdqlBr1cC757iMLPQJC"
TEAM_ID = "team_E3bdE137ZG3fhCGMmYuGKJ8o"
OWNER = "ordaxsystems"
REPO = "ordax-os"
ORIGIN = "https://ordax.com.br"
API = "https://api.vercel.com"
SHA = re.compile(r"[0-9a-f]{40}\Z")


class DeliveryError(RuntimeError):
    pass


def json_request(url: str, *, token: str | None = None,
                 post: dict | None = None) -> dict:
    headers = {"Accept": "application/json", "User-Agent": "ordax-site-selective-delivery/1"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if post is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, method="POST" if post is not None else "GET", headers=headers,
                      data=json.dumps(post).encode() if post is not None else None)
    try:
        with urlopen(request, timeout=25) as response:
            if response.status < 200 or response.status >= 300:
                raise DeliveryError(f"Unexpected HTTP {response.status}")
            value = json.load(response)
    except HTTPError as exc:
        # Do not print bearer tokens, response headers or untrusted API bodies.
        raise DeliveryError(f"HTTP {exc.code} at {url.split('?')[0]}") from None
    except (URLError, OSError, ValueError) as exc:
        raise DeliveryError(f"Cannot verify {url.split('?')[0]}: {type(exc).__name__}") from None
    if not isinstance(value, dict):
        raise DeliveryError("Invalid JSON object")
    return value


def correct_source(manifest: dict, commit: str) -> bool:
    return (manifest.get("artifact_class") == "public-site"
            and manifest.get("source_commit") == commit
            and all(manifest.get(key, {}).get("source_repository") == f"{OWNER}/{REPO}"
                    and manifest[key].get("source_commit") == commit
                    for key in ("brand", "surface_preview")
                    if isinstance(manifest.get(key), dict))
            and all(isinstance(manifest.get(key), dict) for key in ("brand", "surface_preview")))


def affects_site(files: list[str]) -> bool:
    spec = importlib.util.spec_from_file_location("canonical_site_impact", SITE_IMPACT)
    if spec is None or spec.loader is None:
        raise DeliveryError("Missing canonical Site impact policy")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return any(module.affects_site_deployment(path) for path in files)


def compare_paths(base: str, head: str, github_token: str) -> list[str] | None:
    """Return complete changed-file list only if head descends from base.

    GitHub Compare reports at most 300 files. Uncertain data is *not* a
    permission to skip or to substitute an untested commit.
    """
    compare = json_request(f"https://api.github.com/repos/{OWNER}/{REPO}/compare/{base}...{head}",
                           token=github_token)
    files = compare.get("files")
    if compare.get("status") not in ("ahead", "identical") or not isinstance(files, list):
        return None
    if len(files) >= 300:
        return None
    if any(not isinstance(row, dict) or not isinstance(row.get("filename"), str)
           or row.get("status") not in {"added", "removed", "modified", "renamed", "copied", "changed", "unchanged"}
           for row in files):
        return None
    # Renamed source files can change generated assets even if the new name is irrelevant.
    paths = [row["filename"] for row in files]
    paths += [row["previous_filename"] for row in files
              if row.get("status") == "renamed" and isinstance(row.get("previous_filename"), str)]
    return paths


def needs_deployment(live: dict, sha: str, github_token: str) -> bool:
    published = live.get("source_commit")
    if not isinstance(published, str) or SHA.fullmatch(published) is None:
        return True  # Unknown published input: fail closed; never silently skip.
    if published == sha:
        return not correct_source(live, sha)
    paths = compare_paths(published, sha, github_token)
    return paths is None or not correct_source(live, published) or affects_site(paths)


def publish(sha: str, vercel_token: str) -> str:
    response = json_request(f"{API}/v13/deployments?teamId={TEAM_ID}", token=vercel_token,
                            post={"name": "ordax-os-public", "project": PROJECT_ID,
                                  "target": "production",
                                  "gitSource": {"type": "github", "org": OWNER,
                                                "repo": REPO, "ref": "main", "sha": sha}})
    deployment_id = response.get("id")
    if not isinstance(deployment_id, str) or not deployment_id.startswith("dpl_"):
        raise DeliveryError("Vercel did not acknowledge a deployment ID")
    return deployment_id


def verify_ready(deployment_id: str, sha: str, token: str) -> None:
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        state = json_request(f"{API}/v13/deployments/{deployment_id}?teamId={TEAM_ID}", token=token)
        if state.get("readyState") in {"ERROR", "CANCELED", "BLOCKED"}:
            raise DeliveryError(f"Vercel deployment {deployment_id} ended {state['readyState']}")
        if state.get("readyState") == "READY":
            if state.get("projectId") not in (None, PROJECT_ID):
                raise DeliveryError("Deployment project does not match production")
            if (state.get("meta") or {}).get("githubCommitSha") not in (None, sha):
                raise DeliveryError("Vercel built an unexpected commit")
            break
        time.sleep(5)
    else:
        raise DeliveryError(f"Deployment {deployment_id} not READY within verification window")
    while time.monotonic() < deadline:
        live = json_request(ORIGIN + "/public-site-manifest.json")
        if correct_source(live, sha):
            return
        time.sleep(5)
    raise DeliveryError("READY but public domain does not serve the verified commit")


def main() -> int:
    if os.getenv("ORDAX_SITE_SELECTIVE_DEPLOY_ENABLED") != "true":
        raise DeliveryError("Selective delivery not explicitly enabled")
    sha = os.getenv("ORDAX_SITE_CANDIDATE_SHA", "")
    github_token = os.getenv("GITHUB_TOKEN", "")
    vercel_token = os.getenv("VERCEL_TOKEN", "")
    if SHA.fullmatch(sha) is None or not github_token or not vercel_token:
        raise DeliveryError("Missing validated SHA or deployment credentials")
    head = json_request(f"https://api.github.com/repos/{OWNER}/{REPO}/branches/main",
                        token=github_token).get("commit", {}).get("sha")
    if not isinstance(head, str) or SHA.fullmatch(head) is None:
        raise DeliveryError("Cannot validate current main")
    if head != sha:
        # Other OrdaX agents push Creator/native code continuously. Their
        # commits must not suppress the Site candidate or cause stale deploys.
        # Safe to promote newer main only if *all* post-CI changes are unrelated
        # to the validated Site. If Site changed, wait for its own candidate CI.
        delta = compare_paths(sha, head, github_token)
        if delta is None or affects_site(delta):
            print("SITE_DEPLOY=DEFERRED newer Site source needs its own successful CI")
            return 0
        print("SITE_DEPLOY=REBASED unchanged Site onto latest main")
        sha = head
    try:
        manifest = json_request(ORIGIN + "/public-site-manifest.json")
    except DeliveryError:
        manifest = {}  # Unable to prove equivalence: publish, never skip.
    if not needs_deployment(manifest, sha, github_token):
        print("SITE_DEPLOY=SKIPPED equivalent live Site; no Vercel request")
        return 0
    # Exactly one create operation. Provider quota errors must not be retried.
    deployment_id = publish(sha, vercel_token)
    print("SITE_DEPLOY=CREATED " + deployment_id)
    verify_ready(deployment_id, sha, vercel_token)
    print("SITE_DEPLOY=VERIFIED " + deployment_id)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DeliveryError as exc:
        print("SITE_DEPLOY=BLOCKED " + str(exc), file=sys.stderr)
        raise SystemExit(1)
