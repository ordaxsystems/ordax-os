import { captureSectionNavigationScroll, restoreSectionNavigationScroll, restoreSectionFocusFallback } from "./section-navigation.mjs";
import { markSurfaceFeedback } from "./surface-feedback.mjs";
import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { deriveAuthorizedSpaces } from "../../services/spaces/authorized-view.mjs";
import { readRememberedLoginEmail } from "../../services/account/remembered-login-email.mjs";
import { HOSTED_ACCOUNT_SIGNUP_URL, isHostedSignupEnabled, requestNativeHostedSignup } from "../../services/account/hosted-signup.mjs";
import { describeSpacePresentation } from "../../services/spaces/presentation.mjs";
import { SPACE_TYPE_CATALOG, getSpaceType } from "../../services/spaces/type-catalog.mjs";
import { assertSpaceCreatePort } from "../../contracts/space-create-port.mjs";
import {
  assertProjectBindingReviewPort,
  validateProjectBindingReviewSnapshot,
} from "../../contracts/project-binding-review.mjs";
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
  assertAccountLifecyclePort,
  isAccountLifecycleActionSupported,
  validateAccountLifecycleSnapshot,
} from "../../contracts/account-lifecycle.mjs";
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
import { assertSpaceExperienceSource } from "../../contracts/space-experience.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import { assertProfileProvisioningPort } from "../../contracts/profile-provisioning.mjs";
import { assertProfilePackCatalogPort } from "../../contracts/profile-pack-catalog.mjs";
import { createProfileTaxonomyView } from "../../services/profile-packs/taxonomy.mjs";
import {
  assertMutableProfileActivationStatePort,
  currentProfileForSpace,
  validateProfileActivationState,
} from "../../contracts/profile-activation-state.mjs";
import { assertMvpZeroComponentProfileReview } from "./profile-activation-review.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import {
  MEMORY_AUTO_CAPTURE_PREFERENCE_ID,
  memoryAutoCaptureEnabled,
} from "../../services/preferences/memory.mjs";
import { mountMemoryReviewControls } from "./memory-review-controls.mjs";
import { MEMORY_CONFLICT_REVIEW_SCHEMA } from "../../services/sync/memory-conflict-review.mjs";

const ACCOUNT_WINDOW_SELECTOR = '[data-window-id="account"]';
const ACCOUNT_EXTENSION_SELECTOR = '[data-app-extension="account-overview"]';
const CREATABLE_SPACE_TYPES = SPACE_TYPE_CATALOG.types.filter(type =>
  type.lifecycle === "mvp-foundation" && type.creationDefaultProfile !== null);

const ACCOUNT_SECTIONS = Object.freeze([
  Object.freeze({ id: "overview", messageId: "account.section.overview" }),
  Object.freeze({ id: "spaces", messageId: "account.section.spaces" }),
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
  accountLifecycle = null,
  profileTaxonomy = null,
  spaceExperience = null,
  hostedSignupBridge = null,
  spaceCreate = null,
  projectBindingReview = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Account overview controls require a Surface root Element");
  }

  const sessionPort = assertIdentitySessionPort(identitySession);
  // The OS composition is the only platform adapter owner. The Surface only
  // consumes an injected contract; absent authority is explicitly read-only.
  const desktopWindow = root.ownerDocument.defaultView;
  const spaceCreatePort = spaceCreate === null ? null : assertSpaceCreatePort(spaceCreate);
  const projectBindingPort = projectBindingReview === null
    ? null
    : assertProjectBindingReviewPort(projectBindingReview);
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
  const spaceExperiencePort = spaceExperience === null
    ? null
    : assertSpaceExperienceSource(spaceExperience);
  const profileProvisioningPort = profileProvisioning === null
    ? null
    : assertProfileProvisioningPort(profileProvisioning);
  const profileCategoryCatalog = profileTaxonomy === null
    ? null
    : assertProfilePackCatalogPort(profileTaxonomy.catalogPort);
  const spaceSelectionPort = spaceSelection === null
    ? null
    : assertSpaceSelectionPort(spaceSelection);
  const preferencePort = preferenceRuntime === null
    ? null
    : assertPreferenceRuntimePort(preferenceRuntime);
  const profileActivationPort = profileActivationState === null
    ? null
    : assertMutableProfileActivationStatePort(profileActivationState);
  const accountLifecyclePort = accountLifecycle === null
    ? null
    : assertAccountLifecyclePort(accountLifecycle);
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
  let selectedProfileCategory = null;
  let profileActivationSnapshot = profileActivationPort
    ? validateProfileActivationState(profileActivationPort.getSnapshot())
    : null;
  let preferenceSnapshot = preferencePort?.getSnapshot() ?? null;
  let accountLifecycleSnapshot = accountLifecyclePort
    ? validateAccountLifecycleSnapshot(accountLifecyclePort.getSnapshot())
    : null;
  let projectBindingSnapshot = projectBindingPort
    ? validateProjectBindingReviewSnapshot(projectBindingPort.getSnapshot())
    : null;
  let projectBindingMessage = "";
  let pendingProjectBinding = null;
  let pendingAction = null;
  let pendingProfileAction = null;
  let pendingProfileSpaceId = null;
  let profileOrdinal = 0;
  let actionMessage = "";
  let spaceMessage = "";
  let profileMessage = "";
  let profileMessageTone = "attention";
  let createNameDraft = "";
  let createTypeDraft = CREATABLE_SPACE_TYPES[0]?.key ?? "";
  let createIdempotencyKey = null;
  // A confirmed mutation receipt belongs only to this subject and intent.
  // If catalog verification fails, retry the read, never the already accepted write.
  let createReceipt = null;
  let createMessage = "";
  let createMessageTone = "attention";
  let createPending = false;
  // An ambiguous create must retry its original idempotent intent, never a new one.
  let createUnconfirmed = false;
  let createOrdinal = 0;
  let memoryConflictMessage = "";
  let pendingMemoryConflict = null;
  let credentialEmailDraft = readRememberedLoginEmail(documentObject.defaultView);
  let credentialPasswordDraft = "";
  let registrationPolicy = null;
  let hostedSignupAllowed = false;
  let registrationLegalAccepted = false;
  let registrationPolicyPending = false;
  let registrationPolicyOrdinal = 0;
  let closePasswordDraft = "";
  let closeConfirmationChecked = false;
  let pendingClose = false;
  let closeMessage = "";
  let closeMessageTone = "attention";
  let actionOrdinal = 0;
  let closeOrdinal = 0;
  // Historic destinations to Profiles become the existing Spaces destination.
  const initialTarget = lifecycle.getAppTarget("account");
  let activeSection = initialTarget === "profiles" ? "spaces"
    : validAccountSection(initialTarget) ? initialTarget : "overview";
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
    // Restores only a control identity. Passwords remain in the already
    // bounded account drafts and are never copied into focus snapshots.
    for (const [attribute, kind] of [
      ["data-account-credential-email", "credential-email"],
      ["data-account-credential-password", "credential-password"],
      ["data-account-registration-legal-acceptance", "registration-legal"],
      ["data-account-close-password", "close-password"],
      ["data-account-close-confirmation", "close-confirmation"],
    ]) {
      if (element.hasAttribute(attribute)) return Object.freeze({ kind, value: "" });
    }
    if (element.dataset.accountSpaceSelect) {
      return Object.freeze({ kind: "space-select", value: element.dataset.accountSpaceSelect });
    }
    if (element.dataset.accountProfileAction) {
      return Object.freeze({ kind: "profile-action", value: element.dataset.accountProfileAction });
    }
    if (element.hasAttribute("data-account-space-create-name")) {
      return Object.freeze({ kind: "space-create-name", value: "" });
    }
    if (element.hasAttribute("data-account-space-create-type")) {
      return Object.freeze({ kind: "space-create-type", value: "" });
    }
    return null;
  };

  const findFocusTarget = (slot, identity) => {
    if (!identity) return null;
    for (const element of slot.querySelectorAll("button, input, select")) {
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
    const focusedText = activeInside && activeElement?.matches?.(
      "[data-account-space-create-name], [data-account-credential-password], [data-account-close-password]",
    ) ? activeElement : null;
    const caret = focusedText && Number.isInteger(focusedText.selectionStart)
      && Number.isInteger(focusedText.selectionEnd)
      ? Object.freeze({
          start: focusedText.selectionStart,
          end: focusedText.selectionEnd,
          direction: focusedText.selectionDirection,
        })
      : null;
    return Object.freeze({
      section: slot.dataset.accountActiveSection ?? "",
      navigationScrollLeft: captureSectionNavigationScroll(slot),
      windowScrollTop: windowBody?.scrollTop ?? 0,
      windowScrollLeft: windowBody?.scrollLeft ?? 0,
      focus: activeInside ? focusIdentity(activeElement) : null,
      caret,
      advancedOpen: slot.querySelector("[data-space-profile-details]")?.open === true,
    });
  };

  const restoreInteractionState = (slot, snapshot) => {
    const sameSection = Boolean(snapshot) && snapshot.section === activeSection;
    restoreSectionNavigationScroll(slot, snapshot?.navigationScrollLeft ?? null, sameSection);
    if (!sameSection) return;

    const windowBody = slot.closest(".ordax-window-body");
    if (windowBody) {
      windowBody.scrollTop = snapshot.windowScrollTop;
      windowBody.scrollLeft = snapshot.windowScrollLeft;
    }

    const advanced = slot.querySelector("[data-space-profile-details]");
    if (advanced) advanced.open = snapshot.advancedOpen;
    const target = findFocusTarget(slot, snapshot.focus);
    if (!target || target.disabled || target.hidden || target.closest?.("[hidden]")) {
      restoreSectionFocusFallback(slot, snapshot.focus, target);
      return;
    }
    target.focus({ preventScroll: true });
    if (
      snapshot.caret
      && ["space-create-name", "credential-password", "close-password"].includes(snapshot.focus?.kind)
      && typeof target.setSelectionRange === "function"
    ) {
      target.setSelectionRange(snapshot.caret.start, snapshot.caret.end, snapshot.caret.direction);
    }
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
    const navigation = node(documentObject, "nav", "ordax-account-navigation ordax-section-navigation");
    navigation.setAttribute("aria-label", t("account.navigation.aria"));
    for (const section of ACCOUNT_SECTIONS) {
      const button = node(
        documentObject,
        "button",
        "ordax-account-navigation-item ordax-section-navigation-item",
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

      if (
        registrationPolicy
        && isIdentityActionSupported(actionsSnapshot, "register")
      ) {
        const legal = node(documentObject, "div", "ordax-account-registration-legal");
        legal.append(
          node(documentObject, "strong", "", t("account.registration.legal.title")),
          node(documentObject, "small", "", t("account.registration.legal.detail")),
        );

        const links = node(documentObject, "div", "ordax-account-registration-legal-links");
        const privacy = documentObject.createElement("a");
        privacy.href = registrationPolicy.privacy.url;
        privacy.target = "_blank";
        privacy.rel = "noopener noreferrer";
        privacy.textContent = `${t("account.registration.legal.privacy")} · v${registrationPolicy.privacy.version} · ${registrationPolicy.privacy.effectiveDate}`;
        const terms = documentObject.createElement("a");
        terms.href = registrationPolicy.terms.url;
        terms.target = "_blank";
        terms.rel = "noopener noreferrer";
        terms.textContent = `${t("account.registration.legal.terms")} · v${registrationPolicy.terms.version} · ${registrationPolicy.terms.effectiveDate}`;
        links.append(privacy, terms);

        const acceptance = node(documentObject, "label", "ordax-account-registration-legal-acceptance");
        const checkbox = documentObject.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = registrationLegalAccepted;
        checkbox.dataset.accountRegistrationLegalAcceptance = "";
        checkbox.disabled = pendingAction !== null;
        acceptance.append(
          checkbox,
          node(documentObject, "span", "", t("account.registration.legal.accept")),
        );
        legal.append(links, acceptance);
        form.append(legal);
      }

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

      if (isIdentityActionSupported(actionsSnapshot, "register")) {
        const register = node(
          documentObject,
          "button",
          "ordax-account-action",
          pendingAction === "register" ? t("account.action.registering") : t("account.action.register"),
        );
        register.type = "button";
        register.dataset.accountIdentityAction = "register";
        register.disabled = (
          pendingAction !== null
          || registrationPolicyPending
          || !registrationPolicy
          || !registrationLegalAccepted
        );
        actions.append(register);
      } else if (hostedSignupAllowed) {
        const hostedRegistration = node(documentObject, "a", "ordax-account-action", t("account.action.hostedRegister"));
        hostedRegistration.href = HOSTED_ACCOUNT_SIGNUP_URL;
        hostedRegistration.target = "_blank";
        hostedRegistration.rel = "noopener noreferrer";
        hostedRegistration.dataset.accountHostedSignup = "";
        actions.append(hostedRegistration);
      } else {
        actions.append(node(documentObject, "small", "ordax-account-status", t("account.registration.unavailable")));
      }
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

    if (
      sessionSnapshot.state === "signed-in"
      && accountLifecycleSnapshot
      && isAccountLifecycleActionSupported(accountLifecycleSnapshot, "close-account")
    ) {
      const lifecycleSection = node(documentObject, "section", "ordax-account-lifecycle");
      lifecycleSection.append(
        node(documentObject, "strong", "ordax-account-section-title", t("account.lifecycle.close.title")),
        node(documentObject, "p", "ordax-account-subtitle", t("account.lifecycle.close.detail")),
      );

      const passwordLabel = node(documentObject, "label", "ordax-account-field");
      passwordLabel.append(node(documentObject, "span", "", t("account.lifecycle.close.password")));
      const passwordInput = documentObject.createElement("input");
      passwordInput.type = "password";
      passwordInput.autocomplete = "current-password";
      passwordInput.maxLength = 1024;
      passwordInput.value = closePasswordDraft;
      passwordInput.dataset.accountClosePassword = "";
      passwordInput.disabled = pendingClose;
      passwordLabel.append(passwordInput);

      const confirmation = node(documentObject, "label", "ordax-account-registration-legal-acceptance");
      const confirmationInput = documentObject.createElement("input");
      confirmationInput.type = "checkbox";
      confirmationInput.checked = closeConfirmationChecked;
      confirmationInput.dataset.accountCloseConfirmation = "";
      confirmationInput.disabled = pendingClose;
      confirmation.append(
        confirmationInput,
        node(documentObject, "span", "", t("account.lifecycle.close.confirm")),
      );

      const closeButton = node(
        documentObject,
        "button",
        "ordax-account-action",
        pendingClose
          ? t("account.lifecycle.close.closing")
          : t("account.lifecycle.close.action"),
      );
      closeButton.type = "button";
      closeButton.dataset.accountCloseAction = "";
      closeButton.disabled = (
        pendingClose
        || !closeConfirmationChecked
        || closePasswordDraft.length < 1
      );

      lifecycleSection.append(passwordLabel, confirmation, closeButton);
      if (closeMessage) {
        lifecycleSection.append(
          markSurfaceFeedback(node(documentObject, "p", "ordax-account-message", closeMessage), closeMessageTone),
        );
      }
      section.append(lifecycleSection);
    }

    if (actionMessage) {
      section.append(markSurfaceFeedback(node(documentObject, "p", "ordax-account-message", actionMessage), "attention"));
    }
    view.append(section);
  };

  const authorizedSpaces = () => deriveAuthorizedSpaces(
    sessionSnapshot, spacesSnapshot, spaceSelectionSnapshot,
  );

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

    // An unresolved creation must remain recoverable even if its catalog
    // refresh failed. Never offer a fresh creation while catalog is unavailable.
    if (spaceCreatePort && CREATABLE_SPACE_TYPES.length > 0
        && (spacesSnapshot.state === "ready" || createUnconfirmed)) {
      const form = node(documentObject, "form", "ordax-account-section ordax-account-space-create-form");
      form.dataset.accountSpaceCreate = "";
      form.dataset.accountSpaceRecovery = String(createUnconfirmed);
      form.append(
        node(documentObject, "h5", "ordax-account-section-title", t("account.spaces.create.title")),
        node(documentObject, "p", "ordax-account-subtitle",
          t("account.spaces.create.description")),
      );
      const nameField = node(documentObject, "label", "ordax-account-field");
      const nameInput = documentObject.createElement("input");
      nameInput.type = "text";
      nameInput.required = true;
      nameInput.maxLength = 120;
      nameInput.value = createNameDraft;
      nameInput.autocomplete = "off";
      nameInput.dataset.accountSpaceCreateName = "";
      nameField.append(node(documentObject, "span", "", t("account.spaces.create.name")), nameInput);
      const typeField = node(documentObject, "label", "ordax-account-field");
      const typeInput = documentObject.createElement("select");
      typeInput.dataset.accountSpaceCreateType = "";
      typeInput.required = true;
      typeInput.disabled = createPending || createUnconfirmed;
      for (const type of CREATABLE_SPACE_TYPES) {
        const option = node(documentObject, "option", "", t(type.labelId));
        option.value = type.key;
        typeInput.append(option);
      }
      typeInput.value = createTypeDraft;
      typeField.append(node(documentObject, "span", "", t("account.spaces.create.type")), typeInput);
      const submit = node(documentObject, "button", "ordax-account-action ordax-account-action-primary",
        createPending ? t("account.spaces.create.pending")
          : createReceipt ? t("account.spaces.refresh") : t("account.spaces.create.title"));
      submit.type = "submit";
      // Pending catalog reads cannot be raced by a second recovery attempt.
      submit.disabled = createPending || spacesSnapshot.state === "loading"
        || createNameDraft.trim().length === 0;
      if (createUnconfirmed) {
        submit.setAttribute("aria-label", t("account.spaces.create.retryUnconfirmed"));
      }
      nameInput.disabled = createPending || createUnconfirmed;
      form.append(nameField, typeField, submit);
      section.append(form);
    } else if (!spaceCreatePort) {
      section.append(node(documentObject, "p", "ordax-account-message",
        t("account.spaces.create.unavailable")));
    }
    if (createMessage) {
      section.append(markSurfaceFeedback(
        node(documentObject, "p", "ordax-account-message", createMessage), createMessageTone));
    }

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
    const spaceContext = authorizedSpaces();
    if (!spaceContext.ready) {
      section.append(node(documentObject, "p", "ordax-account-message", t("account.spaces.unavailable.detail")));
      view.append(section);
      return;
    }
    if (spaceContext.visibleSpaces.length === 0) {
      section.append(node(documentObject, "p", "ordax-account-message", t("account.spaces.empty")));
      view.append(section);
      return;
    }

    const grid = node(documentObject, "div", "ordax-account-grid");
    for (const space of spaceContext.visibleSpaces) {
      const access = space.ownerId === sessionSnapshot.subjectId
        ? t("account.spaces.access.owner")
        : t("account.spaces.access.member");
      const kind = t(`account.spaces.kind.${space.kind}`);
      const state = t(`account.spaces.state.${space.state}`);
      const presentation = describeSpacePresentation(space);
      const semanticType = presentation.typeLabelId === null
        ? null
        : t(presentation.typeLabelId);
      const detail = semanticType === null
        ? t("account.spaces.card.detail", { kind, state, access })
        : t("account.spaces.card.detailType", { type: semanticType, kind, state, access });
      const isSelected = spaceContext.activeSpace?.id === space.id;
      const card = appendStateCard(
        documentObject,
        grid,
        t("account.spaces.card.label"),
        space.name,
        detail,
        isSelected ? "available" : space.state === "active" ? "available" : "neutral",
      );
      card.classList.add("ordax-account-space-card");
      card.dataset.spaceKind = space.kind;
      card.dataset.selected = String(isSelected);
      card.dataset.spaceState = space.state;
      card.dataset.spaceType = presentation.typeKey ?? "";
      card.dataset.spaceSemanticSource = presentation.semanticSource;
      const experience = spaceExperiencePort?.get(space) ?? null;
      if (experience?.state === "ready" && experience.spaceCardMetrics.length > 0) {
        const metrics = node(documentObject, "div", "ordax-account-space-metrics");
        metrics.dataset.spaceDomainMetrics = "";
        for (const metric of experience.spaceCardMetrics) {
          const metricCard = node(documentObject, "span", "ordax-account-space-metric");
          metricCard.dataset.metricId = metric.id;
          metricCard.append(
            node(documentObject, "small", "ordax-account-space-metric-label", metric.label),
            node(documentObject, "strong", "ordax-account-space-metric-value", String(metric.value)),
          );
          metrics.append(metricCard);
        }
        card.append(metrics);
      }
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
        select.disabled = isSelected || spaceSelectionSnapshot?.state === "unavailable" || pendingProfileAction !== null;
        if (isSelected) select.setAttribute("aria-current", "true");
        cardActions.append(select);
        card.append(cardActions);
      }
    }
    section.append(grid);
    if (spaceMessage) {
      section.append(markSurfaceFeedback(node(documentObject, "p", "ordax-account-message", spaceMessage), "attention"));
    }
    // A Profile Pack is a technical composition of the selected Space, not a
    // separately navigable product or a second account section.
    if (spaceContext.activeSpace && profileProvisioningPort) {
      const advanced = node(documentObject, "details", "ordax-account-section");
      advanced.dataset.spaceProfileDetails = "";
      advanced.append(node(documentObject, "summary", "ordax-account-section-title",
        t("account.spaces.create.advanced")));
      renderProfiles(advanced);
      section.append(advanced);
    }
    view.append(section);
  };

  const renderProjectBindings = (view) => {
    if (!projectBindingPort || !projectBindingSnapshot) return;
    const section = node(documentObject, "section", "ordax-account-section");
    section.dataset.accountProjectBindings = "";
    section.append(
      node(documentObject, "span", "ordax-account-eyebrow", t("account.projects.mcp.eyebrow")),
      node(documentObject, "h4", "ordax-account-section-title", t("account.projects.mcp.title")),
      node(documentObject, "p", "ordax-account-subtitle", t("account.projects.mcp.description")),
    );
    const actions = node(documentObject, "div", "ordax-account-actions");
    const refresh = node(documentObject, "button", "ordax-account-action", t("account.projects.mcp.refresh"));
    refresh.type = "button";
    refresh.dataset.accountProjectBindingRefresh = "";
    refresh.disabled = projectBindingSnapshot.state === "loading" || pendingProjectBinding !== null;
    actions.append(refresh);
    section.append(actions);
    if (projectBindingMessage) {
      section.append(node(documentObject, "p", "ordax-account-message", projectBindingMessage));
    }
    if (projectBindingSnapshot.state !== "ready") {
      const key = projectBindingSnapshot.state === "loading"
        ? "account.projects.mcp.loading"
        : projectBindingSnapshot.state === "error"
          ? "account.projects.mcp.error"
          : "account.projects.mcp.unavailable";
      section.append(node(documentObject, "p", "ordax-account-message", t(key)));
      view.append(section);
      return;
    }
    const candidates = projectBindingSnapshot.cloudProjects.filter((project) =>
      project.nextState === "needs_device_binding" || project.linkedLocalProjectId !== null);
    if (candidates.length === 0) {
      section.append(node(documentObject, "p", "ordax-account-message", t("account.projects.mcp.empty")));
      view.append(section);
      return;
    }
    const grid = node(documentObject, "div", "ordax-account-grid");
    for (const project of candidates) {
      const card = node(documentObject, "article", "ordax-account-card");
      card.dataset.state = project.linkedLocalProjectId ? "available" : "neutral";
      card.append(
        node(documentObject, "span", "ordax-account-card-label", project.repositoryFullName ?? t("account.projects.mcp.repositoryPending")),
        node(documentObject, "strong", "ordax-account-card-value", project.name),
      );
      if (project.linkedLocalProjectId !== null) {
        const local = projectBindingSnapshot.localProjects.find((entry) => entry.id === project.linkedLocalProjectId);
        card.append(node(documentObject, "small", "ordax-account-card-detail",
          t("account.projects.mcp.linked", { project: local?.name ?? project.linkedLocalProjectId })));
      } else {
        const field = node(documentObject, "label", "ordax-account-field");
        field.append(node(documentObject, "span", "", t("account.projects.mcp.localProject")));
        const select = documentObject.createElement("select");
        select.dataset.accountProjectBindingLocal = project.cloudProjectId;
        select.disabled = pendingProjectBinding !== null || projectBindingSnapshot.localProjects.length === 0;
        for (const local of projectBindingSnapshot.localProjects) {
          const option = node(documentObject, "option", "", local.name);
          option.value = local.id;
          select.append(option);
        }
        field.append(select);
        card.append(field);
        const bind = node(documentObject, "button", "ordax-account-action", t("account.projects.mcp.bind"));
        bind.type = "button";
        bind.dataset.accountProjectBindingCloud = project.cloudProjectId;
        bind.disabled = pendingProjectBinding !== null || projectBindingSnapshot.localProjects.length === 0;
        card.append(bind);
      }
      grid.append(card);
    }
    section.append(grid);
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

    const selectedSpace = authorizedSpaces().activeSpace;
    const activeProfile = currentProfileForSpace(profileActivationSnapshot, selectedSpace);
    const selectedType = selectedSpace?.domain && selectedSpace?.subtype
      ? getSpaceType(selectedSpace.domain, selectedSpace.subtype) : null;

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

    // The category hierarchy only organizes already validated active manifests.
    // Neither the taxonomy nor this UI may grant apps, activation or entitlements.
    const categoryView = profileCategoryCatalog === null ? null
      : createProfileTaxonomyView({
          catalogPort: profileCategoryCatalog,
          taxonomy: profileTaxonomy.taxonomy,
          language: localization.getLocale().startsWith("pt") ? "ptBR" : "en",
        });
    // Never offer a Profile from another Space type as an activation choice.
    let visiblePlans = profilePlans.filter(plan => selectedType?.profileBindings.includes(
      `${plan.profile.slug}@${plan.profile.version}`) === true);
    if (categoryView !== null) {
      const controls = node(documentObject, "div", "ordax-account-actions");
      const chooser = node(documentObject, "select", "ordax-account-action");
      chooser.dataset.accountProfileCategory = "";
      chooser.setAttribute("aria-label", t("account.profiles.categories.label"));
      const all = node(documentObject, "option", "", t("account.profiles.categories.all"));
      all.value = "";
      chooser.append(all);
      const appendCategories = (categories, depth) => {
        for (const category of categories) {
          if (category.profileCount === 0) continue;
          const label = `${"— ".repeat(depth)}${category.label} (${category.profileCount})`;
          const option = node(documentObject, "option", "", label);
          option.value = category.id;
          chooser.append(option);
          appendCategories(category.children, depth + 1);
        }
      };
      appendCategories(categoryView.roots, 0);
      chooser.value = selectedProfileCategory ?? "";
      controls.append(chooser);
      section.append(controls);
      visiblePlans = visiblePlans.filter((plan) => {
        const published = profileCategoryCatalog.get(plan.profile.slug, plan.profile.version);
        if (published === null) return false; // never promote a draft by listing it
        if (selectedProfileCategory === null) return true;
        const category = categoryView.getCategory(published.category);
        return category !== null && (
          category.id === selectedProfileCategory
          || category.ancestorIds.includes(selectedProfileCategory)
        );
      });
    }

    const grid = node(documentObject, "div", "ordax-account-grid");
    for (const plan of visiblePlans) {
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
      card.classList.add("ordax-account-profile-card");
      card.dataset.profileSlug = plan.profile.slug;
      card.dataset.selected = String(isActive);
      card.dataset.availability = plan.state;

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
    if (categoryView !== null && visiblePlans.length === 0) {
      section.append(node(documentObject, "p", "ordax-account-message",
        t("account.profiles.categories.empty")));
    }
    if (profileMessage) {
      section.append(markSurfaceFeedback(node(documentObject, "p", "ordax-account-message", profileMessage), profileMessageTone));
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
      clearAll: t("account.memory.review.clearAll"),
      clearAllPrompt: t("account.memory.review.clearAllPrompt"),
      clearAllConfirm: t("account.memory.review.clearAllConfirm"),
      clearAllCancel: t("account.memory.review.clearAllCancel"),
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
      renderProjectBindings(view);
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

  const refreshRegistrationPolicy = async () => {
    if (
      destroyed
      || registrationPolicyPending
      || sessionSnapshot.state !== "signed-out"
      || credentialsPort === null
      || typeof credentialsPort.registrationPolicy !== "function"
    ) {
      if (!isIdentityActionSupported(actionsSnapshot, "register")) {
        registrationPolicy = null;
        registrationLegalAccepted = false;
      }
      return;
    }
    const ordinal = ++registrationPolicyOrdinal;
    registrationPolicyPending = true;
    try {
      const policy = await credentialsPort.registrationPolicy();
      if (destroyed || ordinal !== registrationPolicyOrdinal
          || sessionSnapshot.state !== "signed-out") return;
      hostedSignupAllowed = isHostedSignupEnabled(policy);
      registrationPolicy = policy.registrationEnabled === true && isIdentityActionSupported(actionsSnapshot, "register") ? policy : null;
      if (registrationPolicy === null) registrationLegalAccepted = false;
    } catch {
      if (!destroyed && ordinal === registrationPolicyOrdinal
          && sessionSnapshot.state === "signed-out") {
        registrationPolicy = null;
        registrationLegalAccepted = false;
        hostedSignupAllowed = false;
      }
    } finally {
      if (!destroyed && ordinal === registrationPolicyOrdinal) {
        registrationPolicyPending = false;
        replaceView();
      }
    }
  };

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
      ? {
          email: credentialEmailDraft,
          password: credentialPasswordDraft,
          ...(action === "register" ? { legalAccepted: registrationLegalAccepted } : {}),
        }
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
        // The adapter can complete after the user has changed or revoked the
        // session. Do not refresh the new account for the old operation.
        if (destroyed || ordinal !== actionOrdinal) return;
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

  const closeAccount = async () => {
    if (
      destroyed
      || pendingClose
      || sessionSnapshot.state !== "signed-in"
      || accountLifecyclePort === null
      || accountLifecycleSnapshot === null
      || !isAccountLifecycleActionSupported(accountLifecycleSnapshot, "close-account")
      || closeConfirmationChecked !== true
      || closePasswordDraft.length < 1
    ) {
      return;
    }

    let operationPassword = closePasswordDraft;
    closePasswordDraft = "";
    closeConfirmationChecked = false;
    pendingClose = true;
    closeMessage = "";
    const ordinal = ++closeOrdinal;
    const actingSubjectId = sessionSnapshot.subjectId;
    const isCurrentCloseContext = () => !destroyed
      && ordinal === closeOrdinal
      && sessionSnapshot.state === "signed-in"
      && sessionSnapshot.subjectId === actingSubjectId;
    replaceView();

    try {
      const result = await accountLifecyclePort.closeAccount({
        password: operationPassword,
        confirmation: "close-account",
      });
      operationPassword = "";
      if (!isCurrentCloseContext()) return;
      if (result?.closed !== true) throw new Error("invalid close result");
      closeMessage = t("account.lifecycle.close.closed");
      closeMessageTone = "information";
      if (typeof sessionPort.refresh === "function") {
        await sessionPort.refresh();
      }
    } catch {
      operationPassword = "";
      if (!isCurrentCloseContext()) return;
      closeMessage = t("account.lifecycle.close.failed");
      closeMessageTone = "attention";
    } finally {
      operationPassword = "";
      if (isCurrentCloseContext()) {
        pendingClose = false;
        replaceView();
      }
    }
  };

  const onChange = (event) => {
    const control = event.target;
    if (control instanceof HTMLSelectElement && root.contains(control)
        && control.matches("[data-account-space-create-type]") && !createPending && !createUnconfirmed) {
      if (CREATABLE_SPACE_TYPES.some(type => type.key === control.value)) {
        createTypeDraft = control.value;
        createIdempotencyKey = null;
        createReceipt = null;
        createMessage = "";
      }
      return;
    }
    if (!(control instanceof HTMLSelectElement)
        || !root.contains(control)
        || !control.matches("[data-account-profile-category]")
        || profileCategoryCatalog === null) return;
    const next = control.value;
    const view = createProfileTaxonomyView({
      catalogPort: profileCategoryCatalog,
      taxonomy: profileTaxonomy.taxonomy,
      language: localization.getLocale().startsWith("pt") ? "ptBR" : "en",
    });
    if (next !== "" && view.getCategory(next) === null) return;
    selectedProfileCategory = next === "" ? null : next;
    replaceView();
  };

  const onInput = (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !root.contains(input)) return;
    if (input.matches("[data-account-space-create-name]") && !createPending && !createUnconfirmed) {
      createNameDraft = input.value;
      createIdempotencyKey = null;
      createReceipt = null;
      createMessage = "";
      const submit = root.querySelector("[data-account-space-create] button[type=submit]");
      if (submit) submit.disabled = createNameDraft.trim().length === 0;
    } else if (input.matches("[data-account-credential-email]")) {
      credentialEmailDraft = input.value;
    } else if (input.matches("[data-account-credential-password]")) {
      credentialPasswordDraft = input.value;
    } else if (input.matches("[data-account-registration-legal-acceptance]")) {
      registrationLegalAccepted = input.checked;
      replaceView();
    } else if (input.matches("[data-account-close-password]")) {
      closePasswordDraft = input.value;
      const closeButton = root.querySelector("[data-account-close-action]");
      if (closeButton instanceof HTMLButtonElement) {
        closeButton.disabled = (
          pendingClose
          || !closeConfirmationChecked
          || closePasswordDraft.length < 1
        );
      }
    } else if (input.matches("[data-account-close-confirmation]")) {
      closeConfirmationChecked = input.checked === true;
      const closeButton = root.querySelector("[data-account-close-action]");
      if (closeButton instanceof HTMLButtonElement) {
        closeButton.disabled = (
          pendingClose
          || !closeConfirmationChecked
          || closePasswordDraft.length < 1
        );
      }
    }
  };

  const onSubmit = (event) => {
    const form = event.target;
    if (!form?.matches?.("[data-account-space-create]") || !root.contains(form)) return;
    event.preventDefault();
    if (!spaceCreatePort || createPending || destroyed || sessionSnapshot.state !== "signed-in"
        || spacesSnapshot?.state === "loading"
        || (spacesSnapshot?.state !== "ready" && !createUnconfirmed)) return;
    const selectedType = CREATABLE_SPACE_TYPES.find(type => type.key === createTypeDraft);
    const name = createNameDraft.trim();
    if (!selectedType || name.length === 0 || name.length > 120) return;
    const crypto = desktopWindow?.crypto;
    if (!createIdempotencyKey) {
      if (typeof crypto?.randomUUID !== "function") {
        createMessage = t("account.spaces.create.secureIdUnavailable");
        createMessageTone = "attention";
        replaceView();
        return;
      }
      createIdempotencyKey = crypto.randomUUID();
    }
    const subjectId = sessionSnapshot.subjectId;
    const intent = {
      name,
      domain: selectedType.domain,
      subtype: selectedType.subtype,
      idempotencyKey: createIdempotencyKey,
    };
    const ordinal = ++createOrdinal;
    createPending = true;
    createMessage = "";
    spaceMessage = "";
    replaceView();
    void (async () => {
      try {
        const receipt = createReceipt ?? await spaceCreatePort.create(intent);
        if (destroyed || ordinal !== createOrdinal || sessionSnapshot.subjectId !== subjectId) return;
        if (typeof receipt?.space?.id !== "string" || receipt.space.id.length === 0) {
          throw new Error("Space creation receipt lacks an identifiable Space");
        }
        // A valid receipt confirms only the write, not the authorization to use it.
        // Persist it for this logical intent so a failed catalog refresh retries
        // only the read instead of repeating a mutation already accepted by Host.
        createReceipt = receipt;
        await spacesPort.refresh();
        if (destroyed || ordinal !== createOrdinal || sessionSnapshot.subjectId !== subjectId) return;
        const fresh = validateSpacesSnapshot(spacesPort.getSnapshot());
        const authorized = deriveAuthorizedSpaces(
          sessionPort.getSnapshot(), fresh, spaceSelectionPort?.getSnapshot() ?? null);
        const match = authorized.ready && authorized.visibleSpaces.find(space =>
          space.id === receipt.space.id && space.ownerId === subjectId && space.state === "active");
        if (!match) throw new Error("Space not visible in refreshed authorized catalog");
        // Confirmation and authorized catalog visibility complete creation.
        // Selecting that Space is a separate optional navigation operation:
        // its failure must never ask the user to retry an already-created Space.
        createMessage = t("account.spaces.create.createdPending");
        createMessageTone = "information";
        createUnconfirmed = false;
        createNameDraft = "";
        createIdempotencyKey = null;
        createReceipt = null;
        if (spaceSelectionPort) {
          try {
            spaceSelectionPort.select(match.id);
          } catch {
            spaceMessage = t("account.spaces.selection.failed");
          }
        }
      } catch {
        if (destroyed || ordinal !== createOrdinal || sessionSnapshot.subjectId !== subjectId) return;
        // Keep the original fields and UUID fixed until a canonical confirmation.
        createUnconfirmed = true;
        createMessage = t("account.spaces.create.retryUnconfirmed");
        createMessageTone = "attention";
      } finally {
        if (!destroyed && ordinal === createOrdinal) {
          createPending = false;
          replaceView();
        }
      }
    })();
  };

  const onClick = (event) => {
    const hostedSignup = event.target.closest("[data-account-hosted-signup]");
    if (hostedSignup && root.contains(hostedSignup)) {
      requestNativeHostedSignup(event, root.ownerDocument.defaultView, hostedSignupBridge);
      return;
    }
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
        if (nextSection === "spaces") {
          refreshSpaces();
          void projectBindingPort?.refresh();
        }
      }
      return;
    }

    const projectBindingRefresh = event.target.closest("[data-account-project-binding-refresh]");
    if (projectBindingRefresh && root.contains(projectBindingRefresh) && projectBindingPort) {
      projectBindingMessage = "";
      void projectBindingPort.refresh();
      return;
    }

    const projectBindingButton = event.target.closest("[data-account-project-binding-cloud]");
    if (projectBindingButton && root.contains(projectBindingButton) && projectBindingPort) {
      if (pendingProjectBinding !== null) return;
      const cloudProjectId = projectBindingButton.dataset.accountProjectBindingCloud;
      const select = [...root.querySelectorAll("[data-account-project-binding-local]")]
        .find((entry) => entry.dataset.accountProjectBindingLocal === cloudProjectId);
      const localProjectId = select?.value ?? "";
      if (!localProjectId) return;
      pendingProjectBinding = cloudProjectId;
      projectBindingMessage = "";
      replaceView();
      void projectBindingPort.link(localProjectId, cloudProjectId)
        .then(() => { projectBindingMessage = t("account.projects.mcp.linkedPending"); })
        .catch(() => { projectBindingMessage = t("account.projects.mcp.failed"); })
        .finally(() => {
          pendingProjectBinding = null;
          if (!destroyed) replaceView();
        });
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
      if (pendingProfileAction !== null) return;
      try {
        if (!authorizedSpaces().visibleSpaces.some((space) =>
          space.id === spaceButton.dataset.accountSpaceSelect && space.state === "active"
        )) {
          throw new Error("Space selection is not authorized by the current catalog");
        }
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
      if (pendingProfileAction !== null || sessionSnapshot.state !== "signed-in") return;
      const actingSubjectId = sessionSnapshot.subjectId;
      const selectedSpace = authorizedSpaces().activeSpace;
      if (!selectedSpace || selectedSpace.id !== profileButton.dataset.accountProfileSpaceId) {
        profileMessage = t("account.profiles.failed");
        replaceView();
        return;
      }
      const action = profileButton.dataset.accountProfileAction;
      const operationKey = action === "activate"
        ? `activate:${profileButton.dataset.accountProfileSlug ?? ""}`
        : `deactivate:${selectedSpace.id}`;
      const ordinal = ++profileOrdinal;
      pendingProfileAction = operationKey;
      pendingProfileSpaceId = selectedSpace.id;
      const isCurrentProfileContext = () => (
        !destroyed
        && ordinal === profileOrdinal
        && sessionSnapshot.state === "signed-in"
        && sessionSnapshot.subjectId === actingSubjectId
        && authorizedSpaces().activeSpace?.id === selectedSpace.id
        && authorizedSpaces().activeSpace?.kind === selectedSpace.kind
      );
      profileMessage = "";
      replaceView();
      void (async () => {
        try {
          if (action === "activate") {
            const version = Number(profileButton.dataset.accountProfileVersion);
            if (!Number.isSafeInteger(version) || version < 1) throw new TypeError("invalid Profile version");
            const intent = {
              spaceId: selectedSpace.id,
              spaceKind: selectedSpace.kind,
              profile: {
                slug: profileButton.dataset.accountProfileSlug,
                version,
              },
              components: [],
            };
            const preview = await profileActivationPort.previewActivation(intent);
            const acceptedDigest = assertMvpZeroComponentProfileReview(preview);
            // A stale preview cannot be authorized for a different Space or account.
            if (!isCurrentProfileContext()) return;
            const next = await profileActivationPort.activate({
              ...intent,
              expectedRevision: preview.expectedRevision,
              acceptedPermissionDiffSha256: acceptedDigest,
            });
            if (!isCurrentProfileContext()) return;
            profileActivationSnapshot = validateProfileActivationState(next);
            profileMessage = t("account.profiles.activated");
            profileMessageTone = "information";
          } else if (action === "deactivate") {
            const next = await profileActivationPort.deactivate(selectedSpace.id);
            if (!isCurrentProfileContext()) return;
            profileActivationSnapshot = validateProfileActivationState(next);
            profileMessage = t("account.profiles.deactivated");
            profileMessageTone = "information";
          } else {
            throw new TypeError("unsupported Profile action");
          }
        } catch {
          if (isCurrentProfileContext()) {
            profileMessage = t("account.profiles.failed");
            profileMessageTone = "attention";
          }
        } finally {
          if (ordinal === profileOrdinal) {
            pendingProfileAction = null;
            pendingProfileSpaceId = null;
            if (!destroyed) replaceView();
          }
        }
      })();
      return;
    }

    const closeButton = event.target.closest("[data-account-close-action]");
    if (closeButton && root.contains(closeButton)) {
      void closeAccount();
      return;
    }

    const button = event.target.closest("[data-account-identity-action]");
    if (button && root.contains(button)) {
      void invoke(button.dataset.accountIdentityAction);
    }
  };

  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  const unsubscribeRender = lifecycle.subscribeRender(() => {
    const persistedTarget = lifecycle.getAppTarget("account");
    const nextSection = persistedTarget === "profiles" ? "spaces"
      : validAccountSection(persistedTarget) ? persistedTarget : "overview";
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
      if (activeSection === "spaces") {
        refreshSpaces();
        void projectBindingPort?.refresh();
      }
    }
  });
  const unsubscribeSession = sessionPort.subscribe((snapshot) => {
    const previousSession = sessionSnapshot;
    const priorState = previousSession.state;
    const priorSubject = priorState === "signed-in"
      ? previousSession.subjectId : null;
    sessionSnapshot = validateIdentitySessionSnapshot(snapshot);
    const currentSubject = sessionSnapshot.state === "signed-in"
      ? sessionSnapshot.subjectId : null;
    // A repeated observation is not a new login/logout. Keep pending writes,
    // drafts and legal consent intact; only repaint if the same user's
    // presentation (name/email) actually changed.
    if (priorState === sessionSnapshot.state && priorSubject === currentSubject) {
      if (
        previousSession.displayName !== sessionSnapshot.displayName
        || previousSession.email !== sessionSnapshot.email
      ) replaceView();
      return;
    }
    if (priorState !== sessionSnapshot.state || priorSubject !== currentSubject) {
      // Fence every account-scoped completion before painting the new user.
      // Closing an account and credentials requests are never transferable.
      actionOrdinal += 1;
      pendingAction = null;
      closeOrdinal += 1;
      pendingClose = false;
      closePasswordDraft = "";
      closeConfirmationChecked = false;
      closeMessage = "";
      credentialPasswordDraft = "";
      registrationPolicyOrdinal += 1;
      registrationPolicyPending = false;
      registrationPolicy = null;
      hostedSignupAllowed = false;
      registrationLegalAccepted = false;
    }
    if (priorSubject !== currentSubject || sessionSnapshot.state !== "signed-in") {
      // Invalidate all in-flight catalog reads before painting the new account.
      spacesPort?.reset();
      projectBindingPort?.reset();
      projectBindingMessage = "";
      pendingProjectBinding = null;
      createOrdinal += 1;
      createPending = false;
      createIdempotencyKey = null;
      createUnconfirmed = false;
      createNameDraft = "";
      createReceipt = null;
      createMessage = "";
      // Old Profile Pack completions must not write into the next account.
      profileOrdinal += 1;
      pendingProfileAction = null;
      pendingProfileSpaceId = null;
      spaceMessage = "";
      profileMessage = "";
    }
    if (sessionSnapshot.state !== "signed-in") {
      closePasswordDraft = "";
      closeConfirmationChecked = false;
      closeMessage = "";
    } else {
      registrationPolicy = null;
      registrationLegalAccepted = false;
      hostedSignupAllowed = false;
    }
    if (sessionSnapshot.state === "signed-out") void refreshRegistrationPolicy();
    actionMessage = "";
    replaceView();
    if (activeSection === "spaces" && sessionSnapshot.state === "signed-in") {
      refreshSpaces();
      void projectBindingPort?.refresh();
    }
  });
  const unsubscribeAccountLifecycle = accountLifecyclePort?.subscribe((snapshot) => {
    accountLifecycleSnapshot = validateAccountLifecycleSnapshot(snapshot);
    if (!isAccountLifecycleActionSupported(accountLifecycleSnapshot, "close-account")) {
      closePasswordDraft = "";
      closeConfirmationChecked = false;
      closeMessage = "";
      pendingClose = false;
      closeOrdinal += 1;
    }
    replaceView();
  });
  const unsubscribeActions = actionsPort.subscribe((snapshot) => {
    const previousActions = actionsSnapshot;
    actionsSnapshot = validateIdentityActionsSnapshot(snapshot);
    // Supported actions are the complete public presentation contract.
    // Equivalent snapshots must not erase feedback or refetch registration.
    if (
      previousActions.supportedActions.length === actionsSnapshot.supportedActions.length
      && previousActions.supportedActions.every(
        (action, index) => action === actionsSnapshot.supportedActions[index]
      )
    ) return;
    actionMessage = "";
    if (!isIdentityActionSupported(actionsSnapshot, "register")) {
      registrationPolicy = null;
      registrationLegalAccepted = false;
    }
    replaceView();
    if (sessionSnapshot.state === "signed-out" && registrationPolicy === null) {
      void refreshRegistrationPolicy();
    }
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
  const unsubscribeProjectBinding = projectBindingPort?.subscribe((snapshot) => {
    projectBindingSnapshot = validateProjectBindingReviewSnapshot(snapshot);
    if (activeSection === "spaces") replaceView();
  });
  const unsubscribeSpaceSelection = spaceSelectionPort?.subscribe((snapshot) => {
    spaceSelectionSnapshot = validateSpaceSelectionSnapshot(snapshot);
    if (pendingProfileSpaceId !== null
        && authorizedSpaces().activeSpace?.id !== pendingProfileSpaceId) {
      // Global Space switching must not retain a mutation lock for another Space.
      profileOrdinal += 1;
      pendingProfileAction = null;
      pendingProfileSpaceId = null;
      profileMessage = "";
    }
    replaceView();
  });
  const unsubscribeSpaceExperience = spaceExperiencePort?.subscribe(() => {
    if (activeSection === "spaces") replaceView();
  });
  const unsubscribeProfileActivation = profileActivationPort?.subscribe?.((snapshot) => {
    profileActivationSnapshot = validateProfileActivationState(snapshot);
    if (activeSection === "spaces") replaceView();
  });
  const unsubscribePreferences = preferencePort?.subscribe((snapshot) => {
    preferenceSnapshot = snapshot;
    if (activeSection === "memory") replaceView();
  });
  if (activeSection === "spaces" && sessionSnapshot.state === "signed-in") {
    refreshSpaces();
    void projectBindingPort?.refresh();
  }
  if (sessionSnapshot.state === "signed-out" && credentialsPort) {
    void refreshRegistrationPolicy();
  }

  return Object.freeze({
    destroy() {
      destroyed = true;
      actionOrdinal += 1;
      profileOrdinal += 1;
      pendingProfileAction = null;
      pendingProfileSpaceId = null;
      memoryReviewControls?.dispose();
      memoryReviewControls = null;
      unsubscribeProfileActivation?.();
      unsubscribePreferences?.();
      unsubscribeProjectBinding?.();
      unsubscribeSpaceExperience?.();
      unsubscribeSpaceSelection?.();
      unsubscribeSpaces?.();
      unsubscribeWorkspaceMetadata?.();
      unsubscribeSync?.();
      unsubscribeAccountLifecycle?.();
      unsubscribeActions?.();
      unsubscribeSession?.();
      unsubscribeActivation?.();
      unsubscribeRender();
      credentialPasswordDraft = "";
      closePasswordDraft = "";
      closeConfirmationChecked = false;
      closeOrdinal += 1;
      registrationPolicyOrdinal += 1;
      registrationPolicy = null;
      registrationLegalAccepted = false;
      root.removeEventListener("input", onInput);
      root.removeEventListener("change", onChange);
      root.removeEventListener("click", onClick);
      root.removeEventListener("submit", onSubmit);
      spaceCreatePort?.dispose();
      createOrdinal += 1;
      createReceipt = null;
      const slot = findSlot();
      if (slot?.dataset.ordaxAccountOverviewView !== undefined) {
        slot.replaceChildren();
        delete slot.dataset.ordaxAccountOverviewView;
      }
      mountedSlot = null;
    },
  });
}
