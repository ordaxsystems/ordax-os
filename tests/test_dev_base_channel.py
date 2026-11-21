from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import io
import os
import tarfile
import json
import tempfile
import subprocess
import sys
import textwrap
import unittest
from unittest.mock import patch
import urllib.error


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "tools" / "dev-base-channel" / "build.py"
CONSUMER = ROOT / "system" / "services" / "base-update" / "dev_channel.py"
SOURCE = "1" * 40


def load_module(path: Path, name: str):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


builder = load_module(BUILDER, "ordax_dev_base_builder_test")
consumer = load_module(CONSUMER, "ordax_dev_base_consumer_test")


class FakeResponse:
    def __init__(self, url: str, payload: bytes, status: int = 200):
        self._url = url
        self._payload = payload
        self._offset = 0
        self.status = status

    def geturl(self):
        return self._url

    def read(self, limit: int):
        chunk = self._payload[self._offset : self._offset + limit]
        self._offset += len(chunk)
        return chunk

    def close(self):
        pass


def write_test_rootfs_tar(
    path: Path,
    *,
    omit: set[str] | None = None,
    hardlinks: tuple[tuple[str, str], ...] = (),
) -> None:
    """Test-only archive fixture; production never repacks the canonical rootfs."""
    omit = omit or set()
    directories = set(builder.REQUIRED_ROOTFS_DIRS)
    for relative in builder.REQUIRED_ROOTFS_PATHS:
        parent = Path(relative).parent
        while parent != Path("."):
            directories.add(parent.as_posix())
            parent = parent.parent
    for name, _target in hardlinks:
        parent = Path(name).parent
        while parent != Path("."):
            directories.add(parent.as_posix())
            parent = parent.parent

    with tarfile.open(path, "w", format=tarfile.GNU_FORMAT) as archive:
        for directory in sorted(directories):
            if directory in omit:
                continue
            info = tarfile.TarInfo(directory)
            info.type = tarfile.DIRTYPE
            info.mode = 0o755
            info.uid = 0
            info.gid = 0
            info.mtime = 0
            archive.addfile(info)
        for relative in sorted(builder.REQUIRED_ROOTFS_PATHS):
            if relative in omit:
                continue
            payload = f"fixture:{relative}\n".encode("utf-8")
            info = tarfile.TarInfo(relative)
            info.type = tarfile.REGTYPE
            info.mode = 0o755
            info.uid = 0
            info.gid = 0
            info.mtime = 0
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
        for name, target in hardlinks:
            info = tarfile.TarInfo(name)
            info.type = tarfile.LNKTYPE
            info.mode = 0o755
            info.uid = 0
            info.gid = 0
            info.mtime = 0
            info.linkname = target
            info.size = 0
            archive.addfile(info)


def write_rootfs_fixture(root: Path, source_commit: str = SOURCE) -> Path:
    rootfs_dir = root / "dev-rootfs"
    rootfs_dir.mkdir(parents=True)
    rootfs_tar = rootfs_dir / "rootfs.tar"
    write_test_rootfs_tar(rootfs_tar)
    (rootfs_dir / "provenance.json").write_text(
        json.dumps(
            {
                "$schema": "prototype-ordax.independent-base-provenance/1",
                "status": "candidate-build-only",
                "source_commit": source_commit,
                "profile": "owner-development",
                "owner_development_capabilities_verified": True,
                "physical_artifact_authorized": False,
                "signed_release_equivalence_proven": False,
                "artifacts": {
                    "rootfs.tar": hashlib.sha256(rootfs_tar.read_bytes()).hexdigest(),
                },
            }
        ),
        encoding="utf-8",
    )
    return rootfs_dir

def write_provenance_fixture(root: Path, source_commit: str = SOURCE):
    kernel_dir = root / "kernel"
    initramfs_dir = root / "initramfs"
    kernel_dir.mkdir()
    initramfs_dir.mkdir()

    kernel_name = "vmlinuz-6.6.52"
    kernel = b"kernel-candidate-bytes\n"
    initramfs = b"initramfs-candidate-bytes\n"
    (kernel_dir / kernel_name).write_bytes(kernel)
    (initramfs_dir / "initramfs.cpio.gz").write_bytes(initramfs)

    (kernel_dir / "kernel-provenance.json").write_text(
        json.dumps(
            {
                "$schema": "prototype-ordax.kernel-provenance/1",
                "source_commit": source_commit,
                "artifacts": {
                    kernel_name: hashlib.sha256(kernel).hexdigest(),
                    "kernel-modules-6.6.52.tar": "a" * 64,
                },
            }
        ),
        encoding="utf-8",
    )
    (initramfs_dir / "initramfs-provenance.json").write_text(
        json.dumps(
            {
                "$schema": "prototype-ordax.initramfs-provenance/1",
                "source_commit": source_commit,
                "artifacts": {
                    "initramfs.cpio.gz": hashlib.sha256(initramfs).hexdigest(),
                    "busybox.config": "b" * 64,
                },
            }
        ),
        encoding="utf-8",
    )
    rootfs_dir = write_rootfs_fixture(root, source_commit)
    return kernel_dir, initramfs_dir, rootfs_dir, kernel, initramfs


class DevBaseProducerTests(unittest.TestCase):
    def test_authenticated_independent_rootfs_is_published_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, _, _ = write_provenance_fixture(root)
            original_tar = rootfs_dir / "rootfs.tar"
            provenance_path = rootfs_dir / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))

            self.assertEqual(
                builder.validate_rootfs_source(rootfs_dir, SOURCE),
                original_tar,
            )
            output = root / "candidate"
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=output,
            )
            self.assertEqual(
                (output / "rootfs.tar").read_bytes(),
                original_tar.read_bytes(),
            )
            self.assertEqual(builder.verify(output)["source_commit"], SOURCE)

            for mutation in (
                {"profile": "minimal"},
                {"physical_artifact_authorized": True},
                {"source_commit": "2" * 40},
                {"artifacts": {"rootfs.tar": "0" * 64}},
            ):
                with self.subTest(mutation=mutation):
                    provenance_path.write_text(
                        json.dumps({**provenance, **mutation}),
                        encoding="utf-8",
                    )
                    with self.assertRaises(builder.CandidateError):
                        builder.validate_rootfs_source(rootfs_dir, SOURCE)
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")

    def test_complete_main_push_range_gates_producer_before_queue(self):
        workflow = (ROOT / ".github/workflows/dev-base-channel.yml").read_text(encoding="utf-8")
        verify, publish = workflow.split("\n  publish:\n", 1)
        self.assertIn("publish: ${{ steps.scope.outputs.publish }}", verify)
        self.assertIn("fetch-depth: 2", verify)
        self.assertIn("needs.verify.outputs.publish == 'true'", publish)
        self.assertIn("github.actor == 'ordaxos-admin'", publish)
        self.assertIn("DEV_BASE_OWNER_VALIDATION_EXACT_HEAD=PASS", publish)
        self.assertNotIn("HEAD^ HEAD", workflow)
        self.assertIn("compare/{before}...{head}", verify)
        self.assertIn('data.get("merge_base_commit", {}).get("sha") != before', verify)
        self.assertIn('data.get("status") != "ahead"', verify)
        for path in ("bootstrap/independent-base/**", "bootstrap/base/firmware_policy.py",
                     "docs/contracts/hardware-support-matrix.json"):
            self.assertEqual(workflow.count("'" + path + "'"), 2)

        marker = "          python3 - <<'PY'\n"
        self.assertEqual(verify.count(marker), 1)
        script = textwrap.dedent(verify.split(marker, 1)[1].split("\n          PY", 1)[0])
        with tempfile.TemporaryDirectory(prefix="ordax-dev-base-impact-") as tmp:
            repo = Path(tmp)
            def git(*args):
                return subprocess.check_output(
                    ["git", "-C", str(repo), *args],
                    stderr=subprocess.PIPE, text=True,
                ).strip()
            for args in (
                ("init", "-q"), ("config", "user.name", "CI"),
                ("config", "user.email", "ci@example.invalid")
            ):
                git(*args)
            paths = [
                "bootstrap/kernel/source.json",
                "tests/test_dev_base_channel.py",
                "bootstrap/dev-base/ordax-pull",
                "bootstrap/independent-base/configs/minimal",
                "bootstrap/base/firmware_policy.py",
                "docs/contracts/hardware-support-matrix.json",
            ]
            for name in paths:
                file = repo / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("initial\n", encoding="utf-8")
            helper_manifest = "system/services/base-update/dev-helper-manifest.tsv"
            manifest_file = repo / helper_manifest
            manifest_file.parent.mkdir(parents=True, exist_ok=True)
            manifest_file.write_bytes((ROOT / helper_manifest).read_bytes())
            watcher = repo / "bootstrap/dev-base/ordax-main-watch"
            watcher.write_text("initial\n", encoding="utf-8")
            git("add", "-A")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")

            def change(name):
                (repo / name).write_text("changed\n", encoding="utf-8")
                git("add", "-A")
                git("commit", "-qm", "change")
                return git("rev-parse", "HEAD")

            def classify(before, head):
                output = repo / "scope.out"
                output.write_text("", encoding="utf-8")
                env = {**os.environ, "ORDAX_BEFORE_SHA": before,
                       "ORDAX_HEAD_SHA": head,
                       "GITHUB_REPOSITORY": "ordaxsystems/ordax-os",
                       "GITHUB_OUTPUT": str(output)}
                done = subprocess.run(
                    [sys.executable, "-c", script], cwd=repo, env=env,
                    capture_output=True, text=True, timeout=20, check=True,
                )
                self.assertIn("DEV_BASE_BYTES_CHANGED=", done.stdout)
                return output.read_text(encoding="utf-8").strip()

            kernel = change(paths[0])
            test_only = change(paths[1])
            # A two-commit push must not ignore the earlier kernel change.
            self.assertEqual(classify(base, test_only), "publish=true")
            self.assertEqual(classify(kernel, test_only), "publish=false")
            self.assertEqual(classify("0" * 40, test_only), "publish=true")
            self.assertEqual(classify(test_only, test_only), "publish=true")
            excluded = change(paths[2])
            self.assertEqual(classify(test_only, excluded), "publish=false")
            watcher_update = change("bootstrap/dev-base/ordax-main-watch")
            self.assertEqual(classify(excluded, watcher_update), "publish=false")
            owner = change(paths[3])
            self.assertEqual(classify(watcher_update, owner), "publish=true")
            firmware = change(paths[4])
            self.assertEqual(classify(owner, firmware), "publish=true")
            hardware = change(paths[5])
            self.assertEqual(classify(firmware, hardware), "publish=true")

            # Force the GitHub API fallback with an actual shallow checkout.
            # The fake API response stays local: no network or credentials.
            (repo / paths[1]).write_text("only tests after hardware\n", encoding="utf-8")
            git("add", "-A")
            git("commit", "-qm", "test-only final")
            final_head = git("rev-parse", "HEAD")
            bare = repo / "remote.git"
            shallow = repo / "shallow"
            subprocess.run(["git", "init", "--bare", "-q", str(bare)],
                           capture_output=True, check=True)
            git("remote", "add", "origin", str(bare))
            git("push", "-q", "origin", f"{final_head}:refs/heads/main")
            subprocess.run(
                ["git", "clone", "-q", "--depth=1", "--branch=main",
                 bare.as_uri(), str(shallow)], capture_output=True, check=True,
            )
            missing = subprocess.run(
                ["git", "-C", str(shallow), "cat-file", "-e", hardware + "^{commit}"],
                capture_output=True,
            )
            self.assertNotEqual(missing.returncode, 0)

            def api_fallback(data):
                output = repo / "api.out"
                output.write_text("", encoding="utf-8")
                # Intercept only the GitHub CLI read; every Git call remains real.
                replacement = json.dumps(data).encode("utf-8")
                prefix = (
                    "import subprocess\n"
                    "_real_check_output = subprocess.check_output\n"
                    f"_answer = {replacement!r}\n"
                    "def _check_output(args, *a, **k):\n"
                    "    if args[:2] == ['gh', 'api']: return _answer\n"
                    "    return _real_check_output(args, *a, **k)\n"
                    "subprocess.check_output = _check_output\n"
                )
                env = {**os.environ, "ORDAX_BEFORE_SHA": hardware,
                       "ORDAX_HEAD_SHA": final_head,
                       "GITHUB_REPOSITORY": "ordaxsystems/ordax-os",
                       "GITHUB_OUTPUT": str(output)}
                subprocess.run(
                    [sys.executable, "-c", prefix + script], cwd=shallow,
                    env=env, capture_output=True, text=True,
                    check=True, timeout=20,
                )
                return output.read_text(encoding="utf-8").strip()

            comparison = {
                "status": "ahead", "total_commits": 1,
                "base_commit": {"sha": hardware},
                "head_commit": {"sha": final_head},
                "merge_base_commit": {"sha": hardware},
                "files": [{"filename": paths[1]}],
            }
            self.assertEqual(api_fallback(comparison), "publish=false")
            divergent = {**comparison, "merge_base_commit": {"sha": base}}
            self.assertEqual(api_fallback(divergent), "publish=true")
            truncated = {**comparison, "files": comparison["files"] * 300}
            self.assertEqual(api_fallback(truncated), "publish=true")

    def test_development_base_workflow_consumes_one_buildroot_owner(self):
        workflow = (ROOT / ".github/workflows/dev-base-channel.yml").read_text()
        self.assertIn("bootstrap/independent-base/build.py build", workflow)
        self.assertIn("--profile owner-development", workflow)
        self.assertIn("prove_independent_rootfs.py", workflow)
        self.assertIn("ORDAX_KERNEL_MODULES_ARCHIVE", workflow)
        self.assertNotIn("python bootstrap/dev-base/build.py", workflow)
        self.assertNotIn("util-linux proot", workflow)
        self.assertIn("tools/dev-base-channel/build.py build", workflow)

    @unittest.skipUnless(os.name == "posix", "requires POSIX executable bits")
    def test_reused_kernel_is_allowed_only_with_fresh_exact_integration_proof(self):
        cache = load_module(
            ROOT / "tools" / "ci" / "portable_component_cache.py",
            "ordax_kernel_reuse_fixture",
        )
        original_build = "2" * 40
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ,
            {"ORDAX_COMPONENT_CACHE_ENVIRONMENT": "Linux/X64/ubuntu24/owner-proof"},
        ):
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, _kernel, _initramfs = (
                write_provenance_fixture(root)
            )
            provenance_path = kernel_dir / "kernel-provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            provenance["source_commit"] = original_build
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")

            with self.assertRaisesRegex(
                builder.CandidateError, "reused kernel requires",
            ):
                builder.build(
                    source_commit=SOURCE,
                    kernel_dir=kernel_dir,
                    initramfs_dir=initramfs_dir,
                    rootfs_dir=rootfs_dir,
                    out_dir=root / "without-receipt",
                )

            cache.record_component("kernel", kernel_dir, original_build, root=ROOT)
            receipt_path = root / "kernel-reuse.json"
            cache.verify_component(
                "kernel", kernel_dir, SOURCE, receipt_path,
                cache_hit=True, root=ROOT,
            )
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                kernel_reuse_receipt=receipt_path,
                out_dir=root / "verified",
            )
            self.assertEqual(
                builder.verify(root / "verified")["source_commit"], SOURCE,
            )
            self.assertEqual(
                json.loads(provenance_path.read_text(encoding="utf-8"))["source_commit"],
                original_build,
            )

            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt["integration_source_commit"] = "3" * 40
            receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
            with self.assertRaisesRegex(
                builder.CandidateError, "receipt identity is invalid",
            ):
                builder.build(
                    source_commit=SOURCE,
                    kernel_dir=kernel_dir,
                    initramfs_dir=initramfs_dir,
                    rootfs_dir=rootfs_dir,
                    kernel_reuse_receipt=receipt_path,
                    out_dir=root / "wrong-receipt",
                )

            receipt["integration_source_commit"] = SOURCE
            receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
            (kernel_dir / "vmlinuz-6.6.52").write_bytes(b"tampered-kernel")
            with self.assertRaisesRegex(
                builder.CandidateError, "receipt validation failed",
            ):
                builder.build(
                    source_commit=SOURCE,
                    kernel_dir=kernel_dir,
                    initramfs_dir=initramfs_dir,
                    rootfs_dir=rootfs_dir,
                    kernel_reuse_receipt=receipt_path,
                    out_dir=root / "tampered-kernel",
                )

    def test_builder_and_consumer_agree_on_native_atomic_exchange_base_requirement(self):
        native = "usr/local/bin/ordax-checkout-exchange"
        manifest = (ROOT / "system/services/base-update/dev-helper-manifest.tsv").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "bootstrap/dev-base/ordax-pull\tusr/local/bin/ordax-pull\t"
            "usr/local/bin/ordax-checkout-exchange@prototype-ordax.checkout-exchange/1",
            manifest,
        )
        self.assertEqual(builder.REQUIRED_ROOTFS_PATHS, consumer.REQUIRED_ROOTFS_PATHS)
        self.assertIn(native, builder.REQUIRED_ROOTFS_PATHS)

    def test_missing_native_exchange_helper_cannot_enter_signed_base_consumer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "unsigned-malformed-rootfs.tar"
            write_test_rootfs_tar(
                archive,
                omit={"usr/local/bin/ordax-checkout-exchange"},
            )
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError,
                "missing required files.*usr/local/bin/ordax-checkout-exchange",
            ):
                consumer._validate_rootfs_archive(archive)

    def test_large_hardlink_fanout_is_verified_by_canonical_consumer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "rootfs.tar"
            hardlinks = tuple(
                (f"usr/lib/alias-{index:04d}.bin", "bin/busybox")
                for index in range(390)
            )
            write_test_rootfs_tar(archive, hardlinks=hardlinks)
            builder.verify_rootfs_tar(archive)
            members = consumer._validate_rootfs_archive(archive)
            self.assertEqual(sum(member.islnk() for member in members), 390)

    def test_rejects_unsafe_or_forward_hardlinks(self):
        for target in ("../../escape", "future/not-yet-seen"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as temporary:
                archive = Path(temporary) / "rootfs.tar"
                write_test_rootfs_tar(
                    archive,
                    hardlinks=(("zzz-unsafe", target),),
                )
                with self.assertRaisesRegex(
                    builder.CandidateError,
                    "Dev Channel rejected rootfs archive",
                ):
                    builder.verify_rootfs_tar(archive)
                with self.assertRaisesRegex(
                    consumer.DevBaseChannelError,
                    "unsafe hardlink",
                ):
                    consumer._validate_rootfs_archive(archive)

    @unittest.skipUnless(os.name == "posix", "hardlink materialization requires POSIX fsync")
    def test_materialize_safe_internal_hardlinks_preserves_inode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, _kernel, _initramfs = (
                write_provenance_fixture(root)
            )
            rootfs_tar = rootfs_dir / "rootfs.tar"
            write_test_rootfs_tar(
                rootfs_tar,
                hardlinks=(("bin/busybox-peer", "bin/busybox"),),
            )
            provenance_path = rootfs_dir / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            provenance["artifacts"]["rootfs.tar"] = hashlib.sha256(
                rootfs_tar.read_bytes()
            ).hexdigest()
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")

            candidate = root / "candidate"
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=candidate,
            )
            materialized, reused = consumer.materialize_versioned_rootfs(
                candidate, SOURCE, root / "versions"
            )
            self.assertFalse(reused)
            self.assertEqual(
                (materialized / "bin/busybox").stat().st_ino,
                (materialized / "bin/busybox-peer").stat().st_ino,
            )

    def test_build_binds_exact_commit_and_standard_asset_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, kernel, initramfs = (
                write_provenance_fixture(root)
            )
            out = root / "out"

            descriptor = builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=out,
            )

            self.assertEqual(
                descriptor["$schema"],
                "prototype-ordax.dev-base-candidate/3",
            )
            self.assertEqual(descriptor["source_commit"], SOURCE)
            self.assertEqual(descriptor["tag"], f"ordax-dev-base-{SOURCE}")
            self.assertEqual(descriptor["activation"], "inactive-slot-next-boot")
            self.assertEqual(
                descriptor["rootfs_activation"],
                "slot-coupled-one-shot-health-gated",
            )
            self.assertFalse(descriptor["manual_usb_rewrite_required"])
            self.assertEqual(descriptor["kernel"]["name"], "vmlinuz")
            self.assertEqual(descriptor["initramfs"]["name"], "initrd.gz")
            self.assertEqual(descriptor["rootfs"]["name"], "rootfs.tar")
            self.assertEqual((out / "vmlinuz").read_bytes(), kernel)
            self.assertEqual((out / "initrd.gz").read_bytes(), initramfs)
            self.assertTrue((out / "rootfs.tar").is_file())
            self.assertEqual(builder.verify(out), descriptor)

    def test_rootfs_tar_is_byte_deterministic(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, _kernel, _initramfs = (
                write_provenance_fixture(root)
            )
            first = root / "first"
            second = root / "second"

            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=first,
            )
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=second,
            )

            self.assertEqual(
                (first / "rootfs.tar").read_bytes(),
                (second / "rootfs.tar").read_bytes(),
            )

    def test_build_rejects_rootfs_provenance_from_another_commit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, _rootfs_dir, _kernel, _initramfs = (
                write_provenance_fixture(root)
            )
            wrong_rootfs = root / "wrong-rootfs-source"
            write_rootfs_fixture(wrong_rootfs, source_commit="2" * 40)

            with self.assertRaisesRegex(
                builder.CandidateError,
                "Independent Base source commit differs",
            ):
                builder.build(
                    source_commit=SOURCE,
                    kernel_dir=kernel_dir,
                    initramfs_dir=initramfs_dir,
                    rootfs_dir=wrong_rootfs / "dev-rootfs",
                    out_dir=root / "out",
                )


class DevBaseConsumerTests(unittest.TestCase):
    def descriptor(
        self,
        kernel: bytes,
        initramfs: bytes,
        rootfs: bytes,
        source_commit: str = SOURCE,
    ):
        tag = f"ordax-dev-base-{source_commit}"
        prefix = (
            "https://github.com/ordaxsystems/ordax-os/"
            f"releases/download/{tag}"
        )
        return {
            "$schema": consumer.SCHEMA,
            "status": "development-candidate",
            "source_repository": consumer.REPOSITORY,
            "source_commit": source_commit,
            "tag": tag,
            "activation": "inactive-slot-next-boot",
            "rootfs_activation": "slot-coupled-one-shot-health-gated",
            "manual_usb_rewrite_required": False,
            "kernel": {
                "name": "vmlinuz",
                "url": f"{prefix}/vmlinuz",
                "sha256": hashlib.sha256(kernel).hexdigest(),
                "size": len(kernel),
            },
            "initramfs": {
                "name": "initrd.gz",
                "url": f"{prefix}/initrd.gz",
                "sha256": hashlib.sha256(initramfs).hexdigest(),
                "size": len(initramfs),
            },
            "rootfs": {
                "name": "rootfs.tar",
                "url": f"{prefix}/rootfs.tar",
                "sha256": hashlib.sha256(rootfs).hexdigest(),
                "size": len(rootfs),
            },
        }

    def opener_for(
        self,
        manifest: dict,
        kernel: bytes,
        initramfs: bytes,
        rootfs: bytes,
    ):
        manifest_bytes = (
            json.dumps(manifest, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        payloads = {
            consumer.manifest_url(SOURCE): manifest_bytes,
            manifest["kernel"]["url"]: kernel,
            manifest["initramfs"]["url"]: initramfs,
            manifest["rootfs"]["url"]: rootfs,
        }

        def open_url(url, timeout):
            expected_timeout = (
                consumer.ROOTFS_DOWNLOAD_TIMEOUT_SECONDS
                if url == manifest["rootfs"]["url"]
                else consumer.DOWNLOAD_TIMEOUT_SECONDS
            )
            self.assertEqual(timeout, expected_timeout)
            return FakeResponse(url, payloads[url])

        return open_url

    def test_acquire_materializes_exact_candidate_and_reuses_it_offline(self):
        kernel = b"kernel-dev-channel\n"
        initramfs = b"initramfs-dev-channel\n"
        rootfs = b"rootfs-tar-dev-channel\n"
        manifest = self.descriptor(kernel, initramfs, rootfs)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target, reused = consumer.acquire(
                SOURCE,
                root,
                opener=self.opener_for(manifest, kernel, initramfs, rootfs),
            )
            self.assertFalse(reused)
            self.assertEqual(target, root / SOURCE)
            self.assertEqual((target / "vmlinuz").read_bytes(), kernel)
            self.assertEqual((target / "initrd.gz").read_bytes(), initramfs)
            self.assertEqual((target / "rootfs.tar").read_bytes(), rootfs)
            self.assertEqual(
                consumer.verify_materialized(target, SOURCE)["source_commit"],
                SOURCE,
            )

            def no_network(*_args, **_kwargs):
                raise AssertionError("reused candidate unexpectedly used network")

            same, reused = consumer.acquire(SOURCE, root, opener=no_network)
            self.assertTrue(reused)
            self.assertEqual(same, target)

    def test_acquire_reuses_exact_assets_across_commits(self):
        kernel = b"same kernel"
        initramfs = b"same initramfs"
        old_rootfs, new_rootfs = b"old rootfs", b"new rootfs"
        second = "2" * 40
        first_manifest = self.descriptor(kernel, initramfs, old_rootfs)
        next_manifest = self.descriptor(kernel, initramfs, new_rootfs, second)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            donor, _ = consumer.acquire(
                SOURCE, root,
                opener=self.opener_for(first_manifest, kernel, initramfs, old_rootfs),
            )
            requests = []
            payloads = {
                consumer.manifest_url(second): json.dumps(next_manifest).encode(),
                next_manifest["rootfs"]["url"]: new_rootfs,
            }

            def opener(url, timeout):
                requests.append(url)
                return FakeResponse(url, payloads[url])

            target, reused = consumer.acquire(second, root, opener=opener)
            self.assertFalse(reused)
            self.assertEqual(requests, list(payloads))
            self.assertEqual(consumer.verify_materialized(target, second), next_manifest)
            # A copy, not a hardlink into the new immutable candidate.
            (donor / "vmlinuz").write_bytes(b"bad kernel!")
            self.assertEqual((target / "vmlinuz").read_bytes(), kernel)

    def test_corrupt_same_size_donor_is_never_reused(self):
        kernel, initramfs, rootfs = b"kernel", b"initrd", b"rootfs"
        manifest = self.descriptor(kernel, initramfs, rootfs)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            donor = root / ("3" * 40)
            donor.mkdir()
            (donor / "vmlinuz").write_bytes(b"broken")
            (donor / "initrd.gz").write_bytes(initramfs)
            (donor / "rootfs.tar").write_bytes(rootfs)
            requests = []
            payloads = {
                consumer.manifest_url(SOURCE): json.dumps(manifest).encode(),
                manifest["kernel"]["url"]: kernel,
            }

            def opener(url, timeout):
                requests.append(url)
                return FakeResponse(url, payloads[url])

            target, _ = consumer.acquire(SOURCE, root, opener=opener)
            self.assertEqual(requests, list(payloads))
            self.assertEqual(consumer.verify_materialized(target, SOURCE), manifest)

    def test_acquire_rejects_manifest_for_another_commit(self):
        kernel = b"kernel\n"
        initramfs = b"initramfs\n"
        rootfs = b"rootfs\n"
        wrong = self.descriptor(
            kernel,
            initramfs,
            rootfs,
            source_commit="2" * 40,
        )
        manifest_bytes = json.dumps(wrong).encode("utf-8")

        def opener(url, timeout):
            return FakeResponse(url, manifest_bytes)

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError,
                "commit does not match",
            ):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)

    def test_acquire_rejects_tampered_kernel(self):
        kernel = b"expected-kernel\n"
        initramfs = b"expected-initramfs\n"
        rootfs = b"expected-rootfs\n"
        manifest = self.descriptor(kernel, initramfs, rootfs)
        manifest_bytes = json.dumps(manifest).encode("utf-8")
        payloads = {
            consumer.manifest_url(SOURCE): manifest_bytes,
            manifest["kernel"]["url"]: b"tampered-kernel\n",
            manifest["initramfs"]["url"]: initramfs,
            manifest["rootfs"]["url"]: rootfs,
        }

        def opener(url, timeout):
            return FakeResponse(url, payloads[url])

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError,
                "kernel (size|SHA-256) mismatch",
            ):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)

    def test_acquire_rejects_tampered_rootfs(self):
        kernel = b"expected-kernel\n"
        initramfs = b"expected-initramfs\n"
        rootfs = b"expected-rootfs\n"
        manifest = self.descriptor(kernel, initramfs, rootfs)
        manifest_bytes = json.dumps(manifest).encode("utf-8")
        payloads = {
            consumer.manifest_url(SOURCE): manifest_bytes,
            manifest["kernel"]["url"]: kernel,
            manifest["initramfs"]["url"]: initramfs,
            manifest["rootfs"]["url"]: b"tampered-rootfs\n",
        }

        def opener(url, timeout):
            return FakeResponse(url, payloads[url])

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError,
                "rootfs (size|SHA-256) mismatch",
            ):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)

    def test_materialize_versioned_rootfs_is_atomic_and_reusable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, _kernel, _initramfs = (
                write_provenance_fixture(root)
            )
            candidate = root / "candidate"
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=candidate,
            )

            versions = root / "versions"
            target, reused = consumer.materialize_versioned_rootfs(
                candidate,
                SOURCE,
                versions,
            )
            self.assertFalse(reused)
            self.assertEqual(target, versions / SOURCE)
            self.assertEqual(
                (target / consumer.ROOTFS_MARKER).read_text(encoding="ascii").strip(),
                SOURCE,
            )
            for relative in consumer.REQUIRED_ROOTFS_PATHS:
                self.assertTrue((target / relative).is_file())
            self.assertTrue((target / ".ordax-base").is_dir())

            same, reused = consumer.materialize_versioned_rootfs(
                candidate,
                SOURCE,
                versions,
            )
            self.assertTrue(reused)
            self.assertEqual(same, target)

    def test_missing_exact_commit_candidate_is_retryable(self):
        def opener(url, timeout):
            raise urllib.error.HTTPError(url, 404, "missing", {}, None)

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(consumer.DevBaseCandidateUnavailable):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)


if __name__ == "__main__":
    unittest.main()
