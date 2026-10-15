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
        self.assertEqual(value["status"], "foundation-not-mounted")
        self.assertEqual(lifecycle["reportMode"], "one-shot")
        self.assertFalse(lifecycle["ownsHeartbeatLoop"])
        self.assertFalse(lifecycle["dualWritesLegacyAndCanonical"])
        self.assertFalse(lifecycle["enrollmentImplemented"])
        self.assertFalse(lifecycle["bootDependency"])
        self.assertFalse(lifecycle["grantsRemoteActions"])
        self.assertFalse(lifecycle["opensInboundPort"])
        self.assertFalse(value["production"]["enabled"])
        self.assertFalse(value["ownerDevelopment"]["automaticEnrollment"])


if __name__ == "__main__":
    unittest.main()
