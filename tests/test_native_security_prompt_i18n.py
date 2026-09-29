from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import os
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "native_security_prompt_i18n.py"


def load_module():
    spec = spec_from_file_location("ordax_native_security_prompt_i18n_test", MODULE)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class NativeSecurityPromptI18nTests(unittest.TestCase):
    def test_supported_profile_consent_locales_are_complete(self):
        module = load_module()
        required = {
            "windowTitle", "heading", "cancel", "approve", "profile", "space",
            "componentsAdded", "authorityChanges", "component", "unknown", "warning",
        }
        self.assertEqual(
            module.SUPPORTED_LOCALES,
            frozenset(("pt-BR", "en-US", "es-ES", "de-DE", "fr-FR")),
        )
        for locale in module.SUPPORTED_LOCALES:
            messages = module.profile_consent_messages(locale)
            self.assertEqual(set(messages), required)
            self.assertTrue(all(isinstance(value, str) and value for value in messages.values()))

    def test_locale_reads_existing_regional_preference_and_falls_back_safely(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "preferences.json"
            path.write_text('{"regional.locale":"en-US"}', encoding="utf-8")
            self.assertEqual(module.read_native_security_locale(str(path)), "en-US")

            path.write_text('{"regional.locale":"xx-ZZ"}', encoding="utf-8")
            self.assertEqual(module.read_native_security_locale(str(path)), "pt-BR")

            path.write_text("not-json", encoding="utf-8")
            self.assertEqual(module.read_native_security_locale(str(path)), "pt-BR")

    def test_locale_reader_rejects_symlink_and_oversized_preferences(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target.json"
            target.write_text('{"regional.locale":"fr-FR"}', encoding="utf-8")
            link = root / "preferences.json"
            os.symlink(target, link)
            self.assertEqual(module.read_native_security_locale(str(link)), "pt-BR")

            oversized = root / "oversized.json"
            oversized.write_text("x" * (module.MAX_PREFERENCES_BYTES + 1), encoding="utf-8")
            self.assertEqual(module.read_native_security_locale(str(oversized)), "pt-BR")

    def test_unknown_locale_uses_pt_br_catalog(self):
        module = load_module()
        self.assertEqual(
            module.profile_consent_messages("unknown"),
            module.profile_consent_messages("pt-BR"),
        )


if __name__ == "__main__":
    unittest.main()
