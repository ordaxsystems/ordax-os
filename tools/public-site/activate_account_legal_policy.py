#!/usr/bin/env python3
"""Build or apply a reviewed OrdaX public legal-policy activation candidate.

The tool never treats draft legal pages as authority. Candidate generation requires
public-legal-readiness to be fully ready and binds exact served legal page bytes
to SHA-256 digests. Apply mode calls only the service-role-only activation RPC
and writes a sanitized receipt with no credentials or account identifiers.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Both public activation gates use one implementation of operator identity rules.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from legal_operator import operator_blockers
from public_html_render import render_public_html
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
LEGAL = ROOT / "docs" / "contracts" / "public-legal-readiness.json"
CANONICAL_ACCOUNT_DESTINATION = ROOT / "infra" / "supabase" / "product" / "account_destination_migration_plan.json"
PUBLIC_AUTH_CONTRACT = ROOT / "docs" / "contracts" / "public-auth-provider-policy.json"
MAX_PUBLIC_DOCUMENT_BYTES = 2 * 1024 * 1024
SITE = ROOT / "sites" / "public"
SCHEMA = "prototype-ordax.account-legal-policy-candidate/1"
RECEIPT_SCHEMA = "prototype-ordax.account-legal-policy-activation-receipt/1"
VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
SOURCE_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


def fail(reason: str) -> "NoReturn":
    raise SystemExit(f"ACCOUNT_LEGAL_POLICY_ACTIVATION=FAIL reason={reason}")


def canonical_provider_url() -> str:
    """Use the migration destination contract as the single account provider ref."""
    try:
        destination = json.loads(
            CANONICAL_ACCOUNT_DESTINATION.read_text(encoding="utf-8")
        )
    except (OSError, ValueError) as exc:
        fail("canonical-account-destination-unavailable")
    ref = destination.get("destination_project_ref")
    if (
        destination.get("destination_project_name") != "ordax-platform"
        or not isinstance(ref, str)
        or not re.fullmatch(r"[a-z0-9]{20}", ref)
    ):
        fail("canonical-account-destination-invalid")
    return f"https://{ref}.supabase.co"


def clean_origin(raw: str) -> str:
    parsed = urlsplit(raw.strip())
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("clean https origin required")
    return f"https://{parsed.netloc}"


def canonical_public_origin() -> str:
    """Bind public legal documents to the source-owned production origin."""
    try:
        policy = json.loads(PUBLIC_AUTH_CONTRACT.read_text(encoding="utf-8"))
        value = policy["redirect_policy"]["origin"]
        clean = clean_origin(value)
    except (OSError, KeyError, TypeError, ValueError) as exc:
        fail("canonical-public-origin-invalid")
    if value != clean:
        fail("canonical-public-origin-invalid")
    return clean


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def verify_published_legal_documents(candidate: dict) -> None:
    """Prove exact published HTML equals the immutable, approved source bytes.

    Reads public HTML only. No authorization or Supabase credentials are sent.
    """
    origin = canonical_public_origin()
    if candidate.get("origin") != origin:
        fail("legal-document-origin-mismatch")
    try:
        contract = json.loads(LEGAL.read_text(encoding="utf-8"))
        documents = contract["documents"]
        if contract.get("status") != "ready" or contract.get("account_activation_ready") is not True:
            fail("legal-document-policy-not-ready")
    except (OSError, KeyError, TypeError, ValueError):
        fail("legal-document-contract-invalid")

    opener = urllib.request.build_opener(_NoRedirectHandler())
    for name in ("privacy", "terms"):
        try:
            route = documents[name]["route"]
            item = candidate[name]
            expected_url = origin + route
            local_digest = sha256_published_html_source(route_file(route))
            if (
                documents[name].get("final") is not True
                or item["url"] != expected_url
                or item["version"] != documents[name]["version"]
                or item["effective_date"] != documents[name]["effective_date"]
                or item["sha256"] != local_digest
                or not SHA_RE.fullmatch(item["sha256"])
            ):
                fail("legal-document-source-mismatch")
        except (KeyError, TypeError, OSError, ValueError):
            fail("legal-document-source-invalid")

        request = urllib.request.Request(
            expected_url,
            headers={
                "Accept": "text/html",
                "Accept-Encoding": "identity",
                "User-Agent": "OrdaX-Legal-Policy-Activation/1",
            },
        )
        try:
            with opener.open(request, timeout=15) as response:
                if response.status != 200:
                    fail("legal-document-unexpected-status")
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
                if content_type != "text/html":
                    fail("legal-document-content-type-invalid")
                body = response.read(MAX_PUBLIC_DOCUMENT_BYTES + 1)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, TimeoutError):
            fail("legal-document-publication-unavailable")
        if len(body) > MAX_PUBLIC_DOCUMENT_BYTES:
            fail("legal-document-response-too-large")
        if hashlib.sha256(body).hexdigest() != local_digest:
            fail("legal-document-published-content-mismatch")


def route_file(route: str) -> Path:
    if not isinstance(route, str) or not route.startswith("/") or "?" in route or "#" in route:
        raise ValueError("canonical route required")
    relative = route.strip("/")
    if not relative or ".." in relative.split("/"):
        raise ValueError("canonical route required")
    return SITE / relative / "index.html"


def sha256_published_html_source(path: Path) -> str:
    """Hash the exact HTML emitted by the canonical public-site builder.

    Source markup is not the production publication: the canonical build
    injects the shared brand stylesheet link. Policy digests MUST use those
    emitted bytes, not a separately hashed source or a guessed visual asset.
    """
    markup = render_public_html(path.read_text(encoding="utf-8"))
    return hashlib.sha256(markup.encode("utf-8")).hexdigest()


def build_candidate(origin: str) -> dict:
    contract = json.loads(LEGAL.read_text(encoding="utf-8"))
    if contract.get("$schema") != "prototype-ordax.public-legal-readiness/1":
        raise ValueError("unexpected legal readiness schema")
    if contract.get("status") != "ready" or contract.get("account_activation_ready") is not True:
        raise ValueError("legal readiness is not ready")

    operator_issues = operator_blockers(contract.get("operator"))
    if operator_issues:
        raise ValueError("legal operator not ready: " + ",".join(operator_issues))

    clean = clean_origin(origin)
    documents = contract.get("documents")
    if not isinstance(documents, dict):
        raise ValueError("legal documents object required")

    result: dict[str, object] = {
        "$schema": SCHEMA,
        "origin": clean,
    }
    for name in ("privacy", "terms"):
        item = documents.get(name)
        if not isinstance(item, dict) or item.get("final") is not True:
            raise ValueError(f"{name} document is not final")
        version = item.get("version")
        effective_date = item.get("effective_date")
        route = item.get("route")
        if not isinstance(version, str) or not VERSION_RE.fullmatch(version):
            raise ValueError(f"{name} version invalid")
        if not isinstance(effective_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", effective_date):
            raise ValueError(f"{name} effective date invalid")
        if not isinstance(route, str):
            raise ValueError(f"{name} route invalid")
        path = route_file(route)
        if not path.is_file():
            raise ValueError(f"{name} page missing")
        result[name] = {
            "version": version,
            "effective_date": effective_date,
            "sha256": sha256_published_html_source(path),
            "url": clean + route,
        }

    return result


def source_commit() -> str:
    value = (
        os.environ.get("GITHUB_SHA", "").strip().lower()
        or os.environ.get("ORDAX_SOURCE_COMMIT", "").strip().lower()
    )
    if not SOURCE_COMMIT_RE.fullmatch(value):
        raise ValueError("exact source commit required")
    return value


def apply_candidate(candidate: dict) -> str:
    url = os.environ.get("ORDAX_SUPABASE_URL", "").strip().rstrip("/")
    secret = os.environ.get("ORDAX_SUPABASE_SECRET_KEY", "").strip()
    if not url or not secret:
        fail("provider-operator-credential-missing")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path or parsed.query or parsed.fragment:
        fail("provider-url-invalid")
    if url != canonical_provider_url():
        fail("provider-project-mismatch")
    # Opaque sb_secret keys are NOT JWTs. Require a dedicated modern backend
    # key and send it only on apikey; a Bearer copy breaks PostgREST role
    # inference, even if its value matches the apikey header.
    if not re.fullmatch(r"sb_secret_[A-Za-z0-9_-]{16,256}", secret):
        fail("provider-operator-secret-key-format-invalid")

    # A green source contract is not proof the legal terms are actually live.
    # Never activate an unseen/mismatched document or follow redirects.
    verify_published_legal_documents(candidate)

    privacy = candidate["privacy"]
    terms = candidate["terms"]
    payload = {
        "p_privacy_version": privacy["version"],
        "p_privacy_effective_date": privacy["effective_date"],
        "p_privacy_sha256": privacy["sha256"],
        "p_privacy_url": privacy["url"],
        "p_terms_version": terms["version"],
        "p_terms_effective_date": terms["effective_date"],
        "p_terms_sha256": terms["sha256"],
        "p_terms_url": terms["url"],
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url + "/rest/v1/rpc/ordax_activate_account_legal_policy_v1",
        data=body,
        method="POST",
        headers={
            "apikey": secret,
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": "OrdaX-Legal-Policy-Activation/1",
        },
    )
    try:
        with urllib.request.build_opener(_NoRedirectHandler()).open(request, timeout=20) as response:
            raw = response.read(4096)
            status = response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read(4096)
        status = exc.code
    except (urllib.error.URLError, OSError, TimeoutError):
        fail("provider-unreachable")
    if status != 200:
        fail(f"activation-rpc:{status}")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        fail("activation-rpc-invalid-json")
    if not isinstance(value, str) or not re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
        value,
        re.I,
    ):
        fail("activation-rpc-invalid-policy-id")
    return value.lower()


def write_json(path: str, value: dict) -> None:
    output = Path(path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(f".{output.name}.tmp-{os.getpid()}")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temp, output)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("candidate", "apply"))
    parser.add_argument("--origin", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)

    try:
        candidate = build_candidate(args.origin)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        fail(str(exc))

    if args.mode == "candidate":
        write_json(args.output, candidate)
        print("ACCOUNT_LEGAL_POLICY_CANDIDATE=PASS")
        return 0

    try:
        commit = source_commit()
    except ValueError as exc:
        fail(str(exc))

    policy_id = apply_candidate(candidate)
    receipt = {
        "$schema": RECEIPT_SCHEMA,
        "status": "pass",
        "policy_id": policy_id,
        "source_commit": commit,
        "workflow_run_id": os.environ.get("GITHUB_RUN_ID") or None,
        "origin": candidate["origin"],
        "privacy": candidate["privacy"],
        "terms": candidate["terms"],
        "credentials_persisted": False,
        "account_identifier_recorded": False,
        "provider_secret_recorded": False,
    }
    write_json(args.output, receipt)
    print("ACCOUNT_LEGAL_POLICY_ACTIVATION=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
