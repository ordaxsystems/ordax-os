import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_configured_soname_staged_caller_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_configured_soname_staged_caller_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def minimal_elf64(machine=62):
    data = bytearray(64)
    data[:4] = b"\x7fELF"
    data[4] = 2
    data[5] = 1
    data[6] = 1
    struct.pack_into("<H", data, 18, machine)
    struct.pack_into("<Q", data, 32, 64)
    struct.pack_into("<H", data, 54, 56)
    struct.pack_into("<H", data, 56, 0)
    return bytes(data)


def minimal_elf32(machine=3):
    data = bytearray(52)
    data[:4] = b"\x7fELF"
    data[4] = 1
    data[5] = 1
    data[6] = 1
    struct.pack_into("<H", data, 18, machine)
    struct.pack_into("<I", data, 28, 52)
    struct.pack_into("<H", data, 42, 32)
    struct.pack_into("<H", data, 44, 0)
    return bytes(data)


class StagedConfiguredSonameCallerTests(unittest.TestCase):
    def test_contract_keeps_loader_context_closed(self):
        contract = MODULE.load_contract()
        self.assertEqual(contract["expected"]["caller_modules"], 15)
        self.assertTrue(contract["verification"]["exactly_one_compatible_staged_elf_required"])
        self.assertFalse(contract["verification"]["first_basename_candidate_selection_allowed"])
        self.assertTrue(all(value is False for value in contract["open_boundaries"].values()))
        self.assertTrue(all(value is False for value in contract["promotion"].values()))

    def bind(self, files):
        expected = {"class": 64, "machine": 62, "endianness": "little"}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = {}
            for relative, data in files.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                manifest[relative] = {"type": "file"}
            return MODULE.bind_staged_elf(root, manifest, "caller.so", expected)

    def test_exactly_one_compatible_elf_is_selected_while_elf32_is_inspected(self):
        result = self.bind({
            "usr/lib/wine/x86_64-unix/caller.so": minimal_elf64(),
            "usr/lib/wine/i386-unix/caller.so": minimal_elf32(),
        })
        self.assertEqual(len(result["staged_candidates"]), 2)
        self.assertEqual(result["selected"]["path"], "usr/lib/wine/x86_64-unix/caller.so")
        self.assertEqual(result["selected"]["elf"], {"class": 64, "machine": 62, "endianness": "little"})

    def test_two_compatible_candidates_fail_closed(self):
        with self.assertRaisesRegex(MODULE.StagedCallerProofError, "exactly one compatible"):
            self.bind({
                "usr/lib/wine/x86_64-unix/caller.so": minimal_elf64(),
                "opt/wine/caller.so": minimal_elf64(),
            })

    def test_non_elf_same_basename_fails_closed(self):
        with self.assertRaisesRegex(MODULE.StagedCallerProofError, "not ELF"):
            self.bind({"usr/lib/wine/x86_64-unix/caller.so": b"not-elf"})

    def test_missing_basename_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(MODULE.StagedCallerProofError, "no pathname"):
                MODULE.bind_staged_elf(
                    Path(temp), {}, "caller.so", {"class": 64, "machine": 62, "endianness": "little"}
                )

    def test_full_build_gate_set_is_exact(self):
        gates = MODULE.expected_full_build_gates()
        self.assertTrue(gates["generated_idl_header_barrier_completed"])
        self.assertFalse(gates["runtime_dependency_inventory_complete"])
        self.assertEqual(len(gates), 20)

    def test_unixlib_identity_must_be_safe_basename(self):
        for value in ("../caller.so", "sub/caller.so", "$(UNIXLIB)", "caller so"):
            self.assertFalse(MODULE.SAFE_NAME_RE.fullmatch(value) and "/" not in value and "\\" not in value)


if __name__ == "__main__":
    unittest.main()
