import json
import subprocess
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "bootstrap/initramfs/source.json").read_text(encoding="utf-8"))
KERNEL_SOURCE = json.loads((ROOT / "bootstrap/kernel/source.json").read_text(encoding="utf-8"))
INIT = (ROOT / CONTRACT["root_init"]).read_text(encoding="utf-8")
DEV_BOOTSTRAP = (ROOT / "bootstrap/dev/entrypoint").read_text(encoding="utf-8")
BUILDER = (ROOT / "bootstrap/initramfs/build.py").read_text(encoding="utf-8")
GROW_HELPER = (ROOT / "bootstrap/initramfs/grow_ext4.c").read_text(encoding="utf-8")
PORTABLE_STATE_HELPER = (ROOT / "bootstrap/initramfs/portable_state.c").read_text(encoding="utf-8")
PORTABLE_MOUNT_HELPER = (ROOT / "bootstrap/initramfs/portable_mount.c").read_text(encoding="utf-8")
PORTABLE_CAPSULE_VERIFY = (ROOT / "bootstrap/initramfs/portable_capsule_verify.sh").read_text(encoding="utf-8")
PORTABLE_BASE_VERIFY = (ROOT / "bootstrap/initramfs/portable_base_verify.sh").read_text(encoding="utf-8")
PORTABLE_INIT = (ROOT / "bootstrap/initramfs/portable_init.sh").read_text(encoding="utf-8")
GROWTH_PROOF = (ROOT / "bootstrap/initramfs/prove_ext4_growth.sh").read_text(encoding="utf-8")


class InitramfsSourceContractTests(unittest.TestCase):
    def test_upstream_busybox_is_hash_pinned(self):
        self.assertEqual(CONTRACT["$schema"], "prototype-ordax.initramfs-source/1")
        self.assertEqual(CONTRACT["busybox"]["version"], "1.38.0")
        self.assertRegex(CONTRACT["busybox"]["archive_sha256"], r"^[0-9a-f]{64}$")
        self.assertFalse(CONTRACT["legacy_archive_imported"])

    def test_fixed_initramfs_has_narrow_responsibility(self):
        self.assertFalse(CONTRACT["network_inside_fixed_initramfs"])
        self.assertFalse(CONTRACT["ssh_inside_fixed_initramfs"])
        self.assertFalse(CONTRACT["control_plane_inside_fixed_initramfs"])
        self.assertEqual(CONTRACT["main_partition_label"], "ORDAX")
        self.assertEqual(CONTRACT["bootstrap_entrypoint"], "/ordax/bootstrap/entrypoint")

    def test_storage_growth_contract_is_explicit_and_recovery_stays_read_only(self):
        growth = CONTRACT["storage_growth"]
        self.assertEqual(growth["normal_boot"], "online-ext4-grow-only")
        self.assertEqual(growth["helper_source"], "bootstrap/initramfs/grow_ext4.c")
        self.assertEqual(growth["helper_runtime_path"], "/sbin/ordax-grow-ext4")
        self.assertEqual(growth["target"], "largest-valid-ext4-size-within-ORDAX-block-device")
        self.assertTrue(growth["exact_mounted_block_device_required"])
        self.assertTrue(growth["read_write_mount_required"])
        self.assertFalse(growth["bigalloc_supported"])
        self.assertEqual(growth["failure_policy"], "warn-and-continue")
        self.assertEqual(growth["runtime_proof"], "bootstrap/initramfs/prove_ext4_growth.sh")
        self.assertEqual(growth["runtime_oracle"], "upstream-resize2fs-on-disposable-twin-media")
        self.assertFalse(growth["physical_write_authorized"])

        health = CONTRACT["storage_health"]
        self.assertEqual(health["pre_mount_check"], "ext4-superblock-error-flag")
        self.assertEqual(health["normal_boot_error_policy"], "read-only-recovery")
        self.assertEqual(health["writable_mount_error_policy"], "remount-ro")
        self.assertEqual(health["helper_runtime_path"], "/sbin/ordax-grow-ext4")
        self.assertFalse(health["automatic_destructive_repair"])

        recovery = CONTRACT["recovery"]
        self.assertEqual(recovery["main_partition_mount"], "read-only")
        self.assertFalse(recovery["filesystem_growth"])
        self.assertFalse(recovery["network_started"])

    def test_pid1_understands_only_new_storage_handoff(self):
        self.assertIn("findfs LABEL=ORDAX", INIT)
        self.assertIn("mount -t ext4 -o ro \"$ORDAX_DEVICE\" /ordax", INIT)
        self.assertIn("mount -t ext4 -o rw,errors=remount-ro \"$ORDAX_DEVICE\" /ordax", INIT)
        self.assertIn('/sbin/ordax-grow-ext4 --check "$ORDAX_DEVICE"', INIT)
        self.assertIn('/sbin/ordax-grow-ext4 "$ORDAX_DEVICE" /ordax', INIT)
        self.assertIn("/ordax/bootstrap/entrypoint", INIT)
        recovery_pos = INIT.index('case "$RECOVERY_MODE" in')
        grow_pos = INIT.index('/sbin/ordax-grow-ext4 "$ORDAX_DEVICE" /ordax')
        self.assertLess(recovery_pos, grow_pos)
        for forbidden in ("ORDAX-HOME", "ORDAX-PLATFORM", "sshd", "remote-core", "control-plane", "codex"):
            self.assertNotIn(forbidden.lower(), INIT.lower())

    def test_pid1_handoffs_use_only_fixed_capsule_primitives(self):
        self.assertNotIn("if [", INIT)
        self.assertNotIn("[ -", INIT)
        self.assertNotIn("command -v", INIT)
        self.assertIn('case "$ORDAX_DEVICE" in', INIT)
        self.assertIn('cat "$BOOTSTRAP_PATH" >/dev/null 2>&1', INIT)
        self.assertIn('cat "$RECOVERY_BOOTSTRAP_PATH" >/dev/null 2>&1', INIT)
        self.assertIn('exec "$BOOTSTRAP_PATH"', INIT)
        self.assertIn('exec "$RECOVERY_BOOTSTRAP_PATH"', INIT)
        self.assertIn('if ! /sbin/ordax-grow-ext4 "$ORDAX_DEVICE" /ordax; then', INIT)

    def test_owner_dev_bootstrap_does_not_require_unbuilt_shell_features(self):
        self.assertNotIn("[ -", DEV_BOOTSTRAP)
        self.assertNotIn("test -", DEV_BOOTSTRAP)
        self.assertNotIn("command -v", DEV_BOOTSTRAP)
        self.assertIn('cd "$DEV_ROOT" 2>/dev/null || fail "development base is missing"', DEV_BOOTSTRAP)
        self.assertIn('cat "$DEV_INIT_SOURCE" >/dev/null 2>&1', DEV_BOOTSTRAP)
        self.assertIn('exec switch_root "$DEV_ROOT" "$DEV_INIT"', DEV_BOOTSTRAP)

    def test_initramfs_source_identity_prefers_explicit_ordax_commit_then_checkout(self):
        self.assertIn('os.environ.get("ORDAX_SOURCE_COMMIT", "")', BUILDER)
        self.assertIn(
            'raise BuildError("ORDAX_SOURCE_COMMIT must be exactly 40 hexadecimal characters")',
            BUILDER,
        )
        explicit_pos = BUILDER.index('os.environ.get("ORDAX_SOURCE_COMMIT", "")')
        git_pos = BUILDER.index('["git", "rev-parse", "HEAD"]')
        github_pos = BUILDER.index('os.environ.get("GITHUB_SHA", "")')
        self.assertLess(explicit_pos, git_pos)
        self.assertLess(git_pos, github_pos)

    def test_builder_uses_minimal_busybox_and_explicit_musl_target_compiler(self):
        self.assertIn('"CONFIG_BUSYBOX": "y"', BUILDER)
        self.assertIn('"losetup"', BUILDER)
        self.assertIn('"CONFIG_LOSETUP": "y"', BUILDER)
        self.assertIn('"sha256sum"', BUILDER)
        self.assertIn('"CONFIG_SHA256SUM": "y"', BUILDER)
        self.assertIn('"CONFIG_FEATURE_MD5_SHA1_SUM_CHECK": "y"', BUILDER)
        self.assertIn('"CONFIG_FEATURE_MOUNT_LOOP": "y"', BUILDER)
        self.assertIn('"CONFIG_FEATURE_VOLUMEID_EXFAT": "y"', BUILDER)
        self.assertIn("prepare_kernel_uapi", BUILDER)
        self.assertIn("KERNEL_BUILD.download_archive", BUILDER)
        self.assertIn("KERNEL_BUILD.authenticate_upstream_archive", BUILDER)
        self.assertIn("KERNEL_BUILD.extract_archive", BUILDER)
        self.assertIn('"headers_install"', BUILDER)
        self.assertIn('f"EXTRA_CFLAGS=-I{uapi_include}"', BUILDER)
        self.assertIn("--portable-bootstrap-capsule", BUILDER)
        self.assertIn("portable_capsule_pin", BUILDER)
        self.assertIn("install_portable_capsule_pin", BUILDER)
        self.assertIn("portable-bootstrap-capsule.sha256", BUILDER)
        self.assertIn('"CONFIG_TEST": "y"', BUILDER)
        self.assertIn('"CONFIG_TEST1": "y"', BUILDER)
        self.assertIn('"CONFIG_CP": "y"', BUILDER)
        self.assertIn('"CONFIG_CHMOD": "y"', BUILDER)
        self.assertIn('"cp"', BUILDER)
        self.assertIn('"chmod"', BUILDER)
        self.assertIn('"CONFIG_FEATURE_TEST_64": "y"', BUILDER)
        self.assertNotIn('"CONFIG_TEST2": "y"', BUILDER)
        self.assertIn('"test"', BUILDER)
        self.assertIn('"["', BUILDER)
        self.assertIn('f"CC={musl_cc}"', BUILDER)
        self.assertIn('f"EXTRA_CFLAGS=-I{uapi_include}"', BUILDER)
        self.assertIn('run(make + ["allnoconfig"]', BUILDER)
        self.assertIn('run(make + ["oldconfig"]', BUILDER)
        self.assertIn('"CONFIG_TC=y\\n"', BUILDER)
        self.assertIn('"CONFIG_TELNETD=y\\n"', BUILDER)
        self.assertIn('"CONFIG_HTTPD=y\\n"', BUILDER)
        self.assertIn('musl-gcc\\.specs', BUILDER)
        self.assertIn('wrapper_sha256', BUILDER)
        self.assertIn('specs_sha256', BUILDER)
        self.assertIn('"musl_specs_verified": True', BUILDER)

    def test_ext4_growth_is_bound_to_exact_rw_device_and_has_runtime_proof(self):
        self.assertIn("mount_stat.st_dev != device_stat.st_rdev", GROW_HELPER)
        self.assertIn("mountpoint does not belong to the supplied block device", GROW_HELPER)
        self.assertIn("mount_flags.f_flag & ST_RDONLY", GROW_HELPER)
        self.assertIn("mounted filesystem is read-only", GROW_HELPER)
        self.assertIn("EXT4_IOC_RESIZE_FS", GROW_HELPER)
        self.assertIn("BLKGETSIZE64", GROW_HELPER)
        self.assertIn("read_ext4_disk_info", GROW_HELPER)
        self.assertIn("check_ext4_device", GROW_HELPER)
        self.assertIn("EXT4_SB_STATE", GROW_HELPER)
        self.assertIn("EXT4_ERROR_FS", GROW_HELPER)
        self.assertIn("ORDAX_EXT4_HEALTH=ERRORS", GROW_HELPER)
        self.assertIn("EXT4_SB_BLOCKS_COUNT_LO", GROW_HELPER)
        self.assertIn("EXT4_SB_BLOCKS_COUNT_HI", GROW_HELPER)
        self.assertIn("EXT4_INCOMPAT_64BIT", GROW_HELPER)
        self.assertIn("EXT4_RO_COMPAT_BIGALLOC", GROW_HELPER)
        self.assertIn("unused_tail_blocks >= before.blocks_per_group", GROW_HELPER)

        self.assertIn("truncate -s 132M", GROWTH_PROOF)
        self.assertIn('"$DECOY_LOOP" "$MOUNT"', GROWTH_PROOF)
        self.assertIn("ORDAX_EXT4_GROWTH=PASS", GROWTH_PROOF)
        self.assertIn("resize2fs \"$BASELINE_LOOP\"", GROWTH_PROOF)
        self.assertIn('"$AFTER_BLOCKS" != "$BASELINE_BLOCKS"', GROWTH_PROOF)
        self.assertIn("rw_online_growth_matches_resize2fs_maximum", GROWTH_PROOF)
        self.assertIn("canonical_superblock_count_used", GROWTH_PROOF)
        self.assertIn("mount -t ext4 -o ro", GROWTH_PROOF)
        self.assertIn("read_only_size_unchanged", GROWTH_PROOF)
        self.assertIn('"physical_write_authorized": false', GROWTH_PROOF)
        self.assertIn('"physical_hardware_proven": false', GROWTH_PROOF)

    def test_portable_v2_prerequisites_are_present_without_changing_boot_path(self):
        portable = CONTRACT["portable_v2_prerequisites"]
        self.assertTrue(portable["losetup_applet"])
        self.assertTrue(portable["mount_loop_support"])
        self.assertTrue(portable["exfat_volume_id"])
        self.assertTrue(portable["kernel_exfat_required"])
        self.assertTrue(portable["kernel_erofs_required"])
        self.assertTrue(portable["kernel_overlayfs_required"])
        self.assertFalse(portable["boot_path_enabled"])
        self.assertTrue(portable["handoff_helper_installed"])
        self.assertTrue(portable["handoff_helper_pid1_connected"])
        self.assertFalse(portable["boot_path_enabled"])
        self.assertEqual(portable["main_partition_label_unchanged"], "ORDAX")
        self.assertFalse(portable["physical_boot_promotion_allowed"])
        self.assertEqual(
            portable["kernel_uapi_source_contract"],
            "bootstrap/kernel/source.json",
        )
        self.assertNotIn("kernel_uapi_version", portable)  # computed by the kernel owner
        self.assertTrue(portable["kernel_uapi_headers_install"])
        self.assertFalse(portable["host_linux_headers_required"])
        self.assertEqual(
            portable["busybox_extra_cflags_policy"],
            "pinned-kernel-uapi-include-only",
        )
        capsule = portable["bootstrap_capsule_pin"]
        self.assertTrue(capsule["builder_support"])
        self.assertEqual(capsule["optional_build_input"], "--portable-bootstrap-capsule")
        self.assertEqual(
            capsule["pin_runtime_path"],
            "/etc/ordax/portable-bootstrap-capsule.sha256",
        )
        self.assertTrue(capsule["sha256sum_check_mode"])
        self.assertEqual(
            capsule["busybox_feature"],
            "CONFIG_FEATURE_MD5_SHA1_SUM_CHECK=y",
        )
        self.assertEqual(
            capsule["expected_capsule_path"],
            "/ordax-esp/ordax/bootstrap/bootstrap.erofs",
        )
        self.assertEqual(capsule["hash_algorithm"], "sha256")
        self.assertTrue(capsule["capsule_erofs_magic_checked"])
        self.assertTrue(capsule["pid1_enforced"])
        self.assertFalse(capsule["default_candidate_build_pinned"])
        self.assertFalse(capsule["physical_boot_authorized"])
        verifier = capsule["verification_helper"]
        self.assertEqual(
            verifier["source"],
            "bootstrap/initramfs/portable_capsule_verify.sh",
        )
        self.assertEqual(
            verifier["runtime_path"],
            "/sbin/ordax-portable-capsule-verify",
        )
        self.assertTrue(verifier["installed"])
        self.assertEqual(verifier["operation"], "verify")
        self.assertFalse(verifier["user_supplied_path_allowed"])
        self.assertTrue(verifier["uses_busybox_sha256sum_check_mode"])
        self.assertFalse(verifier["mounts_capsule"])
        self.assertFalse(verifier["network_access"])
        self.assertTrue(verifier["pid1_connected"])
        self.assertIn('PIN=/etc/ordax/portable-bootstrap-capsule.sha256', PORTABLE_CAPSULE_VERIFY)
        self.assertIn('CAPSULE=/ordax-esp/ordax/bootstrap/bootstrap.erofs', PORTABLE_CAPSULE_VERIFY)
        self.assertIn('/bin/busybox sha256sum -c "$PIN"', PORTABLE_CAPSULE_VERIFY)
        self.assertNotIn("mount ", PORTABLE_CAPSULE_VERIFY)
        self.assertNotIn("curl", PORTABLE_CAPSULE_VERIFY)
        self.assertNotIn("wget", PORTABLE_CAPSULE_VERIFY)
        self.assertNotIn("http://", PORTABLE_CAPSULE_VERIFY)
        self.assertNotIn("https://", PORTABLE_CAPSULE_VERIFY)
        self.assertNotIn("ordax-portable-capsule-verify", INIT)

        base_pin = portable["stable_base_pin"]
        self.assertTrue(base_pin["builder_support"])
        self.assertEqual(base_pin["optional_build_input"], "--portable-stable-base")
        self.assertEqual(
            base_pin["pin_runtime_path"],
            "/etc/ordax/portable-stable-base.sha256",
        )
        self.assertEqual(
            base_pin["expected_base_path"],
            "/ordax-data/.ordax/base/stable-base.erofs",
        )
        self.assertEqual(base_pin["artifact_name"], "stable-base.erofs")
        self.assertEqual(base_pin["hash_algorithm"], "sha256")
        self.assertTrue(base_pin["erofs_magic_checked"])
        self.assertTrue(base_pin["pid1_enforced"])
        self.assertFalse(base_pin["default_candidate_build_pinned"])
        self.assertFalse(base_pin["physical_boot_authorized"])
        base_verifier = base_pin["verification_helper"]
        self.assertEqual(
            base_verifier["runtime_path"],
            "/sbin/ordax-portable-base-verify",
        )
        self.assertFalse(base_verifier["user_supplied_path_allowed"])
        self.assertTrue(base_verifier["uses_busybox_sha256sum_check_mode"])
        self.assertFalse(base_verifier["mounts_base"])
        self.assertFalse(base_verifier["network_access"])
        self.assertTrue(base_verifier["pid1_connected"])
        self.assertIn('PIN=/etc/ordax/portable-stable-base.sha256', PORTABLE_BASE_VERIFY)
        self.assertIn('BASE=/ordax-data/.ordax/base/stable-base.erofs', PORTABLE_BASE_VERIFY)
        self.assertIn('/bin/busybox sha256sum -c "$PIN"', PORTABLE_BASE_VERIFY)
        self.assertNotIn("mount ", PORTABLE_BASE_VERIFY)
        self.assertNotIn("curl", PORTABLE_BASE_VERIFY)
        self.assertNotIn("wget", PORTABLE_BASE_VERIFY)
        self.assertNotIn("ordax-portable-base-verify", INIT)

        self.assertIn("findfs LABEL=ORDAX", INIT)
        self.assertNotIn("findfs LABEL=ORDAX-DATA", INIT)

    def test_portable_activation_state_helper_is_transactional_and_nofollow(self):
        reader = CONTRACT["portable_v2_prerequisites"]["activation_state_reader"]
        self.assertEqual(reader["source"], "bootstrap/initramfs/portable_state.c")
        self.assertEqual(reader["runtime_path"], "/sbin/ordax-portable-state")
        self.assertEqual(
            reader["operations"],
            ["read-slot", "resolve", "select", "prepare", "select-boot", "commit", "rollback"],
        )
        self.assertEqual(reader["resolve_boot_slots"], ["current", "known-good"])
        self.assertFalse(reader["resolve_candidate_allowed"])
        self.assertTrue(reader["resolve_requires_materialized_release_shape"])
        self.assertFalse(reader["resolve_verifies_signature"])
        self.assertTrue(reader["resolve_is_for_exact_release_agent_handoff"])
        self.assertEqual(reader["selection_order"], ["candidate-one-shot", "current", "known-good"])
        self.assertTrue(reader["candidate_is_boot_authority"])
        self.assertEqual(reader["candidate_boot_authority"], "armed-one-shot-transaction-only")
        self.assertTrue(reader["requires_materialized_release_directory"])
        self.assertTrue(reader["requires_system_erofs_magic"])
        self.assertTrue(reader["requires_manifest_and_envelope_files"])
        self.assertEqual(reader["selection_output"], "slot-space-commit")
        self.assertFalse(reader["verifies_signature"])
        self.assertTrue(reader["writes_activation_state"])
        self.assertTrue(reader["activation_performed"])
        self.assertTrue(reader["atomic_replace"])
        self.assertTrue(reader["fsync_required"])
        self.assertTrue(reader["directory_fsync_required"])
        self.assertTrue(reader["rejected_identity_persisted"])
        self.assertTrue(reader["pid1_connected"])
        self.assertTrue(reader["static"])
        self.assertFalse(reader["read_only"])
        self.assertEqual(reader["accepted_slots"], ["current", "known-good", "candidate", "rejected"])
        self.assertEqual(reader["runtime_copy_path"], "/run/ordax/bootstrap-tools/ordax-portable-state")
        self.assertTrue(reader["runtime_copy_survives_switch_root"])
        self.assertIn("O_NOFOLLOW", PORTABLE_STATE_HELPER)
        self.assertIn("O_DIRECTORY", PORTABLE_STATE_HELPER)
        self.assertIn("st.st_nlink != 1", PORTABLE_STATE_HELPER)
        self.assertIn("atomic_write_at", PORTABLE_STATE_HELPER)
        self.assertIn("renameat", PORTABLE_STATE_HELPER)
        self.assertIn("fsync(parent)", PORTABLE_STATE_HELPER)
        self.assertIn('strcmp(argv[1], "prepare") == 0', PORTABLE_STATE_HELPER)
        self.assertIn('strcmp(argv[1], "select-boot") == 0', PORTABLE_STATE_HELPER)
        self.assertIn('strcmp(argv[1], "commit") == 0', PORTABLE_STATE_HELPER)
        self.assertIn('strcmp(argv[1], "rollback") == 0', PORTABLE_STATE_HELPER)
        self.assertIn('"activation-transaction.json"', PORTABLE_STATE_HELPER)
        self.assertIn('"rejected"', PORTABLE_STATE_HELPER)
        self.assertIn('select-boot "$STATE_MOUNT" "$PORTABLE_ROOT"', PORTABLE_INIT)
        self.assertIn('sync || rescue "cannot durably flush portable activation state"', PORTABLE_INIT)
        self.assertIn('ORDAX_PORTABLE_ACTIVATION_STATE_DURABLE=YES', PORTABLE_INIT)
        self.assertLess(
            PORTABLE_INIT.index('sync || rescue "cannot durably flush portable activation state"'),
            PORTABLE_INIT.index('ORDAX_PORTABLE_ACTIVATION_STATE_DURABLE=YES'),
        )
        self.assertIn('rollback \\', PORTABLE_INIT)
        self.assertIn('cp /sbin/ordax-portable-state "$RUNTIME_STATE_HELPER"', PORTABLE_INIT)
        self.assertIn('chmod 0555 "$RUNTIME_STATE_HELPER"', PORTABLE_INIT)
        self.assertNotIn("$((", PORTABLE_INIT)

    def test_portable_mount_helper_is_isolated_and_non_authoritative(self):
        helper = CONTRACT["portable_v2_prerequisites"]["portable_mount_helper"]
        self.assertEqual(helper["source"], "bootstrap/initramfs/portable_mount.c")
        self.assertEqual(helper["runtime_path"], "/sbin/ordax-portable-mount")
        self.assertTrue(helper["static"])
        self.assertEqual(
            helper["operations"],
            ["mount-state", "mount-capsule", "mount-base", "mount-system", "mount-surface-runtime", "mount-ai-runtime"],
        )
        self.assertEqual(helper["state_filesystem"], "ext4")
        self.assertEqual(helper["capsule_filesystem"], "erofs")
        self.assertTrue(helper["capsule_read_only"])
        self.assertTrue(helper["capsule_payload_shape_checked"])
        self.assertFalse(helper["capsule_hash_verification_performed_by_mount_helper"])
        self.assertEqual(
            helper["capsule_hash_verification_owner"],
            "busybox-sha256sum-against-initramfs-pin",
        )
        self.assertEqual(helper["base_filesystem"], "erofs")
        self.assertEqual(helper["base_runtime_view"], "overlayfs")
        self.assertEqual(helper["base_overlay_state_root"], "/ordax/base")
        self.assertEqual(helper["release_filesystem"], "erofs")
        self.assertEqual(helper["runtime_system_view"], "read-only-bind")
        self.assertFalse(helper["system_persistent_overlay"])
        self.assertTrue(helper["regular_file_backing_only"])
        self.assertFalse(helper["physical_device_path_input_allowed"])
        self.assertTrue(helper["release_read_only"])
        self.assertFalse(helper["selects_release"])
        self.assertFalse(helper["verifies_signature"])
        self.assertFalse(helper["writes_activation_state"])
        self.assertTrue(helper["pid1_connected"])
        self.assertEqual(helper["surface_runtime_filesystem"], "erofs")
        self.assertTrue(helper["surface_runtime_read_only_lower"])
        self.assertEqual(helper["surface_runtime_view"], "overlayfs-ephemeral-run")
        self.assertFalse(helper["surface_runtime_persistent_upper"])
        self.assertTrue(helper["surface_runtime_required_shape_checked"])
        self.assertEqual(helper["local_ai_runtime_filesystem"], "erofs")
        self.assertTrue(helper["local_ai_runtime_read_only"])
        self.assertEqual(helper["local_ai_runtime_mount_root"], "/run/ordax/runtime/local-ai")
        self.assertTrue(helper["local_ai_runtime_required_shape_checked"])
        self.assertEqual(
            helper["local_ai_runtime_failure_policy"],
            "degrade-intelligence-without-blocking-boot",
        )

        self.assertIn('strncmp(path, "/dev/", 5) == 0', PORTABLE_MOUNT_HELPER)
        self.assertIn("O_NOFOLLOW", PORTABLE_MOUNT_HELPER)
        self.assertIn("LOOP_CTL_GET_FREE", PORTABLE_MOUNT_HELPER)
        self.assertIn("LO_FLAGS_AUTOCLEAR", PORTABLE_MOUNT_HELPER)
        self.assertIn("LO_FLAGS_READ_ONLY", PORTABLE_MOUNT_HELPER)
        self.assertIn('mount(state.device, state_mount, "ext4"', PORTABLE_MOUNT_HELPER)
        self.assertIn('mount(capsule.device, capsule_mount, "erofs"', PORTABLE_MOUNT_HELPER)
        self.assertIn('"bootstrap/release-acquisition/ordax-release-agent"', PORTABLE_MOUNT_HELPER)
        self.assertIn('"bootstrap/recovery/entrypoint"', PORTABLE_MOUNT_HELPER)
        self.assertIn('"bootstrap/config/release-envelope-url"', PORTABLE_MOUNT_HELPER)
        self.assertIn('mount(base.device, base_mount, "erofs"', PORTABLE_MOUNT_HELPER)
        self.assertIn('mount("overlay", root_mount, "overlay"', PORTABLE_MOUNT_HELPER)
        self.assertIn('mount(release.device, release_mount, "erofs"', PORTABLE_MOUNT_HELPER)
        self.assertIn('mount(runtime.device, runtime_root, "erofs"', PORTABLE_MOUNT_HELPER)
        self.assertIn('"bin/llama-server"', PORTABLE_MOUNT_HELPER)
        self.assertIn('"bin/ordax-local-ai"', PORTABLE_MOUNT_HELPER)
        self.assertIn('"metadata/source-lock.json"', PORTABLE_MOUNT_HELPER)
        self.assertIn('"metadata/runtime-policy.json"', PORTABLE_MOUNT_HELPER)
        self.assertIn("MS_BIND | MS_REMOUNT | MS_RDONLY", PORTABLE_MOUNT_HELPER)
        self.assertNotIn('mount("overlay", system_mount, "overlay"', PORTABLE_MOUNT_HELPER)
        # The capsule shape may contain the official release-envelope-url
        # pointer. The mount helper must still never parse or verify signed
        # release envelopes/manifests itself; that authority stays in the
        # release agent.
        self.assertNotIn("release-envelope.json", PORTABLE_MOUNT_HELPER)
        self.assertNotIn("release-manifest.json", PORTABLE_MOUNT_HELPER)
        self.assertNotIn("ed25519", PORTABLE_MOUNT_HELPER.lower())
        self.assertNotIn("sha256", PORTABLE_MOUNT_HELPER.lower())
        self.assertNotIn("https://", PORTABLE_MOUNT_HELPER)
        self.assertNotIn("ordax-portable-mount", INIT)

    def test_portable_v2_candidate_pid1_has_valid_posix_shell_syntax(self):
        result = subprocess.run(
            ["sh", "-n", str(ROOT / "bootstrap/initramfs/portable_init.sh")],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            'mount -o bind,ro "$NEWROOT/run/ordax/lower/capsule/bootstrap" "$NEWROOT/ordax/bootstrap"',
            PORTABLE_INIT,
        )

    def test_portable_v2_candidate_pid1_is_installed_but_not_default(self):
        portable = CONTRACT["portable_v2_prerequisites"]
        pid1 = portable["candidate_pid1"]
        self.assertEqual(pid1["source"], "bootstrap/initramfs/portable_init.sh")
        self.assertEqual(pid1["runtime_path"], "/sbin/ordax-portable-init")
        self.assertTrue(pid1["installed"])
        self.assertFalse(pid1["default_init"])
        self.assertTrue(pid1["legacy_init_unchanged"])
        self.assertEqual(
            pid1["invocation_for_disposable_proof"],
            "rdinit=/sbin/ordax-portable-init",
        )
        self.assertFalse(pid1["physical_boot_entry_implemented"])
        self.assertFalse(pid1["network_required"])
        self.assertFalse(pid1["recovery_network_started"])
        self.assertTrue(pid1["requires_capsule_hash_verification"])
        self.assertTrue(pid1["requires_stable_base_hash_verification"])
        self.assertTrue(pid1["requires_bootstrap_owned_release_trust"])
        self.assertEqual(pid1["release_selection"], ["candidate-one-shot", "current", "known-good"])
        self.assertTrue(pid1["candidate_slot_boot_authority"])
        self.assertEqual(
            pid1["candidate_slot_boot_authority_policy"],
            "armed-one-shot-transaction-only",
        )
        self.assertTrue(pid1["candidate_failure_rolls_back_before_handoff"])
        self.assertTrue(pid1["activation_helper_retained_after_switch_root"])
        self.assertTrue(pid1["activation_state_outer_sync_required"])
        self.assertEqual(
            pid1["activation_state_durable_marker"],
            "ORDAX_PORTABLE_ACTIVATION_STATE_DURABLE=YES",
        )
        self.assertTrue(pid1["activation_state_durable_marker_after_sync"])
        self.assertTrue(pid1["selected_release_exact_signature_verification"])
        self.assertTrue(pid1["release_manifest_v4_supported"])
        self.assertTrue(pid1["local_ai_runtime_verified_handoff"])
        self.assertFalse(pid1["local_ai_runtime_failure_boot_critical"])
        self.assertEqual(pid1["switch_root_target"], "stable-base-overlay")
        self.assertEqual(pid1["product_system_mount"], "read-only-bind")
        self.assertFalse(pid1["pid1_promotion_allowed"])
        self.assertFalse(pid1["physical_boot_authorized"])

        self.assertIn('resolve_portable_devices /sys/block /dev', PORTABLE_INIT)
        self.assertIn('blkid "$device"', PORTABLE_INIT)
        self.assertIn('LABEL="ORDAX-ESP"', PORTABLE_INIT)
        self.assertIn('LABEL="ORDAX-DATA"', PORTABLE_INIT)
        self.assertNotIn('findfs LABEL=ORDAX-ESP', PORTABLE_INIT)
        self.assertNotIn('findfs LABEL=ORDAX-DATA', PORTABLE_INIT)
        self.assertIn('/sbin/ordax-portable-capsule-verify verify', PORTABLE_INIT)
        self.assertIn('/sbin/ordax-portable-base-verify verify', PORTABLE_INIT)
        self.assertIn('select-boot "$STATE_MOUNT" "$PORTABLE_ROOT"', PORTABLE_INIT)
        self.assertIn('verify-portable-v4-exact', PORTABLE_INIT)
        self.assertIn('verify-portable-v3-exact', PORTABLE_INIT)
        self.assertIn('verify-portable-exact', PORTABLE_INIT)
        self.assertIn('surface-runtime.sha256', PORTABLE_INIT)
        self.assertIn('local-ai-runtime.sha256', PORTABLE_INIT)
        self.assertIn('runtimes/sha256', PORTABLE_INIT)
        self.assertIn('ai-runtimes/sha256', PORTABLE_INIT)
        self.assertIn('mount-base', PORTABLE_INIT)
        self.assertIn('mount-system', PORTABLE_INIT)
        self.assertIn('mount-surface-runtime', PORTABLE_INIT)
        self.assertIn('mount-ai-runtime', PORTABLE_INIT)
        self.assertIn('ORDAX_SURFACE_RUNTIME_MODE=verified-erofs-overlay', PORTABLE_INIT)
        self.assertIn('ORDAX_SURFACE_RUNTIME_HANDOFF=VERIFIED', PORTABLE_INIT)
        self.assertIn('ORDAX_LOCAL_AI_RUNTIME_MODE=verified-erofs-read-only', PORTABLE_INIT)
        self.assertIn('ORDAX_LOCAL_AI_RUNTIME_HANDOFF=VERIFIED', PORTABLE_INIT)
        self.assertIn('ORDAX_LOCAL_AI_RUNTIME_HANDOFF=DEGRADED', PORTABLE_INIT)
        self.assertIn('exec switch_root "$NEWROOT" /sbin/ordax-stable-init', PORTABLE_INIT)
        self.assertNotIn('materialize-portable', PORTABLE_INIT)
        self.assertIn('current|known-good|candidate', PORTABLE_INIT)
        self.assertNotIn('ordax-portable-init', INIT)
        self.assertIn('findfs LABEL=ORDAX', INIT)
        self.assertNotIn('findfs LABEL=ORDAX-DATA', INIT)

    def test_physical_use_remains_fail_closed(self):
        self.assertFalse(CONTRACT["build"]["physical_artifact_authorized"])
        self.assertFalse(CONTRACT["storage_growth"]["physical_write_authorized"])
        self.assertEqual(CONTRACT["build"]["static_userspace"], "busybox-musl")
        self.assertEqual(CONTRACT["build"]["deterministic_cpio"], "newc")


if __name__ == "__main__":
    unittest.main()