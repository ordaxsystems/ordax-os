"""Optional Wayland output control, isolated from the OrdaX product and distro.

This provider talks to the compositor through the standard wlroots output
management client. It does not install packages or assume a distribution. A
future host can replace this provider while keeping the Surface contract.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
from typing import Any, Callable


DISPLAY_OUTPUTS_SCHEMA = "ordax.display-outputs/1"
MAX_OUTPUTS = 8
MAX_MODES = 96
MAX_OUTPUT_JSON_BYTES = 512 * 1024
PREVIEW_SECONDS = 15
OUTPUT_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
MODE_ID = re.compile(r"^(\d{1,5})x(\d{1,5})@(\d{1,4}(?:\.\d{1,3})?)$")


class DisplayOutputError(ValueError):
    """A display operation could not be safely completed."""


def _refresh_hz(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    result = float(value)
    # wlr-output-management reports refresh in mHz.
    if result > 1000:
        result /= 1000
    return round(result, 3)


def _mode_id(width: int, height: int, refresh_hz: float) -> str:
    refresh = f"{refresh_hz:.3f}".rstrip("0").rstrip(".")
    return f"{width}x{height}@{refresh}"


def _mode_spec(mode_id: str) -> str:
    match = MODE_ID.fullmatch(mode_id)
    if not match:
        raise DisplayOutputError("display mode identity is invalid")
    width, height, refresh = match.groups()
    return f"{width}x{height}@{refresh}Hz"


class WaylandDisplayOutputProvider:
    """Optional, distro-neutral adapter for a compositor exposing output management."""

    def __init__(
        self,
        *,
        binary: str | None = None,
        runner: Callable[..., Any] = subprocess.run,
        environ: dict[str, str] | None = None,
    ):
        self.environ = dict(os.environ if environ is None else environ)
        self.binary = binary or shutil.which("wlr-randr", path=self.environ.get("PATH"))
        self.runner = runner
        self._lock = threading.RLock()
        self._pending: dict[str, Any] | None = None
        self._timer: threading.Timer | None = None

    def _unavailable(self, reason: str) -> dict[str, Any]:
        return {
            "schema": DISPLAY_OUTPUTS_SCHEMA,
            "available": False,
            "reason": reason,
            "outputs": [],
            "preview": None,
        }

    def _run(self, args: list[str]) -> Any:
        if not self.binary:
            raise FileNotFoundError("no Wayland output-management provider is installed")
        env = {
            key: value for key, value in self.environ.items()
            if key in {"PATH", "XDG_RUNTIME_DIR", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS"}
        }
        env["LC_ALL"] = "C"
        try:
            return self.runner(
                [self.binary, *args],
                check=True,
                capture_output=True,
                text=True,
                timeout=3.0,
                env=env,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            # The provider owns process invocation and failure normalization.
            # Never expose its raw command, stderr or transient display IDs
            # through the narrow tokenized Native HTTP boundary.
            raise DisplayOutputError("display output provider unavailable") from exc

    def _read_outputs(self) -> list[dict[str, Any]]:
        if not self.environ.get("WAYLAND_DISPLAY"):
            raise ConnectionError("Wayland session is unavailable")
        result = self._run(["--json"])
        encoded = result.stdout.encode("utf-8")
        if len(encoded) > MAX_OUTPUT_JSON_BYTES:
            raise DisplayOutputError("display output report exceeds the size limit")
        raw = json.loads(result.stdout)
        if not isinstance(raw, list) or len(raw) > MAX_OUTPUTS:
            raise DisplayOutputError("display output report is malformed")

        outputs: list[dict[str, Any]] = []
        seen_outputs: set[str] = set()
        for entry in raw:
            if not isinstance(entry, dict):
                raise DisplayOutputError("display output entry is malformed")
            output_id = entry.get("name")
            if not isinstance(output_id, str) or not OUTPUT_ID.fullmatch(output_id):
                raise DisplayOutputError("display output name is invalid")
            if output_id in seen_outputs:
                raise DisplayOutputError("display output names are duplicated")
            seen_outputs.add(output_id)
            name = entry.get("description") or output_id
            if not isinstance(name, str):
                name = output_id
            name = name[:160]
            enabled = entry.get("enabled") is True
            raw_modes = entry.get("modes")
            if not isinstance(raw_modes, list) or len(raw_modes) > MAX_MODES:
                raise DisplayOutputError("display output modes are malformed")
            current_mode = entry.get("current_mode")
            modes: list[dict[str, Any]] = []
            seen_modes: set[str] = set()
            for raw_mode in raw_modes:
                if not isinstance(raw_mode, dict):
                    raise DisplayOutputError("display output mode is malformed")
                width, height = raw_mode.get("width"), raw_mode.get("height")
                refresh = _refresh_hz(raw_mode.get("refresh"))
                if (isinstance(width, bool) or not isinstance(width, int) or not 320 <= width <= 16384
                        or isinstance(height, bool) or not isinstance(height, int) or not 200 <= height <= 16384):
                    continue
                if not 1 <= refresh <= 1000:
                    continue
                mode_id = _mode_id(width, height, refresh)
                if mode_id in seen_modes:
                    continue
                seen_modes.add(mode_id)
                is_current = raw_mode.get("current") is True
                if isinstance(current_mode, dict):
                    is_current = is_current or (
                        width == current_mode.get("width")
                        and height == current_mode.get("height")
                        and refresh == _refresh_hz(current_mode.get("refresh"))
                    )
                modes.append({
                    "id": mode_id,
                    "width": width,
                    "height": height,
                    "refreshHz": refresh,
                    "preferred": raw_mode.get("preferred") is True,
                    "current": is_current,
                })
            if enabled and not any(mode["current"] for mode in modes):
                raise DisplayOutputError("enabled output has no identifiable current mode")
            current = next((mode["id"] for mode in modes if mode["current"]), None)
            outputs.append({
                "id": output_id,
                "name": name,
                "enabled": enabled,
                "currentModeId": current,
                "modes": modes,
            })
        return outputs

    def _snapshot_locked(self) -> dict[str, Any]:
        try:
            outputs = self._read_outputs()
        except FileNotFoundError:
            return self._unavailable("provider-missing")
        except ConnectionError:
            return self._unavailable("host-unavailable")
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError, DisplayOutputError):
            return self._unavailable("compositor-unsupported")
        if not any(output["enabled"] for output in outputs):
            return self._unavailable("host-unavailable")
        preview = None
        if self._pending:
            preview = {
                "id": self._pending["id"],
                "outputId": self._pending["outputId"],
                "modeId": self._pending["modeId"],
                "expiresAt": self._pending["expiresAt"],
            }
        return {
            "schema": DISPLAY_OUTPUTS_SCHEMA,
            "available": True,
            "reason": None,
            "outputs": outputs,
            "preview": preview,
        }

    def read(self) -> dict[str, Any]:
        with self._lock:
            self._expire_if_due_locked()
            return self._snapshot_locked()

    def _expire_if_due_locked(self) -> bool:
        if not self._pending or self._pending["expiresAt"] > int(time.time() * 1000):
            return False
        self._expire_locked(self._pending["id"])
        return True

    def _set_mode(self, output_id: str, mode_id: str) -> None:
        if not OUTPUT_ID.fullmatch(output_id):
            raise DisplayOutputError("display output identity is invalid")
        spec = _mode_spec(mode_id)
        result = self._run(["--output", output_id, "--mode", spec])
        if result.returncode != 0:
            raise DisplayOutputError("compositor rejected the display mode")

    def preview(self, output_id: str, mode_id: str) -> dict[str, Any]:
        with self._lock:
            self._expire_if_due_locked()
            if self._pending:
                raise DisplayOutputError("a display preview is already active")
            snapshot = self._snapshot_locked()
            if not snapshot["available"]:
                raise DisplayOutputError("display output capability is unavailable")
            output = next((item for item in snapshot["outputs"] if item["id"] == output_id and item["enabled"]), None)
            if not output:
                raise DisplayOutputError("display output is not available")
            mode = next((item for item in output["modes"] if item["id"] == mode_id), None)
            if not mode:
                raise DisplayOutputError("display mode is not supported by this output")
            current = next((item for item in output["modes"] if item["current"]), None)
            if not current:
                raise DisplayOutputError("current display mode cannot be restored safely")
            if current["id"] == mode_id:
                return snapshot

            preview_id = secrets.token_urlsafe(24)
            previous_mode_id = current["id"]
            self._set_mode(output_id, mode_id)
            applied = self._snapshot_locked()
            applied_output = next((item for item in applied.get("outputs", []) if item["id"] == output_id), None)
            if not applied["available"] or not applied_output or applied_output["currentModeId"] != mode_id:
                try:
                    self._set_mode(output_id, previous_mode_id)
                finally:
                    raise DisplayOutputError("compositor did not confirm the requested display mode")
            self._pending = {
                "id": preview_id,
                "outputId": output_id,
                "modeId": mode_id,
                "previousModeId": previous_mode_id,
                "expiresAt": int((time.time() + PREVIEW_SECONDS) * 1000),
            }
            self._timer = threading.Timer(PREVIEW_SECONDS, self._expire, args=(preview_id,))
            self._timer.daemon = True
            self._timer.start()
            return self._snapshot_locked()

    def confirm(self, preview_id: str) -> dict[str, Any]:
        with self._lock:
            expired = self._expire_if_due_locked()
            if expired:
                raise DisplayOutputError("display preview expired and was reverted")
            if not self._pending or not secrets.compare_digest(self._pending["id"], preview_id):
                raise DisplayOutputError("display preview is no longer active")
            if self._timer:
                self._timer.cancel()
            self._timer = None
            self._pending = None
            return self._snapshot_locked()

    def revert(self, preview_id: str) -> dict[str, Any]:
        with self._lock:
            expired = self._expire_if_due_locked()
            if expired:
                raise DisplayOutputError("display preview expired and was reverted")
            if not self._pending or not secrets.compare_digest(self._pending["id"], preview_id):
                raise DisplayOutputError("display preview is no longer active")
            pending = self._pending
            if self._timer:
                self._timer.cancel()
            self._timer = None
            try:
                self._set_mode(pending["outputId"], pending["previousModeId"])
            finally:
                self._pending = None
            return self._snapshot_locked()

    def _expire(self, preview_id: str) -> None:
        with self._lock:
            self._expire_locked(preview_id)

    def _expire_locked(self, preview_id: str) -> None:
        if not self._pending or not secrets.compare_digest(self._pending["id"], preview_id):
            return
        pending = self._pending
        try:
            self._set_mode(pending["outputId"], pending["previousModeId"])
        except (OSError, subprocess.SubprocessError, DisplayOutputError) as exc:
            print(f"ordax-native-host: display preview rollback failed: {exc}", flush=True)
        finally:
            self._pending = None
            self._timer = None

    def close(self) -> None:
        """Cancel an unconfirmed mode preview when its host session stops."""
        with self._lock:
            pending = self._pending
            if self._timer:
                self._timer.cancel()
            self._timer = None
            if pending:
                try:
                    self._set_mode(pending["outputId"], pending["previousModeId"])
                except (OSError, subprocess.SubprocessError, DisplayOutputError) as exc:
                    print(f"ordax-native-host: display preview shutdown rollback failed: {exc}", flush=True)
                finally:
                    self._pending = None
