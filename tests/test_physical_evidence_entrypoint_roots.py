from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ATA_ENTRYPOINT = ROOT / "system" / "surface" / "bin" / "ordax-ata-evidence"
PERFORMANCE_ENTRYPOINT = ROOT / "system" / "surface" / "bin" / "ordax-performance-evidence"


class PhysicalEvidenceEntrypointRootTests(unittest.TestCase):
    def test_ata_physical_entrypoint_has_strict_argument_allowlist(self):
        source = ATA_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("validate_arguments()", source)
        self.assertIn("-h|--help)", source)
        self.assertIn("unsupported physical entrypoint argument", source)
        self.assertNotIn("--sys-class-root", source)
        self.assertIn(
            'exec /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$SCRIPT" "$@"',
            source,
        )

    def test_performance_physical_entrypoint_allows_only_sampling_controls(self):
        source = PERFORMANCE_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("validate_arguments()", source)
        self.assertIn("-h|--help)", source)
        self.assertIn("--samples|--interval-seconds)", source)
        self.assertIn("--samples=*|--interval-seconds=*)", source)
        self.assertIn("unsupported physical entrypoint argument", source)
        self.assertNotIn("--proc-root", source)
        self.assertIn(
            'exec /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$SCRIPT" "$@"',
            source,
        )


if __name__ == "__main__":
    unittest.main()
