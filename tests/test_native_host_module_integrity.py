from pathlib import Path
import ast
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
REQUEST_BOUNDARY = ROOT / "system" / "surface" / "runtime" / "native_request_boundary.py"
COMPONENT_SLOTS = ROOT / "system" / "surface" / "runtime" / "native_component_slots.py"
ACCOUNT_GATEWAY = ROOT / "system" / "surface" / "runtime" / "native_account_gateway.py"
SPLIT_CORE = ROOT / "system" / "surface" / "runtime" / "native_host_server_core.py"


class NativeHostModuleIntegrityTests(unittest.TestCase):
    def test_native_host_keeps_one_canonical_runtime_module(self):
        source = HOST.read_text(encoding="utf-8")
        tree = ast.parse(source)

        classes = {
            node.name: node
            for node in tree.body
            if isinstance(node, ast.ClassDef)
        }
        functions = {
            node.name: node
            for node in tree.body
            if isinstance(node, ast.FunctionDef)
        }

        self.assertIn("NativeHostServer", classes)
        self.assertIn("NativeHostHandler", classes)
        self.assertIn("main", functions)

        handler_methods = {
            node.name
            for node in classes["NativeHostHandler"].body
            if isinstance(node, ast.FunctionDef)
        }
        self.assertIn("do_GET", handler_methods)
        self.assertIn("do_POST", handler_methods)
        self.assertIn("do_OPTIONS", handler_methods)

        self.assertFalse(
            SPLIT_CORE.exists(),
            "native host state/functions must not be split behind a wildcard wrapper",
        )
        self.assertNotIn("native_host_server_core", source)
        self.assertNotIn("import *", source)
        self.assertTrue(REQUEST_BOUNDARY.is_file(), REQUEST_BOUNDARY)
        self.assertTrue(COMPONENT_SLOTS.is_file(), COMPONENT_SLOTS)
        self.assertTrue(ACCOUNT_GATEWAY.is_file(), ACCOUNT_GATEWAY)
        self.assertIn("from native_request_boundary import (", source)
        self.assertIn("expected_surface_authority,", source)
        self.assertIn("opaque_signed_module_read_is_trusted,", source)
        self.assertIn("request_is_trusted,", source)
        self.assertIn("from native_account_gateway import NativeAccountGateway, NativeAccountGatewayError", source)
        self.assertIn("from native_component_slots import (", source)
        self.assertIn("def _request_is_trusted(self)", source)
        self.assertIn("def guess_type(self, path: str) -> str:", source)
        self.assertIn('return "text/javascript"', source)
        parser = next(
            node for node in classes["NativeHostHandler"].body
            if isinstance(node, ast.FunctionDef) and node.name == "parse_request"
        )
        parser_source = ast.get_source_segment(source, parser) or ""
        self.assertIn("super().parse_request()", parser_source)
        self.assertIn("return self._request_is_trusted()", parser_source)
        for method in ("do_GET", "do_POST", "do_OPTIONS"):
            method_node = next(
                node for node in classes["NativeHostHandler"].body
                if isinstance(node, ast.FunctionDef) and node.name == method
            )
            method_source = ast.get_source_segment(source, method_node) or ""
            self.assertNotIn("self._request_is_trusted()", method_source)

    def test_account_registration_uses_gateway_policy_and_requires_consent(self):
        source = HOST.read_text(encoding="utf-8")
        self.assertNotIn("ACCOUNT_REGISTRATION_ENABLED", source)
        self.assertIn('ACCOUNT_REGISTRATION_POLICY_PATH = "/auth/registration-policy"', source)
        self.assertIn("reply = self.server.account_gateway.registration_policy()", source)
        self.assertNotIn('payload["registrationEnabled"] = bool(', source)
        self.assertIn('ACCOUNT_REGISTER_PATH = "/auth/register"', source)
        self.assertIn('{"email", "password", "legalAcceptance"}', source)
        self.assertIn('payload.get("legalAcceptance") is not True', source)
        self.assertIn("self.server.account_gateway.register(email, password, legal_accepted=True)", source)
        self.assertIn("if reply.status not in {200, 202, 303}:", source)
        self.assertIn("self._empty(reply.status)", source)
        self.assertIn('ACCOUNT_CLOSE_PATH = "/account/close"', source)
        self.assertIn("self.server.account_gateway.close_account(password, confirmation)", source)
        self.assertIn('set(payload) != {"password", "confirmation"}', source)
        self.assertNotIn("ACCOUNT_CLOSE_ENABLED =", source)


if __name__ == "__main__":
    unittest.main()
