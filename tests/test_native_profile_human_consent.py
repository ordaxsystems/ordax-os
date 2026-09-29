from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE = RUNTIME / "native_profile_human_consent.py"


def load_module():
    sys.path.insert(0, str(RUNTIME))
    try:
        spec = spec_from_file_location("ordax_profile_human_consent_test", MODULE)
        module = module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(RUNTIME))


class NativeProfileHumanConsentTests(unittest.TestCase):
    def test_receipt_is_one_shot_and_bound_to_exact_intent(self):
        module = load_module()
        authority = module.ProfileHumanConsentAuthority(secret=b"x" * 32, ttl_ms=1000)
        profile = {"slug": "developer", "version": 1}
        receipt = authority.issue(
            permission_diff_sha256="a" * 64,
            expected_revision=7,
            space_id="space-1",
            profile=profile,
            now_ms=100,
        )
        authority.consume(
            receipt,
            permission_diff_sha256="a" * 64,
            expected_revision=7,
            space_id="space-1",
            profile=profile,
            now_ms=200,
        )
        with self.assertRaisesRegex(PermissionError, "already consumed"):
            authority.consume(
                receipt,
                permission_diff_sha256="a" * 64,
                expected_revision=7,
                space_id="space-1",
                profile=profile,
                now_ms=300,
            )

    def test_receipt_rejects_changed_revision_digest_and_expiry(self):
        module = load_module()
        authority = module.ProfileHumanConsentAuthority(secret=b"y" * 32, ttl_ms=100)
        profile = {"slug": "developer", "version": 1}
        receipt = authority.issue(
            permission_diff_sha256="b" * 64,
            expected_revision=2,
            space_id="space-2",
            profile=profile,
            now_ms=1000,
        )
        with self.assertRaisesRegex(PermissionError, "does not match"):
            authority.consume(
                receipt,
                permission_diff_sha256="c" * 64,
                expected_revision=2,
                space_id="space-2",
                profile=profile,
                now_ms=1050,
            )
        with self.assertRaisesRegex(PermissionError, "expired"):
            authority.consume(
                receipt,
                permission_diff_sha256="b" * 64,
                expected_revision=2,
                space_id="space-2",
                profile=profile,
                now_ms=1200,
            )

    def test_no_http_entrypoint_is_declared(self):
        source = MODULE.read_text(encoding="utf-8")
        self.assertNotIn("BaseHTTPRequestHandler", source)
        self.assertNotIn("do_POST", source)
        self.assertNotIn("http.server", source)


if __name__ == "__main__":
    unittest.main()
