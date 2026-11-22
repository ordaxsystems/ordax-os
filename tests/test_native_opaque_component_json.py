"""Pure Windows/Linux regression for verified Aura JSON-module imports."""
from email.message import Message
import importlib.util
from pathlib import Path
import unittest

POLICY = (
    Path(__file__).resolve().parents[1]
    / "system/surface/runtime/native_request_boundary.py"
)
spec = importlib.util.spec_from_file_location("ordax_opaque_json_policy_test", POLICY)
boundary = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(boundary)

ADDRESS = ("127.0.0.1", 8765)
AURA_JSON = (
    "/__ordax/native/component-module/assistant/pending/0.1.3/"
    + "a" * 40 + "/system/apps/assistant/app.json"
)


def headers(**replacements):
    fields = {
        "Host": "127.0.0.1:8765",
        "Origin": "null",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "json",
        "Sec-Fetch-Site": "cross-site",
    }
    fields.update(replacements)
    result = Message()
    for name, value in fields.items():
        if value is not None:
            result.add_header(name, value)
    return result


class NativeOpaqueComponentJsonTests(unittest.TestCase):
    def test_signed_pending_aura_json_import_is_readable_from_opaque_frame(self):
        self.assertTrue(boundary.request_is_trusted(headers(), ADDRESS, AURA_JSON, "GET"))

    def test_only_exact_opaque_json_module_request_is_readable(self):
        bad = (
            ("Origin", "http://127.0.0.1:8765"),
            ("Origin", "https://attacker.invalid"),
            ("Origin", None),
            ("Sec-Fetch-Mode", "no-cors"),
            ("Sec-Fetch-Mode", "navigate"),
            ("Sec-Fetch-Dest", "script"),
            ("Sec-Fetch-Dest", "empty"),
            ("Sec-Fetch-Site", "same-origin"),
            ("Sec-Fetch-Site", "same-site"),
            ("Host", "localhost:8765"),
            ("Cookie", "session=secret"),
            ("Authorization", "Bearer private"),
            ("Referer", "http://127.0.0.1:8765/"),
        )
        for field, value in bad:
            with self.subTest(field=field, value=value):
                self.assertFalse(
                    boundary.request_is_trusted(headers(**{field: value}), ADDRESS, AURA_JSON, "GET")
                )

    def test_json_read_cannot_be_promoted_to_other_methods_or_native_apis(self):
        for method in ("HEAD", "POST", "OPTIONS", "DELETE"):
            with self.subTest(method=method):
                self.assertFalse(boundary.request_is_trusted(headers(), ADDRESS, AURA_JSON, method))
        for path in (
            AURA_JSON + "?test=1",
            AURA_JSON + "#fragment",
            "/__ordax/native/session",
            "/__ordax/native/component-runtime?component=assistant",
            "/__ordax/native/app-data/private.json",
            "/auth/session",
            "/sync/private.json",
        ):
            with self.subTest(path=path):
                self.assertFalse(boundary.request_is_trusted(headers(), ADDRESS, path, "GET"))

    def test_missing_or_repeated_origin_and_fetch_headers_are_denied(self):
        for name in ("Origin", "Sec-Fetch-Mode", "Sec-Fetch-Dest", "Sec-Fetch-Site"):
            with self.subTest(header=name):
                self.assertFalse(
                    boundary.request_is_trusted(headers(**{name: None}), ADDRESS, AURA_JSON, "GET")
                )
                duplicate = headers()
                duplicate.add_header(name, duplicate[name])
                self.assertFalse(boundary.request_is_trusted(duplicate, ADDRESS, AURA_JSON, "GET"))


if __name__ == "__main__":
    unittest.main()
