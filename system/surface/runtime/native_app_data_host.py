#!/usr/bin/env python3
"""Thin Native-host integration for receipt-bound App Data capabilities.

The canonical host remains the owner of request provenance and all existing
system APIs. This module only intercepts the opaque App Data route and delegates
everything else unchanged.
"""

from __future__ import annotations

import errno
import json
import os
import sys
from urllib.parse import urlsplit

from native_app_data import (
    DEFAULT_APP_DATA_MAX_KEYS,
    DEFAULT_APP_DATA_QUOTA_BYTES,
    DEFAULT_APP_DATA_ROOT,
)
from native_app_data_binding import (
    APP_DATA_ENDPOINT_PREFIX,
    NativeAppDataBindingNotFoundError,
    NativeAppDataBindingRegistry,
    handle_bound_app_data_request,
)
from native_app_data_endpoint import (
    MAX_APP_DATA_REQUEST_BODY_BYTES,
    AppDataEndpointRequestError,
)
from native_app_install_identity import DEFAULT_RECEIPT_ROOT
from native_host_server import NativeHostHandler, NativeHostServer


class NativeAppDataHostServer(NativeHostServer):
    def __init__(
        self,
        server_address,
        handler_class,
        *,
        app_data_receipt_root: str = DEFAULT_RECEIPT_ROOT,
        app_data_expected_uid: int | None = None,
        app_data_root: str = DEFAULT_APP_DATA_ROOT,
        app_data_quota_bytes: int = DEFAULT_APP_DATA_QUOTA_BYTES,
        app_data_max_keys: int = DEFAULT_APP_DATA_MAX_KEYS,
        app_data_max_bindings: int = 64,
        **kwargs,
    ):
        super().__init__(server_address, handler_class, **kwargs)
        expected_uid = os.geteuid() if app_data_expected_uid is None else app_data_expected_uid
        self.app_data_bindings = NativeAppDataBindingRegistry(
            receipt_root=app_data_receipt_root,
            expected_uid=expected_uid,
            max_bindings=app_data_max_bindings,
        )
        self.app_data_root = app_data_root
        self.app_data_quota_bytes = app_data_quota_bytes
        self.app_data_max_keys = app_data_max_keys

    def bind_app_data_receipt(self, receipt_sha256: str):
        """Trusted in-process handoff; never exposed as an HTTP mint endpoint."""
        return self.app_data_bindings.mint_from_receipt(receipt_sha256)


class NativeAppDataHostHandler(NativeHostHandler):
    def _is_app_data_path(self) -> bool:
        return urlsplit(self.path).path.startswith(APP_DATA_ENDPOINT_PREFIX)

    def _write_app_data_error(self, status: int, message: str, **fields) -> None:
        payload = {"error": message, **fields}
        self._write_json(status, payload)

    def _read_app_data_body(self) -> bytes | None:
        if self.headers.get("Transfer-Encoding"):
            return None
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > MAX_APP_DATA_REQUEST_BODY_BYTES:
            return None
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return None
        body = self.rfile.read(length)
        return body if len(body) == length else None

    def do_GET(self) -> None:  # noqa: N802
        if not self._is_app_data_path():
            super().do_GET()
            return
        if not self._request_is_trusted():
            return
        if self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return
        self._empty(405)

    def do_HEAD(self) -> None:  # noqa: N802
        if not self._is_app_data_path():
            super().do_HEAD()
            return
        if not self._request_is_trusted():
            return
        if self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return
        self._empty(405)

    def do_POST(self) -> None:  # noqa: N802
        if not self._is_app_data_path():
            super().do_POST()
            return
        if not self._request_is_trusted():
            return
        if self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return
        if urlsplit(self.path).query:
            self._write_app_data_error(400, "Native App Data capability does not accept a query")
            return

        body = self._read_app_data_body()
        if body is None:
            self._write_app_data_error(400, "Native App Data request body is invalid")
            return

        try:
            result = handle_bound_app_data_request(
                self.server.app_data_bindings,
                urlsplit(self.path).path,
                body,
                root=self.server.app_data_root,
                quota_bytes=self.server.app_data_quota_bytes,
                max_keys=self.server.app_data_max_keys,
            )
        except NativeAppDataBindingNotFoundError:
            self._write_app_data_error(404, "Native App Data capability is unknown")
            return
        except AppDataEndpointRequestError as exc:
            fields = {}
            if exc.actual_revision is not None:
                fields["actualRevision"] = exc.actual_revision
            self._write_app_data_error(exc.status_code, str(exc), **fields)
            return
        except OSError as exc:
            print(
                f"ordax-native-host: App Data persistence failed safely: {exc}",
                file=sys.stderr,
                flush=True,
            )
            self._write_app_data_error(
                507 if exc.errno == errno.ENOSPC else 503,
                "Native App Data persistence unavailable",
            )
            return

        self._write_json(200, result)
