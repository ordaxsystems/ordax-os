"""No initramfs UAPI extraction may bypass upstream kernel source authentication."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/initramfs/build.py"
SPEC = importlib.util.spec_from_file_location("ordax_initramfs_uapi_security", MODULE_PATH)
INITRAMFS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INITRAMFS)


class KernelUapiAuthenticationTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.work = Path(temp.name)
        self.source = {"version": "6.6.158"}

    def test_signature_failure_blocks_uapi_extraction(self):
        archive = self.work / "linux-6.6.158.tar.xz"
        with (
            mock.patch.object(INITRAMFS.KERNEL_BUILD, "load_contract", return_value=self.source),
            mock.patch.object(INITRAMFS.KERNEL_BUILD, "download_archive", return_value=archive),
            mock.patch.object(
                INITRAMFS.KERNEL_BUILD,
                "authenticate_upstream_archive",
                side_effect=INITRAMFS.KERNEL_BUILD.BuildError("bad upstream signature"),
            ) as signature,
            mock.patch.object(INITRAMFS.KERNEL_BUILD, "extract_archive") as extract,
            mock.patch.object(INITRAMFS, "run") as run,
        ):
            with self.assertRaisesRegex(INITRAMFS.KERNEL_BUILD.BuildError, "bad upstream signature"):
                INITRAMFS.prepare_kernel_uapi(self.work, {})
            signature.assert_called_once_with(self.source, archive, self.work / "kernel-uapi-cache")
            extract.assert_not_called()
            run.assert_not_called()

    def test_successful_authentication_is_required_before_extraction(self):
        archive = self.work / "linux-6.6.158.tar.xz"
        sequence = []

        def authenticate(*args):
            sequence.append("verify")
            return {"status": "verified"}

        def extract(*args):
            sequence.append("extract")
            raise RuntimeError("stop before headers_install")

        with (
            mock.patch.object(INITRAMFS.KERNEL_BUILD, "load_contract", return_value=self.source),
            mock.patch.object(INITRAMFS.KERNEL_BUILD, "download_archive", return_value=archive),
            mock.patch.object(INITRAMFS.KERNEL_BUILD, "authenticate_upstream_archive", side_effect=authenticate),
            mock.patch.object(INITRAMFS.KERNEL_BUILD, "extract_archive", side_effect=extract),
        ):
            with self.assertRaisesRegex(RuntimeError, "stop before headers_install"):
                INITRAMFS.prepare_kernel_uapi(self.work, {})
        self.assertEqual(sequence, ["verify", "extract"])

    def test_authored_kernel_uapi_pin_is_rejected(self):
        raw = json.loads((ROOT / "bootstrap/initramfs/source.json").read_text(encoding="utf-8"))
        raw["portable_v2_prerequisites"]["kernel_uapi_version"] = "6.6.52"
        selected = self.work / "initramfs-source.json"
        selected.write_text(json.dumps(raw), encoding="utf-8")
        with mock.patch.object(INITRAMFS, "CONTRACT", selected):
            with self.assertRaisesRegex(INITRAMFS.BuildError, "duplicate release pin"):
                INITRAMFS.load_contract()

    def test_noncanonical_uapi_pointer_is_rejected(self):
        raw = json.loads((ROOT / "bootstrap/initramfs/source.json").read_text(encoding="utf-8"))
        raw["portable_v2_prerequisites"]["kernel_uapi_source_contract"] = "bootstrap/other/source.json"
        selected = self.work / "initramfs-source.json"
        selected.write_text(json.dumps(raw), encoding="utf-8")
        with mock.patch.object(INITRAMFS, "CONTRACT", selected):
            with self.assertRaisesRegex(INITRAMFS.BuildError, "canonical kernel source"):
                INITRAMFS.load_contract()

    def test_kernel_release_is_derived_without_editing_initramfs_manifest(self):
        raw = (ROOT / "bootstrap/initramfs/source.json").read_text(encoding="utf-8")
        self.assertNotIn('"kernel_uapi_version"', raw)
        with mock.patch.object(INITRAMFS.KERNEL_BUILD, "load_contract", return_value={"version": "6.6.159"}):
            derived = INITRAMFS.load_contract()
        self.assertEqual(derived["portable_v2_prerequisites"]["kernel_uapi_version"], "6.6.159")

    def test_initramfs_and_kernel_share_active_release(self):
        init = INITRAMFS.load_contract()
        kernel = INITRAMFS.KERNEL_BUILD.load_contract()
        self.assertEqual(
            init["portable_v2_prerequisites"]["kernel_uapi_version"],
            kernel["version"],
        )


if __name__ == "__main__":
    unittest.main()
