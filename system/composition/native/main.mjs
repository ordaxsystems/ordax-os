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
import { createNativeRecentFilesStore } from "../../adapters/native/recent-files.mjs";
import { createNativeProjectStore } from "../../adapters/native/projects.mjs";
import { createNativeProjectCloudLinkStore } from "../../adapters/native/project-cloud-links.mjs";
import { createNativeProjectWebReferenceStore } from "../../adapters/native/project-web-references.mjs";
import { createNativeNetworkManagement } from "../../adapters/native/network-management.mjs";
import { createNativeKeyboardLayout } from "../../adapters/native/keyboard-layout.mjs";
import { createNativeNotificationStore } from "../../adapters/native/notifications.mjs";
import { createNativeNotesStore } from "../../adapters/native/notes.mjs";
import { createNativeNetworkStatus } from "../../adapters/native/network-status.mjs";
import { createNativePowerActions } from "../../adapters/native/power-actions.mjs";
import { createNativePowerStatus } from "../../adapters/native/power-status.mjs";
import { createNativePreferenceStore } from "../../adapters/native/preferences.mjs";
import { createNativeFirstRunStateStore } from "../../adapters/native/first-run-state.mjs";
import { createNativeLocalSession } from "../../adapters/native/local-session.mjs";
import { createNativeMemoryStore } from "../../adapters/native/memory.mjs";
import { createNativeSurfaceHost } from "../../adapters/native/runtime.mjs";
import { createNativeSystemMetrics } from "../../adapters/native/system-metrics.mjs";
import { createNativeRecoveryStatus } from "../../adapters/native/recovery-status.mjs";
import { createNativeUpdateHistory } from "../../adapters/native/update-history.mjs";
import { createNativeUpdateWatcher } from "../../adapters/native/update-runtime.mjs";
import { createNativeWorkspaceStore } from "../../adapters/native/workspace.mjs";
import { createNativeSyncStateStore } from "../../adapters/native/sync-state.mjs";
import { createNativeSyncCheckpointStore } from "../../adapters/native/sync-checkpoint.mjs";
import { createNativeSurfaceHeartbeat } from "../../adapters/native/surface-heartbeat.mjs";
import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createSameOriginIdentityCredentials } from "../../adapters/web/identity-credentials.mjs";
import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { createWebSpacesCatalog } from "../../adapters/web/spaces.mjs";
import { createWebSyncTransport } from "../../adapters/web/sync-transport.mjs";
import { validateAccountRuntime } from "../../services/account/runtime.mjs";
import { createAppActivationChannel } from "../../services/apps/activation.mjs";
import { listSystemComponents } from "../../apps/component-catalog.mjs";
import { createComponentManager } from "../../services/components/manager.mjs";
import { loadOptionalComponentRuntime } from "../../services/components/runtime-loader.mjs";
import { createRecentFilesRuntime } from "../../services/files/recent-files.mjs";
import { createProjectCatalogRuntime } from "../../services/files/projects.mjs";
import { createProjectCloudLinksRuntime } from "../../services/projects/cloud-links.mjs";
import { createProjectWebReferenceRuntime } from "../../services/projects/web-references.mjs";
import { createProjectContinuityFileSpace } from "../../services/files/project-continuity-file-space.mjs";
import { createNotificationsRuntime } from "../../services/notifications/runtime.mjs";
import { createUpdateNotificationBridge } from "../../services/notifications/update-bridge.mjs";
import { createDiagnosticJournalRuntime } from "../../services/diagnostics/runtime.mjs";
import { createLocalAiRuntime } from "../../services/local-ai/runtime.mjs";
import { createIntelligenceRuntime } from "../../services/intelligence/runtime.mjs";
import { createMemoryRuntime } from "../../services/memory/runtime.mjs";
import { createMemoryReviewSession } from "../../services/memory/review-session.mjs";
import { createMemoryReviewViewModel } from "../../services/memory/review-view-model.mjs";
import { createProfileProvisioningRuntime } from "../../services/profile-packs/provisioning.mjs";
import { LOCAL_PROFILE_DISTRIBUTIONS } from "../../profile-packs/distributions.mjs";
import { createUpdateDiagnosticRecorder } from "../../services/diagnostics/update-recorder.mjs";
import { createPreferenceSyncRuntime } from "../../services/sync/preference-runtime.mjs";
import { createAccountSyncRuntime } from "../../services/sync/account-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../../services/sync/workspace-metadata.mjs";
import { seedMissingRegionalPreferencesFromFirstRun } from "../../services/state/first-run.mjs";
import { translateSurfaceMessage } from "../../services/i18n/surface.mjs";
import { createNativeDiagnosticReviewComposition } from "./diagnostics.mjs";
import { mountAccountOverviewControls } from "../../surface/ui/account-overview-controls.mjs";
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

const bootScreen = createSurfaceBootScreen(document);
let bootLocale = "pt-BR";
const bootText = (messageId) => translateSurfaceMessage(bootLocale, messageId);

async function start() {
  const root = document.querySelector("#ordax-root");
  if (!root) {
    throw new Error("OrdaX composition root is missing #ordax-root");
  }

  const browserSession = createNativeBrowserSession(window);
  const preferenceStorePromise = createNativePreferenceStore(window);
  const firstRunStateStorePromise = createNativeFirstRunStateStore(window);
  const localSessionPromise = optionalNativeProbe(
    "OrdaX native local session unavailable",
    () => createNativeLocalSession(window),
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
      "OrdaX native notes persistence unavailable",
      () => createNativeNotesStore(window),
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

  const [preferenceStore, firstRunStateStore, localSession] = await Promise.all([
    preferenceStorePromise,
    firstRunStateStorePromise,
    localSessionPromise,
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
    notesStore,
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
  void localAi.probe();

  const localWorkspaceStore = createNativeWorkspaceStore(window);
  const recentFiles = fileSpace === null ? null : createRecentFilesRuntime({
    store: createNativeRecentFilesStore(window),
  });
  const projects = fileSpace === null ? null : createProjectCatalogRuntime({
    store: createNativeProjectStore(window),
  });
  const projectCloudLinks = projects === null ? null : createProjectCloudLinksRuntime({
    projects,
    store: createNativeProjectCloudLinkStore(window),
  });
  const projectReferences = projects === null ? null : createProjectWebReferenceRuntime({
    store: createNativeProjectWebReferenceStore(window),
    projects,
  });
  const workspaceMetadata = createWorkspaceMetadataBridge(localWorkspaceStore);
  const workspaceStore = workspaceMetadata.store;
  const identitySession = createWebIdentitySession(window);
  await identitySession.refresh();
  const memoryReviewSession = memory === null
    ? null
    : createMemoryReviewSession({
        memoryPort: memory,
        identitySessionPort: identitySession,
      });
  const memoryReview = memoryReviewSession === null
    ? null
    : createMemoryReviewViewModel(memoryReviewSession);
  const identityActions = createWebIdentityActions(window, identitySession);
  const identityAvailable = identitySession.getSnapshot().state !== "unavailable";
  const identityCredentials = identityAvailable ? createSameOriginIdentityCredentials(window) : null;
  const spaces = createWebSpacesCatalog(window);
  const profileProvisioning = createProfileProvisioningRuntime({
    distributions: LOCAL_PROFILE_DISTRIBUTIONS,
    readInstalledComponentIds: () => [],
    readNetworkAvailable: () => window.navigator?.onLine === true,
  });
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
  const localSessionAvailable = localSession !== null;
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
    localSessionAvailable,
    accountIdentityAvailable: identityAvailable,
    syncSafeStateAvailable: identityAvailable,
  });

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
  let syncMutationOrdinal = 0;
  const preferenceSync = createPreferenceSyncRuntime(surface.preferences, {
    syncStateStore,
    createIdempotencyKey() {
      syncMutationOrdinal += 1;
      const uuid = window.crypto?.randomUUID?.();
      return `pref:${uuid ? uuid.replaceAll("-", "") : `${Date.now().toString(36)}:${syncMutationOrdinal}`}`;
    },
  });
  let accountSyncOrdinal = 0;
  const accountSync = createAccountSyncRuntime({
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
    await accountSync.refresh();
  };
  window.addEventListener("online", () => void resumeAccountConnectivity(), { passive: true });
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
  );
  const homeContinuation = mountHomeContinuation(root, { projects, recentFiles, surfaceLifecycle: surface });
  const homePending = mountHomePending(root, { notifications, syncRuntime: accountSync, surfaceLifecycle: surface });
  const filesOwnerSpace = fileSpace === null
    ? null
    : createProjectContinuityFileSpace(fileSpace, projects, {
        onContinuityError(error) {
          reportClientDiagnostic("files-project-continuity", error);
        },
      });
  const fileSpaceControls = mountFileSpaceControls(
    root,
    filesOwnerSpace,
    appActivation,
    surface,
    { recentFiles, projects },
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
    );
  }
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
    intelligence,
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

  bootScreen.setStage(surface.localization.translate("surface.boot.loadingApps"));

  const projectsComponent = await loadOptionalComponentRuntime({
    componentId: "projects",
    importer: () => import("../../apps/projects/runtime.mjs"),
    componentManager,
    context: {
      root,
      surfaceLifecycle: surface,
      projects,
      projectCloudLinks,
      appActivation,
    },
    onError(error) {
      reportClientDiagnostic("projects-runtime", error);
    },
  });

  const notesComponent = await loadOptionalComponentRuntime({
    componentId: "notes",
    importer: () => import("../../apps/notes/runtime.mjs"),
    componentManager,
    context: {
      root,
      createStore: () => notesStore,
      surfaceLifecycle: surface,
      fileSpace,
      appActivation,
      intelligence,
    },
    onError(error) {
      reportClientDiagnostic("notes-runtime", error);
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
      localSessionLock?.destroy();
      firstRun?.destroy();
      surfaceHeartbeat.dispose();
      homePending.dispose();
      homeContinuation.dispose();
      powerControls.destroy();
      updateControls.destroy();
      systemOverviewControls.destroy();
      settingsOverviewControls.destroy();
      networkTrayControls?.destroy();
      networkQuickPanel?.destroy();
      quickPanelControls?.destroy();
      notificationCenter.destroy();
      batteryTrayControls?.destroy();
      batteryQuickPanel?.destroy();
      fileSpaceControls.destroy();
      projectsComponent?.destroy();
      notesComponent?.destroy();
      internetComponent?.destroy();
      projectReferences?.destroy();
      projectCloudLinks?.destroy();
      accountOverviewControls.destroy();
      memoryReview?.dispose();
      memoryReviewSession?.dispose();
      profileProvisioning.dispose();
      spaces.dispose();
      accountSync.destroy();
      preferenceSync.destroy();
      browserSession.dispose();
      updateNotificationBridge.destroy();
      updateDiagnosticRecorder.dispose();
      updateWatcher.dispose();
      unsubscribeIntelligenceHealth();
      unsubscribeLocalAiHealth();
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
