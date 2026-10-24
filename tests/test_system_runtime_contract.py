import os
import re
from pathlib import Path
import stat
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYSTEM_ENTRYPOINT = ROOT / "system" / "entrypoint"
SYSTEM_SUPERVISOR = ROOT / "system" / "supervisor"
SURFACE_ENTRYPOINT = ROOT / "system" / "surface" / "entrypoint"
SURFACE_RUNTIME = ROOT / "system" / "surface" / "bin" / "ordax-surface"
NATIVE_HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
NATIVE_BROWSER_HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"
NATIVE_COMPONENT_SLOTS = ROOT / "system" / "surface" / "runtime" / "native_component_slots.py"
NATIVE_COMPONENT_PROBATION = ROOT / "system" / "surface" / "runtime" / "native_component_probation.py"
COMPONENT_PROBATION_ORCHESTRATOR = ROOT / "system" / "services" / "components" / "probation-orchestrator.mjs"
RESCUE_AGENT = ROOT / "system" / "rescue" / "agent.sh"
BASE_TELEMETRY_AGENT = ROOT / "system" / "services" / "telemetry" / "base-agent.sh"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native"
NATIVE_COMPONENT_PROBATION_COMPOSITION = NATIVE_COMPOSITION / "component-probation.mjs"


class SystemRuntimeContractTests(unittest.TestCase):
    def test_runtime_chain_exists_and_is_executable(self):
        for path in (SYSTEM_ENTRYPOINT, SURFACE_ENTRYPOINT, SURFACE_RUNTIME):
            self.assertTrue(path.is_file(), path)
            mode = stat.S_IMODE(path.stat().st_mode)
            self.assertEqual(mode, 0o755, f"{path} mode={mode:o}")
        self.assertTrue(SYSTEM_SUPERVISOR.is_file(), SYSTEM_SUPERVISOR)
        self.assertTrue(NATIVE_HOST_SERVER.is_file(), NATIVE_HOST_SERVER)
        self.assertTrue(NATIVE_BROWSER_HOST.is_file(), NATIVE_BROWSER_HOST)
        self.assertTrue(NATIVE_COMPONENT_SLOTS.is_file(), NATIVE_COMPONENT_SLOTS)
        self.assertTrue(NATIVE_COMPONENT_PROBATION.is_file(), NATIVE_COMPONENT_PROBATION)
        self.assertTrue(COMPONENT_PROBATION_ORCHESTRATOR.is_file(), COMPONENT_PROBATION_ORCHESTRATOR)
        self.assertTrue(RESCUE_AGENT.is_file(), RESCUE_AGENT)
        self.assertTrue(BASE_TELEMETRY_AGENT.is_file(), BASE_TELEMETRY_AGENT)
        self.assertTrue((NATIVE_COMPOSITION / "index.html").is_file())
        self.assertTrue((NATIVE_COMPOSITION / "main.mjs").is_file())
        self.assertTrue(
            NATIVE_COMPONENT_PROBATION_COMPOSITION.is_file(),
            NATIVE_COMPONENT_PROBATION_COMPOSITION,
        )

    def test_shell_syntax_is_valid(self):
        for path in (SYSTEM_ENTRYPOINT, SYSTEM_SUPERVISOR, SURFACE_ENTRYPOINT, SURFACE_RUNTIME, RESCUE_AGENT, BASE_TELEMETRY_AGENT):
            subprocess.run(["sh", "-n", str(path)], check=True)

    def test_update_health_and_rescue_receipts_use_unique_staging(self):
        # Constant temporary filenames can collide during recovery/restart.
        sources = (
            (SURFACE_RUNTIME, ("BASE_UPDATE_AGENT", "RUNTIME_PROOF_CONTEXT")),
            (RESCUE_AGENT, ("LAST_GENERATION_FILE", "LAST_ACTION_FILE", "TELEMETRY_STATUS_FILE")),
        )
        for path, destinations in sources:
            script = path.read_text(encoding="utf-8")
            for destination in destinations:
                with self.subTest(path=str(path), destination=destination):
                    self.assertIn(f"temporary=${destination}.tmp.$$", script)
            self.assertNotRegex(script, r"\.tmp\.\$(?!\$)")

    def test_native_host_user_folder_provisioning_is_fail_soft(self):
        text = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn("except OSError as exc:", text)
        self.assertIn("could not provision standard user directories", text)

    def test_native_host_server_python_syntax_is_valid(self):
        for path in (
            NATIVE_HOST_SERVER,
            NATIVE_BROWSER_HOST,
            NATIVE_COMPONENT_SLOTS,
            NATIVE_COMPONENT_PROBATION,
        ):
            subprocess.run(
                ["python3", "-m", "py_compile", str(path)],
                check=True,
            )

    def test_system_entrypoint_is_guardian_and_fail_closed(self):
        text = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        supervisor = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("SUPERVISOR=$SYSTEM_ROOT/supervisor", text)
        self.assertIn("/ordax/bootstrap/recovery/entrypoint", text)
        self.assertIn("start_supervisor()", text)
        self.assertIn("terminate_supervisor()", text)
        self.assertIn("supervisor heartbeat stale", text)
        self.assertIn("BASE_HEARTBEAT_FILE=$BASE_UPDATE_STATE_DIR/base-heartbeat.json", text)
        self.assertIn("BASE_BOOT_ID_FILE=$UPDATE_RUN_DIR/base-boot-id", text)
        self.assertIn("ensure_base_boot_id()", text)
        self.assertIn("/dev/urandom", text)
        self.assertIn("write_base_update_heartbeat()", text)
        self.assertIn("ordax.base_candidate", text)
        self.assertIn("ordax.base_slot", text)
        self.assertIn('"$schema":"prototype-ordax.base-heartbeat/1"', text)
        self.assertLess(
            text.index("write_base_update_heartbeat\n"),
            text.index("while :; do\n    start_supervisor"),
        )
        self.assertNotIn("surface/entrypoint", text)
        self.assertNotIn("ls-remote", text)
        self.assertNotIn("http://", text)
        self.assertNotIn("https://", text)
        self.assertIn("SURFACE_ENTRYPOINT=$SYSTEM_ROOT/surface/entrypoint", supervisor)

    def test_surface_entrypoint_owns_only_surface_handoff(self):
        text = SURFACE_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("bin/ordax-surface", text)
        self.assertIn("ORDAX_SURFACE_MODE=native-auto", text)
        for forbidden in ("curl ", "wget ", "udhcpc", "ssh ", "exec sh"):
            self.assertNotIn(forbidden, text)

    def test_native_surface_accepts_native_disk_user_home_subvolume_override(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn('STATE_ROOT=${ORDAX_STATE_DIR:-/state/ordax}', text)
        self.assertIn('PERSISTENT_USER_HOME=${ORDAX_USER_HOME:-$STATE_ROOT/home}', text)
        self.assertIn('mkdir -p "$SESSION_DIR" "$PERSISTENT_NATIVE_STATE" "$PERSISTENT_USER_HOME"', text)
        self.assertIn('"$RUNTIME_ROOT/var/lib/ordax-user"', text)

    def test_native_surface_reuses_shared_surface_through_native_composition(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        self.assertIn("composition/native/index.html", text)
        self.assertNotIn("start_uri = http://127.0.0.1:8765/composition/web/index.html", text)
        self.assertIn("../../surface/ui/surface.mjs", native_main)
        self.assertIn("../../surface/ui/power-controls.mjs", native_main)
        self.assertIn("/usr/bin/cage", text)
        self.assertIn("/usr/bin/python3 /srv/ordax-system/surface/runtime/ordax_browser_host.py", text)
        self.assertNotIn("/usr/bin/barkery", text)
        self.assertNotIn("/usr/bin/cog", text)
        self.assertIn("/usr/bin/seatd-launch", text)
        self.assertIn("/dev/dri/card0", text)
        self.assertIn("ORDAX_SURFACE_MODE=native-graphical", text)
        self.assertIn("127.0.0.1:8765", text)
        self.assertIn("console_fallback", text)
        for forbidden in ("curl ", "wget ", "udhcpc", "ssh ", "exec sh"):
            self.assertNotIn(forbidden, text)

    def test_native_composition_imports_have_live_consumers(self):
        """ESM imports are evaluated before boot even when their values are unused."""
        source = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        groups = re.findall(r'import\s*\{([^}]+)\}\s*from\s*["\'][^"\']+["\'];', source, re.S)
        self.assertTrue(groups)
        for group in groups:
            for specifier in group.split(","):
                symbol = specifier.strip().split(" as ")[-1]
                if symbol:
                    mentions = re.findall(r"\b" + re.escape(symbol) + r"\b", source)
                    self.assertGreater(len(mentions), 1, f"Unused eager Native import: {symbol}")

    def test_native_graphical_runtime_requires_verified_erofs_and_no_apk(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("runtime/native-surface", text)
        self.assertIn('VERIFIED_RUNTIME_MODE=${ORDAX_SURFACE_RUNTIME_MODE:-}', text)
        self.assertIn('VERIFIED_RUNTIME_ROOT=${ORDAX_SURFACE_RUNTIME_ROOT:-}', text)
        self.assertIn('VERIFIED_RUNTIME_SHA256=${ORDAX_SURFACE_RUNTIME_SHA256:-}', text)
        self.assertIn('RUNTIME_ROOT=$VERIFIED_RUNTIME_ROOT', text)
        self.assertIn("runtime_base_is_ready()", text)
        self.assertIn("runtime_is_ready()", text)
        self.assertIn("ensure_runtime() {", text)
        for required in (
            "$RUNTIME_ROOT/usr/bin/python3",
            "$RUNTIME_ROOT/usr/lib/girepository-1.0/Gtk-3.0.typelib",
            "$RUNTIME_ROOT/usr/lib/girepository-1.0/WebKit2-4.1.typelib",
            "$RUNTIME_ROOT/usr/bin/Xwayland",
            "$RUNTIME_ROOT/sbin/udevd",
            "$RUNTIME_ROOT/bin/udevadm",
        ):
            self.assertIn(required, text)
        for forbidden in (
            "run_bounded_apk", "migrate_legacy_runtime", "install_runtime()",
            "upgrade_existing_runtime", "LEGACY_RUNTIME_", "alpine-v3.", "/sbin/apk",
        ):
            self.assertNotIn(forbidden, text)

    def test_owner_and_stable_share_exact_offline_graphical_host(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("owner-development|stable-mvp", text)
        self.assertIn('runtime_mode=verified-erofs-overlay', text)
        self.assertIn('evidence_scope=canonical-stable-mvp', text)
        self.assertIn("runtime_media_is_ready()", text)
        self.assertIn("runtime_audio_is_ready()", text)
        self.assertIn("/usr/bin/wireplumber", text)
        self.assertIn("--runtime-dir /run/ordax-surface/audio --", text)

    def test_native_browser_is_configured_for_local_shared_surface(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("configure_graphics_host()", text)
        self.assertIn('/usr/bin/git -C "$repo_root" rev-parse HEAD', text)
        self.assertIn("XDG_CACHE_HOME=/tmp/ordax-web-cache-$SOURCE_SHA", text)
        self.assertIn('mkdir -p "$RUNTIME_ROOT/tmp/ordax-web-cache-$SOURCE_SHA"', text)
        self.assertIn("GDK_BACKEND=wayland", text)
        self.assertIn('START_URI="http://127.0.0.1:8765/composition/native/index.html?source=$SOURCE_SHA"', text)
        self.assertIn("/srv/ordax-system/surface/runtime/ordax_browser_host.py", text)
        self.assertIn("--profile-root /var/lib/ordax-user/browser", text)
        self.assertNotIn("/etc/barkery/barkery.conf", text)

    def test_native_surface_bootstraps_persistent_base_telemetry_fail_soft(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("BASE_TELEMETRY_SOURCE=$SYSTEM_ROOT/services/telemetry/base-agent.sh", text)
        self.assertIn("BASE_TELEMETRY_DIR=$STATE_ROOT/telemetry", text)
        self.assertIn("ensure_base_telemetry_agent()", text)
        self.assertIn('/bin/setsid "$BASE_TELEMETRY_AGENT"', text)
        self.assertIn("base telemetry bootstrap failed; continuing Surface startup", text)
        self.assertNotIn('kill "$BASE_TELEMETRY_AGENT"', text)

    def test_native_surface_bootstraps_persistent_rescue_agent_fail_soft(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("RESCUE_SOURCE=$SYSTEM_ROOT/rescue/agent.sh", text)
        self.assertIn("RESCUE_DIR=$STATE_ROOT/rescue", text)
        self.assertIn("ensure_rescue_agent()", text)
        self.assertIn('/bin/setsid "$RESCUE_AGENT"', text)
        self.assertIn("rescue agent bootstrap failed; continuing Surface startup", text)
        self.assertNotIn('kill "$RESCUE', text)

    def test_native_surface_wires_fail_soft_telemetry_config(self):
        launcher = SURFACE_RUNTIME.read_text(encoding="utf-8")
        server = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn("--telemetry-config /srv/ordax-system/services/telemetry/relay.json", launcher)
        self.assertIn("start_telemetry_heartbeat", server)
        self.assertIn("telemetry heartbeat failed safely", server)
        self.assertIn("daemon=True", server)

    def test_native_surface_waits_for_http_and_watches_server_lifetime(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("wait_for_native_server()", text)
        self.assertIn('socket.create_connection(("127.0.0.1", 8765), 0.5)', text)
        self.assertIn('wait_for_native_server 30', text)
        self.assertIn('remaining=${1:-30}', text)
        self.assertNotIn('wait_for_native_server 10', text)
        self.assertIn("native HTTP/control server exited while graphics remained active", text)
        self.assertIn('kill -0 "$HTTP_PID"', text)

    def test_native_surface_server_is_runtime_owned_loopback_only_and_control_capable(self):
        launcher = SURFACE_RUNTIME.read_text(encoding="utf-8")
        server = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn('/bin/busybox mount -o bind "$SYSTEM_ROOT"', launcher)
        self.assertIn("$RUNTIME_ROOT/srv/ordax-system", launcher)
        self.assertIn("/usr/bin/python3 /srv/ordax-system/surface/runtime/native_app_data_runtime.py", launcher)
        self.assertIn("--bind 127.0.0.1", launcher)
        self.assertIn("--directory /srv/ordax-system", launcher)
        self.assertIn("/sbin/ip link set dev lo up", launcher)
        self.assertIn("/sbin/ip address replace 127.0.0.1/8 dev lo", launcher)
        self.assertNotIn("/usr/bin/python3 -m http.server", launcher)
        self.assertNotIn("/bin/busybox httpd", launcher)
        self.assertNotIn("--bind 0.0.0.0", launcher)
        self.assertIn('SESSION_PATH = "/__ordax/native/session"', server)
        self.assertIn('POWER_PATH = "/__ordax/native/power"', server)
        self.assertIn('TOKEN_HEADER = "X-OrdaX-Power-Token"', server)
        self.assertIn("secrets.token_urlsafe(32)", server)
        self.assertIn("POWER_REQUEST=$SESSION_DIR/power-request", launcher)
        self.assertIn("prepare_power_broker", launcher)
        self.assertIn('exec 9<>"$POWER_REQUEST"', launcher)
        self.assertIn('IFS= read -r action <&9', launcher)
        self.assertIn("--power-request /run/ordax-surface/power-request", launcher)
        self.assertIn('DEFAULT_POWER_REQUEST_PATH = "/run/ordax-surface/power-request"', server)
        self.assertIn("queue_power_action", server)
        self.assertNotIn("subprocess.run(command", server)
        self.assertIn("self.client_address[0] != \"127.0.0.1\"", server)
        self.assertIn("hmac.compare_digest", server)
        self.assertIn("Deliberately no CORS headers", server)

    def test_native_component_slot_reader_is_signed_helper_backed_and_fail_closed(self):
        launcher = SURFACE_RUNTIME.read_text(encoding="utf-8")
        server = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        adapter = NATIVE_COMPONENT_SLOTS.read_text(encoding="utf-8")
        self.assertIn('COMPONENT_RUNTIME_PATH = "/__ordax/native/component-runtime"', server)
        self.assertIn("COMPONENT_MODULE_PREFIX", server)
        self.assertIn("component_slot_read_available", server)
        self.assertIn("resolve_component_slot", server)
        self.assertIn("parse_component_module_path", server)
        self.assertIn("read_component_runtime_file", server)
        self.assertIn('set(query) != {"component", "state"}', server)
        self.assertNotIn('{"component", "state", "version", "sourceCommit", "path"}', server)
        self.assertIn("--component-channel-bin /srv/ordax-system/bin/ordax-runtime-component-channel", launcher)
        self.assertIn("--component-trust /srv/ordax-system/trust/runtime-components-ed25519.json", launcher)
        self.assertIn("--component-slot-root /var/lib/ordax/components", launcher)
        self.assertIn('distribution_profile == "stable-mvp"', adapter)
        self.assertIn('product_mode == "usb"', adapter)
        self.assertIn("subprocess.run(", adapter)
        self.assertIn("stdin=subprocess.DEVNULL", adapter)
        self.assertNotIn("shell=True", adapter)
        self.assertNotIn("promote-state", adapter)
        self.assertIn("record_component_pending_health", adapter)
        self.assertNotIn("record_component_pending_health", server)
        self.assertNotIn("promote-state", adapter)
        self.assertNotIn("reject-pending", adapter)
        self.assertNotIn("rollback-state", adapter)
        self.assertNotIn("rollback-state", adapter)

    def test_component_probation_health_bridge_is_internal_nonce_bound_and_non_promoting(self):
        launcher = SURFACE_RUNTIME.read_text(encoding="utf-8")
        browser_host = NATIVE_BROWSER_HOST.read_text(encoding="utf-8")
        authority = NATIVE_COMPONENT_PROBATION.read_text(encoding="utf-8")
        orchestrator = COMPONENT_PROBATION_ORCHESTRATOR.read_text(encoding="utf-8")
        composition = NATIVE_COMPONENT_PROBATION_COMPOSITION.read_text(encoding="utf-8")

        self.assertIn("component_probation_nonces", browser_host)
        self.assertIn(
            "SUPPORTED_PROBATION_COMPONENTS = tuple(sorted(SUPPORTED_NATIVE_PROBATION_COMPONENTS))",
            browser_host,
        )
        self.assertIn("self.start_component_probation(SUPPORTED_PROBATION_COMPONENTS)", browser_host)
        self.assertIn("component_probation_rerun_requested", browser_host)
        self.assertIn("self.component_probation_rerun_requested.add(component_id)", browser_host)
        self.assertIn("secrets.token_urlsafe(32)", browser_host)
        self.assertIn("self.component_probation_nonces.get(component_id)", browser_host)
        self.assertIn("self.component_probation_nonces.pop(component_id, None)", browser_host)
        self.assertIn('component.probation.request', browser_host)
        self.assertIn("component.probation.result", browser_host)
        self.assertIn("record_system_component_probation", browser_host)
        self.assertIn("runNativePendingComponentProbation", browser_host)
        self.assertIn("component-probation.mjs", browser_host)
        self.assertNotIn("adapters/native", browser_host)
        self.assertNotIn("services/components/probation-orchestrator", browser_host)
        self.assertIn("--component-channel-bin /srv/ordax-system/bin/ordax-runtime-component-channel", launcher)
        self.assertIn("--component-slot-root /var/lib/ordax/components", launcher)

        self.assertIn("secrets.compare_digest", authority)
        self.assertIn("record_component_pending_health", authority)
        self.assertIn(
            "PROBE_MODE_BY_COMPONENT = NATIVE_PROBATION_PROBE_MODE_BY_COMPONENT",
            authority,
        )
        self.assertIn("SUPPORTED_COMPONENTS = NATIVE_PROBATION_COMPONENT_IDS", authority)
        self.assertIn("NATIVE_PROBATION_PROBE_MODE_BY_COMPONENT", authority)
        self.assertNotIn('PROBE_MODE = "import-contract"', authority)
        self.assertNotIn("promote-state", authority)
        self.assertNotIn("reject-pending", authority)
        self.assertNotIn("rollback-state", authority)

        self.assertIn("const PROBE_MODES = NATIVE_COMPONENT_PROBE_MODE_BY_ID", orchestrator)
        self.assertIn("NATIVE_COMPONENT_PROBE_MODE_BY_ID", orchestrator)
        self.assertIn('if (mode !== "import-contract")', orchestrator)
        self.assertIn("Unsupported system component probation probe mode", orchestrator)
        self.assertNotIn("NATIVE_COMPONENT_PROBATION_IDS.map", orchestrator)
        self.assertIn("runPendingComponentProbation", orchestrator)
        self.assertNotIn("adapters/native", orchestrator)
        self.assertNotIn("record-health", orchestrator)
        self.assertNotIn("promote", orchestrator)
        self.assertIn("createNativeComponentSlotSource", composition)
        self.assertIn("runSystemPendingComponentProbation", composition)
        self.assertIn("../../adapters/native/component-slot-source.mjs", composition)
        self.assertIn("../../services/components/probation-orchestrator.mjs", composition)

        server = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertNotIn("component.probation.result", server)
        self.assertNotIn("record_system_component_probation", server)

    def test_host_guardian_owns_power_transition_after_surface_request(self):
        surface = SURFACE_RUNTIME.read_text(encoding="utf-8")
        guardian = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")

        self.assertIn('HOST_POWER_REQUEST=${ORDAX_HOST_POWER_REQUEST:-/run/ordax-update/host-power-request}', surface)
        self.assertIn("forward_host_power_request()", surface)
        self.assertIn("record_power_request restart pending", surface)
        self.assertIn("record_power_request shutdown pending", surface)
        # Host power is a fail-closed, durable operation: never forward a
        # request whose cross-boot audit record could not be persisted.
        self.assertIn("if ! record_power_request restart pending; then", surface)
        self.assertIn("if ! record_power_request shutdown pending; then", surface)
        self.assertIn("refusing restart because pending power proof could not be persisted", surface)
        self.assertIn("refusing shutdown because pending power proof could not be persisted", surface)
        self.assertLess(
            surface.index("if ! record_power_request restart pending; then"),
            surface.index("forward_host_power_request restart"),
        )
        self.assertLess(
            surface.index("if ! record_power_request shutdown pending; then"),
            surface.index("forward_host_power_request shutdown"),
        )
        self.assertNotIn("POWER_TRANSITION_REQUEST", surface)
        self.assertNotIn("perform_host_power_transition()", surface)
        self.assertNotIn("quiesce_root_filesystem_for_power_transition()", surface)
        power_broker = surface[surface.index("prepare_power_broker() {"):]
        self.assertNotIn('/bin/busybox kill -TERM "$SURFACE_PID"', power_broker)
        self.assertIn('SURFACE_PID=$$', surface)
        self.assertIn('/bin/busybox kill -TERM "$SURFACE_PID"', surface)
        self.assertNotIn('/bin/busybox reboot -f', surface)
        self.assertNotIn('/bin/busybox poweroff -f', surface)

        self.assertIn("HOST_POWER_REQUEST=$UPDATE_RUN_DIR/host-power-request", guardian)
        self.assertIn("prepare_host_power_channel()", guardian)
        self.assertIn('exec 8<>"$HOST_POWER_REQUEST"', guardian)
        self.assertIn('read -r -t "$CHECK_INTERVAL" HOST_POWER_ACTION <&8', guardian)
        self.assertIn("perform_host_power_transition()", guardian)
        self.assertIn("quiesce_supervisor_for_power_transition()", guardian)
        self.assertIn("SUPERVISOR_POWER_QUIESCED_FILE=$UPDATE_RUN_DIR/supervisor-power-quiesced", guardian)
        self.assertIn("terminate_persistent_host_agents()", guardian)
        self.assertIn('/bin/busybox mount -o remount,ro /', guardian)
        self.assertIn('/bin/busybox mount -o remount,bind,ro /', guardian)
        self.assertIn("root_filesystem_is_read_only", guardian)
        self.assertIn('/bin/busybox reboot -f >/dev/null 2>&1', guardian)
        self.assertIn('/bin/busybox poweroff -f >/dev/null 2>&1', guardian)
        # Emergency sysrq b/o reset bypasses clean ext4 teardown and must
        # never be the Guardian's ordinary fallback after a kernel syscall.
        self.assertNotIn("/proc/sysrq-trigger", guardian)
        self.assertIn("kernel-transition-returned", guardian)
        self.assertIn('/bin/busybox mount -o remount,rw /', guardian)
        transition = guardian[
            guardian.index("perform_host_power_transition()") : guardian.index("wait_guardian_interval()")
        ]
        self.assertLess(
            transition.index("quiesce_supervisor_for_power_transition"),
            transition.index('/bin/busybox sync >>"$GUARDIAN_LOG"'),
        )
        self.assertLess(
            transition.index('/bin/busybox sync >>"$GUARDIAN_LOG"'),
            transition.index('remount_root_read_only_for_power'),
        )
        self.assertLess(
            transition.index('remount_root_read_only_for_power'),
            transition.index('/bin/busybox reboot -f'),
        )
        self.assertLess(
            transition.index('remount_root_read_only_for_power'),
            transition.index('/bin/busybox poweroff -f'),
        )

    def test_supervisor_proves_surface_quiescence_before_guardian_power_transition(self):
        supervisor = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        guardian = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("SUPERVISOR_POWER_QUIESCED_FILE=$UPDATE_RUN_DIR/supervisor-power-quiesced", supervisor)
        self.assertIn('rm -f "$SUPERVISOR_POWER_QUIESCED_FILE"', supervisor)
        termination = supervisor[supervisor.index("terminate() {") : supervisor.index("fail_closed() {")]
        self.assertLess(termination.index("stop_surface"), termination.index('mv -f "$temporary" "$SUPERVISOR_POWER_QUIESCED_FILE"'))
        self.assertIn('[ "$proof" = "$pid" ] || {', guardian)
        self.assertIn("supervisor exited without proving Surface/Native quiescence", guardian)

    def test_power_actions_persist_cross_boot_proof_before_destructive_action(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("POWER_LAST_REQUEST=$POWER_STATE_DIR/last-request", text)
        guardian = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        # $ is a per-process shell PID; a literal $ silently reuses the
        # same temporary file between the Surface broker and the Guardian.
        self.assertIn("temporary=$POWER_LAST_REQUEST.tmp.$$", text)
        self.assertIn("temporary=$POWER_LAST_REQUEST.tmp.$$", guardian)

        self.assertIn("record_power_request()", text)
        self.assertIn("record_power_request restart pending", text)
        self.assertIn("record_power_request restart failed", text)
        self.assertIn("record_power_request shutdown pending", text)
        self.assertIn("record_power_request shutdown failed", text)
        self.assertIn("printf '%s|%s|%s|%s\\n'", text)
        # Surface only records and forwards; Guardian performs the fsync.
        self.assertIn('/bin/busybox sync', SYSTEM_ENTRYPOINT.read_text(encoding='utf-8'))
        self.assertIn('forward_host_power_request shutdown', text)
        self.assertLess(
            text.index("record_power_request restart pending"),
            text.index("if ! forward_host_power_request restart; then"),
        )
        self.assertLess(
            text.index("record_power_request shutdown pending"),
            text.index("if ! forward_host_power_request shutdown; then"),
        )

    def test_power_delivery_cannot_hang_without_guardian_fifo_reader(self):
        surface = SURFACE_RUNTIME.read_text(encoding="utf-8")
        forward = surface.split("forward_host_power_request() {", 1)[1].split("\n}\n", 1)[0]
        broker = surface.split("prepare_power_broker() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('/bin/busybox timeout -k 1 3 /bin/sh -c', forward)
        self.assertIn('host power owner did not accept $action within timeout', forward)
        self.assertIn('[ -p "$HOST_POWER_REQUEST" ]', broker)
        self.assertIn('controls disabled', broker)
        self.assertIn(
            'prepare_power_broker || echo "ordax-surface: host power broker unavailable;',
            surface,
        )

    def test_power_delivery_fifo_without_reader_returns_bounded_failure(self):
        # Runtime integration: exercise exactly the checked-in shell function,
        # on a disposable FIFO, never invoking a host reboot or shutdown.
        if not Path("/bin/busybox").is_file():
            self.skipTest("BusyBox runtime is not available on this test host")
        import os
        import tempfile

        surface = SURFACE_RUNTIME.read_text(encoding="utf-8")
        forward = "forward_host_power_request() {" + surface.split(
            "forward_host_power_request() {", 1
        )[1].split("\n}\n", 1)[0] + "\n}\n"
        with tempfile.TemporaryDirectory() as temporary:
            request = Path(temporary) / "power-request"
            log = Path(temporary) / "host.log"
            os.mkfifo(request, 0o600)
            env = dict(os.environ, HOST_POWER_REQUEST=str(request), HOST_LOG=str(log))
            result = subprocess.run(
                ["/bin/sh", "-c", forward + "\nforward_host_power_request restart\n"],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=8,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("did not accept restart within timeout", log.read_text())
            # A real Guardian reader accepts the same exact allowed request.
            descriptor = os.open(request, os.O_RDONLY | os.O_NONBLOCK)
            try:
                delivered = subprocess.run(
                    ["/bin/sh", "-c", forward + "\nforward_host_power_request shutdown\n"],
                    env=env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=8,
                    check=False,
                )
                self.assertEqual(delivered.returncode, 0, delivered.stderr)
                self.assertEqual(os.read(descriptor, 32), b"shutdown\n")
            finally:
                os.close(descriptor)

    def test_stale_same_boot_power_request_is_reconciled_as_failed(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("POWER_PENDING_STALE_SECONDS=120", text)
        self.assertIn("write_power_request_record()", text)
        self.assertIn("current_power_boot_id()", text)
        self.assertIn("reconcile_stale_power_request()", text)
        self.assertIn('[ "$request_boot_id" = "$current_boot_id" ] || return 0', text)
        self.assertIn(
            'write_power_request_record "$action" "$request_boot_id" "$request_epoch" failed',
            text,
        )
        self.assertIn(
            "different boot id is positive cross-boot evidence",
            text,
        )
        self.assertLess(
            text.index("reconcile_stale_power_request ||"),
            text.index("ensure_base_telemetry_agent ||"),
        )

    def test_graphical_runtime_receives_bounded_host_dns_configuration(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        resolver = (ROOT / "system/surface/runtime/resolver_sync.sh").read_text(encoding="utf-8")
        broker = (ROOT / "system/surface/runtime/network_broker.sh").read_text(encoding="utf-8")
        self.assertIn("sync_runtime_resolver() {", text)
        self.assertIn('resolver_sync=$SYSTEM_ROOT/surface/runtime/resolver_sync.sh', text)
        self.assertIn('/bin/sh "$resolver_sync" "$RUNTIME_ROOT" "$HOST_LOG"', text)
        self.assertIn('ORDAX_RUNTIME_RESOLVER_SYNC_SCRIPT=', text)
        self.assertIn('ORDAX_RUNTIME_RESOLVER_ROOT="$RUNTIME_ROOT"', text)
        self.assertIn('ORDAX_RUNTIME_RESOLVER_LOG="$NETWORK_LOG"', text)
        self.assertIn('host_resolver=${3:-/etc/resolv.conf}', resolver)
        self.assertIn('mv -f "$temporary" "$runtime_root/etc/resolv.conf"', resolver)
        self.assertIn("resolver_size=", resolver)
        self.assertIn('[ "$resolver_size" -gt 16384 ]', resolver)
        self.assertIn('no routable nameserver', resolver)
        self.assertIn('ORDAX_RUNTIME_RESOLVER_SYNC_SCRIPT', broker)
        self.assertIn('if ! try_dhcp "$wifi"; then', broker)
        self.assertIn('/bin/sh "$RESOLVER_SYNC_SCRIPT" "$RESOLVER_ROOT" "$RESOLVER_LOG"', broker)
        self.assertLess(
            text.index('ensure_runtime || fallback_with_reason'),
            text.index('sync_runtime_resolver ||'),
        )
        self.assertLess(
            text.index('sync_runtime_resolver ||'),
            text.index('ensure_base_update_agent ||'),
        )
        self.assertNotIn('mount -o bind /etc "$RUNTIME_ROOT/etc"', text)

    def test_wlroots_physical_prerequisites_are_prepared(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("ensure_shared_memory", text)
        self.assertIn("mkdir -p /dev/shm", text)
        self.assertIn("chmod 1777 /dev/shm", text)
        self.assertIn("failed to prepare /dev/shm for wlroots/Xwayland", text)
        self.assertIn("failed to configure IPv4 loopback for local Surface HTTP", text)

    def test_physical_input_is_classified_with_runtime_owned_eudev(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("prepare_input_stack", text)
        self.assertIn("/dev/input/event*", text)
        self.assertIn("/sbin/udevd --daemon", text)
        self.assertIn("/bin/udevadm control --reload-rules", text)
        self.assertIn("/bin/udevadm trigger --subsystem-match=input --action=add", text)
        self.assertIn("/bin/udevadm settle --timeout=5", text)
        self.assertIn("eudev input classification complete", text)
        self.assertNotIn("WLR_LIBINPUT_NO_DEVICES=1", text)
        self.assertIn("failed to prepare physical keyboard/touchpad input devices", text)

    def test_native_surface_restart_reaps_only_runtime_root_orphans(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("terminate_child()", text)
        self.assertIn("runtime_root_processes()", text)
        self.assertIn("reap_stale_runtime_processes()", text)
        self.assertIn("clear_stale_runtime_mounts()", text)
        self.assertIn('root_target=$(/bin/busybox readlink "$root_link"', text)
        self.assertIn('[ "$root_target" = "$RUNTIME_ROOT" ]', text)
        self.assertIn('stale_pids=$(runtime_root_processes) || return 1', text)
        self.assertIn('runtime processes remain after bounded SIGKILL; refusing mount teardown', text)
        self.assertIn('cleanup refused; runtime chroot remains active', text)
        self.assertIn('reap_stale_runtime_processes || fallback_with_reason', text)
        self.assertIn('kill -KILL "$pid"', text)
        self.assertIn("quiesce_surface_children()", text)
        self.assertIn('"$GRAPHICS_PID" "$HTTP_PID"', text)
        self.assertIn('quiesce_surface_children\n', text.split("cleanup() {", 1)[1])
        self.assertLess(
            text.index('reap_stale_runtime_processes || fallback_with_reason'),
            text.index('ensure_runtime || fallback_with_reason'),
        )
        self.assertNotIn("pkill ", text)
        self.assertNotIn("killall ", text)

    def test_runtime_reaper_sends_kill_and_waits_for_real_process_exit(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        function = "reap_stale_runtime_processes() {" + text.split(
            "reap_stale_runtime_processes() {", 1
        )[1].split("\n}", 1)[0] + "\n}"
        # This exercises the production reaper with a real Linux child.
        # Only /proc/root enumeration is substituted: entering a chroot
        # would require privileges not available to Foundation CI.
        child = subprocess.Popen(
            [
                sys.executable,
                "-u",
                "-c",
                "import signal,time; "
                "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                "print('ready',flush=True); time.sleep(60)",
            ],
            stdout=subprocess.PIPE,
            text=True,
        )
        try:
            self.assertEqual(child.stdout.readline().strip(), "ready")
            script = (
                "HOST_LOG=/dev/null\n"
                "runtime_root_processes() {\n"
                f"  if [ -r /proc/{child.pid}/status ] && "
                f"! grep -q '^State:[[:space:]]*Z' /proc/{child.pid}/status; then\n"
                f"    printf '%s\\n' {child.pid}\n"
                "  fi\n"
                "}\n" + function + "\nreap_stale_runtime_processes\n"
            )
            result = subprocess.run(
                ["sh", "-c", script], capture_output=True, text=True, timeout=12
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertLess(child.wait(timeout=3), 0)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=3)
            child.stdout.close()

    def test_runtime_reaper_refuses_unverified_process_survivor(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        function = "reap_stale_runtime_processes() {" + text.split(
            "reap_stale_runtime_processes() {", 1
        )[1].split("\n}", 1)[0] + "\n}"
        # A permanently observed live process must never be treated as
        # quiesced merely because TERM/SIGKILL commands returned success.
        script = (
            "HOST_LOG=/dev/null\n"
            "runtime_root_processes() { printf '43210\\n'; }\n"
            "kill() { return 0; }\n"
            + function
            + "\nreap_stale_runtime_processes\n"
        )
        result = subprocess.run(
            ["sh", "-c", script], capture_output=True, text=True, timeout=12
        )
        self.assertNotEqual(result.returncode, 0)

    def test_native_host_clears_only_stale_seatd_socket(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("SEATD_SOCKET=/run/seatd.sock", text)
        self.assertIn("seatd_process_running", text)
        self.assertIn("remove_stale_seatd_socket", text)
        self.assertIn("seatd path exists but is not a UNIX socket", text)
        self.assertIn("seatd socket is owned by a running seatd process; refusing to remove it", text)
        self.assertIn("removing stale seatd socket", text)
        self.assertIn("failed to clear stale seatd socket before native host startup", text)

    def test_native_surface_fallback_exposes_physical_diagnostics(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("fallback_with_reason", text)
        self.assertIn("Diagnostic:", text)
        self.assertIn("HTTP diagnostic:", text)
        self.assertIn("HTTP log:", text)
        self.assertIn("DRM device /dev/dri/card0 is unavailable", text)
        self.assertIn("graphical runtime is unavailable after bounded provisioning attempt", text)
        self.assertIn("failed to bind host resources into graphical runtime", text)
        self.assertIn("native Surface HTTP/control server failed readiness check", text)
        self.assertIn("native Cage/OrdaX WebKit host exited with status", text)


if __name__ == "__main__":
    unittest.main()
