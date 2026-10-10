"""Single source for checking live OrdaX legal-policy document integrity.

Verify immutable SHA-256 of the exact HTML bytes linked by the server-owned
active policy. Never recompute, update or reinterpret an accepted policy hash.
The fetcher is injected so independent probes and deployment proofs share
identical validation without sharing HTTP adapters.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Callable

POLICY_SCHEMA = "prototype-ordax.registration-legal-policy/1"
MAX_POLICY_BYTES = 128 * 1024
MAX_HTML_BYTES = 2 * 1024 * 1024
ROUTES = (("privacy", "/privacidade/"), ("terms", "/termos/"))


class PublicLegalIntegrityError(ValueError):
    """Policy projection or served immutable document is inconsistent."""


def verify_public_legal_integrity(
    origin: str,
    get: Callable,
    *,
    require_active: bool = False,
    report: Callable[[str], None] | None = None,
) -> str:
    """Return ACTIVE or INACTIVE after verifying the policy and exact legal HTML."""
    def fail(code: str):
        raise PublicLegalIntegrityError(code)

    with get("/auth/registration-policy", accept="application/json") as response:
        if response.status != 200:
            fail("registration-policy-unavailable")
        if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            fail("registration-policy-content-type")
        if "no-store" not in response.headers.get("Cache-Control", "").lower():
            fail("registration-policy-cache")
        raw = response.read(MAX_POLICY_BYTES + 1)
    if len(raw) > MAX_POLICY_BYTES:
        fail("registration-policy-too-large")
    try:
        policy = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError):
        fail("registration-policy-invalid-json")
    if not isinstance(policy, dict) or policy.get("$schema") != POLICY_SCHEMA:
        fail("registration-policy-schema")
    if type(policy.get("active")) is not bool or type(policy.get("registrationEnabled")) is not bool:
        fail("registration-policy-state-invalid")
    if not policy["active"]:
        if policy["registrationEnabled"]:
            fail("registration-enabled-without-active-policy")
        if require_active:
            fail("registration-policy-inactive")
        return "INACTIVE"
    if not policy["registrationEnabled"] and require_active:
        fail("registration-disabled-despite-live-auth")
    # A policy's published document integrity matters even when new signup
    # is currently disabled; never bypass its digest checks.
    for label, route in ROUTES:
        item = policy.get(label)
        if not isinstance(item, dict):
            fail("registration-policy-document-invalid:" + label)
        digest = item.get("sha256")
        if (
            item.get("url") != origin + route
            or not isinstance(item.get("version"), str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", item["version"])
            or not isinstance(item.get("effectiveDate"), str)
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", item["effectiveDate"])
            or not isinstance(digest, str)
            or not re.fullmatch(r"[0-9a-f]{64}", digest)
        ):
            fail("registration-policy-document-fields:" + label)
        with get(route, accept="text/html") as response:
            if response.status != 200:
                fail("published-legal-document-unavailable:" + label)
            if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "text/html":
                fail("published-legal-document-content-type:" + label)
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                fail("published-legal-document-encoding:" + label)
            html = response.read(MAX_HTML_BYTES + 1)
        if len(html) > MAX_HTML_BYTES:
            fail("published-legal-document-too-large:" + label)
        if hashlib.sha256(html).hexdigest() != digest:
            fail("published-legal-document-hash-mismatch:" + label)
        if report:
            report("ORDAX_PUBLIC_LEGAL_DOCUMENT=" + label + " SHA256_MATCH")
    return "ACTIVE"
