import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"


class NativeMemoryEntitlementHostRouteContractTests(unittest.TestCase):
    def test_host_dispatches_only_fixed_memory_entitlement_route_through_sanitizer(self):
        source = HOST.read_text(encoding="utf-8")

        self.assertIn(
            "from native_memory_entitlement_proxy import (",
            source,
        )
        self.assertIn("NativeMemoryEntitlementProxyError,", source)
        self.assertIn("read_native_memory_cloud_entitlement,", source)
        self.assertIn(
            'ACCOUNT_MEMORY_ENTITLEMENT_PATH = "/account/entitlements/memory-cloud"',
            source,
        )
        self.assertIn("ACCOUNT_MEMORY_ENTITLEMENT_PATH,", source)
        self.assertIn(
            "if parsed_path == ACCOUNT_MEMORY_ENTITLEMENT_PATH and urlsplit(self.path).query:",
            source,
        )
        self.assertIn(
            "reply = read_native_memory_cloud_entitlement(self.server.account_gateway)",
            source,
        )
        self.assertIn("except NativeMemoryEntitlementProxyError:", source)

        # The Surface must not be allowed to choose an upstream path, subject,
        # entitlement key or authorization value at this boundary.
        self.assertNotIn("memory_cloud_entitlement(self.path", source)
        self.assertNotIn("read_native_memory_cloud_entitlement(self.server.account_gateway,", source)


if __name__ == "__main__":
    unittest.main()
