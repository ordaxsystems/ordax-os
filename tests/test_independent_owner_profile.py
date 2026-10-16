from __future__ import annotations

import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "bootstrap" / "independent-base"
SOURCE = BASE / "source.json"
FRAGMENT = BASE / "configs" / "owner-development.fragment"
POST_BUILD = BASE / "post-build.sh"


class IndependentOwnerDevelopmentProfileTests(unittest.TestCase):
    def test_profile_is_registered_under_single_independent_base_owner(self) -> None:
        source = json.loads(SOURCE.read_text(encoding="utf-8"))
        profiles = source.get("profiles")
        self.assertIsInstance(profiles, dict)
        self.assertEqual(
            profiles["minimal"]["defconfig"],
            "bootstrap/independent-base/configs/ordax_minimal_defconfig",
        )
        owner = profiles["owner-development"]
        self.assertEqual(owner["defconfig"], profiles["minimal"]["defconfig"])
        self.assertEqual(
            owner["fragment"],
            "bootstrap/independent-base/configs/owner-development.fragment",
        )
        self.assertEqual(owner["purpose"], "owner-development-parity-without-alpine")

    def test_owner_profile_declares_required_capabilities_without_package_manager(self) -> None:
        lines = {
            line.strip()
            for line in FRAGMENT.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
        required = {
            "BR2_PACKAGE_CA_CERTIFICATES=y",
            "BR2_PACKAGE_GIT=y",
            "BR2_PACKAGE_IW=y",
            "BR2_PACKAGE_KMOD=y",
            "BR2_PACKAGE_WPA_SUPPLICANT=y",
            "BR2_PACKAGE_WPA_SUPPLICANT_PASSPHRASE=y",
            "BR2_PACKAGE_ZSTD=y",
        }
        self.assertEqual(lines, required)
        text = FRAGMENT.read_text(encoding="utf-8").lower()
        self.assertNotIn("alpine", text)
        self.assertNotIn("apk", text)

    def test_post_build_reuses_canonical_dev_helpers_instead_of_copying_logic(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        for helper in (
            "ordax-network",
            "ordax-pull",
            "ordax-rollback",
            "ordax-run",
            "ordax-diagnose",
        ):
            self.assertIn(f'cp "$ROOT/bootstrap/dev-base/$helper"', script)
        self.assertIn(
            'cp "$ROOT/bootstrap/dev-base/ordax-dev-init" "$TARGET_DIR/sbin/ordax-dev-init"',
            script,
        )
        self.assertIn(
            'cp "$ROOT/bootstrap/recovery/entrypoint" "$TARGET_DIR/ordax/bootstrap/recovery/entrypoint"',
            script,
        )
        self.assertNotIn("apk add", script)
        self.assertNotIn("alpine_core.py", script)

    def test_owner_helpers_are_fail_closed_on_complete_capability_set(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        for target in (
            "$TARGET_DIR/usr/bin/git",
            "$TARGET_DIR/usr/sbin/iw",
            "$TARGET_DIR/usr/sbin/wpa_supplicant",
            "$TARGET_DIR/usr/bin/wpa_passphrase",
        ):
            self.assertIn(target, script)
        self.assertIn("Incomplete Owner/Development target capability set", script)
        self.assertIn("ORDAX_OWNER_DEVELOPMENT_PROFILE=YES", script)


if __name__ == "__main__":
    unittest.main()
