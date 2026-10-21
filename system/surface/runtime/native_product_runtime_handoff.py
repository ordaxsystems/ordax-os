"""Single-owner handoff from native discovery to the canonical Product Runtime.

This is a Native *composition* port, not another Device Agent, scheduler,
MCP server, authorization decision or component installer. The caller must
already be the trusted owner of a verified/activated Runtime component and
provide its installed entrypoint. This module never discovers or loads an
unsigned artifact, and its presence alone cannot enable remote actions.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable, Mapping

from product_device_identity import ProductDeviceIdentityStore

# Serializes composition in this Native process; the OS component service
# remains the owner of cross-process lifecycle and signed activation.
_HANDOFF = threading.Lock()


class NativeProductRuntimeHandoffError(RuntimeError):
    pass


def run_verified_native_product_runtime(
    coordinator,
    config,
    *,
    installed_runtime_run: Callable | None,
    computer_adapter: Mapping | None = None,
) -> int:
    """Run exactly the upstream dispatch loop, with the original OS credential.

    Must be invoked on the Native runtime service's main thread, *after* the
    canonical component manager verified and activated the signed Runtime.
    Callers must not treat a Python callback or this function as a signature,
    health, grant, owner approval or signed-activation proof.

    On exit restore the native discovery worker. This never starts a parallel
    heartbeat while canonical Runtime owns the Product transport.
    """
    if threading.current_thread() is not threading.main_thread():
        raise NativeProductRuntimeHandoffError("native_runtime_requires_main_thread")
    if installed_runtime_run is None or not callable(installed_runtime_run):
        raise NativeProductRuntimeHandoffError("verified_runtime_entrypoint_required")
    if not _HANDOFF.acquire(blocking=False):
        raise NativeProductRuntimeHandoffError("native_product_runtime_already_running")
    try:
        if getattr(coordinator, "development_discovery", False) is not True:
            raise NativeProductRuntimeHandoffError("native_owner_development_usb_required")
        identity_store = getattr(coordinator, "identity_store", None)
        presence = getattr(coordinator, "presence", None)
        if not isinstance(identity_store, ProductDeviceIdentityStore) or presence is None:
            raise NativeProductRuntimeHandoffError("native_device_identity_unavailable")

        # Use the already enrolled OS credential and its fstat/0600/owner
        # enforcement. Never copy it into Runtime state or create another token.
        credential = identity_store.read_enrolled_credential()
        if credential is None:
            raise NativeProductRuntimeHandoffError("native_device_enrollment_required")
        device_id = credential["device_id"]
        if not isinstance(device_id, str) or device_id != getattr(config, "device_id", None):
            raise NativeProductRuntimeHandoffError("native_product_device_identity_mismatch")

        runtime_origin = getattr(config, "product_mcp_url", None)
        active_origin = getattr(getattr(presence, "client", None), "origin", None)
        if (not isinstance(runtime_origin, str)
                or not runtime_origin.startswith("https://")
                or runtime_origin.rstrip("/") != active_origin):
            raise NativeProductRuntimeHandoffError("native_product_authority_mismatch")
        if getattr(config, "control_plane_protocol", None) != "cloudflare-v3":
            raise NativeProductRuntimeHandoffError("native_product_transport_invalid")

        # The full-access policy must not allow generic actions to read/modify
        # the very credentials on which its authorization is based.
        state_root = identity_store.root.resolve()
        protected = getattr(config, "protected_roots", ())
        if not isinstance(protected, (tuple, list)) or not any(
            root == state_root or root in state_root.parents
            for raw in protected
            for root in (Path(raw).resolve(),)
        ):
            raise NativeProductRuntimeHandoffError("native_device_credentials_not_protected")

        runtime_state = Path(getattr(config, "state_dir", "")).resolve()
        if runtime_state == state_root or runtime_state in state_root.parents:
            raise NativeProductRuntimeHandoffError("native_runtime_state_overlaps_identity")

        # No Win32 fallback; the installed OS-owned adapter supplies only the
        # actual Linux/Wayland operations proven by that Native deployment.
        if computer_adapter is None:
            computer_adapter = {}
        if not isinstance(computer_adapter, Mapping):
            raise NativeProductRuntimeHandoffError("native_computer_adapter_invalid")

        # The old Native presence worker must terminate before Runtime starts
        # its own authoritative heartbeat and challenge confirmation. This
        # is an ownership TRANSFER, never a second periodic worker.
        presence.stop(wait=True)
        try:
            result = installed_runtime_run(
                config,
                device_credential_provider=identity_store.read_enrolled_credential,
                computer_adapter=computer_adapter,
            )
            if type(result) is not int:
                raise NativeProductRuntimeHandoffError("native_runtime_exit_invalid")
            return result
        finally:
            # stop(wait=True) has closed the old worker. Re-create the same
            # existing worker class for discovery fallback; no new protocol.
            # The coordinator continues respecting its local privacy opt-out.
            from product_device_presence import ProductDevicePresenceWorker

            coordinator.presence = ProductDevicePresenceWorker(presence.client)
            coordinator.refresh_development_presence()
    finally:
        _HANDOFF.release()
