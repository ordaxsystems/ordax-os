"""Build reuse invariants are enforced in-repository, not in conversation state."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
OWNER = ROOT / ".github/workflows/creator-owner-dev-git.yml"
SURFACE = ROOT / ".github/workflows/independent-surface-runtime.yml"
R2 = ROOT / "tools/ci/independent_surface_r2.sh"
CACHE = "tools/ci/independent_surface_component_cache.py"
GROUP = "ordax-surface-producer-${{ github.event.pull_request.number || github.ref }}"
ARTIFACT_KEY = "ordax-independent-surface-artifact-v1-${{ runner.os }}-${{ runner.arch }}-"


class OwnerSurfaceCacheContractTests(unittest.TestCase):
    def test_both_jobs_share_one_build_owner_and_byte_identity(self):
        owner = OWNER.read_text(encoding="utf-8")
        producer = SURFACE.read_text(encoding="utf-8")
        for text in (owner, producer):
            self.assertIn(GROUP, text)
            self.assertNotIn("ordax-surface-producer-${{ github.event.pull_request.head.sha || github.sha }}", text)
            self.assertIn("cancel-in-progress: false", text)
            self.assertIn(ARTIFACT_KEY, text)
            self.assertIn("${{ runner.temp }}/ordax-independent-surface", text)
            self.assertIn(CACHE, text)

    def test_both_consume_same_verified_r2_transport(self):
        owner = OWNER.read_text(encoding="utf-8")
        producer = SURFACE.read_text(encoding="utf-8")
        for text in (owner, producer):
            self.assertIn("bash tools/ci/independent_surface_r2.sh restore", text)
            self.assertIn("bash tools/ci/independent_surface_r2.sh publish", text)
            self.assertIn("secrets.ORDAX_R2_ACCESS_KEY_ID", text)
            self.assertIn("secrets.ORDAX_R2_SECRET_ACCESS_KEY", text)
        self.assertIn("If-None-Match: *", R2.read_text(encoding="utf-8"))
        self.assertIn("independent_surface_component_cache.py verify", R2.read_text(encoding="utf-8"))

    def test_owner_miss_records_verifies_and_publishes_exact_bytes(self):
        text = OWNER.read_text(encoding="utf-8")
        self.assertIn("owner-surface-r2.outputs.hit", text)
        self.assertIn("python3 " + CACHE + " record", text)
        self.assertIn("python3 " + CACHE + " verify", text)
        self.assertIn("--cache-hit false", text)
        self.assertIn("--cache-hit true --consumer", text)
        self.assertIn("Save verified Owner Surface EROFS to shared artifact cache", text)
        self.assertIn("Ensure verified Owner Surface exists in durable R2 store", text)
        self.assertIn("git diff --exit-code -- \"$config\"", text)
        self.assertIn('cp -a "$out/." "$RUNNER_TEMP/owner-dev-surface-runtime/"', text)

    def test_compiler_objects_survive_source_config_change(self):
        for path in (OWNER, SURFACE):
            text = path.read_text(encoding="utf-8")
            self.assertIn("ordax-independent-surface-ccache-v2-", text)
            self.assertIn("github.run_id", text)
            self.assertIn("restore-keys: |\n            ordax-independent-surface-ccache-v2-", text)
            self.assertIn("ordax-independent-surface-ccache-v1-", text)
        # The actual fingerprint of published EROFS must remain exact;
        # broad compiler cache reuse is safe only within ccache itself.
        self.assertIn("input_fingerprint", (ROOT / CACHE).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
