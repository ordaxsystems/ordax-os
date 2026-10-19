from __future__ import annotations

import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from system.surface.runtime import display_outputs


def output_snapshot(current: str) -> list[dict]:
    width, height = (1920, 1080) if current.startswith("1920x") else (1280, 720)
    return [{
        "name": "DP-1",
        "description": "Primary display",
        "enabled": True,
        "current_mode": {"width": width, "height": height, "refresh": 60000},
        "modes": [
            {
                "width": 1920,
                "height": 1080,
                "refresh": 60000,
                "preferred": True,
                "current": current == "1920x1080@60",
            },
            {
                "width": 1280,
                "height": 720,
                "refresh": 60000,
                "preferred": False,
                "current": current == "1280x720@60",
            },
        ],
    }]


class FakeRunner:
    def __init__(self) -> None:
        self.current = "1920x1080@60"
        self.calls: list[list[str]] = []

    def __call__(self, command: list[str], **_kwargs):
        args = command[1:]
        self.calls.append(args)
        if args == ["--json"]:
            return SimpleNamespace(stdout=json.dumps(output_snapshot(self.current)), returncode=0)
        if len(args) == 4 and args[0] == "--output" and args[1] == "DP-1" and args[2] == "--mode":
            self.current = args[3].removesuffix("Hz")
            return SimpleNamespace(stdout="", returncode=0)
        raise AssertionError(f"unexpected provider command: {args}")


class DisplayOutputsProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = FakeRunner()
        self.preview_timeout = patch.object(display_outputs, "PREVIEW_SECONDS", 3600)
        self.preview_timeout.start()
        self.addCleanup(self.preview_timeout.stop)
        self.provider = display_outputs.WaylandDisplayOutputProvider(
            binary="wlr-randr",
            runner=self.runner,
            environ={"PATH": "/usr/bin", "WAYLAND_DISPLAY": "wayland-0"},
        )

    def tearDown(self) -> None:
        if self.provider._timer:
            self.provider._timer.cancel()

    def test_reads_only_modes_reported_by_the_host(self) -> None:
        snapshot = self.provider.read()
        self.assertTrue(snapshot["available"])
        self.assertEqual(snapshot["outputs"][0]["currentModeId"], "1920x1080@60")
        self.assertEqual(
            [mode["id"] for mode in snapshot["outputs"][0]["modes"]],
            ["1920x1080@60", "1280x720@60"],
        )

    def test_provider_missing_or_wayland_missing_fails_closed(self) -> None:
        missing = display_outputs.WaylandDisplayOutputProvider(
            environ={"PATH": "", "WAYLAND_DISPLAY": "wayland-0"}, runner=self.runner,
        )
        self.assertEqual(missing.read()["reason"], "provider-missing")
        no_wayland = display_outputs.WaylandDisplayOutputProvider(
            binary="wlr-randr", environ={"PATH": "/usr/bin"}, runner=self.runner,
        )
        self.assertEqual(no_wayland.read()["reason"], "host-unavailable")

    def test_unsupported_modes_are_rejected_without_applying(self) -> None:
        with self.assertRaises(display_outputs.DisplayOutputError):
            self.provider.preview("DP-1", "3840x2160@60")
        self.assertEqual(self.runner.current, "1920x1080@60")

    def test_preview_is_kept_only_for_the_session_after_confirmation(self) -> None:
        preview = self.provider.preview("DP-1", "1280x720@60")
        self.assertEqual(preview["preview"]["modeId"], "1280x720@60")
        kept = self.provider.confirm(preview["preview"]["id"])
        self.assertIsNone(kept["preview"])
        self.assertEqual(self.runner.current, "1280x720@60")

    def test_preview_reverts_to_the_previous_mode(self) -> None:
        preview = self.provider.preview("DP-1", "1280x720@60")
        reverted = self.provider.revert(preview["preview"]["id"])
        self.assertIsNone(reverted["preview"])
        self.assertEqual(self.runner.current, "1920x1080@60")

    def test_expired_preview_rolls_back_before_confirmation(self) -> None:
        preview = self.provider.preview("DP-1", "1280x720@60")
        assert self.provider._pending is not None
        self.provider._pending["expiresAt"] = 0
        with self.assertRaisesRegex(display_outputs.DisplayOutputError, "expired"):
            self.provider.confirm(preview["preview"]["id"])
        self.assertEqual(self.runner.current, "1920x1080@60")

    def test_display_provider_failure_is_normalized_without_shell_exception_leak(self) -> None:
        import subprocess
        def failing_runner(command, **kwargs):
            raise subprocess.CalledProcessError(
                1, command, stderr="PRIVATE DISPLAY DETAILS"
            )
        provider = display_outputs.WaylandDisplayOutputProvider(
            binary="wlr-randr", runner=failing_runner,
            environ={"PATH": "/usr/bin", "WAYLAND_DISPLAY": "wayland-0"},
        )
        result = provider.read()
        self.assertFalse(result["available"])
        self.assertEqual(result["reason"], "compositor-unsupported")
        self.assertNotIn("PRIVATE", json.dumps(result))

    def test_mode_apply_provider_error_is_safe_and_preview_never_stays_pending(self) -> None:
        import subprocess
        def error_on_apply(command, **kwargs):
            if "--output" in command:
                raise subprocess.TimeoutExpired(command, timeout=3)
            return self.runner(command, **kwargs)
        provider = display_outputs.WaylandDisplayOutputProvider(
            binary="wlr-randr", runner=error_on_apply,
            environ={"PATH": "/usr/bin", "WAYLAND_DISPLAY": "wayland-0"},
        )
        with self.assertRaisesRegex(
            display_outputs.DisplayOutputError, "provider unavailable"
        ):
            provider.preview("DP-1", "1280x720@60")
        self.assertIsNone(provider._pending)
        self.assertIsNone(provider._timer)
        self.assertEqual(self.runner.current, "1920x1080@60")

    def test_host_shutdown_rolls_back_an_unconfirmed_preview(self) -> None:
        self.provider.preview("DP-1", "1280x720@60")
        self.provider.close()
        self.assertEqual(self.runner.current, "1920x1080@60")
        self.assertIsNone(self.provider._pending)


if __name__ == "__main__":
    unittest.main()
