"""Kernel artifact consumers must follow the one pinned kernel source identity."""

from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load_module(path: Path, name: str):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


CORE = load_module(ROOT / "bootstrap/base/alpine_core.py", "ordax_kernel_consumer_core")
ASSEMBLER = load_module(ROOT / "tools/creator/assemble.py", "ordax_kernel_consumer_assembler")


class KernelConsumerSSOTTests(unittest.TestCase):
    def write_kernel_source(self, root: Path, *, version="6.6.158", schema="prototype-ordax.kernel-source/1"):
        source = root / "bootstrap/kernel/source.json"
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text(json.dumps({"$schema": schema, "version": version}) + "\n", encoding="utf-8")
        return source

    def test_real_dev_base_and_creator_consume_same_kernel_pin(self):
        pinned = json.loads((ROOT / "bootstrap/kernel/source.json").read_text(encoding="utf-8"))["version"]
        self.assertEqual(CORE.pinned_kernel_version(), pinned)
        self.assertEqual(CORE.kernel_module_archive_path(), ROOT / "out/kernel" / f"kernel-modules-{pinned}.tar")
        self.assertEqual(
            ASSEMBLER.canonical_kernel_sources(ROOT),
            {f"bootstrap/kernel/vmlinuz-{pinned}": f"out/kernel/vmlinuz-{pinned}"},
        )
        stable_source = (ROOT / "bootstrap/stable-base/build.py").read_text(encoding="utf-8")
        self.assertIn("default=CORE.kernel_module_archive_path()", stable_source)
        self.assertNotIn("kernel-modules-6.6.52.tar", stable_source)

    def test_new_kernel_version_changes_both_names_without_mutating_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            contract = self.write_kernel_source(root)
            self.assertEqual(CORE.pinned_kernel_version(contract), "6.6.158")
            self.assertEqual(CORE.kernel_module_archive_path(contract).name, "kernel-modules-6.6.158.tar")
            self.assertEqual(
                ASSEMBLER.canonical_kernel_sources(root),
                {"bootstrap/kernel/vmlinuz-6.6.158": "out/kernel/vmlinuz-6.6.158"},
            )

    def test_invalid_kernel_contract_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            contract = self.write_kernel_source(root, version="../6.6.158")
            with self.assertRaises(CORE.BuildError):
                CORE.pinned_kernel_version(contract)
            with self.assertRaises(ASSEMBLER.AssembleError):
                ASSEMBLER.canonical_kernel_sources(root)
            self.write_kernel_source(root, schema="unexpected")
            with self.assertRaises(CORE.BuildError):
                CORE.pinned_kernel_version(contract)
            with self.assertRaises(ASSEMBLER.AssembleError):
                ASSEMBLER.canonical_kernel_sources(root)

    def test_stale_bootstrap_manifest_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_kernel_source(root, version="6.6.158")
            stale = {
                "$schema": "prototype-ordax.minimal-bootstrap/4",
                "physical_write_allowed": False,
                "all_artifacts_resolved": True,
                "artifact_groups": [
                    {"id": "kernel", "partition": "ORDAX-ESP", "resolved": True,
                     "artifacts": [{"source_path": "bootstrap/kernel/vmlinuz-6.6.52"}]}
                ],
            }
            output = root / "payload"
            with self.assertRaisesRegex(ASSEMBLER.AssembleError, "differs from canonical"):
                ASSEMBLER.assemble(root, stale, output, allow_unresolved=False)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
