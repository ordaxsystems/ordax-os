import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import {
  assertProfileActivationStatePort,
  currentProfileForSpace,
} from "../../contracts/profile-activation-state.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { assertSpaceSelectionPort } from "../../contracts/space-selection.mjs";
import { assertSpacesPort } from "../../contracts/spaces.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { deriveAuthorizedSpaces } from "../../services/spaces/authorized-view.mjs";
import { describeSpacePresentation } from "../../services/spaces/presentation.mjs";
import { restoreTransientActionFocus } from "./focus-recovery.mjs";

// A session heartbeat or refresh is not a new user. Only actual identity
// transitions revoke the switcher's transient navigation/read context.
function identityPresentationContextChanged(previous, next) {
  return previous.state !== next.state
    || (next.state === "signed-in" && previous.subjectId !== next.subjectId);
}

// Search is a display-only filter over the already authorized catalog.
// Neither text matching nor a search hit confers Space selection authority.
function spaceSwitcherMatchesName(name, query, locale = "pt-BR") {
  const fold = (value) => String(value).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(locale);
  return fold(name).includes(fold(query).trim());
}

// One presentation for the existing Account-owned Spaces catalog and selection.
// Selecting a Space is navigation context, never a permission grant.
export function deriveSpaceSwitcherView(identity, catalog, selection, activation = null) {
  const { ready, visibleSpaces, activeSpace: active } = deriveAuthorizedSpaces(
    identity, catalog, selection,
  );
  // Device-scoped activation is only displayable inside the authenticated
  // user's current catalog. Never render a profile from a stale/foreign Space.
  const profileFor = (space) => currentProfileForSpace(activation, space);
  return Object.freeze({
    ready,
    visibleSpaces,
    active,
    activeProfile: profileFor(active),
    profilesBySpace: Object.freeze(visibleSpaces.map((space) => Object.freeze({
      spaceId: space.id,
      profile: space.state === "active" ? profileFor(space) : null,
    }))),
  });
}

export function mountSpaceSwitcherControls(
  root,
  identitySession,
  spaces,
  spaceSelection,
  appActivation,
  surfaceLifecycle,
  profileActivationState = null,
) {
  const identityPort = assertIdentitySessionPort(identitySession);
  const spacesPort = assertSpacesPort(spaces);
  const selectionPort = spaceSelection === null ? null : assertSpaceSelectionPort(spaceSelection);
  const activationPort = assertAppActivationPort(appActivation);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const profilePort = profileActivationState === null
    ? null : assertProfileActivationStatePort(profileActivationState);
  const slot = root.querySelector("[data-space-switcher-slot]");
  if (!slot) throw new Error("Space switcher requires its canonical shell slot");
  const doc = root.ownerDocument;
  const t = lifecycle.localization.translate;

  const element = (tag, className, value) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const button = (className, label) => {
    const node = element("button", className, label);
    node.type = "button";
    return node;
  };

  const control = element("div", "ordax-space-switcher");
  const trigger = button("ordax-space-switcher-trigger");
  trigger.dataset.spaceSwitcherToggle = "";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "ordax-space-switcher-menu");
  const menu = element("section", "ordax-space-switcher-menu");
  menu.id = "ordax-space-switcher-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", t("account.spaces.switcher.title"));
  menu.hidden = true;
  // Static trigger nodes survive ordinary Surface lifecycle renders. Keep the
  // SVG and focusable button in place while updating only their live labels.
  const mark = element("span", "ordax-space-switcher-mark meridian-rail-space-icon");
  mark.setAttribute("aria-hidden", "true");
  mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3m3 0h3"/></svg>';
  const label = element("span", "ordax-space-switcher-trigger-label");
  const title = element("strong");
  const kicker = element("small");
  label.append(title, kicker);
  const chevron = element("span", "ordax-space-switcher-chevron", "⌄");
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(mark, label, chevron);
  control.append(trigger, menu);
  slot.append(control);

  let open = false;
  let loading = false;
  let error = false;
  let selectionFailed = false;
  let searchQuery = "";
  let destroyed = false;
  let refreshRevision = 0;
  let observedIdentity = identityPort.getSnapshot();

  const filterSearchResults = () => {
    if (!open) return;
    let matching = 0;
    for (const option of menu.querySelectorAll("[data-space-switcher-select]")) {
      option.hidden = !spaceSwitcherMatchesName(
        option.dataset.spaceSwitcherName ?? "",
        searchQuery,
        lifecycle.localization.getLocale(),
      );
      if (!option.hidden) matching += 1;
    }
    const empty = menu.querySelector("[data-space-switcher-search-empty]");
    if (empty) empty.hidden = matching > 0 || searchQuery.trim() === "";
  };

  const render = () => {
    if (destroyed) return;
    // Capture the original focus before menu visibility or children change.
    // Session revocation can close a menu while its now-hidden option is focused.
    const focusedElement = doc.activeElement;
    const hadMenuFocus = menu.contains(focusedElement);
    const focusedSpaceId = hadMenuFocus
      ? focusedElement?.dataset?.spaceSwitcherSelect ?? null : null;
    const hadSearchFocus = hadMenuFocus
      && focusedElement?.hasAttribute?.("data-space-switcher-search");
    const searchCaret = hadSearchFocus && Number.isInteger(focusedElement.selectionStart)
      ? focusedElement.selectionStart : null;
    const hadManageFocus = hadMenuFocus
      && focusedElement?.hasAttribute?.("data-space-switcher-manage");
    const identity = identityPort.getSnapshot();
    const catalog = spacesPort.getSnapshot();
    const selected = selectionPort?.getSnapshot() ?? null;
    const { ready, active, visibleSpaces: spacesVisible, activeProfile, profilesBySpace } =
      deriveSpaceSwitcherView(identity, catalog, selected, profilePort?.getSnapshot() ?? null);
    const profileLabel = (profile) => profile
      ? t(`account.profiles.name.${profile.slug}`) : null;
    const semanticTypeLabel = (space) => {
      if (!space) return null;
      const presentation = describeSpacePresentation(space);
      return presentation.typeLabelId === null
        ? t(`account.spaces.kind.${space.kind}`)
        : t(presentation.typeLabelId);
    };

    const english = lifecycle.localization.getLocale().toLowerCase().startsWith("en");
    const nextTitle = active ? active.name : english ? "Choose context" : "Escolher contexto";
    const nextKicker = english ? "YOUR SPACE" : "SEU SPACE";
    if (title.textContent !== nextTitle) title.textContent = nextTitle;
    if (kicker.textContent !== nextKicker) kicker.textContent = nextKicker;
    trigger.dataset.profileConfigured = String(Boolean(activeProfile));
    trigger.setAttribute("aria-label", active
      ? (activeProfile
        ? t("account.spaces.switcher.profileConfigured", {
          space: active.name,
          type: semanticTypeLabel(active),
          profile: profileLabel(activeProfile),
        })
        : t("account.spaces.switcher.currentTyped", {
          space: active.name,
          type: semanticTypeLabel(active),
        }))
      : t("account.spaces.switcher.title"));
    trigger.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-label", t("account.spaces.switcher.title"));
    menu.hidden = !open;
    if (!open) {
      // Revoke focus from hidden/closed options only if focus was in the menu.
      restoreTransientActionFocus(hadMenuFocus, null, trigger);
      return;
    }

    menu.replaceChildren();
    const head = element("div", "ordax-space-switcher-head");
    head.append(
      element("strong", "", t("account.spaces.switcher.title")),
      element("span", "", t("account.spaces.switcher.subtitle")),
    );
    menu.append(head);

    const showSearch = identity.state === "signed-in" && ready
      && selectionPort !== null && spacesVisible.length > 1;
    let searchInput = null;
    if (showSearch) {
      searchInput = element("input", "ordax-space-switcher-search");
      searchInput.type = "search";
      searchInput.dataset.spaceSwitcherSearch = "";
      searchInput.placeholder = english ? "Search Spaces" : "Buscar Spaces";
      searchInput.setAttribute("aria-label", searchInput.placeholder);
      searchInput.autocomplete = "off";
      searchInput.value = searchQuery;
      menu.append(searchInput);
    }

    const list = element("div", "ordax-space-switcher-list");
    if (identity.state !== "signed-in") {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.signIn.detail")));
    } else if (selectionPort === null) {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.switcher.nativeOnly")));
    } else if (loading || catalog.state === "loading") {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.loading")));
    } else if (error || catalog.state === "error") {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.error")));
    } else if (!ready) {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.unavailable.detail")));
    } else if (spacesVisible.length === 0) {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.empty")));
    } else {
      for (const space of spacesVisible) {
        const isCurrent = active?.id === space.id;
        const item = button("ordax-space-switcher-option");
        item.dataset.spaceSwitcherSelect = space.id;
        item.dataset.spaceSwitcherName = space.name;
        item.disabled = space.state !== "active" || selected?.state === "unavailable" || loading || isCurrent;
        item.setAttribute("aria-current", isCurrent ? "true" : "false");
        item.dataset.selected = String(isCurrent);
        const avatar = element("span", "ordax-space-switcher-avatar", space.name.trim().slice(0, 1).toLocaleUpperCase());
        avatar.setAttribute("aria-hidden", "true");
        const copy = element("span", "ordax-space-switcher-option-copy");
        const assignedProfile = profilesBySpace.find((item) => item.spaceId === space.id)?.profile ?? null;
        const technicalProfile = assignedProfile
          ? t("account.spaces.switcher.technicalProfile", { profile: profileLabel(assignedProfile) })
          : null;
        copy.append(
          element("strong", "", space.name),
          element("small", "", [
            semanticTypeLabel(space),
            t(`account.spaces.state.${space.state}`),
            technicalProfile,
          ].filter(Boolean).join(" · ")),
        );
        item.append(avatar, copy);
        if (isCurrent) {
          const check = element("span", "ordax-space-switcher-check", "✓");
          check.setAttribute("aria-hidden", "true");
          item.append(check);
        }
        list.append(item);
      }
      if (showSearch) {
        const noMatches = element("p", "ordax-space-switcher-empty",
          english ? "No matching Spaces" : "Nenhum Space encontrado");
        noMatches.dataset.spaceSwitcherSearchEmpty = "";
        noMatches.setAttribute("role", "status");
        noMatches.setAttribute("aria-live", "polite");
        noMatches.hidden = true;
        list.append(noMatches);
      }
    }
    menu.append(list);
    if (selectionFailed) {
      const feedback = element("p", "ordax-space-switcher-feedback", t("account.spaces.selection.failed"));
      feedback.setAttribute("role", "alert");
      menu.append(feedback);
    }
    const manage = button("ordax-space-switcher-manage", t("account.spaces.switcher.manage"));
    manage.dataset.spaceSwitcherManage = "";
    menu.append(manage);
    filterSearchResults();
    if (hadSearchFocus && searchInput) {
      searchInput.focus({ preventScroll: true });
      if (searchCaret !== null) searchInput.setSelectionRange(searchCaret, searchCaret);
      return;
    }
    // Preserve only an option that is still present and enabled. Loading,
    // session changes or a revoked Space return keyboard focus to the
    // stable trigger; they never focus a different Space or run select().
    const previousOption = focusedSpaceId !== null
      ? [...list.querySelectorAll("[data-space-switcher-select]")].find((item) =>
          item.dataset.spaceSwitcherSelect === focusedSpaceId) ?? null
      : null;
    const focusTarget = focusedSpaceId !== null ? previousOption
      : hadManageFocus ? manage : null;
    restoreTransientActionFocus(hadMenuFocus, focusTarget, trigger);
  };

  const close = (restoreFocus = false) => {
    if (!open) return;
    open = false;
    render();
    if (restoreFocus) trigger.focus();
  };

  const refreshCatalog = () => {
    if (loading || identityPort.getSnapshot().state !== "signed-in") return;
    const revision = ++refreshRevision;
    loading = true;
    error = false;
    render();
    void spacesPort.refresh().catch(() => {
      if (!destroyed && revision === refreshRevision) error = true;
    }).finally(() => {
      if (destroyed || revision !== refreshRevision) return;
      loading = false;
      render();
    });
  };

  const onClick = (event) => {
    if (trigger.contains(event.target)) {
      open = !open;
      if (open) { error = false; selectionFailed = false; }
      searchQuery = "";
      render();
      if (open && spacesPort.getSnapshot().state !== "ready") refreshCatalog();
      return;
    }
    const manage = event.target.closest("[data-space-switcher-manage]");
    if (manage && control.contains(manage)) {
      close();
      activationPort.publish({ appId: "account", target: "spaces" });
      return;
    }
    const action = event.target.closest("[data-space-switcher-select]");
    if (!action || !control.contains(action) || !selectionPort || loading) return;
    const identity = identityPort.getSnapshot();
    const catalog = spacesPort.getSnapshot();
    const selection = selectionPort.getSnapshot();
    // The picker and Account consume the same OS-owned authorization view.
    // Never reimplement identity/catalog/selection gates against raw snapshots.
    const authorized = deriveAuthorizedSpaces(identity, catalog, selection);
    if (!authorized.ready) return;
    const match = authorized.visibleSpaces.find((space) =>
      space.id === action.dataset.spaceSwitcherSelect);
    if (!match || match.state !== "active") return;
    try {
      selectionPort.select(match.id);
      selectionFailed = false;
      close(true);
      render();
    } catch {
      // A failed selection is not a catalog read failure: keep options usable.
      selectionFailed = true;
      render();
    }
  };

  const originatedInside = (event) => (
    event.composedPath?.().includes(control) || control.contains(event.target)
  );
  const onOutside = (event) => {
    // A click can replace its own button before bubbling to document.
    // Inspect the original event path, not only today's DOM ancestry.
    if (open && !originatedInside(event)) close();
  };
  const focusOption = (key) => {
    const enabled = [...menu.querySelectorAll("button:not(:disabled):not([hidden])")]
      .filter(item => !item.closest("[hidden]"));
    if (!enabled.length) return;
    const currentIndex = enabled.indexOf(doc.activeElement);
    const targetIndex = key === "Home" ? 0
      : key === "End" ? enabled.length - 1
        : key === "ArrowUp" ? (currentIndex < 0 ? enabled.length - 1 : (currentIndex - 1 + enabled.length) % enabled.length)
          : (currentIndex + 1) % enabled.length;
    enabled[targetIndex].focus();
  };
  const onKeyDown = (event) => {
    if (open && event.key === "Escape" && control.contains(event.target)) {
      event.preventDefault();
      close(true);
      return;
    }
    if (!control.contains(event.target)) return;
    // Home/End should move the text caret while typing, not jump to a Space.
    if (event.target.matches?.("[data-space-switcher-search]")
      && (event.key === "Home" || event.key === "End")) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (!open) {
      open = true;
      error = false;
      selectionFailed = false;
      searchQuery = "";
      render();
      if (spacesPort.getSnapshot().state !== "ready") refreshCatalog();
    }
    focusOption(event.key);
  };
  const onFocusIn = (event) => {
    if (open && !originatedInside(event)) close();
  };
  const onInput = (event) => {
    if (!open || !event.target.matches?.("[data-space-switcher-search]")) return;
    searchQuery = event.target.value;
    filterSearchResults();
  };
  control.addEventListener("click", onClick);
  control.addEventListener("input", onInput);
  doc.addEventListener("click", onOutside);
  doc.addEventListener("keydown", onKeyDown);
  doc.addEventListener("focusin", onFocusIn);
  const subscriptions = [
    identityPort.subscribe(() => {
      const nextIdentity = identityPort.getSnapshot();
      const contextChanged = identityPresentationContextChanged(observedIdentity, nextIdentity);
      observedIdentity = nextIdentity;
      if (contextChanged) {
        // Revoke old-context fetch/selection UI only when the session state
        // or signed-in subject really changes. Token renewals, display-name
        // changes and repeated snapshots must not dismiss the Space picker.
        refreshRevision += 1;
        loading = false;
        open = false;
        error = false;
        selectionFailed = false;
        searchQuery = "";
      }
      render();
    }),
    spacesPort.subscribe(render),
    selectionPort?.subscribe(render),
    profilePort?.subscribe?.(render),
    lifecycle.subscribeRender(render),
    lifecycle.localization.subscribe?.(render),
  ];
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      control.removeEventListener("click", onClick);
      control.removeEventListener("input", onInput);
      doc.removeEventListener("click", onOutside);
      doc.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("focusin", onFocusIn);
      for (const unsubscribe of subscriptions) unsubscribe?.();
      control.remove();
    },
  });
}
