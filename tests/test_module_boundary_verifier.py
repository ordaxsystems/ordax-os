import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "verify" / "module_boundaries.py"
SPEC = importlib.util.spec_from_file_location("ordax_module_boundaries", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)
CONTRACT = json.loads(
    (ROOT / "docs" / "contracts" / "module-boundaries.json").read_text(encoding="utf-8")
)


class ModuleBoundaryVerifierTests(unittest.TestCase):
    def write(self, root: Path, rel: str, content: str):
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def seed_roots(self, root: Path):
        for rel in (
            "system/contracts",
            "system/services",
            "system/apps",
            "system/surface",
            "system/adapters/web",
            "system/adapters/mobile",
            "system/adapters/desktop",
            "system/adapters/native",
            "system/composition",
            "bootstrap",
            "tools/creator",
        ):
            (root / rel).mkdir(parents=True, exist_ok=True)

    def test_current_repository_has_no_import_boundary_violations(self):
        self.assertEqual(MODULE.find_violations(ROOT, CONTRACT), [])

    def test_multiline_import_cannot_bypass_service_adapter_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/services/sync/client.ts",
                """import {
  privilegedPort,
} from "../../adapters/desktop/unsafe.mjs";
""",
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(
                any("services may not import adapters" in item for item in violations),
                violations,
            )

    def test_multiline_reexport_cannot_bypass_service_surface_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/services/sync/client.ts",
                """export {
  internalView,
} from "../../surface/ui/internal.mjs";
""",
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(
                any("services may not import surface" in item for item in violations),
                violations,
            )

    def test_multiline_allowed_app_service_dependency_still_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/apps/files/view.ts",
                """import {
  syncPort,
} from "../../services/sync/port.mjs";
""",
            )
            self.assertEqual(MODULE.find_violations(root, CONTRACT), [])

    def test_relative_surface_import_of_adapter_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/surface/view.ts",
                'import { camera } from "../adapters/mobile/camera";\n',
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("surface may not import adapters" in item for item in violations))

    def test_allowed_surface_import_of_app_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(root, "system/surface/view.ts", 'import "../apps/files";\n')
            self.assertEqual(MODULE.find_violations(root, CONTRACT), [])

    def test_service_import_of_surface_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(root, "system/services/sync/client.ts", 'import "../../surface/view";\n')
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("services may not import surface" in item for item in violations))

    def test_adapter_modes_cannot_import_each_other(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/adapters/web/runtime.ts",
                'import "../mobile/runtime";\n',
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("adapter mode web may not import mobile" in item for item in violations))

    def test_composition_may_wire_surface_and_adapter(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/composition/web/main.mjs",
                'import "../../surface/ui/surface.mjs";\nimport "../../adapters/web/runtime.mjs";\n',
            )
            self.assertEqual(MODULE.find_violations(root, CONTRACT), [])

    def test_composition_may_mount_app_entrypoints(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/composition/web/main.mjs",
                'import "../../apps/files/index.mjs";\n',
            )
            self.assertEqual(MODULE.find_violations(root, CONTRACT), [])

    def test_ordax_alias_is_resolved_to_shared_layer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/apps/files/index.ts",
                'import { sync } from "@ordax/services/sync";\n',
            )
            self.assertEqual(MODULE.find_violations(root, CONTRACT), [])

    def test_relative_import_cannot_escape_os_into_sibling_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "ordax-os"
            self.seed_roots(root)
            self.write(
                root,
                "system/services/user/context.mjs",
                'import { authority } from "../../../../ordax-platform/src/private.mjs";\\n',
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertEqual(len(violations), 1, violations)
            self.assertIn("may not import outside repository", violations[0])
            self.assertIn("ordax-platform", violations[0])

    def test_creator_require_cannot_escape_into_external_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "ordax-os"
            self.seed_roots(root)
            self.write(
                root,
                "tools/creator/windows/runtime.cjs",
                'const runtime = require("../../../../ordax-runtime/src/private.cjs");\\n',
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertEqual(len(violations), 1, violations)
            self.assertIn("may not import outside repository", violations[0])
            self.assertIn("ordax-runtime", violations[0])

    def test_dynamic_import_cannot_escape_to_external_visual_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "ordax-os"
            self.seed_roots(root)
            self.write(
                root,
                "system/composition/web/host.js",
                'const view = import("../../../../ordax-surface/system/surface/ui");\\n',
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertEqual(len(violations), 1, violations)
            self.assertIn("may not import outside repository", violations[0])
            self.assertIn("ordax-surface", violations[0])

    def test_python_relative_import_across_services_and_adapters_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/services/sync/client.py",
                "from ...adapters.desktop import privileged_port\\n",
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(
                any("services may not import adapters" in item for item in violations),
                violations,
            )

    def test_python_from_parent_import_blocks_cross_adapter_mode_and_surface(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/adapters/web/port.py",
                "from .. import mobile\\n",
            )
            self.write(
                root,
                "system/services/sync/client.py",
                "from ... import surface\\n",
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("adapter mode web may not import mobile" in x for x in violations), violations)
            self.assertTrue(any("services may not import surface" in x for x in violations), violations)

    def test_python_relative_import_cannot_escape_into_sibling_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "ordax-os"
            self.seed_roots(root)
            self.write(
                root,
                "system/services/sync/client.py",
                "from ....ordax_platform.private import token\\n",
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertEqual(len(violations), 1, violations)
            self.assertIn("may not import outside repository", violations[0])

    def test_python_qualified_and_allowed_imports_preserve_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/services/sync/client.py",
                "from ...contracts import capability\\n"
                "from system.contracts import public_port\\n"
                "import os, json\\n"
                "# from ...adapters.mobile import forbidden\\n",
            )
            self.assertEqual(MODULE.find_violations(root, CONTRACT), [])
            self.write(
                root,
                "system/services/sync/client.py",
                "from system import adapters\\n",
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("services may not import adapters" in x for x in violations), violations)

    def test_spaced_commonjs_and_require_resolve_are_not_boundary_bypasses(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "system/services/sync/adapter.cjs",
                "const a = require ( \"../../adapters/desktop/private.cjs\" );\\n"
                "const b = require.resolve ( \"../../surface/ui.mjs\" );\\n",
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("services may not import adapters" in x for x in violations), violations)
            self.assertTrue(any("services may not import surface" in x for x in violations), violations)

    def test_creator_source_cannot_import_shared_product_implementation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.seed_roots(root)
            self.write(
                root,
                "tools/creator/client.ts",
                'import "../../system/surface/view";\n',
            )
            violations = MODULE.find_violations(root, CONTRACT)
            self.assertTrue(any("Creator source may not import shared system" in item for item in violations))


if __name__ == "__main__":
    unittest.main()
