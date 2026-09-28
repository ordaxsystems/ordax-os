from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FIRST_RUN = ROOT / "system" / "surface" / "ui" / "first-run.mjs"
I18N = ROOT / "system" / "services" / "i18n" / "first-run.mjs"
POLICY_TEXT = "Use pelo menos 6 caracteres e repita exatamente a mesma credencial."
OPTIONAL_TEXT = "Deixe os dois campos vazios para continuar sem bloqueio autenticado. Você poderá configurar depois em Ajustes."


class FirstRunCredentialPolicyTests(unittest.TestCase):
    def test_security_policy_is_visible_before_submission(self):
        source = FIRST_RUN.read_text(encoding="utf-8")
        form_end = source.index("body.append(form);", source.index("const renderSecurity"))
        visible_policy = source.index(f'"{POLICY_TEXT}"', form_end)
        optional_path = source.index(f'"{OPTIONAL_TEXT}"', visible_policy)
        reactive_error = source.index("if (localSessionMessage)", optional_path)

        self.assertLess(form_end, visible_policy)
        self.assertLess(visible_policy, optional_path)
        self.assertLess(optional_path, reactive_error)
        self.assertGreaterEqual(source.count(f'"{POLICY_TEXT}"'), 2)

    def test_visible_policy_matches_the_enforced_minimum(self):
        source = FIRST_RUN.read_text(encoding="utf-8")
        self.assertIn("secret.minLength = 6;", source)
        self.assertIn("confirm.minLength = 6;", source)
        self.assertIn("localSessionSecretDraft.length < 6", source)

    def test_existing_policy_copy_remains_localized(self):
        translations = I18N.read_text(encoding="utf-8")
        self.assertGreaterEqual(translations.count(f'"{POLICY_TEXT}"'), 2)
        self.assertIn("Use at least 6 characters", translations)
        self.assertIn("Usa al menos 6 caracteres", translations)


if __name__ == "__main__":
    unittest.main()
