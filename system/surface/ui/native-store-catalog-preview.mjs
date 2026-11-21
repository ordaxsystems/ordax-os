import { assertAppStoreCatalogPort, validateAppStoreCatalogSnapshot } from "../../contracts/app-store.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { projectStoreCatalogPreview, storeEntryVisualState } from "./store-entry-presentation.mjs";

// Read-only projection of the exact Store catalog already mounted by the OS.
// A catalog entry is never a launch grant; Native app activation remains owned
// by the host's separately verified installed-app runtime and authorization.
export function projectNativeStorePreview(snapshot, limit = 6) {
  return projectStoreCatalogPreview(validateAppStoreCatalogSnapshot(snapshot), limit);
}

function renderPreview(slot, catalog, t) {
  if (!slot) return;
  const doc = slot.ownerDocument;
  const home = slot.dataset.nativeStoreCatalogPreview === "home";
  const limit = home ? 4 : 10;
  slot.replaceChildren();
  const sectionTitle = doc.createElement("strong");
  sectionTitle.className = "ordax-store-preview-heading";
  sectionTitle.textContent = t("store.presentation.official");
  slot.append(sectionTitle);
  let result;
  try { result = projectNativeStorePreview(catalog.getSnapshot(), limit); }
  catch { result = { state: "unavailable", entries: [], total: 0 }; }
  slot.dataset.catalogState = result.state;
  if (result.state !== "ready") {
    const text = doc.createElement("p");
    text.textContent = t("store.status.unavailableDetail");
    slot.append(text);
    return;
  }
  if (result.total === 0) {
    const text = doc.createElement("p");
    text.textContent = t("store.empty.filtered");
    slot.append(text);
    return;
  }
  const list = doc.createElement("ul");
  list.className = "ordax-store-preview-list";
  list.setAttribute("aria-label", t("store.presentation.official"));
  for (const entry of result.entries) {
    const visual = storeEntryVisualState(entry);
    const row = doc.createElement("li");
    row.dataset.storeEntryState = visual.state;
    row.dataset.storeUpdateAvailable = String(visual.updateAvailable);
    const title = doc.createElement("span");
    title.textContent = entry.title;
    const detail = doc.createElement("small");
    detail.textContent = visual.updateAvailable ? t("store.section.updates") : t("store.state." + visual.state);
    row.append(title, detail);
    if (entry.installedVersion !== null || entry.availableVersion !== null) {
      const versions = doc.createElement("small");
      versions.className = "ordax-store-preview-versions";
      versions.textContent = entry.installedVersion !== null && entry.availableVersion !== null
        ? t("store.version.update", { installedVersion: entry.installedVersion, availableVersion: entry.availableVersion })
        : entry.installedVersion !== null
          ? t("store.version.installed", { version: entry.installedVersion })
          : t("store.version.available", { version: entry.availableVersion });
      row.append(versions);
    }
    if (visual.blockedReason !== null) {
      const reason = doc.createElement("small");
      reason.className = "ordax-store-preview-warning";
      reason.textContent = t("store.details.blocked") + " " + visual.blockedReason;
      row.append(reason);
    }
    list.append(row);
  }
  slot.append(list);
  if (result.total > result.entries.length) {
    const extra = doc.createElement("p");
    // This is the catalog's authoritative total, not an invented "more apps" count.
    extra.textContent = t("store.results.count", { count: String(result.total) });
    slot.append(extra);
  }
  const note = doc.createElement("small");
  note.textContent = t("store.security.note");
  slot.append(note);
}

export function mountNativeStoreCatalogPreview(root, catalogPort, surfaceLifecycle) {
  const catalog = assertAppStoreCatalogPort(catalogPort);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const slots = [...root.querySelectorAll("[data-native-store-catalog-preview]")];
  const render = () => {
    for (const slot of slots) renderPreview(slot, catalog, lifecycle.localization.translate);
  };
  const unsubscribeCatalog = catalog.subscribe(render);
  const unsubscribeLocale = lifecycle.localization.subscribe(render);
  render();
  return Object.freeze({
    destroy() { unsubscribeCatalog(); unsubscribeLocale(); }
  });
}
