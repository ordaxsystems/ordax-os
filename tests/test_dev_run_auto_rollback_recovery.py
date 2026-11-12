from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "bootstrap" / "dev-base" / "ordax-run"
PULL = ROOT / "bootstrap" / "dev-base" / "ordax-pull"


def test_ordax_run_never_checks_remote_main_before_surface_boot():
    text = RUN.read_text(encoding="utf-8")
    watcher = (ROOT / "bootstrap/dev-base/ordax-main-watch").read_text(encoding="utf-8")
    supervisor = (ROOT / "system/supervisor").read_text(encoding="utf-8")
    init = (ROOT / "bootstrap/dev-base/ordax-dev-init").read_text(encoding="utf-8")

    # The rollback pin starts the exact local checkout first, without a Git
    # fetch. Online recovery belongs to the one runtime update owner.
    assert "recover_automatic_rollback_pin" not in text
    assert "ORDAX_AUTOMATIC_ROLLBACK_RECOVERY" not in text
    assert "ordax-pull" not in text
    assert "PULL_BIN" not in text
    assert 'if [ -s "$PINNED_FILE" ]; then' in init
    assert "start_local_surface pinned-graphical" in init
    assert 'first_run_receipt=$STATE_DIR/native-state/first-run.json' in watcher
    assert 'first_run_receipt=$STATE_DIR/native-state/first-run.json' in supervisor
    assert 'ORDAX_AUTOMATIC_ROLLBACK_RECOVERY=1 "$BIN_DIR/ordax-pull"' in watcher
    assert "check_for_update" in supervisor


def test_automatic_pull_refuses_same_known_good_or_rejected_delivery():
    text = PULL.read_text(encoding="utf-8")
    assert 'AUTOMATIC_ROLLBACK_RECOVERY=${ORDAX_AUTOMATIC_ROLLBACK_RECOVERY:-0}' in text
    assert 'BOOT_REJECTED_FILE=$STATE_DIR/boot-rejected-commit' in text
    assert '[ "$remote_sha" = "$recovery_pinned" ]' in text
    assert "main ainda aponta para o known-good fixado" in text
    assert '[ "$remote_sha" = "$recovery_rejected" ]' in text
    assert "main ainda aponta para a entrega rejeitada" in text
    assert '[ "$current" = "$recovery_pinned" ] || [ "$current" = "$recovery_rejected" ]' in text
    assert 'rm -f "$PINNED_FILE" "$BOOT_REJECTED_FILE"' in text


def test_manual_pull_keeps_explicit_manual_unpin_semantics():
    text = PULL.read_text(encoding="utf-8")
    final = text.rsplit('if [ "$AUTOMATIC_ROLLBACK_RECOVERY" -eq 1 ]; then', 1)[1]
    assert 'else\n    rm -f "$PINNED_FILE"\nfi' in final


def test_offline_boot_checks_local_identity_before_graphical_entrypoint():
    text = RUN.read_text(encoding="utf-8")
    source_read = text.index('source_sha=$("$GIT_BIN" -C "$WORKTREE" rev-parse HEAD')
    recorded = text.index('recorded_sha=$(read_state_value "$CURRENT_FILE")')
    entry_start = text.index('ORDAX_DISTRIBUTION_PROFILE=owner-development')
    assert source_read < recorded < entry_start
    assert '[ "$recorded_sha" = "$source_sha" ]' in text
    assert 'checkout_status=$("$GIT_BIN" -C "$WORKTREE" status --porcelain' in text
    # The fast boot may initialize wireless hardware locally, but can never
    # contact remote main until the supervisor confirms First Run completion.
    start = text.index('echo "ordax-run: starting Owner/Development runtime')
    assert 'git fetch' not in text[:start]
    assert 'git ls-remote' not in text[:start]


def test_dev_helpers_shell_syntax():
    for script in (RUN, PULL):
        completed = subprocess.run(["sh", "-n", str(script)], capture_output=True, text=True)
        assert completed.returncode == 0, f"{script}: {completed.stderr}"
