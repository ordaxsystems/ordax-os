"""Runtime composition for fail-soft Product-device enrollment.

This module keeps Product-device identity and presence out of Surface JavaScript.
It composes the existing Native Account gateway and one outbound HTTPS presence
worker. It owns no MCP endpoint, grant, inference model or remote execution.
"""

from __future__ import annotations

import json
import time
from threading import RLock

from native_account_gateway import NativeAccountGatewayError, verified_account_session_reply

from product_device_enrollment import ProductDeviceEnrollmentClient
from product_device_identity import ProductDeviceIdentityStore, UUID_RE
from product_device_post_login import PostLoginDeviceResult, enroll_product_device_after_login
from product_device_presence import ProductDevicePresenceClient, ProductDevicePresenceWorker

# Inside the graphical chroot, /var/lib/ordax is the existing private persistent
# bind of the host's /state/ordax/native-state. Keep Product-device material on
# that proven persistence boundary rather than creating or exposing a new mount.
DEFAULT_PRODUCT_DEVICE_STATE_DIR = "/var/lib/ordax"


class ProductDevicePostLoginCoordinator:
    def __init__(
        self,
        account_gateway,
        *,
        distribution_profile: str,
        product_mode: str,
        control_plane_origin: str,
        state_dir: str = DEFAULT_PRODUCT_DEVICE_STATE_DIR,
        development_discovery: bool = True,
    ) -> None:
        self.distribution_profile = distribution_profile
        self.product_mode = product_mode
        self.client = None
        self.presence = None
        self.identity_store = None
        self.development_discovery = bool(
            development_discovery is True
            and distribution_profile == "owner-development" and product_mode == "usb"
        )

        if distribution_profile != "owner-development" or product_mode != "usb":
            return
        if account_gateway is None or not isinstance(control_plane_origin, str) or not control_plane_origin.strip():
            return

        try:
            identity_store = ProductDeviceIdentityStore(state_dir)
            self.identity_store = identity_store
            self.client = ProductDeviceEnrollmentClient(
                control_plane_origin,
                account_gateway,
                identity_store,
            )
            self.presence = ProductDevicePresenceWorker(
                ProductDevicePresenceClient(control_plane_origin, identity_store),
            )
            self.refresh_development_presence()
        except (TypeError, ValueError):
            # Configuration errors must never make account login, boot or Surface
            # health depend on the development Control Plane.
            self.client = None

    def refresh_development_presence(self) -> None:
        if not self.development_discovery or self.identity_store is None or self.presence is None:
            return
        try:
            if self.identity_store.development_visibility_enabled():
                self.presence.start()
            else:
                self.presence.stop()
        except (OSError, RuntimeError):
            # Optional development connectivity never blocks boot or account use.
            pass

    def after_authenticated_login(self, device_profile: dict, *, subject: str | None = None) -> PostLoginDeviceResult:
        if self.client is None:
            return PostLoginDeviceResult(status="inactive")
        result = enroll_product_device_after_login(
            self.client,
            device_profile,
            distribution_profile=self.distribution_profile,
            product_mode=self.product_mode,
        )
        if result.status == "enrolled" and self.development_discovery:
            self.refresh_development_presence()
        elif result.status == "enrolled" and self.presence is not None and (
            self.identity_store is not None and self.identity_store.connector_visibility_enabled(subject)
        ):
            # Discovery remains owner opt-in, never implied by account login.
            try:
                self.presence.start()
            except (OSError, RuntimeError):
                pass
        return result

    def visibility_status(self, *, authenticated: bool, subject: str | None = None) -> dict:
        enabled = bool(self.identity_store and (
            self.identity_store.development_visibility_enabled() if self.development_discovery
            else self.identity_store.connector_visibility_enabled(subject)
        ))
        presence_state = "disabled"
        if enabled:
            state = self.presence.connection_state() if self.presence is not None else "unavailable"
            presence_state = state if state in {"connecting", "confirmed", "unavailable"} else "unavailable"
        return {
            "available": self.client is not None,
            "enabled": enabled,
            "presenceState": presence_state,
            "accountAuthenticated": bool(authenticated),
            "canEnableWithoutLogin": bool(self.development_discovery and self.identity_store
                and self.identity_store.read_enrolled_credential() is not None),
            "remoteActionsEnabled": False,
            "requiresClientOAuthAndGrants": True,
            "mode": "discovery-only",
        }

    def configure_visibility(self, enabled: bool, device_profile: dict, *, subject: str | None = None, authenticated: bool = True) -> dict:
        if type(enabled) is not bool:
            raise ValueError("invalid-connector-visibility")
        if self.client is None or self.identity_store is None:
            raise RuntimeError("connector-unavailable")
        if self.development_discovery:
            self.identity_store.set_development_connector_visibility(enabled)
            self.refresh_development_presence()
            return self.visibility_status(authenticated=authenticated, subject=subject)
        if enabled:
            if not isinstance(subject, str) or not UUID_RE.fullmatch(subject):
                raise PermissionError("connector-account-subject-required")
            # Prove enrollment under this authenticated account before opting in.
            result = self.after_authenticated_login(device_profile, subject=subject)
            if result.status != "enrolled":
                raise RuntimeError("connector-enrollment-unavailable")
            self.identity_store.set_connector_visibility(True, subject)
            if self.presence is not None:
                self.presence.start()
        else:
            # Revoke local discoverability first; offline report is best effort.
            self.identity_store.set_connector_visibility(False)
            self.stop_presence()
        return self.visibility_status(authenticated=authenticated, subject=subject)

    def stop_presence(self, *, wait: bool = False) -> None:
        if self.presence is not None:
            self.presence.stop(wait=wait)


class ProductDeviceAccountGatewayProxy:
    """Delegate account traffic and add one fail-soft post-login side effect.

    The wrapped gateway remains the owner of credentials and session cookies. The
    proxy never changes a login reply and never exposes account/device secrets to
    the HTTP caller. Enrollment is attempted only after the canonical session
    endpoint confirms ``authenticated=true``.
    """

    def __init__(self, gateway, coordinator, device_profile_reader) -> None:
        self._gateway = gateway
        self._coordinator = coordinator
        self._device_profile_reader = device_profile_reader
        self._authenticated = False
        self._subject = None
        self._session_lock = RLock()
        self._enrolled_subject = None
        self._next_enrollment_attempt = 0.0

    def __getattr__(self, name):
        return getattr(self._gateway, name)

    def _clear_session(self):
        if self._authenticated and getattr(self._coordinator, "development_discovery", False) is not True:
            self._coordinator.stop_presence()
        self._authenticated = False
        self._subject = None
        self._enrolled_subject = None
        self._next_enrollment_attempt = 0.0

    def session(self):
        # Reconcile the existing account proof, including login through account
        # registration. Do not create another session or a background scheduler.
        with self._session_lock:
            try:
                reply = self._gateway.session()
            except NativeAccountGatewayError:
                self._clear_session()
                raise
            try:
                payload = verified_account_session_reply(reply, allow_anonymous=True)
                subject = payload.get("subject")
                if (payload.get("authenticated") is not True
                        or not isinstance(subject, str) or not UUID_RE.fullmatch(subject)):
                    self._clear_session()
                    return reply
            except NativeAccountGatewayError:
                self._clear_session()
                return reply

            if self._subject != subject:
                self._clear_session()
            self._authenticated = True
            self._subject = subject
            now = time.monotonic()
            if self._enrolled_subject != subject and now >= self._next_enrollment_attempt:
                # A transient enrollment failure must not require logout/login.
                # Reuse ordinary session refreshes, bounded to once per minute.
                self._next_enrollment_attempt = now + 60.0
                try:
                    result = self._coordinator.after_authenticated_login(
                        self._device_profile_reader(), subject=subject,
                    )
                    if result.status == "enrolled":
                        self._enrolled_subject = subject
                except (OSError, RuntimeError, UnicodeError, ValueError, TypeError, AttributeError):
                    pass
            return reply

    def login(self, email: str, password: str):
        with self._session_lock:
            reply = self._gateway.login(email, password)
            if getattr(reply, "status", None) in {200, 202, 303}:
                try:
                    self.session()
                except (OSError, RuntimeError, UnicodeError, ValueError, TypeError, AttributeError):
                    # Discovery must never change the account login reply.
                    pass
            return reply

    def logout(self):
        with self._session_lock:
            reply = self._gateway.logout()
            if getattr(reply, "status", None) in {200, 204, 303}:
                was_authenticated = self._authenticated
                self._clear_session()
                if not was_authenticated and getattr(self._coordinator, "development_discovery", False) is not True:
                    self._coordinator.stop_presence()
            return reply

    def connector_status(self) -> dict:
        with self._session_lock:
            if getattr(self._coordinator, "development_discovery", False) is True:
                self._coordinator.refresh_development_presence()
            else:
                try:
                    self.session()
                except (OSError, RuntimeError):
                    self._clear_session()
            return self._coordinator.visibility_status(
                authenticated=self._authenticated, subject=self._subject,
            )

    def configure_connector_visibility(self, enabled: bool) -> dict:
        with self._session_lock:
            if type(enabled) is not bool:
                raise ValueError("invalid-connector-visibility")
            if getattr(self._coordinator, "development_discovery", False) is True:
                return self._coordinator.configure_visibility(
                    enabled, {}, authenticated=self._authenticated,
                )
            if not enabled:
                # Local privacy opt-out works even when the cloud is offline.
                return self._coordinator.configure_visibility(False, {}, authenticated=self._authenticated)
            previous_subject = self._subject
            self.session()
            if not self._authenticated:
                raise PermissionError("connector-account-login-required")
            if previous_subject is not None and previous_subject != self._subject:
                raise PermissionError("connector-account-subject-changed")
            return self._coordinator.configure_visibility(
                enabled, self._device_profile_reader(), subject=self._subject,
            )

    def reconcile_device_profile(self, device_profile: dict) -> None:
        """Re-enroll the same machine binding after a durable local rename.

        Never infer account authority from the HTTP request. Require the
        previously observed subject and a fresh signed/validated session.
        """
        with self._session_lock:
            subject = self._subject
            if not self._authenticated or subject is None:
                return
            try:
                reply = self._gateway.session()
                payload = verified_account_session_reply(reply, allow_anonymous=True)
            except (NativeAccountGatewayError, OSError, UnicodeError, ValueError, TypeError, AttributeError):
                self._clear_session()
                return
            if (payload.get("authenticated") is not True
                    or payload.get("subject") != subject
                    or not UUID_RE.fullmatch(subject)):
                self._clear_session()
                return
            try:
                result = self._coordinator.after_authenticated_login(device_profile, subject=subject)
                if result.status == "enrolled":
                    self._enrolled_subject = subject
                    return
            except (OSError, RuntimeError, UnicodeError, ValueError, TypeError, AttributeError):
                pass
            # Retain the existing bounded retry via ordinary session polls;
            # the local rename is already durable and remains successful.
            self._enrolled_subject = None
            self._next_enrollment_attempt = time.monotonic() + 60.0

    def close_product_presence(self) -> None:
        with self._session_lock:
            self._coordinator.stop_presence(wait=True)


def compose_product_device_account_gateway(
    account_gateway,
    *,
    distribution_profile: str,
    product_mode: str,
    control_plane_origin: str,
    device_profile_reader,
    state_dir: str = DEFAULT_PRODUCT_DEVICE_STATE_DIR,
):
    """Return the original gateway unless Owner/Development USB can enroll safely."""
    coordinator = ProductDevicePostLoginCoordinator(
        account_gateway,
        distribution_profile=distribution_profile,
        product_mode=product_mode,
        control_plane_origin=control_plane_origin,
        state_dir=state_dir,
    )
    if coordinator.client is None:
        return account_gateway
    return ProductDeviceAccountGatewayProxy(
        account_gateway,
        coordinator,
        device_profile_reader,
    )
