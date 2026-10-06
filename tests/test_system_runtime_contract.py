import os
from pathlib import Path
import stat
import subprocess
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

    def test_native_graphical_runtime_is_provisioned_from_pulled_system(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("runtime/native-surface", text)
        self.assertIn("run_bounded_apk()", text)
        self.assertIn('/bin/busybox timeout -k 10 "$timeout_seconds" /sbin/apk', text)
        self.assertIn('RUNTIME_INSTALL_TIMEOUT=${ORDAX_RUNTIME_INSTALL_TIMEOUT_SECONDS:-180}', text)
        self.assertIn('RUNTIME_UPGRADE_TIMEOUT=${ORDAX_RUNTIME_UPGRADE_TIMEOUT_SECONDS:-120}', text)
        self.assertIn('run_bounded_apk "$RUNTIME_INSTALL_TIMEOUT"', text)
        self.assertIn("--keys-dir /etc/apk/keys", text)
        self.assertIn("alpine/v3.22/main", text)
        self.assertIn("alpine/v3.22/community", text)
        self.assertIn("python3 py3-gobject3 gtk+3.0 webkit2gtk-4.1", text)
        self.assertNotIn("barkery-browser", text)
        self.assertIn("xwayland", text)
        self.assertIn("eudev", text)
        self.assertIn("libinput-udev", text)
        self.assertNotIn("\n        cog ", text)
        self.assertIn("/bin/busybox chroot", text)
        self.assertIn("mesa-dri-gallium", text)
        self.assertIn("$RUNTIME_ROOT/usr/bin/python3", text)
        self.assertIn("$RUNTIME_ROOT/usr/lib/girepository-1.0/Gtk-3.0.typelib", text)
        self.assertIn("$RUNTIME_ROOT/usr/lib/girepository-1.0/WebKit2-4.1.typelib", text)
        self.assertIn("$RUNTIME_ROOT/usr/bin/Xwayland", text)
        self.assertIn("$RUNTIME_ROOT/sbin/udevd", text)
        self.assertIn("$RUNTIME_ROOT/bin/udevadm", text)

    def test_stable_mvp_uses_preverified_runtime_and_never_provisions_with_apk(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn('VERIFIED_RUNTIME_MODE=${ORDAX_SURFACE_RUNTIME_MODE:-}', text)
        self.assertIn('VERIFIED_RUNTIME_ROOT=${ORDAX_SURFACE_RUNTIME_ROOT:-}', text)
        self.assertIn('VERIFIED_RUNTIME_SHA256=${ORDAX_SURFACE_RUNTIME_SHA256:-}', text)
        self.assertIn('verified-erofs-overlay', text)
        self.assertIn('/run/ordax/runtime/native-surface/rootfs', text)
        self.assertIn(
            'Stable/MVP requires the preverified offline graphical runtime',
            text,
        )
        ensure = text.split("ensure_runtime() {", 1)[1].split("\n}", 1)[0]
        stable_branch = ensure.split('if [ "$DISTRIBUTION_PROFILE" = "stable-mvp" ]; then', 1)[1]
        stable_branch = stable_branch.split("\n    fi", 1)[0]
        self.assertNotIn("run_bounded_apk", stable_branch)
        self.assertNotIn("install_runtime", stable_branch)
        self.assertNotIn("upgrade_existing_runtime", stable_branch)
        self.assertIn("runtime_is_ready", stable_branch)

    def test_existing_runtime_is_extended_without_full_reprovision(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("runtime_base_is_ready", text)
        self.assertIn("upgrade_existing_runtime", text)
        self.assertIn('run_bounded_apk "$RUNTIME_UPGRADE_TIMEOUT"', text)
        self.assertIn("xwayland eudev libinput-udev python3 py3-gobject3 gtk+3.0 webkit2gtk-4.1", text)
        self.assertIn("extending existing graphical runtime with WebKit browser host support", text)
        self.assertIn("RUNTIME_ID=alpine-v3.22-cage-webkitgtk-v1", text)
        self.assertIn("LEGACY_RUNTIME_ID=alpine-v3.22-cage-barkery-v1", text)
        self.assertIn("legacy_runtime_can_seed", text)
        self.assertIn("migrate_legacy_runtime", text)
        self.assertIn('/bin/busybox cp -a "$LEGACY_RUNTIME_ROOT" "$STAGING_DIR/rootfs"', text)
        self.assertIn("seeding WebKit runtime from $LEGACY_RUNTIME_ID", text)
        self.assertIn("commit_staged_runtime", text)

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
        self.assertIn('wait_for_native_server 10', text)
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
        self.assertIn('/bin/busybox reboot -f', launcher)
        self.assertIn('/bin/busybox poweroff -f', launcher)
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
        self.assertIn('APP_INTELLIGENCE_MANIFEST_PATH = "/__ordax/native/app-intelligence-manifest"', server)
        self.assertIn('APP_INTELLIGENCE_AWARENESS_PATH = "/__ordax/native/app-intelligence-awareness"', server)
        self.assertIn("read_verified_first_party_app_awareness_bundle", server)
        self.assertIn("read_verified_first_party_app_awareness_bundle", adapter)
        awareness_route = server.split("if parsed_path == APP_INTELLIGENCE_AWARENESS_PATH:", 1)[1].split("if parsed_path == APP_INTELLIGENCE_MANIFEST_PATH:", 1)[0]
        self.assertIn('"$schema": "ordax.native-app-intelligence-awareness/1"', awareness_route)
        self.assertIn('"component": component', awareness_route)
        self.assertIn('"manifest": manifest', awareness_route)
        self.assertIn("self._empty(404)", awareness_route)
        app_manifest_route = server.split("if parsed_path == APP_INTELLIGENCE_MANIFEST_PATH:", 1)[1].split("if parsed_path == COMPONENT_RUNTIME_PATH:", 1)[0]
        self.assertIn("except ComponentSlotRequestError:", app_manifest_route)
        self.assertIn("self._empty(404)", app_manifest_route)
        self.assertIn("read_verified_app_intelligence_manifest", server)
        self.assertIn("read_verified_app_intelligence_manifest", adapter)
        self.assertIn('requested_path = f"system/apps/{component_id}/ai/manifest.json"', adapter)
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

        self.assertIn("component_probation_nonce", browser_host)
        self.assertIn("secrets.token_urlsafe(32)", browser_host)
        self.assertIn("component.probation.result", browser_host)
        self.assertIn("record_system_component_probation", browser_host)
        self.assertLess(
            browser_host.index("outcome = record_system_component_probation("),
            browser_host.index("self.component_probation_nonce = None", browser_host.index("def handle_component_probation_result")),
        )
        self.assertIn("runNativePendingComponentProbation", browser_host)
        self.assertIn("component-probation.mjs", browser_host)
        self.assertNotIn("adapters/native", browser_host)
        self.assertNotIn("services/components/probation-orchestrator", browser_host)
        self.assertIn("--component-channel-bin /srv/ordax-system/bin/ordax-runtime-component-channel", launcher)
        self.assertIn("--component-slot-root /var/lib/ordax/components", launcher)

        self.assertIn("secrets.compare_digest", authority)
        self.assertIn("record_component_pending_health", authority)
        self.assertIn('PROBE_MODE = "import-contract"', authority)
        self.assertNotIn("promote-state", authority)
        self.assertNotIn("reject-pending", authority)
        self.assertNotIn("rollback-state", authority)

        self.assertIn('internet: "import-contract"', orchestrator)
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

    def test_native_restart_has_sync_and_kernel_fallback_without_weakening_shutdown(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("restart_host()", text)
        self.assertIn('echo "ordax-surface: attempting primary reboot syscall"', text)
        self.assertIn('/bin/busybox reboot -f', text)
        self.assertIn('/bin/busybox sync', text)
        self.assertIn('/proc/sysrq-trigger', text)
        self.assertIn("printf 'b' >/proc/sysrq-trigger", text)
        self.assertIn(
            "all host restart methods returned without rebooting",
            text,
        )
        self.assertIn('/bin/busybox poweroff -f', text)
        self.assertNotIn("restart_host || true\n                        shutdown", text)

    def test_power_actions_persist_cross_boot_proof_before_destructive_action(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("POWER_LAST_REQUEST=$POWER_STATE_DIR/last-request", text)
        self.assertIn("record_power_request()", text)
        self.assertIn("record_power_request restart pending", text)
        self.assertIn("record_power_request restart failed", text)
        self.assertIn("record_power_request shutdown pending", text)
        self.assertIn("record_power_request shutdown failed", text)
        self.assertIn("printf '%s|%s|%s|%s\\n'", text)
        self.assertIn('/bin/busybox sync', text)
        self.assertIn('host poweroff command returned without shutting down', text)
        self.assertLess(
            text.index("record_power_request restart pending"),
            text.index("if ! restart_host; then"),
        )
        self.assertLess(
            text.index("record_power_request shutdown pending"),
            text.index('/bin/busybox poweroff -f'),
        )

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
        self.assertIn("sync_runtime_resolver()", text)
        self.assertIn("host_resolver=/etc/resolv.conf", text)
        self.assertIn("runtime_resolver=$RUNTIME_ROOT/etc/resolv.conf", text)
        self.assertIn("resolver_size=", text)
        self.assertIn("[ \"$resolver_size\" -gt 16384 ]", text)
        self.assertIn("/bin/busybox grep -Eq", text)
        self.assertIn("nameserver", text)
        self.assertIn('/bin/busybox mv -f "$temporary" "$runtime_resolver"', text)
        self.assertIn(
            "external DNS unavailable inside graphical runtime; continuing local Surface",
            text,
        )
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
        self.assertIn('[ "$root_target" = "$RUNTIME_ROOT" ] || continue', text)
        self.assertIn('kill -KILL "$pid"', text)
        self.assertIn('terminate_child "$GRAPHICS_PID" "graphics host"', text)
        self.assertIn('terminate_child "$HTTP_PID" "native HTTP host"', text)
        self.assertLess(
            text.index("reap_stale_runtime_processes\nclear_stale_runtime_mounts"),
            text.index('ensure_runtime || fallback_with_reason'),
        )
        self.assertNotIn("pkill ", text)
        self.assertNotIn("killall ", text)

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
