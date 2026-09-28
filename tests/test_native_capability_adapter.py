from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE_RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_RUNTIME = ROOT / "system" / "adapters" / "web" / "runtime.mjs"
WEB_COMPOSITION = ROOT / "system" / "composition" / "web" / "main.mjs"


class NativeCapabilityAdapterTests(unittest.TestCase):
    def test_native_runtime_owns_native_surface_snapshot(self):
        text = NATIVE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("createNativeSurfaceHost", text)
        self.assertIn('"surface.render"', text)
        self.assertIn('"network.https"', text)
        self.assertIn('"system.boot-control"', text)
        self.assertIn('"filesystem.user-space"', text)
        self.assertIn('"system.metrics"', text)
        self.assertIn('"power.status"', text)
        self.assertIn('"network.status"', text)
        self.assertIn('"input.keyboard-layout"', text)
        self.assertIn('"intelligence.system"', text)
        self.assertIn('"session.local-lock"', text)
        self.assertIn("bootControlAvailable", text)
        self.assertIn("userFileSpaceAvailable", text)
        self.assertIn("systemMetricsAvailable", text)
        self.assertIn("powerStatusAvailable", text)
        self.assertIn("networkStatusAvailable", text)
        self.assertIn("keyboardLayoutAvailable", text)
        self.assertIn("intelligenceSystemAvailable", text)
        self.assertIn("localSessionAvailable", text)
        self.assertIn("identitySession = null", text)
        self.assertIn("assertIdentitySessionPort(identitySession)", text)
        self.assertIn("identityPort.getSnapshot().state", text)
        self.assertIn("identityPort?.subscribe(() => notify())", text)
        self.assertIn("validateSurfaceSnapshot", text)
        self.assertIn("navigator.onLine", text)

    def test_native_composition_does_not_reuse_web_host_adapter(self):
        text = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('../../adapters/native/runtime.mjs', text)
        self.assertIn("createNativeSurfaceHost", text)
        self.assertNotIn('../../adapters/web/runtime.mjs', text)
        self.assertNotIn("createWebSurfaceHost", text)

    def test_native_optional_capabilities_are_derived_from_actual_ports(self):
        text = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("powerActions?.getSnapshot().supportedActions.length", text)
        self.assertIn("userFileSpaceAvailable = fileSpace !== null", text)
        self.assertIn("systemMetricsAvailable = systemMetrics !== null", text)
        self.assertIn("powerStatusAvailable = powerStatus !== null", text)
        self.assertIn("networkStatusAvailable = networkStatus !== null", text)
        self.assertIn("keyboardLayoutAvailable = keyboardLayout !== null", text)
        self.assertIn("intelligenceSystemAvailable = true", text)
        self.assertIn("localSessionAvailable = localSession !== null", text)
        self.assertIn("bootControlAvailable,", text)
        self.assertIn("userFileSpaceAvailable,", text)
        self.assertIn("systemMetricsAvailable,", text)
        self.assertIn("powerStatusAvailable,", text)
        self.assertIn("networkStatusAvailable,", text)
        self.assertIn("keyboardLayoutAvailable,", text)
        self.assertIn("intelligenceSystemAvailable,", text)
        self.assertIn("localSessionAvailable,", text)
        self.assertIn("identitySession,", text)
        self.assertIn("createNativeSurfaceHost(window, {", text)

    def test_native_composes_intelligence_above_local_ai_without_provider_leakage(self):
        text = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('createLocalAiRuntime', text)
        self.assertIn('createIntelligenceRuntime', text)
        self.assertIn('createIntelligenceRuntime({ inferencePort: localAi })', text)
        self.assertIn('intelligence,', text)
        self.assertNotIn('llama.cpp', text)
        self.assertNotIn('Qwen', text)
        self.assertNotIn('17865', text)

    def test_native_optional_capability_probes_run_in_parallel(self):
        text = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("const preferenceStorePromise = createNativePreferenceStore(window);", text)
        self.assertIn("const optionalPortsPromise = Promise.all([", text)
        self.assertIn("] = await optionalPortsPromise;", text)
        for factory in (
            "createNativeClientDiagnostics",
            "createNativeUpdateHistory",
            "createNativeSyncStateStore",
            "createNativePowerActions",
            "createNativeFileSpace",
            "createNativeNetworkStatus",
            "createNativeNetworkManagement",
            "createNativeKeyboardLayout",
            "createNativeSystemMetrics",
            "createNativePowerStatus",
        ):
            self.assertIn(f"() => {factory}(window)", text)
            self.assertNotIn(f"await {factory}(window)", text)
        self.assertLess(
            text.index("const optionalPortsPromise = Promise.all(["),
            text.index("const surface = mountSurface("),
        )
        self.assertLess(
            text.index("] = await optionalPortsPromise;"),
            text.index("void updateWatcher.markHealthy()"),
        )

    def test_account_and_sync_capabilities_follow_live_identity_without_boot_snapshot_flags(self):
        native_runtime = NATIVE_RUNTIME.read_text(encoding="utf-8")
        web_runtime = WEB_RUNTIME.read_text(encoding="utf-8")
        native_composition = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        web_composition = WEB_COMPOSITION.read_text(encoding="utf-8")

        for runtime in (native_runtime, web_runtime):
            self.assertIn("identitySession = null", runtime)
            self.assertIn("assertIdentitySessionPort(identitySession)", runtime)
            self.assertIn('identityPort.getSnapshot().state !== "unavailable"', runtime)
            self.assertIn('capabilityIds.push("account.identity", "sync.safe-state")', runtime) if runtime == native_runtime else None
            self.assertNotIn("accountIdentityAvailable = false", runtime)
            self.assertNotIn("syncSafeStateAvailable = false", runtime)

        self.assertIn("identitySession,", native_composition)
        self.assertIn("createWebSurfaceHost(window, { identitySession })", web_composition)
        self.assertNotIn("accountIdentityAvailable: identityAvailable", native_composition)
        self.assertNotIn("syncSafeStateAvailable: identityAvailable", native_composition)
        self.assertNotIn("accountIdentityAvailable: identityAvailable", web_composition)
        self.assertNotIn("syncSafeStateAvailable: identityAvailable", web_composition)
        self.assertNotIn('const identityAvailable = identitySession.getSnapshot().state !== "unavailable";', native_composition)
        self.assertNotIn('const identityAvailable = identitySession.getSnapshot().state !== "unavailable";', web_composition)
        self.assertIn("const identityCredentials = createSameOriginIdentityCredentials(window);", native_composition)
        self.assertIn("const identityCredentials = createSameOriginIdentityCredentials(window);", web_composition)
        self.assertNotIn('"system.release-activation"', native_runtime)
        self.assertNotIn('"system.recovery"', native_runtime)

    def test_web_adapter_remains_independent(self):
        text = WEB_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("createWebSurfaceHost", text)
        self.assertNotIn("system.boot-control", text)
        self.assertNotIn("filesystem.user-space", text)
        self.assertNotIn("system.metrics", text)
        self.assertNotIn("network.status", text)


if __name__ == "__main__":
    unittest.main()
