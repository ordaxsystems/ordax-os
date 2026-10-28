"""Cross-repository source lock advancement must stay one-way, immutable and owner-scoped."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from tools.source_integration_test_adapter import advance_module

# The production helper lives in tools/source-integration (hyphenated path).
advance = advance_module()


class SourceAdvanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "os"
        self.source = Path(self.tmp.name) / "upstream"
        (self.root / "docs/contracts").mkdir(parents=True)
        self.source.mkdir()
        for name in ("surface", "intelligence"):
            relative = advance.OWNERS[name]["module"]
            dest = self.root / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(advance.ROOT / relative, dest)
        self.git("init", "--initial-branch=main")
        self.git("config", "user.name", "source-sync-test")
        self.git("config", "user.email", "source-sync@example.invalid")

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-C", str(self.source), *args], stderr=subprocess.PIPE
        ).decode().strip()

    def write(self, path, text):
        target = self.source / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def commit(self, message="fixture"):
        self.git("add", ".")
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def lock(self, owner, data):
        path = self.root / advance.OWNERS[owner]["lock"]
        path.write_text(json.dumps(data, indent=2) + "\n")
        return path

    def test_surface_only_visual_changes_advance_and_keep_policy(self):
        self.write("system/surface/ui/index.js", "old")
        self.write("system/surface/workspace/index.js", "old")
        original = self.commit()
        path = self.lock("surface", {
            "$schema": "prototype-ordax.surface-source/1",
            "status": "canonical",
            "source_repository": "ordaxsystems/ordax-surface",
            "source_commit": original,
            "visual_source_paths": ["system/surface/ui", "system/surface/workspace"],
            "physical_disk_write_allowed": False,
        })
        self.write("README.md", "docs only")
        self.commit()
        self.assertEqual(advance.advance(self.root, "surface", self.source, True)["reason"], "no-owned-source-change")
        self.assertEqual(json.loads(path.read_text())["source_commit"], original)
        self.write("system/surface/ui/index.js", "new")
        new = self.commit()
        self.assertTrue(advance.advance(self.root, "surface", self.source)["changed"])
        self.assertEqual(json.loads(path.read_text())["source_commit"], original)
        self.assertTrue(advance.advance(self.root, "surface", self.source, True)["changed"])
        updated = json.loads(path.read_text())
        self.assertEqual(updated["source_commit"], new)
        self.assertIs(updated["physical_disk_write_allowed"], False)
        self.assertFalse(advance.advance(self.root, "surface", self.source, True)["changed"])
        self.git("checkout", "--detach", original)
        with self.assertRaisesRegex(advance.SourceAdvanceError, "does not descend"):
            advance.advance(self.root, "surface", self.source, True)

    def test_intelligence_updates_exact_eight_blobs_without_activation(self):
        paths = (
            "src/index.mjs",
            "src/contract-bindings.mjs",
            "src/intelligence/runtime.mjs",
            "src/intelligence/model-router.mjs",
            "src/local-ai/runtime.mjs",
            "src/local-ai/completion-stream.mjs",
            "src/local-ai/model-compatibility.mjs",
            "tools/inference-builder/build.py",
        )
        for relative in paths:
            self.write(relative, "old source")
        original = self.commit()
        blobs = {name: self.git("rev-parse", "HEAD:" + name) for name in paths}
        path = self.lock("intelligence", {
            "$schema": "prototype-ordax.intelligence-source/1",
            "status": "integration-candidate",
            "source_repository": "ordaxsystems/ordax-intelligence",
            "source_commit": original,
            "source_paths": blobs,
            "materialization_target": "system/intelligence-source/src",
            "public_ports": ["ordax.intelligence/1", "ordax.model-router/1", "ordax.local-ai/1"],
            "source_only": True,
            "change_live_os": False,
            "activation_authorized": False,
            "cutover_complete": False,
        })
        self.write("src/local-ai/runtime.mjs", "new source")
        new = self.commit()
        self.assertTrue(advance.advance(self.root, "intelligence", self.source, True)["changed"])
        updated = json.loads(path.read_text())
        self.assertEqual(updated["source_commit"], new)
        self.assertEqual(updated["source_paths"]["src/local-ai/runtime.mjs"], self.git("rev-parse", "HEAD:src/local-ai/runtime.mjs"))
        self.assertEqual(updated["source_paths"]["src/index.mjs"], blobs["src/index.mjs"])
        self.assertEqual(updated["status"], "integration-candidate")
        self.assertIs(updated["activation_authorized"], False)
        self.assertIs(updated["cutover_complete"], False)
        self.write("tools/inference-builder/windows-candidate.py", "Windows-only optional builder")
        self.commit()
        unrelated = advance.advance(self.root, "intelligence", self.source, True)
        self.assertFalse(unrelated["changed"])
        self.assertEqual(unrelated["reason"], "no-owned-source-change")
        self.assertEqual(json.loads(path.read_text())["source_commit"], new)
        # The Windows-only builder remains outside the eight-blob OS source
        # graph, even when a later pinned blob changes legitimately.
        self.write("src/local-ai/runtime.mjs", "new version 2")
        later = self.commit()
        self.assertTrue(advance.advance(self.root, "intelligence", self.source, True)["changed"])
        final = json.loads(path.read_text())
        self.assertEqual(final["source_commit"], later)
        self.assertEqual(set(final["source_paths"]), set(paths))
        self.assertNotIn("tools/inference-builder/windows-candidate.py", final["source_paths"])

    def test_surface_selects_verified_main_source_sha_before_docs_tail(self):
        self.write("system/surface/ui/index.js", "initial")
        self.write("system/surface/workspace/index.js", "initial")
        old = self.commit()
        lock = {
            "$schema": "prototype-ordax.surface-source/1",
            "status": "canonical",
            "source_repository": "ordaxsystems/ordax-surface",
            "source_commit": old,
            "visual_source_paths": ["system/surface/ui", "system/surface/workspace"],
        }
        path = self.lock("surface", lock)
        self.write("system/surface/ui/index.js", "updated")
        source_sha = self.commit("main visual change")
        self.write("docs/README.md", "documentation-only merge after green Surface CI")
        self.commit("docs only")
        self.assertEqual(
            advance.select_source_commit(self.root, "surface", self.source),
            source_sha,
        )
        self.git("checkout", "--detach", source_sha)
        result = advance.advance(self.root, "surface", self.source, True)
        self.assertTrue(result["changed"])
        self.assertEqual(json.loads(path.read_text())["source_commit"], source_sha)
        self.git("checkout", "main")
        self.assertEqual(
            advance.select_source_commit(self.root, "surface", self.source),
            source_sha,
        )
        # Even if the existing OS pin was a later nonvisual main commit, the
        # selector must refuse to move the lock backwards.
        lock["source_commit"] = self.git("rev-parse", "HEAD")
        path.write_text(json.dumps(lock))
        self.assertEqual(
            advance.select_source_commit(self.root, "surface", self.source),
            lock["source_commit"],
        )

    def test_intelligence_ignores_windows_builder_and_docs_when_selecting_ci_sha(self):
        paths = (
            "src/index.mjs", "src/contract-bindings.mjs",
            "src/intelligence/runtime.mjs", "src/intelligence/model-router.mjs",
            "src/local-ai/runtime.mjs", "src/local-ai/completion-stream.mjs",
            "src/local-ai/model-compatibility.mjs", "tools/inference-builder/build.py",
        )
        for path in paths:
            self.write(path, "initial")
        old = self.commit()
        self.lock("intelligence", {
            "$schema": "prototype-ordax.intelligence-source/1",
            "status": "integration-candidate",
            "source_repository": "ordaxsystems/ordax-intelligence",
            "source_commit": old,
            "source_paths": {p: self.git("rev-parse", "HEAD:" + p) for p in paths},
            "materialization_target": "system/intelligence-source/src",
            "public_ports": ["ordax.intelligence/1", "ordax.model-router/1", "ordax.local-ai/1"],
            "source_only": True,
            "change_live_os": False,
            "activation_authorized": False,
            "cutover_complete": False,
        })
        self.write("src/intelligence/runtime.mjs", "updated")
        source_sha = self.commit("Intelligence main source")
        self.write("tools/inference-builder/windows-candidate.py", "windows only")
        self.commit("Windows builder main")
        self.write("docs/README.md", "documentation only")
        self.commit("docs main")
        self.assertEqual(
            advance.select_source_commit(self.root, "intelligence", self.source),
            source_sha,
        )
        self.git("checkout", "--detach", source_sha)
        self.assertTrue(advance.advance(self.root, "intelligence", self.source, True)["changed"])


    def test_reject_source_symlink(self):
        linked = Path(self.tmp.name) / "linked"
        linked.symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(advance.SourceAdvanceError, "real Git checkout"):
            advance.advance(self.root, "surface", linked, True)

    def test_pending_pr_selection_is_paginated_owner_scoped_and_fail_closed(self):
        import os
        root = advance.ROOT
        yaml = (root / ".github/workflows/external-source-lock-integration.yml").read_text()
        start = yaml.index("      - name: Resolve exactly one pending PR")
        end = yaml.index("      - name: Create or fast-forward", start)
        body = yaml[start:end].split("        run: |\n", 1)[1]
        script = "\n".join(line[10:] if line.startswith(" " * 10) else line
                           for line in body.splitlines()) + "\n"
        self.assertIn("gh api --paginate --slurp", script)
        self.assertIn("jq -c", script)
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            gh = folder / "gh"
            gh.write_text("""#!/usr/bin/env bash
if [ "$1" = api ]; then
  printf '%s\\n' "$TEST_PAGES"
elif [ "$1" = pr ] && [ "$2" = view ]; then
  printf '%s\\n' "$TEST_PR_FILES"
else
  exit 93
fi
""")
            gh.chmod(0o755)
            def pr(number, branch, repo="ordaxsystems/ordax-os", base="main"):
                return {"number": number, "head": {
                    "repo": {"full_name": repo}, "ref": branch,
                    "sha": "a" * 40}, "base": {"ref": base}}
            def run(pages, files=None):
                out = folder / "out"
                out.write_text("")
                env = dict(os.environ, PATH=str(folder) + os.pathsep + os.environ["PATH"],
                           TEST_PAGES=json.dumps(pages),
                           TEST_PR_FILES=json.dumps(files or {"files": [
                               {"path": "docs/contracts/surface-source.json"}]}),
                           OWNER="surface", LOCK="docs/contracts/surface-source.json",
                           GITHUB_REPOSITORY="ordaxsystems/ordax-os",
                           GITHUB_OUTPUT=str(out))
                result = subprocess.run(["bash", "-e"], input=script, text=True,
                                        env=env, capture_output=True)
                return result, out.read_text()
            no_matches, output = run([[pr(8, "automation/advance-surface", repo="other/fork")], []])
            self.assertEqual(no_matches.returncode, 0, no_matches.stderr)
            self.assertIn("existing=false", output)
            one, output = run([
                [pr(8, "some-other-branch")],
                [pr(9, "automation/advance-surface"), pr(10, "automation/advance-intelligence")],
            ])
            self.assertEqual(one.returncode, 0, one.stderr)
            self.assertIn("existing=true", output)
            self.assertIn("number=9", output)
            self.assertIn("branch=automation/advance-surface", output)
            duplicate, _ = run([[
                pr(9, "automation/advance-surface"),
                pr(10, "automation/advance-surface-deadbeef1234"),
            ]])
            self.assertNotEqual(duplicate.returncode, 0)
            self.assertIn("Multiple owner integration PRs", duplicate.stdout)
            foreign_files, _ = run([[pr(9, "automation/advance-surface")]],
                                   {"files": [{"path": "system/supervisor"}]})
            self.assertNotEqual(foreign_files.returncode, 0)

    def test_existing_integration_is_updated_without_force_push(self):
        workflow = (advance.ROOT / ".github/workflows/external-source-lock-integration.yml").read_text()
        self.assertIn('git fetch --no-tags origin "refs/heads/$branch:refs/remotes/origin/$branch"', workflow)
        self.assertIn('if [ "$(git rev-parse HEAD)" != "$PR_HEAD_SHA" ]; then', workflow)
        self.assertIn('git push origin "HEAD:refs/heads/$branch"', workflow)
        self.assertIn('gh pr edit "$PR_NUMBER"', workflow)
        self.assertIn('branch="automation/advance-$OWNER"', workflow)
        self.assertNotIn("git push --force", workflow)
        self.assertNotIn("git push -f", workflow)
        self.assertNotIn("gh pr merge", workflow)

    def test_native_bot_uses_existing_ci_without_duplicated_release_authority(self):
        root = advance.ROOT
        workflow = (root / ".github/workflows/external-source-lock-integration.yml").read_text()
        self.assertIn("GH_TOKEN: ${{ secrets.ORDAX_INTEGRATION_TOKEN || github.token }}", workflow)
        self.assertIn("if: steps.publish.outputs.native == 'true'", workflow)
        self.assertIn('gh workflow run "$workflow"', workflow)
        self.assertNotIn("gh pr merge", workflow)
        self.assertNotIn("gh release create", workflow)
        self.assertNotIn("git push origin HEAD:refs/heads/main", workflow)
        for filename in ("foundation.yml", "surface-source-consumer.yml",
                         "owner-surface-source.yml", "intelligence-source.yml",
                         "owner-intelligence-source.yml"):
            consumer = (root / ".github/workflows" / filename).read_text()
            self.assertIn("  workflow_dispatch:", consumer, filename)


if __name__ == "__main__":
    unittest.main()
