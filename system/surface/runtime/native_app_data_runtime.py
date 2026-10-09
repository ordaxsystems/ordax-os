#!/usr/bin/env python3
"""Run the canonical Native host with private App Data and Project authority.

This entrypoint composes the existing Native host with the receipt-bound App
Data route and the typed durable Project state route on the same trusted
loopback origin. Stable/MVP publishes verified opaque App Data descriptors only
through a root-owned one-shot tmpfs handoff; Projects remain platform-owned and
are never retargeted by request data.
"""

from __future__ import annotations

import os
import sys
from functools import partial

from native_app_data_port_bootstrap import (
    DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH,
    NativeAppDataPortBootstrapError,
    publish_app_data_port_bootstrap,
)
from native_app_data_session_binding import (
    NativeAppDataSessionBindingError,
    load_current_boot_app_data_bindings,
)
from native_host_server import (
    STANDARD_USER_DIRECTORIES,
    SURFACE_HOST_RECOVERY_GENERATION,
    ensure_standard_user_directories,
    expected_surface_authority,
    parse_args,
    start_telemetry_heartbeat,
)
from native_project_host import NativeProjectHostHandler, NativeProjectHostServer

TRUSTED_STATE_UID = 0


def prepare_private_app_data_authority(
    server,
    distribution_profile: str,
    *,
    bootstrap_path: str = DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH,
) -> int:
    """Load Stable bindings and publish only the trusted one-shot composition handoff."""
    if distribution_profile == "owner-development":
        return 0
    if distribution_profile != "stable-mvp":
        raise ValueError("unsupported distribution profile for App Data authority")
    if os.geteuid() != TRUSTED_STATE_UID:
        raise PermissionError("Stable App Data authority requires root-owned runtime state")

    bindings = load_current_boot_app_data_bindings(
        server,
        expected_uid=TRUSTED_STATE_UID,
    )
    published = publish_app_data_port_bootstrap(
        bindings,
        bootstrap_path,
        expected_uid=TRUSTED_STATE_UID,
    )
    if published != len(bindings):
        raise NativeAppDataPortBootstrapError(
            "App Data port bootstrap count does not match verified bindings"
        )
    return published


def main() -> int:
    args = parse_args()
    try:
        expected_surface_authority((args.bind, args.port))
    except ValueError as exc:
        print(f"ordax-native-host: refusing unsafe bind: {exc}", file=sys.stderr, flush=True)
        return 2

    try:
        standard_directories = ensure_standard_user_directories(args.user_root)
    except OSError as exc:
        standard_directories = ()
        print(
            f"ordax-native-host: could not provision standard user directories: {exc}",
            file=sys.stderr,
            flush=True,
        )
    if len(standard_directories) != len(STANDARD_USER_DIRECTORIES):
        missing = sorted(set(STANDARD_USER_DIRECTORIES) - set(standard_directories))
        print(
            "ordax-native-host: standard user directories unavailable: %s" % ",".join(missing),
            file=sys.stderr,
            flush=True,
        )

    handler = partial(NativeProjectHostHandler, directory=args.directory)
    server = NativeProjectHostServer(
        (args.bind, args.port),
        handler,
        user_root=args.user_root,
        power_request_path=args.power_request,
        network_session_dir=args.network_session_dir,
        product_mode=args.product_mode,
        distribution_profile=args.distribution_profile,
        native_install_capability=args.native_install_capability,
        component_channel_bin=args.component_channel_bin,
        component_trust_path=args.component_trust,
        component_slot_root=args.component_slot_root,
        account_gateway_origin=args.account_gateway_origin,
        app_data_expected_uid=TRUSTED_STATE_UID,
        app_data_defer_listener_activation=True,
    )

    try:
        binding_count = prepare_private_app_data_authority(
            server,
            args.distribution_profile,
        )
        # TCP readiness is the launcher gate for starting the privileged WebKit
        # host. Do not accept connections until the one-shot App Data handoff
        # is fully published, otherwise the browser can race the producer.
        server.activate_private_listener()
    except (
        NativeAppDataPortBootstrapError,
        NativeAppDataSessionBindingError,
        OSError,
        PermissionError,
        RuntimeError,
        TypeError,
        ValueError,
    ) as exc:
        print(
            f"ordax-native-host: refusing private-state startup: {exc}",
            file=sys.stderr,
            flush=True,
        )
        server.server_close()
        return 3

    telemetry_started = start_telemetry_heartbeat(args.telemetry_config)
    print(
        "ordax-native-host: serving %s on %s:%d; user root=%s; power actions=%s; recovery-generation=%d; telemetry=%s; private-app-data-bindings=%d; project-state=native-cas"
        % (
            args.directory,
            args.bind,
            args.port,
            args.user_root,
            ",".join(server.supported_actions) or "none",
            SURFACE_HOST_RECOVERY_GENERATION,
            "enabled" if telemetry_started else "disabled",
            binding_count,
        ),
        file=sys.stderr,
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
