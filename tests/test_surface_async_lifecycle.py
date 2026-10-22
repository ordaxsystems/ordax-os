from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "system" / "surface" / "ui"


class SurfaceAsyncLifecycleTests(unittest.TestCase):
    def read(self, name):
        return (UI / name).read_text(encoding="utf-8")

    def test_account_discards_action_completion_after_destroy(self):
        controls = self.read("account-overview-controls.mjs")
        self.assertIn("let actionOrdinal = 0;", controls)
        self.assertIn("const ordinal = ++actionOrdinal;", controls)
        self.assertIn("if (destroyed || ordinal !== actionOrdinal) return;", controls)
        self.assertIn("actionOrdinal += 1;", controls)

    def test_account_preserves_read_only_interaction_across_repaints(self):
        controls = self.read("account-overview-controls.mjs")
        self.assertIn("captureInteractionState", controls)
        self.assertIn("restoreInteractionState", controls)
        self.assertIn("windowScrollTop", controls)
        self.assertIn("windowScrollLeft", controls)
        self.assertIn("snapshot.section === activeSection", controls)
        self.assertIn('kind: "section"', controls)
        self.assertIn('kind: "identity-action"', controls)
        self.assertIn("preventScroll: true", controls)
        self.assertIn("repaint && slot === mountedSlot ? captureInteractionState(slot) : null", controls)

    def test_settings_discards_stale_poll_and_action_results(self):
        controls = self.read("settings-overview-controls.mjs")
        for ordinal in (
            "networkReadOrdinal",
            "networkManagementReadOrdinal",
            "networkActionOrdinal",
        ):
            self.assertIn(f"let {ordinal} = 0;", controls)
            self.assertIn(f"{ordinal} += 1;", controls)
        self.assertIn("const ordinal = ++networkReadOrdinal;", controls)
        self.assertIn("const ordinal = ++networkManagementReadOrdinal;", controls)
        self.assertIn("const ordinal = ++networkActionOrdinal;", controls)
        self.assertIn("ordinal !== networkReadOrdinal", controls)
        self.assertIn("ordinal !== networkManagementReadOrdinal", controls)
        self.assertIn("ordinal !== networkActionOrdinal", controls)

    def test_quick_wifi_discards_stale_reads_and_actions(self):
        controls = self.read("network-quick-panel.mjs")
        for ordinal in ("statusOrdinal", "managementOrdinal", "actionOrdinal"):
            self.assertIn(f"let {ordinal} = 0;", controls)
            self.assertIn(f"{ordinal} += 1;", controls)
        self.assertIn("ordinal !== statusOrdinal", controls)
        self.assertIn("ordinal !== managementOrdinal", controls)
        self.assertIn("ordinal !== actionOrdinal", controls)

    def test_quick_wifi_preserves_transient_interaction_without_persisting_credentials(self):
        controls = self.read("network-quick-panel.mjs")
        controller = self.read("system-tray-quick-panels.mjs")
        self.assertIn('let passwordDraft = "";', controls)
        self.assertIn("captureInteraction", controls)
        self.assertIn("restoreInteraction", controls)
        self.assertIn("panelScrollTop", controls)
        self.assertIn("listScrollTop", controls)
        self.assertIn("passwordSelection", controls)
        self.assertIn('panel.addEventListener("input", onInput)', controls)
        self.assertIn('panel.addEventListener("ordax:quick-panel-close", onClose)', controls)
        self.assertIn('input.value = passwordDraftSsid === selected.ssid ? passwordDraft : "";', controls)
        self.assertIn("clearPasswordDraft()", controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("sessionStorage", controls)
        self.assertIn('new CustomEvent("ordax:quick-panel-close"', controller)

    def test_quick_wifi_keeps_last_valid_observation_distinct_from_unavailable(self):
        controls = self.read("network-quick-panel.mjs")
        self.assertIn("let statusReadFailed = false;", controls)
        self.assertIn("let statusLastSuccessAt = null;", controls)
        self.assertIn("let managementReadFailed = false;", controls)
        self.assertIn("let managementLastSuccessAt = null;", controls)
        self.assertIn("statusReadFailed = true;", controls)
        self.assertIn("managementReadFailed = true;", controls)
        self.assertNotIn("statusSnapshot = null;\n    } catch", controls)
        self.assertIn('"network.quick.networksStale"', controls)
        self.assertIn('"network.quick.summary.staleTitle"', controls)
        self.assertIn('summary.dataset.observation = statusReadFailed ? "stale" : "current"', controls)

    def test_read_only_tray_widgets_do_not_render_after_destroy(self):
        battery_quick = self.read("battery-quick-panel.mjs")
        battery_tray = self.read("battery-tray-controls.mjs")
        network_tray = self.read("network-tray-controls.mjs")
        self.assertIn("validatePowerStatusSnapshot(await port.read())", battery_quick)
        self.assertIn("if (destroyed) return;", battery_quick)
        self.assertIn("validatePowerStatusSnapshot(await port.read())", battery_tray)
        self.assertIn("if (destroyed) return;", battery_tray)
        self.assertIn("lastSnapshot", battery_quick)
        self.assertIn("lastSnapshot", battery_tray)
        self.assertIn("const snapshot = validateNetworkStatusSnapshot(await port.read());", network_tray)
        self.assertIn("if (destroyed) return;", network_tray)

    def test_power_action_completion_is_bound_to_live_controller(self):
        controls = self.read("power-controls.mjs")
        self.assertIn("let actionOrdinal = 0;", controls)
        self.assertIn("let destroyed = false;", controls)
        self.assertIn("const ordinal = ++actionOrdinal;", controls)
        self.assertGreaterEqual(
            controls.count("if (destroyed || ordinal !== actionOrdinal) return;"),
            3,
        )
        self.assertIn("actionOrdinal += 1;", controls)

    def test_power_preserves_focused_action_across_repaints(self):
        controls = self.read("power-controls.mjs")
        self.assertIn("captureFocusedAction", controls)
        self.assertIn("restoreFocusedAction", controls)
        self.assertIn('activeElement?.closest?.("[data-power-action]")', controls)
        self.assertIn("grid.contains(button)", controls)
        self.assertIn('grid.querySelectorAll("[data-power-action]")', controls)
        self.assertIn("const focusedAction = captureFocusedAction();", controls)
        self.assertIn("restoreFocusedAction(focusedAction);", controls)
        self.assertGreaterEqual(controls.count("preventScroll: true"), 2)

    def test_files_preserves_focus_selection_and_scroll_across_repaints(self):
        files = self.read("file-space-controls.mjs")
        self.assertIn("captureInteractionState", files)
        self.assertIn("restoreInteractionState", files)
        self.assertIn("windowScrollTop", files)
        self.assertIn("listScrollTop", files)
        self.assertIn("previewScrollTop", files)
        self.assertIn("selectionStart", files)
        self.assertIn("selectionEnd", files)
        self.assertIn("preventScroll: true", files)
        self.assertIn('requestFocus("directory-name")', files)
        self.assertIn('requestFocus("rename-name", selected.path)', files)
        self.assertIn('requestFocus("copy-name", selected.path)', files)
        self.assertIn('requestFocus("search")', files)
        self.assertIn('trashMode ? "trash" : recentMode ? "recent" : `path:${listing?.path ?? ""}`', files)
        self.assertIn('kind: "trash-row"', files)
        self.assertIn('context: slot.dataset.fileSpaceContext ?? ""', files)
        self.assertIn("snapshot.context === interactionContext()", files)
        self.assertIn("slot.dataset.fileSpaceContext = interactionContext()", files)
        self.assertIn('slot.dataset.fileSpacePath = recentMode || trashMode ? "" : (listing?.path ?? "")', files)
        self.assertNotIn("queueMicrotask(() => input.isConnected && input.focus())", files)

    def test_system_and_settings_defer_inactive_repaints_until_surface_focus(self):
        system = self.read("system-overview-controls.mjs")
        settings = self.read("settings-overview-controls.mjs")
        for source, selector in (
            (system, "SYSTEM_WINDOW_SELECTOR"),
            (settings, "SETTINGS_WINDOW_SELECTOR"),
        ):
            self.assertIn("let paintPending = false;", source)
            self.assertIn(f"const windowNode = slot.closest({selector});", source)
            self.assertIn("windowNode.hidden", source)
            self.assertIn('windowNode.dataset.active !== "true"', source)
            self.assertIn(
                "paintPending = paintPending || force || slot !== mountedSlot;",
                source,
            )
            self.assertIn("const unsubscribeRender = lifecycle.subscribeRender(() => {", source)
            self.assertIn("paintPending = false;", source)
            self.assertIn("const replaceView = () => renderView(true);", source)
        self.assertIn("const repaint = force || paintPending;", system)
        self.assertIn("renderView(sectionChanged);", system)
        self.assertIn("renderView(sectionChanged);", settings)
        self.assertIn("paint(slot, interaction);", system)
        self.assertIn("paint(slot);", settings)
        smoke = (ROOT / "tools/surface-native/browser-smoke.mjs").read_text(encoding="utf-8")
        self.assertIn("settingsHiddenHostUpdateSkipsRepaint", smoke)
        self.assertIn("systemHiddenHostUpdateSkipsRepaint", smoke)
        self.assertIn("settingsFocusFlushesPendingRepaint", smoke)
        self.assertIn("systemFocusFlushesPendingRepaint", smoke)

    def test_system_preserves_read_only_interaction_across_repaints(self):
        controls = self.read("system-overview-controls.mjs")
        self.assertIn("captureInteractionState", controls)
        self.assertIn("restoreInteractionState", controls)
        self.assertIn("windowScrollTop", controls)
        self.assertIn("windowScrollLeft", controls)
        self.assertIn("snapshot.section === activeSection", controls)
        self.assertIn('kind: "section"', controls)
        self.assertIn('kind: "metrics-refresh"', controls)
        self.assertIn('kind: "history-refresh"', controls)
        self.assertIn("preventScroll: true", controls)
        self.assertIn("repaint && slot === mountedSlot ? captureInteractionState(slot) : null", controls)

    def test_existing_file_and_system_async_owners_keep_ordinal_guards(self):
        files = self.read("file-space-controls.mjs")
        system = self.read("system-overview-controls.mjs")
        self.assertIn("requestOrdinal", files)
        self.assertIn("ordinal !== requestOrdinal", files)
        self.assertIn("metricsOrdinal", system)
        self.assertIn("ordinal !== metricsOrdinal", system)
        self.assertIn("historyOrdinal", system)
        self.assertIn("ordinal !== historyOrdinal", system)


    def test_quick_wifi_locale_rerender_uses_existing_interaction_snapshot_and_unsubscribes(self):
        controls = self.read("network-quick-panel.mjs")
        self.assertIn("const unsubscribeLocalization = localization.subscribe", controls)
        self.assertIn("if (!destroyed) render()", controls)
        self.assertIn("const interaction = captureInteraction()", controls)
        self.assertIn("restoreInteraction(interaction)", controls)
        self.assertIn("unsubscribeLocalization()", controls)



    def test_battery_locale_rerenders_stop_after_destroy(self):
        tray = self.read("battery-tray-controls.mjs")
        quick = self.read("battery-quick-panel.mjs")
        for controls in (tray, quick):
            self.assertIn("const unsubscribeLocalization = localization.subscribe", controls)
            self.assertIn("if (destroyed", controls)
            self.assertIn("unsubscribeLocalization()", controls)



    def test_settings_security_preserves_ephemeral_credential_only_during_repaint(self):
        controls = self.read("settings-overview-controls.mjs")
        self.assertIn("localSessionInputs", controls)
        self.assertIn("[data-settings-local-session-secret]", controls)
        self.assertIn("[data-settings-local-session-confirm]", controls)
        self.assertIn("[data-settings-local-session-current]", controls)
        self.assertIn("inputState.selectionStart", controls)
        self.assertIn("inputState.selectionEnd", controls)
        self.assertIn("input.value = inputState.value", controls)
        self.assertIn("localSessionMessageId", controls)
        self.assertNotIn("localSessionMessage = ", controls)
        capture = controls.split("const captureInteractionState = (slot) => {", 1)[1].split("\n  };", 1)[0]
        restore = controls.split("const restoreInteractionState = (slot, snapshot) => {", 1)[1].split("\n  };", 1)[0]
        for forbidden in ("localStorage", "sessionStorage", "preferences.set", "fetch("):
            self.assertNotIn(forbidden, capture + restore)



    def test_local_session_lock_locale_repaint_preserves_secret_only_transiently(self):
        lock = self.read("local-session-lock.mjs")
        self.assertIn("render({ preserveSecret: true })", lock)
        self.assertIn("const previousInput = preserveSecret", lock)
        self.assertIn("secretState", lock)
        self.assertIn("input.value = secretState.value", lock)
        self.assertIn('input.value = "";', lock)
        self.assertIn("const operationSecret = secret;", lock)
        self.assertIn('secret = "";', lock)
        self.assertIn("unsubscribeLocalization()", lock)
        for forbidden in ("localStorage", "sessionStorage", "preferences.set", "workspace"):
            self.assertNotIn(forbidden, lock)



if __name__ == "__main__":
    unittest.main()
