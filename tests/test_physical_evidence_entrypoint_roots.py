from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ATA_ENTRYPOINT = ROOT / "system" / "surface" / "bin" / "ordax-ata-evidence"
PERFORMANCE_ENTRYPOINT = ROOT / "system" / "surface" / "bin" / "ordax-performance-evidence"


class PhysicalEvidenceEntrypointRootTests(unittest.TestCase):
    def test_ata_physical_entrypoint_rejects_test_fixture_root_override(self):
        source = ATA_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("--sys-class-root|--sys-class-root=*)", source)
        self.assertIn("--sys-class-root is test-only and is not accepted by the physical entrypoint", source)
        self.assertIn(
            'exec /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$SCRIPT" "$@"',
            source,
        )

    def test_performance_physical_entrypoint_rejects_test_fixture_root_override(self):
        source = PERFORMANCE_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("--proc-root|--proc-root=*)", source)
        self.assertIn("--proc-root is test-only and is not accepted by the physical entrypoint", source)
        self.assertIn(
            'exec /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$SCRIPT" "$@"',
            source,
        )


if __name__ == "__main__":
    unittest.main()
