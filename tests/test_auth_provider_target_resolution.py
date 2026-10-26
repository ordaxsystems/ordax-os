import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools" / "public-site"
sys.path.insert(0, str(TOOLS))
SPEC = importlib.util.spec_from_file_location(
    "resolve_auth_provider_target", TOOLS / "resolve_auth_provider_target.py"
)
TARGET = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(TARGET)


class AuthProviderTargetResolutionTests(unittest.TestCase):
    def fixture(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        for relative in (TARGET.HARDENING, TARGET.POLICY, TARGET.DESTINATION_PLAN):
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, destination)
        return temporary, root

    def load(self, root, relative):
        return json.loads((root / relative).read_text(encoding="utf-8"))

    def save(self, root, relative, data):
        (root / relative).write_text(json.dumps(data), encoding="utf-8")

    def test_current_active_provider_is_not_mistaken_for_unpromoted_destination(self):
        actual = TARGET.resolve_target(ROOT, "https://ordax.com.br")
        hardening = self.load(ROOT, TARGET.HARDENING)
        plan = self.load(ROOT, TARGET.DESTINATION_PLAN)
        self.assertEqual(actual, (hardening["target"]["project_ref"], "https://ordax.com.br"))
        if hardening["postgresql_destination"]["functional_provider_cutover_complete"]:
            self.assertEqual(actual[0], plan["destination_project_ref"])
        else:
            self.assertNotEqual(actual[0], plan["destination_project_ref"])

    def test_destination_scope_proves_destination_without_promoting_auth(self):
        hardening = self.load(ROOT, TARGET.HARDENING)
        destination = hardening["postgresql_destination"]
        active = TARGET.resolve_target(ROOT, "https://ordax.com.br")
        dest = TARGET.resolve_target(ROOT, "https://ordax.com.br", scope="destination")
        self.assertEqual(dest[0], destination["project_ref"])
        self.assertNotEqual(dest[0], active[0])
        self.assertFalse(destination["functional_provider_cutover_complete"])
        self.assertFalse(destination["public_registration_enabled"])
        self.assertFalse(destination["public_login_enabled"])

    def test_destination_scope_rejects_partial_activation_and_cutover(self):
        temp, root = self.fixture()
        try:
            value = self.load(root, TARGET.HARDENING)
            stage = value["postgresql_destination"]
            stage["public_registration_enabled"] = True
            self.save(root, TARGET.HARDENING, value)
            with self.assertRaisesRegex(ValueError, "remain disabled"):
                TARGET.resolve_target(root, "https://ordax.com.br", scope="destination")
            stage["public_registration_enabled"] = False
            stage["functional_provider_cutover_complete"] = True
            value["target"]["project_ref"] = stage["project_ref"]
            self.save(root, TARGET.HARDENING, value)
            with self.assertRaisesRegex(ValueError, "unavailable after verified cutover"):
                TARGET.resolve_target(root, "https://ordax.com.br", scope="destination")
            with self.assertRaisesRegex(ValueError, "unsupported provider probe scope"):
                TARGET.resolve_target(root, "https://ordax.com.br", scope="shadow")
        finally:
            temp.cleanup()

    def test_rejects_unapproved_origin_or_malformed_project_ref(self):
        with self.assertRaisesRegex(ValueError, "requested origin"):
            TARGET.resolve_target(ROOT, "https://example.com")
        temp, root = self.fixture()
        try:
            hardening = self.load(root, TARGET.HARDENING)
            hardening["target"]["project_ref"] = "malicious-ref\\nATTACK=1"
            self.save(root, TARGET.HARDENING, hardening)
            with self.assertRaisesRegex(ValueError, "invalid project reference"):
                TARGET.resolve_target(root, "https://ordax.com.br")
        finally:
            temp.cleanup()

    def test_rejects_destination_plan_drift(self):
        temp, root = self.fixture()
        try:
            plan = self.load(root, TARGET.DESTINATION_PLAN)
            plan["destination_project_ref"] = "a" * 20
            self.save(root, TARGET.DESTINATION_PLAN, plan)
            with self.assertRaisesRegex(ValueError, "migration SSOT"):
                TARGET.resolve_target(root, "https://ordax.com.br")
        finally:
            temp.cleanup()

    def test_cutover_state_and_active_owner_must_agree(self):
        temp, root = self.fixture()
        try:
            hardening = self.load(root, TARGET.HARDENING)
            destination = hardening["postgresql_destination"]["project_ref"]
            hardening["target"]["project_ref"] = destination
            self.save(root, TARGET.HARDENING, hardening)
            with self.assertRaisesRegex(ValueError, "before verified cutover"):
                TARGET.resolve_target(root, "https://ordax.com.br")

            hardening["postgresql_destination"]["functional_provider_cutover_complete"] = True
            self.save(root, TARGET.HARDENING, hardening)
            self.assertEqual(TARGET.resolve_target(root, "https://ordax.com.br")[0], destination)

            hardening["target"]["project_ref"] = "b" * 20
            self.save(root, TARGET.HARDENING, hardening)
            with self.assertRaisesRegex(ValueError, "without target switch"):
                TARGET.resolve_target(root, "https://ordax.com.br")

            hardening["postgresql_destination"]["functional_provider_cutover_complete"] = "true"
            self.save(root, TARGET.HARDENING, hardening)
            with self.assertRaisesRegex(ValueError, "must be a boolean"):
                TARGET.resolve_target(root, "https://ordax.com.br")
        finally:
            temp.cleanup()

    def test_destination_mode_outputs_only_verified_values(self):
        from contextlib import redirect_stdout
        from io import StringIO

        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(TARGET.main([
                "--root", str(ROOT), "--origin", "https://ordax.com.br",
                "--scope", "destination",
            ]), 0)
        values = output.getvalue().splitlines()
        self.assertEqual(len(values), 2)
        self.assertEqual(
            values[0],
            "SUPABASE_PROJECT_REF=" + self.load(
                ROOT, TARGET.HARDENING
            )["postgresql_destination"]["project_ref"],
        )
        self.assertEqual(values[1], "ORDAX_PUBLIC_ORIGIN=https://ordax.com.br")

    def test_environment_output_is_only_validated_assignments(self):
        from contextlib import redirect_stdout
        from io import StringIO

        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(TARGET.main(["--root", str(ROOT), "--origin", "https://ordax.com.br"]), 0)
        lines = output.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertRegex(lines[0], r"^SUPABASE_PROJECT_REF=[a-z0-9]{20}$")
        self.assertEqual(lines[1], "ORDAX_PUBLIC_ORIGIN=https://ordax.com.br")


if __name__ == "__main__":
    unittest.main()
