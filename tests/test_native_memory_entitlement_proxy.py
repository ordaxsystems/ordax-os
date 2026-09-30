import json
import unittest

from system.surface.runtime.native_memory_entitlement_proxy import (
    ENTITLEMENTS_SCHEMA,
    MEMORY_CLOUD_ENTITLEMENT,
    NativeMemoryEntitlementProxyError,
    read_native_memory_cloud_entitlement,
)


class Reply:
    def __init__(self, status=200, body=b""):
        self.status = status
        self.body = body


def decision(**overrides):
    payload = {
        "schema": ENTITLEMENTS_SCHEMA,
        "subjectType": "account",
        "subjectId": "account-a",
        "key": MEMORY_CLOUD_ENTITLEMENT,
        "decision": "allowed",
        "value": None,
        "authority": "server",
        "expiresAt": None,
    }
    payload.update(overrides)
    return payload


class Gateway:
    def __init__(self, reply):
        self.reply = reply
        self.calls = 0

    def memory_cloud_entitlement(self):
        self.calls += 1
        return self.reply


class NativeMemoryEntitlementProxyTests(unittest.TestCase):
    def test_proxy_calls_only_fixed_gateway_method_without_surface_arguments(self):
        gateway = Gateway(Reply(200, json.dumps(decision()).encode("utf-8")))

        result = read_native_memory_cloud_entitlement(gateway)

        self.assertEqual(gateway.calls, 1)
        self.assertEqual(result.status, 200)
        self.assertEqual(result.payload["key"], MEMORY_CLOUD_ENTITLEMENT)
        self.assertEqual(result.payload["authority"], "server")
        self.assertEqual(result.payload["subjectId"], "account-a")

    def test_proxy_rejects_non_server_authority(self):
        gateway = Gateway(Reply(200, json.dumps(decision(authority="local-default")).encode("utf-8")))

        with self.assertRaisesRegex(NativeMemoryEntitlementProxyError, "authority"):
            read_native_memory_cloud_entitlement(gateway)

    def test_proxy_rejects_wrong_key_or_subject_domain(self):
        wrong_key = Gateway(Reply(200, json.dumps(decision(key="spaces.shared.create")).encode("utf-8")))
        with self.assertRaisesRegex(NativeMemoryEntitlementProxyError, "key"):
            read_native_memory_cloud_entitlement(wrong_key)

        wrong_subject = Gateway(Reply(200, json.dumps(decision(subjectType="space")).encode("utf-8")))
        with self.assertRaisesRegex(NativeMemoryEntitlementProxyError, "subject type"):
            read_native_memory_cloud_entitlement(wrong_subject)

    def test_proxy_rejects_extra_fields_and_non_null_value(self):
        extra = decision()
        extra["grantId"] = "server-row-id"
        with self.assertRaisesRegex(NativeMemoryEntitlementProxyError, "shape"):
            read_native_memory_cloud_entitlement(
                Gateway(Reply(200, json.dumps(extra).encode("utf-8")))
            )

        with self.assertRaisesRegex(NativeMemoryEntitlementProxyError, "value must be null"):
            read_native_memory_cloud_entitlement(
                Gateway(Reply(200, json.dumps(decision(value={"enabled": True})).encode("utf-8")))
            )

    def test_upstream_failures_are_status_only_and_cannot_smuggle_provider_payload(self):
        gateway = Gateway(Reply(503, b'{"provider":"supabase","token":"secret"}'))

        result = read_native_memory_cloud_entitlement(gateway)

        self.assertEqual(result.status, 503)
        self.assertIsNone(result.payload)

    def test_redirect_or_malformed_success_fails_closed(self):
        with self.assertRaisesRegex(NativeMemoryEntitlementProxyError, "unexpected"):
            read_native_memory_cloud_entitlement(Gateway(Reply(302, b"")))

        with self.assertRaisesRegex(NativeMemoryEntitlementProxyError, "JSON"):
            read_native_memory_cloud_entitlement(Gateway(Reply(200, b"not-json")))

    def test_missing_gateway_method_fails_closed(self):
        with self.assertRaisesRegex(NativeMemoryEntitlementProxyError, "unavailable"):
            read_native_memory_cloud_entitlement(object())


if __name__ == "__main__":
    unittest.main()
