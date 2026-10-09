import {
  createNativeClientDiagnostics,
  renderedSourceSha,
} from "../../adapters/native/client-diagnostics.mjs";
import { createNativeBrowserSession } from "../../adapters/native/browser-session.mjs";
import { createNativeComponentStateStore } from "../../adapters/native/component-state.mjs";
import { createNativeBrowserFavoritesStore } from "../../adapters/native/browser-favorites.mjs";
import { createNativeBrowserHistoryStore } from "../../adapters/native/browser-history.mjs";
import { createNativeDiagnosticJournalStore } from "../../adapters/native/diagnostic-journal-store.mjs";
import { createNativeFileSpace } from "../../adapters/native/file-space.mjs";
import { createNativePersonalOrdaxFileActions } from "../../adapters/native/personal-ordax-file-actions.mjs";
import { createNativePersonalActivityExport } from "../../adapters/native/personal-activity-export.mjs";
import { createNativeRecentFilesStore } from "../../adapters/native/recent-files.mjs";
import { createNativeProjectStore } from "../../adapters/native/projects.mjs";
import { createNativeProjectStateTransport } from "../../adapters/native/project-state.mjs";
import { createNativeProjectCloudLinkStore } from "../../adapters/native/project-cloud-links.mjs";
import { createNativeProjectWebReferenceStore } from "../../adapters/native/project-web-references.mjs";
import { createNativeNetworkManagement } from "../../adapters/native/network-management.mjs";
import { createNativeKeyboardLayout } from "../../adapters/native/keyboard-layout.mjs";
import { createNativeNotificationStore } from "../../adapters/native/notifications.mjs";
import { createNativeNetworkStatus } from "../../adapters/native/network-status.mjs";
import { createNativePowerActions } from "../../adapters/native/power-actions.mjs";
import { createNativePowerStatus } from "../../adapters/native/power-status.mjs";
import { createNativePreferenceStore } from "../../adapters/native/preferences.mjs";
import { createNativeFirstRunStateStore } from "../../adapters/native/first-run-state.mjs";
import { createNativeLocalSession } from "../../adapters/native/local-session.mjs";
import { createNativeMemoryStore } from "../../adapters/native/memory.mjs";
import { createNativeProfileComponentInventory } from "../../adapters/native/profile-component-inventory.mjs";
import { createNativeProfileActivationState } from "../../adapters/native/profile-activation-state.mjs";
import { createNativeProfileContentContext } from "../../adapters/native/profile-content-context.mjs";
import { readNativeProfileContentContextCapability } from "../../adapters/native/profile-content-context-capability.mjs";
import { createNativeSpaceSelectionStore } from "../../adapters/native/space-selection.mjs";
import { createSessionProfileComponentInventory } from "../../services/profile-packs/inventory.mjs";
import { createNativeSurfaceHost } from "../../adapters/native/runtime.mjs";
import { createNativeSystemMetrics } from "../../adapters/native/system-metrics.mjs";
import { readNativeHardwareInventory } from "../../adapters/native/hardware-inventory.mjs";
import { createNativeRecoveryStatus } from "../../adapters/native/recovery-status.mjs";
import { createNativeUpdateHistory } from "../../adapters/native/update-history.mjs";
import { createNativeUpdateWatcher } from "../../adapters/native/update-runtime.mjs";
import { createNativeWorkspaceStore } from "../../adapters/native/workspace.mjs";
import { createNativeVerifiedComponentPackageSource } from "../../adapters/native/verified-component-package-source.mjs";
import { createNativeVerifiedComponentArtifactIdentity } from "../../adapters/native/verified-component-artifact-identity.mjs";
import { createNativeAppLifecycleDelegate } from "../../adapters/native/app-lifecycle-delegate.mjs";
import { createNativeSyncStateStore } from "../../adapters/native/sync-state.mjs";
import { createNativeSyncCheckpointStore } from "../../adapters/native/sync-checkpoint.mjs";
import { createNativeSurfaceHeartbeat } from "../../adapters/native/surface-heartbeat.mjs";
import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createSameOriginIdentityCredentials } from "../../adapters/web/identity-credentials.mjs";
import { createSameOriginAccountLifecycle } from "../../adapters/web/account-lifecycle.mjs";
import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { createWebSpacesCatalog } from "../../adapters/web/spaces.mjs";
import { createWebSyncTransport } from "../../adapters/web/sync-transport.mjs";
import { validateAccountRuntime } from "../../services/account/runtime.mjs";
import { createAppActivationChannel } from "../../services/apps/activation.mjs";
import { createAppLifecycleRequestService } from "../../services/apps/store-lifecycle-request-service.mjs";
import { createUnavailableAppStoreCatalogPort } from "../../contracts/app-store.mjs";
import { listSystemComponents } from "../../apps/component-catalog.mjs";
import { listFirstPartyApps } from "../../apps/catalog.mjs";
import { listBundledFirstPartyIntelligenceManifests } from "../../apps/intelligence-catalog.mjs";
import { createComponentManager } from "../../services/components/manager.mjs";
import { loadOptionalComponentRuntime } from "../../services/components/runtime-loader.mjs";
import { createRecentFilesRuntime } from "../../services/files/recent-files.mjs";
import { createProjectCloudLinksRuntime } from "../../services/projects/cloud-links.mjs";
import { createProjectCloudLinksReader } from "../../services/projects/cloud-links-reader.mjs";
import { createProjectWebReferenceRuntime } from "../../services/projects/web-references.mjs";
import { createProjectContinuityFileSpace } from "../../services/files/project-continuity-file-space.mjs";
import { createPersonalActionCatalog } from "../../services/personal-ordax/action-catalog.mjs";
import { createNotificationsRuntime } from "../../services/notifications/runtime.mjs";
import { createUpdateNotificationBridge } from "../../services/notifications/update-bridge.mjs";
import { createDiagnosticJournalRuntime } from "../../services/diagnostics/runtime.mjs";
import { createLocalAiRuntime } from "../../services/local-ai/runtime.mjs";
import { createLocalAiProbeSupervisor } from "../../services/local-ai/probe-supervisor.mjs";
import { LOCAL_AI_NATIVE_ENDPOINT } from "../../contracts/local-ai.mjs";
import { createIntelligenceRuntime } from "../../services/intelligence/runtime.mjs";
import { createApplicationIntelligenceAwareness } from "../../services/intelligence/application-awareness.mjs";
import { createApplicationContextIntelligence } from "../../services/intelligence/application-context.mjs";
import { createApplicationActionCapabilityRegistry } from "../../services/intelligence/application-action-capabilities.mjs";
import { createApplicationSemanticRouter } from "../../services/intelligence/application-semantic-router.mjs";
import {
  EXTERNAL_FIRST_PARTY_COMPONENT_IDS,
  EXTERNAL_FIRST_PARTY_OWNER,
} from "../../services/apps/external-first-party-policy.mjs";
import {
  loadVerifiedFirstPartyApplicationSemantics,
  overlayVerifiedFirstPartyApplications,
} from "../../services/intelligence/verified-app-semantics.mjs";
import { createSelectedSpaceProfileContentIntelligence } from "../../services/intelligence/profile-content.mjs";
import { createMemoryRuntime } from "../../services/memory/runtime.mjs";
import { createMemoryMutationPort } from "../../services/memory/mutation-port.mjs";
import { createPreferenceBoundMemoryCaptureRuntime } from "../../services/memory/capture.mjs";
import { createAssistantAutoCaptureRuntime } from "../../services/memory/assistant-auto-capture.mjs";
import { createIdentityBoundMemoryIntelligence } from "../../services/intelligence/authorized-memory.mjs";
import { createMemoryReviewSession } from "../../services/memory/review-session.mjs";
import { createMemoryReviewViewModel } from "../../services/memory/review-view-model.mjs";
import { createProfileProvisioningRuntime } from "../../services/profile-packs/provisioning.mjs";
import { createSpaceSelectionRuntime } from "../../services/spaces/selection.mjs";
import { loadBundledProfilePacks } from "../../services/profile-packs/bundled-source.mjs";
import { loadBundledProfileTaxonomy } from "../../services/profile-packs/taxonomy-source.mjs";
import { createProfilePackCatalogFromPacks } from "../../services/profile-packs/catalog.mjs";
import { createProfileTaxonomyView } from "../../services/profile-packs/taxonomy.mjs";
import { resolveProfilePackRestore } from "../../services/profile-packs/restore.mjs";
import { createLocalProfileDistributions } from "../../profile-packs/distributions.mjs";
import { createUpdateDiagnosticRecorder } from "../../services/diagnostics/update-recorder.mjs";
import { createPreferenceSyncRuntime } from "../../services/sync/preference-runtime.mjs";
import { createSyncStateNamespaceRegistry } from "../../services/sync/state-store-registry.mjs";
import { createWorkspaceMetadataBridge } from "../../services/sync/workspace-metadata.mjs";
import { createMemoryConflictReviewRuntime } from "../../services/sync/memory-conflict-review.mjs";
import { seedMissingRegionalPreferencesFromFirstRun } from "../../services/state/first-run.mjs";
import { translateSurfaceMessage } from "../../services/i18n/surface.mjs";
import { createNativeDiagnosticReviewComposition } from "./diagnostics.mjs";
import { createNativeAccountMemoryFoundation } from "./account-memory-foundation.mjs";
import { createNativeAccountSyncRuntime } from "./account-sync.mjs";
import { createNativeProjectAuthorityComposition } from "./projects-authority.mjs";
import { createNativePersonalOrdaxComposition } from "./personal-ordax.mjs";
import { createNativeStoreCatalogComposition } from "./store-catalog.mjs";
import { mountAccountOverviewControls } from "../../surface/ui/account-overview-controls.mjs";
import { mountSpaceSwitcherControls } from "../../surface/ui/space-switcher-controls.mjs";
import { mountFileSpaceControls } from "../../surface/ui/file-space-controls.mjs";
import { mountNetworkQuickPanel } from "../../surface/ui/network-quick-panel.mjs";
import { mountNetworkTrayControls } from "../../surface/ui/network-tray-controls.mjs";
import { mountNotificationCenterControls } from "../../surface/ui/notification-center-controls.mjs";
import { mountBatteryQuickPanel } from "../../surface/ui/battery-quick-panel.mjs";
import { mountBatteryTrayControls } from "../../surface/ui/battery-tray-controls.mjs";
import { mountHomeContinuation } from "../../surface/ui/home-continuation.mjs";
import { mountHomePending } from "../../surface/ui/home-pending.mjs";
import { mountPowerControls } from "../../surface/ui/power-controls.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";
import { createSurfaceBootScreen } from "../../surface/ui/boot-screen.mjs";
import { mountFirstRunExperience } from "../../surface/ui/first-run.mjs";
import { mountLocalSessionLock } from "../../surface/ui/local-session-lock.mjs";
import { mountSettingsOverviewControls } from "../../surface/ui/settings-overview-controls.mjs";
import { mountStoreOverviewControls } from "../../surface/ui/store-overview-controls.mjs";
import { mountSystemOverviewControls } from "../../surface/ui/system-overview-controls.mjs";
import { mountSystemTrayQuickPanels } from "../../surface/ui/system-tray-quick-panels.mjs";
import { mountUpdateControls } from "../../surface/ui/update-controls.mjs";

async function optionalNativeProbe(label, factory) {
  try {
    return await factory();
  } catch (error) {
    console.warn(label, error);
    return null;
  }
}

function blockedAccountMemoryMutations() {
  const fail = async () => {
    throw new Error("Native Account Memory protected provider is unavailable");
  };
  return Object.freeze({
    remember: fail,
    forget: fail,
    recover: fail,
  });
}

const bootScreen = createSurfaceBootScreen(document);
let bootLocale = "pt-BR";
const bootText = (messageId) => translateSurfaceMessage(bootLocale, messageId);

async function start() {
  const root = document.querySelector("#ordax-root");
  if (!root) {
    throw new Error("OrdaX composition root is missing #ordax-root");
  }

  const browserSession = createNativeBrowserSession(window);
  const verifiedComponentPackageSource = createNativeVerifiedComponentPackageSource(window);
  const verifiedComponentFetch = typeof window.fetch === "function"
    ? window.fetch.bind(window)
    : async () => {
        throw new Error("Native loopback fetch is unavailable");
      };
  const verifiedComponentArtifactIdentity = createNativeVerifiedComponentArtifactIdentity(window);
  const storeCatalogCompositionPromise = optionalNativeProbe(
    "OrdaX Native Store catalog composition unavailable",
    () => createNativeStoreCatalogComposition({
      windowRef: window,
      componentSource: verifiedComponentPackageSource,
      fetchImpl: verifiedComponentFetch,
    }),
  );
  const verifiedAppSemanticsPromise = optionalNativeProbe(
    "OrdaX verified App Intelligence semantics unavailable",
    () => loadVerifiedFirstPartyApplicationSemantics({
      appIds: EXTERNAL_FIRST_PARTY_COMPONENT_IDS,
      source: verifiedComponentPackageSource,
      fetchImpl: verifiedComponentFetch,
    }),
  );
  const preferenceStorePromise = createNativePreferenceStore(window);
  const firstRunStateStorePromise = createNativeFirstRunStateStore(window);
  const localSessionPromise = optionalNativeProbe(
    "OrdaX native local session unavailable",
    () => createNativeLocalSession(window),
  );
  const bundledProfilePacksPromise = optionalNativeProbe(
    "OrdaX bundled Profile manifests unavailable",
    () => loadBundledProfilePacks({
      fetchImpl: typeof window.fetch === "function" ? window.fetch.bind(window) : null,
    }),
  );
  const optionalPortsPromise = Promise.all([
    optionalNativeProbe(
      "OrdaX native client diagnostics unavailable",
      () => createNativeClientDiagnostics(window),
    ),
    optionalNativeProbe(
      "OrdaX native diagnostic journal persistence unavailable",
      () => createNativeDiagnosticJournalStore(window),
    ),
    optionalNativeProbe(
      "OrdaX native Intelligence memory persistence unavailable",
      () => createNativeMemoryStore(window),
    ),
    optionalNativeProbe(
      "OrdaX native update history unavailable",
      () => createNativeUpdateHistory(window),
    ),
    optionalNativeProbe(
      "OrdaX native sync state persistence unavailable",
      () => createNativeSyncStateStore(window),
    ),
    optionalNativeProbe(
      "OrdaX native sync checkpoint persistence unavailable",
      () => createNativeSyncCheckpointStore(window),
    ),
    optionalNativeProbe(
      "OrdaX native component state persistence unavailable",
      () => createNativeComponentStateStore(window),
    ),
    optionalNativeProbe(
      "OrdaX native Profile activation state unavailable",
      () => createNativeProfileActivationState(window),
    ),
    optionalNativeProbe(
      "OrdaX Profile content context capability unavailable",
      () => readNativeProfileContentContextCapability(window),
    ),
    optionalNativeProbe(
      "OrdaX native power actions unavailable",
      () => createNativePowerActions(window),
    ),
    optionalNativeProbe(
      "OrdaX native user file-space unavailable",
      () => createNativeFileSpace(window),
    ),
    optionalNativeProbe(
      "OrdaX native network status unavailable",
      () => createNativeNetworkStatus(window),
    ),
    optionalNativeProbe(
      "OrdaX native network management unavailable",
      () => createNativeNetworkManagement(window),
    ),
    optionalNativeProbe(
      "OrdaX native keyboard layout unavailable",
      () => createNativeKeyboardLayout(window),
    ),
    optionalNativeProbe(
      "OrdaX native system metrics unavailable",
      () => createNativeSystemMetrics(window),
    ),
    optionalNativeProbe(
      "OrdaX native recovery status unavailable",
      () => createNativeRecoveryStatus(window),
    ),
    optionalNativeProbe(
      "OrdaX native power status unavailable",
      () => createNativePowerStatus(window),
    ),
  ]);

  const [preferenceStore, firstRunStateStore, localSession, bundledProfilePacks] = await Promise.all([
    preferenceStorePromise,
    firstRunStateStorePromise,
    localSessionPromise,
    bundledProfilePacksPromise,
  ]);
  const regionalRecovery = seedMissingRegionalPreferencesFromFirstRun(
    preferenceStore.load(),
    firstRunStateStore.load(),
  );
  if (regionalRecovery.changed) {
    preferenceStore.save(regionalRecovery.snapshot);
  }
  bootLocale = regionalRecovery.snapshot["regional.locale"] ?? "pt-BR";
  bootScreen.setStage(bootText("surface.boot.loadingSurface"));
  const [
    clientDiagnostics,
    diagnosticJournalStore,
    memoryStore,
    updateHistory,
    syncStateStore,
    syncCheckpointStore,
    componentStateStore,
    profileActivationState,
    profileContentContextCapability,
    powerActions,
    fileSpace,
    networkStatus,
    networkManagement,
    keyboardLayout,
    systemMetrics,
    recoveryStatus,
    powerStatus,
  ] = await optionalPortsPromise;

  const componentManager = createComponentManager({
    manifests: listSystemComponents(),
    store: componentStateStore,
  });
  const localAiFetch = typeof window.fetch === "function"
    ? window.fetch.bind(window)
    : async () => {
        throw new Error("Native loopback fetch is unavailable");
      };
  const localAi = createLocalAiRuntime({
    fetchImpl: localAiFetch,
    endpoint: LOCAL_AI_NATIVE_ENDPOINT,
  });
  const intelligence = createIntelligenceRuntime({ inferencePort: localAi });
  const memory = memoryStore === null
    ? null
    : createMemoryRuntime({ store: memoryStore });
  const updateLocalAiHealth = (snapshot) => {
    componentManager.setCurrentHealth(
      "local-ai-service",
      snapshot.state === "ready" || snapshot.state === "busy" ? "healthy" : "failed",
    );
  };
  const updateIntelligenceHealth = (snapshot) => {
    componentManager.setCurrentHealth(
      "ordax-intelligence",
      snapshot.state === "ready" || snapshot.state === "busy" ? "healthy" : "failed",
    );
  };
  const unsubscribeLocalAiHealth = localAi.subscribe(updateLocalAiHealth);
  const unsubscribeIntelligenceHealth = intelligence.subscribe(updateIntelligenceHealth);
  updateLocalAiHealth(localAi.getSnapshot());
  updateIntelligenceHealth(intelligence.getSnapshot());
  const localAiProbeSupervisor = createLocalAiProbeSupervisor({ localPort: localAi });
  localAiProbeSupervisor.start();

  const localWorkspaceStore = createNativeWorkspaceStore(window);
  const recentFiles = fileSpace === null ? null : createRecentFilesRuntime({
    store: createNativeRecentFilesStore(window),
  });
  const projectAuthority = fileSpace === null
    ? null
    : await optionalNativeProbe(
        "OrdaX Native Project authority unavailable",
        () => createNativeProjectAuthorityComposition({
          legacyStore: createNativeProjectStore(window),
          nativeTransport: createNativeProjectStateTransport(window),
        }),
      );
  const projects = projectAuthority?.reader ?? null;
  const projectMutations = projectAuthority?.mutations ?? null;
  const projectCloudLinks = projects === null ? null : createProjectCloudLinksRuntime({
    projects,
    store: createNativeProjectCloudLinkStore(window),
  });
  const projectCloudLinksReader = projectCloudLinks === null
    ? null
    : createProjectCloudLinksReader(projectCloudLinks);
  const projectReferences = projects === null ? null : createProjectWebReferenceRuntime({
    store: createNativeProjectWebReferenceStore(window),
    projects,
  });
  const workspaceMetadata = createWorkspaceMetadataBridge(localWorkspaceStore);
  const workspaceStore = workspaceMetadata.store;
  const identitySession = createWebIdentitySession(window);
  const syncStateRegistry = syncStateStore === null
    ? null
    : createSyncStateNamespaceRegistry(syncStateStore, { legacyNamespace: "appearance" });

  let accountMemoryFoundation = null;
  let protectedAccountMutations = null;
  if (memory !== null) {
    try {
      let memoryCoordinationOrdinal = 0;
      accountMemoryFoundation = createNativeAccountMemoryFoundation({
        windowRef: window,
        identitySession,
        memoryPort: memory,
        syncStateRegistry,
        createIdempotencyKey(kind = "state") {
          memoryCoordinationOrdinal += 1;
          const uuid = window.crypto?.randomUUID?.();
          return `memory:${kind}:${uuid ? uuid.replaceAll("-", "") : `${Date.now().toString(36)}:${memoryCoordinationOrdinal}`}`;
        },
        onStageError(error, context) {
          console.warn(
            `OrdaX Account Memory local coordination degraded: ${context?.kind ?? "unknown"}`,
            error,
          );
        },
      });
      protectedAccountMutations = accountMemoryFoundation.protectedMutations;
    } catch (error) {
      console.warn("OrdaX Account Memory protected provider unavailable", error);
      protectedAccountMutations = blockedAccountMemoryMutations();
    }
  }

  const memoryMutations = memory === null
    ? null
    : createMemoryMutationPort({
        memoryPort: memory,
        protectedAccountMutations,
      });

  const recoverProtectedAccountMemory = async ({ refreshAuthorization = false } = {}) => {
    if (
      accountMemoryFoundation?.accountMemory == null
      || typeof accountMemoryFoundation.protectedMutations?.recover !== "function"
    ) {
      return null;
    }
    if (refreshAuthorization) {
      await accountMemoryFoundation.accountMemory.refreshAuthorization();
    } else {
      await accountMemoryFoundation.settled();
    }
    return accountMemoryFoundation.protectedMutations.recover();
  };
  const unsubscribeAccountMemoryRecovery = accountMemoryFoundation?.accountMemory == null
    ? () => {}
    : identitySession.subscribe((snapshot) => {
        if (snapshot.state !== "signed-in") return;
        void recoverProtectedAccountMemory().catch((error) => {
          console.warn("OrdaX Account Memory crash recovery remains pending", error);
        });
      });

  const memoryReviewSession = memory === null
    ? null
    : createMemoryReviewSession({
        memoryPort: memory,
        mutationPort: memoryMutations,
        identitySessionPort: identitySession,
      });
  const memoryReview = memoryReviewSession === null
    ? null
    : createMemoryReviewViewModel(memoryReviewSession);
  const memoryConflictReview = accountMemoryFoundation?.memorySync == null
    ? null
    : createMemoryConflictReviewRuntime(accountMemoryFoundation.memorySync);
  const identityCredentials = createSameOriginIdentityCredentials(window);
  const accountLifecycle = createSameOriginAccountLifecycle(window, identitySession);
  const identityActions = createWebIdentityActions(window, identitySession, {
    registrationPolicy: () => identityCredentials.registrationPolicy(),
  });
  await identityActions.refresh();
  const spaces = createWebSpacesCatalog(window);
  const spaceSelection = createSpaceSelectionRuntime({
    identitySession,
    spaces,
    store: createNativeSpaceSelectionStore(window),
  });
  const verifiedAppSemantics = await verifiedAppSemanticsPromise ?? [];
  const firstPartyApplications = overlayVerifiedFirstPartyApplications(
    listFirstPartyApps(),
    verifiedAppSemantics,
  );
  const semanticManifestsByAppId = new Map(
    listBundledFirstPartyIntelligenceManifests().map(
      (manifest) => [manifest.appId, manifest],
    ),
  );
  for (const entry of verifiedAppSemantics) {
    semanticManifestsByAppId.set(entry.intelligenceManifest.appId, entry.intelligenceManifest);
  }
  const firstPartyIntelligenceManifests = Object.freeze(
    [...semanticManifestsByAppId.values()],
  );
  const appAwareness = createApplicationIntelligenceAwareness({
    firstPartyApplications,
    firstPartyIntelligenceManifests,
  });
  const verifiedActionCapabilities = verifiedAppSemantics.flatMap(
    (entry) => entry.actionManifest?.capabilities ?? [],
  );
  const appActionCapabilities = verifiedActionCapabilities.length === 0
    ? null
    : createApplicationActionCapabilityRegistry({
        awareness: appAwareness,
        capabilities: verifiedActionCapabilities,
      });
  const appSemanticRouter = createApplicationSemanticRouter({
    awareness: appAwareness,
    manifests: firstPartyIntelligenceManifests,
  });
  const appAwareIntelligence = createApplicationContextIntelligence({
    intelligencePort: intelligence,
    awarenessPort: appAwareness,
    actionCapabilityRegistryPort: appActionCapabilities,
    semanticRouterPort: appSemanticRouter,
  });
  const consumerIntelligence = (
    profileContentContextCapability?.available === true && profileActivationState !== null
  )
    ? createSelectedSpaceProfileContentIntelligence({
        intelligencePort: appAwareIntelligence,
        profileContentContextPort: createNativeProfileContentContext(window),
        spaceSelectionPort: spaceSelection,
        identitySessionPort: identitySession,
        spacesPort: spaces,
        profileActivationStatePort: profileActivationState,
      })
    : appAwareIntelligence;
  const selectedSpaceIntelligence = memory === null
    ? consumerIntelligence
    : createIdentityBoundMemoryIntelligence({
        intelligencePort: consumerIntelligence,
        memoryPort: memory,
        identitySessionPort: identitySession,
        spaceSelectionPort: spaceSelection,
      });
  const personalOrdaxFileActions = fileSpace === null
    ? null
    : await optionalNativeProbe(
        "OrdaX Personal Native file actions unavailable",
        () => createNativePersonalOrdaxFileActions({
          windowRef: window,
          fileSpace,
        }),
      );
  const personalOrdaxActionCatalog = createPersonalActionCatalog({
    registrations: personalOrdaxFileActions?.actionRegistrations ?? [],
  });
  const personalActivityExport = fileSpace === null
    ? null
    : createNativePersonalActivityExport(fileSpace);
  const personalOrdax = await optionalNativeProbe(
    "OrdaX Personal runtime unavailable",
    () => createNativePersonalOrdaxComposition({
      windowRef: window,
      identitySession,
      spaceSelection,
      projects,
      intelligence: selectedSpaceIntelligence,
      toolResolver: personalOrdaxFileActions?.toolResolver ?? (() => null),
      adapterResolver: personalOrdaxFileActions?.adapterResolver ?? (() => null),
      actionCatalog: personalOrdaxActionCatalog,
      applicationActionCapabilityRegistry: appActionCapabilities,
      applicationSemanticRouter: appSemanticRouter,
      resolveVerifiedApplicationSemantics: async (appId) => {
        const entries = await loadVerifiedFirstPartyApplicationSemantics({
          appIds: [appId],
          source: verifiedComponentPackageSource,
          fetchImpl: verifiedComponentFetch,
        });
        return entries[0] ?? null;
      },
      verifiedComponentPackageSource,
      verifiedComponentFetch,
      applicationActionProviderArtifactIdentity: verifiedComponentArtifactIdentity,
      expectedApplicationActionProviderOwner: EXTERNAL_FIRST_PARTY_OWNER,
    }),
  );
  const profileComponentInventory = await optionalNativeProbe(
    "OrdaX Profile component inventory unavailable; using empty session inventory",
    () => createNativeProfileComponentInventory(window),
  ) ?? createSessionProfileComponentInventory();
  let profileDistributions = [];
  let profileTaxonomy = null;
  if (bundledProfilePacks !== null) {
    try {
      profileDistributions = createLocalProfileDistributions(bundledProfilePacks.packs);
      try {
        profileTaxonomy = Object.freeze({
          catalogPort: createProfilePackCatalogFromPacks({ packs: bundledProfilePacks.packs }),
          taxonomy: await loadBundledProfileTaxonomy({
            fetchImpl: typeof window.fetch === "function" ? window.fetch.bind(window) : null,
          }),
        });
        // Fail closed on unknown categories before the UI can open.
        createProfileTaxonomyView({
          catalogPort: profileTaxonomy.catalogPort,
          taxonomy: profileTaxonomy.taxonomy,
        });
      } catch (error) {
        profileTaxonomy = null;
        console.warn("OrdaX Profile taxonomy unavailable; preserving ungrouped catalog", error);
      }
    } catch (error) {
      console.warn("OrdaX Profile distribution metadata unavailable; continuing without Profiles", error);
    }
  }
  const profileProvisioning = createProfileProvisioningRuntime({
    distributions: profileDistributions,
    inventory: profileComponentInventory,
    readNetworkAvailable: () => window.navigator?.onLine === true,
  });
  const profileRestore = (
    bundledProfilePacks !== null
    && profileActivationState !== null
  )
    ? (() => {
        try {
          const snapshot = resolveProfilePackRestore({
            packs: bundledProfilePacks.packs,
            provisioning: profileProvisioning,
            activationState: profileActivationState,
          });
          for (const entry of snapshot.entries) {
            if (entry.state === "disabled-safe") {
              console.warn(
                `OrdaX Profile restore disabled safely for ${entry.spaceId}: ${entry.reason}`,
              );
            }
          }
          return snapshot;
        } catch (error) {
          console.warn("OrdaX Profile restore metadata unavailable", error);
          return null;
        }
      })()
    : null;
  if (profileRestore?.entries.some((entry) => entry.state === "resolved")) {
    console.info("OrdaX Profile restore metadata resolved; capability application remains disabled");
  }
  const syncTransport = createWebSyncTransport(window);
  const appActivation = createAppActivationChannel();
  const updateWatcher = createNativeUpdateWatcher(window);
  const notifications = createNotificationsRuntime({
    store: createNativeNotificationStore(window),
  });
  const updateNotificationBridge = createUpdateNotificationBridge(updateWatcher, notifications);
  const diagnosticJournal = await createDiagnosticJournalRuntime({
    store: diagnosticJournalStore,
  });
  const updateDiagnosticRecorder = createUpdateDiagnosticRecorder(
    updateWatcher,
    diagnosticJournal,
  );
  const reportClientDiagnostic = (stage, error) => {
    console.error(`OrdaX Surface diagnostic: ${stage}`, error);
    if (clientDiagnostics) {
      void clientDiagnostics.report(renderedSourceSha(window), stage, error);
    }
  };
  const onWindowError = (event) => {
    reportClientDiagnostic("window-error", event.error ?? new Error("window-error"));
  };
  const onUnhandledRejection = (event) => {
    const reason = event.reason instanceof Error ? event.reason : new Error("unhandled-rejection");
    reportClientDiagnostic("unhandled-rejection", reason);
  };
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  const bootControlAvailable = Boolean(
    powerActions?.getSnapshot().supportedActions.length,
  );
  const userFileSpaceAvailable = fileSpace !== null;
  const systemMetricsAvailable = systemMetrics !== null;
  const powerStatusAvailable = powerStatus !== null;
  const networkStatusAvailable = networkStatus !== null;
  const networkManagementAvailable = networkManagement !== null;
  const keyboardLayoutAvailable = keyboardLayout !== null;
  const browserWebContentAvailable = browserSession.getSnapshot().supported;
  const intelligenceSystemAvailable = true;
  const profileContentContextAvailable = (
    profileContentContextCapability?.available === true && profileActivationState !== null
  );
  const localSessionAvailable = localSession !== null;
  const readIdentityAvailable = () => identitySession.getSnapshot().state !== "unavailable";
  const host = createNativeSurfaceHost(window, {
    bootControlAvailable,
    userFileSpaceAvailable,
    systemMetricsAvailable,
    powerStatusAvailable,
    networkStatusAvailable,
    networkManagementAvailable,
    keyboardLayoutAvailable,
    browserWebContentAvailable,
    intelligenceSystemAvailable,
    profileContentContextAvailable,
    localSessionAvailable,
    readAccountIdentityAvailable: readIdentityAvailable,
    readSyncSafeStateAvailable: readIdentityAvailable,
  });
  const unsubscribeHostIdentity = identitySession.subscribe(() => host.refresh());

  validateAccountRuntime(
    host.getSnapshot(),
    identitySession.getSnapshot(),
    identityActions.getSnapshot(),
  );
  const diagnosticReviewController = createNativeDiagnosticReviewComposition({
    host,
    updateStatus: updateWatcher,
    systemMetrics,
    updateHistory,
    diagnosticJournal,
    fileSpace,
  });
  const surface = mountSurface(
    root,
    host,
    preferenceStore,
    workspaceStore,
    appActivation,
  );
  const assistantMemoryCapture = memory === null
    ? null
    : createAssistantAutoCaptureRuntime({
        intelligencePort: intelligence,
        captureRuntime: createPreferenceBoundMemoryCaptureRuntime(
          memory,
          surface.preferences,
          { mutationPort: memoryMutations },
        ),
        preferenceRuntime: surface.preferences,
        identitySessionPort: identitySession,
        spaceSelectionPort: spaceSelection,
      });
  bootLocale = surface.localization.getLocale();
  const notificationCenter = mountNotificationCenterControls(root, notifications, appActivation, surface);
  let quickPanelControls = null;
  try {
    quickPanelControls = mountSystemTrayQuickPanels(root);
  } catch (error) {
    reportClientDiagnostic("system-tray-quick-panels", error);
  }
  let networkQuickPanel = null;
  try {
    networkQuickPanel = mountNetworkQuickPanel(root, networkStatus, networkManagement, surface);
  } catch (error) {
    reportClientDiagnostic("network-quick-panel", error);
  }
  let batteryTrayControls = null;
  if (powerStatus) {
    try {
      batteryTrayControls = mountBatteryTrayControls(root, powerStatus, surface);
    } catch (error) {
      reportClientDiagnostic("battery-tray-status", error);
    }
  }
  let batteryQuickPanel = null;
  if (powerStatus) {
    try {
      batteryQuickPanel = mountBatteryQuickPanel(root, powerStatus, surface);
    } catch (error) {
      reportClientDiagnostic("battery-quick-panel", error);
    }
  }
  let networkTrayControls = null;
  if (networkStatus) {
    try {
      networkTrayControls = mountNetworkTrayControls(root, networkStatus, surface);
    } catch (error) {
      reportClientDiagnostic("network-tray-status", error);
    }
  }
  const appearanceSyncStateStore = syncStateRegistry?.open("appearance") ?? null;
  let syncMutationOrdinal = 0;
  const preferenceSync = createPreferenceSyncRuntime(surface.preferences, {
    syncStateStore: appearanceSyncStateStore,
    createIdempotencyKey() {
      syncMutationOrdinal += 1;
      const uuid = window.crypto?.randomUUID?.();
      return `pref:${uuid ? uuid.replaceAll("-", "") : `${Date.now().toString(36)}:${syncMutationOrdinal}`}`;
    },
  });
  let accountSyncOrdinal = 0;
  const accountSync = createNativeAccountSyncRuntime({
    accountMemoryFoundation,
    identitySession,
    transport: syncTransport,
    checkpointStore: syncCheckpointStore,
    preferenceSync,
    preferences: surface.preferences,
    workspaceMetadataSource: workspaceMetadata.source,
    workspaceStore,
    createIdempotencyKey(kind = "state") {
      accountSyncOrdinal += 1;
      const uuid = window.crypto?.randomUUID?.();
      return `sync:${kind}:${uuid ? uuid.replaceAll("-", "") : `${Date.now().toString(36)}:${accountSyncOrdinal}`}`;
    },
  });
  const resumeAccountConnectivity = async () => {
    await identitySession.refresh();
    await identityActions.refresh();
    await accountLifecycle.refresh();
    await accountSync.refresh();
  };
  const onOnline = () => {
    void resumeAccountConnectivity();
    void recoverProtectedAccountMemory({ refreshAuthorization: true }).catch((error) => {
      console.warn("OrdaX Account Memory online recovery remains pending", error);
    });
  };
  window.addEventListener("online", onOnline, { passive: true });
  const spaceSwitcherControls = mountSpaceSwitcherControls(
    root,
    identitySession,
    spaces,
    spaceSelection,
    appActivation,
    surface,
    profileActivationState,
  );
  const accountOverviewControls = mountAccountOverviewControls(
    root,
    identitySession,
    identityActions,
    surface,
    accountSync,
    workspaceMetadata.source,
    appActivation,
    identityCredentials,
    spaces,
    profileProvisioning,
    memoryReview,
    spaceSelection,
    surface.preferences,
    profileActivationState,
    memoryConflictReview,
    accountLifecycle,
    profileTaxonomy,
  );
  const homeContinuation = mountHomeContinuation(root, { projects, recentFiles, surfaceLifecycle: surface });
  const homePending = mountHomePending(root, { notifications, syncRuntime: accountSync, surfaceLifecycle: surface });
  const filesOwnerSpace = fileSpace === null
    ? null
    : createProjectContinuityFileSpace(fileSpace, projects, {
        projectMutations,
        onContinuityError(error) {
          reportClientDiagnostic("files-project-continuity", error);
        },
      });
  const fileSpaceControls = mountFileSpaceControls(
    root,
    filesOwnerSpace,
    appActivation,
    surface,
    { recentFiles, projects, projectMutations },
  );
  let settingsOverviewControls;
  try {
    settingsOverviewControls = mountSettingsOverviewControls(
      root,
      host,
      surface.preferences,
      surface,
      networkStatus,
      networkManagement,
      appActivation,
      notifications,
      keyboardLayout,
      localSession,
      localAi,
    );
  } catch (error) {
    reportClientDiagnostic("settings-network-management", error);
    settingsOverviewControls = mountSettingsOverviewControls(
      root,
      host,
      surface.preferences,
      surface,
      networkStatus,
      null,
      appActivation,
      notifications,
      keyboardLayout,
      localSession,
      localAi,
    );
  }
  const storeCatalogComposition = await storeCatalogCompositionPromise;
  const storeCatalog = storeCatalogComposition?.port ?? createUnavailableAppStoreCatalogPort();
  let storeLifecycleRequests = null;
  if (storeCatalogComposition?.verifiedCatalogPort) {
    try {
      storeLifecycleRequests = createAppLifecycleRequestService({
        catalogPort: storeCatalog,
        verifiedCatalogPort: storeCatalogComposition.verifiedCatalogPort,
        lifecycleDelegate: createNativeAppLifecycleDelegate(window),
      });
    } catch (error) {
      reportClientDiagnostic("store-lifecycle-composition", error);
    }
  }
  const storeOverviewControls = mountStoreOverviewControls(
    root,
    storeCatalog,
    surface,
    storeLifecycleRequests,
    (options) => readNativeHardwareInventory(window, options),
    systemMetrics,
    appActivation,
  );
  const systemOverviewControls = mountSystemOverviewControls(
    root,
    host,
    updateWatcher,
    systemMetrics,
    surface,
    updateHistory,
    appActivation,
    diagnosticReviewController,
    componentManager,
    selectedSpaceIntelligence,
    recoveryStatus,
  );
  const updateControls = mountUpdateControls(root, updateWatcher, appActivation, surface);
  const powerControls = mountPowerControls(root, powerActions, surface);

  // Reaching this point proves that the shared Surface composition mounted.
  // Optional app runtimes load only after this acknowledgement so an app-level
  // import or mount failure cannot turn into a failed OrdaX cold boot.
  componentManager.setCurrentHealth("surface-shell", "healthy");
  void updateWatcher.markHealthy();
  const surfaceHeartbeat = createNativeSurfaceHeartbeat(window);

  // Account/continuity is online enrichment, not a boot-health dependency.
  // Start it only after the real shared Surface has mounted and acknowledged
  // health so an unreachable gateway cannot roll back an otherwise healthy,
  // offline-capable Stable/MVP candidate.
  void resumeAccountConnectivity().catch((error) => {
    console.warn("OrdaX account connectivity refresh remains pending after Surface health", error);
  });

  bootScreen.setStage(surface.localization.translate("surface.boot.loadingApps"));

  const projectsComponent = await loadOptionalComponentRuntime({
    componentId: "projects",
    importer: () => import("../../apps/projects/runtime.mjs"),
    componentManager,
    context: {
      root,
      surfaceLifecycle: surface,
      projects,
      projectCloudLinks: projectCloudLinksReader,
      appActivation,
    },
    onError(error) {
      reportClientDiagnostic("projects-runtime", error);
    },
  });

  const networkComponent = await loadOptionalComponentRuntime({
    componentId: "network",
    importer: () => import("../../apps/network/runtime.mjs"),
    componentManager,
    context: {
      root,
      surfaceLifecycle: surface,
      identitySession,
      spaceSelection,
    },
    onError(error) {
      reportClientDiagnostic("network-app-runtime", error);
    },
  });

  const assistantComponent = await loadOptionalComponentRuntime({
    componentId: "assistant",
    importer: () => import("../../apps/assistant/runtime.mjs"),
    componentManager,
    context: {
      root,
      surfaceLifecycle: surface,
      intelligence: selectedSpaceIntelligence,
      memoryCapture: assistantMemoryCapture,
      identitySessionPort: identitySession,
      spaceSelectionPort: spaceSelection,
      profileActivationStatePort: profileActivationState,
    },
    onError(error) {
      reportClientDiagnostic("assistant-runtime", error);
    },
  });

  const activityComponent = await loadOptionalComponentRuntime({
    componentId: "activity",
    importer: () => import("../../apps/activity/runtime.mjs"),
    componentManager,
    context: {
      root,
      surfaceLifecycle: surface,
      personalOrdax,
      activityExport: personalActivityExport,
    },
    onError(error) {
      reportClientDiagnostic("activity-runtime", error);
    },
  });

  const internetComponent = await loadOptionalComponentRuntime({
    componentId: "internet",
    importer: () => import("../../apps/internet/runtime.mjs"),
    componentManager,
    context: {
      root,
      browserSession,
      surfaceLifecycle: surface,
      projects,
      projectMutations,
      projectReferences,
      createFavoritesStore: () => createNativeBrowserFavoritesStore(window),
      createHistoryStore: () => createNativeBrowserHistoryStore(window),
      enableShortcuts: true,
      reportDiagnostic: reportClientDiagnostic,
    },
    onError(error) {
      reportClientDiagnostic("internet-runtime", error);
    },
  });

  bootScreen.setStage(surface.localization.translate("surface.boot.preparingFirstRun"));
  let firstRun = null;
  try {
    firstRun = mountFirstRunExperience(root, {
      stateStore: firstRunStateStore,
      preferences: surface.preferences,
      networkManagement,
      identitySession,
      identityActions,
      identityCredentials,
      localSession,
    });
  } catch (error) {
    reportClientDiagnostic("first-run", error);
  }
  let localSessionLock = null;
  if (localSession) {
    try {
      localSessionLock = mountLocalSessionLock(root, localSession, surface);
    } catch (error) {
      reportClientDiagnostic("local-session-lock", error);
    }
  }
  bootScreen.ready();

  window.addEventListener(
    "pagehide",
    () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("online", onOnline);
      unsubscribeHostIdentity();
      localSessionLock?.destroy();
      firstRun?.destroy();
      surfaceHeartbeat.dispose();
      homePending.dispose();
      homeContinuation.dispose();
      powerControls.destroy();
      updateControls.destroy();
      systemOverviewControls.destroy();
      storeOverviewControls.destroy();
      storeCatalogComposition?.destroy();
      settingsOverviewControls.destroy();
      networkTrayControls?.destroy();
      networkQuickPanel?.destroy();
      quickPanelControls?.destroy();
      notificationCenter.destroy();
      batteryTrayControls?.destroy();
      batteryQuickPanel?.destroy();
      fileSpaceControls.destroy();
      projectsComponent?.destroy();
      networkComponent?.destroy();
      assistantComponent?.destroy();
      activityComponent?.destroy();
      internetComponent?.destroy();
      projectReferences?.destroy();
      projectCloudLinks?.destroy();
      accountOverviewControls.destroy();
      spaceSwitcherControls.destroy();
      accountLifecycle.dispose();
      memoryReview?.dispose();
      memoryReviewSession?.dispose();
      unsubscribeAccountMemoryRecovery();
      accountMemoryFoundation?.destroy();
      profileProvisioning.dispose();
      profileActivationState?.dispose();
      profileComponentInventory.dispose();
      personalOrdax?.dispose();
      spaceSelection.dispose();
      spaces.dispose();
      accountSync.destroy();
      preferenceSync.destroy();
      browserSession.dispose();
      updateNotificationBridge.destroy();
      updateDiagnosticRecorder.dispose();
      updateWatcher.dispose();
      unsubscribeIntelligenceHealth();
      unsubscribeLocalAiHealth();
      localAiProbeSupervisor.dispose();
      intelligence.dispose();
      localAi.dispose();
      localSession?.dispose();
      componentManager.destroy();
      surface.destroy();
      identityActions.dispose();
      identitySession.dispose();
      host.dispose();
    },
    { once: true },
  );
}

start().catch((error) => {
  bootScreen.fail(bootText("surface.boot.failed"));
  console.error("OrdaX native composition failed", error);
});
