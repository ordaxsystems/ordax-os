import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "intelligence-task.json"
TASK = ROOT / "system" / "contracts" / "intelligence-task.mjs"
PLANNER = ROOT / "system" / "services" / "intelligence" / "task-planner.mjs"
INTELLIGENCE = ROOT / "system" / "contracts" / "intelligence.mjs"
RUNTIME = ROOT / "system" / "services" / "intelligence" / "runtime.mjs"


class IntelligenceTaskPlanningFoundationTests(unittest.TestCase):
    def test_contract_is_non_executable_and_provider_neutral(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["$schema"], "prototype-ordax.intelligence-task-plan/1")
        self.assertEqual(contract["stable_schema"], "ordax.intelligence-task-plan/1")
        self.assertEqual(contract["planner_schema"], "ordax.intelligence-task-planner/1")
        self.assertEqual(contract["output"]["authority"], "none")
        self.assertFalse(contract["output"]["executable"])
        self.assertFalse(contract["output"]["tool_execution"])
        self.assertFalse(contract["security"]["model_may_grant_capability"])
        self.assertFalse(contract["security"]["prompt_may_grant_capability"])
        self.assertTrue(contract["security"]["future_execution_requires_separate_capability_contract"])

    def test_source_preserves_planning_as_consultative_intent(self):
        intelligence = INTELLIGENCE.read_text(encoding="utf-8")
        runtime = RUNTIME.read_text(encoding="utf-8")
        task = TASK.read_text(encoding="utf-8")
        planner = PLANNER.read_text(encoding="utf-8")

        self.assertIn('"plan"', intelligence)
        self.assertIn('plan: "reason"', runtime)
        self.assertIn('authority !== "none"', task)
        self.assertIn('value.executable !== false', task)
        self.assertIn('value.toolExecution !== false', task)
        self.assertIn('requestedCapabilities: []', planner)
        self.assertIn('intent: "plan"', planner)
        self.assertIn('Do not execute tools', planner)
        self.assertNotIn("fetch(", planner)
        self.assertNotIn("child_process", planner)
        self.assertNotIn("exec(", planner)


if __name__ == "__main__":
    unittest.main()
