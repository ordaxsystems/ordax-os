import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
sys.path.insert(0, str(RUNTIME))
MODULE = RUNTIME / "native_project_state.py"
spec = importlib.util.spec_from_file_location("native_project_state", MODULE)
project_state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(project_state)


def state(*, next_ordinal=3, projects=None):
    if projects is None:
        projects = [
            {
                "id": "project-1",
                "name": "Finance App",
                "path": "/Documentos/finance-app",
                "createdAt": 1000,
                "lastOpenedAt": 2000,
                "lastFilePath": "/Documentos/finance-app/README.md",
            },
            {
                "id": "project-2",
                "name": "Website",
                "path": "/Documentos/site",
                "createdAt": 1500,
                "lastOpenedAt": 2500,
                "lastFilePath": None,
            },
        ]
    return {"nextOrdinal": next_ordinal, "projects": projects}


class NativeProjectStateTests(unittest.TestCase):
    def test_project_catalog_is_private_revisioned_and_queryable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "projects")
            self.assertIsNone(project_state.read_project_record(root))
            written = project_state.compare_and_swap_project_state(0, state(), root)
            self.assertEqual(written["revision"], 1)
            self.assertEqual(written["formatVersion"], 1)

            restored = project_state.read_project_record(root)
            self.assertEqual(restored["revision"], 1)
            self.assertEqual(restored["state"], state())
            self.assertTrue(project_state.project_exists("project-1", root))
            self.assertFalse(project_state.project_exists("project-3", root))

            files = {path.name for path in Path(root).iterdir()}
            self.assertEqual(files, {"catalog.json", "catalog.lock"})
            self.assertEqual(Path(root).stat().st_mode & 0o777, 0o700)
            self.assertEqual((Path(root) / "catalog.json").stat().st_mode & 0o777, 0o600)

    def test_stale_cas_never_overwrites_current_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "projects")
            first = project_state.compare_and_swap_project_state(0, state(), root)
            self.assertEqual(first["revision"], 1)

            updated = state(
                next_ordinal=4,
                projects=[
                    *state()["projects"],
                    {
                        "id": "project-3",
                        "name": "Catalog",
                        "path": "/Documentos/catalog",
                        "createdAt": 3000,
                        "lastOpenedAt": 3000,
                        "lastFilePath": None,
                    },
                ],
            )
            second = project_state.compare_and_swap_project_state(1, updated, root)
            self.assertEqual(second["revision"], 2)

            stale = project_state.compare_and_swap_project_state(1, state(), root)
            self.assertIsNone(stale)
            restored = project_state.read_project_record(root)
            self.assertEqual(restored["revision"], 2)
            self.assertEqual(restored["state"], updated)

    def test_catalog_validation_rejects_duplicate_ids_paths_and_unsafe_paths(self):
        duplicate_id = state(
            next_ordinal=3,
            projects=[state()["projects"][0], {**state()["projects"][1], "id": "project-1"}],
        )
        with self.assertRaisesRegex(ValueError, "ids must be unique"):
            project_state.validate_project_store_state(duplicate_id)

        duplicate_path = state(
            next_ordinal=3,
            projects=[state()["projects"][0], {**state()["projects"][1], "path": "/Documentos/finance-app"}],
        )
        with self.assertRaisesRegex(ValueError, "paths must be unique"):
            project_state.validate_project_store_state(duplicate_path)

        unsafe = state(
            next_ordinal=2,
            projects=[{**state()["projects"][0], "path": "/Documentos/../segredo"}],
        )
        with self.assertRaisesRegex(ValueError, "invalid segment"):
            project_state.validate_project_store_state(unsafe)

    def test_next_ordinal_and_last_file_binding_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "nextOrdinal must exceed"):
            project_state.validate_project_store_state(state(next_ordinal=2))

        outside_file = state(
            next_ordinal=2,
            projects=[{
                **state()["projects"][0],
                "lastFilePath": "/Documentos/other/file.txt",
            }],
        )
        with self.assertRaisesRegex(ValueError, "inside the project folder"):
            project_state.validate_project_store_state(outside_file)

    def test_unknown_format_and_extra_record_fields_are_rejected(self):
        valid_state = state()
        with self.assertRaisesRegex(ValueError, "format version"):
            project_state._validate_record({
                "$schema": project_state.RECORD_SCHEMA,
                "revision": 1,
                "formatVersion": 2,
                "state": valid_state,
            })
        with self.assertRaisesRegex(ValueError, "record shape"):
            project_state._validate_record({
                "$schema": project_state.RECORD_SCHEMA,
                "revision": 1,
                "formatVersion": 1,
                "state": valid_state,
                "authority": "admin",
            })


if __name__ == "__main__":
    unittest.main()
