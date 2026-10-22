"""Offline, read-only verification of an unsigned Runtime CI candidate.

This is a provenance gate for the Owner Development handoff, NOT a signing,
installation, device-grant, attestation or runtime-activation operation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import struct
import sys
import zipfile

EXPECTED_FILES = frozenset(("SHA256SUMS", "candidate.json", "ordax-product-agent", "self-test.json"))
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT = re.compile(r"[0-9a-f]{40}\Z")


class CandidateError(ValueError):
    pass


def _hash_stream(stream):
    digest = hashlib.sha256()
    count = 0
    while chunk := stream.read(1024 * 1024):
        count += len(chunk)
        digest.update(chunk)
    return digest.hexdigest(), count


def _document(data, name):
    if len(data) > 16384:
        raise CandidateError(f"{name} is too large")
    try:
        value = json.loads(data)
    except (ValueError, UnicodeDecodeError) as error:
        raise CandidateError(f"{name} is not JSON") from error
    if not isinstance(value, dict):
        raise CandidateError(f"{name} must be an object")
    return value


def _native_elf_abi(prefix: bytes) -> tuple[str | None, list[str]]:
    """Inspect the actual ELF loader and DT_NEEDED, not only CI's manifest.

    The current amd64 candidate has its PHDR and dynamic string table in the
    first 256 KiB. Reject layouts outside that bounded evidence window; this
    is not a general ELF loader and does not assert embedded Python closure.
    """
    if (len(prefix) < 64 or prefix[:6] != b"\x7fELF\x02\x01"
            or prefix[18:20] != b"\x3e\x00"):
        raise CandidateError("unsupported native ELF64 little-endian amd64")
    phoff = struct.unpack_from("<Q", prefix, 32)[0]
    stride, count = struct.unpack_from("<HH", prefix, 54)
    if stride != 56 or not 1 <= count <= 128 or phoff + stride * count > len(prefix):
        raise CandidateError("ELF program headers are outside bounded proof")
    segments = [struct.unpack_from("<IIQQQQQQ", prefix, phoff + i * stride)
                for i in range(count)]
    interp = [part for part in segments if part[0] == 3]
    dynamic = [part for part in segments if part[0] == 2]
    if len(interp) > 1 or len(dynamic) > 1:
        raise CandidateError("duplicate ELF interpreter or dynamic segment")
    interpreter = None
    if interp:
        part = interp[0]
        offset, size = part[2], part[5]
        if not 1 <= size <= 256 or offset + size > len(prefix):
            raise CandidateError("ELF interpreter is outside bounded proof")
        raw = prefix[offset:offset + size]
        if not raw.endswith(b"\x00") or b"\x00" in raw[:-1]:
            raise CandidateError("ELF interpreter is invalid")
        try:
            interpreter = raw[:-1].decode("ascii")
        except UnicodeDecodeError as exc:
            raise CandidateError("ELF interpreter is invalid") from exc
    needed = []
    if dynamic:
        part = dynamic[0]
        offset, size = part[2], part[5]
        if size % 16 or offset + size > len(prefix) or size > 65536:
            raise CandidateError("ELF dynamic segment is outside bounded proof")
        entries = []
        for position in range(offset, offset + size, 16):
            kind, value = struct.unpack_from("<qQ", prefix, position)
            if kind == 0:
                break
            entries.append((kind, value))
        tables = [value for kind, value in entries if kind == 5]
        sizes = [value for kind, value in entries if kind == 10]
        if len(tables) != 1 or len(sizes) != 1 or not 0 < sizes[0] <= 65536:
            raise CandidateError("ELF dynamic strings are not bound")
        addresses = [
            segment[2] + (tables[0] - segment[3])
            for segment in segments if segment[0] == 1
            and segment[3] <= tables[0]
            and tables[0] + sizes[0] <= segment[3] + segment[5]
        ]
        if len(addresses) != 1 or addresses[0] + sizes[0] > len(prefix):
            raise CandidateError("ELF dynamic strings are outside bounded proof")
        table = prefix[addresses[0]:addresses[0] + sizes[0]]
        for kind, index in entries:
            if kind != 1:
                continue
            if index >= len(table):
                raise CandidateError("ELF dependency string offset is invalid")
            end = table.find(b"\x00", index)
            if end <= index or end - index > 255:
                raise CandidateError("ELF dependency string is invalid")
            try:
                name = table[index:end].decode("ascii")
            except UnicodeDecodeError as exc:
                raise CandidateError("ELF dependency string is invalid") from exc
            if not re.fullmatch(r"[A-Za-z0-9_.+-]{1,255}", name):
                raise CandidateError("ELF dependency filename is unsafe")
            needed.append(name)
    if len(needed) != len(set(needed)):
        raise CandidateError("duplicate ELF dependency names")
    return interpreter, sorted(needed)


def verify(archive: Path, source_lock: Path) -> dict:
    lock = _document(source_lock.read_bytes(), "source lock")
    if lock.get("$schema") != "prototype-ordax.studio-runtime-source-lock/1":
        raise CandidateError("unexpected OS source-lock schema")
    source = lock.get("source", {})
    evidence = lock.get("candidate_evidence", {})
    distribution = lock.get("distribution", {})
    activation = lock.get("activation", {})
    sha = source.get("commit")
    if not isinstance(sha, str) or not COMMIT.fullmatch(sha):
        raise CandidateError("source commit is not pinned")
    if evidence.get("kind") != "ci-only-unsigned" or evidence.get("source_commit") != sha:
        raise CandidateError("candidate does not bind to pinned source")
    if evidence.get("platform") != "linux-amd64-musl":
        raise CandidateError("candidate platform is unsupported")
    for field in ("archive_sha256", "executable_sha256"):
        if not isinstance(evidence.get(field), str) or not SHA256.fullmatch(evidence[field]):
            raise CandidateError(f"missing pinned {field}")
    if not isinstance(evidence.get("executable_size_bytes"), int) or evidence["executable_size_bytes"] <= 0:
        raise CandidateError("invalid binary size pin")
    if (evidence.get("offline_proof_verified") is not True or evidence.get("device_execution_proven") is not False
        or evidence.get("signed_distribution_authorized") is not False
        or evidence.get("native_graphical_control_proven") is not False):
        raise CandidateError("candidate evidence cannot authorize runtime")
    if (distribution.get("runtime_artifact_claimed") is not False or
        distribution.get("runtime_packaged_in_stable") is not False or
        distribution.get("source_binding_only") is not True or
        activation.get("dispatch_enabled") is not False or
        activation.get("requires_signed_runtime_slot") is not True):
        raise CandidateError("OS activation gates must stay closed")

    with archive.open("rb") as source_bytes:
        digest, _ = _hash_stream(source_bytes)
    if digest != evidence["archive_sha256"]:
        raise CandidateError("archive digest does not match OS evidence")

    try:
        with zipfile.ZipFile(archive) as zipped:
            infos = zipped.infolist()
            if len(infos) != len(EXPECTED_FILES) or {i.filename for i in infos} != EXPECTED_FILES:
                raise CandidateError("candidate ZIP members are not exact")
            for info in infos:
                mode = info.external_attr >> 16
                if (info.is_dir() or stat.S_IFMT(mode) == stat.S_IFLNK or
                    info.flag_bits & 1):
                    raise CandidateError("unsafe candidate ZIP entry")
            manifest = _document(zipped.read("candidate.json"), "candidate manifest")
            proof = _document(zipped.read("self-test.json"), "offline proof")
            if (manifest.get("schema") != "ordax.native-product-runtime-candidate/1" or
                manifest.get("source_repository") != "ordaxsystems/ordax-runtime" or
                manifest.get("source_commit") != sha or
                manifest.get("platform") != "linux-amd64-musl" or
                manifest.get("artifact") != "ordax-product-agent"):
                raise CandidateError("candidate manifest is not pinned to canonical Runtime")
            if any(manifest.get(flag) is not False for flag in (
                "python_required_on_device", "graphical_control_implemented",
                "signature_present", "installation_authorized_by_candidate", "stable_activation_authorized"
            )):
                raise CandidateError("candidate must not claim signature/activation")
            if (manifest.get("sha256") != evidence["executable_sha256"] or
                manifest.get("size_bytes") != evidence["executable_size_bytes"]):
                raise CandidateError("candidate executable does not match evidence")
            blockers = manifest.get("independent_base_abi_blockers")
            if (manifest.get("independent_base_abi_ready") is not False or
                evidence.get("independent_base_abi_ready") is not False or
                not isinstance(blockers, list) or not 1 <= len(blockers) <= 16 or
                any(not isinstance(item, str) or not re.fullmatch(r"[a-z0-9-]{3,80}", item)
                    for item in blockers) or len(set(blockers)) != len(blockers) or
                blockers != evidence.get("independent_base_abi_blockers")):
                raise CandidateError("Independent Base ABI is not a verified installable closure")
            libraries = manifest.get("elf_needed_libraries")
            if (not isinstance(libraries, list) or
                libraries != evidence.get("elf_needed_libraries") or
                not isinstance(manifest.get("elf_interpreter"), str) or
                manifest.get("elf_interpreter") != evidence.get("elf_interpreter")):
                raise CandidateError("ELF ABI bindings do not match OS evidence")
            # The Runtime is the sole parser/owner of the PyInstaller CArchive.
            # The OS binds its immutable CI result to the pinned ZIP and checks
            # denial semantics; it does not fork an extractor or assume that
            # matched dependency basenames prove loader compatibility.
            inventory = manifest.get("embedded_elf_inventory")
            binding = evidence.get("embedded_elf_inventory")
            if not isinstance(inventory, dict) or not isinstance(binding, dict):
                raise CandidateError("embedded native inventory is missing")
            if (inventory.get("schema") != "ordax.native-embedded-elf-inventory/1" or
                binding.get("schema") != inventory["schema"] or
                type(inventory.get("native_entry_count")) is not int or
                not 1 <= inventory["native_entry_count"] <= 4096 or
                type(inventory.get("native_uncompressed_bytes")) is not int or
                inventory["native_uncompressed_bytes"] < inventory["native_entry_count"] * 64 or
                inventory["native_uncompressed_bytes"] > 512 * 1024 * 1024 or
                not isinstance(inventory.get("inventory_sha256"), str) or
                not SHA256.fullmatch(inventory["inventory_sha256"])):
                raise CandidateError("embedded native inventory is structurally invalid")
            missing = inventory.get("unprovided_needed_names")
            needed = inventory.get("needed_libraries")
            interpreters = inventory.get("embedded_interpreters")
            if (not isinstance(needed, list) or not 1 <= len(needed) <= 256 or
                not isinstance(missing, list) or not isinstance(interpreters, list) or
                len(needed) != len(set(map(str, needed))) or
                any(not isinstance(value, str) or
                    not re.fullmatch(r"[A-Za-z0-9_.+-]{1,255}", value)
                    for value in needed + missing) or
                len(missing) != len(set(missing)) or
                not set(missing).issubset(set(needed)) or
                len(interpreters) > 16 or
                any(not isinstance(value, str) or not value.startswith("/")
                    for value in interpreters)):
                raise CandidateError("embedded native dependencies are invalid")
            if (inventory.get("read_only_audit") is not True or
                inventory.get("independent_base_compatibility_proven") is not False or
                inventory.get("install_authorized") is not False):
                raise CandidateError("embedded native inventory cannot authorize activation")
            for key in ("schema", "native_entry_count", "native_uncompressed_bytes",
                        "inventory_sha256", "unprovided_needed_names",
                        "independent_base_compatibility_proven", "install_authorized"):
                if inventory[key] != binding.get(key):
                    raise CandidateError("embedded native inventory does not match pinned evidence")
            if (proof.get("ok") is not True or proof.get("network_used") is not False or
                proof.get("device_credential_used") is not False or proof.get("graphical_actions") != [] or
                proof.get("probes") != ["filesystem", "terminal", "supervised-process"] or
                proof.get("profile") != "owner-development-usb"):
                raise CandidateError("offline execution proof does not match expected boundary")
            with zipped.open("ordax-product-agent") as stream:
                elf = stream.read(256 * 1024)
            interpreter, actual_libraries = _native_elf_abi(elf)
            if (interpreter != evidence["elf_interpreter"] or
                actual_libraries != sorted(libraries)):
                raise CandidateError("native ELF loader/dependencies differ from pinned ABI evidence")
            with zipped.open("ordax-product-agent") as stream:
                binary_hash, size = _hash_stream(stream)
            if elf[:5] != b"\x7fELF\x02" or elf[18:20] != b"\x3e\x00":
                raise CandidateError("candidate is not an amd64 ELF")
            if binary_hash != evidence["executable_sha256"] or size != evidence["executable_size_bytes"]:
                raise CandidateError("candidate executable bytes failed verification")
            if zipped.read("SHA256SUMS") != f"{binary_hash}  ordax-product-agent\n".encode():
                raise CandidateError("SHA256SUMS does not match executable")
    except (zipfile.BadZipFile, RuntimeError, OSError) as error:
        raise CandidateError("candidate ZIP unreadable") from error
    return {"source_commit": sha, "sha256": binary_hash, "size_bytes": size,
            "activation_authorized": False, "device_execution_proven": False,
            "independent_base_abi_ready": False,
            "elf_interpreter": interpreter, "elf_needed_libraries": actual_libraries,
            "independent_base_abi_blockers": blockers,
            "embedded_elf_inventory": binding}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--source-lock", type=Path, default=Path(__file__).resolve().parents[2] /
                        "system/services/device-agent/studio-runtime-source-lock.json")
    args = parser.parse_args()
    try:
        result = verify(args.archive, args.source_lock)
    except (CandidateError, FileNotFoundError, PermissionError) as error:
        print(f"ORDAX_NATIVE_PRODUCT_CANDIDATE=FAIL: {error}", file=sys.stderr)
        return 1
    print("ORDAX_NATIVE_PRODUCT_CANDIDATE=PASS")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
