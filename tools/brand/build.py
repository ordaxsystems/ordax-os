#!/usr/bin/env python3
"""Compile identity artifacts from the canonical Surface tokens, without new visual owners.

This module never reads or writes SMTP credentials. Hosted Supabase templates are
provider configuration: local rendering alone does not update production.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOKENS = ROOT / "system/surface/ui/tokens.css"
TEMPLATES = ROOT / "infra/supabase/identity/email-templates"
PUBLIC_ORIGIN = "https://ordax.com.br"
SUPABASE_REF = "jhfphsjptrpmtnzkpwud"

# Semantic values only: the dark/bright brand colors and light theme are
# already owned by the Surface. Do not copy hex codes into a second theme.
COLORS = (
    "bg", "app-bg", "panel", "border", "text", "muted", "faint",
    "accent", "accent-strong", "focus", "button-bg", "button-text",
)
BRAND_COLORS = ("brand-blue", "brand-violet", "brand-cyan")
SUPPORTED_TEMPLATES = {
    "confirmation": ("email", "/auth/confirm", "mailer_templates_confirmation_content", "mailer_subjects_confirmation", "Confirme seu e-mail — Conta OrdaX"),
    "recovery": ("recovery", "/auth/recover/verify", "mailer_templates_recovery_content", "mailer_subjects_recovery", "Redefina sua senha — Conta OrdaX"),
}
TEMPLATE_TOKEN = re.compile(r"\[\[ordax-([a-z-]+)\]\]")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
DECLARATION = re.compile(r"(--ordax-[a-z][a-z0-9-]*):\s*([^;]+);")


class BrandError(ValueError):
    pass


def css_block(source: str, selector: str) -> dict[str, str]:
    start = source.find(selector)
    if start < 0:
        raise BrandError("missing canonical theme selector")
    # An exact selector is required to avoid reading a high-contrast override.
    brace = source.find("{", start)
    if brace < 0 or "}" in source[start:brace]:
        raise BrandError("malformed canonical theme")
    end = source.find("}", brace + 1)
    if end < 0:
        raise BrandError("unterminated canonical theme")
    declarations = {}
    for key, value in DECLARATION.findall(source[brace + 1:end]):
        if key in declarations:
            raise BrandError("duplicate canonical token")
        declarations[key] = value.strip()
    return declarations


def load_colors(tokens_path: Path = TOKENS) -> tuple[dict[str, str], dict[str, str]]:
    content = tokens_path.read_text(encoding="utf-8")
    # First :root block is the default dark Surface palette; the explicit
    # light selector remains a theme override in both current and incoming UI.
    dark = css_block(content, ":root,")
    light = css_block(content, '[data-ordax-theme="light"]')
    required = {f"--ordax-{key}" for key in COLORS}
    if required - dark.keys() or required - light.keys():
        raise BrandError("missing required Surface semantic colors")
    for mapping in (dark, light):
        for key in required:
            if not HEX.fullmatch(mapping[key]):
                raise BrandError("non-hex value in email-compatible token")
    for name in BRAND_COLORS:
        key = f"--ordax-{name}"
        if key in dark and not HEX.fullmatch(dark[key]):
            raise BrandError("invalid brand accent token")
    return dark, light


def render_site_css(tokens_path: Path = TOKENS) -> str:
    dark, light = load_colors(tokens_path)
    names = [f"--ordax-{key}" for key in COLORS]
    names.extend(f"--ordax-{key}" for key in BRAND_COLORS if f"--ordax-{key}" in dark)
    result = ["/* Generated from system/surface/ui/tokens.css; do not edit. */", ":root {"]
    result.extend(f"  {name}: {dark[name]};" for name in names)
    result.append("}")
    result.append('[data-ordax-theme="light"] {')
    result.extend(f"  {name}: {light[name]};" for name in names if name in light)
    result.append("}")
    return "\n".join(result) + "\n"


def render_email(name: str, tokens_path: Path = TOKENS, templates_dir: Path = TEMPLATES) -> str:
    if name not in SUPPORTED_TEMPLATES:
        raise BrandError("unknown email template")
    dark, _ = load_colors(tokens_path)
    src = (templates_dir / "src" / (name + ".html")).read_text(encoding="utf-8")
    if any(value in src.lower() for value in ("<script", "{{ .ConfirmationURL }}", "{{ .RedirectTo }}", "http://", "javascript:")):
        raise BrandError("unsafe email source")
    seen = set()

    def replace(match: re.Match[str]) -> str:
        key = "--ordax-" + match.group(1)
        seen.add(key)
        if key not in dark or not HEX.fullmatch(dark[key]):
            raise BrandError("unrecognized email color token")
        return dark[key]

    rendered = TEMPLATE_TOKEN.sub(replace, src)
    if "[[ordax-" in rendered or not seen:
        raise BrandError("unresolved email design token")
    email_type, endpoint, _, _, _ = SUPPORTED_TEMPLATES[name]
    link = f'{PUBLIC_ORIGIN}{endpoint}?token_hash={{{{ .TokenHash }}}}&amp;type={email_type}'
    if rendered.count(link) != 1 or rendered.count("{{ .TokenHash }}") != 1:
        raise BrandError("email template must have a single strict OTP link")
    if "access_token" in rendered or "refresh_token" in rendered:
        raise BrandError("session token reference forbidden in email")
    return rendered


def check_emails() -> None:
    for name in SUPPORTED_TEMPLATES:
        path = TEMPLATES / (name + ".html")
        if path.read_text(encoding="utf-8") != render_email(name):
            raise BrandError(f"generated {name} email is out of sync; run render-emails")


def render_emails() -> None:
    for name in SUPPORTED_TEMPLATES:
        (TEMPLATES / (name + ".html")).write_text(render_email(name), encoding="utf-8")


def publish_emails(project_ref: str, *, allow_write: bool = False) -> str:
    if not allow_write or project_ref != SUPABASE_REF:
        raise BrandError("explicit approved production project required")
    check_emails()
    bearer = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if len(bearer) < 20 or any(c in bearer for c in "\r\n"):
        raise BrandError("secure management token not configured")
    url = f"https://api.supabase.com/v1/projects/{SUPABASE_REF}/config/auth"
    headers = {"Authorization": "Bearer " + bearer, "Accept": "application/json"}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as reply:
            status = reply.status
            auth = json.loads(reply.read(262144))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
        # Do not print authorization headers, error body or hosted Auth config.
        raise BrandError("Auth preflight failed; no changes applied") from None
    if status != 200 or not isinstance(auth, dict):
        raise BrandError("unexpected hosted Auth response")
    if (auth.get("site_url") != PUBLIC_ORIGIN
            or auth.get("smtp_host") != "smtp.resend.com"
            or auth.get("smtp_admin_email") != "no-reply@auth.ordax.com.br"
            or auth.get("mailer_autoconfirm") is not False):
        raise BrandError("hosted Auth origin/sender/confirmation policy mismatch")
    patch = {}
    for name, (_, _, body_key, subject_key, subject) in SUPPORTED_TEMPLATES.items():
        patch[body_key] = render_email(name)
        patch[subject_key] = subject
    if all(auth.get(key) == value for key, value in patch.items()):
        return "AUTH_EMAIL_TEMPLATES=UNCHANGED"
    headers["Content-Type"] = "application/json"
    try:
        request = urllib.request.Request(url, data=json.dumps(patch).encode("utf-8"), headers=headers, method="PATCH")
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status not in (200, 204):
                raise BrandError("Auth template publication was not acknowledged")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        raise BrandError("Auth template publication failed; verify in dashboard") from None
    return "AUTH_EMAIL_TEMPLATES=PUBLISHED"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("check", "render-emails", "publish-emails"))
    parser.add_argument("--project-ref", default="")
    parser.add_argument("--approve-production-write", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "check":
            check_emails()
            css = render_site_css()
            if "https://" in css or "url(" in css:
                raise BrandError("external CSS dependency forbidden")
            print("ORDAX_BRAND_SSOT=PASS")
        elif args.command == "render-emails":
            render_emails()
            print("ORDAX_BRAND_EMAIL_RENDER=PASS")
        else:
            print(publish_emails(args.project_ref, allow_write=args.approve_production_write))
        return 0
    except (BrandError, OSError, UnicodeError) as exc:
        print(f"ORDAX_BRAND_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
