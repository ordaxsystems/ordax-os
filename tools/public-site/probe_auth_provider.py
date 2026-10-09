#!/usr/bin/env python3
"""Probe hosted Supabase Auth configuration without persisting credentials.

The live mode reads the hosted Auth configuration through the Supabase Management
API using SUPABASE_ACCESS_TOKEN. The token is never written to output. A config
file mode exists so CI can exercise the evaluator without external credentials.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

SCHEMA = "prototype-ordax.auth-provider-proof/2"
MIN_PASSWORD_CHARS = 12
PROVIDER_POLICY_PATH = Path(__file__).resolve().parents[2] / "docs/contracts/public-auth-provider-policy.json"
RECOVERY_PATH = "/auth/recover/verify"
PROJECT_REF_RE = re.compile(r"[a-z0-9]{20}\Z")
COMMIT_RE = re.compile(r"[0-9a-f]{40}\Z")


def project_binding(project_ref: str) -> str:
    """Consistency tag for the probed project, NOT an authenticated signature."""
    if not isinstance(project_ref, str) or PROJECT_REF_RE.fullmatch(project_ref) is None:
        raise ValueError("invalid Supabase project ref")
    return hashlib.sha256(("supabase-auth-project/1:" + project_ref).encode("ascii")).hexdigest()


def source_commit(value: str) -> str:
    if not isinstance(value, str) or COMMIT_RE.fullmatch(value) is None:
        raise ValueError("valid GitHub source commit required")
    return value



def clean_origin(raw: str) -> str:
    value = raw.strip().rstrip("/")
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("production origin must be a clean HTTPS origin")
    return value


def redirect_values(raw: object) -> list[str]:
    if isinstance(raw, str):
        return [part.strip() for part in raw.split(",") if part.strip()]
    if isinstance(raw, list) and all(isinstance(item, str) for item in raw):
        return [item.strip() for item in raw if item.strip()]
    return []


def evaluate(
    config: dict, expected_origin: str, *,
    project_ref: str | None = None, commit: str | None = None,
) -> dict:
    origin = clean_origin(expected_origin)
    site_url = str(config.get("site_url") or "").rstrip("/")
    redirects = redirect_values(config.get("uri_allow_list"))

    normalized_redirects: list[str] = []
    wildcard_redirect = False
    cross_origin_redirect = False
    for item in redirects:
        wildcard_redirect = wildcard_redirect or "*" in item
        try:
            parsed = urlparse(item)
            if parsed.scheme != "https" or not parsed.netloc:
                cross_origin_redirect = True
                continue
            item_origin = f"{parsed.scheme}://{parsed.netloc}"
            if item_origin != origin:
                cross_origin_redirect = True
            normalized_redirects.append(item.rstrip("/"))
        except ValueError:
            cross_origin_redirect = True

    password_raw = config.get("password_min_length")
    try:
        password_min = int(password_raw)
    except (TypeError, ValueError):
        password_min = 0

    # mailer_autoconfirm=false means confirmation is required.
    confirmation_required = config.get("mailer_autoconfirm") is False
    password_ok = password_min >= MIN_PASSWORD_CHARS
    site_url_ok = site_url == origin
    recovery_url = f"{origin}{RECOVERY_PATH}"
    signup_url = f"{origin}/login/"
    recovery_redirect_ok = recovery_url in normalized_redirects
    signup_redirect_ok = signup_url.rstrip("/") in normalized_redirects

    # Canonical mail settings are policy-owned, never duplicated as CI inputs.
    policy = json.loads(PROVIDER_POLICY_PATH.read_text(encoding="utf-8"))
    mail = policy.get("transactional_email")
    if not isinstance(mail, dict) or mail.get("provider") != "resend":
        raise ValueError("canonical transactional mail policy required")
    try:
        smtp_port = int(config.get("smtp_port"))
    except (ValueError, TypeError):
        smtp_port = -1
    smtp_configured = all((
        config.get("smtp_host") == mail.get("smtp_host"),
        smtp_port == mail.get("smtp_port"),
        config.get("smtp_user") == mail.get("smtp_user"),
        config.get("smtp_admin_email") == mail.get("sender_email"),
        config.get("smtp_sender_name") == mail.get("sender_name"),
    ))
    # Hosted Auth config GET may redact smtp_pass. Never output the secret;
    # passing the probe still requires an independent real delivery test.
    subject = config.get("mailer_subjects_confirmation")
    template = config.get("mailer_templates_confirmation_content")
    confirmation_url = policy.get("redirect_policy", {}).get("signup_confirm_url")
    branded_confirmation = (
        isinstance(subject, str)
        and "OrdaX" in subject
        and isinstance(template, str)
        and isinstance(confirmation_url, str)
        and confirmation_url + "?token_hash={{ .TokenHash }}" in template
        and "type=email" in template
        and "{{ .ConfirmationURL }}" not in template
        and "localhost" not in template.lower()
    )
    redirects_same_origin = bool(redirects) and not wildcard_redirect and not cross_origin_redirect

    recovery_subject = config.get("mailer_subjects_recovery")
    recovery_template = config.get("mailer_templates_recovery_content")
    recovery_template_configured = (
        isinstance(recovery_subject, str)
        and bool(recovery_subject.strip())
        and isinstance(recovery_template, str)
        and bool(recovery_template.strip())
        and ("{{ .ConfirmationURL }}" in recovery_template or "{{ .TokenHash }}" in recovery_template)
    )

    checks = {
        "confirm_email": confirmation_required,
        "password_policy": password_ok,
        "production_origin": site_url_ok,
        "redirect_allowlist": recovery_redirect_ok and signup_redirect_ok and redirects_same_origin,
        "recovery_template": recovery_template_configured,
        "resend_smtp_settings": smtp_configured,
        "branded_confirmation_template": branded_confirmation,
    }
    return {
        "$schema": SCHEMA,
        "provider": "supabase",
        "project_ref": "redacted",
        "project_binding": project_binding(project_ref) if project_ref is not None else None,
        "source_commit": source_commit(commit) if commit is not None else None,
        "expected_origin": origin,
        "checks": checks,
        "observed": {
            "password_min_length": password_min,
            "redirect_count": len(redirects),
            "wildcard_redirect_present": wildcard_redirect,
            "cross_origin_redirect_present": cross_origin_redirect,
        },
        "ready": all(checks.values()),
    }


def fetch_live(project_ref: str, access_token: str) -> dict:
    project_binding(project_ref)  # validate before interpolating into management URL
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{project_ref}/config/auth",
        headers={
            "accept": "application/json",
            "authorization": f"Bearer {access_token}",
            "user-agent": "OrdaX-Auth-Provider-Probe/1",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status != 200:
                raise RuntimeError(f"management-api-status-{response.status}")
            raw = response.read(512 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"management-api-status-{exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("management-api-unavailable") from exc
    if len(raw) > 512 * 1024:
        raise RuntimeError("management-api-response-too-large")
    value = json.loads(raw.decode("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError("management-api-invalid-response")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--config-file")
    source.add_argument("--live", action="store_true")
    parser.add_argument("--origin", default=os.environ.get("ORDAX_PUBLIC_ORIGIN", ""))
    parser.add_argument("--project-ref", default=os.environ.get("SUPABASE_PROJECT_REF", ""))
    args = parser.parse_args(argv)

    try:
        origin = clean_origin(args.origin)
        if args.config_file:
            config = json.loads(Path(args.config_file).read_text(encoding="utf-8"))
            if not isinstance(config, dict):
                raise ValueError("config object required")
            proof = evaluate(config, origin)  # fixtures carry no release authority
        else:
            token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
            project_ref = args.project_ref.strip()
            if not token or not project_ref:
                raise ValueError("live probe requires SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF")
            verified_commit = source_commit(os.environ.get("GITHUB_SHA", "").strip())
            config = fetch_live(project_ref, token)
            proof = evaluate(config, origin, project_ref=project_ref, commit=verified_commit)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"AUTH_PROVIDER_PROBE=FAIL reason={exc}", file=sys.stderr)
        return 1

    print(json.dumps(proof, sort_keys=True, separators=(",", ":")))
    print("AUTH_PROVIDER_PROBE=PASS" if proof["ready"] else "AUTH_PROVIDER_PROBE=BLOCKED")
    return 0 if proof["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
