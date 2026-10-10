"""Regression tests for the Internet's pre-cutover public SDK boundary."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "tools/verify/internet_sdk_readiness.py"
spec = importlib.util.spec_from_file_location("internet_sdk_readiness_test", SCRIPT)
checker = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(checker)


def fixture(root: Path, *, sdk_paths: tuple[str, ...] = ()) -> Path:
    app = root / "system/apps/internet"
    app.mkdir(parents=True, exist_ok=True)
    (root / "system/contracts").mkdir(parents=True)
    (root / "system/apps/private-bootstrap.mjs").write_text("export const internal=true;\n", encoding="utf-8")
    for path in ("browser-session.mjs", "component-runtime.mjs"):
        (root / "system/contracts" / path).write_text("export const port=true;\n", encoding="utf-8")
    (app / "runtime.mjs").write_text(
        'import { x } from "../../contracts/browser-session.mjs";\n'
        'export { y } from "../../contracts/component-runtime.mjs";\n'
        'const style = new URL("./internet.css", import.meta.url);\n',
        encoding="utf-8",
    )
    (app / "internet.css").write_text(".ok{}\n", encoding="utf-8")
    sdk = root / "sdk/app-sdk-v1/bundle.json"
    sdk.parent.mkdir(parents=True)
    sdk.write_text(json.dumps({
        "$schema": "ordax.app-sdk-bundle/1",
        "authority": "none",
        "bundle_version": "1.12.0",
        "contracts": [
            {"source_path": path, "schema": "test/" + str(i), "major": 1}
            for i, path in enumerate(sdk_paths)
        ],
    }), encoding="utf-8")
    return app


class InternetSdkReadinessTests(unittest.TestCase):
    def test_real_app_has_truthful_public_sdk_blockers(self):
        report = checker.audit(checker.ROOT)
        self.assertEqual(report["schema"], checker.SCHEMA)
        self.assertEqual(report["sourceOwner"], "ordaxsystems/ordax-os")
        self.assertEqual(report["sourceCutoverAuthorized"], False)
        self.assertEqual(report["distributionActivated"], False)
        self.assertTrue(report["sdkBoundaryClean"], report["blockers"])
        self.assertEqual(report["privatePlatformImports"], [])
        self.assertEqual(report["unpublishedContracts"], [])
        self.assertFalse(
            (checker.ROOT / "system/apps/app-contract.mjs").exists(),
            "single canonical contract owner required",
        )
        self.assertGreater(report["appModuleCount"], 0)
        self.assertIn("system/contracts/browser-session.mjs", report["requiredContracts"])
        sdk = json.loads((checker.ROOT / checker.SDK_PATH).read_text(encoding="utf-8"))
        published = {entry["source_path"] for entry in sdk["contracts"]}
        self.assertEqual(
            report["unpublishedContracts"],
            sorted(set(report["requiredContracts"]) - published),
        )
        self.assertEqual(
            report["sdkBoundaryClean"],
            not (report["unpublishedContracts"] or report["privatePlatformImports"]),
        )

    def test_derives_published_vs_unpublished_without_shadow_registry(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root, sdk_paths=("system/contracts/browser-session.mjs",))
            partial = checker.audit(root)
            self.assertFalse(partial["sdkBoundaryClean"])
            self.assertEqual(partial["publishedContracts"], ["system/contracts/browser-session.mjs"])
            self.assertEqual(partial["unpublishedContracts"], ["system/contracts/component-runtime.mjs"])
            bundle_path = root / "sdk/app-sdk-v1/bundle.json"
            bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
            bundle["contracts"].append({
                "source_path": "system/contracts/component-runtime.mjs",
                "schema": "ordax.component-runtime/1",
                "major": 1,
            })
            bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
            clean = checker.audit(root)
            self.assertTrue(clean["sdkBoundaryClean"])
            self.assertEqual(clean["blockers"], [])
            self.assertIs(clean["sourceCutoverAuthorized"], False)

    def test_transitive_contract_import_must_also_be_in_public_bundle(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root, sdk_paths=(
                "system/contracts/browser-session.mjs",
                "system/contracts/component-runtime.mjs",
            ))
            contracts = root / "system/contracts"
            (contracts / "spaces.mjs").write_text(
                "export const shared=true;\\n", encoding="utf-8"
            )
            (contracts / "browser-session.mjs").write_text(
                'import { shared } from "./spaces.mjs";\\n'
                "export const port=true;\\n", encoding="utf-8"
            )
            blocked = checker.audit(root)
            self.assertEqual(blocked["directContracts"], [
                "system/contracts/browser-session.mjs",
                "system/contracts/component-runtime.mjs",
            ])
            self.assertEqual(blocked["transitiveContracts"], [
                "system/contracts/spaces.mjs",
            ])
            self.assertEqual(blocked["unpublishedContracts"], [
                "system/contracts/spaces.mjs",
            ])
            self.assertFalse(blocked["sdkBoundaryClean"])

            bundle_path = root / "sdk/app-sdk-v1/bundle.json"
            bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
            bundle["contracts"].append({
                "source_path": "system/contracts/spaces.mjs",
                "schema": "ordax.spaces/1",
                "major": 1,
            })
            bundle_path.write_text(json.dumps(bundle), encoding="utf-8")
            ready = checker.audit(root)
            self.assertEqual(ready["transitiveContracts"], ["system/contracts/spaces.mjs"])
            self.assertTrue(ready["sdkBoundaryClean"])
            self.assertIs(ready["sourceCutoverAuthorized"], False)

    def test_private_platform_import_cannot_be_mistaken_for_sdk(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = fixture(root, sdk_paths=(
                "system/contracts/browser-session.mjs",
                "system/contracts/component-runtime.mjs",
            ))
            with (app / "runtime.mjs").open("a", encoding="utf-8") as stream:
                stream.write('import { internal } from "../private-bootstrap.mjs";\n')
            result = checker.audit(root)
            self.assertEqual(result["privatePlatformImports"], ["system/apps/private-bootstrap.mjs"])
            self.assertIn("private-platform-imports", result["blockers"])
            self.assertFalse(result["sdkBoundaryClean"])

    def test_invalid_or_missing_imports_fail_closed(self):
        for extra in (
            'import "https://example.org/library.js";\n',
            'const module = import(name);\n',
            'import "./missing.mjs";\n',
        ):
            with self.subTest(extra=extra):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    app = fixture(root)
                    with (app / "runtime.mjs").open("a", encoding="utf-8") as stream:
                        stream.write(extra)
                    with self.assertRaises(checker.InternetSdkAuditError):
                        checker.audit(root)

    def test_source_is_never_copied_or_activated_by_audit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = fixture(root)
            before = sorted(p.relative_to(root).as_posix() for p in root.rglob("*"))
            checker.audit(root)
            after = sorted(p.relative_to(root).as_posix() for p in root.rglob("*"))
            self.assertEqual(before, after)
            self.assertTrue(app.exists())
            self.assertFalse((root / "apps/internet").exists())


if __name__ == "__main__":
    unittest.main()
