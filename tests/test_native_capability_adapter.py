from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE_RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_RUNTIME = ROOT / "system" / "adapters" / "web" / "runtime.mjs"


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
        self.assertIn('"profile.content-context"', text)
        self.assertIn('"session.local-lock"', text)
        self.assertIn("bootControlAvailable", text)
        self.assertIn("userFileSpaceAvailable", text)
        self.assertIn("systemMetricsAvailable", text)
        self.assertIn("powerStatusAvailable", text)
        self.assertIn("networkStatusAvailable", text)
        self.assertIn("keyboardLayoutAvailable", text)
        self.assertIn("intelligenceSystemAvailable", text)
        self.assertIn("profileContentContextAvailable", text)
        self.assertIn("localSessionAvailable", text)
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
        self.assertIn("const profileContentContextAvailable = (", text)
        self.assertIn("profileContentContextCapability?.available === true && profileActivationState !== null", text)
        self.assertIn("profileActivationStatePort: profileActivationState", text)
        self.assertIn("localSessionAvailable = localSession !== null", text)
        self.assertIn("bootControlAvailable,", text)
        self.assertIn("userFileSpaceAvailable,", text)
        self.assertIn("systemMetricsAvailable,", text)
        self.assertIn("powerStatusAvailable,", text)
        self.assertIn("networkStatusAvailable,", text)
        self.assertIn("keyboardLayoutAvailable,", text)
        self.assertIn("intelligenceSystemAvailable,", text)
        self.assertIn("profileContentContextAvailable,", text)
        self.assertIn("localSessionAvailable,", text)
        self.assertIn("createNativeSurfaceHost(window, {", text)

    def test_native_composes_intelligence_above_local_ai_without_provider_leakage(self):
        text = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('createLocalAiRuntime', text)
        self.assertIn('createIntelligenceRuntime', text)
        self.assertRegex(text, r"createIntelligenceRuntime\(\{\s*inferencePort:\s*localAi,")
        self.assertIn('getLocale: () => preferenceStore.load()["regional.locale"]', text)
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

    def test_profile_inventory_probe_starts_before_other_native_boot_waits(self):
        source = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertEqual(source.count("createNativeProfileComponentInventory(window)"), 1)
        self.assertLess(
            source.index("const profileComponentInventoryPromise = optionalNativeProbe("),
            source.index("const optionalPortsPromise = Promise.all(["),
        )
        self.assertIn(
            "const profileComponentInventory = await profileComponentInventoryPromise",
            source,
        )
        self.assertLess(
            source.index("const profileComponentInventoryPromise = optionalNativeProbe("),
            source.index("const verifiedAppSemantics = await verifiedAppSemanticsPromise"),
        )
        self.assertIn(
            "?? createSessionProfileComponentInventory()",
            source,
        )

    def test_first_run_device_profile_cannot_block_surface_health(self):
        source = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        boot_probes = source.split(
            "const optionalPortsPromise = Promise.all([", 1
        )[1].split("  ]);", 1)[0]
        self.assertNotIn("createNativeDeviceProfile", boot_probes)
        self.assertEqual(source.count("createNativeDeviceProfile(window)"), 1)
        self.assertIn(
            "const deviceProfilePromise = optionalNativeProbe(",
            source,
        )
        self.assertLess(
            source.index("const deviceProfilePromise = optionalNativeProbe("),
            source.index("const optionalPortsPromise = Promise.all(["),
        )
        self.assertLess(
            source.index("bootScreen.ready();"),
            source.index("const deviceProfile = await deviceProfilePromise;"),
        )
        self.assertLess(
            source.index("const deviceProfile = await deviceProfilePromise;"),
            source.index("firstRun = mountFirstRunExperience(root, {"),
        )
        self.assertIn("      deviceProfile,", source)

    def test_optional_profile_taxonomy_overlaps_boot_without_unverified_fallback(self):
        source = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertEqual(source.count("loadBundledProfileTaxonomy({"), 1)
        self.assertIn(
            "const bundledProfileTaxonomyPromise = bundledProfilePacksPromise.then((packs)",
            source,
        )
        self.assertIn("packs === null", source)
        self.assertLess(
            source.index("const bundledProfileTaxonomyPromise ="),
            source.index("const optionalPortsPromise = Promise.all(["),
        )
        self.assertIn("const taxonomy = await bundledProfileTaxonomyPromise;", source)
        self.assertIn("if (taxonomy !== null)", source)
        self.assertIn("createProfileTaxonomyView({", source)
        self.assertIn("profileTaxonomy = null;", source)

    def test_native_account_refresh_cannot_gate_surface_cold_health(self):
        text = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        eager_refresh = (
            "const identitySession = createWebIdentitySession(window);\n"
            "  await identitySession.refresh();"
        )
        self.assertNotIn(eager_refresh, text)
        surface_mount = text.index("const surface = mountSurface(")
        pre_surface = text[:surface_mount]
        self.assertNotIn("await accountLifecycle.refresh();", pre_surface)
        self.assertIn(
            "const resumeAccountConnectivity = async () => {\n"
            "    await identitySession.refresh();\n"
            "    await identityActions.refresh();\n"
            "    await accountLifecycle.refresh();\n"
            "    await accountSync.refresh();\n"
            "  };",
            text,
        )
        health = text.index("void updateWatcher.markHealthy();")
        deferred_refresh = text.index(
            "void resumeAccountConnectivity().catch((error) => {",
            health,
        )
        self.assertLess(health, deferred_refresh)
        self.assertIn(
            "OrdaX account connectivity refresh remains pending after Surface health",
            text,
        )
        self.assertIn('window.addEventListener("online", onOnline, { passive: true });', text)

    def test_native_account_and_sync_capabilities_follow_live_identity_session(self):
        runtime = NATIVE_RUNTIME.read_text(encoding="utf-8")
        composition = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("readAccountIdentityAvailable = () => false", runtime)
        self.assertIn("readSyncSafeStateAvailable = () => false", runtime)
        account = (ROOT / "system" / "services" / "account" / "runtime.mjs").read_text(encoding="utf-8")
        self.assertIn("deriveAccountSurfaceCapabilityIds", runtime)
        self.assertIn("accountIdentityAvailable: readAccountIdentityAvailable()", runtime)
        self.assertIn("syncSafeStateAvailable: readSyncSafeStateAvailable()", runtime)
        self.assertIn("capabilityIds.push(...accountCapabilities)", runtime)
        self.assertNotIn('capabilityIds.push("account.identity")', runtime)
        self.assertNotIn('capabilityIds.push("sync.safe-state")', runtime)
        self.assertNotIn('if (syncSafeStateAvailable && !accountIdentityAvailable)', runtime)
        self.assertIn("export function deriveAccountSurfaceCapabilityIds", account)
        self.assertIn('if (syncSafeStateAvailable && !accountIdentityAvailable)', account)
        self.assertIn('throw new TypeError("sync.safe-state requires account.identity")', account)
        self.assertIn("refresh: notify", runtime)
        self.assertIn(
            'const readIdentityAvailable = () => identitySession.getSnapshot().state !== "unavailable";',
            composition,
        )
        self.assertIn("readAccountIdentityAvailable: readIdentityAvailable", composition)
        self.assertIn("readSyncSafeStateAvailable: readIdentityAvailable", composition)
        self.assertIn("identitySession.subscribe(() => host.refresh())", composition)
        self.assertIn("const identityCredentials = createSameOriginIdentityCredentials(window);", composition)
        self.assertNotIn("const identityAvailable =", composition)
        self.assertNotIn("identityAvailable ? createSameOriginIdentityCredentials", composition)
        self.assertIn("window.removeEventListener(\"online\", onOnline);", composition)
        self.assertIn("unsubscribeHostIdentity();", composition)
        self.assertNotIn('"system.release-activation"', runtime)
        self.assertNotIn('"system.recovery"', runtime)

    def test_web_adapter_remains_independent(self):
        text = WEB_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("createWebSurfaceHost", text)
        self.assertNotIn("system.boot-control", text)
        self.assertNotIn("filesystem.user-space", text)
        self.assertNotIn("system.metrics", text)
        self.assertNotIn("network.status", text)


if __name__ == "__main__":
    unittest.main()
