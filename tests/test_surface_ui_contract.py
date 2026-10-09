from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system" / "surface" / "ui"
APPS = ROOT / "system" / "apps"
PREFERENCES = ROOT / "system" / "services" / "preferences"
APP_CATALOG = APPS / "catalog.mjs"
APP_CONTRACT = APPS / "app-contract.mjs"
APP_OWNERS = {
    "files": APPS / "files" / "app.mjs",
    "projects": APPS / "projects" / "app.mjs",
    "internet": APPS / "internet" / "app.mjs",
    "network": APPS / "network" / "app.mjs",
    "settings": APPS / "settings" / "app.mjs",
    "account": APPS / "account" / "app.mjs",
    "assistant": APPS / "assistant" / "app.mjs",
    "system": APPS / "system" / "app.mjs",
}
APPEARANCE = PREFERENCES / "appearance.mjs"
ACCESSIBILITY = PREFERENCES / "accessibility.mjs"
PREFERENCE_CATALOG = PREFERENCES / "catalog.mjs"
PREFERENCE_STORE_CONTRACT = ROOT / "system" / "contracts" / "preference-store.mjs"
SYNC_RUNTIME_CONTRACT = ROOT / "system" / "contracts" / "sync-runtime.mjs"
SYNC_STATE_STORE_CONTRACT = ROOT / "system" / "contracts" / "sync-state-store.mjs"
WORKSPACE_METADATA_CONTRACT = ROOT / "system" / "contracts" / "workspace-metadata-source.mjs"
WORKSPACE_METADATA_SERVICE = ROOT / "system" / "services" / "sync" / "workspace-metadata.mjs"
WEB_SYNC_STATE_ADAPTER = ROOT / "system" / "adapters" / "web" / "sync-state.mjs"
NATIVE_SYNC_STATE_ADAPTER = ROOT / "system" / "adapters" / "native" / "sync-state.mjs"
PREFERENCE_SYNC_SERVICE = ROOT / "system" / "services" / "sync" / "preference-runtime.mjs"
IDENTITY_SESSION_CONTRACT = ROOT / "system" / "contracts" / "identity-session.mjs"
IDENTITY_ACTIONS_CONTRACT = ROOT / "system" / "contracts" / "identity-actions.mjs"
ACCOUNT_LOCALIZATION_CATALOG = ROOT / "system" / "services" / "i18n" / "catalog" / "account.mjs"
POWER_ACTIONS_CONTRACT = ROOT / "system" / "contracts" / "power-actions.mjs"
APP_ACTIVATION_CONTRACT = ROOT / "system" / "contracts" / "app-activation.mjs"
APP_ACTIVATION_SERVICE = ROOT / "system" / "services" / "apps" / "activation.mjs"
COMPONENT_MANIFEST_CONTRACT = ROOT / "system" / "contracts" / "component-manifest.mjs"
COMPONENT_STATE_CONTRACT = ROOT / "system" / "contracts" / "component-state-store.mjs"
COMPONENT_MANAGER_CONTRACT = ROOT / "system" / "contracts" / "component-manager.mjs"
COMPONENT_CATALOG = ROOT / "system" / "apps" / "component-catalog.mjs"
COMPONENT_MANAGER = ROOT / "system" / "services" / "components" / "manager.mjs"
NATIVE_COMPONENT_STATE = ROOT / "system" / "adapters" / "native" / "component-state.mjs"
COMPOSITION = ROOT / "system" / "composition" / "web"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "runtime.mjs"
WEB_PREFERENCE_ADAPTER = ROOT / "system" / "adapters" / "web" / "preferences.mjs"
WEB_IDENTITY_ADAPTER = ROOT / "system" / "adapters" / "web" / "identity.mjs"
WEB_IDENTITY_ACTIONS_ADAPTER = ROOT / "system" / "adapters" / "web" / "identity-actions.mjs"
NATIVE_POWER_ADAPTER = ROOT / "system" / "adapters" / "native" / "power-actions.mjs"
NATIVE_SURFACE_HEARTBEAT_ADAPTER = ROOT / "system" / "adapters" / "native" / "surface-heartbeat.mjs"
POWER_CONTROLS = SURFACE / "power-controls.mjs"
UPDATE_CONTROLS = SURFACE / "update-controls.mjs"
UPDATE_PRESENTATION = ROOT / "system" / "services" / "update" / "presentation.mjs"
DESKTOP_SHELL = SURFACE / "desktop-shell.mjs"
SURFACE_LOCALIZATION = ROOT / "system" / "services" / "i18n" / "surface.mjs"
SURFACE_LIFECYCLE = ROOT / "system" / "contracts" / "surface-render-lifecycle.mjs"
FILE_SPACE_CONTROLS = SURFACE / "file-space-controls.mjs"



INTERNET_BROWSER_CONTROLS = APPS / "internet" / "ui" / "browser-controls.mjs"
INTERNET_BROWSER_SHORTCUTS = APPS / "internet" / "ui" / "browser-shortcuts.mjs"
SYSTEM_OVERVIEW_CONTROLS = SURFACE / "system-overview-controls.mjs"
ACCOUNT_OVERVIEW_CONTROLS = SURFACE / "account-overview-controls.mjs"
SETTINGS_OVERVIEW_CONTROLS = SURFACE / "settings-overview-controls.mjs"
SETTINGS_I18N = ROOT / "system" / "services" / "i18n" / "catalog" / "settings.mjs"
SYSTEM_TRAY_QUICK_PANELS = SURFACE / "system-tray-quick-panels.mjs"
NETWORK_QUICK_PANEL = SURFACE / "network-quick-panel.mjs"
NETWORK_I18N = ROOT / "system" / "services" / "i18n" / "catalog" / "network.mjs"
POWER_I18N = ROOT / "system" / "services" / "i18n" / "catalog" / "power.mjs"
BATTERY_QUICK_PANEL = SURFACE / "battery-quick-panel.mjs"
HOST_CONTRACT = ROOT / "system" / "contracts" / "surface-host.mjs"
WEB_WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class SurfaceUiContractTests(unittest.TestCase):
    def test_visual_surface_app_preference_and_store_sources_exist(self):
        for path in (
            SURFACE / "surface.mjs",
            SURFACE / "surface-state.mjs",
            DESKTOP_SHELL,
            SURFACE_LOCALIZATION,
            SURFACE_LIFECYCLE,
            FILE_SPACE_CONTROLS,
            INTERNET_BROWSER_CONTROLS,
            INTERNET_BROWSER_SHORTCUTS,
            SYSTEM_OVERVIEW_CONTROLS,
            ACCOUNT_OVERVIEW_CONTROLS,
            SETTINGS_OVERVIEW_CONTROLS,
            SYSTEM_TRAY_QUICK_PANELS,
            NETWORK_QUICK_PANEL,
            SURFACE / "tokens.css",
            SURFACE / "surface.css",
            SURFACE / "files.css",
            APPS / "internet" / "internet.css",
            SURFACE / "system.css",
            SURFACE / "account.css",
            SURFACE / "settings.css",
            POWER_CONTROLS,
            APP_CATALOG,
            APP_CONTRACT,
            *APP_OWNERS.values(),
            APPEARANCE,
            ACCESSIBILITY,
            PREFERENCE_CATALOG,
            PREFERENCE_STORE_CONTRACT,
            SYNC_RUNTIME_CONTRACT,
            SYNC_STATE_STORE_CONTRACT,
            WORKSPACE_METADATA_CONTRACT,
            PREFERENCE_SYNC_SERVICE,
            WORKSPACE_METADATA_SERVICE,
            WEB_SYNC_STATE_ADAPTER,
            NATIVE_SYNC_STATE_ADAPTER,
            IDENTITY_SESSION_CONTRACT,
            IDENTITY_ACTIONS_CONTRACT,
            POWER_ACTIONS_CONTRACT,
            APP_ACTIVATION_CONTRACT,
            APP_ACTIVATION_SERVICE,
            COMPONENT_MANIFEST_CONTRACT,
            COMPONENT_STATE_CONTRACT,
            COMPONENT_MANAGER_CONTRACT,
            COMPONENT_CATALOG,
            COMPONENT_MANAGER,
            NATIVE_COMPONENT_STATE,
            COMPOSITION / "index.html",
            COMPOSITION / "main.mjs",
            NATIVE_COMPOSITION / "index.html",
            NATIVE_COMPOSITION / "main.mjs",
            WEB_ADAPTER,
            WEB_PREFERENCE_ADAPTER,
            WEB_IDENTITY_ADAPTER,
            WEB_IDENTITY_ACTIONS_ADAPTER,
            NATIVE_POWER_ADAPTER,
            NATIVE_SURFACE_HEARTBEAT_ADAPTER,
            HOST_CONTRACT,
        ):
            self.assertTrue(path.is_file(), path)
            self.assertGreater(path.stat().st_size, 0, path)

    def test_shared_surface_never_imports_concrete_adapter(self):
        for path in SURFACE.rglob("*.mjs"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("adapters/", text, path)
            self.assertNotIn("navigator.", text, path)
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        power = POWER_CONTROLS.read_text(encoding="utf-8")
        self.assertIn("contracts/surface-host.mjs", surface)
        self.assertIn("contracts/preference-store.mjs", surface)
        self.assertIn("contracts/preference-runtime.mjs", surface)
        self.assertIn("PREFERENCE_RUNTIME_SCHEMA", surface)
        self.assertIn("preferences,", surface)
        self.assertNotIn("contracts/identity-session.mjs", surface)
        self.assertNotIn("contracts/identity-actions.mjs", surface)
        self.assertIn("contracts/app-activation.mjs", surface)
        self.assertIn("../../apps/catalog.mjs", surface)
        self.assertIn("../../services/preferences/appearance.mjs", surface)
        self.assertIn("../../services/preferences/accessibility.mjs", surface)
        self.assertIn("./desktop-shell.mjs", surface)
        self.assertIn("contracts/surface-render-lifecycle.mjs", surface)
        self.assertIn("SURFACE_RENDER_LIFECYCLE_SCHEMA", surface)
        self.assertIn("subscribeRender(listener)", surface)
        self.assertIn("../../contracts/power-actions.mjs", power)

    def test_surface_owns_context_menu_boundary_instead_of_browser_chrome(self):
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        self.assertIn('const onContextMenu = (event) => {', surface)
        self.assertIn('event.preventDefault();', surface)
        self.assertIn('root.addEventListener("contextmenu", onContextMenu)', surface)
        self.assertIn('root.removeEventListener("contextmenu", onContextMenu)', surface)
        for browser_action in ("Back", "Forward", "Stop", "Reload"):
            self.assertNotIn(browser_action, surface)

    def test_shared_extensions_use_explicit_surface_render_lifecycle(self):
        lifecycle = SURFACE_LIFECYCLE.read_text(encoding="utf-8")
        self.assertIn('ordax.surface-render-lifecycle/5', lifecycle)
        self.assertIn("assertSurfaceRenderLifecycle", lifecycle)
        self.assertIn("getAppTarget", lifecycle)
        self.assertIn("setAppTarget", lifecycle)
        self.assertIn("assertLocalizationPort", lifecycle)
        self.assertIn("value.localization", lifecycle)
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        self.assertIn("getAppTarget(appId)", surface)
        self.assertIn("setAppTarget(appId, target)", surface)
        self.assertIn('type: "app.target"', surface)
        for path in (FILE_SPACE_CONTROLS, SYSTEM_OVERVIEW_CONTROLS, ACCOUNT_OVERVIEW_CONTROLS, SETTINGS_OVERVIEW_CONTROLS):
            text = path.read_text(encoding="utf-8")
            self.assertIn("contracts/surface-render-lifecycle.mjs", text, path)
            self.assertIn("assertSurfaceRenderLifecycle", text, path)
            self.assertIn("subscribeRender", text, path)
            self.assertNotIn("MutationObserver", text, path)
        internet_controls = INTERNET_BROWSER_CONTROLS.read_text(encoding="utf-8")
        self.assertIn("contracts/surface-render-lifecycle.mjs", internet_controls)
        self.assertIn("assertSurfaceRenderLifecycle", internet_controls)
        self.assertIn("subscribeRender", internet_controls)
        self.assertNotIn("MutationObserver", internet_controls)

        files = FILE_SPACE_CONTROLS.read_text(encoding="utf-8")
        self.assertIn('lifecycle.setAppTarget("files", next.path)', files)
        self.assertIn('const initialTarget = lifecycle.getAppTarget("files") ?? "/"', files)
        self.assertIn("loadWithFallback(activation.target)", files)
        self.assertIn('lifecycle.setAppTarget("files", listing.path)', files)
        self.assertIn('lifecycle.setAppTarget("files", null)', files)
        self.assertNotIn("localStorage", files)

    def test_first_party_apps_have_independent_owners_and_thin_catalog(self):
        catalog = APP_CATALOG.read_text(encoding="utf-8")
        self.assertIn("./app-contract.mjs", catalog)
        for app_id, path in APP_OWNERS.items():
            owner = path.read_text(encoding="utf-8")
            self.assertIn(f'id: "{app_id}"', owner)
            self.assertIn("defineFirstPartyApp", owner)
            self.assertIn("component:", owner)
            if app_id in {"assistant", "internet", "network", "projects"}:
                self.assertIn("./component.mjs", owner)
            else:
                self.assertIn("../../services/components/manifests/apps.mjs", owner)
            self.assertIn(f'./{app_id}/app.mjs', catalog)
        self.assertIn("listFirstPartyApps", catalog)
        self.assertIn("getFirstPartyApp", catalog)
        self.assertLess(len(catalog.splitlines()), 40, "catalog should stay composition-only")

    def test_app_contract_is_capability_preference_and_extension_driven(self):
        text = APP_CONTRACT.read_text(encoding="utf-8")
        self.assertIn("requiredCapabilities", text)
        self.assertIn("isAppAvailable", text)
        self.assertIn("every((capabilityId)", text)
        self.assertIn('"preference-choice"', text)
        self.assertIn('"extension"', text)
        self.assertIn("extensionId", text)
        self.assertIn("preferenceId", text)
        self.assertIn("PANEL_KINDS", text)
        self.assertNotIn('"identity-session"', text)
        self.assertNotIn('"identity-actions"', text)

    def test_files_uses_formal_shared_extension_slot(self):
        files = APP_OWNERS["files"].read_text(encoding="utf-8")
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "files.css").read_text(encoding="utf-8")
        web_html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        native_html = (NATIVE_COMPOSITION / "index.html").read_text(encoding="utf-8")
        self.assertIn('kind: "extension"', files)
        self.assertIn('extensionId: "file-space"', files)
        self.assertIn('panel.kind === "extension"', surface)
        self.assertIn("dataset.appExtension", surface)
        self.assertIn('.ordax-files-view', css)
        self.assertIn("../../surface/ui/files.css", web_html)
        self.assertIn("../../surface/ui/files.css", native_html)

    def test_assistant_is_optional_intelligence_client_without_memory_ownership(self):
        assistant = APP_OWNERS["assistant"].read_text(encoding="utf-8")
        conversation = (APPS / "assistant" / "conversation.mjs").read_text(encoding="utf-8")
        runtime = (APPS / "assistant" / "runtime.mjs").read_text(encoding="utf-8")
        controls = (APPS / "assistant" / "ui" / "conversation-controls.mjs").read_text(encoding="utf-8")
        component = (APPS / "assistant" / "component.mjs").read_text(encoding="utf-8")
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        web_main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        localization = SURFACE_LOCALIZATION.read_text(encoding="utf-8")
        assistant_i18n = (
            ROOT / "system" / "services" / "i18n" / "catalog" / "assistant.mjs"
        ).read_text(encoding="utf-8")

        self.assertIn('id: "assistant"', assistant)
        self.assertIn('extensionId: "assistant-conversation"', assistant)
        self.assertIn('releaseMode: "git-app"', component)
        self.assertIn('"ordax-intelligence"', component)
        self.assertIn('ASSISTANT_CONVERSATION_SCHEMA', conversation)
        self.assertIn('persistence: "session"', conversation)
        self.assertIn('authority: "none"', conversation)
        self.assertIn('toolExecution: false', conversation)
        self.assertIn('provenance: "ordax-assistant-session"', conversation)
        self.assertNotIn('services/memory', conversation)
        self.assertNotIn('memory-capture', conversation)
        self.assertNotIn('localStorage', conversation)
        self.assertNotIn('fetch(', conversation)
        self.assertNotIn('adapters/', conversation)
        self.assertIn('mountAssistantConversationControls', runtime)
        self.assertNotIn('adapters/', controls)
        self.assertNotIn('/__ordax/native/', controls)
        self.assertIn('railButton("assistant", t("app.assistant.title"), ICONS.assistant, t)', shell)
        self.assertIn('ASSISTANT_SOURCE_MESSAGES', localization)
        self.assertIn('ASSISTANT_ENGLISH_MESSAGES', localization)
        self.assertIn('"app.assistant.title": "Assistente"', assistant_i18n)
        self.assertIn('"app.assistant.title": "Assistant"', assistant_i18n)
        self.assertIn('componentId: "assistant"', web_main)
        self.assertIn('intelligence: null', web_main)
        self.assertIn('componentId: "assistant"', native_main)
        self.assertIn('intelligence: selectedSpaceIntelligence', native_main)
        self.assertIn('assistantComponent?.destroy()', web_main)
        self.assertIn('assistantComponent?.destroy()', native_main)


    def test_internet_uses_shared_browser_session_extension(self):
        internet = APP_OWNERS["internet"].read_text(encoding="utf-8")
        controls = INTERNET_BROWSER_CONTROLS.read_text(encoding="utf-8")
        shortcuts = INTERNET_BROWSER_SHORTCUTS.read_text(encoding="utf-8")
        css = (APPS / "internet" / "internet.css").read_text(encoding="utf-8")
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        web_html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        native_html = (NATIVE_COMPOSITION / "index.html").read_text(encoding="utf-8")
        web_main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        internet_runtime = (
            APPS / "internet" / "runtime.mjs"
        ).read_text(encoding="utf-8")

        self.assertIn('id: "internet"', internet)
        self.assertIn('extensionId: "internet-browser"', internet)
        self.assertIn('railButton("internet", t("app.internet.title"), ICONS.internet, t)', shell)
        localization = SURFACE_LOCALIZATION.read_text(encoding="utf-8")
        self.assertIn('"app.internet.title": "Internet"', localization)
        self.assertIn("assertBrowserSessionPort", controls)
        self.assertIn("assertSurfaceRenderLifecycle", controls)
        self.assertIn('getAppTarget("internet")', controls)
        self.assertIn("syncSurfaceTarget", controls)
        self.assertIn("data-browser-viewport", controls)
        self.assertNotIn("iframe", controls.lower())
        self.assertNotIn("/__ordax/native/", controls)
        self.assertNotIn("adapters/", controls)
        self.assertIn("assertBrowserSessionPort", shortcuts)
        self.assertIn(".ordax-internet-view", css)
        self.assertIn(".ordax-internet-project-panel", css)
        self.assertNotIn("../../surface/ui/internet.css", web_html)
        self.assertNotIn("../../surface/ui/internet.css", native_html)
        self.assertIn("createWebBrowserSession", web_main)
        self.assertIn("createNativeBrowserSession", native_main)
        self.assertIn("loadOptionalComponentRuntime", web_main)
        self.assertIn("loadOptionalComponentRuntime", native_main)
        self.assertIn('import("../../apps/internet/runtime.mjs")', web_main)
        self.assertIn('import("../../apps/internet/runtime.mjs")', native_main)
        self.assertNotIn('from "../../surface/ui/internet-browser-controls.mjs"', web_main)
        self.assertNotIn('from "../../surface/ui/internet-browser-controls.mjs"', native_main)
        self.assertIn("mountInternetBrowserControls", internet_runtime)
        self.assertIn("mountInternetBrowserShortcuts", internet_runtime)
        self.assertIn('new URL("./internet.css", import.meta.url)', internet_runtime)
        self.assertIn("mountInternetStyles", internet_runtime)
        self.assertIn("releaseStyles()", internet_runtime)
        self.assertIn("internetComponent?.destroy()", web_main)
        self.assertIn("internetComponent?.destroy()", native_main)
        self.assertIn("browserSession.dispose()", web_main)
        self.assertIn("browserSession.dispose()", native_main)

    def test_system_uses_formal_shared_overview_extension(self):
        system = APP_OWNERS["system"].read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW_CONTROLS.read_text(encoding="utf-8")
        css = (SURFACE / "system.css").read_text(encoding="utf-8")
        web_html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        native_html = (NATIVE_COMPOSITION / "index.html").read_text(encoding="utf-8")
        self.assertIn('kind: "extension"', system)
        self.assertIn('extensionId: "system-overview"', system)
        self.assertIn('SYSTEM_EXTENSION_SELECTOR', overview)
        self.assertIn("assertSurfaceHost", overview)
        self.assertIn("assertUpdateStatusPort", overview)
        self.assertIn("assertUpdateHistoryPort", overview)
        self.assertIn("assertSystemMetricsPort", overview)
        self.assertIn('t("system.history.title")', overview)
        self.assertIn('t("system.about.delivery.kicker")', overview)
        self.assertIn("assertComponentManager", overview)
        self.assertIn("validateComponentManagerSnapshot", overview)
        self.assertIn('t("system.components.versionsTitle")', overview)
        self.assertIn('"system.components.releaseMode.bundled"', overview)
        self.assertIn('"system.components.releaseMode.componentSlot"', overview)
        self.assertIn('"system.components.version.detail.bundled"', overview)
        self.assertIn("services/update/presentation.mjs", overview)
        self.assertIn(".ordax-system-view", css)
        self.assertIn("../../surface/ui/system.css", web_html)
        self.assertIn("../../surface/ui/system.css", native_html)

    def test_settings_uses_live_preference_runtime_and_shared_overview(self):
        settings = APP_OWNERS["settings"].read_text(encoding="utf-8")
        overview = SETTINGS_OVERVIEW_CONTROLS.read_text(encoding="utf-8")
        settings_i18n = SETTINGS_I18N.read_text(encoding="utf-8")
        appearance = APPEARANCE.read_text(encoding="utf-8")
        accessibility = ACCESSIBILITY.read_text(encoding="utf-8")
        preferences = PREFERENCE_CATALOG.read_text(encoding="utf-8")
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "settings.css").read_text(encoding="utf-8")
        web_main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        self.assertIn('kind: "extension"', settings)
        self.assertIn('extensionId: "settings-overview"', settings)
        self.assertIn("contracts/app-activation.mjs", overview)
        self.assertIn("contracts/preference-runtime.mjs", overview)
        self.assertIn("contracts/network-management.mjs", overview)
        self.assertIn("assertPreferenceRuntimePort", overview)
        self.assertIn("assertNetworkManagementPort", overview)
        self.assertIn("listPreferenceDefinitions", overview)
        self.assertIn('t("settings.eyebrow")', overview)
        self.assertIn('"settings.eyebrow": "Ajustes"', settings_i18n)
        self.assertIn('id: "appearance"', overview)
        self.assertIn('id: "accessibility"', overview)
        self.assertIn('id: "network"', overview)
        self.assertIn("definition.sectionId !== sectionId", overview)
        self.assertIn("validSettingsSection", overview)
        self.assertIn("ordax-settings-navigation", css)
        self.assertNotIn("CAPABILITY_LABELS", overview)
        self.assertNotIn("Capacidades disponíveis", overview)
        self.assertIn('"network.quick.action.scan"', overview)
        self.assertIn('"network.quick.action.connect"', overview)
        self.assertIn('"network.quick.action.disconnect"', overview)
        self.assertIn('"settings.network.action.forget"', overview)
        self.assertIn('"network.quick.action.reconnect"', overview)
        self.assertIn('input.type = "password"', overview)
        self.assertIn('input.value = ""', overview)
        self.assertIn('event.key === "Enter"', overview)
        self.assertIn('event.key === "Escape"', overview)
        self.assertIn('"appearance.theme"', appearance)
        self.assertIn('defaultValue: "light"', appearance)
        self.assertIn('value: "dark"', appearance)
        self.assertIn('"accessibility.contrast"', accessibility)
        self.assertIn('"accessibility.motion"', accessibility)
        self.assertIn('value: "high"', accessibility)
        self.assertIn('value: "reduced"', accessibility)
        self.assertIn('"./accessibility.mjs"', preferences)
        self.assertIn("createPreferenceSnapshot", preferences)
        self.assertIn("setPreferenceValue", preferences)
        self.assertIn("PREFERENCE_RUNTIME_SCHEMA", surface)
        self.assertIn("dataset.ordaxContrast", surface)
        self.assertIn("dataset.ordaxMotion", surface)
        self.assertIn(".ordax-settings-view", css)
        self.assertIn("surface.preferences", web_main)
        self.assertIn("surface.preferences", native_main)
        self.assertIn("networkManagement,", native_main)
        self.assertIn("createPreferenceSyncRuntime", web_main)
        self.assertIn("createPreferenceSyncRuntime", native_main)
        self.assertIn("preferenceSync", web_main)
        self.assertIn("preferenceSync", native_main)
        self.assertIn("createWebSyncStateStore", web_main)
        self.assertIn("createNativeSyncStateStore", native_main)
        self.assertIn("syncStateStore", web_main)
        self.assertIn("syncStateStore", native_main)
        self.assertIn("createWorkspaceMetadataBridge", web_main)
        self.assertIn("createWorkspaceMetadataBridge", native_main)
        self.assertIn("workspaceMetadata.store", web_main)
        self.assertIn("workspaceMetadata.store", native_main)
        self.assertIn("workspaceMetadata.source", web_main)
        self.assertIn("workspaceMetadata.source", native_main)
        self.assertNotIn("localStorage", overview)
        self.assertNotIn("/__ordax/native/preferences", overview)
        self.assertNotIn("/__ordax/native/network-management", overview)
        self.assertNotIn("localStorage", overview)

    def test_account_uses_formal_shared_overview_and_neutral_identity_ports(self):
        account = APP_OWNERS["account"].read_text(encoding="utf-8")
        overview = ACCOUNT_OVERVIEW_CONTROLS.read_text(encoding="utf-8")
        session_contract = IDENTITY_SESSION_CONTRACT.read_text(encoding="utf-8")
        actions_contract = IDENTITY_ACTIONS_CONTRACT.read_text(encoding="utf-8")
        session_adapter = WEB_IDENTITY_ADAPTER.read_text(encoding="utf-8")
        actions_adapter = WEB_IDENTITY_ACTIONS_ADAPTER.read_text(encoding="utf-8")
        css = (SURFACE / "account.css").read_text(encoding="utf-8")
        web_html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        native_html = (NATIVE_COMPOSITION / "index.html").read_text(encoding="utf-8")

        self.assertIn('kind: "extension"', account)
        self.assertIn('extensionId: "account-overview"', account)
        self.assertIn("contracts/app-activation.mjs", overview)
        self.assertIn("contracts/identity-session.mjs", overview)
        self.assertIn("contracts/identity-actions.mjs", overview)
        self.assertNotIn("contracts/surface-host.mjs", overview)
        self.assertNotIn("services/sync/runtime.mjs", overview)
        self.assertIn("contracts/sync-runtime.mjs", overview)
        self.assertIn("assertSyncRuntimePort", overview)
        self.assertIn('id: "overview"', overview)
        self.assertIn('id: "sync"', overview)
        self.assertIn("validAccountSection", overview)
        self.assertIn("pendingMutationCount", overview)
        self.assertIn("queuePersistence", overview)
        self.assertIn("contracts/workspace-metadata-source.mjs", overview)
        self.assertIn("assertWorkspaceMetadataSource", overview)
        self.assertIn("lifecycle.localization", overview)
        self.assertIn('t("account.card.workspace")', overview)
        self.assertIn('t("account.card.queueDurable.detail")', overview)
        self.assertIn('t(`account.section.${activeSection}.subtitle`)', overview)
        account_catalog = ACCOUNT_LOCALIZATION_CATALOG.read_text(encoding="utf-8")
        self.assertIn('"account.card.workspace": "Áreas e apps"', account_catalog)
        self.assertIn(
            "posição, tamanho, maximização e minimização continuam locais",
            account_catalog,
        )
        self.assertIn("sobrevive a reload/reinício", account_catalog)
        self.assertIn("sem afirmar envio à nuvem", account_catalog)
        self.assertNotIn('"Sincronização segura"', overview)
        self.assertNotIn('"Ativa"', overview)
        self.assertIn("ordax-account-navigation", css)
        self.assertIn("ordax.identity-session/1", session_contract)
        self.assertIn("ordax.identity-actions/1", actions_contract)
        self.assertIn('state: "unavailable"', session_adapter)
        self.assertIn('SESSION_ENDPOINT = "/auth/session"', session_adapter)
        self.assertIn("actionsForSession", actions_adapter)
        self.assertIn("registrationPolicy", actions_adapter)
        self.assertIn("refreshRegistration", actions_adapter)
        self.assertIn('windowRef.fetch("/auth/logout"', actions_adapter)
        self.assertIn("registrationPolicy", overview)
        self.assertIn("registrationLegalAccepted", overview)
        self.assertIn("data-account-registration-legal-acceptance", overview)
        self.assertIn('t("account.registration.legal.privacy")', overview)
        self.assertIn('t("account.registration.legal.terms")', overview)
        self.assertIn(".ordax-account-view", css)
        self.assertIn("../../surface/ui/account.css", web_html)
        self.assertIn("../../surface/ui/account.css", native_html)
        self.assertNotIn("adapters/native", overview)
        self.assertNotIn("adapters/web", overview)
        self.assertNotIn("surface/ui", session_adapter)
        self.assertNotIn("surface/ui", actions_adapter)

    def test_native_power_controls_are_shared_and_capability_driven(self):
        contract = POWER_ACTIONS_CONTRACT.read_text(encoding="utf-8")
        controls = POWER_CONTROLS.read_text(encoding="utf-8")
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        adapter = NATIVE_POWER_ADAPTER.read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        native_html = (NATIVE_COMPOSITION / "index.html").read_text(encoding="utf-8")
        web_main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")

        self.assertIn("ordax.power-actions/1", contract)
        self.assertIn('"restart"', contract)
        self.assertIn('"shutdown"', contract)
        self.assertIn("assertPowerActionsPort", controls)
        self.assertIn('"power.controls.restart.confirm"', controls)
        self.assertIn('"power.controls.shutdown.confirm"', controls)
        self.assertIn("dataset.powerAction", controls)
        self.assertIn("[data-power-slot]", controls)
        self.assertIn("data-power-slot", shell)
        self.assertIn("createNativePowerActions", native_main)
        self.assertIn("../../surface/ui/surface.mjs", native_main)
        self.assertIn("../../surface/ui/power-controls.mjs", native_main)
        self.assertIn("../../surface/ui/tokens.css", native_html)
        self.assertIn("../../surface/ui/surface.css", native_html)
        self.assertNotIn("<style", native_html.lower())
        self.assertIn("contracts/power-actions.mjs", adapter)
        self.assertIn("contracts/surface-render-lifecycle.mjs", controls)
        self.assertIn("assertSurfaceRenderLifecycle", controls)
        self.assertIn("localization.subscribe", controls)
        self.assertIn("mountPowerControls(root, powerActions, surface)", native_main)
        self.assertIn("/__ordax/native/session", adapter)
        self.assertIn("/__ordax/native/power", adapter)
        self.assertNotIn("surface/ui", adapter)
        self.assertNotIn("innerHTML", adapter)
        self.assertNotIn("adapters/native", web_main)
        self.assertNotIn("power-actions", web_main)

    def test_native_composition_reports_rendered_surface_liveness_locally(self):
        adapter = NATIVE_SURFACE_HEARTBEAT_ADAPTER.read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        self.assertIn('/__ordax/native/surface-heartbeat', adapter)
        self.assertIn("nativeSurfaceSourceSha", adapter)
        self.assertIn("new URL(windowRef.location.href)", adapter)
        self.assertIn("createNativeSurfaceHeartbeat", native_main)
        self.assertIn("surfaceHeartbeat.dispose()", native_main)
        self.assertNotIn("http://", adapter)
        self.assertNotIn("https://", adapter)

    def test_update_center_distinguishes_git_head_from_surface_runtime(self):
        controls = UPDATE_CONTROLS.read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW_CONTROLS.read_text(encoding="utf-8")
        presentation = UPDATE_PRESENTATION.read_text(encoding="utf-8")
        contract = (ROOT / "system" / "contracts" / "update-status.mjs").read_text(encoding="utf-8")
        self.assertIn("runtimeSurfaceSha", contract)
        self.assertIn("updateSnapshot.runtimeSurfaceSha", overview)
        self.assertIn('t("system.overview.delivery.number"', overview)
        self.assertIn("America/Bahia", overview)
        self.assertIn('t("system.updates.fact.runtimeSurface")', overview)
        self.assertIn('target: "updates"', controls)

    def test_shared_preference_path_has_no_platform_storage_shortcut(self):
        paths = [
            APPEARANCE,
            PREFERENCE_CATALOG,
            APP_OWNERS["settings"],
            SURFACE / "surface-state.mjs",
            SURFACE / "surface.mjs",
            PREFERENCE_STORE_CONTRACT,
        ]
        for path in paths:
            text = path.read_text(encoding="utf-8")
            for forbidden in (
                "localStorage",
                "sessionStorage",
                "navigator.",
                "adapters/web",
                "adapters/mobile",
                "adapters/desktop",
                "adapters/native",
            ):
                self.assertNotIn(forbidden, text, path)

    def test_web_preference_adapter_owns_browser_storage(self):
        adapter = WEB_PREFERENCE_ADAPTER.read_text(encoding="utf-8")
        contract = PREFERENCE_STORE_CONTRACT.read_text(encoding="utf-8")
        composition = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        self.assertIn("localStorage", adapter)
        self.assertIn("contracts/preference-store.mjs", adapter)
        self.assertIn('"ordax.preferences.v1"', adapter)
        self.assertIn("ordax.preference-store/1", contract)
        self.assertIn("createWebPreferenceStore", composition)
        self.assertIn("identityActions", composition)
        self.assertIn("assertPreferenceStore", surface)
        self.assertIn("store.save(state.preferences)", surface)

    def test_app_source_is_platform_neutral(self):
        for path in APPS.rglob("*.mjs"):
            text = path.read_text(encoding="utf-8")
            for forbidden in (
                "adapters/web",
                "adapters/mobile",
                "adapters/desktop",
                "adapters/native",
                "navigator.",
                "window.",
            ):
                self.assertNotIn(forbidden, text, path)

    def test_workspace_state_has_window_and_preference_lifecycle(self):
        text = (SURFACE / "surface-state.mjs").read_text(encoding="utf-8")
        for action in (
            'case "app.launch"',
            'case "window.focus"',
            'case "window.minimize"',
            'case "window.maximize"',
            'case "window.close"',
            'case "workspace.show-desktop"',
            'case "preference.set"',
        ):
            self.assertIn(action, text)
        self.assertIn("isAppAvailable", text)
        self.assertIn("recoverPreferenceSnapshot", text)
        self.assertIn("setPreferenceValue", text)
        self.assertNotIn("platform", text.lower())
        self.assertNotIn("navigator.", text)

    def test_web_composition_is_wiring_not_visual_fork(self):
        main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        html = (COMPOSITION / "index.html").read_text(encoding="utf-8")
        self.assertIn("../../surface/ui/surface.mjs", main)
        self.assertIn("../../adapters/web/runtime.mjs", main)
        self.assertIn("../../adapters/web/preferences.mjs", main)
        self.assertIn("../../adapters/web/identity.mjs", main)
        self.assertIn("../../adapters/web/identity-actions.mjs", main)
        self.assertIn("createWebIdentitySession", main)
        self.assertIn("createWebIdentityActions", main)
        self.assertIn("validateAccountRuntime", main)
        self.assertIn("../../surface/ui/tokens.css", html)
        self.assertIn("../../surface/ui/surface.css", html)
        self.assertIn("../../surface/ui/files.css", html)
        self.assertNotIn("../../apps/notes/notes.css", html)
        self.assertIn("../../surface/ui/system.css", html)
        self.assertIn("../../surface/ui/account.css", html)
        self.assertIn("../../surface/ui/settings.css", html)
        self.assertNotIn("<style", html.lower())

    def test_visual_surface_has_no_remote_asset_or_runtime_dependency(self):
        roots = [SURFACE, APPS, ROOT / "system" / "components", COMPOSITION, NATIVE_COMPOSITION, PREFERENCES]
        for path in [item for root in roots for item in root.rglob("*")]:
            if not path.is_file():
                continue
            # Binary assets are discovered by the offline source graph, not decoded
            # as source code. The wallpaper is independently pinned by SHA-256.
            if path.suffix in ('.png', '.woff2'):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            # XML namespace identifiers do not request network resources.
            if path.suffix == '.svg':
                text = text.replace('xmlns="http://www.w3.org/2000/svg"', '')
            self.assertNotIn("http://", text, path)
            self.assertNotIn("https://", text, path)
            self.assertNotIn("cdn.", text.lower(), path)

    def test_web_adapter_exposes_host_contract_not_shared_ui(self):
        text = WEB_ADAPTER.read_text(encoding="utf-8")
        self.assertIn("contracts/surface-host.mjs", text)
        self.assertIn('"network.https"', text)
        self.assertNotIn("surface/ui", text)
        self.assertNotIn("innerHTML", text)

    def test_desktop_identity_shell_is_shared_semantic_and_non_remote(self):
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "surface.css").read_text(encoding="utf-8")
        tokens = (SURFACE / "tokens.css").read_text(encoding="utf-8")
        for app_id in ("files", "internet", "settings", "account", "system"):
            self.assertIn(f'railButton("{app_id}"', shell)
        self.assertIn("data-power-slot", shell)
        self.assertIn("data-update-slot", shell)
        self.assertIn("data-ordax-clock", shell)
        self.assertIn("data-ordax-tray-clock", shell)
        self.assertIn("data-battery-tray", shell)
        self.assertIn("data-battery-icon", shell)
        self.assertIn("data-battery-label", shell)
        self.assertIn('data-quick-panel-toggle="battery"', shell)
        self.assertIn('data-quick-panel="battery"', shell)
        self.assertIn("data-connectivity-icon", shell)
        self.assertIn("ordax-network-symbol-wifi", shell)
        self.assertIn("ordax-network-symbol-ethernet", shell)
        self.assertIn('data-signal-level="0"', shell)
        self.assertIn('data-quick-panel-toggle="network"', shell)
        self.assertIn('data-quick-panel-toggle="datetime"', shell)
        self.assertIn('data-quick-panel="network"', shell)
        self.assertIn('data-quick-panel="datetime"', shell)
        self.assertNotIn('data-connectivity-tray data-launch-app="settings"', shell)
        self.assertIn("ordax-system-tray", shell)
        self.assertIn('SURFACE_TIME_ZONE = "America/Bahia"', shell)
        self.assertIn("REGIONAL_TIME_ZONE_PREFERENCE_ID", shell)
        self.assertIn("regionalSettings(preferencePort?.getSnapshot() ?? {})", shell)
        self.assertIn("timeZoneNode.textContent = timeZone", shell)
        self.assertIn("trayTimeNode.textContent = formattedTime", shell)
        self.assertIn("quickTimeNode.textContent = formattedTime", shell)
        self.assertIn("quickDateNode.textContent", shell)
        self.assertIn('const connectivityIcon = root.querySelector("[data-connectivity-icon]")', surface)
        self.assertIn("connectivityIcon.dataset.state = state.connectivity", surface)
        self.assertIn("data-launcher-query", shell)
        self.assertIn("Ctrl + K", shell)
        self.assertIn("ordax-brand-symbol", shell)
        self.assertIn("ordax-home-hero", shell)
        self.assertIn("data-show-desktop", shell)
        self.assertIn("ordax-home-action-grid", shell)
        self.assertIn("--ordax-accent: #8dbbff", tokens)
        self.assertIn("--ordax-font-display", tokens)
        self.assertIn(".ordax-home-panel", (SURFACE / "identity.css").read_text(encoding="utf-8"))
        self.assertIn(".ordax-rail", css)
        self.assertIn(".ordax-statusbar", css)
        self.assertIn(".ordax-wifi-arc-outer", css)
        self.assertIn(".ordax-battery-segment", css)
        self.assertIn(".ordax-battery-bolt", css)
        self.assertIn('[data-network-kind="ethernet"]', css)
        self.assertIn(".ordax-quick-panel-layer", css)
        self.assertIn(".ordax-quick-panel-datetime", css)
        self.assertIn(".ordax-quick-panel-battery", css)

    def test_system_tray_quick_panels_are_shared_accessible_and_platform_neutral(self):
        controller = SYSTEM_TRAY_QUICK_PANELS.read_text(encoding="utf-8")
        network = NETWORK_QUICK_PANEL.read_text(encoding="utf-8")
        battery = BATTERY_QUICK_PANEL.read_text(encoding="utf-8")
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        native_main = (NATIVE_COMPOSITION / "main.mjs").read_text(encoding="utf-8")
        web_main = (COMPOSITION / "main.mjs").read_text(encoding="utf-8")

        self.assertIn("data-quick-panel-toggle", controller)
        self.assertIn('event.key === "Escape"', controller)
        self.assertIn("ordax:quick-panel-open", controller)
        self.assertIn("ordax:quick-panel-close", controller)
        self.assertIn("aria-expanded", controller)
        self.assertIn("assertNetworkManagementPort", network)
        self.assertIn("assertNetworkStatusPort", network)
        self.assertIn("assertSurfaceRenderLifecycle", network)
        self.assertIn('t("network.quick.action.scan")', network)
        self.assertIn('t("network.quick.action.connect")', network)
        self.assertIn('t("network.quick.action.disconnect")', network)
        self.assertIn('t("network.quick.action.reconnect")', network)
        self.assertIn('t("network.quick.settings")', network)
        network_i18n = NETWORK_I18N.read_text(encoding="utf-8")
        self.assertIn('"network.quick.action.scan": "Procurar redes"', network_i18n)
        self.assertIn('"network.quick.action.scan": "Find networks"', network_i18n)
        self.assertIn('"network.quick.settings": "Open network settings"', network_i18n)
        self.assertIn('settings.dataset.appTarget = "network"', network)
        self.assertNotIn('"Esquecer"', network)
        self.assertIn('input.type = "password"', network)
        self.assertIn('input.autocomplete = "off"', network)
        self.assertIn('input.value = ""', network)
        self.assertIn("passwordDraft", network)
        self.assertIn("captureInteraction", network)
        self.assertIn("restoreInteraction", network)
        for forbidden in ("localStorage", "sessionStorage", "/__ordax/native/", "telemetry"):
            self.assertNotIn(forbidden, network)
        self.assertIn("assertPowerStatusPort", battery)
        self.assertIn("assertSurfaceRenderLifecycle", battery)
        self.assertIn("validatePowerStatusSnapshot", battery)
        self.assertIn("lastSnapshot", battery)
        self.assertIn("lastSuccessAt", battery)
        self.assertIn("powerObservation", battery)
        self.assertIn('root.querySelector("[data-quick-battery-power]")', battery)
        self.assertIn('t("power.quick.unavailable.state")', battery)
        self.assertIn("externalPowerMessageId", battery)
        power_i18n = POWER_I18N.read_text(encoding="utf-8")
        self.assertIn('"power.external.connected": "Conectada"', power_i18n)
        self.assertIn('"power.external.connected": "Connected"', power_i18n)
        localization = SURFACE_LOCALIZATION.read_text(encoding="utf-8")
        self.assertIn('"shell.quick.powerSource": "Fonte de energia"', localization)
        self.assertIn("data-ordax-power-source-label", shell)
        self.assertNotIn("/__ordax/native/", battery)
        self.assertIn("mountBatteryQuickPanel", native_main)
        self.assertIn('reportClientDiagnostic("battery-quick-panel", error)', native_main)
        self.assertIn("batteryQuickPanel?.destroy()", native_main)
        self.assertIn("mountSystemTrayQuickPanels", native_main)
        self.assertIn("mountNetworkQuickPanel", native_main)
        self.assertIn("mountSystemTrayQuickPanels", web_main)
        self.assertIn("mountNetworkQuickPanel(root, null, null, surface)", web_main)

    def test_windows_center_by_default_and_maximize_to_full_workspace(self):
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        css = (SURFACE / "surface.css").read_text(encoding="utf-8")
        self.assertIn('inset: 0;\n  pointer-events: none;', css)
        self.assertIn('top: calc(50% + var(--ordax-window-offset) / 3);', css)
        self.assertIn('left: calc(50% + var(--ordax-window-offset) / 2);', css)
        self.assertIn('transform: translate(-50%, -50%);', css)
        self.assertIn('.ordax-window[data-maximized="true"] {', css)
        self.assertIn('.ordax-window[data-maximized="true"] .ordax-window-body', css)
        self.assertIn('height: calc(100% - 58px);', css)
        self.assertIn('((placementOrdinal - 1) % 5) * 18', surface)
        self.assertNotIn('inset: 8px 12px;', css)
        self.assertNotIn('transform: translateY(4px);', css)

    def test_surface_baseline_is_accessible_responsive_windowed_and_themeable(self):
        surface = (SURFACE / "surface.mjs").read_text(encoding="utf-8")
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        power = POWER_CONTROLS.read_text(encoding="utf-8")
        css = (SURFACE / "surface.css").read_text(encoding="utf-8")
        tokens = (SURFACE / "tokens.css").read_text(encoding="utf-8")
        self.assertIn('aria-live="polite"', shell)
        localization = SURFACE_LOCALIZATION.read_text(encoding="utf-8")
        self.assertIn('"shell.statusbar.aria": "Estado e áreas da Surface"', localization)
        self.assertIn('aria-label="${t("shell.statusbar.aria")}"', shell)
        self.assertIn('role="dialog"', shell)
        self.assertIn("data-window-layer", shell)
        self.assertIn('event.key === "Escape"', surface)
        self.assertIn('event.key.toLocaleLowerCase() === "k"', surface)
        self.assertIn("root.dataset.ordaxTheme", surface)
        self.assertIn("root.dataset.ordaxContrast", surface)
        self.assertIn("root.dataset.ordaxMotion", surface)
        self.assertIn("documentElement.dataset.ordaxTextScale", surface)
        self.assertIn("delete documentElement.dataset.ordaxTextScale", surface)
        self.assertIn("data-preference-id", surface)
        self.assertNotIn("dataset.identityAction", surface)
        self.assertNotIn("IDENTITY_LABELS", surface)
        self.assertNotIn("IDENTITY_ACTION_LABELS", surface)
        self.assertIn('role", "dialog"', power)
        self.assertIn('aria-live", "polite"', power)
        self.assertIn('[data-ordax-theme="dark"]', tokens)
        self.assertIn('[data-ordax-theme="light"]', tokens)
        self.assertIn('[data-ordax-theme="light"][data-ordax-contrast="high"]', tokens)
        self.assertIn('[data-ordax-theme="dark"][data-ordax-contrast="high"]', tokens)
        self.assertIn("color-scheme: light", tokens)
        self.assertIn("@media (max-width: 760px)", css)
        self.assertIn("prefers-reduced-motion", css)
        self.assertIn('[data-ordax-motion="reduced"] *', css)
        self.assertIn('[data-ordax-motion="standard"] .ordax-window', css)
        self.assertIn('html[data-ordax-text-scale="standard"]', tokens)
        self.assertIn('html[data-ordax-text-scale="large"]', tokens)
        self.assertIn('html[data-ordax-text-scale="extra-large"]', tokens)
        self.assertIn('font-size: 125%', tokens)
        self.assertIn('.ordax-window[data-maximized="true"]', css)
        self.assertIn('.ordax-preference-choice[data-selected="true"]', css)

    def test_web_candidate_rebuilds_when_shared_and_native_product_sources_change(self):
        workflow = WEB_WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("'system/apps/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/services/account/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/services/preferences/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/preference-store.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/preference-runtime.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/sync-runtime.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/sync-state-store.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/workspace-metadata-source.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/identity-session.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/identity-actions.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/power-actions.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/contracts/app-activation.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'system/services/apps/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/adapters/native/**'"), 2)
        self.assertGreaterEqual(workflow.count("'system/composition/native/**'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_surface_preferences.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_identity_session.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_identity_actions.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_power_actions.mjs'"), 2)
        self.assertGreaterEqual(workflow.count("'tests/test_account_runtime.mjs'"), 2)
        self.assertIn("system/adapters/native", workflow)
        self.assertIn("system/composition/native", workflow)
        self.assertIn("node --test tests/test_power_actions.mjs", workflow)
        self.assertIn("node --test tests/test_app_activation.mjs", workflow)
        self.assertIn("node --test tests/test_app_contract.mjs", workflow)
        self.assertIn("system/services/components", workflow)
        self.assertIn("node --test tests/test_component_manager.mjs", workflow)
        self.assertIn("python -m unittest tests.test_native_component_state -v", workflow)


if __name__ == "__main__":
    unittest.main()
