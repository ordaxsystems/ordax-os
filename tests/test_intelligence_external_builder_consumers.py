"""Reject cross-repo cutovers that silently restore the OS legacy AI builder.

The public OS contracts and signed local-AI model lock remain canonical, while
the technical builder must come from the verified immutable Intelligence source.
"""
from __future__ import annotations

import ast
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
QEMU = ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml"
CANDIDATE = ROOT / ".github/workflows/local-ai-runtime-candidate.yml"
CACHE = ROOT / "tools/ci/portable_component_cache.py"
GATE = ROOT / ".github/workflows/intelligence-source.yml"

EXTERNAL_BUILDER = 'python "$ORDAX_EXTERNAL_AI_BUILDER" --os-source "$GITHUB_WORKSPACE"'
RESOLVER = "uses: ./.github/actions/resolve-intelligence-builder"


def assert_builder_consumer(source: str, label: str) -> None:
    if source.count(RESOLVER) != 1:
        raise AssertionError(f"{label}: expected exactly one shared immutable resolver")
    builds = re.findall(
        r'^\s*python "\$ORDAX_EXTERNAL_AI_BUILDER" --os-source "\$GITHUB_WORKSPACE" build \\\s*$',
        source,
        re.MULTILINE,
    )
    verifies = re.findall(
        r'^\s*python "\$ORDAX_EXTERNAL_AI_BUILDER" --os-source "\$GITHUB_WORKSPACE" verify \\\s*$',
        source,
        re.MULTILINE,
    )
    if not builds or not verifies:
        raise AssertionError(f"{label}: real build AND verify must use the pinned external builder")
    if re.search(r'^\s*python(?:3)? bootstrap/local-ai-runtime/build\.py build\b', source, re.MULTILINE):
        raise AssertionError(f"{label}: legacy OS builder cannot build the real image")
    if "python bootstrap/local-ai-runtime/build.py verify" not in source:
        raise AssertionError(f"{label}: preserve transitional canonical OS ABI cross-verifier")


def local_ai_cache_inputs(source: str) -> tuple[str, ...]:
    tree = ast.parse(source)
    components = next(
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(name, ast.Name) and name.id == "COMPONENTS" for name in node.targets)
    )
    return components["local-ai"]["inputs"]


def assert_cache_binds_source(inputs: tuple[str, ...]) -> None:
    for name in (
        "docs/contracts/intelligence-source.json",
        "tools/intelligence-source/materialize.py",
        ".github/actions/resolve-intelligence-builder/action.yml",
        "system/services/local-ai/source-lock.json",
        "docs/contracts/local-ai.json",
    ):
        if name not in inputs:
            raise AssertionError(f"local-ai cache omits immutable builder or OS policy: {name}")


class ExternalBuilderConsumerRegressionTests(unittest.TestCase):
    def test_qemu_and_real_model_candidate_use_only_verified_external_builder(self):
        assert_builder_consumer(QEMU.read_text(encoding="utf-8"), "Portable/QEMU")
        assert_builder_consumer(CANDIDATE.read_text(encoding="utf-8"), "Local AI candidate")

    def test_cache_reuse_cannot_ignore_external_builder_or_os_model_policy(self):
        assert_cache_binds_source(local_ai_cache_inputs(CACHE.read_text(encoding="utf-8")))

    def test_gate_monitors_both_critical_consumers_in_pr_and_main(self):
        gate = GATE.read_text(encoding="utf-8")
        pr, push = gate.split("  push:", 1)
        for block in (pr, push):
            for name in (
                ".github/workflows/portable-v2-qemu-boot-proof.yml",
                ".github/workflows/local-ai-runtime-candidate.yml",
                "tools/ci/portable_component_cache.py",
                "tests/test_intelligence_external_builder_consumers.py",
            ):
                self.assertIn("'" + name + "'", block)
        self.assertIn("python -m unittest tests.test_intelligence_external_builder_consumers -v", gate)

    def test_windows_candidate_consumer_runs_the_os_pinned_source(self):
        gate = GATE.read_text(encoding="utf-8")
        start = gate.index("  verify-windows-consumer:")
        windows_job = gate[start:]
        for required in (
            "runs-on: windows-2022",
            "https://github.com/ordaxsystems/ordax-intelligence.git",
            "checkout --quiet --detach $env:EXPECTED_SOURCE_SHA",
            "tools/intelligence-source/materialize.py stage",
            "tests/test_intelligence_external_integration.mjs",
            "status -ne 'integration-candidate'",
            "activation_authorized -ne $false",
        ):
            self.assertIn(required, windows_job)
        pull_request, push = gate.split("  push:", 1)
        for block in (pull_request, push):
            self.assertIn("'docs/contracts/intelligence-source.json'", block)
            self.assertIn("'tests/test_intelligence_external_integration.mjs'", block)
            self.assertIn("'tests/test_intelligence_external_builder_consumers.py'", block)

    def test_mutated_legacy_build_and_unpinned_cache_are_rejected(self):
        original = QEMU.read_text(encoding="utf-8")
        legacy = original.replace(
            EXTERNAL_BUILDER + " build",
            "python bootstrap/local-ai-runtime/build.py build",
        )
        self.assertNotEqual(original, legacy)
        with self.assertRaisesRegex(AssertionError, "external builder|legacy OS builder"):
            assert_builder_consumer(legacy, "mutation")
        inputs = local_ai_cache_inputs(CACHE.read_text(encoding="utf-8"))
        without_pin = tuple(x for x in inputs if x != "docs/contracts/intelligence-source.json")
        with self.assertRaisesRegex(AssertionError, "immutable builder or OS policy"):
            assert_cache_binds_source(without_pin)


if __name__ == "__main__":
    unittest.main()
