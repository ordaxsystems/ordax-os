"""Cold-boot Git discovery may run before Surface health; activation may not."""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/"system/supervisor").read_text(encoding="utf-8")

class OwnerColdBootPollingGate(unittest.TestCase):
    def test_owner_reaches_poll_loop_without_waiting_for_render(self):
        assert 'begin_owner_initial_surface_health' in SOURCE
        cold=SOURCE.split('record_owner_poll_boot_stage initialized',1)[1]
        branch=cold.split('record_owner_poll_boot_stage poll-loop-entered',1)[0]
        self.assertIn('begin_owner_initial_surface_health',branch)
        self.assertNotIn('wait_for_owner_initial_surface_health',branch)
        self.assertIn('record_owner_poll_boot_stage poll-loop-entered',SOURCE)

    def test_discovery_is_read_only_while_initial_health_pending(self):
        poll=SOURCE.split('check_for_update() {',1)[1].split('\n}\n',1)[0]
        first=poll.index('run_bounded_git "$REMOTE_TIMEOUT"')
        guard=poll.index('if [ "$OWNER_INITIAL_HEALTH_PENDING" -eq 1 ]; then')
        activation=poll.index('apply_remote_checkout')
        self.assertLess(first,guard)
        self.assertLess(guard,activation)
        gated=poll[guard:poll.index('\n    fi',guard)]
        self.assertIn('return 0', gated)
        self.assertNotIn('apply_remote_checkout',gated)

    def test_surface_health_remains_precondition_for_activation(self):
        loop=SOURCE.split('record_owner_poll_boot_stage poll-loop-entered',1)[1]
        self.assertIn('check_owner_initial_surface_health',loop)
        health=SOURCE.split('check_owner_initial_surface_health() {',1)[1].split('\n}\n',1)[0]
        self.assertIn('surface_health_matches "$initial_sha"',health)
        self.assertIn('OWNER_INITIAL_HEALTH_PENDING=0',health)
        self.assertIn('owner_initial_surface_health_failed',health)
        self.assertIn('rollback_boot_candidate',SOURCE)
        self.assertIn('owner_monotonic_seconds()',SOURCE)

    def test_single_helper_activation_per_pull(self):
        block=SOURCE.split('apply_remote_checkout() {',1)[1].split('\n}\n',1)[0]
        self.assertIn('"$PULL_BIN"',block)
        self.assertNotIn('refresh_dev_helpers "$expected_sha"',block)

if __name__=="__main__":
    unittest.main()
