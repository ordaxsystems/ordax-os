import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createSessionProfileComponentInventory } from "../../services/profile-packs/inventory.mjs";
import { createSameOriginIdentityCredentials } from "../../adapters/web/identity-credentials.mjs";
import { createSameOriginAccountLifecycle } from "../../adapters/web/account-lifecycle.mjs";
import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { createWebSpacesCatalog } from "../../adapters/web/spaces.mjs";
import { createUnavailableWebSpaceSelection } from "../../adapters/web/space-selection.mjs";
import { createWebBrowserSession } from "../../adapters/web/browser-session.mjs";
import { createWebPreferenceStore } from "../../adapters/web/preferences.mjs";
import { createWebSurfaceHost } from "../../adapters/web/runtime.mjs";
import { createWebWorkspaceStore } from "../../adapters/web/workspace.mjs";
import { createWebSyncStateStore } from "../../adapters/web/sync-state.mjs";
import { createWebSyncCheckpointStore } from "../../adapters/web/sync-checkpoint.mjs";
import { createWebSyncTransport } from "../../adapters/web/sync-transport.mjs";
import { validateAccountRuntime } from "../../services/account/runtime.mjs";
import { createAppActivationChannel } from "../../services/apps/activation.mjs";
import { createUnavailableAppStoreCatalogPort } from "../../contracts/app-store.mjs";
import { listSystemComponents } from "../../apps/component-catalog.mjs";
import { createComponentManager } from "../../services/components/manager.mjs";
import { loadOptionalComponentRuntime } from "../../services/components/runtime-loader.mjs";
import { createNotificationsRuntime } from "../../services/notifications/runtime.mjs";
import { createPreferenceSyncRuntime } from "../../services/sync/preference-runtime.mjs";
import { createAccountSyncRuntime } from "../../services/sync/account-runtime.mjs";
import { createWorkspaceMetadataBridge } from "../../services/sync/workspace-metadata.mjs";
import { createProfileProvisioningRuntime } from "../../services/profile-packs/provisioning.mjs";
import { loadBundledProfilePacks } from "../../services/profile-packs/bundled-source.mjs";
import { loadBundledProfileTaxonomy } from "../../services/profile-packs/taxonomy-source.mjs";
import { createProfilePackCatalogFromPacks } from "../../services/profile-packs/catalog.mjs";
import { createProfileTaxonomyView } from "../../services/profile-packs/taxonomy.mjs";
import { createLocalProfileDistributions } from "../../profile-packs/distributions.mjs";
import { translateSurfaceMessage } from "../../services/i18n/surface.mjs";
import { mountAccountOverviewControls } from "../../surface/ui/account-overview-controls.mjs";
import { mountSpaceSwitcherControls } from "../../surface/ui/space-switcher-controls.mjs";
import { mountNetworkQuickPanel } from "../../surface/ui/network-quick-panel.mjs";
import { mountNotificationCenterControls } from "../../surface/ui/notification-center-controls.mjs";
import { mountSurface } from "../../surface/ui/surface.mjs";
import { createSurfaceBootScreen } from "../../surface/ui/boot-screen.mjs";
import { mountSettingsOverviewControls } from "../../surface/ui/settings-overview-controls.mjs";
import { mountStoreOverviewControls } from "../../surface/ui/store-overview-controls.mjs";
import { mountSystemOverviewControls } from "../../surface/ui/system-overview-controls.mjs";
import { mountSystemTrayQuickPanels } from "../../surface/ui/system-tray-quick-panels.mjs";

const bootScreen = createSurfaceBootScreen(document);
let bootLocale = "pt-BR";
const bootText = (messageId) => translateSurfaceMessage(bootLocale, messageId);

try {
const root = document.querySelector("#ordax-root");
if (!root) {
  throw new Error("OrdaX composition root is missing #ordax-root");
}

const identitySession = createWebIdentitySession(window);
await identitySession.refresh();
const identityCredentials = createSameOriginIdentityCredentials(window);
const accountLifecycle = createSameOriginAccountLifecycle(window, identitySession);
const identityActions = createWebIdentityActions(window, identitySession, {
  registrationPolicy: () => identityCredentials.registrationPolicy(),
});
await identityActions.refresh();
await accountLifecycle.refresh();
const spaces = createWebSpacesCatalog(window);
const profileComponentInventory = createSessionProfileComponentInventory();
let profileDistributions = [];
let profileTaxonomy = null;
try {
  const fetchImpl = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  const bundledProfilePacks = await loadBundledProfilePacks({ fetchImpl });
  profileDistributions = createLocalProfileDistributions(bundledProfilePacks.packs);
  try {
    profileTaxonomy = Object.freeze({
      catalogPort: createProfilePackCatalogFromPacks({ packs: bundledProfilePacks.packs }),
      taxonomy: await loadBundledProfileTaxonomy({ fetchImpl }),
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
  console.warn("OrdaX Profile catalog unavailable; continuing without Profiles", error);
}
const profileProvisioning = createProfileProvisioningRuntime({
  distributions: profileDistributions,
  inventory: profileComponentInventory,
  readNetworkAvailable: () => window.navigator?.onLine === true,
});
const readIdentityAvailable = () => identitySession.getSnapshot().state !== "unavailable";
const host = createWebSurfaceHost(window, {
  readAccountIdentityAvailable: readIdentityAvailable,
  readSyncSafeStateAvailable: readIdentityAvailable,
});
const unsubscribeHostIdentity = identitySession.subscribe(() => host.refresh());
const browserSession = createWebBrowserSession();
const preferenceStore = createWebPreferenceStore(window);
bootLocale = preferenceStore.load()?.["regional.locale"] ?? "pt-BR";
bootScreen.setStage(bootText("surface.boot.loadingSurface"));
const localWorkspaceStore = createWebWorkspaceStore(window);
const workspaceMetadata = createWorkspaceMetadataBridge(localWorkspaceStore);
const workspaceStore = workspaceMetadata.store;
const syncStateStore = createWebSyncStateStore(window);
const syncCheckpointStore = createWebSyncCheckpointStore(window);
const syncTransport = createWebSyncTransport(window);
const appActivation = createAppActivationChannel();
const componentManager = createComponentManager({
  manifests: listSystemComponents(),
});
const notifications = createNotificationsRuntime();
validateAccountRuntime(
  host.getSnapshot(),
  identitySession.getSnapshot(),
  identityActions.getSnapshot(),
);
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
let networkQuickPanel = null;
try {
  quickPanelControls = mountSystemTrayQuickPanels(root);
  networkQuickPanel = mountNetworkQuickPanel(root, null, null, surface);
} catch (error) {
  console.warn("OrdaX quick panels unavailable", error);
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
  await identityActions.refresh();
  await accountLifecycle.refresh();
  await accountSync.refresh();
};
const onOnline = () => void resumeAccountConnectivity();
window.addEventListener("online", onOnline, { passive: true });
const spaceSwitcherControls = mountSpaceSwitcherControls(
  root,
  identitySession,
  spaces,
  null,
  appActivation,
  surface,
  null,
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
  null,
  null,
  surface.preferences,
  null,
  null,
  accountLifecycle,
  profileTaxonomy,
);
const settingsOverviewControls = mountSettingsOverviewControls(
  root,
  host,
  surface.preferences,
  surface,
  null,
  null,
  appActivation,
  notifications,
);
const storeCatalog = createUnavailableAppStoreCatalogPort();
const storeOverviewControls = mountStoreOverviewControls(
  root,
  storeCatalog,
  surface,
  null,
);
const systemOverviewControls = mountSystemOverviewControls(
  root,
  host,
  null,
  null,
  surface,
  null,
  appActivation,
  null,
  componentManager,
);

componentManager.setCurrentHealth("surface-shell", "healthy");
bootScreen.setStage(surface.localization.translate("surface.boot.loadingApps"));
const projectsComponent = await loadOptionalComponentRuntime({
  componentId: "projects",
  importer: () => import("../../apps/projects/runtime.mjs"),
  componentManager,
  context: {
    root,
    surfaceLifecycle: surface,
    projects: null,
    projectCloudLinks: null,
    appActivation,
  },
  onError(error) {
    console.warn("OrdaX Projects runtime unavailable", error);
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
    spaceSelection: null,
  },
  onError(error) {
    console.warn("OrdaX Network runtime unavailable", error);
  },
});
const studioComponent = await loadOptionalComponentRuntime({
  componentId: "studio",
  importer: () => import("../../apps/studio/runtime.mjs"),
  componentManager,
  context: {
    root,
    surfaceLifecycle: surface,
    deviceAgentCapabilities: null,
  },
  onError(error) {
    console.warn("ORDAX Studio runtime unavailable", error);
  },
});
const assistantComponent = await loadOptionalComponentRuntime({
  componentId: "assistant",
  importer: () => import("../../apps/assistant/runtime.mjs"),
  componentManager,
  context: {
    root,
    surfaceLifecycle: surface,
    intelligence: null,
    identitySessionPort: identitySession,
    spaceSelectionPort: createUnavailableWebSpaceSelection(),
  },
  onError(error) {
    console.warn("OrdaX Assistant runtime unavailable", error);
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
    enableShortcuts: false,
  },
  onError(error) {
    console.warn("OrdaX Internet runtime unavailable", error);
  },
});

bootScreen.ready();

window.addEventListener(
  "pagehide",
  () => {
    window.removeEventListener("online", onOnline);
    unsubscribeHostIdentity();
    systemOverviewControls.destroy();
    storeOverviewControls.destroy();
    assistantComponent?.destroy();
    internetComponent?.destroy();
    studioComponent?.destroy();
    projectsComponent?.destroy();
    networkComponent?.destroy();
    networkQuickPanel?.destroy();
    quickPanelControls?.destroy();
    notificationCenter.destroy();
    settingsOverviewControls.destroy();
    accountOverviewControls.destroy();
    spaceSwitcherControls.destroy();
    accountLifecycle.dispose();
    profileProvisioning.dispose();
    profileComponentInventory.dispose();
    spaces.dispose();
    accountSync.destroy();
    preferenceSync.destroy();
    browserSession.dispose();
    componentManager.destroy();
    surface.destroy();
    identityActions.dispose();
    identitySession.dispose();
    host.dispose();
  },
  { once: true },
);

} catch (error) {
  bootScreen.fail(bootText("surface.boot.failed"));
  console.error("OrdaX web composition failed", error);
}