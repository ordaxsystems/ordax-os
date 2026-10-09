"""OrdaX same-origin identity and account-sync gateway.

Browser credentials and provider bearer tokens remain inside HttpOnly cookies.
The public Surface talks only to OrdaX-owned /auth/* and /sync/* routes; Supabase
is a replaceable provider adapter behind that boundary.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from http.cookies import SimpleCookie
from typing import Mapping
from urllib.parse import parse_qs, urlsplit

from memory_entitlements import AccountMemoryEntitlementAuthority
from pwned_passwords import PwnedPasswordChecker, PwnedPasswordsError
from supabase_account import SupabaseAccountError, SupabaseAccountProvider
from supabase_lifecycle import (
    CLOSE_CONFIRMATION,
    SupabaseLifecycleError,
    SupabaseLifecycleProvider,
)
from supabase_memory import SupabaseMemoryError, SupabaseMemoryProvider
from supabase_password import (
    MAX_REGISTRATION_PASSWORD_CHARS,
    MIN_REGISTRATION_PASSWORD_CHARS,
    SupabaseIdentityError,
    SupabasePasswordProvider,
)
from supabase_registration_legal import (
    RegistrationLegalError,
    SupabaseRegistrationLegalAuthority,
)
from supabase_sync import SupabaseSyncError, SupabaseSyncProvider

SESSION_SCHEMA = "prototype-ordax.public-identity-session/1"
REGISTRATION_POLICY_SCHEMA = "prototype-ordax.registration-legal-policy/1"
ACCOUNT_SPACES_SCHEMA = "prototype-ordax.account-spaces/1"
SYNC_BATCH_SCHEMA = "prototype-ordax.sync-batch/1"
SYNC_SNAPSHOT_SCHEMA = "prototype-ordax.sync-snapshot/1"
SYNC_CHANGES_SCHEMA = "prototype-ordax.sync-changes/1"
SYNC_ACK_SCHEMA = "prototype-ordax.sync-ack/1"
ERROR_SCHEMA = "prototype-ordax.public-identity-error/1"
JSON_CONTENT_TYPE = "application/json; charset=utf-8"
NO_STORE = "no-store, max-age=0"
MAX_REQUEST_BODY = 64 * 1024
ACCESS_COOKIE = "ordax_access"
REFRESH_COOKIE = "ordax_refresh"
RECOVERY_COOKIE = "ordax_recovery"
RECOVERY_ACCESS_COOKIE = "ordax_recovery_access"
RECOVERY_REFRESH_COOKIE = "ordax_recovery_refresh"
RECOVERY_SESSION_MAX_AGE = 10 * 60
PUBLIC_SITE_ACCOUNT_ENABLED = True
ACCOUNT_REGISTRATION_ENABLED = True
LEGAL_ACCEPTANCE_FIELD = "legal_acceptance"
LEGAL_ACCEPTANCE_VALUE = "accepted"
ACCOUNT_CLOSE_ENABLED = False
ACCOUNT_RECOVERY_REQUEST_ENABLED = False
ACCOUNT_RECOVERY_COMPLETION_ENABLED = False
PUBLIC_SITE_MARKER_HEADER = "x-ordax-public-site"
SYNC_DATA_CLASSES = frozenset((
    "appearance",
    "preferences",
    "workspace-metadata",
    "app-state-metadata",
    "user-selected-cloud-content",
))


@dataclass(frozen=True)
class GatewayResponse:
    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes


def _provider_config() -> tuple[str, str] | None:
    project_url = os.environ.get("ORDAX_SUPABASE_URL", "").strip()
    publishable_key = os.environ.get("ORDAX_SUPABASE_PUBLISHABLE_KEY", "").strip()
    if not project_url or not publishable_key:
        return None
    return project_url, publishable_key


def _provider_from_environment() -> SupabasePasswordProvider | None:
    config = _provider_config()
    if config is None:
        return None
    try:
        return SupabasePasswordProvider(*config)
    except (TypeError, ValueError):
        return None


def _registration_legal_authority_from_environment() -> SupabaseRegistrationLegalAuthority | None:
    project_url = os.environ.get("ORDAX_SUPABASE_URL", "").strip()
    secret_key = os.environ.get("ORDAX_SUPABASE_SECRET_KEY", "").strip()
    if not project_url or not secret_key:
        return None
    try:
        return SupabaseRegistrationLegalAuthority(project_url, secret_key)
    except (TypeError, ValueError):
        return None


def _sync_provider_from_environment() -> SupabaseSyncProvider | None:
    config = _provider_config()
    if config is None:
        return None
    try:
        return SupabaseSyncProvider(*config)
    except (TypeError, ValueError):
        return None


def _account_provider_from_environment() -> SupabaseAccountProvider | None:
    config = _provider_config()
    if config is None:
        return None
    try:
        return SupabaseAccountProvider(*config)
    except (TypeError, ValueError):
        return None


def _lifecycle_provider_from_environment() -> SupabaseLifecycleProvider | None:
    config = _provider_config()
    if config is None:
        return None
    try:
        return SupabaseLifecycleProvider(*config)
    except (TypeError, ValueError):
        return None


def _memory_provider_from_environment() -> SupabaseMemoryProvider | None:
    config = _provider_config()
    if config is None:
        return None
    try:
        return SupabaseMemoryProvider(*config)
    except (TypeError, ValueError):
        return None


def _recovery_redirect_from_environment() -> str | None:
    value = os.environ.get("ORDAX_ACCOUNT_RECOVERY_REDIRECT_URL", "").strip()
    if not value:
        return None
    split = urlsplit(value)
    if (
        split.scheme != "https"
        or not split.netloc
        or split.username is not None
        or split.password is not None
        or split.query
        or split.fragment
    ):
        return None
    return f"https://{split.netloc}{split.path or '/'}"


def _secure_cookies() -> bool:
    return os.environ.get("ORDAX_IDENTITY_SECURE_COOKIES", "1") != "0"


def _cookie(name: str, value: str, *, max_age: int, path: str = "/") -> str:
    if path not in ("/", "/auth/recover"):
        raise ValueError("unsupported-cookie-path")
    parts = [
        f"{name}={value}",
        f"Path={path}",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={max_age}",
    ]
    if _secure_cookies():
        parts.append("Secure")
    return "; ".join(parts)


def _clear_cookie(name: str) -> str:
    return _cookie(name, "", max_age=0)


def _recovery_cookies(
    access_token: str,
    refresh_token: str,
    expires_in: int,
) -> tuple[str, str, str]:
    max_age = max(1, min(int(expires_in), RECOVERY_SESSION_MAX_AGE))
    return (
        _cookie(RECOVERY_ACCESS_COOKIE, access_token, max_age=max_age, path="/auth/recover"),
        _cookie(RECOVERY_REFRESH_COOKIE, refresh_token, max_age=max_age, path="/auth/recover"),
        _cookie(RECOVERY_COOKIE, "1", max_age=max_age, path="/auth/recover"),
    )


def _clear_recovery_cookies() -> tuple[str, str, str]:
    return (
        _cookie(RECOVERY_ACCESS_COOKIE, "", max_age=0, path="/auth/recover"),
        _cookie(RECOVERY_REFRESH_COOKIE, "", max_age=0, path="/auth/recover"),
        _cookie(RECOVERY_COOKIE, "", max_age=0, path="/auth/recover"),
    )


def _session_cookies(access_token: str, refresh_token: str, expires_in: int) -> tuple[str, str]:
    return (
        _cookie(ACCESS_COOKIE, access_token, max_age=max(60, int(expires_in))),
        _cookie(REFRESH_COOKIE, refresh_token, max_age=60 * 60 * 24 * 30),
    )


def _read_cookies(cookie_header: str | None) -> dict[str, str]:
    if not cookie_header:
        return {}
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except Exception:
        return {}
    return {key: morsel.value for key, morsel in cookie.items()}


def _json_response(
    status: int,
    payload: Mapping[str, object],
    *,
    set_cookies: tuple[str, ...] = (),
) -> GatewayResponse:
    body = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    headers: list[tuple[str, str]] = [
        ("Content-Type", JSON_CONTENT_TYPE),
        ("Cache-Control", NO_STORE),
        ("Pragma", "no-cache"),
        ("X-Content-Type-Options", "nosniff"),
        ("Content-Length", str(len(body))),
    ]
    for cookie in set_cookies:
        headers.append(("Set-Cookie", cookie))
    return GatewayResponse(status=status, headers=tuple(headers), body=body)


def _redirect(location: str, *, set_cookies: tuple[str, ...] = ()) -> GatewayResponse:
    headers: list[tuple[str, str]] = [
        ("Location", location),
        ("Cache-Control", NO_STORE),
        ("Pragma", "no-cache"),
        ("Content-Length", "0"),
    ]
    for cookie in set_cookies:
        headers.append(("Set-Cookie", cookie))
    return GatewayResponse(status=303, headers=tuple(headers), body=b"")


def _error(status: int, code: str, message: str) -> GatewayResponse:
    return _json_response(
        status,
        {"$schema": ERROR_SCHEMA, "error": code, "message": message},
    )


def _public_site_request(headers: Mapping[str, str]) -> bool:
    return headers.get(PUBLIC_SITE_MARKER_HEADER, "") == "1"


def _public_site_disabled_response(method: str, path: str) -> GatewayResponse | None:
    if PUBLIC_SITE_ACCOUNT_ENABLED:
        return None
    if path == "/auth/login" and method == "GET":
        return _redirect("/login/")
    if path == "/auth/register" and method == "GET":
        return _redirect("/cadastro/")
    if path == "/auth/logout" and method == "POST":
        return _redirect(
            "/",
            set_cookies=(
                _clear_cookie(ACCESS_COOKIE),
                _clear_cookie(REFRESH_COOKIE),
                *_clear_recovery_cookies(),
            ),
        )
    if path == "/auth/registration-policy" and method == "GET":
        # Public-site registration remains fail-closed, but policy discovery is
        # safe read-only metadata required before registration can ever open.
        return None
    if path == "/auth/session" and method == "GET":
        return _json_response(
            200,
            {
                "$schema": SESSION_SCHEMA,
                "authenticated": False,
                "provider": "gated",
                "status": "anonymous",
                "accountCloseEnabled": False,
            },
            set_cookies=(
                _clear_cookie(ACCESS_COOKIE),
                _clear_cookie(REFRESH_COOKIE),
                *_clear_recovery_cookies(),
            ),
        )
    if path.startswith("/auth/") or path.startswith("/sync/") or path.startswith("/account/"):
        return _error(
            503,
            "public-account-access-disabled",
            "O acesso público à Conta OrdaX ainda não foi ativado.",
        )
    return None


def _form(body: bytes, content_type: str) -> dict[str, str]:
    if len(body) > MAX_REQUEST_BODY:
        raise ValueError("request-too-large")
    if not content_type.lower().startswith("application/x-www-form-urlencoded"):
        raise ValueError("unsupported-content-type")
    try:
        values = parse_qs(body.decode("utf-8"), keep_blank_values=True, strict_parsing=False)
    except (UnicodeError, ValueError) as exc:
        raise ValueError("invalid-form") from exc
    return {key: items[-1] for key, items in values.items() if items}


def _json_body(body: bytes, content_type: str) -> dict:
    if len(body) > MAX_REQUEST_BODY:
        raise ValueError("request-too-large")
    if not content_type.lower().startswith("application/json"):
        raise ValueError("unsupported-content-type")
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid-json") from exc
    if not isinstance(value, dict):
        raise ValueError("json-object-required")
    return value


def _same_origin_state_change(headers: Mapping[str, str]) -> bool:
    if headers.get("sec-fetch-site") == "cross-site":
        return False
    origin = headers.get("origin")
    host = headers.get("host")
    if not origin or not host:
        return True
    split = urlsplit(origin)
    return split.netloc == host and split.scheme in ("https", "http")


class PublicIdentityGateway:
    def __init__(
        self,
        provider: SupabasePasswordProvider | None = None,
        sync_provider: SupabaseSyncProvider | None = None,
        account_provider: SupabaseAccountProvider | None = None,
        lifecycle_provider: SupabaseLifecycleProvider | None = None,
        memory_provider: SupabaseMemoryProvider | None = None,
        password_checker: PwnedPasswordChecker | None = None,
        registration_legal_authority: SupabaseRegistrationLegalAuthority | None = None,
    ) -> None:
        self.provider = provider if provider is not None else _provider_from_environment()
        self.sync_provider = (
            sync_provider if sync_provider is not None else _sync_provider_from_environment()
        )
        self.account_provider = (
            account_provider if account_provider is not None else _account_provider_from_environment()
        )
        self.lifecycle_provider = (
            lifecycle_provider
            if lifecycle_provider is not None
            else _lifecycle_provider_from_environment()
        )
        self.memory_provider = (
            memory_provider if memory_provider is not None else _memory_provider_from_environment()
        )
        self.password_checker = password_checker or PwnedPasswordChecker()
        self.registration_legal_authority = (
            registration_legal_authority
            if registration_legal_authority is not None
            else _registration_legal_authority_from_environment()
        )

    @property
    def provider_configured(self) -> bool:
        return self.provider is not None

    def _provider_unavailable(self) -> GatewayResponse:
        return _error(
            503,
            "identity-provider-unavailable",
            "O serviço de identidade OrdaX ainda não está configurado.",
        )

    def _authenticated_access(
        self, request_headers: Mapping[str, str]
    ) -> tuple[str | None, tuple[str, ...]]:
        if not self.provider:
            return None, ()
        cookies = _read_cookies(request_headers.get("cookie"))
        access = cookies.get(ACCESS_COOKIE)
        refresh = cookies.get(REFRESH_COOKIE)
        if access:
            try:
                self.provider.get_user(access)
                return access, ()
            except SupabaseIdentityError:
                pass
        if refresh:
            try:
                session = self.provider.refresh_session(refresh)
                self.provider.get_user(session.access_token)
                return (
                    session.access_token,
                    _session_cookies(
                        session.access_token,
                        session.refresh_token,
                        session.expires_in,
                    ),
                )
            except SupabaseIdentityError:
                pass
        return None, (_clear_cookie(ACCESS_COOKIE), _clear_cookie(REFRESH_COOKIE))

    def _authenticated_recovery_access(
        self, request_headers: Mapping[str, str]
    ) -> tuple[str | None, tuple[str, ...]]:
        if not self.provider:
            return None, ()
        cookies = _read_cookies(request_headers.get("cookie"))
        if cookies.get(RECOVERY_COOKIE) != "1":
            return None, _clear_recovery_cookies()
        access = cookies.get(RECOVERY_ACCESS_COOKIE)
        refresh = cookies.get(RECOVERY_REFRESH_COOKIE)
        if access:
            try:
                self.provider.get_user(access)
                return access, ()
            except SupabaseIdentityError:
                pass
        if refresh:
            try:
                session = self.provider.refresh_session(refresh)
                self.provider.get_user(session.access_token)
                return (
                    session.access_token,
                    _recovery_cookies(
                        session.access_token,
                        session.refresh_token,
                        session.expires_in,
                    ),
                )
            except SupabaseIdentityError:
                pass
        return None, _clear_recovery_cookies()

    def _session(self, request_headers: Mapping[str, str]) -> GatewayResponse:
        if not self.provider:
            return _json_response(
                200,
                {
                    "$schema": SESSION_SCHEMA,
                    "authenticated": False,
                    "provider": "unconfigured",
                    "status": "anonymous",
                    "accountCloseEnabled": False,
                },
            )

        access, set_cookies = self._authenticated_access(request_headers)
        if access:
            try:
                subject, email = self.provider.get_user(access)
                return _json_response(
                    200,
                    {
                        "$schema": SESSION_SCHEMA,
                        "authenticated": True,
                        "provider": "supabase",
                        "status": "authenticated",
                        "subject": subject,
                        "email": email,
                        "accountCloseEnabled": ACCOUNT_CLOSE_ENABLED,
                    },
                    set_cookies=set_cookies,
                )
            except SupabaseIdentityError:
                pass

        return _json_response(
            200,
            {
                "$schema": SESSION_SCHEMA,
                "authenticated": False,
                "provider": "supabase",
                "status": "anonymous",
                "accountCloseEnabled": False,
            },
            set_cookies=set_cookies,
        )

    def _screen_new_password(self, password: str) -> GatewayResponse | None:
        if (
            not isinstance(password, str)
            or len(password) < MIN_REGISTRATION_PASSWORD_CHARS
            or len(password) > MAX_REGISTRATION_PASSWORD_CHARS
            or "\x00" in password
        ):
            return _error(
                400,
                "password-policy",
                "Use uma senha com pelo menos 12 caracteres.",
            )
        try:
            compromised = self.password_checker.is_compromised(password)
        except (ValueError, PwnedPasswordsError):
            return _error(
                503,
                "password-screening-unavailable",
                "A validação de segurança da senha está temporariamente indisponível.",
            )
        if compromised:
            return _error(
                400,
                "compromised-password",
                "Escolha outra senha; esta senha aparece em bases públicas de credenciais comprometidas.",
            )
        return None

    def _registration_policy(self) -> GatewayResponse:
        if self.registration_legal_authority is None:
            return _error(
                503,
                "registration-legal-policy-unavailable",
                "A política legal de cadastro ainda não está disponível.",
            )
        try:
            policy = self.registration_legal_authority.active_policy()
        except RegistrationLegalError:
            return _error(
                503,
                "registration-legal-policy-unavailable",
                "A política legal de cadastro ainda não está disponível.",
            )
        return _json_response(
            200,
            {
                "$schema": REGISTRATION_POLICY_SCHEMA,
                "active": True,
                "registrationEnabled": ACCOUNT_REGISTRATION_ENABLED,
                "policyId": policy.policy_id,
                "privacy": {
                    "version": policy.privacy_version,
                    "effectiveDate": policy.privacy_effective_date,
                    "sha256": policy.privacy_sha256,
                    "url": policy.privacy_url,
                },
                "terms": {
                    "version": policy.terms_version,
                    "effectiveDate": policy.terms_effective_date,
                    "sha256": policy.terms_sha256,
                    "url": policy.terms_url,
                },
            },
        )

    def _credentials_action(
        self,
        *,
        registration: bool,
        request_headers: Mapping[str, str],
        body: bytes,
    ) -> GatewayResponse:
        if registration and not ACCOUNT_REGISTRATION_ENABLED:
            return _error(
                503,
                "account-registration-disabled",
                "A criação de Conta OrdaX ainda não foi ativada.",
            )
        if not self.provider:
            return self._provider_unavailable()
        if not _same_origin_state_change(request_headers):
            return _error(403, "cross-site-request-rejected", "A solicitação cross-site foi rejeitada.")
        try:
            form = _form(body, request_headers.get("content-type", ""))
            email = form.get("email", "")
            password = form.get("password", "")
            if registration:
                if form.get(LEGAL_ACCEPTANCE_FIELD, "") != LEGAL_ACCEPTANCE_VALUE:
                    return _error(
                        400,
                        "legal-acceptance-required",
                        "É necessário aceitar os documentos legais vigentes para criar a Conta OrdaX.",
                    )
                screening = self._screen_new_password(password)
                if screening is not None:
                    return screening
                if self.registration_legal_authority is None:
                    return _error(
                        503,
                        "registration-legal-policy-unavailable",
                        "A política legal de cadastro ainda não está disponível.",
                    )
                try:
                    intent = self.registration_legal_authority.begin_intent(email)
                except RegistrationLegalError:
                    return _error(
                        503,
                        "registration-legal-policy-unavailable",
                        "A política legal de cadastro ainda não está disponível.",
                    )
                result = self.provider.sign_up_with_password(
                    email,
                    password,
                    registration_intent_id=intent.intent_id,
                )
            else:
                result = self.provider.sign_in_with_password(email, password)
        except ValueError:
            return _error(400, "invalid-credentials-form", "Revise o e-mail e a senha informados.")
        except SupabaseIdentityError:
            return _error(
                401 if not registration else 400,
                "authentication-failed" if not registration else "registration-failed",
                "Não foi possível concluir esta operação de conta.",
            )

        if result.session is None:
            return _redirect("/login/?cadastro=verifique-email")

        if not registration and _public_site_request(request_headers):
            if self.registration_legal_authority is None:
                try:
                    self.provider.sign_out_local(result.session.access_token)
                except SupabaseIdentityError:
                    pass
                return _error(
                    503,
                    "account-legal-receipt-check-unavailable",
                    "A validação da Conta OrdaX está temporariamente indisponível.",
                )
            try:
                has_receipt = self.registration_legal_authority.has_registration_receipt(
                    result.subject_id
                )
            except RegistrationLegalError:
                try:
                    self.provider.sign_out_local(result.session.access_token)
                except SupabaseIdentityError:
                    pass
                return _error(
                    503,
                    "account-legal-receipt-check-unavailable",
                    "A validação da Conta OrdaX está temporariamente indisponível.",
                )
            if not has_receipt:
                try:
                    self.provider.sign_out_local(result.session.access_token)
                except SupabaseIdentityError:
                    pass
                return _error(
                    403,
                    "account-legal-receipt-required",
                    "Esta conta precisa ser reconciliada antes do acesso público.",
                )

        return _redirect(
            "/conta/",
            set_cookies=_session_cookies(
                result.session.access_token,
                result.session.refresh_token,
                result.session.expires_in,
            ),
        )

    def _recovery_action(
        self,
        request_headers: Mapping[str, str],
        body: bytes,
    ) -> GatewayResponse:
        if not ACCOUNT_RECOVERY_REQUEST_ENABLED:
            return _error(
                503,
                "account-recovery-disabled",
                "A recuperação da Conta OrdaX ainda não foi ativada.",
            )
        if not self.provider:
            return self._provider_unavailable()
        redirect_to = _recovery_redirect_from_environment()
        if redirect_to is None:
            return _error(
                503,
                "account-recovery-unavailable",
                "A recuperação da Conta OrdaX ainda não está configurada.",
            )
        if not _same_origin_state_change(request_headers):
            return _error(
                403,
                "cross-site-request-rejected",
                "A solicitação cross-site foi rejeitada.",
            )
        try:
            form = _form(body, request_headers.get("content-type", ""))
            email = form.get("email", "")
            self.provider.request_password_recovery(email, redirect_to)
        except ValueError:
            return _error(
                400,
                "invalid-recovery-form",
                "Revise o e-mail informado.",
            )
        except SupabaseIdentityError as exc:
            if exc.status == 429:
                return _error(
                    429,
                    "account-recovery-rate-limited",
                    "Tente novamente mais tarde.",
                )
            if exc.status is None or exc.status >= 500:
                return _error(
                    503,
                    "account-recovery-unavailable",
                    "A recuperação da Conta OrdaX está temporariamente indisponível.",
                )
        return _json_response(
            202,
            {
                "recoveryRequested": True,
                "message": "Se a conta puder ser recuperada, as instruções serão enviadas por e-mail.",
            },
        )

    def _recovery_verify(
        self,
        request_headers: Mapping[str, str],
        query: str,
    ) -> GatewayResponse:
        if not ACCOUNT_RECOVERY_COMPLETION_ENABLED:
            return _error(
                503,
                "account-recovery-completion-disabled",
                "A conclusão da recuperação da Conta OrdaX ainda não foi ativada.",
            )
        if not self.provider:
            return self._provider_unavailable()
        values = parse_qs(query, keep_blank_values=False)
        token_hash = values.get("token_hash", [""])[-1]
        recovery_type = values.get("type", [""])[-1]
        if recovery_type != "recovery":
            return _error(
                400,
                "invalid-recovery-link",
                "O link de recuperação é inválido ou expirou.",
            )
        try:
            session = self.provider.verify_recovery_token(token_hash)
        except (ValueError, SupabaseIdentityError):
            return _error(
                400,
                "invalid-recovery-link",
                "O link de recuperação é inválido ou expirou.",
            )
        return _redirect(
            "/recuperar/nova-senha/",
            set_cookies=(
                _clear_cookie(ACCESS_COOKIE),
                _clear_cookie(REFRESH_COOKIE),
                *_recovery_cookies(
                    session.access_token,
                    session.refresh_token,
                    min(session.expires_in, RECOVERY_SESSION_MAX_AGE),
                ),
            ),
        )

    def _recovery_complete(
        self,
        request_headers: Mapping[str, str],
        body: bytes,
    ) -> GatewayResponse:
        if not ACCOUNT_RECOVERY_COMPLETION_ENABLED:
            return _error(
                503,
                "account-recovery-completion-disabled",
                "A conclusão da recuperação da Conta OrdaX ainda não foi ativada.",
            )
        if not self.provider:
            return self._provider_unavailable()
        if not _same_origin_state_change(request_headers):
            return _error(
                403,
                "cross-site-request-rejected",
                "A solicitação cross-site foi rejeitada.",
            )
        access, refreshed_cookies = self._authenticated_recovery_access(request_headers)
        if not access:
            return _json_response(
                401,
                {
                    "$schema": ERROR_SCHEMA,
                    "error": "recovery-session-required",
                    "message": "Inicie novamente a recuperação da Conta OrdaX.",
                },
                set_cookies=(
                    *refreshed_cookies,
                ),
            )
        try:
            form = _form(body, request_headers.get("content-type", ""))
            password = form.get("password", "")
            confirmation = form.get("password_confirmation", "")
            if password != confirmation:
                raise ValueError("password-confirmation-mismatch")
            screening = self._screen_new_password(password)
            if screening is not None:
                return screening
            self.provider.update_password(access, password)
        except ValueError:
            return _error(
                400,
                "recovery-password-policy",
                "Use uma senha válida e confirme exatamente o mesmo valor.",
            )
        except SupabaseIdentityError as exc:
            if exc.status == 429:
                return _error(
                    429,
                    "account-recovery-rate-limited",
                    "Tente novamente mais tarde.",
                )
            return _error(
                503,
                "account-recovery-unavailable",
                "Não foi possível concluir a recuperação da Conta OrdaX.",
            )
        try:
            self.provider.sign_out(access)
        except SupabaseIdentityError:
            pass
        return _redirect(
            "/login/?recuperacao=concluida",
            set_cookies=(
                _clear_cookie(ACCESS_COOKIE),
                _clear_cookie(REFRESH_COOKIE),
                *_clear_recovery_cookies(),
            ),
        )

    def _account_close(
        self,
        request_headers: Mapping[str, str],
        body: bytes,
    ) -> GatewayResponse:
        if not ACCOUNT_CLOSE_ENABLED:
            return _error(
                503,
                "account-close-disabled",
                "O fechamento da Conta OrdaX ainda não está ativado.",
            )
        if not self.provider or not self.lifecycle_provider:
            return self._provider_unavailable()
        if not _same_origin_state_change(request_headers):
            return _error(
                403,
                "cross-site-request-rejected",
                "A solicitação cross-site foi rejeitada.",
            )

        access, set_cookies = self._authenticated_access(request_headers)
        if not access:
            return _json_response(
                401,
                {
                    "$schema": ERROR_SCHEMA,
                    "error": "authentication-required",
                    "message": "Entre novamente na Conta OrdaX.",
                },
                set_cookies=set_cookies,
            )

        try:
            form = _form(body, request_headers.get("content-type", ""))
            password = form.get("password", "")
            confirmation = form.get("confirmation", "")
            if confirmation != CLOSE_CONFIRMATION:
                raise ValueError("account-close-confirmation-required")
            _, email = self.provider.get_user(access)
            result = self.provider.sign_in_with_password(email, password)
            if result.session is None:
                raise SupabaseIdentityError("provider-session-missing")
            self.lifecycle_provider.close_account(
                result.session.access_token,
                confirmation,
            )
        except ValueError:
            return _error(
                400,
                "account-close-confirmation-required",
                "Confirmação explícita e senha atual são obrigatórias.",
            )
        except SupabaseIdentityError:
            return _error(
                401,
                "recent-authentication-required",
                "Confirme sua senha atual para fechar a conta.",
            )
        except SupabaseLifecycleError as exc:
            if exc.status == 401:
                return _error(
                    401,
                    "recent-authentication-required",
                    "Reautenticação recente obrigatória.",
                )
            if exc.status == 409:
                return _error(
                    409,
                    "account-close-blocked",
                    "Não foi possível concluir o fechamento da conta.",
                )
            return _error(
                503,
                "account-close-unavailable",
                "O serviço de fechamento está indisponível.",
            )

        return _redirect(
            "/",
            set_cookies=(
                _clear_cookie(ACCESS_COOKIE),
                _clear_cookie(REFRESH_COOKIE),
                *_clear_recovery_cookies(),
            ),
        )

    def _account_export(
        self,
        request_headers: Mapping[str, str],
    ) -> GatewayResponse:
        if not self.provider or not self.account_provider:
            return self._provider_unavailable()
        access, set_cookies = self._authenticated_access(request_headers)
        if not access:
            return _json_response(
                401,
                {
                    "$schema": ERROR_SCHEMA,
                    "error": "authentication-required",
                    "message": "Entre na Conta OrdaX para exportar seus dados.",
                },
                set_cookies=set_cookies,
            )
        try:
            export = self.account_provider.export_account(access)
        except (ValueError, SupabaseAccountError):
            return _error(
                502,
                "account-export-failed",
                "Não foi possível gerar a exportação da Conta OrdaX.",
            )
        return _json_response(200, export, set_cookies=set_cookies)

    def _account_spaces(
        self,
        request_headers: Mapping[str, str],
    ) -> GatewayResponse:
        if not self.provider or not self.account_provider:
            return self._provider_unavailable()
        access, set_cookies = self._authenticated_access(request_headers)
        if not access:
            return _json_response(
                401,
                {
                    "$schema": ERROR_SCHEMA,
                    "error": "authentication-required",
                    "message": "Entre na Conta OrdaX para ver seus Spaces.",
                },
                set_cookies=set_cookies,
            )
        try:
            spaces = self.account_provider.list_spaces(access)
        except (ValueError, SupabaseAccountError):
            return _error(
                502,
                "spaces-read-failed",
                "Não foi possível ler seus Spaces.",
            )
        return _json_response(
            200,
            {"$schema": ACCOUNT_SPACES_SCHEMA, "spaces": spaces},
            set_cookies=set_cookies,
        )

    def _account_memory_entitlement(
        self,
        request_headers: Mapping[str, str],
    ) -> GatewayResponse:
        if not self.provider or not self.memory_provider:
            return self._provider_unavailable()
        access, set_cookies = self._authenticated_access(request_headers)
        if not access:
            return _json_response(
                401,
                {
                    "$schema": ERROR_SCHEMA,
                    "error": "authentication-required",
                    "message": "Entre na Conta OrdaX para consultar este entitlement.",
                },
                set_cookies=set_cookies,
            )
        try:
            decision = AccountMemoryEntitlementAuthority(
                self.provider,
                self.memory_provider,
            ).resolve(access)
        except (TypeError, ValueError, SupabaseIdentityError, SupabaseMemoryError):
            return _error(
                502,
                "memory-entitlement-read-failed",
                "Não foi possível consultar o entitlement de Memory.",
            )
        return _json_response(200, decision, set_cookies=set_cookies)

    def _sync_snapshot(
        self,
        request_headers: Mapping[str, str],
        query: str,
    ) -> GatewayResponse:
        if not self.provider or not self.sync_provider:
            return self._provider_unavailable()
        access, set_cookies = self._authenticated_access(request_headers)
        if not access:
            return _json_response(
                401,
                {"$schema": ERROR_SCHEMA, "error": "authentication-required", "message": "Entre na Conta OrdaX para sincronizar."},
                set_cookies=set_cookies,
            )
        try:
            values = parse_qs(query, keep_blank_values=False)
            limit = int(values.get("limit", ["200"])[-1])
            snapshot = self.sync_provider.snapshot(access, limit=limit)
        except ValueError:
            return _error(400, "invalid-sync-query", "Consulta de sincronização inválida.")
        except SupabaseSyncError:
            return _error(502, "sync-snapshot-failed", "Não foi possível ler o snapshot sincronizado.")
        return _json_response(
            200,
            {
                "$schema": SYNC_SNAPSHOT_SCHEMA,
                "cursor": snapshot["cursor"],
                "objects": snapshot["objects"],
            },
            set_cookies=set_cookies,
        )

    def _sync_changes(
        self,
        request_headers: Mapping[str, str],
        query: str,
    ) -> GatewayResponse:
        if not self.provider or not self.sync_provider:
            return self._provider_unavailable()
        access, set_cookies = self._authenticated_access(request_headers)
        if not access:
            return _json_response(
                401,
                {"$schema": ERROR_SCHEMA, "error": "authentication-required", "message": "Entre na Conta OrdaX para sincronizar."},
                set_cookies=set_cookies,
            )
        try:
            values = parse_qs(query, keep_blank_values=False)
            after_cursor = int(values.get("afterCursor", ["0"])[-1])
            limit = int(values.get("limit", ["200"])[-1])
            result = self.sync_provider.pull_changes(
                access, after_cursor=after_cursor, limit=limit
            )
        except ValueError:
            return _error(400, "invalid-sync-query", "Consulta de sincronização inválida.")
        except SupabaseSyncError:
            return _error(502, "sync-pull-failed", "Não foi possível ler as mudanças sincronizadas.")
        return _json_response(
            200,
            {
                "$schema": SYNC_CHANGES_SCHEMA,
                "afterCursor": result["afterCursor"],
                "nextCursor": result["nextCursor"],
                "changes": result["changes"],
            },
            set_cookies=set_cookies,
        )

    def _sync_list(
        self,
        request_headers: Mapping[str, str],
        query: str,
    ) -> GatewayResponse:
        if not self.provider or not self.sync_provider:
            return self._provider_unavailable()
        access, set_cookies = self._authenticated_access(request_headers)
        if not access:
            return _json_response(
                401,
                {"$schema": ERROR_SCHEMA, "error": "authentication-required", "message": "Entre na Conta OrdaX para sincronizar."},
                set_cookies=set_cookies,
            )
        try:
            values = parse_qs(query, keep_blank_values=False)
            after = int(values.get("afterRevision", ["0"])[-1])
            limit = int(values.get("limit", ["200"])[-1])
            objects = self.sync_provider.list_objects(
                access, after_revision=after, limit=limit
            )
        except (ValueError, SupabaseSyncError):
            return _error(502, "sync-read-failed", "Não foi possível ler o estado sincronizado.")
        return _json_response(
            200,
            {"$schema": SYNC_BATCH_SCHEMA, "objects": objects},
            set_cookies=set_cookies,
        )

    def _sync_mutate(
        self,
        request_headers: Mapping[str, str],
        body: bytes,
    ) -> GatewayResponse:
        if not self.provider or not self.sync_provider:
            return self._provider_unavailable()
        if not _same_origin_state_change(request_headers):
            return _error(403, "cross-site-request-rejected", "A solicitação cross-site foi rejeitada.")
        access, set_cookies = self._authenticated_access(request_headers)
        if not access:
            return _json_response(
                401,
                {"$schema": ERROR_SCHEMA, "error": "authentication-required", "message": "Entre na Conta OrdaX para sincronizar."},
                set_cookies=set_cookies,
            )
        try:
            mutation = _json_body(body, request_headers.get("content-type", ""))
            if mutation.get("$schema") != "ordax.sync-mutation/1":
                raise ValueError("unsupported-sync-mutation")
            if mutation.get("dataClass") not in SYNC_DATA_CLASSES:
                raise ValueError("unsupported-sync-data-class")
            result = self.sync_provider.apply_mutation(access, mutation)
        except ValueError:
            return _error(400, "invalid-sync-mutation", "A alteração de sincronização é inválida.")
        except SupabaseSyncError:
            return _error(502, "sync-write-failed", "Não foi possível gravar o estado sincronizado.")
        return _json_response(
            200,
            {
                "$schema": SYNC_ACK_SCHEMA,
                "objectId": mutation.get("objectId"),
                "dataClass": mutation.get("dataClass"),
                "serverRevision": result.server_revision,
                "tombstone": result.tombstone,
                "applied": result.applied,
                "conflict": result.conflict,
                "changeCursor": result.change_cursor,
            },
            set_cookies=set_cookies,
        )

    def handle(
        self,
        method: str,
        target: str,
        headers: Mapping[str, str] | None = None,
        body: bytes = b"",
    ) -> GatewayResponse:
        method = method.upper()
        request_headers = {key.lower(): value for key, value in (headers or {}).items()}
        split = urlsplit(target)
        path = split.path

        if _public_site_request(request_headers):
            gated = _public_site_disabled_response(method, path)
            if gated is not None:
                return gated

        if path == "/auth/session":
            if method != "GET":
                return self._method_not_allowed("GET")
            return self._session(request_headers)

        if path == "/auth/registration-policy":
            if method != "GET":
                return self._method_not_allowed("GET")
            return self._registration_policy()

        if path == "/auth/login":
            if method == "GET":
                return _redirect("/login/")
            if method != "POST":
                return self._method_not_allowed("GET, POST")
            return self._credentials_action(
                registration=False, request_headers=request_headers, body=body
            )

        if path == "/auth/register":
            if method == "GET":
                return _redirect("/cadastro/")
            if method != "POST":
                return self._method_not_allowed("GET, POST")
            return self._credentials_action(
                registration=True, request_headers=request_headers, body=body
            )

        if path == "/auth/recover":
            if method != "POST":
                return self._method_not_allowed("POST")
            return self._recovery_action(request_headers, body)

        if path == "/auth/recover/verify":
            if method != "GET":
                return self._method_not_allowed("GET")
            return self._recovery_verify(request_headers, split.query)

        if path == "/auth/recover/complete":
            if method != "POST":
                return self._method_not_allowed("POST")
            return self._recovery_complete(request_headers, body)

        if path == "/auth/logout":
            if method != "POST":
                return self._method_not_allowed("POST")
            if not _same_origin_state_change(request_headers):
                return _error(403, "cross-site-request-rejected", "A solicitação cross-site foi rejeitada.")
            cookies = _read_cookies(request_headers.get("cookie"))
            access = cookies.get(ACCESS_COOKIE)
            if self.provider and access:
                try:
                    self.provider.sign_out(access)
                except SupabaseIdentityError:
                    pass
            return _redirect(
                "/",
                set_cookies=(
                _clear_cookie(ACCESS_COOKIE),
                _clear_cookie(REFRESH_COOKIE),
                *_clear_recovery_cookies(),
            ),
            )

        if path == "/account/export":
            if method != "GET":
                return self._method_not_allowed("GET")
            return self._account_export(request_headers)

        if path == "/account/spaces":
            if method != "GET":
                return self._method_not_allowed("GET")
            return self._account_spaces(request_headers)

        if path == "/account/entitlements/memory-cloud":
            if method != "GET":
                return self._method_not_allowed("GET")
            return self._account_memory_entitlement(request_headers)

        if path == "/account/close":
            if method != "POST":
                return self._method_not_allowed("POST")
            return self._account_close(request_headers, body)

        if path == "/sync/snapshot":
            if method != "GET":
                return self._method_not_allowed("GET")
            return self._sync_snapshot(request_headers, split.query)

        if path == "/sync/changes":
            if method != "GET":
                return self._method_not_allowed("GET")
            return self._sync_changes(request_headers, split.query)

        if path == "/sync/objects":
            if method != "GET":
                return self._method_not_allowed("GET")
            return self._sync_list(request_headers, split.query)

        if path == "/sync/mutate":
            if method != "POST":
                return self._method_not_allowed("POST")
            return self._sync_mutate(request_headers, body)

        if path.startswith("/auth/") or path.startswith("/sync/") or path.startswith("/account/"):
            return _error(404, "gateway-route-not-found", "Rota inexistente.")
        return _error(404, "not-found", "Recurso inexistente.")

    @staticmethod
    def _method_not_allowed(allowed: str) -> GatewayResponse:
        response = _error(405, "method-not-allowed", "Método não permitido.")
        return GatewayResponse(
            status=response.status,
            headers=response.headers + (("Allow", allowed),),
            body=response.body,
        )


gateway = PublicIdentityGateway()


def application(environ, start_response):
    method = str(environ.get("REQUEST_METHOD", "GET"))
    path = str(environ.get("PATH_INFO", "/"))
    query = str(environ.get("QUERY_STRING", ""))
    target = path + (("?" + query) if query else "")

    headers: dict[str, str] = {}
    for key, value in environ.items():
        if key.startswith("HTTP_") and isinstance(value, str):
            headers[key[5:].replace("_", "-").lower()] = value
    if isinstance(environ.get("CONTENT_TYPE"), str):
        headers["content-type"] = str(environ["CONTENT_TYPE"])
    if isinstance(environ.get("HTTP_HOST"), str):
        headers["host"] = str(environ["HTTP_HOST"])

    body = b""
    if method in ("POST", "PUT", "PATCH"):
        try:
            length = int(environ.get("CONTENT_LENGTH") or "0")
        except ValueError:
            length = 0
        if length < 0 or length > MAX_REQUEST_BODY:
            response = _error(413, "request-too-large", "A solicitação excede o limite permitido.")
        else:
            stream = environ.get("wsgi.input")
            body = stream.read(length) if stream is not None and length else b""
            response = gateway.handle(method, target, headers, body)
    else:
        response = gateway.handle(method, target, headers, body)

    reason = {
        200: "OK",
        303: "See Other",
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        413: "Payload Too Large",
        502: "Bad Gateway",
        503: "Service Unavailable",
    }.get(response.status, "Error")
    start_response(f"{response.status} {reason}", list(response.headers))
    return [response.body]
