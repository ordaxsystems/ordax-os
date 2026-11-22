from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "system/composition/native/main.mjs"



SYSTEM_UI = ROOT / "system/surface/ui/system-overview-controls.mjs"
CLIENT_ACTIONS = ROOT / "system/services/intelligence/client-actions.mjs"
LIVE_VERIFIED_APP_SEMANTICS = ROOT / "system/services/intelligence/live-verified-app-semantics.mjs"


class IntelligenceProductConsumerTests(unittest.TestCase):
    def test_desktop_runtime_includes_same_commit_intelligence_module(self):
        # The Windows Desktop packages the OS-owned system tree, not an external Intelligence checkout.
        manifest = json.loads((ROOT / "desktop/package.json").read_text(encoding="utf-8"))
        entries = [item for item in manifest["build"]["extraResources"]
                   if item.get("to") == "runtime-template/system"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["from"], "../system")
        self.assertIn("**/*", entries[0]["filter"])
        self.assertFalse(any(item.startswith(("!intelligence/", "!services/intelligence/",
                                              "!services/local-ai/"))
                             for item in entries[0]["filter"]))
        for path in (
            "intelligence/src/index.mjs",
            "intelligence/src/intelligence/runtime.mjs",
            "intelligence/src/local-ai/runtime.mjs",
            "services/intelligence/runtime.mjs",
            "services/intelligence/model-router.mjs",
            "services/local-ai/runtime.mjs",
            "services/local-ai/completion-stream.mjs",
            "services/local-ai/model-compatibility.mjs",
        ):
            self.assertTrue((ROOT / "system" / path).is_file(), path)
        for path in (
            "services/intelligence/runtime.mjs",
            "services/intelligence/model-router.mjs",
            "services/local-ai/runtime.mjs",
            "services/local-ai/completion-stream.mjs",
            "services/local-ai/model-compatibility.mjs",
        ):
            source = (ROOT / "system" / path).read_text(encoding="utf-8")
            self.assertIn("../../intelligence/src/index.mjs", source, path)

    def test_native_composes_intelligence_once_and_injects_consumers(self):
        text = NATIVE.read_text(encoding="utf-8")
        self.assertEqual(text.count("createLocalAiRuntime({"), 1)
        # The unique Intelligence consumer may include additional canonical
        # options such as locale without adding another model/provider.
        import re
        consumers = re.findall(
            r"createIntelligenceRuntime\(\{\s*inferencePort:\s*localAi,", text
        )
        self.assertEqual(len(consumers), 1)
        self.assertIn('getLocale: () => preferenceStore.load()["regional.locale"]', text)
        self.assertIn("createLocalAiProbeSupervisor", text)
        self.assertIn("localAiProbeSupervisor.start();", text)
        self.assertIn("localAiProbeSupervisor.dispose();", text)
        self.assertNotIn("void localAi.probe();", text)
        self.assertIn("intelligenceSystemAvailable = true", text)
        self.assertIn("componentManager.setCurrentHealth(", text)
        self.assertIn('"local-ai-service"', text)
        self.assertIn('"ordax-intelligence"', text)
        self.assertIn("intelligence,", text)
        self.assertIn("createNativeVerifiedComponentPackageSource", text)
        self.assertIn("loadVerifiedFirstPartyApplicationSemantics", text)
        # Composition now has exactly ONE live verified semantic owner.
        # Awareness, Actions and routing are built behind its stable ports;
        # asserting the retired boot-time flatMap in Native would require
        # restoring a second stale registry rather than checking the contract.
        live = LIVE_VERIFIED_APP_SEMANTICS.read_text(encoding="utf-8")
        self.assertEqual(text.count("const liveAppSemantics = createLiveVerifiedApplicationSemantics({"), 1)
        self.assertIn("const appAwareness = liveAppSemantics.awarenessPort;", text)
        self.assertIn("const appActionCapabilities = liveAppSemantics.actionRegistryPort;", text)
        self.assertIn("const appSemanticRouter = liveAppSemantics.semanticRouterPort;", text)
        self.assertNotIn("createApplicationActionCapabilityRegistry({", text)
        self.assertNotIn("createApplicationSemanticRouter({", text)
        self.assertIn("createApplicationContextIntelligence", text)
        self.assertIn("actionCapabilityRegistryPort: appActionCapabilities", text)
        self.assertIn("listBundledFirstPartyIntelligenceManifests", text)
        self.assertIn("semanticRouterPort: appSemanticRouter", text)
        self.assertIn("const gate = createCurrentVerifiedActionGate({", live)
        self.assertIn("const awareness = createApplicationIntelligenceAwareness({", live)
        self.assertIn("const actions = createApplicationActionCapabilityRegistry({", live)
        self.assertIn("verifiedSemantics.flatMap(entry =>", live)
        self.assertIn("entry.actionManifest?.capabilities ?? []", live)
        self.assertIn("const router = createApplicationSemanticRouter({", live)
        self.assertIn("isCurrentBatch: gate.isCurrentBatch", live)
        self.assertIn("const verifiedAppSemanticsPromise = optionalNativeProbe(", text)
        self.assertIn("const appAwareIntelligence = createApplicationContextIntelligence({", text)
        self.assertIn("intelligencePort: appAwareIntelligence", text)
        self.assertIn(": appAwareIntelligence;", text)


    def test_optional_aura_probe_does_not_compete_with_shell_boot_health(self):
        source = NATIVE.read_text(encoding="utf-8")
        self.assertEqual(source.count("localAiProbeSupervisor.start();"), 1)
        self.assertEqual(source.count("createLocalAiProbeSupervisor({"), 1)
        self.assertLess(
            source.index('const localAiProbeSupervisor = createLocalAiProbeSupervisor({'),
            source.index('const surface = mountSurface('),
        )
        self.assertLess(
            source.index('bootScreen.ready();'),
            source.index('localAiProbeSupervisor.start();'),
        )
        self.assertLess(
            source.index('void updateWatcher.markHealthy();'),
            source.index('localAiProbeSupervisor.start();'),
        )
        self.assertLess(
            source.index('const surfaceHeartbeat = createNativeSurfaceHeartbeat(window);'),
            source.index('localAiProbeSupervisor.start();'),
        )
        self.assertLess(
            source.index('localAiProbeSupervisor.start();'),
            source.index('void resumeAccountConnectivity().catch('),
        )
        self.assertIn('localAiProbeSupervisor.dispose();', source)

    def test_system_explanation_is_consultative_and_provider_neutral(self):
        ui = SYSTEM_UI.read_text(encoding="utf-8")
        actions = CLIENT_ACTIONS.read_text(encoding="utf-8")
        self.assertIn("assertIntelligencePort", ui)
        self.assertIn("explainSystemStateWithIntelligence", ui)
        self.assertIn("systemIntelligenceExplain", ui)
        self.assertIn('t("system.intelligence.answer.provenance")', ui)
        self.assertIn('"ordax-system-local-snapshot"', actions)
        self.assertIn('intent: "diagnose"', actions)
        self.assertNotIn("services/local-ai", ui)
        self.assertNotIn("contracts/local-ai", ui)
        self.assertNotIn("llama", ui.lower())
        self.assertNotIn("qwen", ui.lower())


if __name__ == "__main__":
    unittest.main()
