import json
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORTER = ROOT / "system/services/device-agent/product-presence-report.sh"
CONTRACT = ROOT / "docs/contracts/product-device-presence.json"


class ProductDevicePresenceReporterTests(unittest.TestCase):
    def test_reporter_is_shell_valid_and_fail_soft(self):
        subprocess.run(["sh", "-n", str(REPORTER)], check=True)
        text = REPORTER.read_text(encoding="utf-8")
        self.assertIn('CONTROL_PLANE_URL=${ORDAX_PRODUCT_CONTROL_PLANE_URL:-}', text)
        self.assertIn('write_result unconfigured', text)
        self.assertIn('write_result unenrolled', text)
        self.assertIn('write_result offline', text)
        self.assertIn('exit 0', text)
        self.assertNotIn('exit 1', text)

    def test_reporter_uses_same_persistent_native_state_as_enrollment(self):
        text = REPORTER.read_text(encoding="utf-8")
        self.assertIn('STATE_DIR=${ORDAX_STATE_DIR:-/state/ordax}', text)
        self.assertIn('AGENT_DIR=${ORDAX_PRODUCT_DEVICE_AGENT_DIR:-$STATE_DIR/native-state/device-agent}', text)
        self.assertIn('CREDENTIAL_FILE=${ORDAX_PRODUCT_DEVICE_CREDENTIAL_FILE:-$AGENT_DIR/product-device.json}', text)
        self.assertNotIn('AGENT_DIR=$STATE_DIR/device-agent', text)

        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
        credential = value["credential"]
        self.assertEqual(
            credential["path"],
            "/state/ordax/native-state/device-agent/product-device.json",
        )
        self.assertEqual(
            credential["nativeRuntimePath"],
            "/var/lib/ordax/device-agent/product-device.json",
        )
        self.assertTrue(credential["singlePersistentCopy"])

    def test_reporter_is_one_shot_and_does_not_own_heartbeat(self):
        text = REPORTER.read_text(encoding="utf-8")
        for forbidden in ('while :', 'sleep ', 'PID_FILE', 'trap ', 'setsid ', 'nohup ', '&\n'):
            self.assertNotIn(forbidden, text)
        self.assertIn('REQUESTED_STATE=${1:-online}', text)
        self.assertIn('online) ONLINE=true', text)
        self.assertIn('offline) ONLINE=false', text)

    def test_reporter_uses_exact_device_presence_boundary(self):
        text = REPORTER.read_text(encoding="utf-8")
        self.assertIn('/v3/product/device/presence', text)
        self.assertIn('X-Ordax-Device-Id: $DEVICE_ID', text)
        self.assertIn('X-Ordax-Device-Token: $DEVICE_TOKEN', text)
        self.assertIn('"runtime_kind":"ordax-os"', text)
        self.assertIn('"capability_digest":null', text)
        self.assertIn('/bin/busybox wget', text)
        for forbidden in ('curl ', 'ssh ', 'eval ', 'sh -c', '--no-check-certificate'):
            self.assertNotIn(forbidden, text)

    def test_credentials_are_private_and_not_self_minted(self):
        text = REPORTER.read_text(encoding="utf-8")
        self.assertIn('[ "$mode" = "600" ]', text)
        self.assertIn('[ ! -L "$CREDENTIAL_FILE" ]', text)
        self.assertIn('is_uuid "$DEVICE_ID"', text)
        self.assertIn('is_hex64 "$DEVICE_TOKEN"', text)
        for forbidden in ('/v3/device/setup', 'operation":"enroll', '/dev/urandom', 'random/uuid'):
            self.assertNotIn(forbidden, text)

    def test_contract_keeps_production_enrollment_and_second_heartbeat_closed(self):
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
        lifecycle = value["lifecycle"]
        self.assertEqual(value["status"], "owner-development-usb-native-presence-source-candidate")
        self.assertEqual(lifecycle["reportMode"], "managed-native-worker")
        self.assertTrue(lifecycle["ownsHeartbeatLoop"])
        self.assertFalse(lifecycle["dualWritesLegacyAndCanonical"])
        self.assertTrue(lifecycle["enrollmentImplemented"])
        self.assertFalse(lifecycle["bootDependency"])
        self.assertFalse(lifecycle["grantsRemoteActions"])
        self.assertFalse(lifecycle["opensInboundPort"])
        self.assertFalse(value["production"]["enabled"])
        self.assertFalse(lifecycle["legacyShellReporterMounted"])
        self.assertTrue(lifecycle["stopsOnAccountLogout"])
        self.assertTrue(lifecycle["stopsOnNativeHostShutdown"])
        self.assertEqual(value["transport"]["canonicalIngress"], "https://ordax-mcp.ordaxsystems.workers.dev")
        self.assertTrue(value["externalMcp"]["modelRouterSeparateFromMcp"])
        self.assertTrue(value["ownerDevelopment"]["automaticEnrollment"])
        self.assertEqual(value["ownerDevelopment"]["enrollmentTrigger"], "after-successful-verified-native-account-session")
        self.assertEqual(value["status"], "owner-development-usb-native-presence-source-candidate")


    def test_account_login_enrollment_is_not_external_mcp_authorization(self):
        """No implied ChatGPT OAuth consent, device grants, or action runtime."""
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
        mcp = value["externalMcp"]
        self.assertFalse(mcp["accountLoginAutomaticallyConnectsExternalClient"])
        self.assertTrue(mcp["devicePresenceRuntimeMounted"])
        self.assertFalse(mcp["attestedMcpSessionImplementedInOs"])
        self.assertFalse(mcp["remoteActionRuntimePackagedInOs"])
        self.assertFalse(mcp["remoteActionDispatchEnabled"])
        self.assertTrue(mcp["oauthClientConsentRequired"])
        self.assertTrue(mcp["deviceScopedCapabilityGrantRequired"])
        self.assertTrue(mcp["chatGptAccountDistinctFromOrdaxAccount"])

        source = (ROOT / "system/surface/runtime/product_device_runtime.py").read_text(encoding="utf-8")
        self.assertIn("after_authenticated_login", source)
        self.assertIn("compose_product_device_account_gateway", source)
        self.assertIn("ProductDevicePresenceWorker", source)
        self.assertIn('distribution_profile != "owner-development"', source)
        self.assertIn('product_mode != "usb"', source)
        runtime_lock = json.loads((ROOT / "system/services/device-agent/studio-runtime-source-lock.json").read_text(encoding="utf-8"))
        self.assertFalse(runtime_lock["distribution"]["runtime_packaged_in_stable"])
        self.assertFalse(runtime_lock["activation"]["dispatch_enabled"])

if __name__ == "__main__":
    unittest.main()
