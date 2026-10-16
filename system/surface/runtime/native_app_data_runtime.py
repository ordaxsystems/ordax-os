#!/usr/bin/env python3
"""Run the canonical Native host with private current-boot App Data authority.

This entrypoint composes the existing Native host with the receipt-bound App
Data route. Stable/MVP publishes the already-verified opaque binding descriptors
only through a root-owned one-shot tmpfs handoff consumed by the privileged
WebKit host; apps never receive those descriptors directly.
"""

from __future__ import annotations

import fcntl
import os
import stat
import sys
from contextlib import contextmanager
from functools import partial

from native_app_data_host import NativeAppDataHostHandler, NativeAppDataHostServer
from native_app_data_port_bootstrap import (
    DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH,
    NativeAppDataPortBootstrapError,
    clear_app_data_port_bootstrap,
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
    read_device_profile,
    start_telemetry_heartbeat,
)
from product_device_runtime import compose_product_device_account_gateway

TRUSTED_STATE_UID = 0

# Transient root-owned lock shared by every Native host instance in the boot.
# Its inode must survive process restarts; never unlink it during cleanup.
DEFAULT_NATIVE_HOST_INSTANCE_LOCK = "/run/ordax-surface/native-host-instance.lock"


class NativeHostInstanceBusyError(RuntimeError):
    """Another trusted Native host owns receipt/capability issuance."""


@contextmanager
def hold_native_host_instance(lock_path: str | None = None):
    """Hold one kernel-backed host authority through mint, bind and shutdown.

    Lock the *directory-relative* inode rather than a separately checked path.
    O_NOFOLLOW, ownership, private permissions, one hardlink and post-lock
    inode verification prevent duplicate authorities caused by unsafe locks.
    The caller owns no unlink operation: process death releases flock without
    exposing a second lock inode to a racing process.
    """
    if lock_path is None:
        lock_path = DEFAULT_NATIVE_HOST_INSTANCE_LOCK
    if not isinstance(lock_path, str) or not os.path.isabs(lock_path):
        raise ValueError("Native host instance lock path must be absolute")
    directory, name = os.path.split(lock_path)
    if name != "native-host-instance.lock":
        raise ValueError("Native host instance lock filename is not canonical")
    directory_fd = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        directory_meta = os.fstat(directory_fd)
        if (not stat.S_ISDIR(directory_meta.st_mode)
                or directory_meta.st_uid != os.geteuid()
                or stat.S_IMODE(directory_meta.st_mode) & 0o077):
            raise PermissionError("Native host instance directory is not private and owned")
        descriptor = os.open(
            name,
            os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=directory_fd,
        )
        try:
            metadata = os.fstat(descriptor)
            if (not stat.S_ISREG(metadata.st_mode)
                    or metadata.st_uid != os.geteuid()
                    or metadata.st_nlink != 1
                    or stat.S_IMODE(metadata.st_mode) != 0o600):
                raise PermissionError("Native host instance lock inode is unsafe")
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise NativeHostInstanceBusyError(
                    "another Native host already owns the live App Data authority"
                ) from exc
            try:
                selected = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if (selected.st_dev != metadata.st_dev
                        or selected.st_ino != metadata.st_ino
                        or selected.st_nlink != 1):
                    raise PermissionError("Native host instance lock inode changed")
                yield
            finally:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)
    finally:
        os.close(directory_fd)


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


def _serve_native_host(args) -> int:
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

    handler = partial(NativeAppDataHostHandler, directory=args.directory)
    server = NativeAppDataHostServer(
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

    if server.account_gateway is not None:
        server.account_gateway = compose_product_device_account_gateway(
            server.account_gateway,
            distribution_profile=args.distribution_profile,
            product_mode=args.product_mode,
            control_plane_origin=os.environ.get("ORDAX_PRODUCT_CONTROL_PLANE_URL", ""),
            device_profile_reader=read_device_profile,
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
            f"ordax-native-host: refusing App Data startup: {exc}",
            file=sys.stderr,
            flush=True,
        )
        server.server_close()
        return 3

    telemetry_started = start_telemetry_heartbeat(args.telemetry_config)
    print(
        "ordax-native-host: serving %s on %s:%d; user root=%s; power actions=%s; recovery-generation=%d; telemetry=%s; private-app-data-bindings=%d"
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


def main() -> int:
    args = parse_args()
    try:
        expected_surface_authority((args.bind, args.port))
    except ValueError as exc:
        print(f"ordax-native-host: refusing unsafe bind: {exc}", file=sys.stderr, flush=True)
        return 2
    try:
        # Hold the sole host authority across both handoff cleanup points.
        # A previous host may have died after writing the one-shot file but
        # before listener activation or privileged WebKit consumption. Never
        # expose its stale capabilities to a new graphics process.
        with hold_native_host_instance():
            clear_app_data_port_bootstrap(
                DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH,
                expected_uid=os.geteuid(),
            )
            try:
                return _serve_native_host(args)
            finally:
                # Once the HTTP host is gone, no unconsumed port descriptor
                # may outlive it. Normal one-shot consumption is a no-op here.
                clear_app_data_port_bootstrap(
                    DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH,
                    expected_uid=os.geteuid(),
                )
    except (OSError, NativeHostInstanceBusyError, RuntimeError, ValueError) as exc:
        print(
            f"ordax-native-host: refusing duplicate or unsafe host authority: {exc}",
            file=sys.stderr, flush=True,
        )
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
