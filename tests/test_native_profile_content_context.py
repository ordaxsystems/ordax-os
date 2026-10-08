from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import json
import os
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE = RUNTIME / "native_profile_content_context.py"


def load_module():
    sys.path.insert(0, str(RUNTIME))
    try:
        spec = spec_from_file_location("ordax_profile_content_context_test", MODULE)
        module = module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(RUNTIME))


def canonical_bytes(value):
    return (json.dumps(value, separators=(",", ":"), sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


class NativeProfileContentContextTests(unittest.TestCase):
    def _fixture(self, module, directory, *, kind="knowledge-pack", unsafe_skill=False,
                 extra_knowledge_texts=()):
        root = Path(directory)
        content_root = root / "content"
        receipt_root = root / "receipts"
        inventory_path = root / "inventory.json"
        state_path = root / "activation.json"
        lock_path = root / "lock"

        source = {
            "uri": "https://example.invalid/developer-docs",
            "revision": "rev-1",
            "license": "test-only",
            "jurisdiction": None,
            "title": "Developer docs",
        }
        if kind == "knowledge-pack":
            text = "Use contratos explícitos e mantenha autoridade separada de contexto."
            entry = {
                "id": "developer.architecture",
                "mediaType": "text/markdown",
                "content": text,
                "contentSha256": hashlib.sha256(text.encode()).hexdigest(),
                "source": source,
            }
        else:
            text = "Revise a mudança sem executar ações."
            entry = {
                "id": "developer.review",
                "title": "Review",
                "instructions": text,
                "instructionsSha256": hashlib.sha256(text.encode()).hexdigest(),
                "authority": "mutable" if unsafe_skill else "none",
                "toolIds": ["filesystem.write"] if unsafe_skill else [],
                "source": source,
            }
        entries = [entry]
        if kind == "knowledge-pack":
            for index, value in enumerate(extra_knowledge_texts):
                entries.append({
                    "id": f"developer.extra.{index:02d}",
                    "mediaType": "text/markdown",
                    "content": value,
                    "contentSha256": hashlib.sha256(value.encode()).hexdigest(),
                    "source": dict(source),
                })
        pack = {
            "schema": "ordax.profile-content-pack/1",
            "kind": kind,
            "entries": entries,
        }
        payload = canonical_bytes(pack)
        artifact_sha = hashlib.sha256(payload).hexdigest()
        component = {
            "id": "knowledge.developer-core" if kind == "knowledge-pack" else "skill.developer-review",
            "kind": kind,
            "version": "1.0.0",
            "sha256": artifact_sha,
            "installedAt": 100,
        }

        slot = (
            content_root / kind / component["id"] / "versions"
            / component["version"] / component["sha256"]
        )
        slot.mkdir(parents=True)
        content_file = slot / "content.pack"
        content_file.write_bytes(payload)
        os.chmod(content_file, 0o444)

        receipt = {
            "schema": "ordax.profile-install-receipt/1",
            "artifact": {
                "id": component["id"],
                "kind": kind,
                "version": component["version"],
                "sha256": artifact_sha,
                "sizeBytes": len(payload),
            },
            "verification": {
                "signatureAlgorithm": "ed25519",
                "keyId": "profile-test",
                "manifestSha256": "a" * 64,
                "verifiedAt": 90,
            },
            "health": {
                "schema": "ordax.profile-content-health/1",
                "state": "healthy",
                "checkedAt": 95,
                "entryCount": 1,
                "perEntryHashVerified": True,
                "perEntryProvenanceVerified": True,
                "executablePayloadAllowed": False,
                "authority": "none",
            },
            "installedAt": 100,
        }
        receipt_root.mkdir()
        receipt_payload = canonical_bytes(receipt)
        receipt_sha = hashlib.sha256(receipt_payload).hexdigest()
        (receipt_root / f"{receipt_sha}.json").write_bytes(receipt_payload)
        os.chmod(receipt_root / f"{receipt_sha}.json", 0o600)
        component["receiptSha256"] = receipt_sha

        inventory = {
            "schema": "ordax.profile-component-inventory/1",
            "revision": 1,
            "persistence": "device",
            "entries": [component],
        }
        inventory_path.write_bytes(canonical_bytes(inventory))
        os.chmod(inventory_path, 0o600)

        activation = {
            "schema": "ordax.profile-activation-state/1",
            "revision": 1,
            "persistence": "device",
            "spaces": [{
                "spaceId": "space-dev",
                "spaceKind": "professional",
                "current": {
                    "profile": {"slug": "developer", "version": 1},
                    "components": [component],
                    "activatedAt": 110,
                },
                "previous": None,
            }],
        }
        state_path.write_bytes(canonical_bytes(activation))
        os.chmod(state_path, 0o600)
        return {
            "content_root": str(content_root),
            "receipt_root": str(receipt_root),
            "inventory_path": str(inventory_path),
            "state_path": str(state_path),
            "lock_path": str(lock_path),
            "content_file": content_file,
        }

    def test_active_verified_knowledge_projects_bounded_context(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            fixture = self._fixture(module, directory)
            result = module.read_active_profile_content_context(
                "space-dev",
                activation_state_path=fixture["state_path"],
                inventory_path=fixture["inventory_path"],
                receipt_root=fixture["receipt_root"],
                content_root=fixture["content_root"],
            )
            self.assertEqual(result["profile"], {"slug": "developer", "version": 1})
            self.assertEqual(len(result["entries"]), 1)
            self.assertEqual(result["entries"][0]["scope"], "workspace")
            self.assertIn("autoridade separada", result["entries"][0]["text"])
            self.assertIn("profile-content:knowledge-pack:", result["entries"][0]["provenance"])
            self.assertLessEqual(len(result["entries"][0]["id"]), 160)


    def test_query_ranks_verified_late_entries_not_first_eight(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            texts = [
                f"Documento irrelevante sobre pintura e paisagem numero {i}."
                for i in range(10)
            ]
            texts[-1] = "A extrusão de filamento exige bico aquecido e fluxo controlado."
            fixture = self._fixture(
                module, directory, extra_knowledge_texts=texts,
            )
            old = module.read_active_profile_content_context(
                "space-dev",
                activation_state_path=fixture["state_path"],
                inventory_path=fixture["inventory_path"],
                receipt_root=fixture["receipt_root"],
                content_root=fixture["content_root"],
            )
            self.assertEqual(len(old["entries"]), 8)
            relevant = module.read_active_profile_content_context(
                "space-dev", query="Como corrigir extrusao de filamento?",
                activation_state_path=fixture["state_path"],
                inventory_path=fixture["inventory_path"],
                receipt_root=fixture["receipt_root"],
                content_root=fixture["content_root"],
            )
            self.assertEqual(len(relevant["entries"]), 1)
            self.assertIn("extrusão de filamento", relevant["entries"][0]["text"])
            self.assertIn("developer.extra.09", relevant["entries"][0]["provenance"])
            self.assertEqual(
                set(relevant["entries"][0]), {"id", "scope", "text", "provenance"},
            )

    def test_ranking_is_deterministic_and_ignores_unrelated_entries(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            fixture = self._fixture(
                module, directory, extra_knowledge_texts=[
                    "Filamento PLA e temperatura do bico.",
                    "A temperatura correta do filamento PLA evita entupimento.",
                    "Instruções alheias a impressão e filamento.",
                ],
            )
            options = {
                "activation_state_path": fixture["state_path"],
                "inventory_path": fixture["inventory_path"],
                "receipt_root": fixture["receipt_root"],
                "content_root": fixture["content_root"],
            }
            a = module.read_active_profile_content_context(
                "space-dev", query="temperatura filamento PLA", **options,
            )
            b = module.read_active_profile_content_context(
                "space-dev", query="temperatura filamento PLA", **options,
            )
            self.assertEqual(a, b)
            self.assertTrue(a["entries"])
            self.assertIn("temperatura correta", a["entries"][0]["text"])
            unrelated = module.read_active_profile_content_context(
                "space-dev", query="as de que o", **options,
            )
            self.assertEqual(unrelated["entries"], [])

    def test_relevance_excerpt_reaches_matching_text_after_first_8192_chars(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            long_text = ("manual generico sem referencia especial. " * 350)
            long_text += " Pressao de extrusao ajustada na impressora."
            fixture = self._fixture(
                module, directory, extra_knowledge_texts=[long_text],
            )
            response = module.read_active_profile_content_context(
                "space-dev", query="extrusao pressao",
                activation_state_path=fixture["state_path"],
                inventory_path=fixture["inventory_path"],
                receipt_root=fixture["receipt_root"],
                content_root=fixture["content_root"],
            )
            self.assertEqual(len(response["entries"]), 1)
            self.assertIn("extrusao ajustada", response["entries"][0]["text"])
            self.assertLessEqual(len(response["entries"][0]["text"]), 8192)

    def test_query_validation_and_content_hashes_still_fail_closed(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            fixture = self._fixture(module, directory)
            options = {
                "activation_state_path": fixture["state_path"],
                "inventory_path": fixture["inventory_path"],
                "receipt_root": fixture["receipt_root"],
                "content_root": fixture["content_root"],
            }
            with self.assertRaisesRegex(ValueError, "retrieval query"):
                module.read_active_profile_content_context(
                    "space-dev", query="x" * 257, **options,
                )
            with self.assertRaisesRegex(ValueError, "retrieval query"):
                module.read_active_profile_content_context(
                    "space-dev", query="  ", **options,
                )
            os.chmod(fixture["content_file"], 0o644)
            fixture["content_file"].write_bytes(b'{"not":"a-valid-pack"}')
            os.chmod(fixture["content_file"], 0o444)
            with self.assertRaisesRegex(ValueError, "hash does not match"):
                module.read_active_profile_content_context(
                    "space-dev", query="filamento", **options,
                )

    def test_missing_active_profile_returns_empty_context(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            fixture = self._fixture(module, directory)
            result = module.read_active_profile_content_context(
                "space-other",
                activation_state_path=fixture["state_path"],
                inventory_path=fixture["inventory_path"],
                receipt_root=fixture["receipt_root"],
                content_root=fixture["content_root"],
            )
            self.assertIsNone(result["profile"])
            self.assertEqual(result["entries"], [])

    def test_payload_tamper_fails_closed(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            fixture = self._fixture(module, directory)
            os.chmod(fixture["content_file"], 0o644)
            fixture["content_file"].write_text("tampered", encoding="utf-8")
            os.chmod(fixture["content_file"], 0o444)
            with self.assertRaisesRegex(ValueError, "hash does not match"):
                module.read_active_profile_content_context(
                    "space-dev",
                    activation_state_path=fixture["state_path"],
                    inventory_path=fixture["inventory_path"],
                    receipt_root=fixture["receipt_root"],
                    content_root=fixture["content_root"],
                )

    def test_skill_cannot_carry_authority_or_tools(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            fixture = self._fixture(module, directory, kind="skill-pack", unsafe_skill=True)
            with self.assertRaisesRegex(ValueError, "attempts to carry authority"):
                module.read_active_profile_content_context(
                    "space-dev",
                    activation_state_path=fixture["state_path"],
                    inventory_path=fixture["inventory_path"],
                    receipt_root=fixture["receipt_root"],
                    content_root=fixture["content_root"],
                )


if __name__ == "__main__":
    unittest.main()
