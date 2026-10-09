#!/usr/bin/env python3
"""Fail-closed activation preflight for the public OrdaX account surface.

Normal CI accepts a coherently disabled account surface and reports blockers.
Any partial activation while blockers remain is an error. --require-ready is a
release/operator check that succeeds only when every prerequisite has evidence
and all public account controls are enabled together.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Both public activation gates use one implementation of operator identity rules.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from legal_operator import operator_blockers

ROOT = Path(__file__).resolve().parents[2]

LEGAL = Path("docs/contracts/public-legal-readiness.json")
HARDENING = Path("docs/contracts/public-auth-hardening.json")
PROVIDER_POLICY = Path("docs/contracts/public-auth-provider-policy.json")
DEPLOYMENT = Path("docs/contracts/public-site-deployment.json")
IDENTITY = Path("docs/contracts/public-identity.json")
LIFECYCLE = Path("docs/contracts/account-lifecycle.json")
RUNTIME = Path("sites/public/config/public-site.json")
PUBLIC_SITE = Path("docs/contracts/public-site.json")
EDGE = Path("infra/supabase/functions/ordax-account-gateway/index.ts")
REFERENCE_GATEWAY = Path("services/public-identity/gateway.py")
LIFECYCLE_EDGE = Path("infra/supabase/functions/ordax-account-lifecycle/index.ts")

EDGE_BOOL = re.compile(
    r"^const\s+(PUBLIC_SITE_ACCOUNT_ENABLED|ACCOUNT_REGISTRATION_ENABLED|ACCOUNT_RECOVERY_REQUEST_ENABLED|"
    r"ACCOUNT_RECOVERY_COMPLETION_ENABLED|ACCOUNT_CLOSE_ENABLED)\s*=\s*(true|false);\s*$",
    re.MULTILINE,
)
PY_BOOL = re.compile(
    r"^(PUBLIC_SITE_ACCOUNT_ENABLED|ACCOUNT_REGISTRATION_ENABLED|ACCOUNT_RECOVERY_REQUEST_ENABLED|"
    r"ACCOUNT_RECOVERY_COMPLETION_ENABLED|ACCOUNT_CLOSE_ENABLED)\s*=\s*(True|False)\s*$",
    re.MULTILINE,
)


def load_json(root: Path, relative: Path) -> dict:
    value = json.loads((root / relative).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{relative}: json object required")
    return value


def source_switches(root: Path) -> dict[str, bool]:
    edge_text = (root / EDGE).read_text(encoding="utf-8")
    py_text = (root / REFERENCE_GATEWAY).read_text(encoding="utf-8")
    lifecycle_text = (root / LIFECYCLE_EDGE).read_text(encoding="utf-8")
    edge = {name: value == "true" for name, value in EDGE_BOOL.findall(edge_text)}
    python = {name: value == "True" for name, value in PY_BOOL.findall(py_text)}
    lifecycle = {name: value == "true" for name, value in EDGE_BOOL.findall(lifecycle_text)}
    names = (
        "PUBLIC_SITE_ACCOUNT_ENABLED",
        "ACCOUNT_REGISTRATION_ENABLED",
        "ACCOUNT_RECOVERY_REQUEST_ENABLED",
        "ACCOUNT_RECOVERY_COMPLETION_ENABLED",
        "ACCOUNT_CLOSE_ENABLED",
    )
    result: dict[str, bool] = {}
    for name in names:
        if name not in edge or name not in python:
            raise ValueError(f"missing activation switch: {name}")
        if edge[name] != python[name]:
            raise ValueError(f"edge/reference activation switch mismatch: {name}")
        if name == "ACCOUNT_CLOSE_ENABLED":
            if lifecycle.get(name) != edge[name]:
                raise ValueError(f"lifecycle/gateway activation switch mismatch: {name}")
        result[name] = edge[name]
    return result


def source_web_auth_only(root: Path) -> bool:
    # This is a narrowly scoped candidate, NOT approval of the entire public
    # Account MVP. Both implementations must agree or source validation fails.
    edge_text = (root / EDGE).read_text(encoding="utf-8")
    ref_text = (root / REFERENCE_GATEWAY).read_text(encoding="utf-8")
    edge = re.findall(r"^const PUBLIC_WEB_AUTH_ENABLED = (true|false);$", edge_text, re.MULTILINE)
    ref = re.findall(r"^PUBLIC_WEB_AUTH_ENABLED = (True|False)$", ref_text, re.MULTILINE)
    if len(edge) != 1 or len(ref) != 1 or (edge[0] == "true") != (ref[0] == "True"):
        raise ValueError("web-only-auth-switch-mismatch")
    if edge[0] == "true":
        # A positive source switch is not enough to enable every Account
        # surface. Check that the exact method/path admission exists.
        if "PUBLIC_WEB_AUTH_ROUTES.has(req.method + \" \" + path)" not in edge_text:
            raise ValueError("web-only-auth-route-gate-missing")
        if "PUBLIC_WEB_AUTH_ENABLED and (method, path) in PUBLIC_WEB_AUTH_ROUTES" not in ref_text:
            raise ValueError("web-only-auth-reference-gate-missing")
    return edge[0] == "true"


def readiness(root: Path) -> tuple[list[str], dict[str, bool]]:
    legal = load_json(root, LEGAL)
    hardening = load_json(root, HARDENING)
    provider_policy = load_json(root, PROVIDER_POLICY)
    deployment = load_json(root, DEPLOYMENT)
    identity = load_json(root, IDENTITY)
    lifecycle = load_json(root, LIFECYCLE)
    runtime = load_json(root, RUNTIME)
    public_site = load_json(root, PUBLIC_SITE)
    switches = source_switches(root)

    blockers: list[str] = []
    observation = hardening.get("current_observation", {})
    target = hardening.get("target", {})
    destination = hardening.get("postgresql_destination")
    adapter = deployment.get("adapter", {})
    vercel_adapter = deployment.get("vercel_adapter", {})
    public_edge_gateway = deployment.get("public_edge_gateway", {})
    routing = deployment.get("routing", {})
    backend = identity.get("backend", {})
    lifecycle_operations = lifecycle.get("operations", {})
    lifecycle_activation = lifecycle.get("activation", {})
    runtime_identity = runtime.get("identity", {})
    runtime_legal = runtime.get("legal", {})

    def need(condition: bool, code: str) -> None:
        if not condition:
            blockers.append(code)

    documents = legal.get("documents", {})
    privacy = documents.get("privacy", {})
    terms = documents.get("terms", {})
    registration_binding = legal.get("registration_binding", {})
    for operator_blocker in operator_blockers(legal.get("operator")):
        blockers.append(operator_blocker)
    need(legal.get("status") == "ready", "legal-status")
    need(legal.get("account_activation_ready") is True, "legal-account-activation")
    need(lifecycle.get("identity_owner") == "ordax-account-gateway", "account-lifecycle-owner")
    need(
        lifecycle_operations.get("account_close", {}).get("implemented") is True,
        "account-close-implementation",
    )
    need(
        lifecycle_operations.get("account_data_export", {}).get("implemented") is True,
        "account-data-export-implementation",
    )
    need(
        lifecycle_activation.get("public_login_may_open_before_account_close_implementation") is False,
        "account-close-gate-contract",
    )
    need(
        lifecycle_activation.get("public_login_may_open_before_data_export_implementation") is False,
        "account-export-gate-contract",
    )
    for name, document in (("privacy", privacy), ("terms", terms)):
        need(document.get("final") is True, f"{name}-final")
        need(bool(document.get("version")), f"{name}-version")
        need(bool(document.get("effective_date")), f"{name}-effective-date")

    need(registration_binding.get("policy_reviewed") is True, "registration-legal-policy-review")
    need(
        observation.get("registration_provider_bypass_guard_verified") is True,
        "registration-provider-bypass-guard",
    )
    need(
        observation.get("legacy_account_legal_receipt_reconciliation_verified") is True,
        "legacy-account-legal-receipt-reconciliation",
    )
    need(
        observation.get("public_login_legal_receipt_guard_deployed") is True,
        "public-login-legal-receipt-guard-deployment",
    )
    need(
        registration_binding.get("client_supplied_document_versions_trusted") is False,
        "registration-legal-client-version-trust",
    )
    need(
        registration_binding.get("server_authoritative_receipt_implemented") is True,
        "registration-legal-receipt",
    )
    need(registration_binding.get("web_registration_bound") is True, "registration-legal-web-binding")
    need(registration_binding.get("native_registration_bound") is True, "registration-legal-native-binding")
    need(
        registration_binding.get("registration_activation_allowed") is True,
        "registration-legal-activation",
    )
    need(switches["ACCOUNT_REGISTRATION_ENABLED"] is True, "account-registration-switch")

    need(hardening.get("status") == "ready", "auth-hardening-status")

    # A migration must not inherit signup/login proofs from the old provider.
    # The existing public-auth contract is the sole owner of these observations.
    # The candidate backend is not production-ready merely because its schema
    # contains the legal-receipt/rate-limit functions.
    if not isinstance(destination, dict):
        raise ValueError("postgresql_destination must be an object")
    destination_ref = destination.get("project_ref")
    target_ref = target.get("project_ref") if isinstance(target, dict) else None
    need(
        isinstance(destination_ref, str)
        and bool(destination_ref)
        and target_ref == destination_ref,
        "account-provider-cutover-target-mismatch",
    )
    for flag, blocker in (
        ("functional_provider_cutover_complete", "account-provider-cutover-incomplete"),
        ("public_account_gateway_deployed", "destination-account-gateway-deployment"),
        ("internal_gateway_runtime_e2e_verified", "destination-internal-gateway-runtime-proof"),
        ("destination_service_transport_runtime_verified", "destination-service-auth-transport-proof"),
        ("destination_vercel_oidc_binding_verified", "destination-vercel-oidc-project-binding"),
        ("destination_vercel_oidc_runtime_e2e_verified", "destination-vercel-oidc-runtime-proof"),
        ("active_legal_policy_present", "destination-active-legal-policy"),
        ("provider_settings_e2e_verified", "destination-provider-settings-proof"),
        ("public_auth_rate_limit_runtime_e2e_verified", "destination-auth-rate-limit-e2e-proof"),
        ("session_revocation_e2e_verified", "destination-session-revocation-proof"),
        ("recovery_e2e_verified", "destination-recovery-e2e-proof"),
        ("sync_export_db_boundary_proven", "destination-sync-export-db-proof"),
        ("account_export_runtime_e2e_verified", "destination-account-export-e2e-proof"),
        ("sync_runtime_e2e_verified", "destination-sync-runtime-e2e-proof"),
    ):
        need(destination.get(flag) is True, blocker)

    need(provider_policy.get("confirm_email_required") is True, "provider-policy-confirm-email")
    password_policy = provider_policy.get("password_policy", {})
    need(password_policy.get("product_minimum_chars") == 12, "provider-policy-password-floor")
    need(
        password_policy.get("provider_minimum_must_be_at_least_product") is True,
        "provider-policy-password-not-weaker",
    )
    redirect_policy = provider_policy.get("redirect_policy", {})
    need(redirect_policy.get("production_https_origin_required") is True, "provider-policy-https-origin")
    need(redirect_policy.get("same_origin_only") is True, "provider-policy-same-origin")
    need(redirect_policy.get("wildcards_allowed") is False, "provider-policy-no-wildcards")
    need(
        observation.get("provider_leaked_password_protection_enabled") is True,
        "provider-leaked-password-protection",
    )
    need(
        observation.get("product_leaked_password_protection_verified") is True,
        "product-leaked-password-protection",
    )
    need(observation.get("password_policy_reviewed") is True, "password-policy-review")
    need(
        observation.get("provider_password_policy_verified") is True,
        "provider-password-policy-verification",
    )
    need(observation.get("email_confirmation_policy_reviewed") is True, "email-confirmation-policy")
    need(
        observation.get("email_confirmation_provider_verified") is True,
        "email-confirmation-provider-verification",
    )
    need(observation.get("redirect_allowlist_reviewed") is True, "redirect-allowlist")
    need(
        observation.get("redirect_allowlist_provider_verified") is True,
        "redirect-allowlist-provider-verification",
    )
    need(observation.get("same_origin_session_owner_deployed") is True, "same-origin-session-owner")
    need(observation.get("secure_http_only_cookie_policy_verified") is True, "secure-cookie-policy")
    need(observation.get("csrf_state_change_protection_verified") is True, "csrf-protection")
    need(observation.get("auth_rate_limits_reviewed") is True, "auth-rate-limit-review")
    need(observation.get("bot_protection_widget_provisioned") is True, "bot-protection-widget")
    need(observation.get("bot_protection_source_server_verification") is True, "bot-protection-source-verification")
    need(observation.get("bot_protection_production_secret_configured") is True, "bot-protection-production-secret")
    need(observation.get("bot_protection_e2e_tested") is True, "bot-protection-e2e-proof")
    need(observation.get("public_adapter_rate_limit_deployed") is True, "public-rate-limit-deployment")
    need(observation.get("rate_limit_real_client_ip_forwarding_verified") is True, "real-client-ip-proof")
    need(observation.get("password_recovery_redirect_config_verified") is True, "recovery-redirect")
    need(observation.get("password_recovery_email_template_applied") is True, "recovery-email-template")
    need(observation.get("account_recovery_flow_tested") is True, "recovery-e2e-proof")
    need(observation.get("session_revocation_tested") is True, "session-revocation-proof")
    need(observation.get("privacy_terms_ready") is True, "privacy-terms-hardening-proof")

    need(public_edge_gateway.get("deployed") is True, "public-edge-gateway-deployment")
    need(public_edge_gateway.get("oidc_source_ready") is True, "public-edge-oidc-source")
    need(public_edge_gateway.get("oidc_deployed") is True, "public-edge-oidc-deployment")
    need(public_edge_gateway.get("runtime_provenance_e2e_verified") is True, "public-edge-provenance-proof")
    # Deployment is the SSOT for Vercel project identity, public hostname,
    # authoritative DNS and production availability. Auth's own OIDC proof is
    # necessary, but it must never override a mismatched site origin or a
    # recovery redirect still pointing to the previous team's domain.
    migration = deployment.get("vercel_migration", {})
    if not isinstance(migration, dict):
        raise ValueError("vercel_migration must be an object")
    target_domain = migration.get("target_canonical_domain")
    canonical_origin = (
        f"https://{target_domain}"
        if isinstance(target_domain, str)
        and re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])?", target_domain)
        and "." in target_domain
        else None
    )
    need(
        migration.get("target_project_provisioned") is True
        and destination.get("destination_vercel_public_project_found") is True
        and migration.get("target_team_id") == destination.get("destination_vercel_team_id")
        and migration.get("target_project") == destination.get("destination_vercel_public_project_name")
        and isinstance(migration.get("target_git_repository"), str)
        and migration["target_git_repository"].startswith(
            migration.get("target_github_organization", "") + "/"
        ),
        "vercel-canonical-project-identity",
    )
    need(migration.get("target_canonical_domain_verified") is True, "vercel-canonical-domain-ownership")
    need(migration.get("target_dns_apex_routing_cutover_verified") is True, "vercel-apex-dns-cutover")
    need(migration.get("target_www_domain_verified") is True, "vercel-www-domain-ownership")
    need(
        migration.get("target_www_domain_redirect_status") == 308
        and migration.get("target_www_domain") == f"www.{target_domain}",
        "vercel-www-canonical-redirect",
    )
    need(migration.get("target_project_production_deployment_ready") is True, "vercel-production-ready")
    need(migration.get("target_project_production_http_smoke_verified") is True, "vercel-production-http-proof")
    need(migration.get("target_project_environment_variables_present") is True, "vercel-production-environment")
    need(
        migration.get("target_project_production_public_account_routes_available") is True,
        "vercel-production-account-routes",
    )
    need(migration.get("target_runtime_oidc_e2e_verified") is True, "vercel-production-oidc-proof")
    need(
        canonical_origin is not None
        and vercel_adapter.get("canonical_public_origin") == canonical_origin
        and vercel_adapter.get("canonical_public_origin_live_configured") is True
        and vercel_adapter.get("canonical_public_origin_deployment_verified") is True,
        "vercel-canonical-origin-binding",
    )
    need(
        canonical_origin is not None and redirect_policy.get("origin") == canonical_origin,
        "provider-redirect-canonical-origin",
    )
    need(
        canonical_origin is not None
        and redirect_policy.get("recovery_verify_url")
        == canonical_origin + "/auth/recover/verify",
        "provider-recovery-canonical-origin",
    )
    # Browser widget target, edge host allowlist and production URL must agree.
    # Hostname intent alone does not prove the Cloudflare widget was updated;
    # keep independent provider-side and runtime proof requirements.
    turnstile = public_site.get("identity", {}).get("turnstile", {})
    bot = deployment.get("bot_protection", {})
    need(
        isinstance(bot, dict) and isinstance(turnstile, dict)
        and isinstance(target_domain, str)
        and bot.get("hostname_allowlist") == [target_domain]
        and turnstile.get("hostname") == target_domain,
        "turnstile-canonical-hostname-binding",
    )
    need(
        isinstance(bot, dict) and bot.get("production_hostname_verified") is True,
        "turnstile-canonical-hostname-provider-proof",
    )
    need(
        isinstance(bot, dict) and bot.get("production_e2e_verified") is True,
        "turnstile-canonical-runtime-proof",
    )

    need(vercel_adapter.get("status") == "deployed", "vercel-same-origin-adapter-deployment")
    need(routing.get("vercel_adapter_routed_to_public_edge_gateway") is True, "vercel-public-edge-routing")
    need(adapter.get("public_auth_rate_limit_deployed") is True, "deployment-rate-limit")
    need(deployment.get("status") == "deployed", "same-origin-adapter-deployment")
    need(routing.get("same_origin_identity_required") is True, "same-origin-identity-contract")
    need(routing.get("gateway_public_activation_gate_required") is True, "server-activation-gate-contract")

    controls = {
        "runtime_account_ready": runtime_legal.get("account_activation_ready") is True,
        "runtime_login_route": runtime_identity.get("login_url") == "/auth/login",
        "runtime_register_route": runtime_identity.get("register_url") == "/auth/register",
        "runtime_recovery_route": runtime_identity.get("recovery_url") == "/auth/recover",
        "runtime_recovery_complete_route": (
            runtime_identity.get("recovery_complete_url") == "/auth/recover/complete"
        ),
        "identity_public_auth": backend.get("public_auth_enabled") is True,
        "identity_public_site_account": backend.get("public_site_account_enabled") is True,
        "deployment_public_gate": routing.get("gateway_public_activation_currently_enabled") is True,
        "edge_public_site_account": switches["PUBLIC_SITE_ACCOUNT_ENABLED"],
        "edge_account_registration": switches["ACCOUNT_REGISTRATION_ENABLED"],
        "edge_recovery_request": switches["ACCOUNT_RECOVERY_REQUEST_ENABLED"],
        "edge_recovery_completion": switches["ACCOUNT_RECOVERY_COMPLETION_ENABLED"],
        "edge_account_close": switches["ACCOUNT_CLOSE_ENABLED"],
    }
    return sorted(set(blockers)), controls


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", choices=("check", "require-ready"), default="check")
    parser.add_argument("--root", default=str(ROOT))
    args = parser.parse_args(argv)

    try:
        blockers, controls = readiness(Path(args.root).resolve())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"PUBLIC_AUTH_ACTIVATION_PREFLIGHT=FAIL reason={exc}", file=sys.stderr)
        return 1

    enabled = sorted(name for name, value in controls.items() if value)
    disabled = sorted(name for name, value in controls.items() if not value)
    try:
        auth_only = source_web_auth_only(Path(args.root).resolve())
    except (OSError, ValueError) as exc:
        print(f"PUBLIC_AUTH_ACTIVATION_PREFLIGHT=FAIL reason={exc}", file=sys.stderr)
        return 1

    # A source candidate may enable only the identity endpoints without
    # enabling sync, memory, export, recovery or the full public Account MVP.
    # Full-release checks and the require-ready command remain fail closed.
    if auth_only:
        if enabled:
            print("PUBLIC_AUTH_ACTIVATION_PREFLIGHT=UNSAFE_MIXED_AUTH_AND_MVP", file=sys.stderr)
            return 1
        if args.mode == "check":
            print("PUBLIC_AUTH_ACTIVATION_PREFLIGHT=AUTH_ONLY_SOURCE_CANDIDATE")
            print("PUBLIC_AUTH_OPERATIONAL_E2E_REQUIRED=true")
            return 0

    if enabled and disabled:
        print("PUBLIC_AUTH_ACTIVATION_PREFLIGHT=UNSAFE_PARTIAL_ACTIVATION", file=sys.stderr)
        for name in enabled:
            print(f"PUBLIC_AUTH_ENABLED_CONTROL={name}", file=sys.stderr)
        for name in disabled:
            print(f"PUBLIC_AUTH_DISABLED_CONTROL={name}", file=sys.stderr)
        for blocker in blockers:
            print(f"PUBLIC_AUTH_BLOCKER={blocker}", file=sys.stderr)
        return 1

    if enabled and blockers:
        print("PUBLIC_AUTH_ACTIVATION_PREFLIGHT=UNSAFE_BLOCKED_ACTIVATION", file=sys.stderr)
        for blocker in blockers:
            print(f"PUBLIC_AUTH_BLOCKER={blocker}", file=sys.stderr)
        return 1

    if args.mode == "require-ready":
        if blockers:
            print("PUBLIC_AUTH_ACTIVATION_PREFLIGHT=BLOCKED", file=sys.stderr)
            for blocker in blockers:
                print(f"PUBLIC_AUTH_BLOCKER={blocker}", file=sys.stderr)
            return 1
        if disabled:
            print("PUBLIC_AUTH_ACTIVATION_PREFLIGHT=READY_NOT_ACTIVATED", file=sys.stderr)
            for name in disabled:
                print(f"PUBLIC_AUTH_DISABLED_CONTROL={name}", file=sys.stderr)
            return 2
        print("PUBLIC_AUTH_ACTIVATION_PREFLIGHT=READY_ACTIVE")
        return 0

    if disabled:
        print("PUBLIC_AUTH_ACTIVATION_PREFLIGHT=SAFE_DISABLED")
        print(f"PUBLIC_AUTH_BLOCKER_COUNT={len(blockers)}")
        for blocker in blockers:
            print(f"PUBLIC_AUTH_BLOCKER={blocker}")
        return 0

    print("PUBLIC_AUTH_ACTIVATION_PREFLIGHT=READY_ACTIVE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
