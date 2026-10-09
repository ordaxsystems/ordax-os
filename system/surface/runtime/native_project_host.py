#!/usr/bin/env python3
"""Canonical Native-host composition for durable Project catalog state.

This layer extends the existing receipt-bound App Data host. It mounts exactly
one typed Project state route on the same trusted loopback origin; it does not
create a second HTTP server, Project store, or browser-owned authority.
"""

from __future__ import annotations

import errno
import sys
from urllib.parse import urlsplit

from native_app_data_host import NativeAppDataHostHandler, NativeAppDataHostServer
from native_project_endpoint import (
    MAX_PROJECT_REQUEST_BODY_BYTES,
    ProjectEndpointRequestError,
    mutate_project_endpoint,
    read_project_endpoint,
)
from native_project_state import DEFAULT_PROJECT_STATE_ROOT

PROJECT_STATE_ENDPOINT = "/__ordax/native/project-state"


class NativeProjectHostServer(NativeAppDataHostServer):
    def __init__(
        self,
        server_address,
        handler_class,
        *,
        project_state_root: str = DEFAULT_PROJECT_STATE_ROOT,
        **kwargs,
    ):
        if not isinstance(project_state_root, str) or not project_state_root:
            raise TypeError("Native Project state root must be a non-empty string")
        self.project_state_root = project_state_root
        super().__init__(server_address, handler_class, **kwargs)


class NativeProjectHostHandler(NativeAppDataHostHandler):
    def _is_project_state_path(self) -> bool:
        return urlsplit(self.path).path == PROJECT_STATE_ENDPOINT

    def _write_project_error(self, status: int, message: str) -> None:
        self._write_json(status, {"error": message})

    def _project_request_allowed(self) -> bool:
        if not self._request_is_trusted():
            return False
        if self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return False
        parsed = urlsplit(self.path)
        if parsed.query or parsed.fragment:
            self._write_project_error(400, "Native Project state route does not accept query or fragment")
            return False
        return True

    def _read_project_body(self) -> tuple[bytes | None, int, str]:
        if self.headers.get("Transfer-Encoding"):
            return None, 400, "Native Project transfer encoding is unsupported"
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None, 400, "Native Project Content-Length is invalid"
        if length <= 0:
            return None, 400, "Native Project request body is empty"
        if length > MAX_PROJECT_REQUEST_BODY_BYTES:
            return None, 413, "Native Project request body exceeds byte limit"
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return None, 415, "Native Project state mutation requires application/json"
        body = self.rfile.read(length)
        if len(body) != length:
            return None, 400, "Native Project request body is incomplete"
        return body, 200, ""

    def do_GET(self) -> None:  # noqa: N802
        if not self._is_project_state_path():
            super().do_GET()
            return
        if not self._project_request_allowed():
            return
        try:
            result = read_project_endpoint(self.server.project_state_root)
        except ProjectEndpointRequestError as exc:
            self._write_project_error(exc.status_code, str(exc))
            return
        except OSError as exc:
            print(
                f"ordax-native-host: Project state read failed safely: {exc}",
                file=sys.stderr,
                flush=True,
            )
            self._write_project_error(503, "Native Project state unavailable")
            return
        self._write_json(200, result)

    def do_HEAD(self) -> None:  # noqa: N802
        if not self._is_project_state_path():
            super().do_HEAD()
            return
        if not self._project_request_allowed():
            return
        self._empty(405)

    def do_POST(self) -> None:  # noqa: N802
        if not self._is_project_state_path():
            super().do_POST()
            return
        if not self._project_request_allowed():
            return
        body, status, message = self._read_project_body()
        if body is None:
            self._write_project_error(status, message)
            return
        try:
            result = mutate_project_endpoint(body, self.server.project_state_root)
        except ProjectEndpointRequestError as exc:
            self._write_project_error(exc.status_code, str(exc))
            return
        except OSError as exc:
            print(
                f"ordax-native-host: Project state persistence failed safely: {exc}",
                file=sys.stderr,
                flush=True,
            )
            self._write_project_error(
                507 if exc.errno == errno.ENOSPC else 503,
                "Native Project state persistence unavailable",
            )
            return
        self._write_json(200, result)
