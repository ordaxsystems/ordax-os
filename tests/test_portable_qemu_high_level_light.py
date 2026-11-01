import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
CLASSIFIER = ROOT / "tools" / "ci" / "portable_qemu_impact.py"
spec = importlib.util.spec_from_file_location("portable_qemu_impact_high_level_test", CLASSIFIER)
impact = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = impact
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


def test_space_owner_sql_fix_has_focused_postgres_proof_without_boot_rebuild():
    result = impact.classify_paths([
        "infra/supabase/product/migrations/20261031051500_space_owner_ssot_creation_fix_v1.sql",
        "tests/sql/test_space_creation_authority_v1.sql",
        "tests/test_space_creation_authority.mjs",
        ".github/workflows/space-creation-authority-v1-proof.yml",
    ])
    assert result.required is False
    heavy = impact.classify_paths(["bootstrap/initramfs/entrypoint"])
    assert heavy.required is True


def test_native_account_transport_and_focused_contracts_do_not_require_portable_qemu():
    result = impact.classify_paths([
        "system/surface/runtime/native_account_gateway.py",
        "docs/contracts/native-account-session.json",
        "infra/supabase/functions/ordax-account-gateway/index.ts",
        "infra/supabase/functions/_shared/space_create_contract.mjs",
        ".github/workflows/ordax-account-gateway-destination.yml",
        ".github/workflows/space-foundation-contract-proof.yml",
        "tests/test_native_account_gateway.py",
        "tests/test_native_account_session_contract.py",
        "tests/test_space_create_bridge.mjs",
        "tests/test_account_gateway_destination_deploy.py",
    ])
    assert result.required is False


def test_other_native_runtime_sources_remain_portable_qemu_heavy():
    result = impact.classify_paths([
        "system/surface/runtime/ordax_browser_host.py",
    ])
    assert result.required is True
    assert "heavy-prefix:system/surface/runtime/ordax_browser_host.py" in result.reasons


def test_unclassified_non_system_test_remains_fail_closed():
    result = impact.classify_paths(["tests/test_unknown_boot_sensitive_owner.py"])
    assert result.required is True
    assert "heavy-non-system:tests/test_unknown_boot_sensitive_owner.py" in result.reasons
