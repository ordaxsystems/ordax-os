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

    def test_intelligence_updates_complete_portable_graph_without_activation(self):
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
        # The Windows-only builder remains outside the portable OS source
        # graph. A new module below src must be discovered and pinned instead
        # of being silently omitted by a stale fixed inventory.
        self.write("src/snapshot-notification.mjs", "new shared dependency")
        later = self.commit()
        self.assertTrue(advance.advance(self.root, "intelligence", self.source, True)["changed"])
        final = json.loads(path.read_text())
        self.assertEqual(final["source_commit"], later)
        self.assertEqual(
            set(final["source_paths"]),
            set(paths) | {"src/snapshot-notification.mjs"},
        )
        self.assertEqual(
            final["source_paths"]["src/snapshot-notification.mjs"],
            self.git("rev-parse", "HEAD:src/snapshot-notification.mjs"),
        )
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
        self.write("src/snapshot-notification.mjs", "new dependency")
        source_sha = self.commit("Intelligence source graph expansion")
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
        # Extract only this run block; later authentication steps are not Bash.
        body = yaml[start:].split("        run: |\n", 1)[1].split("\n      - name: ", 1)[0]
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
            def run(pages, files=None, owner="surface"):
                out = folder / "out"
                out.write_text("")
                env = dict(os.environ, PATH=str(folder) + os.pathsep + os.environ["PATH"],
                           TEST_PAGES=json.dumps(pages),
                           TEST_PR_FILES=json.dumps(files or {"files": [
                               {"path": f"docs/contracts/{owner}-source.json"}]}),
                           OWNER=owner, LOCK=f"docs/contracts/{owner}-source.json",
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
            self.assertIn("manual=false", output)
            manual, output = run([[
                pr(21, "fix/intelligence-source-lock-91de8cd-20261104"),
                pr(22, "automation/advance-surface"),
            ]], owner="intelligence")
            self.assertEqual(manual.returncode, 0, manual.stderr)
            self.assertIn("existing=true", output)
            self.assertIn("number=21", output)
            self.assertIn("manual=true", output)
            competing, _ = run([[
                pr(21, "fix/intelligence-source-lock-91de8cd-20261104"),
                pr(22, "automation/advance-intelligence"),
            ]], owner="intelligence")
            self.assertNotEqual(competing.returncode, 0)
            self.assertIn("Multiple owner integration PRs", competing.stdout)
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
        self.assertIn('branch="automation/advance-$OWNER-$SOURCE_SHA"', workflow)
        # Future source commits cannot reuse an old candidate branch retained
        # after a squash merge, regardless of the repository deletion policy.
        first = "automation/advance-surface-" + "a" * 40
        second = "automation/advance-surface-" + "b" * 40
        self.assertNotEqual(first, second)
        self.assertIn('if [ "$EXISTING" = true ]; then', workflow)
        self.assertIn('branch="$PR_BRANCH"', workflow)
        self.assertIn('if ! git merge-base --is-ancestor "$existing_sha" "$main_sha"; then', workflow)
        self.assertNotIn("git push --force", workflow)
        self.assertNotIn("git push -f", workflow)
        self.assertNotIn("gh pr merge", workflow)
        # Human-reviewed owner PRs are never silently rewritten by CI.
        self.assertIn('if [ "$EXISTING" = true ] && [ "$MANUAL" = true ]; then', workflow)
        self.assertIn('"repos/$GITHUB_REPOSITORY/contents/$LOCK?ref=$PR_HEAD_SHA"', workflow)
        self.assertIn('base64 --decode | cmp - "$candidate_lock"', workflow)
        self.assertIn("Manual owner source-lock PR differs", workflow)
        self.assertLess(workflow.index('if [ "$EXISTING" = true ] && [ "$MANUAL" = true ]; then'),
                        workflow.index('git switch -c "$branch" "refs/remotes/origin/$branch"'))

    def test_merged_owner_branch_can_fast_forward_without_force(self):
        # The repo intentionally keeps merged branches. Prove the second
        # integration stays a fast-forward and never rewrites an unmerged tip.
        import os
        root = Path(self.tmp.name)
        remote = root / "owner-remote.git"
        work = root / "owner-work"
        subprocess.run(["git", "init", "--bare", str(remote)], check=True,
                       capture_output=True)
        subprocess.run(["git", "init", "-b", "main", str(work)], check=True,
                       capture_output=True)
        def git(*args, check=True):
            return subprocess.run(["git", "-C", str(work), *args],
                                  capture_output=True, text=True, check=check)
        git("config", "user.name", "Owner Test")
        git("config", "user.email", "owner@example.invalid")
        git("remote", "add", "origin", str(remote))
        (work / "lock.json").write_text('{"version":0}')
        git("add", "lock.json")
        git("commit", "-m", "initial")
        git("push", "origin", "main")
        git("switch", "-c", "automation/advance-surface")
        (work / "lock.json").write_text('{"version":1}')
        git("add", "lock.json")
        git("commit", "-m", "first owner PR")
        git("push", "origin", "HEAD:refs/heads/automation/advance-surface")
        original = git("rev-parse", "HEAD").stdout.strip()
        git("switch", "main")
        git("merge", "--no-ff", "-m", "merge first PR", "automation/advance-surface")
        git("push", "origin", "main")
        main_sha = git("rev-parse", "HEAD").stdout.strip()
        self.assertEqual(git("merge-base", "--is-ancestor", original, main_sha).returncode, 0)
        git("switch", "-c", "candidate")
        (work / "lock.json").write_text('{"version":2}')
        git("add", "lock.json")
        git("commit", "-m", "second owner PR")
        git("push", "origin", "HEAD:refs/heads/automation/advance-surface")
        updated = git("rev-parse", "HEAD").stdout.strip()
        remote_tip = git("ls-remote", "--heads", "origin", "refs/heads/automation/advance-surface").stdout
        self.assertIn(updated, remote_tip)
        # No implicit forced update of a closed but *unmerged* PR.
        git("switch", "main")
        git("switch", "-c", "automation/advance-intelligence")
        (work / "lock.json").write_text('{"version":33}')
        git("add", "lock.json")
        git("commit", "-m", "closed unmerged branch")
        git("push", "origin", "HEAD:refs/heads/automation/advance-intelligence")
        stray = git("rev-parse", "HEAD").stdout.strip()
        self.assertNotEqual(
            git("merge-base", "--is-ancestor", stray, main_sha, check=False).returncode,
            0,
        )
        workflow = (advance.ROOT / ".github/workflows/external-source-lock-integration.yml").read_text()
        self.assertIn('existing_tip="$(git ls-remote --heads origin "refs/heads/$branch")"', workflow)
        self.assertIn('git merge-base --is-ancestor "$existing_sha" "$main_sha"', workflow)
        self.assertIn("refuse recovery", workflow)
        self.assertIn("PR history; refuse re-creation", workflow)
        self.assertNotIn("git push --force", workflow)

    def test_stranded_source_lock_push_is_recovered_only_without_prior_review(self):
        # Exercise the exact recovery guard with real Git ancestry, lock bytes,
        # a remote ref, and an explicit mock of the GitHub PR-history response.
        import os
        workflow = (advance.ROOT / ".github/workflows/external-source-lock-integration.yml").read_text()
        self.assertIn('if [ "$recovering" != true ]; then', workflow)
        self.assertLess(workflow.index("recovering=true"), workflow.index('git push origin "HEAD:refs/heads/$branch"'))
        start = '              if ! git merge-base --is-ancestor "$existing_sha" "$main_sha"; then'
        end = '              else\n                echo "::notice::Previously merged owner branch will fast-forward"'
        body = workflow.split(start, 1)[1].split(end, 1)[0]
        guard = 'set -euo pipefail\n' + start.strip() + '\n' + '\n'.join(
            line[16:] if line.startswith(" " * 16) else line
            for line in body.splitlines()
        ) + '\nfi\n'
        root = Path(self.tmp.name)
        remote = root / "bare.git"
        work = root / "local"
        work.mkdir()
        subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
        subprocess.run(["git", "init", "-b", "main", str(work)], check=True, capture_output=True)
        def git(*args):
            return subprocess.run(["git", "-C", str(work), *args],
                                  check=True, capture_output=True, text=True).stdout.strip()
        git("config", "user.name", "Owner Test")
        git("config", "user.email", "owner@example.invalid")
        git("remote", "add", "origin", str(remote))
        lock = Path("docs/contracts/surface-source.json")
        target = work / lock
        target.parent.mkdir(parents=True)
        target.write_text('{"source_commit":"old"}\n')
        git("add", str(lock))
        git("commit", "-m", "canonical main")
        main_sha = git("rev-parse", "HEAD")
        git("push", "origin", "main")
        branch = "automation/advance-surface-" + "a" * 40
        git("switch", "-c", "source-candidate")
        verified = '{"source_commit":"verified"}\n'
        target.write_text(verified)
        git("add", str(lock))
        git("commit", "-m", "verified source-lock candidate")
        existing_sha = git("rev-parse", "HEAD")
        git("push", "origin", "HEAD:refs/heads/" + branch)
        git("switch", "main")
        candidate = root / "candidate.json"
        candidate.write_text(verified)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        gh.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$TEST_HISTORY"\n')
        gh.chmod(0o755)

        def run(history, *, candidate_text=verified, head=existing_sha, ref=branch):
            candidate.write_text(candidate_text)
            env = dict(os.environ,
                       PATH=str(bin_dir) + os.pathsep + os.environ["PATH"],
                       TEST_HISTORY=json.dumps([history]),
                       existing_sha=head, main_sha=main_sha,
                       branch=ref, LOCK=str(lock),
                       GITHUB_REPOSITORY="ordaxsystems/ordax-os",
                       candidate_lock=str(candidate))
            return subprocess.run(["bash", "-c", guard],
                                  cwd=work, capture_output=True, text=True, env=env)
        recovered = run([])
        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertIn("Recovered only the exact stranded source-lock branch", recovered.stdout)
        reviewed = run([{"head": {"repo": {"full_name": "ordaxsystems/ordax-os"}, "ref": branch}}])
        self.assertNotEqual(reviewed.returncode, 0)
        self.assertIn("PR history", reviewed.stdout)
        altered = run([], candidate_text='{"source_commit":"forged"}\n')
        self.assertNotEqual(altered.returncode, 0)
        self.assertIn("differs from verified lock", altered.stdout)
        # A matching lock is insufficient if another file was pushed.
        rogue_branch = "automation/advance-surface-" + "b" * 40
        git("switch", "-c", "rogue", "main")
        target.write_text(verified)
        (work / "rogue.txt").write_text("not owned")
        git("add", str(lock), "rogue.txt")
        git("commit", "-m", "forged extra change")
        rogue_sha = git("rev-parse", "HEAD")
        git("push", "origin", "HEAD:refs/heads/" + rogue_branch)
        rogue = run([], head=rogue_sha, ref=rogue_branch)
        self.assertNotEqual(rogue.returncode, 0)
        self.assertIn("differs from verified lock", rogue.stdout)

    def test_new_source_owner_pr_denies_native_token_before_branch_push(self):
        # Reproduce the repository's disabled GitHub Actions PR-creation policy.
        # Authentication preflight must reject an orphan push while continuing
        # to allow native-token updates of an existing, verified single-lock PR.
        import os
        workflow = (advance.ROOT / ".github/workflows/external-source-lock-integration.yml").read_text()
        publish = workflow.split("      - name: Create or fast-forward the single owner lock PR", 1)[1]
        guard = publish.split('          test -n "$GH_TOKEN"\n', 1)[1].split(
            "          candidate_lock=", 1
        )[0]
        guard = 'test -n "$GH_TOKEN"\n' + "\n".join(
            line[10:] if line.startswith(" " * 10) else line
            for line in guard.splitlines()
        ) + "\n"
        self.assertLess(
            publish.index('if [ "$EXISTING" != true ] && [ "$NATIVE_FALLBACK" = true ]; then'),
            publish.index('git switch -c "$branch"'),
        )
        def check(existing, native, token="fixture-token"):
            env = dict(os.environ, EXISTING=existing, NATIVE_FALLBACK=native,
                       GH_TOKEN=token)
            return subprocess.run(["bash", "-e"], input=guard, text=True,
                                  capture_output=True, env=env)
        blocked = check("false", "true")
        self.assertNotEqual(blocked.returncode, 0)
        self.assertIn("No branch was pushed", blocked.stdout)
        self.assertEqual(check("true", "true").returncode, 0)
        self.assertEqual(check("false", "false").returncode, 0)
        self.assertNotEqual(check("false", "false", "").returncode, 0)

    def test_new_source_pr_mints_scoped_app_token_only_when_required(self):
        workflow = (advance.ROOT / ".github/workflows/external-source-lock-integration.yml").read_text()
        self.assertIn("CLIENT_ID_PRESENT: ${{ secrets.ORDAX_INTEGRATION_APP_CLIENT_ID != '' }}", workflow)
        self.assertIn("PRIVATE_KEY_PRESENT: ${{ secrets.ORDAX_INTEGRATION_APP_PRIVATE_KEY != '' }}", workflow)
        self.assertIn('if [ "$CLIENT_ID_PRESENT" != "$PRIVATE_KEY_PRESENT" ]; then', workflow)
        self.assertIn("if: steps.candidate.outputs.changed == 'true' && steps.pending.outputs.existing == 'false'", workflow)
        self.assertIn("if: steps.integration_auth.outputs.app == 'true'", workflow)
        self.assertIn("uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510", workflow)
        self.assertIn("owner: ordaxsystems", workflow)
        self.assertIn("repositories: ordax-os", workflow)
        self.assertIn("permission-contents: write", workflow)
        self.assertIn("permission-pull-requests: write", workflow)
        self.assertIn("GH_TOKEN: ${{ steps.integration_app.outputs.token || github.token }}", workflow)
        self.assertIn("NATIVE_FALLBACK: ${{ steps.integration_app.outputs.token == '' }}", workflow)
        self.assertLess(workflow.index("Mint short-lived GitHub App installation token"),
                        workflow.index("Create or fast-forward the single owner lock PR"))
        self.assertNotIn("secrets.ORDAX_INTEGRATION_TOKEN", workflow)
        self.assertNotIn("permission-administration: write", workflow)
    def test_native_bot_uses_existing_ci_without_duplicated_release_authority(self):
        root = advance.ROOT
        workflow = (root / ".github/workflows/external-source-lock-integration.yml").read_text()
        self.assertIn("GH_TOKEN: ${{ steps.integration_app.outputs.token || github.token }}", workflow)
        self.assertIn("if: steps.publish.outputs.changed == 'true' && steps.publish.outputs.native == 'true'", workflow)
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
