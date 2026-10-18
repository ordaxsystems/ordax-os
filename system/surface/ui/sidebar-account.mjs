import { validateIdentitySessionSnapshot, assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { SIDEBAR_SOURCE_MESSAGES } from "../../services/i18n/catalog/sidebar.mjs";
import { escapeMarkup } from "./sidebar-layout.mjs";
const USER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>';
const CHEVRON = '<svg class="account-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
export function projectSidebarAccount(identity, offline = false, translate = id => SIDEBAR_SOURCE_MESSAGES[id]) {
  const session = validateIdentitySessionSnapshot(identity);
  const displayName = session.state === "signed-in" ? session.displayName : translate(session.state === "signed-out" ? "sidebar.account.signIn" : "sidebar.account.unavailable");
  const initials = session.state === "signed-in" ? displayName.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? "").join("").toLocaleUpperCase() : null;
  return Object.freeze({ displayName, initials, connected: session.state === "signed-in" && !offline, status: translate(offline ? "sidebar.account.offline" : session.state === "signed-in" ? "sidebar.account.signedIn" : "sidebar.account.connect"), openLabel: translate("sidebar.account.open"), storageLabel: translate("sidebar.storage.unavailable"), storageShort: translate("sidebar.storage.short"), notificationsLabel: translate("sidebar.notifications"), notificationsUnavailable: translate("sidebar.notifications.unavailable") });
}
export function sidebarAccountMarkup(view, native = false) {
  const launch = native ? 'data-sidebar-app="account" data-launch-app="account" data-app-target="overview"' : '';
  return `<section class="account sidebar-account" aria-label="${escapeMarkup(view.displayName)}">
    <button type="button" class="account-open meridian-rail-account" data-sidebar-account-open ${launch} aria-label="${escapeMarkup(view.openLabel)}" title="${escapeMarkup(view.openLabel)}"><span class="meridian-account-avatar" aria-hidden="true"><span class="avatar" data-sidebar-avatar>${view.initials ? escapeMarkup(view.initials) : USER_ICON}</span><i data-sidebar-account-connected data-connected="${view.connected}"></i></span><span class="account-identity"><strong data-sidebar-account-name>${escapeMarkup(view.displayName)}</strong><span data-sidebar-account-status>${escapeMarkup(view.status)}</span></span>${CHEVRON}</button>
    <div class="storage-track storage-unavailable" data-sidebar-storage aria-label="${escapeMarkup(view.storageLabel)}"></div>
    <div class="account-storage-footer"><span class="account-storage-value" title="${escapeMarkup(view.storageLabel)}"><span class="account-storage-summary" data-sidebar-storage-short>${escapeMarkup(view.storageShort)}</span><span class="account-storage-compact">—</span></span><div class="account-actions" data-sidebar-notification-slot><button type="button" data-sidebar-notifications ${native ? 'disabled' : ''} title="${escapeMarkup(native ? view.notificationsUnavailable : view.notificationsLabel)}" aria-label="${escapeMarkup(view.notificationsLabel)}">${BELL}</button></div></div>
  </section>`;
}
export function sidebarProfileButtonMarkup(view, native = false, active = false) {
  const attributes = [native ? 'data-sidebar-app="account" data-launch-app="account" data-app-target="overview"' : '', active ? 'aria-current="page"' : ''].filter(Boolean).join(' ');
  return `<button type="button" class="account-open meridian-rail-account" data-sidebar-account-open${attributes ? ` ${attributes}` : ''} aria-label="${escapeMarkup(view.openLabel)}" title="${escapeMarkup(`${view.displayName} · ${view.status}`)}"><span class="meridian-account-avatar" aria-hidden="true"><span class="avatar" data-sidebar-avatar>${view.initials ? escapeMarkup(view.initials) : USER_ICON}</span><i data-sidebar-account-connected data-connected="${view.connected}"></i></span><span class="account-identity"><strong data-sidebar-account-name>${escapeMarkup(view.displayName)}</strong><small data-sidebar-account-status>${escapeMarkup(view.status)}</small></span>${CHEVRON}</button>`;
}
export function sidebarProfileMarkup(view, native = false, active = false) {
  return `<section class="account sidebar-account" aria-label="${escapeMarkup(view.displayName)}">${sidebarProfileButtonMarkup(view, native, active)}</section>`;
}
// Bind the existing Native identity port to the same presentation; no second session.
export function mountNativeSidebarAccount(root, identity, host, surface) {
  const port = assertIdentitySessionPort(identity);
  const card = root.querySelector(".sidebar-account");
  const t = surface.localization.translate;
  function render() {
    const snapshot = host.getSnapshot();
    const session = snapshot.capabilityIds.includes("account.identity") ? port.getSnapshot() : { state: "unavailable" };
    const view = projectSidebarAccount(session, snapshot.connectivity === "offline", t);
    card.setAttribute("aria-label", view.displayName);
    card.querySelector("[data-sidebar-account-name]").textContent = view.displayName;
    card.querySelector("[data-sidebar-account-status]").textContent = view.status;
    card.querySelector("[data-sidebar-account-connected]").setAttribute("data-connected", String(view.connected));
    const storageShort = card.querySelector("[data-sidebar-storage-short]");
    const storage = card.querySelector("[data-sidebar-storage]");
    const storageValue = card.querySelector(".account-storage-value");
    if (storageShort) storageShort.textContent = view.storageShort;
    if (storage) storage.setAttribute("aria-label", view.storageLabel);
    if (storageValue) storageValue.setAttribute("title", view.storageLabel);
    const open = card.querySelector("[data-sidebar-account-open]");
    open.setAttribute("title", `${view.displayName} · ${view.status}`); open.setAttribute("aria-label", view.openLabel);
    const avatar = card.querySelector("[data-sidebar-avatar]");
    if (view.initials) avatar.textContent = view.initials; else avatar.innerHTML = USER_ICON;
  }
  const stops = [port.subscribe(render), host.subscribe(render), surface.localization.subscribe(render)]; render();
  return Object.freeze({ destroy() { stops.forEach(stop => stop()); } });
}
