import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import {
  assertIdentityActionsPort,
  isIdentityActionSupported,
  validateIdentityActionsSnapshot,
} from "../../contracts/identity-actions.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import { assertIdentityCredentialsPort } from "../../contracts/identity-credentials.mjs";
import {
  assertSyncRuntimePort,
  validateSyncRuntimeSnapshot,
} from "../../contracts/sync-runtime.mjs";
import {
  assertWorkspaceMetadataSource,
  validateWorkspaceMetadata,
} from "../../contracts/workspace-metadata-source.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { assertSpacesPort, validateSpacesSnapshot } from "../../contracts/spaces.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import { assertProfileProvisioningPort } from "../../contracts/profile-provisioning.mjs";
import {
  assertMutableProfileActivationStatePort,
  validateProfileActivationState,
} from "../../contracts/profile-activation-state.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import {
  MEMORY_AUTO_CAPTURE_PREFERENCE_ID,
  memoryAutoCaptureEnabled,
} from "../../services/preferences/memory.mjs";
import { mountMemoryReviewControls } from "./memory-review-controls.mjs";
import { MEMORY_CONFLICT_REVIEW_SCHEMA } from "../../services/sync/memory-conflict-review.mjs";

const ACCOUNT_WINDOW_SELECTOR = '[data-window-id="account"]';
const ACCOUNT_EXTENSION_SELECTOR = '[data-app-extension="account-overview"]';

const ACCOUNT_SECTIONS = Object.freeze([
  Object.freeze({ id: "overview", messageId: "account.section.overview" }),
  Object.freeze({ id: "spaces", messageId: "account.section.spaces" }),
  Object.freeze({ id: "profiles", messageId: "account.section.profiles" }),
  Object.freeze({ id: "memory", messageId: "account.section.memory" }),
  Object.freeze({ id: "sync", messageId: "account.section.sync" }),
]);

function validAccountSection(value) {
  return ACCOUNT_SECTIONS.some((section) => section.id === value);
}

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function sessionLabel(snapshot, t) {
  if (snapshot.state === "signed-in") return t("account.identity.signedIn");
  if (snapshot.state === "signed-out") return t("account.identity.signedOut");
  return t("account.identity.unavailable");
}

function sessionDescription(snapshot, t) {
  if (snapshot.state === "signed-in") {
    return t("account.identity.description.signedIn");
  }
  if (snapshot.state === "signed-out") {
    return t("account.identity.description.signedOut");
  }
  return t("account.identity.description.unavailable");
}

function desiredAction(session, actions) {
  if (session.state === "signed-out" && isIdentityActionSupported(actions, "sign-in")) {
    return "sign-in";
  }
  if (session.state === "signed-in" && isIdentityActionSupported(actions, "sign-out")) {
    return "sign-out";
  }
  return null;
}

function appendStateCard(documentObject, container, label, value, detail, state = "neutral") {
  const card = node(documentObject, "article", "ordax-account-card");
  card.dataset.state = state;
  card.append(
    node(documentObject, "span", "ordax-account-card-label", label),
    node(documentObject, "strong", "ordax-account-card-value", value),
    node(documentObject, "small", "ordax-account-card-detail", detail),
  );
  container.append(card);
  return card;
}

export function mountAccountOverviewControls(
  root,
  identitySession,
  identityActions,
  surfaceLifecycle = null,
  syncRuntime = null,
  workspaceMetadataSource = null,
  appActivation = null,
  identityCredentials = null,
  spaces = null,
  profileProvisioning = null,
  memoryReview = null,
  spaceSelection = null,
  preferenceRuntime = null,
  profileActivationState = null,
  memoryConflictReview = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Account overview controls require a Surface root Element");
  }

  const sessionPort = assertIdentitySessionPort(identitySession);
  const actionsPort = assertIdentityActionsPort(identityActions);
  const credentialsPort = identityCredentials === null
    ? null
    : assertIdentityCredentialsPort(identityCredentials);
  const syncPort = syncRuntime === null ? null : assertSyncRuntimePort(syncRuntime);
  const workspaceMetadataPort = workspaceMetadataSource === null
    ? null
    : assertWorkspaceMetadataSource(workspaceMetadataSource);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  const spacesPort = spaces === null ? null : assertSpacesPort(spaces);
  const profileProvisioningPort = profileProvisioning === null
    ? null
    : assertProfileProvisioningPort(profileProvisioning);
  const spaceSelectionPort = spaceSelection === null
    ? null
    : assertSpaceSelectionPort(spaceSelection);
  const preferencePort = preferenceRuntime === null
    ? null
    : assertPreferenceRuntimePort(preferenceRuntime);
  const profileActivationPort = profileActivationState === null
    ? null
    : assertMutableProfileActivationStatePort(profileActivationState);
  const memoryConflictPort = memoryConflictReview === null
    ? null
    : (() => {
        if (
          typeof memoryConflictReview !== "object"
          || memoryConflictReview.schema !== MEMORY_CONFLICT_REVIEW_SCHEMA
          || typeof memoryConflictReview.getSnapshot !== "function"
          || typeof memoryConflictReview.resolve !== "function"
        ) {
          throw new TypeError("Account overview requires a compatible Memory conflict review runtime");
        }
        return memoryConflictReview;
      })();
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const documentObject = root.ownerDocument;

  let sessionSnapshot = validateIdentitySessionSnapshot(sessionPort.getSnapshot());
  let actionsSnapshot = validateIdentityActionsSnapshot(actionsPort.getSnapshot());
  let syncSnapshot = syncPort ? validateSyncRuntimeSnapshot(syncPort.getSnapshot()) : null;
  let workspaceMetadataSnapshot = workspaceMetadataPort
    ? validateWorkspaceMetadata(workspaceMetadataPort.getSnapshot())
    : null;
  let spacesSnapshot = spacesPort
    ? validateSpacesSnapshot(spacesPort.getSnapshot())
    : null;
  let spaceSelectionSnapshot = spaceSelectionPort
    ? validateSpaceSelectionSnapshot(spaceSelectionPort.getSnapshot())
    : null;
  let profilePlans = profileProvisioningPort ? profileProvisioningPort.list() : null;
  let profileActivationSnapshot = profileActivationPort
    ? validateProfileActivationState(profileActivationPort.getSnapshot())
    : null;
  let preferenceSnapshot = preferencePort?.getSnapshot() ?? null;
  let pendingAction = null;
  let pendingProfileAction = null;
  let actionMessage = "";
  let spaceMessage = "";
  let profileMessage = "";
  let memoryConflictMessage = "";
  let pendingMemoryConflict = null;
  let credentialEmailDraft = "";
  let credentialPasswordDraft = "";
  let actionOrdinal = 0;
  let activeSection = validAccountSection(lifecycle.getAppTarget("account"))
    ? lifecycle.getAppTarget("account")
    : "overview";
  let destroyed = false;
  let mountedSlot = null;
  let memoryReviewControls = null;

  const findSlot = () =>
    root.querySelector(`${ACCOUNT_WINDOW_SELECTOR} ${ACCOUNT_EXTENSION_SELECTOR}`);

  const focusIdentity = (element) => {
    if (!element || !element.dataset) return null;
    if (element.dataset.accountSection) {
      return Object.freeze({ kind: "section", value: element.dataset.accountSection });
    }
    if (element.dataset.accountIdentityAction) {
      return Object.freeze({ kind: "identity-action", value: element.dataset.accountIdentityAction });
    }
    if (element.dataset.accountSpaceSelect) {
      return Object.freeze({ kind: "space-select", value: element.dataset.accountSpaceSelect });
    }
    if (element.dataset.accountProfileAction) {
      return Object.freeze({ kind: "profile-action", value: element.dataset.accountProfileAction });
    }
    return null;
  };

  const findFocusTarget = (slot, identity) => {
    if (!identity) return null;
    for (const element of slot.querySelectorAll("button")) {
      const candidate = focusIdentity(element);
      if (
        candidate
        && candidate.kind === identity.kind
        && candidate.value === identity.value
      ) {
        return element;
      }
    }
    return null;
  };

  const captureInteractionState = (slot) => {
    const windowBody = slot.closest(".ordax-window-body");
    const activeElement = documentObject.activeElement;
    const activeInside = activeElement && slot.contains(activeElement);
    return Object.freeze({
      section: slot.dataset.accountActiveSection ?? "",
      windowScrollTop: windowBody?.scrollTop ?? 0,
      windowScrollLeft: windowBody?.scrollLeft ?? 0,
      focus: activeInside ? focusIdentity(activeElement) : null,
    });
  };

  const restoreInteractionState = (slot, snapshot) => {
    const sameSection = Boolean(snapshot) && snapshot.section === activeSection;
    if (!sameSection) return;

    const windowBody = slot.closest(".ordax-window-body");
    if (windowBody) {
      windowBody.scrollTop = snapshot.windowScrollTop;
      windowBody.scrollLeft = snapshot.windowScrollLeft;
    }

    const target = findFocusTarget(slot, snapshot.focus);
    if (!target || target.disabled) return;
    target.focus({ preventScroll: true });
  };

  const renderHeader = (view) => {
    const header = node(documentObject, "header", "ordax-account-header");
    header.append(
      node(documentObject, "span", "ordax-account-eyebrow", t("account.eyebrow")),
      node(
        documentObject,
        "h3",
        "ordax-account-title",
        t(`account.section.${activeSection}.title`),
      ),
      node(
        documentObject,
        "p",
        "ordax-account-subtitle",
        t(`account.section.${activeSection}.subtitle`),
      ),
    );
    view.append(header);
  };

  const renderSectionNavigation = (view) => {
    const navigation = node(documentObject, "nav", "ordax-account-navigation");
    navigation.setAttribute("aria-label", t("account.navigation.aria"));
    for (const section of ACCOUNT_SECTIONS) {
      const button = node(
        documentObject,
        "button",
        "ordax-account-navigation-item",
        t(section.messageId),
      );
      button.type = "button";
      button.dataset.accountSection = section.id;
      const active = activeSection === section.id;
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "page" : "false");
      navigation.append(button);
    }
    view.append(navigation);
  };

  const renderIdentity = (view) => {
    const section = node(documentObject, "section", "ordax-account-section");
    const heading = node(documentObject, "div", "ordax-account-section-heading");
    const copy = node(documentObject, "div");
    copy.append(
      node(documentObject, "span", "ordax-account-eyebrow", t("account.identity.eyebrow")),
      node(documentObject, "h4", "ordax-account-section-title", t("account.identity.title")),
      node(
        documentObject,
        "p",
        "ordax-account-subtitle",
        sessionDescription(sessionSnapshot, t),
      ),
    );

    const status = node(
      documentObject,
      "span",
      "ordax-account-status",
      sessionLabel(sessionSnapshot, t),
    );
    status.dataset.state = sessionSnapshot.state;
    heading.append(copy, status);
    section.append(heading);

    if (sessionSnapshot.state === "signed-in") {
      const identity = node(documentObject, "div", "ordax-account-identity");
      const avatar = node(
        documentObject,
        "span",
        "ordax-account-avatar",
        sessionSnapshot.displayName.trim().slice(0, 1).toLocaleUpperCase(),
      );
      const identityCopy = node(documentObject, "div", "ordax-account-identity-copy");
      identityCopy.append(
        node(documentObject, "strong", "", sessionSnapshot.displayName),
        node(
          documentObject,
          "small",
          "",
          t("account.identity.subject", { subjectId: sessionSnapshot.subjectId }),
        ),
      );
      identity.append(avatar, identityCopy);
      section.append(identity);
    }

    const action = desiredAction(sessionSnapshot, actionsSnapshot);
    const actions = node(documentObject, "div", "ordax-account-actions");

    if (sessionSnapshot.state === "signed-out" && credentialsPort) {
      const form = node(documentObject, "div", "ordax-account-credential-form");

      const emailLabel = node(documentObject, "label", "ordax-account-field");
      emailLabel.append(node(documentObject, "span", "", t("account.credentials.email")));
      const emailInput = documentObject.createElement("input");
      emailInput.type = "email";
      emailInput.autocomplete = "email";
      emailInput.maxLength = 320;
      emailInput.value = credentialEmailDraft;
      emailInput.dataset.accountCredentialEmail = "";
      emailInput.disabled = pendingAction !== null;
      emailLabel.append(emailInput);

      const passwordLabel = node(documentObject, "label", "ordax-account-field");
      passwordLabel.append(node(documentObject, "span", "", t("account.credentials.password")));
      const passwordInput = documentObject.createElement("input");
      passwordInput.type = "password";
      passwordInput.autocomplete = "current-password";
      passwordInput.maxLength = 1024;
      passwordInput.value = credentialPasswordDraft;
      passwordInput.dataset.accountCredentialPassword = "";
      passwordInput.disabled = pendingAction !== null;
      passwordLabel.append(passwordInput);

      form.append(emailLabel, passwordLabel);
      section.append(form);

      const signIn = node(
        documentObject,
        "button",
        "ordax-account-action ordax-account-action-primary",
        pendingAction === "sign-in" ? t("account.action.signingIn") : t("account.action.signIn"),
      );
      signIn.type = "button";
      signIn.dataset.accountIdentityAction = "sign-in";
      signIn.disabled = pendingAction !== null || !isIdentityActionSupported(actionsSnapshot, "sign-in");
      actions.append(signIn);

      const register = node(
        documentObject,
        "button",
        "ordax-account-action",
        pendingAction === "register" ? t("account.action.registering") : t("account.action.register"),
      );
      register.type = "button";
      register.dataset.accountIdentityAction = "register";
      register.disabled = pendingAction !== null || !isIdentityActionSupported(actionsSnapshot, "register");
      actions.append(register);
    } else if (action) {
      const label = pendingAction === action
        ? action === "sign-in"
          ? t("account.action.signingIn")
          : t("account.action.signingOut")
        : action === "sign-in"
          ? t("account.action.signIn")
          : t("account.action.signOut");
      const button = node(documentObject, "button", "ordax-account-action ordax-account-action-primary", label);
      button.type = "button";
      button.dataset.accountIdentityAction = action;
      button.disabled = pendingAction !== null;
      actions.append(button);
    } else {
      actions.append(
        node(
          documentObject,
          "span",
          "ordax-account-action-note",
          sessionSnapshot.state === "unavailable"
            ? t("account.action.unavailable")
            : t("account.action.none"),
        ),
      );
    }
    if (sessionSnapshot.state === "signed-in") {
      const exportLink = node(
        documentObject,
        "a",
        "ordax-account-action",
        t("account.action.exportData"),
      );
      exportLink.href = "/account/export";
      exportLink.download = "ordax-account-export.json";
      exportLink.dataset.accountExport = "";
      exportLink.setAttribute("aria-label", t("account.action.exportDataAria"));
      actions.append(exportLink);
    }

    section.append(actions);

    if (actionMessage) {
      section.append(node(documentObject, "p", "ordax-account-message", actionMessage));
    }
    view.append(section);
  };

  const refreshSpaces = () => {
    if (!spacesPort || sessionSnapshot.state !== "signed-in") return;
    void spacesPort.refresh().catch(() => {});
  };

  const renderSpaces = (view) => {
    const section = node(documentObject, "section", "ordax-account-section");
    section.append(
      node(documentObject, "span", "ordax-account-eyebrow", t("account.spaces.eyebrow")),
      node(documentObject, "h4", "ordax-account-section-title", t("account.spaces.title")),
      node(documentObject, "p", "ordax-account-subtitle", t("account.spaces.subtitle")),
    );

    if (sessionSnapshot.state !== "signed-in") {
      const grid = node(documentObject, "div", "ordax-account-grid");
      appendStateCard(
        documentObject,
        grid,
        t("account.spaces.status"),
        t("account.spaces.signIn"),
        t("account.spaces.signIn.detail"),
        "unavailable",
      );
      section.append(grid);
      view.append(section);
      return;
    }

    if (!spacesPort || !spacesSnapshot) {
      const grid = node(documentObject, "div", "ordax-account-grid");
      appendStateCard(
        documentObject,
        grid,
        t("account.spaces.status"),
        t("account.spaces.unavailable"),
        t("account.spaces.unavailable.detail"),
        "unavailable",
      );
      section.append(grid);
      view.append(section);
      return;
    }

    const actions = node(documentObject, "div", "ordax-account-actions");
    const refresh = node(
      documentObject,
      "button",
      "ordax-account-action",
      spacesSnapshot.state === "loading"
        ? t("account.spaces.refreshing")
        : t("account.spaces.refresh"),
    );
    refresh.type = "button";
    refresh.dataset.accountSpacesRefresh = "";
    refresh.disabled = spacesSnapshot.state === "loading";
    actions.append(refresh);
    section.append(actions);

    if (spacesSnapshot.state === "loading" || spacesSnapshot.state === "idle") {
      section.append(node(documentObject, "p", "ordax-account-message", t("account.spaces.loading")));
      view.append(section);
      return;
    }
    if (spacesSnapshot.state === "error") {
      section.append(node(documentObject, "p", "ordax-account-message", t("account.spaces.error")));
      view.append(section);
      return;
    }
    if (spacesSnapshot.state !== "ready") {
      section.append(node(documentObject, "p", "ordax-account-message", t("account.spaces.unavailable.detail")));
      view.append(section);
      return;
    }
    if (spacesSnapshot.spaces.length === 0) {
      section.append(node(documentObject, "p", "ordax-account-message", t("account.spaces.empty")));
      view.append(section);
      return;
    }

    const grid = node(documentObject, "div", "ordax-account-grid");
    for (const space of spacesSnapshot.spaces) {
      const access = space.ownerId === sessionSnapshot.subjectId
        ? t("account.spaces.access.owner")
        : t("account.spaces.access.member");
      const kind = t(`account.spaces.kind.${space.kind}`);
      const state = t(`account.spaces.state.${space.state}`);
      const detail = space.profilePack
        ? t("account.spaces.card.detailPack", {
            kind,
            state,
            access,
            pack: space.profilePack,
          })
        : t("account.spaces.card.detail", { kind, state, access });
      const isSelected = (
        spaceSelectionSnapshot?.state === "selected"
        && spaceSelectionSnapshot.selectedSpace.id === space.id
      );
      const card = appendStateCard(
        documentObject,
        grid,
        t("account.spaces.card.label"),
        space.name,
        detail,
        isSelected ? "available" : space.state === "active" ? "available" : "neutral",
      );
      if (spaceSelectionPort && space.state === "active") {
        const cardActions = node(documentObject, "div", "ordax-account-actions");
        const select = node(
          documentObject,
          "button",
          isSelected
            ? "ordax-account-action ordax-account-action-primary"
            : "ordax-account-action",
          isSelected
            ? t("account.spaces.selection.selected")
            : t("account.spaces.selection.use"),
        );
        select.type = "button";
        select.dataset.accountSpaceSelect = space.id;
        select.disabled = isSelected || spaceSelectionSnapshot?.state === "unavailable";
        if (isSelected) select.setAttribute("aria-current", "true");
        cardActions.append(select);
        card.append(cardActions);
      }
    }
    section.append(grid);
    if (spaceMessage) {
      section.append(node(documentObject, "p", "ordax-account-message", spaceMessage));
    }
    view.append(section);
  };

  const renderProfiles = (view) => {
    const section = node(documentObject, "section", "ordax-account-section");
    section.append(
      node(documentObject, "span", "ordax-account-eyebrow", t("account.profiles.eyebrow")),
      node(documentObject, "h4", "ordax-account-section-title", t("account.profiles.title")),
      node(documentObject, "p", "ordax-account-subtitle", t("account.profiles.subtitle")),
    );

    if (!profileProvisioningPort || profilePlans === null) {
      const grid = node(documentObject, "div", "ordax-account-grid");
      appendStateCard(
        documentObject,
        grid,
        t("account.profiles.status"),
        t("account.profiles.unavailable"),
        t("account.profiles.unavailable.detail"),
        "unavailable",
      );
      section.append(grid);
      view.append(section);
      return;
    }

    const selectedSpace = spaceSelectionSnapshot?.state === "selected"
      ? spaceSelectionSnapshot.selectedSpace
      : null;
    const activeRow = selectedSpace && profileActivationSnapshot
      ? profileActivationSnapshot.spaces.find((row) => row.spaceId === selectedSpace.id) ?? null
      : null;
    const activeProfile = activeRow?.current?.profile ?? null;

    if (selectedSpace === null) {
      section.append(
        node(documentObject, "p", "ordax-account-message", t("account.profiles.selectSpace")),
      );
    } else if (activeProfile) {
      section.append(
        node(
          documentObject,
          "p",
          "ordax-account-message",
          t("account.profiles.active", {
            profile: t(`account.profiles.name.${activeProfile.slug}`),
            space: selectedSpace.name,
          }),
        ),
      );
    }

    const grid = node(documentObject, "div", "ordax-account-grid");
    for (const plan of profilePlans) {
      const nameKey = `account.profiles.name.${plan.profile.slug}`;
      const stateKey = `account.profiles.state.${plan.state}`;
      const detailKey = plan.offlineAfterInstall
        ? "account.profiles.detail.offline"
        : "account.profiles.detail.online";
      const isActive = Boolean(
        activeProfile
        && activeProfile.slug === plan.profile.slug
        && activeProfile.version === plan.profile.version,
      );
      const card = appendStateCard(
        documentObject,
        grid,
        t(nameKey),
        isActive ? t("account.profiles.state.active") : t(stateKey),
        t(detailKey, {
          version: plan.profile.version,
          delivery: t(`account.profiles.delivery.${plan.deliveryMode}`),
        }),
        isActive
          ? "available"
          : plan.state === "already-provisioned"
            ? "available"
            : plan.state === "blocked"
              ? "unavailable"
              : "neutral",
      );

      if (profileActivationPort && selectedSpace) {
        const actions = node(documentObject, "div", "ordax-account-actions");
        if (isActive) {
          const deactivate = node(
            documentObject,
            "button",
            "ordax-account-action",
            pendingProfileAction === `deactivate:${selectedSpace.id}`
              ? t("account.profiles.deactivating")
              : t("account.profiles.deactivate"),
          );
          deactivate.type = "button";
          deactivate.dataset.accountProfileAction = "deactivate";
          deactivate.dataset.accountProfileSpaceId = selectedSpace.id;
          deactivate.disabled = pendingProfileAction !== null;
          actions.append(deactivate);
        } else if (plan.mayActivate === true) {
          const activate = node(
            documentObject,
            "button",
            "ordax-account-action",
            pendingProfileAction === `activate:${plan.profile.slug}`
              ? t("account.profiles.activating")
              : t("account.profiles.activate"),
          );
          activate.type = "button";
          activate.dataset.accountProfileAction = "activate";
          activate.dataset.accountProfileSlug = plan.profile.slug;
          activate.dataset.accountProfileVersion = String(plan.profile.version);
          activate.dataset.accountProfileSpaceId = selectedSpace.id;
          activate.dataset.accountProfileSpaceKind = selectedSpace.kind;
          activate.disabled = pendingProfileAction !== null;
          actions.append(activate);
        }
        if (actions.childNodes.length > 0) card.append(actions);
      }
    }
    section.append(grid);
    if (profileMessage) {
      section.append(node(documentObject, "p", "ordax-account-message", profileMessage));
    }
    view.append(section);
  };

  const renderMemory = (view) => {
    const section = node(documentObject, "section", "ordax-account-section");
    section.append(
      node(documentObject, "span", "ordax-account-eyebrow", t("account.memory.eyebrow")),
      node(documentObject, "h4", "ordax-account-section-title", t("account.memory.title")),
      node(documentObject, "p", "ordax-account-subtitle", t("account.memory.subtitle")),
    );

    if (memoryReview === null) {
      const grid = node(documentObject, "div", "ordax-account-grid");
      appendStateCard(
        documentObject,
        grid,
        t("account.memory.status"),
        t("account.memory.unavailable"),
        t("account.memory.unavailable.detail"),
        "unavailable",
      );
      section.append(grid);
      view.append(section);
      return;
    }

    if (preferencePort && preferenceSnapshot) {
      const enabled = memoryAutoCaptureEnabled(preferenceSnapshot);
      const policy = node(documentObject, "article", "ordax-account-card");
      policy.dataset.state = enabled ? "available" : "neutral";
      policy.append(
        node(documentObject, "span", "ordax-account-card-label", t("account.memory.autoCapture.label")),
        node(
          documentObject,
          "strong",
          "ordax-account-card-value",
          enabled ? t("account.memory.autoCapture.on") : t("account.memory.autoCapture.off"),
        ),
        node(documentObject, "small", "ordax-account-card-detail", t("account.memory.autoCapture.detail")),
      );
      const policyActions = node(documentObject, "div", "ordax-account-actions");
      const toggle = node(
        documentObject,
        "button",
        "ordax-account-action",
        enabled ? t("account.memory.autoCapture.disable") : t("account.memory.autoCapture.enable"),
      );
      toggle.type = "button";
      toggle.dataset.accountMemoryAutoCapture = enabled ? "off" : "on";
      toggle.setAttribute("aria-pressed", String(enabled));
      policyActions.append(toggle);
      policy.append(policyActions);
      section.append(policy);
    }

    const conflictSnapshot = memoryConflictPort?.getSnapshot() ?? null;
    if (conflictSnapshot?.conflictCount > 0) {
      const conflicts = node(documentObject, "section", "ordax-account-section");
      conflicts.dataset.accountMemoryConflicts = "";
      conflicts.append(
        node(documentObject, "h5", "ordax-account-section-title", t("account.memory.conflicts.title")),
        node(documentObject, "p", "ordax-account-subtitle", t("account.memory.conflicts.description")),
      );
      if (memoryConflictMessage) {
        conflicts.append(node(documentObject, "p", "ordax-account-subtitle", memoryConflictMessage));
      }
      const grid = node(documentObject, "div", "ordax-account-grid");
      for (const conflict of conflictSnapshot.conflicts) {
        const card = node(documentObject, "article", "ordax-account-card");
        card.dataset.state = conflict.state === "manual-resolution-required" ? "neutral" : "unavailable";
        card.append(
          node(documentObject, "span", "ordax-account-card-label", t("account.memory.conflicts.item", { id: conflict.objectId })),
          node(documentObject, "strong", "ordax-account-card-value",
            conflict.state === "manual-resolution-required"
              ? t("account.memory.conflicts.manual")
              : t("account.memory.conflicts.awaitingRemote")),
          node(documentObject, "small", "ordax-account-card-detail",
            t("account.memory.conflicts.detail", { reason: conflict.reason, revision: conflict.serverRevision })),
        );
        if (conflict.allowedDecisions.length > 0) {
          const actions = node(documentObject, "div", "ordax-account-actions");
          for (const decision of conflict.allowedDecisions) {
            const label = decision === "preserve-local-intent"
              ? t("account.memory.conflicts.preserveLocal")
              : decision === "accept-authoritative-remote"
                ? t("account.memory.conflicts.acceptRemote")
                : null;
            if (label === null) throw new Error("Memory conflict review exposed an unsupported decision");
            const button = node(documentObject, "button", "ordax-account-action", label);
            button.type = "button";
            button.dataset.accountMemoryConflictId = conflict.objectId;
            button.dataset.accountMemoryConflictDecision = decision;
            button.disabled = pendingMemoryConflict === conflict.objectId;
            actions.append(button);
          }
          card.append(actions);
        }
        grid.append(card);
      }
      conflicts.append(grid);
      section.append(conflicts);
    }

    const host = node(documentObject, "div", "ordax-memory-review-host");
    section.append(host);
    view.append(section);
    memoryReviewControls = mountMemoryReviewControls(host, memoryReview, {
      title: t("account.memory.review.title"),
      description: t("account.memory.review.description"),
      searchPlaceholder: t("account.memory.review.searchPlaceholder"),
      deviceOwner: t("account.memory.review.deviceOwner"),
      accountOwner: t("account.memory.review.accountOwner"),
      empty: t("account.memory.review.empty"),
      addPlaceholder: t("account.memory.review.addPlaceholder"),
      add: t("account.memory.review.add"),
      save: t("account.memory.review.save"),
      remove: t("account.memory.review.remove"),
      previous: t("account.memory.review.previous"),
      next: t("account.memory.review.next"),
      saving: t("account.memory.review.saving"),
      saved: t("account.memory.review.saved"),
      saveError: t("account.memory.review.saveError"),
      contentLabel: t("account.memory.review.contentLabel"),
      export: t("account.memory.review.export"),
      exported: t("account.memory.review.exported"),
      exportError: t("account.memory.review.exportError"),
    });
  };

  const renderContinuity = (view) => {
    const section = node(documentObject, "section", "ordax-account-section");
    section.append(
      node(documentObject, "span", "ordax-account-eyebrow", t("account.continuity.eyebrow")),
      node(documentObject, "h4", "ordax-account-section-title", t("account.continuity.title")),
      node(
        documentObject,
        "p",
        "ordax-account-subtitle",
        t("account.continuity.subtitle"),
      ),
    );

    const grid = node(documentObject, "div", "ordax-account-grid");
    const pendingMutationCount = syncSnapshot?.pendingMutationCount ?? 0;
    const appearanceTracked = syncSnapshot?.trackedDataClasses.includes("appearance") ?? false;
    const queueIsDurable = syncSnapshot?.queuePersistence === "device";
    const continuityActive = syncSnapshot?.accountContinuity === "active";
    const continuityTransportAvailable = syncSnapshot?.transport === "available";
    const workspaceAreaCount = workspaceMetadataSnapshot?.areas.length ?? 0;
    const workspaceAppCount = workspaceMetadataSnapshot
      ? workspaceMetadataSnapshot.areas.reduce((total, area) => total + area.appIds.length, 0)
      : 0;

    appendStateCard(
      documentObject,
      grid,
      t("account.card.accountContinuity"),
      syncSnapshot
        ? continuityActive && continuityTransportAvailable
          ? t("account.card.continuityActive")
          : syncSnapshot.transport === "host-required"
            ? t("account.card.continuityHostRequired")
            : t("account.card.continuityInactive")
        : t("account.card.unavailable"),
      syncSnapshot
        ? continuityActive && continuityTransportAvailable
          ? t("account.card.continuityActive.detail")
          : syncSnapshot.transport === "host-required"
            ? t("account.card.continuityHostRequired.detail")
            : t("account.card.continuityInactive.detail")
        : t("account.card.continuityUnavailable.detail"),
      syncSnapshot
        ? continuityActive && continuityTransportAvailable
          ? "available"
          : syncSnapshot.transport === "host-required"
            ? "unavailable"
            : "neutral"
        : "unavailable",
    );

    appendStateCard(
      documentObject,
      grid,
      t("account.card.localChanges"),
      syncSnapshot
        ? pendingMutationCount > 0
          ? t(
              pendingMutationCount === 1
                ? "account.card.pending.one"
                : "account.card.pending.many",
              { count: pendingMutationCount },
            )
          : t("account.card.noPending")
        : t("account.card.stateUnavailable"),
      syncSnapshot
        ? pendingMutationCount > 0
          ? t("account.card.pending.detail")
          : t("account.card.noPending.detail")
        : t("account.card.syncUnavailable.detail"),
      syncSnapshot ? (pendingMutationCount > 0 ? "neutral" : "available") : "unavailable",
    );

    appendStateCard(
      documentObject,
      grid,
      t("account.card.appearance"),
      appearanceTracked
        ? t("account.card.appearanceTracked")
        : t("account.card.appearanceUntracked"),
      appearanceTracked
        ? t("account.card.appearanceTracked.detail")
        : t("account.card.appearanceUntracked.detail"),
      appearanceTracked ? "available" : "neutral",
    );

    appendStateCard(
      documentObject,
      grid,
      t("account.card.workspace"),
      workspaceMetadataSnapshot
        ? t("account.card.workspaceCounts", {
            areas: t(
              workspaceAreaCount === 1
                ? "account.card.area.one"
                : "account.card.area.many",
              { count: workspaceAreaCount },
            ),
            apps: t(
              workspaceAppCount === 1
                ? "account.card.app.one"
                : "account.card.app.many",
              { count: workspaceAppCount },
            ),
          })
        : t("account.card.metadataUnavailable"),
      workspaceMetadataSnapshot
        ? t("account.card.workspace.detail")
        : t("account.card.workspaceUnavailable.detail"),
      workspaceMetadataSnapshot ? "available" : "neutral",
    );

    appendStateCard(
      documentObject,
      grid,
      t("account.card.offlineQueue"),
      syncSnapshot
        ? queueIsDurable
          ? t("account.card.queueDurable")
          : t("account.card.queueSession")
        : t("account.card.unavailable"),
      syncSnapshot
        ? queueIsDurable
          ? t("account.card.queueDurable.detail")
          : t("account.card.queueSession.detail")
        : t("account.card.queueUnavailable.detail"),
      syncSnapshot ? (queueIsDurable ? "available" : "neutral") : "unavailable",
    );

    section.append(grid);
    view.append(section);
  };

  const paint = (slot, interaction = null) => {
    memoryReviewControls?.dispose();
    memoryReviewControls = null;
    slot.replaceChildren();
    slot.dataset.ordaxAccountOverviewView = "";
    slot.dataset.accountActiveSection = activeSection;
    const view = node(documentObject, "div", "ordax-account-view");
    renderHeader(view);
    renderSectionNavigation(view);
    if (activeSection === "overview") {
      renderIdentity(view);
    } else if (activeSection === "spaces") {
      renderSpaces(view);
    } else if (activeSection === "profiles") {
      renderProfiles(view);
    } else if (activeSection === "memory") {
      renderMemory(view);
    } else if (activeSection === "sync") {
      renderContinuity(view);
    }
    slot.append(view);
    restoreInteractionState(slot, interaction);
  };

  const renderView = (force = false) => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      memoryReviewControls?.dispose();
      memoryReviewControls = null;
      mountedSlot = null;
      return;
    }
    if (!force && slot === mountedSlot) return;
    const interaction =
      force && slot === mountedSlot ? captureInteractionState(slot) : null;
    mountedSlot = slot;
    paint(slot, interaction);
  };

  const replaceView = () => renderView(true);

  const invoke = async (action) => {
    if (
      pendingAction !== null ||
      !isIdentityActionSupported(actionsSnapshot, action)
    ) {
      return;
    }
    const credentialInput = (
      credentialsPort
      && sessionSnapshot.state === "signed-out"
      && (action === "sign-in" || action === "register")
    )
      ? { email: credentialEmailDraft, password: credentialPasswordDraft }
      : null;
    credentialPasswordDraft = "";
    const ordinal = ++actionOrdinal;
    pendingAction = action;
    actionMessage = "";
    spaceMessage = "";
    replaceView();
    try {
      let credentialResult = null;
      if (credentialInput) {
        credentialResult = action === "sign-in"
          ? await credentialsPort.signIn(credentialInput)
          : await credentialsPort.register(credentialInput);
        if (typeof sessionPort.refresh === "function") {
          await sessionPort.refresh();
        }
        if (credentialResult?.confirmationRequired) {
          actionMessage = t("account.credentials.confirmationRequired");
        }
      } else {
        await actionsPort.execute(action);
      }
      if (destroyed || ordinal !== actionOrdinal) return;
    } catch {
      if (destroyed || ordinal !== actionOrdinal) return;
      actionMessage = t("account.action.failed");
    } finally {
      if (!destroyed && ordinal === actionOrdinal) {
        pendingAction = null;
        replaceView();
      }
    }
  };

  const onInput = (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !root.contains(input)) return;
    if (input.matches("[data-account-credential-email]")) {
      credentialEmailDraft = input.value;
    } else if (input.matches("[data-account-credential-password]")) {
      credentialPasswordDraft = input.value;
    }
  };

  const onClick = (event) => {
    const sectionButton = event.target.closest("[data-account-section]");
    if (
      sectionButton
      && root.contains(sectionButton)
      && validAccountSection(sectionButton.dataset.accountSection)
    ) {
      const nextSection = sectionButton.dataset.accountSection;
      actionMessage = "";
      spaceMessage = "";
      profileMessage = "";
      if (activationPort) {
        activationPort.publish({ appId: "account", target: nextSection });
      } else {
        activeSection = nextSection;
        replaceView();
        if (nextSection === "spaces") refreshSpaces();
      }
      return;
    }

    const refreshButton = event.target.closest("[data-account-spaces-refresh]");
    if (refreshButton && root.contains(refreshButton)) {
      spaceMessage = "";
      profileMessage = "";
      refreshSpaces();
      return;
    }

    const memoryConflictButton = event.target.closest("[data-account-memory-conflict-id]");
    if (memoryConflictButton && root.contains(memoryConflictButton) && memoryConflictPort) {
      const objectId = memoryConflictButton.dataset.accountMemoryConflictId;
      const decision = memoryConflictButton.dataset.accountMemoryConflictDecision;
      pendingMemoryConflict = objectId;
      memoryConflictMessage = "";
      replaceView();
      void memoryConflictPort.resolve(objectId, decision)
        .then(() => {
          memoryConflictMessage = decision === "preserve-local-intent"
            ? t("account.memory.conflicts.preserved")
            : t("account.memory.conflicts.remoteAccepted");
        })
        .catch(() => {
          memoryConflictMessage = t("account.memory.conflicts.failed");
        })
        .finally(() => {
          pendingMemoryConflict = null;
          replaceView();
        });
      return;
    }

    const memoryPolicyButton = event.target.closest("[data-account-memory-auto-capture]");
    if (memoryPolicyButton && root.contains(memoryPolicyButton) && preferencePort) {
      preferencePort.set(
        MEMORY_AUTO_CAPTURE_PREFERENCE_ID,
        memoryPolicyButton.dataset.accountMemoryAutoCapture,
      );
      return;
    }

    const spaceButton = event.target.closest("[data-account-space-select]");
    if (spaceButton && root.contains(spaceButton) && spaceSelectionPort) {
      try {
        spaceSelectionPort.select(spaceButton.dataset.accountSpaceSelect);
        spaceMessage = "";
      profileMessage = "";
      } catch {
        spaceMessage = t("account.spaces.selection.failed");
      }
      replaceView();
      return;
    }

    const profileButton = event.target.closest("[data-account-profile-action]");
    if (profileButton && root.contains(profileButton) && profileActivationPort) {
      const selectedSpace = spaceSelectionSnapshot?.state === "selected"
        ? spaceSelectionSnapshot.selectedSpace
        : null;
      if (!selectedSpace || selectedSpace.id !== profileButton.dataset.accountProfileSpaceId) {
        profileMessage = t("account.profiles.failed");
        replaceView();
        return;
      }
      const action = profileButton.dataset.accountProfileAction;
      const operationKey = action === "activate"
        ? `activate:${profileButton.dataset.accountProfileSlug ?? ""}`
        : `deactivate:${selectedSpace.id}`;
      pendingProfileAction = operationKey;
      profileMessage = "";
      replaceView();
      void (async () => {
        try {
          if (action === "activate") {
            const version = Number(profileButton.dataset.accountProfileVersion);
            if (!Number.isSafeInteger(version) || version < 1) throw new TypeError("invalid Profile version");
            const next = await profileActivationPort.activate({
              spaceId: selectedSpace.id,
              spaceKind: selectedSpace.kind,
              profile: {
                slug: profileButton.dataset.accountProfileSlug,
                version,
              },
              components: [],
            });
            profileActivationSnapshot = validateProfileActivationState(next);
            profileMessage = t("account.profiles.activated");
          } else if (action === "deactivate") {
            const next = await profileActivationPort.deactivate(selectedSpace.id);
            profileActivationSnapshot = validateProfileActivationState(next);
            profileMessage = t("account.profiles.deactivated");
          } else {
            throw new TypeError("unsupported Profile action");
          }
        } catch {
          profileMessage = t("account.profiles.failed");
        } finally {
          pendingProfileAction = null;
          if (!destroyed) replaceView();
        }
      })();
      return;
    }

    const button = event.target.closest("[data-account-identity-action]");
    if (button && root.contains(button)) {
      void invoke(button.dataset.accountIdentityAction);
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  const unsubscribeRender = lifecycle.subscribeRender(() => {
    const persistedTarget = lifecycle.getAppTarget("account");
    const nextSection = validAccountSection(persistedTarget) ? persistedTarget : "overview";
    if (nextSection !== activeSection) {
      actionMessage = "";
      spaceMessage = "";
      profileMessage = "";
    }
    activeSection = nextSection;
    renderView(false);
  });
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    if (
      activation.appId === "account"
      && activation.target !== null
      && validAccountSection(activation.target)
    ) {
      activeSection = activation.target;
      actionMessage = "";
      spaceMessage = "";
      profileMessage = "";
      replaceView();
      if (activeSection === "spaces") refreshSpaces();
    }
  });
  const unsubscribeSession = sessionPort.subscribe((snapshot) => {
    sessionSnapshot = validateIdentitySessionSnapshot(snapshot);
    if (sessionSnapshot.state !== "signed-in") {
      spacesPort?.reset();
    }
    actionMessage = "";
    replaceView();
    if (activeSection === "spaces" && sessionSnapshot.state === "signed-in") {
      refreshSpaces();
    }
  });
  const unsubscribeActions = actionsPort.subscribe((snapshot) => {
    actionsSnapshot = validateIdentityActionsSnapshot(snapshot);
    actionMessage = "";
    replaceView();
  });
  const unsubscribeSync = syncPort?.subscribe((snapshot) => {
    syncSnapshot = validateSyncRuntimeSnapshot(snapshot);
    replaceView();
  });
  const unsubscribeWorkspaceMetadata = workspaceMetadataPort?.subscribe((snapshot) => {
    workspaceMetadataSnapshot = validateWorkspaceMetadata(snapshot);
    replaceView();
  });
  const unsubscribeSpaces = spacesPort?.subscribe((snapshot) => {
    spacesSnapshot = validateSpacesSnapshot(snapshot);
    replaceView();
  });
  const unsubscribeSpaceSelection = spaceSelectionPort?.subscribe((snapshot) => {
    spaceSelectionSnapshot = validateSpaceSelectionSnapshot(snapshot);
    replaceView();
  });
  const unsubscribePreferences = preferencePort?.subscribe((snapshot) => {
    preferenceSnapshot = snapshot;
    if (activeSection === "memory") replaceView();
  });
  if (activeSection === "spaces" && sessionSnapshot.state === "signed-in") {
    refreshSpaces();
  }

  return Object.freeze({
    destroy() {
      destroyed = true;
      actionOrdinal += 1;
      pendingProfileAction = null;
      memoryReviewControls?.dispose();
      memoryReviewControls = null;
      unsubscribePreferences?.();
      unsubscribeSpaceSelection?.();
      unsubscribeSpaces?.();
      unsubscribeWorkspaceMetadata?.();
      unsubscribeSync?.();
      unsubscribeActions?.();
      unsubscribeSession?.();
      unsubscribeActivation?.();
      unsubscribeRender();
      credentialPasswordDraft = "";
      root.removeEventListener("input", onInput);
      root.removeEventListener("click", onClick);
      const slot = findSlot();
      if (slot?.dataset.ordaxAccountOverviewView !== undefined) {
        slot.replaceChildren();
        delete slot.dataset.ordaxAccountOverviewView;
      }
      mountedSlot = null;
    },
  });
}