from pathlib import Path
import json
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
PORTABLE_INIT = ROOT / "bootstrap/initramfs/portable_init.sh"
MOUNT_HELPER = ROOT / "bootstrap/initramfs/portable_mount.c"
STABLE_INIT = ROOT / "bootstrap/stable-base/ordax-stable-init"
INITRAMFS_SOURCE = ROOT / "bootstrap/initramfs/source.json"
INTELLIGENCE_CONTRACT = ROOT / "docs/contracts/intelligence.json"
BOOT_HANDOFF_CONTRACT = ROOT / "docs/contracts/portable-boot-handoff.json"


class PortableV4AiHandoffContractTests(unittest.TestCase):
    def test_v4_is_verified_before_legacy_v3_v2_paths(self):
        text = PORTABLE_INIT.read_text(encoding="utf-8")
        self.assertLess(text.index("verify-portable-v4-exact"), text.index("verify-portable-v3-exact"))
        self.assertLess(text.index("verify-portable-v3-exact"), text.index("verify-portable-exact"))
        self.assertIn("local-ai-runtime.sha256", text)
        self.assertIn("ai-runtimes/sha256", text)
        self.assertIn("SELECTED_MANIFEST_SCHEMA=4", text)
        self.assertIn("SELECTED_AI_RUNTIME_SHA256", text)

    def test_v4_ai_mount_is_verified_read_only_and_non_boot_critical(self):
        init = PORTABLE_INIT.read_text(encoding="utf-8")
        helper = MOUNT_HELPER.read_text(encoding="utf-8")
        source = json.loads(INITRAMFS_SOURCE.read_text(encoding="utf-8"))
        self.assertIn("mount-ai-runtime", init)
        self.assertIn("mount-ai-runtime", helper)
        self.assertIn('mount(runtime.device, runtime_root, "erofs", ro_flags, NULL)', helper)
        self.assertIn("MS_RDONLY | MS_NODEV | MS_NOSUID", helper)
        for required in (
            "bin/llama-server",
            "bin/ordax-local-ai",
            "metadata/source-lock.json",
            "metadata/runtime-policy.json",
        ):
            self.assertIn(required, helper)
        self.assertIn("continuing with Intelligence degraded", init)
        self.assertNotIn('rescue "cannot mount exactly verified local AI runtime"', init)
        candidate = source["portable_v2_prerequisites"]["candidate_pid1"]
        self.assertTrue(candidate["release_manifest_v4_supported"])
        self.assertTrue(candidate["local_ai_runtime_verified_handoff"])
        self.assertFalse(candidate["local_ai_runtime_failure_boot_critical"])

    def test_stable_init_accepts_v4_and_degrades_ai_without_hiding_surface_failure(self):
        text = STABLE_INIT.read_text(encoding="utf-8")
        result = subprocess.run(
            ["sh", "-n", str(STABLE_INIT)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("4)", text)
        self.assertIn('fail "portable v4 Surface runtime handoff is incomplete"', text)
        self.assertIn('disable_local_ai "verified runtime mount is unavailable or incomplete"', text)
        self.assertIn("ORDAX_LOCAL_AI_BACKEND=DEGRADED", text)
        self.assertIn("ORDAX_LOCAL_AI_BACKEND=STARTED", text)
        self.assertIn("create_local_ai_auth()", text)
        self.assertIn("LLAMA_ARG_API_KEY_FILE=/run/ordax/local-ai-auth/key", text)
        self.assertIn('exec /system/entrypoint', text)
        self.assertLess(text.index("start_local_ai"), text.rindex("exec /system/entrypoint"))

    def test_disposable_qemu_harness_understands_v4_ai_runtime(self):
        direct = (ROOT / "bootstrap/portable-v2/qemu_boot.py").read_text(encoding="utf-8")
        uefi = (ROOT / "bootstrap/portable-v2/uefi_boot.py").read_text(encoding="utf-8")
        workflow = (ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml").read_text(encoding="utf-8")
        self.assertIn("prototype-ordax.release-manifest/4", direct)
        for text in (direct, uefi):
            self.assertIn("ORDAX_LOCAL_AI_RUNTIME_HANDOFF=VERIFIED", text)
            self.assertIn("ORDAX_LOCAL_AI_RUNTIME_SHA256=", text)
            self.assertIn("ORDAX_LOCAL_AI_BACKEND=STARTED", text)
        self.assertIn("--manifest-schema 4", workflow)
        self.assertIn("--local-ai-artifact", workflow)
        self.assertIn("--local-ai-source-lock", workflow)
        self.assertIn("verify-portable-v4-exact", workflow)
        self.assertIn("PORTABLE_V4_CANDIDATE_WITH_V3_PREVIOUS=VERIFIED", workflow)
        self.assertNotIn("/dev/sd", workflow)

    def test_canonical_contracts_distinguish_source_handoff_from_stable_proof(self):
        intelligence = json.loads(INTELLIGENCE_CONTRACT.read_text(encoding="utf-8"))
        handoff = json.loads(BOOT_HANDOFF_CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(
            intelligence["architecture"]["stable_v4_backend_lifecycle"],
            "source-handoff-implemented-signed-stable-materialization-pending",
        )
        self.assertTrue(
            intelligence["mvp_policy"]["stable_v4_boot_handoff_source_complete"]
        )
        self.assertTrue(
            intelligence["mvp_policy"]["signed_stable_v4_materialization_pending"]
        )
        v4 = handoff["v4_source_handoff"]
        self.assertTrue(v4["implemented"])
        self.assertFalse(v4["signed_stable_materialization_proven"])
        self.assertFalse(v4["qemu_boot_proven"])
        self.assertFalse(v4["physical_boot_proven"])
        self.assertFalse(v4["backend_failure_boot_critical"])

    def test_boot_handoff_does_not_materialize_or_write_physical_media(self):
        combined = "\n".join(
            [
                PORTABLE_INIT.read_text(encoding="utf-8"),
                STABLE_INIT.read_text(encoding="utf-8"),
            ]
        )
        for forbidden in (
            "materialize-portable-v4",
            "wipefs",
            "mkfs.exfat",
            "mkfs.vfat",
            "dd if=",
            "/dev/sda",
            "/dev/sdb",
            "curl ",
            "wget ",
        ):
            self.assertNotIn(forbidden, combined)


if __name__ == "__main__":
    unittest.main()
