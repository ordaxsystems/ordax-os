from __future__ import annotations

import importlib.util
import io
import json
import hashlib
from pathlib import Path
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/base/kernel_module_payload.py"

spec = importlib.util.spec_from_file_location("ordax_kernel_module_payload", MODULE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load kernel module payload helper")
PAYLOAD = importlib.util.module_from_spec(spec)
spec.loader.exec_module(PAYLOAD)


class KernelModulePayloadTests(unittest.TestCase):
    def test_wifi_policy_has_one_existing_ssot(self) -> None:
        policy = PAYLOAD.load_wifi_policy()
        self.assertEqual(
            policy["module_basenames"],
            ["iwlwifi", "iwlmvm", "rtl8xxxu", "mt76x2u", "ath9k_htc"],
        )
        self.assertEqual(
            policy["coldplug_entrypoints"],
            ["iwlwifi", "rtl8xxxu", "mt76x2u", "ath9k_htc"],
        )
        self.assertRegex(policy["matrix_sha256"], r"^[0-9a-f]{64}$")

    def test_helper_is_distribution_neutral_and_has_no_second_hardware_list(self) -> None:
        text = MODULE_PATH.read_text(encoding="utf-8")
        self.assertNotIn("alpine_core", text)
        self.assertNotIn("apk add", text)
        self.assertNotIn("WIFI_MODULE_BASENAMES", text)
        self.assertIn("hardware-support-matrix.json", text)
        self.assertIn('item.get("id") == "wifi-after-base-start"', text)

    def test_modprobe_output_maps_target_root_paths_without_dependency_parser(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            release = root / "lib/modules/6.6.158"
            module = release / "kernel/drivers/net/wireless/example.ko"
            module.parent.mkdir(parents=True)
            module.write_bytes(b"module")
            selected = PAYLOAD.parse_modprobe_output(
                "insmod /lib/modules/6.6.158/kernel/drivers/net/wireless/example.ko\n",
                root,
                release,
            )
            self.assertEqual(selected, {module.resolve()})

    def test_modprobe_output_rejects_path_outside_release(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            release = root / "lib/modules/6.6.158"
            release.mkdir(parents=True)
            escaped = root / "tmp/escape.ko"
            escaped.parent.mkdir()
            escaped.write_bytes(b"module")
            with self.assertRaises(PAYLOAD.KernelModulePayloadError):
                PAYLOAD.parse_modprobe_output(
                    f"insmod {escaped}\n",
                    root,
                    release,
                )

    def test_archive_rejects_links_and_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive_path = root / "unsafe.tar"
            payload = root / "payload"
            payload.write_bytes(b"x")
            with tarfile.open(archive_path, "w") as archive:
                archive.add(payload, arcname="../escape")
            with tarfile.open(archive_path, "r") as archive:
                with self.assertRaises(PAYLOAD.KernelModulePayloadError):
                    PAYLOAD.validate_archive_members(archive)

            link_archive = root / "link.tar"
            with tarfile.open(link_archive, "w") as archive:
                info = tarfile.TarInfo("lib/modules/6.6.158/build")
                info.type = tarfile.SYMTYPE
                info.linkname = "/tmp"
                archive.addfile(info)
            with tarfile.open(link_archive, "r") as archive:
                with self.assertRaises(PAYLOAD.KernelModulePayloadError):
                    PAYLOAD.validate_archive_members(archive)

    def _canonical_test_binding(self, root: Path) -> tuple[Path, Path, Path, dict]:
        """Synthetic files only: tests the real binding algorithm, not boot."""
        archive = root / "canonical-kernel-modules.tar"
        policy = PAYLOAD.load_wifi_policy()
        release = "6.6.158-test"
        files = [
            {
                "path": f"/lib/modules/{release}/kernel/{module}.ko",
                "sha256": hashlib.sha256(module.encode("utf-8")).hexdigest(),
                "size": len(module),
            }
            for module in policy["module_basenames"]
        ]
        files.append({
            "path": f"/lib/modules/{release}/modules.dep",
            "sha256": hashlib.sha256(b"deps").hexdigest(),
            "size": 4,
        })
        with tarfile.open(archive, "w") as dst:
            for item in files:
                name = item["path"][1:]
                content = (
                    Path(name).name.removesuffix(".ko").encode("utf-8")
                    if name.endswith(".ko") else b"deps"
                )
                info = tarfile.TarInfo(name)
                info.size = len(content)
                dst.addfile(info, io.BytesIO(content))
        receipt = {
            "$schema": "prototype-ordax.kernel-module-payload/1",
            "status": "selected-from-canonical-kernel-artifact",
            "kernel_release": release,
            "kernel_module_archive_sha256": PAYLOAD.sha256_file(archive),
            "hardware_matrix": str(PAYLOAD.DEFAULT_MATRIX.relative_to(ROOT)),
            "hardware_matrix_sha256": policy["matrix_sha256"],
            "requested_module_basenames": policy["module_basenames"],
            "coldplug_entrypoints": policy["coldplug_entrypoints"],
            "selected_module_count": len(policy["module_basenames"]),
            "files": files,
            "kernel_built_here": False,
            "network_download_used": False,
        }
        receipt_path = root / "kernel-module-payload.json"
        receipt_bytes = (json.dumps(receipt, sort_keys=True) + "\n").encode("utf-8")
        receipt_path.write_bytes(receipt_bytes)
        rootfs = root / "rootfs.tar"
        self._write_rootfs_binding_tar(rootfs, receipt_bytes, files)
        return archive, receipt_path, rootfs, receipt

    @staticmethod
    def _write_rootfs_binding_tar(
        path: Path, receipt_bytes: bytes, files: list[dict], *,
        corrupt: str | None = None,
        omit: str | None = None,
        link: str | None = None,
        duplicate: str | None = None,
    ) -> None:
        with tarfile.open(path, "w") as dst:
            items = [("etc/ordax/kernel-module-payload.json", receipt_bytes)]
            for item in files:
                name = item["path"][1:]
                if name == omit:
                    continue
                data = (
                    Path(name).name.removesuffix(".ko").encode("utf-8")
                    if name.endswith(".ko") else b"deps"
                )
                if name == corrupt:
                    data = b"X" * len(data)
                items.append((name, data))
            if duplicate is not None:
                items.append(next(pair for pair in items if pair[0] == duplicate))
            for name, data in items:
                info = tarfile.TarInfo(name)
                if name == link:
                    info.type = tarfile.SYMTYPE
                    info.linkname = "../wrong-target"
                    dst.addfile(info)
                else:
                    info.size = len(data)
                    dst.addfile(info, io.BytesIO(data))

    def test_installed_module_receipt_binds_exact_boot_kernel_and_rootfs(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            archive, receipt_path, rootfs, receipt = self._canonical_test_binding(Path(raw))
            result = PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)
            self.assertEqual(result["status"], "verified-canonical-kernel-module-binding")
            self.assertEqual(result["kernel_module_archive_sha256"], PAYLOAD.sha256_file(archive))
            self.assertEqual(result["selected_module_count"], receipt["selected_module_count"])
            self.assertEqual(result["verified_rootfs_members"], len(receipt["files"]) + 1)
            self.assertEqual(result["verified_kernel_source_members"], len(receipt["files"]))

    def test_kernel_binding_rejects_tampered_missing_or_ambiguous_archive_modules(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            archive, receipt_path, rootfs, receipt = self._canonical_test_binding(Path(raw))
            canonical = json.loads(receipt_path.read_text(encoding="utf-8"))
            data = receipt_path.read_bytes()
            member = receipt["files"][0]["path"][1:]
            for change, message in (
                ({"corrupt": member}, "module bytes differ"),
                ({"omit": member}, "lacks verified module files"),
                ({"link": member}, "not the expected regular file"),
                ({"duplicate": member}, "duplicate Stable rootfs module member"),
            ):
                with self.subTest(change=change):
                    self._write_rootfs_binding_tar(rootfs, data, canonical["files"], **change)
                    with self.assertRaisesRegex(PAYLOAD.KernelModulePayloadError, message):
                        PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)
            self._write_rootfs_binding_tar(rootfs, data, canonical["files"])
            self.assertEqual(
                PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)["verified_rootfs_members"],
                len(canonical["files"]) + 1,
            )

    def test_kernel_binding_rejects_jointly_forged_receipt_and_rootfs(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            archive, receipt_path, rootfs, receipt = self._canonical_test_binding(Path(raw))
            member = receipt["files"][0]["path"][1:]
            replacement = b"X" * receipt["files"][0]["size"]
            forged = dict(receipt)
            forged["files"] = [dict(item) for item in receipt["files"]]
            forged["files"][0]["sha256"] = hashlib.sha256(replacement).hexdigest()
            receipt_data = (json.dumps(forged, sort_keys=True) + "\n").encode("utf-8")
            receipt_path.write_bytes(receipt_data)
            self._write_rootfs_binding_tar(rootfs, receipt_data, forged["files"], corrupt=member)
            # The detached receipt and rootfs agree, but the canonical kernel
            # archive still has the original module bytes.
            with self.assertRaisesRegex(
                PAYLOAD.KernelModulePayloadError, "differs from canonical kernel source"
            ):
                PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)

    def test_kernel_binding_rejects_missing_or_duplicate_canonical_source_member(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            archive, receipt_path, rootfs, receipt = self._canonical_test_binding(Path(raw))
            member = receipt["files"][0]["path"][1:]
            with tarfile.open(archive, "w") as tar:
                for entry in receipt["files"][1:]:
                    name = entry["path"][1:]
                    payload = (
                        Path(name).name.removesuffix(".ko").encode("utf-8")
                        if name.endswith(".ko") else b"deps"
                    )
                    header = tarfile.TarInfo(name)
                    header.size = len(payload)
                    tar.addfile(header, io.BytesIO(payload))
            data = json.loads(receipt_path.read_text())
            data["kernel_module_archive_sha256"] = PAYLOAD.sha256_file(archive)
            raw_receipt = (json.dumps(data, sort_keys=True) + "\n").encode()
            receipt_path.write_bytes(raw_receipt)
            self._write_rootfs_binding_tar(rootfs, raw_receipt, data["files"])
            with self.assertRaisesRegex(
                PAYLOAD.KernelModulePayloadError, "lacks selected module files"
            ):
                PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)

            with tarfile.open(archive, "a") as tar:
                name = member
                content = Path(name).name.removesuffix(".ko").encode()
                for _ in range(2):
                    header = tarfile.TarInfo(name)
                    header.size = len(content)
                    tar.addfile(header, io.BytesIO(content))
            data["kernel_module_archive_sha256"] = PAYLOAD.sha256_file(archive)
            raw_receipt = (json.dumps(data, sort_keys=True) + "\n").encode()
            receipt_path.write_bytes(raw_receipt)
            self._write_rootfs_binding_tar(rootfs, raw_receipt, data["files"])
            with self.assertRaisesRegex(
                PAYLOAD.KernelModulePayloadError, "duplicate canonical kernel archive member"
            ):
                PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)

    def test_kernel_binding_rejects_noncanonical_receipt_member_paths(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            archive, receipt_path, rootfs, receipt = self._canonical_test_binding(Path(raw))
            for unsafe in (
                "/lib/modules/6.6.158-test//kernel/iwlwifi.ko",
                "/lib/modules/6.6.158-test/kernel/./iwlwifi.ko",
                "/lib/modules/6.6.158-test/kernel\\iwlwifi.ko",
            ):
                with self.subTest(unsafe=unsafe):
                    tampered = dict(receipt)
                    tampered["files"] = [dict(entry) for entry in receipt["files"]]
                    tampered["files"][0]["path"] = unsafe
                    receipt_path.write_text(json.dumps(tampered) + "\n", encoding="utf-8")
                    with self.assertRaisesRegex(PAYLOAD.KernelModulePayloadError, "unsafe or duplicate"):
                        PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)

    def test_kernel_module_binding_rejects_altered_archive_and_separate_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            archive, receipt_path, rootfs, _ = self._canonical_test_binding(Path(raw))
            original = archive.read_bytes()
            archive.write_bytes(b"wrong kernel modules")
            with self.assertRaisesRegex(PAYLOAD.KernelModulePayloadError, "differs from verified boot kernel"):
                PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)
            archive.write_bytes(original)
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt["files"][0]["size"] += 1
            receipt_path.write_text(json.dumps(receipt) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(PAYLOAD.KernelModulePayloadError, "module bytes differ from receipt|altered module receipt|differs from verified producer"):
                PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)

    def test_kernel_module_binding_rejects_missing_wifi_module_and_json_list(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            archive, receipt_path, rootfs, receipt = self._canonical_test_binding(Path(raw))
            receipt["files"][0]["path"] = "/lib/modules/6.6.158-test/kernel/irrelevant.ko"
            receipt_path.write_text(json.dumps(receipt) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(PAYLOAD.KernelModulePayloadError, "lost hardware baseline"):
                PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)
            receipt_path.write_text("[]", encoding="utf-8")
            with self.assertRaisesRegex(PAYLOAD.KernelModulePayloadError, "JSON object"):
                PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)

    def test_kernel_module_binding_rejects_unsafe_inventory_and_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            archive, receipt_path, rootfs, receipt = self._canonical_test_binding(Path(raw))
            receipt["files"][0]["path"] = "/lib/modules/6.6.158-test/../escape.ko"
            receipt_path.write_text(json.dumps(receipt) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(PAYLOAD.KernelModulePayloadError, "unsafe or duplicate"):
                PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)
            receipt_path.unlink()
            receipt_path.symlink_to(archive)
            with self.assertRaisesRegex(PAYLOAD.KernelModulePayloadError, "regular file"):
                PAYLOAD.verify_kernel_archive_binding(archive, receipt_path, rootfs)

    def test_receipt_schema_binds_canonical_inputs(self) -> None:
        text = MODULE_PATH.read_text(encoding="utf-8")
        for marker in (
            '"$schema": "prototype-ordax.kernel-module-payload/1"',
            '"kernel_module_archive_sha256"',
            '"hardware_matrix_sha256"',
            '"requested_module_basenames"',
            '"coldplug_entrypoints"',
            '"kernel_built_here": False',
            '"network_download_used": False',
        ):
            self.assertIn(marker, text)


if __name__ == "__main__":
    unittest.main()
