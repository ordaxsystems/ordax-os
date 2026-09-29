from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
AUTHORITY_MODULE = RUNTIME / "native_profile_human_consent.py"
PRESENTER_MODULE = RUNTIME / "native_profile_consent_presenter.py"


def load_module(path, name):
    sys.path.insert(0, str(RUNTIME))
    try:
        spec = spec_from_file_location(name, path)
        module = module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(RUNTIME))


class NativeProfileConsentPresenterTests(unittest.TestCase):
    def test_approval_mints_one_shot_receipt_only_after_native_decision(self):
        presenter_module = load_module(PRESENTER_MODULE, "ordax_profile_consent_presenter_test")
        authority = presenter_module.ProfileHumanConsentAuthority(secret=b"z" * 32, ttl_ms=1000)
        coordinator = presenter_module.ProfileHumanConsentCoordinator(authority, ttl_ms=500)
        permission_diff = {
            "schema": "ordax.profile-permission-diff/1",
            "componentAdds": [{"id": "knowledge.example"}],
            "componentRemovals": [],
            "authorityChanges": [],
            "requiresExplicitReview": True,
        }
        request = coordinator.prepare(
            permission_diff=permission_diff,
            permission_diff_sha256="a" * 64,
            expected_revision=9,
            space_id="space-1",
            space_kind="professional",
            profile={"slug": "developer", "version": 1},
            now_ms=100,
        )
        self.assertNotIn("mac", request)
        receipt = coordinator.decide({
            "schema": "ordax.profile-human-consent-decision/1",
            "requestId": request["requestId"],
            "approved": True,
        }, now_ms=150)
        self.assertEqual(receipt["permissionDiffSha256"], "a" * 64)
        authority.consume(
            receipt,
            permission_diff_sha256="a" * 64,
            expected_revision=9,
            space_id="space-1",
            profile={"slug": "developer", "version": 1},
            now_ms=200,
        )

    def test_reject_is_terminal_and_does_not_mint_receipt(self):
        presenter_module = load_module(PRESENTER_MODULE, "ordax_profile_consent_presenter_test_reject")
        authority = presenter_module.ProfileHumanConsentAuthority(secret=b"q" * 32, ttl_ms=1000)
        coordinator = presenter_module.ProfileHumanConsentCoordinator(authority, ttl_ms=500)
        request = coordinator.prepare(
            permission_diff={
                "schema": "ordax.profile-permission-diff/1",
                "componentAdds": [],
                "componentRemovals": [],
                "authorityChanges": [],
                "requiresExplicitReview": True,
            },
            permission_diff_sha256="b" * 64,
            expected_revision=1,
            space_id="space-2",
            space_kind="professional",
            profile={"slug": "developer", "version": 1},
            now_ms=100,
        )
        result = coordinator.decide({
            "schema": "ordax.profile-human-consent-decision/1",
            "requestId": request["requestId"],
            "approved": False,
        }, now_ms=150)
        self.assertIsNone(result)
        with self.assertRaisesRegex(PermissionError, "already decided"):
            coordinator.decide({
                "schema": "ordax.profile-human-consent-decision/1",
                "requestId": request["requestId"],
                "approved": True,
            }, now_ms=160)

    def test_expired_request_fails_closed_and_no_http_is_declared(self):
        presenter_module = load_module(PRESENTER_MODULE, "ordax_profile_consent_presenter_test_expiry")
        authority = presenter_module.ProfileHumanConsentAuthority(secret=b"r" * 32, ttl_ms=1000)
        coordinator = presenter_module.ProfileHumanConsentCoordinator(authority, ttl_ms=50)
        request = coordinator.prepare(
            permission_diff={
                "schema": "ordax.profile-permission-diff/1",
                "componentAdds": [],
                "componentRemovals": [],
                "authorityChanges": [],
                "requiresExplicitReview": True,
            },
            permission_diff_sha256="c" * 64,
            expected_revision=3,
            space_id="space-3",
            space_kind="professional",
            profile={"slug": "developer", "version": 1},
            now_ms=100,
        )
        with self.assertRaisesRegex(PermissionError, "expired"):
            coordinator.decide({
                "schema": "ordax.profile-human-consent-decision/1",
                "requestId": request["requestId"],
                "approved": True,
            }, now_ms=200)
        source = PRESENTER_MODULE.read_text(encoding="utf-8")
        self.assertNotIn("BaseHTTPRequestHandler", source)
        self.assertNotIn("do_POST", source)
        self.assertNotIn("http.server", source)


if __name__ == "__main__":
    unittest.main()
