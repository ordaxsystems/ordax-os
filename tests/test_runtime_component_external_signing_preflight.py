import base64
import hashlib
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFLIGHT_PATH = ROOT / "tools" / "runtime-component-channel" / "check_external_signing_preflight.py"

spec = importlib.util.spec_from_file_location("external_signing_preflight", PREFLIGHT_PATH)
preflight = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(preflight)

from tests.test_runtime_component_unsigned_candidate import make_candidate


def canonical(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def make_platform(root: Path):
    contracts = root / "docs" / "contracts"
    contracts.mkdir(parents=True)
    for name in (
        "runtime-component-trust-policy.json",
        "runtime-component-package.json",
    ):
        shutil.copy2(ROOT / "docs" / "contracts" / name, contracts / name)


class ExternalSigningPreflightTests(unittest.TestCase):
    def test_current_policy_is_blocked_safe_after_candidate_verification(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            platform = work / "platform"
            platform.mkdir()
            make_platform(platform)
            candidate, _, _ = make_candidate(work / "fixture")

            result = preflight.evaluate(platform, candidate)

        self.assertFalse(result["eligible"])
        self.assertFalse(result["activation_allowed"])
        self.assertEqual(
            result["blockers"],
            [
                preflight.BLOCKER_ANCHOR,
                preflight.BLOCKER_PUBLICATION,
            ],
        )

    def test_unpinned_policy_rejects_unexpected_anchor_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            platform = work / "platform"
            platform.mkdir()
            make_platform(platform)
            candidate, _, _ = make_candidate(work / "fixture")
            anchor = platform / "system" / "trust" / "runtime-components-ed25519.json"
            anchor.parent.mkdir(parents=True)
            anchor.write_text("{}\n", encoding="utf-8")

            with self.assertRaisesRegex(
                preflight.SigningPreflightError,
                "anchor file exists while canonical anchor gate is false",
            ):
                preflight.evaluate(platform, candidate)

    def test_publication_ready_state_can_be_signing_eligible_without_activation(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            platform = work / "platform"
            platform.mkdir()
            make_platform(platform)
            candidate, _, _ = make_candidate(work / "fixture")

            trust_path = platform / "docs" / "contracts" / "runtime-component-trust-policy.json"
            package_path = platform / "docs" / "contracts" / "runtime-component-package.json"
            trust = json.loads(trust_path.read_text(encoding="utf-8"))
            package = json.loads(package_path.read_text(encoding="utf-8"))

            anchor_value = {
                "$schema": preflight.TRUST_SCHEMA,
                "key_id": preflight.KEY_ID,
                "public_key_base64": base64.b64encode(b"x" * 32).decode("ascii"),
            }
            anchor_bytes = canonical(anchor_value)
            anchor_path = platform / "system" / "trust" / "runtime-components-ed25519.json"
            anchor_path.parent.mkdir(parents=True)
            anchor_path.write_bytes(anchor_bytes)

            trust["status"] = "canonical-anchor-pinned-publication-authorized"
            trust["public_anchor"]["pinned"] = True
            trust["public_anchor"]["sha256"] = hashlib.sha256(anchor_bytes).hexdigest()
            trust["current_gates"]["canonical_component_trust_anchor_pinned"] = True
            trust["current_gates"]["component_publish_allowed"] = True
            trust["current_gates"]["production_component_slot_activation_allowed"] = False
            trust_path.write_bytes(canonical(trust))

            package["canonical_component_trust_anchor_pinned"] = True
            package["publish_allowed"] = True
            package["slot_activation_available"] = False
            package_path.write_bytes(canonical(package))

            result = preflight.evaluate(platform, candidate)

        self.assertTrue(result["eligible"])
        self.assertFalse(result["activation_allowed"])
        self.assertEqual(result["blockers"], [])


if __name__ == "__main__":
    unittest.main()
