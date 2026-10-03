from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "native_security_prompt_i18n.py"
PORTUGUESE_MARKER = re.compile(
    r"[ãõáéíóúâêôç]|\\b(?:abrir|ajustes|conta|continuar|disponível|falha|perfil|senha|sessão|sistema)\\b",
    re.IGNORECASE,
)


def load_module():
    spec = spec_from_file_location("ordax_native_security_prompt_english_audit", MODULE)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class NativeSecurityPromptEnglishAuditTests(unittest.TestCase):
    def test_en_us_security_prompt_is_complete_and_has_no_pt_br_copy(self):
        module = load_module()
        source = module.profile_consent_messages("pt-BR")
        english = module.profile_consent_messages("en-US")
        self.assertEqual(set(english), set(source))
        for key, value in english.items():
            self.assertIsInstance(value, str)
            self.assertTrue(value)
            self.assertIsNone(
                PORTUGUESE_MARKER.search(value),
                f"{key}: possible PT-BR copy leaked into en-US: {value}",
            )


if __name__ == "__main__":
    unittest.main()
