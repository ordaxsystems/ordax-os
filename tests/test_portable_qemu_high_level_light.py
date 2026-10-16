import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLASSIFIER = ROOT / "tools" / "ci" / "portable_qemu_impact.py"
spec = importlib.util.spec_from_file_location("portable_qemu_impact_high_level_test", CLASSIFIER)
impact = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(impact)


def test_power_adapter_and_its_focused_contract_do_not_require_portable_qemu():
    result = impact.classify_paths([
        "system/adapters/native/power-actions.mjs",
        "tests/test_power_actions.mjs",
    ])
    assert result.required is False


def test_update_presentation_and_its_focused_contract_do_not_require_portable_qemu():
    result = impact.classify_paths([
        "system/services/update/presentation.mjs",
        "tests/test_update_presentation_pinned.mjs",
    ])
    assert result.required is False


def test_unclassified_non_system_test_remains_fail_closed():
    result = impact.classify_paths(["tests/test_unknown_boot_sensitive_owner.py"])
    assert result.required is True
    assert "heavy-non-system:tests/test_unknown_boot_sensitive_owner.py" in result.reasons
