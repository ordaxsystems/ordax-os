from __future__ import annotations

from pathlib import Path
import sys
import unittest

RUNTIME = Path(__file__).resolve().parents[1] / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

from native_store_https_origin import StoreHttpsOriginError, normalize_store_https_base_origin
from native_store_catalog_acquisition import (
    StoreCatalogAcquisitionError,
    catalog_envelope_url,
    normalize_catalog_base_origin,
)
from native_app_artifact_acquisition import (
    AppArtifactAcquisitionError,
    artifact_url,
    normalize_https_base_origin,
)


IDENTITY = {"name": "notes.zip", "sha256": "a" * 64, "size": 3}


class CanonicalStoreHttpsOriginTests(unittest.TestCase):
    def test_both_native_transports_share_identical_base_origin_normalization(self) -> None:
        for origin, expected in (
            ("https://store.example.test", "https://store.example.test/"),
            ("https://store.example.test/catalog", "https://store.example.test/catalog/"),
            ("https://store.example.test:443/catalog/", "https://store.example.test:443/catalog/"),
        ):
            with self.subTest(origin=origin):
                self.assertEqual(normalize_store_https_base_origin(origin), expected)
                self.assertEqual(normalize_catalog_base_origin(origin), expected)
                self.assertEqual(normalize_https_base_origin(origin), expected)

    def test_ambiguous_or_unsafe_base_origins_fail_closed_for_both_transports(self) -> None:
        cases = [
            "",
            " http://store.example.test/",
            "http://store.example.test/",
            "https://user:password@store.example.test/",
            "https://store.example.test/catalog?source=1",
            "https://store.example.test/catalog#end",
            "https://store.example.test/a/../catalog/",
            "https://store.example.test/a/./catalog/",
            "https://store.example.test/%2e%2e/catalog/",
            "https://store.example.test/%252e%252e/catalog/",
            "https://store.example.test/a%2fb/catalog/",
            "https://store.example.test/%5c..%5c/",
            "https://store.example.test:0/catalog/",
            "https://store.example.test:65536/catalog/",
            "https://store.example.test:wrong/catalog/",
            "https://store.example.test:\t443/catalog/",
            "https://store.example.test/line\nbreak/",
            "https://store.example.test/a\\b/",
            "https://store.example.test/%00/catalog/",
        ]
        for origin in cases:
            with self.subTest(origin=repr(origin)):
                with self.assertRaises(StoreHttpsOriginError):
                    normalize_store_https_base_origin(origin)
                with self.assertRaises(AppArtifactAcquisitionError):
                    normalize_https_base_origin(origin)
                with self.assertRaises(StoreCatalogAcquisitionError):
                    normalize_catalog_base_origin(origin)

    def test_both_final_urls_only_append_fixed_canonical_leaf(self) -> None:
        self.assertEqual(
            catalog_envelope_url("https://store.example.test/catalog"),
            "https://store.example.test/catalog/catalog-envelope.json",
        )
        digest = IDENTITY["sha256"]
        self.assertEqual(
            artifact_url("https://store.example.test/blobs", IDENTITY),
            f"https://store.example.test/blobs/sha256/{digest[:2]}/{digest}",
        )
        with self.assertRaises(StoreCatalogAcquisitionError):
            catalog_envelope_url("https://store.example.test/%2e%2e/catalog")
        with self.assertRaises(AppArtifactAcquisitionError):
            artifact_url("https://store.example.test/%2e%2e/blobs", IDENTITY)


if __name__ == "__main__":
    unittest.main()
