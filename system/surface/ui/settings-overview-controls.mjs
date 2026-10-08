import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { assertLocalAiPort, validateLocalAiSnapshot } from "../../contracts/local-ai.mjs";
import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE } from "../../services/local-ai/model-candidate.generated.mjs";
import { assertNotificationsPort } from "../../contracts/notifications.mjs";
import {
  assertLocalSessionPort,
  validateLocalSessionSnapshot,
} from "../../contracts/local-session.mjs";
import {
  assertKeyboardLayoutPort,
  validateKeyboardLayoutSnapshot,
} from "../../contracts/keyboard-layout.mjs";
import {
  assertNetworkManagementPort,
  validateNetworkManagementSnapshot,
} from "../../contracts/network-management.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import {
  assertNetworkStatusPort,
  validateNetworkStatusSnapshot,
} from "../../contracts/network-status.mjs";
import {
  assertSurfaceHost,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";
import {
  networkManagementActionMessageId,
  networkManagementFailureMessageId,
  runNetworkManagementAction,
} from "../../services/network/management-runtime.mjs";
import {
  listNotificationSources,
  notificationSourceDescription,
  notificationSourceLabel,
} from "../../services/notifications/catalog.mjs";
import { KEYBOARD_LAYOUT_OPTIONS } from "../../services/input/keyboard-layout.mjs";
import { listPreferenceDefinitions } from "../../services/preferences/catalog.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

const SETTINGS_WINDOW_SELECTOR = '[data-window-id="settings"]';
const SETTINGS_EXTENSION_SELECTOR = '[data-app-extension="settings-overview"]';

const SETTINGS_SECTIONS = Object.freeze([
  Object.freeze({ id: "appearance", messageId: "settings.section.appearance" }),
  Object.freeze({ id: "accessibility", messageId: "settings.section.accessibility" }),
  Object.freeze({ id: "regional", messageId: "settings.section.regional" }),
  Object.freeze({ id: "network", messageId: "settings.section.network" }),
  Object.freeze({ id: "intelligence", messageId: "settings.section.intelligence" }),
  Object.freeze({ id: "security", messageId: "settings.section.security" }),
  Object.freeze({ id: "notifications", messageId: "settings.section.notifications" }),
]);

function validSettingsSection(value) {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatReceivedAt(value, locale) {
  if (!Number.isFinite(value)) return null;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "America/Bahia",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

const PREFERENCE_PRESENTATION_IDS = Object.freeze({
  "appearance.theme": Object.freeze({
    label: "settings.preference.appearance.label",
    title: "settings.preference.appearance.title",
    description: "settings.preference.appearance.description",
    options: Object.freeze({
      light: Object.freeze({
        label: "settings.preference.appearance.option.light",
        description: "settings.preference.appearance.option.light.description",
      }),
      dark: Object.freeze({
        label: "settings.preference.appearance.option.dark",
        description: "settings.preference.appearance.option.dark.description",
      }),
    }),
  }),
  "accessibility.contrast": Object.freeze({
    label: "settings.preference.accessibility.label",
    title: "settings.preference.contrast.title",
    description: "settings.preference.contrast.description",
    options: Object.freeze({
      standard: Object.freeze({
        label: "settings.preference.contrast.option.standard",
        description: "settings.preference.contrast.option.standard.description",
      }),
      high: Object.freeze({
        label: "settings.preference.contrast.option.high",
        description: "settings.preference.contrast.option.high.description",
      }),
    }),
  }),
  "accessibility.motion": Object.freeze({
    label: "settings.preference.accessibility.label",
    title: "settings.preference.motion.title",
    description: "settings.preference.motion.description",
    options: Object.freeze({
      standard: Object.freeze({
        label: "settings.preference.motion.option.standard",
        description: "settings.preference.motion.option.standard.description",
      }),
      reduced: Object.freeze({
        label: "settings.preference.motion.option.reduced",
        description: "settings.preference.motion.option.reduced.description",
      }),
    }),
  }),
  "accessibility.text-scale": Object.freeze({
    label: "settings.preference.accessibility.label",
    title: "settings.preference.textScale.title",
    description: "settings.preference.textScale.description",
    options: Object.freeze({
      standard: Object.freeze({
        label: "settings.preference.textScale.option.standard",
        description: "settings.preference.textScale.option.standard.description",
      }),
      large: Object.freeze({
        label: "settings.preference.textScale.option.large",
        description: "settings.preference.textScale.option.large.description",
      }),
      "extra-large": Object.freeze({
        label: "settings.preference.textScale.option.extraLarge",
        description: "settings.preference.textScale.option.extraLarge.description",
      }),
    }),
  }),
  "regional.locale": Object.freeze({
    label: "settings.preference.regional.label",
    title: "settings.preference.locale.title",
    description: "settings.preference.locale.description",
  }),
  "regional.time-zone": Object.freeze({
    label: "settings.preference.regional.label",
    title: "settings.preference.timeZone.title",
    description: "settings.preference.timeZone.description",
  }),
});

const KEYBOARD_LAYOUT_PRESENTATION_IDS = Object.freeze({
  "br-abnt2": Object.freeze({
    label: "settings.keyboard.option.brAbnt2.label",
    description: "settings.keyboard.option.brAbnt2.description",
  }),
  us: Object.freeze({
    label: "settings.keyboard.option.us.label",
    description: "settings.keyboard.option.us.description",
  }),
});

const NETWORK_CONNECTIVITY_MESSAGE_IDS = Object.freeze({
  online: "settings.network.connectivity.online",
  offline: "settings.network.connectivity.offline",
  unknown: "settings.network.connectivity.unknown",
});

const NETWORK_INTERFACE_STATE_MESSAGE_IDS = Object.freeze({
  connected: "settings.network.interface.state.connected",
  disconnected: "settings.network.interface.state.disconnected",
  unknown: "settings.network.interface.state.unknown",
});

export function mountSettingsOverviewControls(
  root,
  host,
  preferenceRuntime,
  surfaceLifecycle = null,
  networkStatus = null,
  networkManagement = null,
  appActivation = null,
  notifications = null,
  keyboardLayout = null,
  localSession = null,
  localAiPort = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Settings overview controls require a Surface root Element");
  }
  const hostPort = assertSurfaceHost(host);
  const preferences = assertPreferenceRuntimePort(preferenceRuntime);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const networkPort = networkStatus === null ? null : assertNetworkStatusPort(networkStatus);
  const networkManagementPort =
    networkManagement === null ? null : assertNetworkManagementPort(networkManagement);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  const notificationPort = notifications === null ? null : assertNotificationsPort(notifications);
  const keyboardLayoutPort =
    keyboardLayout === null ? null : assertKeyboardLayoutPort(keyboardLayout);
  const localSessionPort =
    localSession === null ? null : assertLocalSessionPort(localSession);
  const localAi = localAiPort === null ? null : assertLocalAiPort(localAiPort);
  const documentObject = root.ownerDocument;

  let hostSnapshot = validateSurfaceSnapshot(hostPort.getSnapshot());
  let preferenceSnapshot = preferences.getSnapshot();
  let networkSnapshot = null;
  let networkReadFailed = false;
  let networkLastSuccessAt = null;
  let networkManagementSnapshot = null;
  let notificationSnapshot = notificationPort?.getSnapshot() ?? null;
  let keyboardLayoutSnapshot = null;
  let keyboardLayoutReadFailed = false;
  let keyboardLayoutPending = false;
  let keyboardLayoutMessageId = null;
  let keyboardLayoutOrdinal = 0;
  let localSessionSnapshot = localSessionPort === null
    ? null
    : validateLocalSessionSnapshot(localSessionPort.getSnapshot());
  let localAiSnapshot = localAi === null ? null : validateLocalAiSnapshot(localAi.getSnapshot());
  let localSessionPending = false;
  let localSessionMessageId = null;
  let networkManagementReadFailed = false;
  let networkManagementLastSuccessAt = null;
  let networkManagementPending = false;
  let networkManagementMessageId = null;
  let networkReadOrdinal = 0;
  let networkManagementReadOrdinal = 0;
  let networkActionOrdinal = 0;
  let selectedNetworkSsid = null;
  let activeSection = validSettingsSection(lifecycle.getAppTarget("settings"))
    ? lifecycle.getAppTarget("settings")
    : "appearance";
  let destroyed = false;
  let mountedSlot = null;

  const findSlot = () =>
    root.querySelector(`${SETTINGS_WINDOW_SELECTOR} ${SETTINGS_EXTENSION_SELECTOR}`);

  const focusIdentity = (element) => {
    if (!element || !element.dataset) return null;
    if (element.dataset.settingsWifiPasswordFor) {
      return Object.freeze({
        kind: "wifi-password",
        value: element.dataset.settingsWifiPasswordFor,
      });
    }
    if (element.dataset.settingsSection) {
      return Object.freeze({ kind: "section", value: element.dataset.settingsSection });
    }
    if (element.dataset.settingsWifiSsid && !element.dataset.settingsNetworkAction) {
      return Object.freeze({ kind: "wifi-network", value: element.dataset.settingsWifiSsid });
    }
    if (element.dataset.settingsNetworkAction) {
      return Object.freeze({
        kind: "network-action",
        value: element.dataset.settingsNetworkAction,
        ssid: element.dataset.settingsWifiSsid ?? null,
      });
    }
    if (element.dataset.settingsKeyboardLayout) {
      return Object.freeze({
        kind: "keyboard-layout",
        value: element.dataset.settingsKeyboardLayout,
      });
    }
    if (element.dataset.settingsLocalSessionSecret !== undefined) {
      return Object.freeze({ kind: "local-session-secret", value: "secret" });
    }
    if (element.dataset.settingsLocalSessionConfirm !== undefined) {
      return Object.freeze({ kind: "local-session-confirm", value: "confirm" });
    }
    if (element.dataset.settingsLocalSessionCurrent !== undefined) {
      return Object.freeze({ kind: "local-session-current", value: "current" });
    }
    if (element.dataset.settingsLocalSessionAction) {
      return Object.freeze({
        kind: "local-session-action",
        value: element.dataset.settingsLocalSessionAction,
      });
    }
    if (element.dataset.settingsNotificationDnd !== undefined) {
      return Object.freeze({ kind: "notification-dnd", value: "dnd" });
    }
    if (element.dataset.settingsNotificationSource) {
      return Object.freeze({
        kind: "notification-source",
        value: element.dataset.settingsNotificationSource,
      });
    }
    if (element.dataset.settingsPreferenceId) {
      return Object.freeze({
        kind: "preference",
        value: element.dataset.settingsPreferenceId,
        option: element.dataset.settingsPreferenceValue ?? "",
      });
    }
    return null;
  };

  const findFocusTarget = (slot, identity) => {
    if (!identity) return null;
    const candidates = Array.from(slot.querySelectorAll("button, input"));
    return candidates.find((element) => {
      const candidate = focusIdentity(element);
      return candidate
        && candidate.kind === identity.kind
        && candidate.value === identity.value
        && (candidate.ssid ?? null) === (identity.ssid ?? null)
        && (candidate.option ?? "") === (identity.option ?? "");
    }) ?? null;
  };

  const captureInteractionState = (slot) => {
    const windowBody = slot.closest(".ordax-window-body");
    const passwordInput = slot.querySelector("[data-settings-wifi-password]");
    const localSessionInputs = Array.from(
      slot.querySelectorAll(
        "[data-settings-local-session-secret], [data-settings-local-session-confirm], [data-settings-local-session-current]",
      ),
    ).filter((element) => element instanceof HTMLInputElement).map((element) => ({
      identity: focusIdentity(element),
      value: element.value,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
    }));
    const activeElement = documentObject.activeElement;
    const activeInside = activeElement && slot.contains(activeElement);
    return {
      scrollTop: windowBody?.scrollTop ?? 0,
      scrollLeft: windowBody?.scrollLeft ?? 0,
      focus: activeInside ? focusIdentity(activeElement) : null,
      password:
        passwordInput instanceof HTMLInputElement
          ? {
              ssid: passwordInput.dataset.settingsWifiPasswordFor ?? "",
              value: passwordInput.value,
              selectionStart: passwordInput.selectionStart,
              selectionEnd: passwordInput.selectionEnd,
            }
          : null,
      localSessionInputs,
    };
  };

  const restoreInteractionState = (slot, snapshot) => {
    if (!snapshot) return;
    const windowBody = slot.closest(".ordax-window-body");
    if (windowBody) {
      windowBody.scrollTop = snapshot.scrollTop;
      windowBody.scrollLeft = snapshot.scrollLeft;
    }

    if (snapshot.password?.ssid) {
      const passwordInput = slot.querySelector("[data-settings-wifi-password]");
      if (
        passwordInput instanceof HTMLInputElement
        && passwordInput.dataset.settingsWifiPasswordFor === snapshot.password.ssid
      ) {
        passwordInput.value = snapshot.password.value;
        if (
          snapshot.password.selectionStart !== null
          && snapshot.password.selectionEnd !== null
        ) {
          passwordInput.setSelectionRange(
            snapshot.password.selectionStart,
            snapshot.password.selectionEnd,
          );
        }
      }
    }

    for (const inputState of snapshot.localSessionInputs ?? []) {
      const input = findFocusTarget(slot, inputState.identity);
      if (!(input instanceof HTMLInputElement) || input.disabled) continue;
      input.value = inputState.value;
      if (
        inputState.selectionStart !== null
        && inputState.selectionEnd !== null
      ) {
        input.setSelectionRange(inputState.selectionStart, inputState.selectionEnd);
      }
    }

    const focusTarget = findFocusTarget(slot, snapshot.focus);
    if (focusTarget && !focusTarget.disabled) {
      focusTarget.focus({ preventScroll: true });
    }
  };

  const renderHeader = (view) => {
    const header = node(documentObject, "header", "ordax-settings-header");
    header.append(
      node(documentObject, "span", "ordax-settings-eyebrow", t("settings.eyebrow")),
      node(documentObject, "h3", "ordax-settings-title", t(`settings.section.${activeSection}`)),
      node(
        documentObject,
        "p",
        "ordax-settings-subtitle",
        t(`settings.section.${activeSection}.subtitle`),
      ),
    );
    view.append(header);
  };

  const renderSectionNavigation = (view) => {
    const navigation = node(documentObject, "nav", "ordax-settings-navigation");
    navigation.setAttribute("aria-label", t("settings.navigation.aria"));
    for (const section of SETTINGS_SECTIONS) {
      const button = node(
        documentObject,
        "button",
        "ordax-settings-navigation-item",
        t(section.messageId),
      );
      button.type = "button";
      button.dataset.settingsSection = section.id;
      const active = activeSection === section.id;
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "page" : "false");
      navigation.append(button);
    }
    view.append(navigation);
  };

  const renderPreferences = (view, sectionId) => {
    for (const definition of listPreferenceDefinitions()) {
      if (definition.sectionId !== sectionId) continue;
      const presentation = PREFERENCE_PRESENTATION_IDS[definition.id] ?? null;
      const section = node(documentObject, "section", "ordax-settings-section");
      section.append(
        node(
          documentObject,
          "span",
          "ordax-settings-section-kicker",
          presentation?.label
            ? t(presentation.label)
            : (definition.label ?? t("settings.preference.fallbackLabel")),
        ),
        node(
          documentObject,
          "h4",
          "ordax-settings-section-title",
          presentation?.title ? t(presentation.title) : (definition.title ?? definition.id),
        ),
        node(
          documentObject,
          "p",
          "ordax-settings-section-copy",
          presentation?.description
            ? t(presentation.description)
            : (definition.description ?? definition.id),
        ),
      );

      if (Array.isArray(definition.options) && definition.options.length > 0) {
        const options = node(documentObject, "div", "ordax-settings-options");
        for (const option of definition.options) {
          const selected = preferenceSnapshot[definition.id] === option.value;
          const optionPresentation = presentation?.options?.[option.value] ?? null;
          const button = node(documentObject, "button", "ordax-settings-option");
          button.type = "button";
          button.dataset.settingsPreferenceId = definition.id;
          button.dataset.settingsPreferenceValue = option.value;
          button.dataset.selected = String(selected);
          button.setAttribute("aria-pressed", String(selected));

          const preview = node(documentObject, "span", "ordax-settings-theme-preview");
          preview.dataset.themePreview = option.value;
          preview.setAttribute("aria-hidden", "true");
          const previewRail = node(documentObject, "span", "ordax-settings-theme-rail");
          const previewBody = node(documentObject, "span", "ordax-settings-theme-body");
          preview.append(previewRail, previewBody);

          const copy = node(documentObject, "span", "ordax-settings-option-copy");
          const optionDescription = optionPresentation?.description
            ? t(optionPresentation.description)
            : definition.id === "regional.time-zone"
              ? t("settings.preference.timeZone.option.description", { value: option.value })
              : definition.id === "regional.locale" && option.value === "pt-BR"
                ? t("settings.preference.locale.option.ptBr.description")
                : String(option.value);
          copy.append(
            node(
              documentObject,
              "strong",
              "",
              optionPresentation?.label ? t(optionPresentation.label) : option.label,
            ),
            node(documentObject, "small", "", optionDescription),
          );
          const marker = node(
            documentObject,
            "span",
            "ordax-settings-option-marker",
            selected ? t("settings.preference.active") : "",
          );
          button.append(preview, copy, marker);
          options.append(button);
        }
        section.append(options);
      }
      view.append(section);
    }
  };

  const renderKeyboardLayout = (view) => {
    if (!keyboardLayoutPort) return;

    const section = node(documentObject, "section", "ordax-settings-section");
    section.dataset.settingsKeyboardLayoutSection = "";
    section.append(
      node(documentObject, "span", "ordax-settings-section-kicker", t("settings.keyboard.kicker")),
      node(documentObject, "h4", "ordax-settings-section-title", t("settings.keyboard.title")),
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        t("settings.keyboard.description"),
      ),
    );

    if (keyboardLayoutMessageId) {
      const status = node(
        documentObject,
        "p",
        "ordax-settings-keyboard-message",
        t(keyboardLayoutMessageId),
      );
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      section.append(status);
    }

    if (keyboardLayoutReadFailed && keyboardLayoutSnapshot === null) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-settings-empty",
          t("settings.keyboard.unavailable"),
        ),
      );
      view.append(section);
      return;
    }

    if (keyboardLayoutSnapshot === null) {
      section.append(
        node(documentObject, "p", "ordax-settings-empty", t("settings.keyboard.reading")),
      );
      view.append(section);
      return;
    }

    const stateCopy = keyboardLayoutSnapshot.restartRequired
      ? t("settings.keyboard.state.restartRequired")
      : t("settings.keyboard.state.applied");
    const state = node(documentObject, "p", "ordax-settings-keyboard-state", stateCopy);
    state.dataset.restartRequired = String(keyboardLayoutSnapshot.restartRequired);
    section.append(state);

    const options = node(documentObject, "div", "ordax-settings-keyboard-options");
    for (const option of KEYBOARD_LAYOUT_OPTIONS) {
      if (!keyboardLayoutSnapshot.supportedLayoutIds.includes(option.id)) continue;
      const selected = keyboardLayoutSnapshot.configuredLayoutId === option.id;
      const applied = keyboardLayoutSnapshot.appliedLayoutId === option.id;
      const presentation = KEYBOARD_LAYOUT_PRESENTATION_IDS[option.id];
      const button = node(documentObject, "button", "ordax-settings-keyboard-option");
      button.type = "button";
      button.dataset.settingsKeyboardLayout = option.id;
      button.dataset.selected = String(selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = keyboardLayoutPending;

      const copy = node(documentObject, "span", "ordax-settings-keyboard-copy");
      copy.append(
        node(
          documentObject,
          "strong",
          "",
          presentation?.label ? t(presentation.label) : option.label,
        ),
        node(
          documentObject,
          "small",
          "",
          presentation?.description ? t(presentation.description) : option.description,
        ),
      );
      const markerLabel = selected
        ? applied
          ? t("settings.keyboard.marker.inUse")
          : t("settings.keyboard.marker.nextStart")
        : applied
          ? t("settings.keyboard.marker.current")
          : "";
      button.append(
        copy,
        node(documentObject, "span", "ordax-settings-keyboard-marker", markerLabel),
      );
      options.append(button);
    }
    section.append(options);
    view.append(section);
  };

  const renderSecurity = (view) => {
    const section = node(documentObject, "section", "ordax-settings-section");
    section.dataset.settingsSecurity = "";
    section.append(
      node(
        documentObject,
        "span",
        "ordax-settings-section-kicker",
        t("settings.security.kicker"),
      ),
      node(
        documentObject,
        "h4",
        "ordax-settings-section-title",
        t("settings.security.title"),
      ),
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        t("settings.security.description"),
      ),
    );

    if (!localSessionPort || !localSessionSnapshot) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-settings-empty",
          t("settings.security.unavailable"),
        ),
      );
      view.append(section);
      return;
    }

    section.append(
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        localSessionSnapshot.credentialConfigured
          ? t("settings.security.configured")
          : t("settings.security.notConfigured"),
      ),
    );

    const form = node(documentObject, "div", "ordax-settings-security-form");
    if (!localSessionSnapshot.credentialConfigured) {
      const secret = documentObject.createElement("input");
      secret.type = "password";
      secret.autocomplete = "new-password";
      secret.minLength = 6;
      secret.maxLength = 128;
      secret.placeholder = t("settings.security.placeholder.new");
      secret.dataset.settingsLocalSessionSecret = "";
      secret.disabled = localSessionPending;
      const confirm = documentObject.createElement("input");
      confirm.type = "password";
      confirm.autocomplete = "new-password";
      confirm.minLength = 6;
      confirm.maxLength = 128;
      confirm.placeholder = t("settings.security.placeholder.confirm");
      confirm.dataset.settingsLocalSessionConfirm = "";
      confirm.disabled = localSessionPending;
      const configure = node(
        documentObject,
        "button",
        "ordax-settings-notification-action",
        localSessionPending
          ? t("settings.security.action.saving")
          : t("settings.security.action.configure"),
      );
      configure.type = "button";
      configure.dataset.settingsLocalSessionAction = "configure";
      configure.disabled = localSessionPending;
      form.append(secret, confirm, configure);
    } else {
      const lock = node(
        documentObject,
        "button",
        "ordax-settings-notification-action",
        t("settings.security.action.lock"),
      );
      lock.type = "button";
      lock.dataset.settingsLocalSessionAction = "lock";
      lock.disabled = localSessionPending;
      const current = documentObject.createElement("input");
      current.type = "password";
      current.autocomplete = "current-password";
      current.minLength = 6;
      current.maxLength = 128;
      current.placeholder = t("settings.security.placeholder.current");
      current.dataset.settingsLocalSessionCurrent = "";
      current.disabled = localSessionPending;
      const remove = node(
        documentObject,
        "button",
        "ordax-settings-notification-action",
        t("settings.security.action.remove"),
      );
      remove.type = "button";
      remove.dataset.settingsLocalSessionAction = "remove";
      remove.disabled = localSessionPending;
      form.append(lock, current, remove);
    }
    section.append(form);

    if (localSessionMessageId) {
      const message = node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        t(localSessionMessageId),
      );
      message.setAttribute("role", "status");
      message.setAttribute("aria-live", "polite");
      section.append(message);
    }
    view.append(section);
  };

  const renderNotifications = (view) => {
    const policySection = node(documentObject, "section", "ordax-settings-section");
    policySection.dataset.settingsNotifications = "";
    policySection.append(
      node(
        documentObject,
        "span",
        "ordax-settings-section-kicker",
        t("settings.notifications.presentation.kicker"),
      ),
      node(
        documentObject,
        "h4",
        "ordax-settings-section-title",
        t("settings.notifications.dnd.title"),
      ),
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        t("settings.notifications.dnd.description"),
      ),
    );

    if (!notificationPort || !notificationSnapshot) {
      policySection.append(
        node(
          documentObject,
          "p",
          "ordax-settings-empty",
          t("settings.notifications.unavailable"),
        ),
      );
      view.append(policySection);
      return;
    }

    const dndRow = node(documentObject, "div", "ordax-settings-notification-row");
    const dndCopy = node(documentObject, "span", "ordax-settings-notification-copy");
    dndCopy.append(
      node(
        documentObject,
        "strong",
        "",
        notificationSnapshot.doNotDisturb
          ? t("settings.notifications.dnd.active")
          : t("settings.notifications.dnd.inactive"),
      ),
      node(
        documentObject,
        "small",
        "",
        notificationSnapshot.doNotDisturb
          ? t("settings.notifications.dnd.activeDetail")
          : t("settings.notifications.dnd.inactiveDetail"),
      ),
    );
    const dndButton = node(
      documentObject,
      "button",
      "ordax-settings-notification-action",
      notificationSnapshot.doNotDisturb
        ? t("settings.notifications.action.disable")
        : t("settings.notifications.action.enable"),
    );
    dndButton.type = "button";
    dndButton.dataset.settingsNotificationDnd = "";
    dndButton.setAttribute("aria-pressed", String(notificationSnapshot.doNotDisturb));
    dndRow.append(dndCopy, dndButton);
    policySection.append(dndRow);

    const sourceSection = node(documentObject, "section", "ordax-settings-section");
    sourceSection.append(
      node(
        documentObject,
        "span",
        "ordax-settings-section-kicker",
        t("settings.notifications.sources.kicker"),
      ),
      node(
        documentObject,
        "h4",
        "ordax-settings-section-title",
        t("settings.notifications.sources.title"),
      ),
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        t("settings.notifications.sources.description"),
      ),
    );

    for (const source of listNotificationSources()) {
      const enabled = !notificationSnapshot.disabledSources.includes(source.id);
      const row = node(documentObject, "div", "ordax-settings-notification-row");
      row.dataset.enabled = String(enabled);
      const copy = node(documentObject, "span", "ordax-settings-notification-copy");
      copy.append(
        node(documentObject, "strong", "", notificationSourceLabel(source.id, t)),
        node(documentObject, "small", "", notificationSourceDescription(source.id, t)),
      );
      const action = node(
        documentObject,
        "button",
        "ordax-settings-notification-action",
        enabled
          ? t("settings.notifications.action.disable")
          : t("settings.notifications.action.enable"),
      );
      action.type = "button";
      action.dataset.settingsNotificationSource = source.id;
      action.setAttribute("aria-pressed", String(enabled));
      row.append(copy, action);
      sourceSection.append(row);
    }

    sourceSection.append(
      node(
        documentObject,
        "p",
        "ordax-settings-notification-persistence",
        notificationSnapshot.policyPersistence === "device"
          ? t("settings.notifications.persistence.device")
          : t("settings.notifications.persistence.session"),
      ),
    );
    view.append(policySection, sourceSection);
  };

  const renderNetworkManagement = (section) => {
    if (!networkManagementPort) return;

    const panel = node(documentObject, "div", "ordax-settings-wifi");
    panel.dataset.settingsWifi = "";

    const heading = node(documentObject, "div", "ordax-settings-wifi-heading");
    const headingCopy = node(documentObject, "div", "ordax-settings-wifi-heading-copy");
    const summary = networkManagementSnapshot?.currentSsid
      ? t("settings.network.wifi.connectedTo", {
          ssid: networkManagementSnapshot.currentSsid,
        })
      : networkManagementSnapshot?.savedSsid
        ? t("settings.network.wifi.saved", {
            ssid: networkManagementSnapshot.savedSsid,
          })
        : t("settings.network.wifi.none");
    headingCopy.append(
      node(documentObject, "strong", "", "Wi-Fi"),
      node(documentObject, "span", "", summary),
    );

    const actions = node(documentObject, "div", "ordax-settings-wifi-actions");
    const addAction = (action, messageId) => {
      const button = node(
        documentObject,
        "button",
        "ordax-settings-network-action",
        t(messageId),
      );
      button.type = "button";
      button.dataset.settingsNetworkAction = action;
      button.disabled =
        networkManagementPending
        || (networkManagementReadFailed && action !== "scan");
      actions.append(button);
    };
    addAction(
      "scan",
      networkManagementPending
        ? "network.quick.action.wait"
        : "network.quick.action.scan",
    );
    if (networkManagementSnapshot?.currentSsid) {
      addAction("disconnect", "network.quick.action.disconnect");
    }
    if (networkManagementSnapshot?.savedSsid) {
      if (!networkManagementSnapshot.currentSsid) {
        addAction("reconnect", "network.quick.action.reconnect");
      }
      addAction("forget", "settings.network.action.forget");
    }
    heading.append(headingCopy, actions);
    panel.append(heading);

    if (networkManagementMessageId) {
      const message = node(
        documentObject,
        "p",
        "ordax-settings-network-message",
        t(networkManagementMessageId),
      );
      message.setAttribute("role", "status");
      message.setAttribute("aria-live", "polite");
      panel.append(message);
    }

    if (networkManagementReadFailed && networkManagementSnapshot === null) {
      panel.append(
        node(
          documentObject,
          "p",
          "ordax-settings-empty",
          t("settings.network.management.unavailable"),
        ),
      );
      section.append(panel);
      return;
    }

    if (networkManagementReadFailed && networkManagementSnapshot !== null) {
      const receivedAt =
        formatReceivedAt(networkManagementLastSuccessAt, localization.getLocale())
        ?? t("network.time.unknown");
      panel.append(
        node(
          documentObject,
          "p",
          "ordax-settings-network-message",
          t("settings.network.management.stale", { time: receivedAt }),
        ),
      );
    }

    if (networkManagementSnapshot === null) {
      panel.append(
        node(documentObject, "p", "ordax-settings-empty", t("settings.network.management.reading")),
      );
      section.append(panel);
      return;
    }

    const networks = node(documentObject, "div", "ordax-settings-wifi-list");
    if (networkManagementSnapshot.networks.length === 0) {
      networks.append(
        node(
          documentObject,
          "p",
          "ordax-settings-empty",
          t("network.quick.empty"),
        ),
      );
    } else {
      for (const entry of networkManagementSnapshot.networks) {
        const button = node(documentObject, "button", "ordax-settings-wifi-network");
        button.type = "button";
        button.dataset.settingsWifiSsid = entry.ssid;
        button.dataset.selected = String(selectedNetworkSsid === entry.ssid);
        button.dataset.connected = String(entry.connected);
        button.disabled = networkManagementPending || networkManagementReadFailed;
        button.setAttribute("aria-pressed", String(selectedNetworkSsid === entry.ssid));

        const stateMessageId = entry.connected
          ? "network.quick.state.connected"
          : entry.saved
            ? "network.quick.state.saved"
            : "network.quick.state.available";
        const copy = node(documentObject, "span", "ordax-settings-wifi-network-copy");
        copy.append(
          node(documentObject, "strong", "", entry.ssid),
          node(
            documentObject,
            "small",
            "",
            t("settings.network.wifi.detail", {
              state: t(stateMessageId),
              signal: entry.signalDbm,
            }),
          ),
        );
        button.append(
          node(documentObject, "span", "ordax-settings-network-dot"),
          copy,
        );
        networks.append(button);
      }
    }
    panel.append(networks);

    const selected = networkManagementSnapshot.networks.find(
      (entry) => entry.ssid === selectedNetworkSsid,
    );
    if (selected && !selected.connected && !selected.saved) {
      const form = node(documentObject, "div", "ordax-settings-wifi-connect");
      const label = node(
        documentObject,
        "label",
        "ordax-settings-wifi-password-label",
        t("network.quick.passwordLabel", { ssid: selected.ssid }),
      );
      const input = node(documentObject, "input", "ordax-settings-wifi-password");
      input.type = "password";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.disabled = networkManagementPending || networkManagementReadFailed;
      input.dataset.settingsWifiPassword = "";
      input.dataset.settingsWifiPasswordFor = selected.ssid;
      input.setAttribute(
        "aria-label",
        t("network.quick.passwordLabel", { ssid: selected.ssid }),
      );
      label.append(input);

      const connect = node(
        documentObject,
        "button",
        "ordax-settings-network-action ordax-settings-network-primary",
        t(
          networkManagementPending
            ? "network.management.connect.pending"
            : "network.quick.action.connect",
        ),
      );
      connect.type = "button";
      connect.dataset.settingsNetworkAction = "connect";
      connect.dataset.settingsWifiSsid = selected.ssid;
      connect.disabled = networkManagementPending || networkManagementReadFailed;
      form.append(label, connect);
      panel.append(form);
    }

    section.append(panel);
  };

  const renderNetwork = (view) => {
    const section = node(documentObject, "section", "ordax-settings-section");
    section.dataset.settingsNetwork = "";
    section.append(
      node(documentObject, "span", "ordax-settings-section-kicker", t("settings.network.kicker")),
      node(documentObject, "h4", "ordax-settings-section-title", t("settings.network.title")),
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        t(
          networkManagementPort
            ? "settings.network.description.management"
            : "settings.network.description.observation",
        ),
      ),
    );

    const service = node(documentObject, "div", "ordax-settings-network-service");
    service.dataset.state = hostSnapshot.connectivity;
    const connectivityMessageId =
      NETWORK_CONNECTIVITY_MESSAGE_IDS[hostSnapshot.connectivity]
      ?? NETWORK_CONNECTIVITY_MESSAGE_IDS.unknown;
    service.append(
      node(documentObject, "span", "ordax-settings-network-dot"),
      node(documentObject, "strong", "", t(connectivityMessageId)),
    );
    section.append(service);

    if (networkPort) {
      if (networkReadFailed && networkSnapshot === null) {
        section.append(
          node(
            documentObject,
            "p",
            "ordax-settings-empty",
            t("settings.network.interfaces.unavailable"),
          ),
        );
      } else {
        if (networkReadFailed && networkSnapshot !== null) {
          const receivedAt =
            formatReceivedAt(networkLastSuccessAt, localization.getLocale())
            ?? t("network.time.unknown");
          section.append(
            node(
              documentObject,
              "p",
              "ordax-settings-network-message",
              t("settings.network.interfaces.stale", { time: receivedAt }),
            ),
          );
        }
        if (networkSnapshot === null) {
          section.append(
            node(documentObject, "p", "ordax-settings-empty", t("settings.network.interfaces.reading")),
          );
        } else {
          const interfaces = node(documentObject, "div", "ordax-settings-network-list");
          if (networkSnapshot.interfaces.length === 0) {
            interfaces.append(
              node(
                documentObject,
                "p",
                "ordax-settings-empty",
                t("settings.network.interfaces.empty"),
              ),
            );
          } else {
            for (const entry of networkSnapshot.interfaces) {
              const item = node(documentObject, "div", "ordax-settings-network-item");
              item.dataset.state = entry.state;
              const copy = node(documentObject, "span", "ordax-settings-network-copy");
              const kindMessageId = {
                wifi: "network.kind.wifi",
                ethernet: "network.kind.ethernet",
                other: "network.kind.other",
              }[entry.kind] ?? "network.kind.other";
              const stateMessageId =
                NETWORK_INTERFACE_STATE_MESSAGE_IDS[entry.state]
                ?? NETWORK_INTERFACE_STATE_MESSAGE_IDS.unknown;
              const detail = entry.signalDbm === null
                ? t("settings.network.interface.detail", {
                    name: entry.name,
                    state: t(stateMessageId),
                  })
                : t("settings.network.interface.detailSignal", {
                    name: entry.name,
                    state: t(stateMessageId),
                    signal: entry.signalDbm,
                  });
              copy.append(
                node(documentObject, "strong", "", t(kindMessageId)),
                node(documentObject, "small", "", detail),
              );
              item.append(node(documentObject, "span", "ordax-settings-network-dot"), copy);
              interfaces.append(item);
            }
          }
          section.append(interfaces);
        }
      }
    }
    renderNetworkManagement(section);
    view.append(section);
  };

  const renderIntelligence = (view) => {
    const section = node(documentObject, "section", "ordax-settings-section");
    section.dataset.settingsIntelligence = "";
    section.append(
      node(documentObject, "span", "ordax-settings-section-kicker", t("settings.intelligence.kicker")),
      node(documentObject, "h4", "ordax-settings-section-title", t("settings.intelligence.title")),
      node(documentObject, "p", "ordax-settings-section-description", t("settings.intelligence.description")),
    );

    // Candidate metadata is a signed-release *source pin*, not active proof.
    const pinned = BUNDLED_LOCAL_AI_MODEL_CANDIDATE;
    const pinnedInfo = node(documentObject, "p", "", t("settings.intelligence.pinned", {
      modelId: pinned.id,
      engineId: pinned.engine,
    }));
    section.append(pinnedInfo);

    const state = localAiSnapshot?.state ?? "unavailable";
    const status = node(documentObject, "p", "", t("settings.intelligence.state." + state));
    status.dataset.settingsLocalAiState = state;
    status.setAttribute("role", "status");
    section.append(status);

    if (["ready", "busy"].includes(state) && localAiSnapshot?.modelId && localAiSnapshot?.engineId) {
      section.append(node(documentObject, "p", "", t("settings.intelligence.active", {
        modelId: localAiSnapshot.modelId,
        engineId: localAiSnapshot.engineId,
      })));
    } else {
      section.append(node(documentObject, "p", "", t("settings.intelligence.notActive")));
    }
    section.append(node(documentObject, "p", "", t("settings.intelligence.selectionPolicy")));
    const open = node(documentObject, "button", "ordax-settings-intelligence-action",
      t("settings.intelligence.openStoreModels"));
    open.type = "button";
    open.dataset.settingsOpenModelStore = "true";
    open.disabled = activationPort === null;
    section.append(open);
    view.append(section);
  };

  const paint = (slot) => {
    const interaction = captureInteractionState(slot);
    slot.replaceChildren();
    slot.dataset.ordaxSettingsOverviewView = "";
    slot.dataset.settingsActiveSection = activeSection;
    const view = node(documentObject, "div", "ordax-settings-view");
    renderHeader(view);
    renderSectionNavigation(view);
    if (["appearance", "accessibility", "regional"].includes(activeSection)) {
      renderPreferences(view, activeSection);
      if (activeSection === "regional") renderKeyboardLayout(view);
    } else if (activeSection === "network") {
      renderNetwork(view);
    } else if (activeSection === "intelligence") {
      renderIntelligence(view);
    } else if (activeSection === "security") {
      renderSecurity(view);
    } else if (activeSection === "notifications") {
      renderNotifications(view);
    }
    slot.append(view);
    restoreInteractionState(slot, interaction);
  };

  const renderView = (force = false) => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      return;
    }
    if (!force && slot === mountedSlot) return;
    mountedSlot = slot;
    paint(slot);
  };

  const replaceView = () => renderView(true);

  const refreshKeyboardLayout = async () => {
    if (!keyboardLayoutPort || destroyed || keyboardLayoutPending) return;
    const ordinal = ++keyboardLayoutOrdinal;
    try {
      const nextSnapshot = validateKeyboardLayoutSnapshot(await keyboardLayoutPort.read());
      if (destroyed || ordinal !== keyboardLayoutOrdinal) return;
      const changed =
        keyboardLayoutReadFailed
        || JSON.stringify(nextSnapshot) !== JSON.stringify(keyboardLayoutSnapshot);
      keyboardLayoutSnapshot = nextSnapshot;
      keyboardLayoutReadFailed = false;
      if (changed && activeSection === "regional") replaceView();
    } catch {
      if (destroyed || ordinal !== keyboardLayoutOrdinal) return;
      const changed = !keyboardLayoutReadFailed;
      keyboardLayoutReadFailed = true;
      if (changed && activeSection === "regional") replaceView();
    }
  };

  const configureKeyboardLayout = async (layoutId) => {
    if (!keyboardLayoutPort || keyboardLayoutPending || destroyed) return;
    const ordinal = ++keyboardLayoutOrdinal;
    keyboardLayoutPending = true;
    keyboardLayoutMessageId = "settings.keyboard.message.saving";
    replaceView();
    try {
      keyboardLayoutSnapshot = validateKeyboardLayoutSnapshot(
        await keyboardLayoutPort.configure(layoutId),
      );
      if (destroyed || ordinal !== keyboardLayoutOrdinal) return;
      keyboardLayoutReadFailed = false;
      keyboardLayoutMessageId = keyboardLayoutSnapshot.restartRequired
        ? "settings.keyboard.message.savedRestart"
        : "settings.keyboard.message.savedActive";
    } catch {
      if (destroyed || ordinal !== keyboardLayoutOrdinal) return;
      keyboardLayoutMessageId = "settings.keyboard.message.saveFailed";
    } finally {
      if (!destroyed && ordinal === keyboardLayoutOrdinal) {
        keyboardLayoutPending = false;
        replaceView();
      }
    }
  };

  const refreshNetwork = async () => {
    if (!networkPort || destroyed) return;
    const ordinal = ++networkReadOrdinal;
    let changed = false;
    try {
      const nextSnapshot = validateNetworkStatusSnapshot(await networkPort.read());
      if (destroyed || ordinal !== networkReadOrdinal) return;
      changed =
        networkReadFailed ||
        JSON.stringify(nextSnapshot) !== JSON.stringify(networkSnapshot);
      networkSnapshot = nextSnapshot;
      networkReadFailed = false;
      networkLastSuccessAt = Date.now();
    } catch {
      if (destroyed || ordinal !== networkReadOrdinal) return;
      changed = !networkReadFailed;
      networkReadFailed = true;
    }
    if (changed && !destroyed && ordinal === networkReadOrdinal) replaceView();
  };

  const refreshNetworkManagement = async () => {
    if (!networkManagementPort || destroyed || networkManagementPending) return;
    const ordinal = ++networkManagementReadOrdinal;
    let changed = false;
    try {
      const nextSnapshot = validateNetworkManagementSnapshot(
        await networkManagementPort.status(),
      );
      if (destroyed || ordinal !== networkManagementReadOrdinal) return;
      changed =
        networkManagementReadFailed
        || JSON.stringify(nextSnapshot) !== JSON.stringify(networkManagementSnapshot);
      networkManagementSnapshot = nextSnapshot;
      networkManagementReadFailed = false;
      networkManagementLastSuccessAt = Date.now();
      if (
        selectedNetworkSsid !== null
        && !nextSnapshot.networks.some((entry) => entry.ssid === selectedNetworkSsid)
      ) {
        selectedNetworkSsid = null;
        changed = true;
      }
    } catch {
      if (destroyed || ordinal !== networkManagementReadOrdinal) return;
      changed = !networkManagementReadFailed;
      networkManagementReadFailed = true;
    }
    if (changed && !destroyed && ordinal === networkManagementReadOrdinal) replaceView();
  };

  const runNetworkAction = async (action, { ssid = null, password = null } = {}) => {
    if (!networkManagementPort || networkManagementPending || destroyed) return;
    const ordinal = ++networkActionOrdinal;
    networkManagementReadOrdinal += 1;
    networkManagementPending = true;
    networkManagementMessageId = networkManagementActionMessageId(action, 0);
    replaceView();

    try {
      const nextSnapshot = validateNetworkManagementSnapshot(
        await runNetworkManagementAction(
          networkManagementPort,
          action,
          action === "connect" ? { ssid, password } : null,
        ),
      );
      if (destroyed || ordinal !== networkActionOrdinal) return;
      networkManagementSnapshot = nextSnapshot;
      networkManagementReadFailed = false;
      networkManagementLastSuccessAt = Date.now();
      networkManagementMessageId = networkManagementActionMessageId(action, 1);
      if (action === "connect" || action === "forget") selectedNetworkSsid = null;
      void refreshNetwork();
    } catch (error) {
      if (destroyed || ordinal !== networkActionOrdinal) return;
      networkManagementMessageId = networkManagementFailureMessageId(action, error);
    } finally {
      if (!destroyed && ordinal === networkActionOrdinal) {
        networkManagementPending = false;
        replaceView();
      }
    }
  };

  const onClick = (event) => {
    const openModels = event.target.closest("[data-settings-open-model-store]");
    if (openModels && root.contains(openModels) && activeSection === "intelligence"
      && activationPort !== null) {
      activationPort.publish({ appId: "store", target: "models" });
      return;
    }
    const sectionButton = event.target.closest("[data-settings-section]");
    if (
      sectionButton
      && root.contains(sectionButton)
      && validSettingsSection(sectionButton.dataset.settingsSection)
    ) {
      const nextSection = sectionButton.dataset.settingsSection;
      selectedNetworkSsid = null;
      networkManagementMessageId = null;
      if (activationPort) {
        activationPort.publish({ appId: "settings", target: nextSection });
      } else {
        activeSection = nextSection;
        replaceView();
      }
      return;
    }

    const localSessionButton = event.target.closest("[data-settings-local-session-action]");
    if (
      localSessionButton
      && root.contains(localSessionButton)
      && localSessionPort
      && localSessionSnapshot
      && !localSessionPending
    ) {
      const action = localSessionButton.dataset.settingsLocalSessionAction;
      if (action === "lock") {
        localSessionMessageId = null;
        void localSessionPort.lock().catch(() => {
          localSessionMessageId = "settings.security.message.lockFailed";
          replaceView();
        });
        return;
      }

      let secret = "";
      if (action === "configure") {
        const input = root.querySelector("[data-settings-local-session-secret]");
        const confirm = root.querySelector("[data-settings-local-session-confirm]");
        if (!(input instanceof HTMLInputElement) || !(confirm instanceof HTMLInputElement)) return;
        secret = input.value;
        const confirmation = confirm.value;
        input.value = "";
        confirm.value = "";
        if (secret.length < 6 || secret !== confirmation) {
          secret = "";
          localSessionMessageId = "settings.security.message.validation";
          replaceView();
          return;
        }
      } else if (action === "remove") {
        const input = root.querySelector("[data-settings-local-session-current]");
        if (!(input instanceof HTMLInputElement)) return;
        secret = input.value;
        input.value = "";
        if (secret.length < 6) {
          secret = "";
          localSessionMessageId = "settings.security.message.currentRequired";
          replaceView();
          return;
        }
      } else {
        return;
      }

      localSessionPending = true;
      localSessionMessageId = action === "configure"
        ? "settings.security.message.creating"
        : "settings.security.message.removing";
      replaceView();
      const operationSecret = secret;
      secret = "";
      const operation = action === "configure"
        ? localSessionPort.configureCredential(operationSecret)
        : localSessionPort.removeCredential(operationSecret);
      void operation.then(() => {
        localSessionMessageId = action === "configure"
          ? "settings.security.message.configured"
          : "settings.security.message.removed";
      }).catch((error) => {
        localSessionMessageId = error?.status === 401
          ? "settings.security.message.incorrect"
          : "settings.security.message.changeFailed";
      }).finally(() => {
        localSessionPending = false;
        replaceView();
      });
      return;
    }

    const dndButton = event.target.closest("[data-settings-notification-dnd]");
    if (dndButton && root.contains(dndButton) && notificationPort && notificationSnapshot) {
      notificationPort.setDoNotDisturb(!notificationSnapshot.doNotDisturb);
      return;
    }

    const notificationSourceButton = event.target.closest("[data-settings-notification-source]");
    if (
      notificationSourceButton
      && root.contains(notificationSourceButton)
      && notificationPort
      && notificationSnapshot
    ) {
      const sourceId = notificationSourceButton.dataset.settingsNotificationSource;
      const enabled = !notificationSnapshot.disabledSources.includes(sourceId);
      notificationPort.setSourceEnabled(sourceId, !enabled);
      return;
    }

    const keyboardLayoutButton = event.target.closest("[data-settings-keyboard-layout]");
    if (keyboardLayoutButton && root.contains(keyboardLayoutButton)) {
      void configureKeyboardLayout(keyboardLayoutButton.dataset.settingsKeyboardLayout);
      return;
    }

    const preferenceButton = event.target.closest("[data-settings-preference-id]");
    if (preferenceButton && root.contains(preferenceButton)) {
      preferences.set(
        preferenceButton.dataset.settingsPreferenceId,
        preferenceButton.dataset.settingsPreferenceValue,
      );
      return;
    }

    const networkButton = event.target.closest("[data-settings-wifi-ssid]");
    if (
      networkButton
      && root.contains(networkButton)
      && !networkButton.matches("[data-settings-network-action]")
    ) {
      selectedNetworkSsid = networkButton.dataset.settingsWifiSsid ?? null;
      networkManagementMessageId = null;
      replaceView();
      return;
    }

    const actionButton = event.target.closest("[data-settings-network-action]");
    if (!actionButton || !root.contains(actionButton)) return;
    const action = actionButton.dataset.settingsNetworkAction;

    if (action === "connect") {
      const ssid = actionButton.dataset.settingsWifiSsid;
      const input = root.querySelector("[data-settings-wifi-password]");
      if (
        !(input instanceof HTMLInputElement)
        || input.dataset.settingsWifiPasswordFor !== ssid
      ) return;
      let password = input.value;
      input.value = "";
      if (!password) {
        networkManagementMessageId = "network.quick.passwordRequired";
        password = "";
        replaceView();
        return;
      }
      const operationPassword = password;
      password = "";
      void runNetworkAction("connect", { ssid, password: operationPassword });
      return;
    }

    void runNetworkAction(action);
  };

  const onKeyDown = (event) => {
    const input = event.target.closest("[data-settings-wifi-password]");
    if (!input || !root.contains(input)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const connect = root.querySelector(
        '[data-settings-network-action="connect"]',
      );
      connect?.click();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      input.value = "";
      selectedNetworkSsid = null;
      networkManagementMessageId = null;
      replaceView();
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);
  const unsubscribeRender = lifecycle.subscribeRender(() => {
    const persistedTarget = lifecycle.getAppTarget("settings");
    const nextSection = validSettingsSection(persistedTarget) ? persistedTarget : "appearance";
    if (nextSection !== activeSection) {
      selectedNetworkSsid = null;
      networkManagementMessageId = null;
    }
    activeSection = nextSection;
    renderView(false);
  });
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    if (
      activation.appId === "settings"
      && activation.target !== null
      && validSettingsSection(activation.target)
    ) {
      activeSection = activation.target;
      selectedNetworkSsid = null;
      networkManagementMessageId = null;
      replaceView();
    }
  });
  const unsubscribeHost = hostPort.subscribe((snapshot) => {
    hostSnapshot = validateSurfaceSnapshot(snapshot);
    replaceView();
  });
  const unsubscribePreferences = preferences.subscribe((snapshot) => {
    preferenceSnapshot = snapshot;
    replaceView();
  });
  const unsubscribeLocalSession = localSessionPort?.subscribe((snapshot) => {
    localSessionSnapshot = validateLocalSessionSnapshot(snapshot);
    if (activeSection === "security") replaceView();
  });
  const unsubscribeLocalAi = localAi?.subscribe((snapshot) => {
    localAiSnapshot = validateLocalAiSnapshot(snapshot);
    if (activeSection === "intelligence") replaceView();
  });
  const unsubscribeNotifications = notificationPort?.subscribe((snapshot) => {
    notificationSnapshot = snapshot;
    if (activeSection === "notifications") replaceView();
  });
  const networkPoll = networkPort
    ? setInterval(() => void refreshNetwork(), 5000)
    : null;
  const networkManagementPoll = networkManagementPort
    ? setInterval(() => void refreshNetworkManagement(), 5000)
    : null;
  if (keyboardLayoutPort) void refreshKeyboardLayout();
  if (networkPort) void refreshNetwork();
  if (networkManagementPort) void refreshNetworkManagement();

  return Object.freeze({
    destroy() {
      destroyed = true;
      networkReadOrdinal += 1;
      networkManagementReadOrdinal += 1;
      networkActionOrdinal += 1;
      keyboardLayoutOrdinal += 1;
      if (networkPoll !== null) clearInterval(networkPoll);
      if (networkManagementPoll !== null) clearInterval(networkManagementPoll);
      unsubscribeNotifications?.();
      unsubscribeLocalAi?.();
      unsubscribeLocalSession?.();
      unsubscribePreferences?.();
      unsubscribeHost?.();
      unsubscribeActivation?.();
      unsubscribeRender();
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeyDown);
      const slot = findSlot();
      if (slot?.dataset.ordaxSettingsOverviewView !== undefined) {
        slot.replaceChildren();
        delete slot.dataset.ordaxSettingsOverviewView;
      }
      mountedSlot = null;
    },
  });
}
