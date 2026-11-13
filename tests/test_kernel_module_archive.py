import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/kernel/module_archive.py"
SPEC = importlib.util.spec_from_file_location("ordax_kernel_module_archive", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
PARITY_PATH = ROOT / "bootstrap/independent-base/module_parity.py"
PARITY_SPEC = importlib.util.spec_from_file_location("ordax_independent_module_parity", PARITY_PATH)
assert PARITY_SPEC and PARITY_SPEC.loader
PARITY = importlib.util.module_from_spec(PARITY_SPEC)
PARITY_SPEC.loader.exec_module(PARITY)


class KernelModuleArchiveTests(unittest.TestCase):
    release = "6.6.158"

    def fixture_files(self) -> dict[str, bytes]:
        dependencies = {
            "kernel/iwlwifi.ko": ["kernel/cfg80211.ko"],
            "kernel/iwlmvm.ko": ["kernel/iwlwifi.ko"],
            "kernel/rtl8xxxu.ko": ["kernel/mac80211.ko"],
            "kernel/mt76x2u.ko": ["kernel/mt76x2_common.ko"],
            "kernel/ath9k_htc.ko": ["kernel/ath9k_common.ko"],
            "kernel/cfg80211.ko": [],
            "kernel/mac80211.ko": ["kernel/cfg80211.ko"],
            "kernel/mt76x2_common.ko": ["kernel/mt76.ko"],
            "kernel/mt76.ko": [],
            "kernel/ath9k_common.ko": ["kernel/ath.ko"],
            "kernel/ath.ko": [],
            "kernel/unused.ko": [],
        }
        prefix = f"lib/modules/{self.release}/"
        lines = [
            f"{name}: {' '.join(deps)}".rstrip()
            for name, deps in dependencies.items()
        ]
        files = {
            prefix + "modules.dep": ("\n".join(lines) + "\n").encode(),
            prefix + "modules.alias": b"# alias fixture\n",
            prefix + "modules.order": b"kernel/unused.ko\n",
        }
        for name in dependencies:
            files[prefix + name] = (name + "\n").encode()
        return files

    def make_archive(self, path: Path, files: dict[str, bytes] | None = None) -> Path:
        files = files or self.fixture_files()
        with tarfile.open(path, "w", format=tarfile.USTAR_FORMAT) as archive:
            for name, data in sorted(files.items()):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o644
                info.uid = 0
                info.gid = 0
                info.mtime = 0
                archive.addfile(info, io.BytesIO(data))
        return path

    def make_rootfs_tar(self, target: Path, path: Path) -> Path:
        with tarfile.open(path, "w", format=tarfile.USTAR_FORMAT) as archive:
            for entry in sorted(target.rglob("*"), key=lambda item: item.relative_to(target).as_posix()):
                relative = entry.relative_to(target).as_posix()
                info = archive.gettarinfo(str(entry), arcname=relative)
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                info.mtime = 0
                if info.isfile():
                    with entry.open("rb") as handle:
                        archive.addfile(info, handle)
                elif info.isdir():
                    archive.addfile(info)
                else:
                    self.fail(f"unexpected fixture object: {relative}")
        return path

    def install_fixture(self, root: Path) -> tuple[Path, Path, Path]:
        archive_path = self.make_archive(root / "modules.tar")
        target = root / "target"
        target.mkdir()
        receipt = MODULE.install_matrix_wifi_modules(archive_path, target)
        receipt_path = root / "selection.json"
        MODULE.write_receipt(receipt_path, receipt)
        embedded = target / "etc/ordax/kernel-module-selection.json"
        embedded.parent.mkdir(parents=True)
        embedded.write_bytes(receipt_path.read_bytes())
        return archive_path, target, receipt_path

    def test_hardware_matrix_is_the_wifi_module_ssot(self):
        policy = MODULE.load_wifi_policy()
        self.assertEqual(
            set(policy["module_basenames"]),
            {"iwlwifi", "iwlmvm", "rtl8xxxu", "mt76x2u", "ath9k_htc"},
        )
        self.assertEqual(
            set(policy["coldplug_entrypoints"]),
            {"iwlwifi", "rtl8xxxu", "mt76x2u", "ath9k_htc"},
        )

    def test_selects_required_wifi_modules_dependency_closure_and_metadata(self):
        with tempfile.TemporaryDirectory() as td:
            archive_path = self.make_archive(Path(td) / "modules.tar")
            with tarfile.open(archive_path, "r") as archive:
                members, receipt = MODULE.select_module_members(
                    archive,
                    {"iwlwifi", "iwlmvm", "rtl8xxxu", "mt76x2u", "ath9k_htc"},
                )
            names = {member.name for member in members}
            prefix = f"lib/modules/{self.release}/"
            self.assertIn(prefix + "kernel/mt76x2u.ko", names)
            self.assertIn(prefix + "kernel/mt76.ko", names)
            self.assertIn(prefix + "kernel/cfg80211.ko", names)
            self.assertIn(prefix + "modules.dep", names)
            self.assertIn(prefix + "modules.alias", names)
            self.assertNotIn(prefix + "kernel/unused.ko", names)
            self.assertEqual(receipt["kernel_release"], self.release)
            self.assertIn("kernel/mt76.ko", receipt["selected_module_paths"])
            self.assertNotIn("kernel/unused.ko", receipt["selected_module_paths"])
            self.assertEqual(
                receipt["requested_module_basenames"],
                ["ath9k_htc", "iwlmvm", "iwlwifi", "mt76x2u", "rtl8xxxu"],
            )

    def test_install_matrix_wifi_modules_extracts_only_selected_payload(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive_path = self.make_archive(root / "modules.tar")
            target = root / "target"
            target.mkdir()
            receipt = MODULE.install_matrix_wifi_modules(archive_path, target)
            module_root = target / "lib/modules" / self.release
            self.assertTrue((module_root / "kernel/iwlwifi.ko").is_file())
            self.assertTrue((module_root / "kernel/mt76x2u.ko").is_file())
            self.assertFalse((module_root / "kernel/unused.ko").exists())
            self.assertTrue((module_root / "modules.dep").is_file())
            self.assertEqual(receipt["policy_source"], "docs/contracts/hardware-support-matrix.json")
            self.assertFalse(receipt["physical_support_claimed"])
            self.assertEqual(len(receipt["archive_sha256"]), 64)

    def test_cli_installs_wifi_subset_and_writes_receipt(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive_path = self.make_archive(root / "modules.tar")
            target = root / "target"
            target.mkdir()
            receipt_path = root / "receipt.json"
            result = subprocess.run(
                [
                    sys.executable,
                    str(MODULE_PATH),
                    "install-wifi",
                    "--archive",
                    str(archive_path),
                    "--target",
                    str(target),
                    "--receipt",
                    str(receipt_path),
                ],
                capture_output=True,
                text=True,
                cwd=ROOT,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            self.assertEqual(receipt["kernel_release"], self.release)
            self.assertFalse(receipt["physical_support_claimed"])
            self.assertTrue((target / "lib/modules" / self.release / "kernel/iwlmvm.ko").is_file())
            self.assertFalse((target / "lib/modules" / self.release / "kernel/unused.ko").exists())

    def test_independent_rootfs_parity_rederives_archive_and_embedded_receipt(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive_path, target, receipt_path = self.install_fixture(root)
            rootfs_tar = self.make_rootfs_tar(target, root / "rootfs.tar")
            result = PARITY.verify(
                kernel_modules=archive_path,
                selection_receipt=receipt_path,
                rootfs_tar=rootfs_tar,
            )
            self.assertEqual(result["kernel_release"], self.release)
            self.assertGreater(result["selected_module_count"], 5)
            self.assertEqual(result["firmware_files"], 0)
            self.assertFalse(result["physical_support_claimed"])

    def test_independent_rootfs_parity_rejects_firmware_in_module_only_slice(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive_path, target, receipt_path = self.install_fixture(root)
            firmware = target / "lib/firmware/not-yet-justified.bin"
            firmware.parent.mkdir(parents=True)
            firmware.write_bytes(b"not authorized\n")
            rootfs_tar = self.make_rootfs_tar(target, root / "rootfs.tar")
            with self.assertRaisesRegex(PARITY.ModuleParityError, "firmware entered"):
                PARITY.verify(
                    kernel_modules=archive_path,
                    selection_receipt=receipt_path,
                    rootfs_tar=rootfs_tar,
                )

    def test_missing_required_module_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            files = self.fixture_files()
            prefix = f"lib/modules/{self.release}/"
            files.pop(prefix + "kernel/ath9k_htc.ko")
            archive_path = self.make_archive(Path(td) / "modules.tar", files)
            with tarfile.open(archive_path, "r") as archive:
                with self.assertRaisesRegex(MODULE.ModuleArchiveError, "module files missing"):
                    MODULE.select_module_members(archive, {"ath9k_htc"})

    def test_missing_dependency_metadata_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            files = self.fixture_files()
            prefix = f"lib/modules/{self.release}/"
            dep = files[prefix + "modules.dep"].decode().replace(
                "kernel/iwlwifi.ko: kernel/cfg80211.ko",
                "kernel/iwlwifi.ko: kernel/not-described.ko",
            )
            files[prefix + "modules.dep"] = dep.encode()
            archive_path = self.make_archive(Path(td) / "modules.tar", files)
            with tarfile.open(archive_path, "r") as archive:
                with self.assertRaisesRegex(MODULE.ModuleArchiveError, "dependency metadata missing"):
                    MODULE.select_module_members(archive, {"iwlwifi"})

    def test_unsafe_archive_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            archive_path = Path(td) / "modules.tar"
            with tarfile.open(archive_path, "w") as archive:
                data = b"bad\n"
                info = tarfile.TarInfo("../escape.ko")
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
            with tarfile.open(archive_path, "r") as archive:
                with self.assertRaisesRegex(MODULE.ModuleArchiveError, "unsafe kernel-module archive entry"):
                    MODULE.select_module_members(archive, {"iwlwifi"})

    def test_matrix_policy_cannot_claim_driver_presence_as_hardware_support(self):
        with tempfile.TemporaryDirectory() as td:
            matrix = json.loads(MODULE.HARDWARE_MATRIX.read_text(encoding="utf-8"))
            matrix["support_claim_policy"]["driver_present_is_supported_hardware_claim"] = True
            path = Path(td) / "matrix.json"
            path.write_text(json.dumps(matrix), encoding="utf-8")
            with self.assertRaisesRegex(MODULE.ModuleArchiveError, "support claim policy drifted"):
                MODULE.load_wifi_policy(path)


if __name__ == "__main__":
    unittest.main()
