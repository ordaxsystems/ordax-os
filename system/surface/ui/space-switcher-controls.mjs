import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import {
  assertProfileActivationStatePort,
  currentProfileForSpace,
} from "../../contracts/profile-activation-state.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { assertSpaceSelectionPort } from "../../contracts/space-selection.mjs";
import { assertSpacesPort } from "../../contracts/spaces.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

// One presentation for the existing Account-owned Spaces catalog and selection.
// Selecting a Space is navigation context, never a permission grant.
export function deriveSpaceSwitcherView(identity, catalog, selection, activation = null) {
  const visibleSpaces = identity.state === "signed-in" && catalog.state === "ready"
    ? catalog.spaces : [];
  const active = (
    identity.state === "signed-in"
    && selection?.state === "selected"
    && selection.subjectId === identity.subjectId
  ) ? visibleSpaces.find((space) => space.id === selection.selectedSpace.id && space.state === "active") ?? null : null;
  // Device-scoped activation is only displayable inside the authenticated
  // user's current catalog. Never render a profile from a stale/foreign Space.
  const profileFor = (space) => currentProfileForSpace(activation, space);
  return Object.freeze({
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
  control.append(trigger, menu);
  slot.append(control);

  let open = false;
  let loading = false;
  let error = false;
  let selectionFailed = false;
  let destroyed = false;
  let refreshRevision = 0;

  const render = () => {
    if (destroyed) return;
    const identity = identityPort.getSnapshot();
    const catalog = spacesPort.getSnapshot();
    const selected = selectionPort?.getSnapshot() ?? null;
    const { active, visibleSpaces: spacesVisible, activeProfile, profilesBySpace } =
      deriveSpaceSwitcherView(identity, catalog, selected, profilePort?.getSnapshot() ?? null);
    const profileLabel = (profile) => profile
      ? t(`account.profiles.name.${profile.slug}`) : null;

    trigger.replaceChildren();
    const mark = element("span", "ordax-space-switcher-mark", active ? active.name.trim().slice(0, 1).toLocaleUpperCase() : "◇");
    mark.setAttribute("aria-hidden", "true");
    const label = element("span", "ordax-space-switcher-trigger-label");
    label.append(
      element("strong", "", active ? active.name : t("account.spaces.switcher.title")),
      element("small", "", active
        ? (activeProfile ? profileLabel(activeProfile) : t(`account.spaces.kind.${active.kind}`))
        : t("account.spaces.switcher.noSelection")),
    );
    const chevron = element("span", "ordax-space-switcher-chevron", "⌄");
    chevron.setAttribute("aria-hidden", "true");
    trigger.append(mark, label, chevron);
    trigger.dataset.profileConfigured = String(Boolean(activeProfile));
    trigger.setAttribute("aria-label", active
      ? (activeProfile
        ? t("account.spaces.switcher.profileConfigured", {
          space: active.name, profile: profileLabel(activeProfile),
        })
        : t("account.spaces.switcher.current", { space: active.name }))
      : t("account.spaces.switcher.title"));
    trigger.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-label", t("account.spaces.switcher.title"));
    menu.hidden = !open;
    if (!open) return;

    // Replacing catalog children must not steal focus during an async update.
    const focusedSpaceId = menu.contains(doc.activeElement)
      ? doc.activeElement?.dataset?.spaceSwitcherSelect ?? null : null;
    const hadManageFocus = menu.contains(doc.activeElement)
      && doc.activeElement?.hasAttribute?.("data-space-switcher-manage");
    menu.replaceChildren();
    const head = element("div", "ordax-space-switcher-head");
    head.append(
      element("strong", "", t("account.spaces.switcher.title")),
      element("span", "", t("account.spaces.switcher.subtitle")),
    );
    menu.append(head);

    const list = element("div", "ordax-space-switcher-list");
    if (identity.state !== "signed-in") {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.signIn.detail")));
    } else if (selectionPort === null) {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.switcher.nativeOnly")));
    } else if (loading || catalog.state === "loading") {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.loading")));
    } else if (error || catalog.state === "error") {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.error")));
    } else if (catalog.state !== "ready") {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.unavailable.detail")));
    } else if (spacesVisible.length === 0) {
      list.append(element("p", "ordax-space-switcher-empty", t("account.spaces.empty")));
    } else {
      for (const space of spacesVisible) {
        const isCurrent = active?.id === space.id;
        const item = button("ordax-space-switcher-option");
        item.dataset.spaceSwitcherSelect = space.id;
        item.disabled = space.state !== "active" || selected?.state === "unavailable" || loading || isCurrent;
        item.setAttribute("aria-current", isCurrent ? "true" : "false");
        item.dataset.selected = String(isCurrent);
        const avatar = element("span", "ordax-space-switcher-avatar", space.name.trim().slice(0, 1).toLocaleUpperCase());
        avatar.setAttribute("aria-hidden", "true");
        const copy = element("span", "ordax-space-switcher-option-copy");
        const assignedProfile = profilesBySpace.find((item) => item.spaceId === space.id)?.profile ?? null;
        copy.append(
          element("strong", "", space.name),
          element("small", "",
            t(`account.spaces.kind.${space.kind}`) + " · "
            + (assignedProfile ? profileLabel(assignedProfile) : t(`account.spaces.state.${space.state}`))),
        );
        item.append(avatar, copy);
        if (isCurrent) {
          const check = element("span", "ordax-space-switcher-check", "✓");
          check.setAttribute("aria-hidden", "true");
          item.append(check);
        }
        list.append(item);
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
    if (focusedSpaceId !== null) {
      [...list.querySelectorAll("[data-space-switcher-select]")].find((item) =>
        item.dataset.spaceSwitcherSelect === focusedSpaceId && !item.disabled
      )?.focus();
    } else if (hadManageFocus) {
      manage.focus();
    }
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
    if (
      identity.state !== "signed-in"
      || catalog.state !== "ready"
      || selection.state === "unavailable"
      || selection.subjectId !== identity.subjectId
    ) return;
    const match = catalog.spaces.find((space) => space.id === action.dataset.spaceSwitcherSelect);
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
    const enabled = [...menu.querySelectorAll("button:not(:disabled)")];
    if (!enabled.length) return;
    const currentIndex = enabled.indexOf(doc.activeElement);
    const targetIndex = key === "Home" ? 0
      : key === "End" ? enabled.length - 1
        : key === "ArrowUp" ? (currentIndex < 0 ? enabled.length - 1 : (currentIndex - 1 + enabled.length) % enabled.length)
          : (currentIndex + 1) % enabled.length;
    enabled[targetIndex].focus();
  };
  const onKeyDown = (event) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (!control.contains(event.target)) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (!open) {
      open = true;
      error = false;
      selectionFailed = false;
      render();
      if (spacesPort.getSnapshot().state !== "ready") refreshCatalog();
    }
    focusOption(event.key);
  };
  const onFocusIn = (event) => {
    if (open && !originatedInside(event)) close();
  };
  control.addEventListener("click", onClick);
  doc.addEventListener("click", onOutside);
  doc.addEventListener("keydown", onKeyDown);
  doc.addEventListener("focusin", onFocusIn);
  const subscriptions = [
    identityPort.subscribe(() => {
      refreshRevision += 1;
      loading = false;
      open = false;
      error = false;
      selectionFailed = false;
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
      doc.removeEventListener("click", onOutside);
      doc.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("focusin", onFocusIn);
      for (const unsubscribe of subscriptions) unsubscribe?.();
      control.remove();
    },
  });
}
