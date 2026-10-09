import { assertBrowserSessionPort } from "../../../contracts/browser-session.mjs";
import { assertBrowserPageFindPort, MAX_BROWSER_PAGE_FIND_CHARS } from "../../../contracts/browser-page-find.mjs";
import { assertBrowserDownloadPort } from "../../../contracts/browser-download.mjs";
import { BROWSER_SEARCH_PROVIDERS, BROWSER_SEARCH_PROVIDER, resolveBrowserNavigation } from "../../../contracts/browser-navigation.mjs";
import { assertBrowserSearchPreferencesPort } from "../../../contracts/browser-search-preferences.mjs";
import {
  assertBrowserPageSelectionPort,
  validateBrowserPageSelection,
  browserSelectionIntelligenceRequest,
} from "../../../contracts/browser-page-selection.mjs";
import { assertIntelligencePort, validateIntelligenceResponse } from "../../../contracts/intelligence.mjs";
import { assertIdentitySessionPort } from "../../../contracts/identity-session.mjs";
import { assertSpaceSelectionPort } from "../../../contracts/space-selection.mjs";
import { assertProfileActivationStatePort } from "../../../contracts/profile-activation-state.mjs";

import {
  assertBrowserFavoritesPort,
  validateBrowserFavoriteUrl,
} from "../../../contracts/browser-favorites.mjs";
import { assertBrowserHistoryPort } from "../../../contracts/browser-history.mjs";
import { assertProjectCatalogPort } from "../../../contracts/project-catalog.mjs";
import {
  assertProjectWebReferencePort,
  validateProjectWebUrl,
} from "../../../contracts/project-web-references.mjs";
import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";

const INTERNET_WINDOW_SELECTOR = '[data-window-id="internet"]';
const INTERNET_EXTENSION_SELECTOR = '[data-app-extension="internet-browser"]';
const MAX_UI_TABS = 16;
const PROJECT_PANEL_ID = "ordax-internet-project-panel";

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function iconButton(documentObject, glyph, label, action) {
  const button = node(documentObject, "button", "ordax-internet-icon-button", glyph);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.dataset.browserAction = action;
  return button;
}

function displayHost(url, emptyLabel = "") {
  if (!url) return emptyLabel;
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function formatHistoryVisit(value, locale = "pt-BR") {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function normalizedTabQuery(value, locale = "pt-BR") {
  return value.trim().toLocaleLowerCase(locale);
}

function tabMatchesQuery(tab, query, locale = "pt-BR") {
  if (!query) return true;
  return [tab.title, displayHost(tab.url), tab.url]
    .filter(Boolean)
    .some((value) => value.toLocaleLowerCase(locale).includes(query));
}

function createSidebar(documentObject, t) {
  const sidebar = node(documentObject, "aside", "ordax-internet-sidebar");
  sidebar.setAttribute("aria-label", t("internet.sidebar.aria"));
  const workspace = node(documentObject, "button", "ordax-internet-workspace");
  workspace.type = "button";
  workspace.disabled = true;
  workspace.title = t("internet.workspace.pending");
  workspace.append(node(documentObject, "span", "ordax-internet-workspace-mark", ""));
  workspace.append(node(documentObject, "strong", "", t("internet.workspace.current")));
  workspace.append(node(documentObject, "span", "", "⌄"));

  const newTab = node(documentObject, "button", "ordax-internet-new-tab", `+  ${t("internet.action.newTab")}`);
  newTab.type = "button";
  newTab.dataset.browserNewTab = "";

  const search = node(documentObject, "label", "ordax-internet-tab-search");
  search.append(node(documentObject, "span", "ordax-internet-tab-search-icon", "⌕"));
  const searchInput = node(documentObject, "input", "ordax-internet-tab-search-input");
  searchInput.type = "search";
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchInput.placeholder = t("internet.search.tabs.placeholder");
  searchInput.setAttribute("aria-label", t("internet.search.tabs.aria"));
  searchInput.dataset.browserTabSearch = "";
  search.append(searchInput);

  const label = node(documentObject, "span", "ordax-internet-section-label", t("internet.tabs.heading"));
  label.id = "ordax-internet-tabs-label";
  const tabs = node(documentObject, "div", "ordax-internet-tabs");
  tabs.dataset.browserTabs = "";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-labelledby", label.id);
  tabs.setAttribute("aria-orientation", "vertical");

  const collections = node(documentObject, "div", "ordax-internet-collections");
  collections.append(node(documentObject, "span", "ordax-internet-section-label", t("internet.collections.heading")));
  for (const [glyph, title] of [["□", t("internet.collections.space")], ["☆", t("internet.collections.readLater")]]) {
    const row = node(documentObject, "button", "ordax-internet-collection-row");
    row.type = "button";
    row.disabled = true;
    row.title = t("internet.collections.pending");
    row.append(node(documentObject, "span", "", glyph), node(documentObject, "span", "", title));
    collections.append(row);
  }
  const favoritesToggle = node(documentObject, "button", "ordax-internet-collection-row");
  favoritesToggle.type = "button";
  favoritesToggle.dataset.browserFavoritesToggle = "";
  favoritesToggle.setAttribute("aria-expanded", "false");
  favoritesToggle.append(node(documentObject, "span", "", "★"));
  const favoritesLabel = node(documentObject, "span", "", t("internet.favorites"));
  favoritesLabel.dataset.browserFavoritesLabel = "";
  favoritesToggle.append(favoritesLabel);
  collections.append(favoritesToggle);
  const favoritesList = node(documentObject, "div", "ordax-internet-favorites-list");
  favoritesList.dataset.browserFavoritesList = "";
  favoritesList.hidden = true;
  collections.append(favoritesList);

  const history = node(documentObject, "div", "ordax-internet-history");
  history.append(node(documentObject, "span", "ordax-internet-section-label", t("internet.navigation.heading")));
  const historyToggle = node(documentObject, "button", "ordax-internet-collection-row");
  historyToggle.type = "button";
  historyToggle.dataset.browserHistoryToggle = "";
  historyToggle.setAttribute("aria-expanded", "false");
  historyToggle.append(node(documentObject, "span", "", "◷"));
  const historyLabel = node(documentObject, "span", "", t("internet.history"));
  historyLabel.dataset.browserHistoryLabel = "";
  historyToggle.append(historyLabel);
  history.append(historyToggle);
  const historyList = node(documentObject, "div", "ordax-internet-history-list");
  historyList.dataset.browserHistoryList = "";
  historyList.hidden = true;
  history.append(historyList);

  const footer = node(documentObject, "div", "ordax-internet-sidebar-footer");
  footer.append(node(documentObject, "span", "", t("internet.privateSoon")));

  sidebar.append(workspace, newTab, search, label, tabs, collections, history, footer);
  return sidebar;
}

function createToolbar(documentObject, t) {
  const toolbar = node(documentObject, "div", "ordax-internet-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", t("internet.toolbar.aria"));
  toolbar.append(
    iconButton(documentObject, "←", t("internet.action.back"), "back"),
    iconButton(documentObject, "→", t("internet.action.forward"), "forward"),
    iconButton(documentObject, "↻", t("internet.action.reload"), "reload"),
  );
  const form = node(documentObject, "form", "ordax-internet-address-form");
  form.dataset.browserAddressForm = "";
  const input = node(documentObject, "input", "ordax-internet-address");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = t("internet.address.placeholder");
  input.setAttribute("aria-label", t("internet.address.aria"));
  input.dataset.browserAddress = "";
  form.append(node(documentObject, "span", "ordax-internet-site-control", "◈"), input);
  const providerSelect = node(documentObject, "select", "ordax-internet-search-provider");
  providerSelect.dataset.browserSearchProvider = "";
  providerSelect.setAttribute("aria-label", t("internet.searchProvider.label"));
  for (const provider of BROWSER_SEARCH_PROVIDERS) {
    const option = documentObject.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name;
    providerSelect.append(option);
  }
  const find = iconButton(documentObject, "⌕", t("internet.pageFind.open"), "find");
  find.dataset.browserFindToggle = "";
  toolbar.append(form, providerSelect, find, iconButton(documentObject, "☆", t("internet.action.bookmark"), "bookmark"));
  const downloads = iconButton(documentObject, "⇩", t("internet.action.downloads"), "downloads");
  downloads.dataset.browserDownloadsToggle = "";
  downloads.setAttribute("aria-expanded", "false");
  const more = iconButton(documentObject, "⋮", t("internet.action.projectPanel"), "more");
  more.setAttribute("aria-controls", PROJECT_PANEL_ID);
  more.setAttribute("aria-expanded", "true");
  toolbar.append(downloads, more);
  return toolbar;
}

function createHome(documentObject, supported, reason, t) {
  const home = node(documentObject, "div", "ordax-internet-home");
  home.dataset.browserHome = "";
  home.append(node(documentObject, "span", "ordax-internet-home-mark", "○"));
  home.append(node(documentObject, "h2", "", t("internet.home.title")));
  home.append(node(documentObject, "p", "", t("internet.home.body")));
  if (!supported) {
    const unavailable = node(documentObject, "div", "ordax-internet-unavailable");
    unavailable.append(node(documentObject, "strong", "", t("internet.home.unavailable")));
    unavailable.append(node(documentObject, "span", "", reason));
    home.append(unavailable);
  } else {
    home.append(node(documentObject, "span", "ordax-internet-home-hint", t("internet.home.hint")));
  }
  const cards = node(documentObject, "div", "ordax-internet-home-links");
  for (const [key, label] of [
    ["session", t("internet.home.session")],
    ["projects", t("internet.home.projects")],
    ["references", t("internet.home.references")],
    ["favorites", t("internet.home.favorites")],
    ["history", t("internet.home.history")],
  ]) {
    const card = node(documentObject, "div", "ordax-internet-home-link");
    const value = node(documentObject, "strong", "", t("internet.home.checking"));
    value.dataset.browserHomeStatus = key;
    card.append(node(documentObject, "span", "", label), value);
    cards.append(card);
  }
  home.append(cards);
  return home;
}

function createProjectPanel(documentObject, t) {
  const panel = node(documentObject, "aside", "ordax-internet-project-panel");
  panel.id = PROJECT_PANEL_ID;
  panel.setAttribute("aria-label", t("internet.project.aria"));
  const header = node(documentObject, "div", "ordax-internet-project-header");
  header.append(node(documentObject, "h2", "", t("internet.project.title")));
  const close = node(documentObject, "button", "ordax-internet-panel-close", "×");
  close.type = "button";
  close.dataset.browserPanelClose = "";
  close.setAttribute("aria-label", t("internet.project.collapse"));
  header.append(close);

  const intro = node(documentObject, "div", "ordax-internet-project-intro");
  intro.append(node(documentObject, "span", "ordax-internet-section-label", t("internet.project.sessionHeading")));
  const contextName = node(documentObject, "strong", "ordax-internet-project-context-name", t("internet.project.none"));
  contextName.dataset.browserProjectContextName = "";
  const contextDetail = node(documentObject, "p", "", t("internet.project.choose"));
  contextDetail.dataset.browserProjectContextDetail = "";
  intro.append(contextName, contextDetail);

  const projects = node(documentObject, "section", "ordax-internet-project-section");
  projects.append(node(documentObject, "h3", "", t("internet.project.available")));
  const projectOptions = node(documentObject, "div", "ordax-internet-project-options");
  projectOptions.dataset.browserProjectOptions = "";
  projects.append(projectOptions);

  const current = node(documentObject, "section", "ordax-internet-project-section");
  current.append(node(documentObject, "h3", "", t("internet.project.currentPage")));
  const page = node(documentObject, "div", "ordax-internet-page-reference");
  page.dataset.browserCurrentPage = "";
  current.append(page);
  const save = node(documentObject, "button", "ordax-internet-save-button", `▱  ${t("internet.project.save")}`);
  save.type = "button";
  save.dataset.browserSaveProject = "";
  save.disabled = true;
  current.append(save);
  const savedState = node(documentObject, "div", "ordax-internet-reference-state");
  savedState.dataset.browserReferenceState = "";
  savedState.hidden = true;
  current.append(savedState);

  const note = node(documentObject, "section", "ordax-internet-project-section");
  note.append(node(documentObject, "h3", "", t("internet.project.yourNote")));
  const textarea = node(documentObject, "textarea", "ordax-internet-note");
  textarea.rows = 3;
  textarea.placeholder = t("internet.project.notePlaceholder");
  textarea.dataset.browserReferenceNote = "";
  textarea.disabled = true;
  textarea.maxLength = 4096;
  const noteHint = node(documentObject, "span", "ordax-internet-project-pending");
  noteHint.dataset.browserReferenceNoteHint = "";
  note.append(textarea, noteHint);

  const materials = node(documentObject, "section", "ordax-internet-project-section");
  materials.append(node(documentObject, "h3", "", t("internet.project.context")));
  const projectFolder = node(documentObject, "div", "ordax-internet-material-row");
  projectFolder.dataset.browserProjectFolder = "";
  materials.append(projectFolder);

  const assistance = node(documentObject, "section", "ordax-internet-assistance");
  assistance.append(node(documentObject, "h3", "", t("internet.assistance.title")));
  const capture = node(documentObject, "button", "ordax-internet-ask-button", t("internet.assistance.capture"));
  capture.type = "button";
  capture.disabled = true;
  capture.dataset.browserCaptureSelection = "";
  const preview = node(documentObject, "textarea", "ordax-internet-selected-preview");
  preview.dataset.browserSelectionPreview = "";
  preview.readOnly = true;
  preview.rows = 4;
  preview.hidden = true;
  preview.setAttribute("aria-label", t("internet.assistance.selectionPreview"));
  const clipped = node(documentObject, "span", "ordax-internet-selection-warning",
    t("internet.assistance.truncated"));
  clipped.dataset.browserSelectionTruncated = "";
  clipped.hidden = true;
  const question = node(documentObject, "input", "ordax-internet-assistance-question");
  question.type = "text";
  question.maxLength = 800;
  question.placeholder = t("internet.assistance.questionPlaceholder");
  question.dataset.browserSelectionQuestion = "";
  question.hidden = true;
  const send = node(documentObject, "button", "ordax-internet-ask-button", t("internet.assistance.ask"));
  send.type = "button";
  send.disabled = true;
  send.dataset.browserSendSelection = "";
  send.hidden = true;
  const clear = node(documentObject, "button", "ordax-internet-assistance-clear", t("internet.assistance.clear"));
  clear.type = "button";
  clear.dataset.browserClearSelection = "";
  clear.hidden = true;
  const answer = node(documentObject, "div", "ordax-internet-assistance-answer");
  answer.dataset.browserSelectionAnswer = "";
  answer.setAttribute("role", "status");
  answer.hidden = true;
  assistance.append(capture, preview, clipped, question, send, clear, answer,
    node(documentObject, "span", "", t("internet.assistance.copy")));

  panel.append(header, intro, projects, current, note, materials, assistance);
  return panel;
}

function createPageFindBar(documentObject, t) {
  const bar = node(documentObject, "div", "ordax-internet-find-bar");
  bar.dataset.browserFindBar = "";
  bar.hidden = true;
  bar.setAttribute("role", "search");
  const input = node(documentObject, "input", "ordax-internet-find-input");
  input.type = "search";
  input.maxLength = MAX_BROWSER_PAGE_FIND_CHARS;
  input.placeholder = t("internet.pageFind.placeholder");
  input.setAttribute("aria-label", t("internet.pageFind.placeholder"));
  input.dataset.browserFindInput = "";
  const status = node(documentObject, "span", "ordax-internet-find-status");
  status.dataset.browserFindStatus = "";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const previous = iconButton(documentObject, "↑", t("internet.pageFind.previous"), "find-previous");
  previous.dataset.browserFindPrevious = "";
  const next = iconButton(documentObject, "↓", t("internet.pageFind.next"), "find-next");
  next.dataset.browserFindNext = "";
  const close = iconButton(documentObject, "×", t("internet.pageFind.close"), "find-close");
  close.dataset.browserFindClose = "";
  bar.append(input, status, previous, next, close);
  return bar;
}

function createView(documentObject, snapshot, t) {
  const view = node(documentObject, "div", "ordax-internet-view");
  view.dataset.ordaxInternetView = "";
  const toolbar = createToolbar(documentObject, t);
  const body = node(documentObject, "div", "ordax-internet-body");
  const center = node(documentObject, "main", "ordax-internet-center");
  const viewport = node(documentObject, "div", "ordax-internet-viewport");
  viewport.dataset.browserViewport = "";
  viewport.append(createHome(documentObject, snapshot.supported, snapshot.reason, t));
  center.append(viewport);
  body.append(createSidebar(documentObject, t), center, createProjectPanel(documentObject, t));
  const downloadsPanel = node(documentObject, "section", "ordax-internet-downloads-panel");
  downloadsPanel.dataset.browserDownloadsPanel = "";
  downloadsPanel.setAttribute("aria-label", t("internet.downloads.heading"));
  downloadsPanel.hidden = true;
  view.append(toolbar, downloadsPanel, createPageFindBar(documentObject, t), body);
  return view;
}

export function mountInternetBrowserControls(
  root,
  browserSession,
  surfaceLifecycle,
  {
    projects = null,
    projectReferences = null,
    favorites = null,
    history = null,
    searchPreferences = null,
    pageSelection = null,
    pageFind = null,
    downloads = null,
    intelligence = null,
    identitySessionPort = null,
    spaceSelectionPort = null,
    profileActivationStatePort = null,
  } = {},
) {
  if (!(root instanceof Element)) throw new TypeError("Internet controls require a Surface root Element");
  const port = assertBrowserSessionPort(browserSession);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const locale = () => localization.getLocale();
  const projectPort = projects === null ? null : assertProjectCatalogPort(projects);
  const referencePort = projectReferences === null
    ? null
    : assertProjectWebReferencePort(projectReferences);
  const favoritePort = favorites === null ? null : assertBrowserFavoritesPort(favorites);
  const historyPort = history === null ? null : assertBrowserHistoryPort(history);
  const searchPreferencesPort = searchPreferences === null
    ? null : assertBrowserSearchPreferencesPort(searchPreferences);
  const selectionPort = pageSelection === null ? null : assertBrowserPageSelectionPort(pageSelection);
  const findPort = pageFind === null ? null : assertBrowserPageFindPort(pageFind);
  const downloadPort = downloads === null ? null : assertBrowserDownloadPort(downloads);
  const intelligencePort = intelligence === null ? null : assertIntelligencePort(intelligence);
  const scopeIdentity = identitySessionPort === null ? null : assertIdentitySessionPort(identitySessionPort);
  const scopeSelection = spaceSelectionPort === null ? null : assertSpaceSelectionPort(spaceSelectionPort);
  const scopeProfile = profileActivationStatePort === null ? null : assertProfileActivationStatePort(profileActivationStatePort);
  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView;
  let snapshot = port.getSnapshot();
  let projectSnapshot = projectPort?.getSnapshot() ?? null;
  let referenceSnapshot = referencePort?.getSnapshot() ?? null;
  let favoriteSnapshot = favoritePort?.getSnapshot() ?? null;
  let historySnapshot = historyPort?.getSnapshot() ?? null;
  let selectedProjectId = null;
  let noteDraftKey = "";
  let noteDraftValue = "";
  let mountedSlot = null;
  let destroyed = false;
  let nextTabOrdinal = 1;
  let messageId = null;
  let messageParams = Object.freeze({});
  let externalMessage = "";
  let panelCollapsed = false;
  let favoritesExpanded = false;
  let historyExpanded = false;
  let tabQuery = "";
  let pendingTabFocusId = null;
  let handledSurfaceTarget = null;
  let resizeObserver = null;
  let downloadsExpanded = false;
  const downloadRecords = new Map();
  let findOpen = false;
  let findQuery = "";
  let findTabId = null;
  let findResult = null;
  let selectedPage = null;
  let questionDraft = "";
  let selectionAnswer = "";
  let selectionGeneration = 0;
  let selectionCaptureBusy = false;
  let selectionSendBusy = false;
  const clearSelectedPage = () => {
    selectionGeneration += 1;
    selectedPage = null;
    selectionAnswer = "";
    questionDraft = "";
  };


  const findSlot = () => root.querySelector(`${INTERNET_WINDOW_SELECTOR} ${INTERNET_EXTENSION_SELECTOR}`);
  const clearMessage = () => {
    messageId = null;
    messageParams = Object.freeze({});
    externalMessage = "";
  };
  const setMessage = (id, params = {}) => {
    messageId = id;
    messageParams = Object.freeze({ ...params });
    externalMessage = "";
  };
  const setExternalMessage = (value) => {
    messageId = null;
    messageParams = Object.freeze({});
    externalMessage = String(value ?? "");
  };
  const renderedMessage = () =>
    messageId ? t(messageId, messageParams) : externalMessage;
  const activeTab = () => snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null;
  const selectedProject = () => projectSnapshot?.projects.find((project) => project.id === selectedProjectId) ?? null;
  const activeReferenceUrl = () => {
    const url = activeTab()?.url;
    if (!url) return null;
    try {
      return validateProjectWebUrl(url);
    } catch {
      return null;
    }
  };

  const activeFavoriteUrl = () => {
    const url = activeTab()?.url;
    if (!url) return null;
    try {
      return validateBrowserFavoriteUrl(url);
    } catch {
      return null;
    }
  };

  const activeFavorite = () => {
    const url = activeFavoriteUrl();
    if (!favoriteSnapshot || !url) return null;
    return favoriteSnapshot.favorites.find((favorite) => favorite.url === url) ?? null;
  };

  const activeSavedReference = () => {
    const url = activeReferenceUrl();
    if (!referenceSnapshot || !selectedProjectId || !url) return null;
    return referenceSnapshot.references.find((reference) => (
      reference.projectId === selectedProjectId && reference.url === url
    )) ?? null;
  };

  const currentReferenceKey = () => {
    const url = activeReferenceUrl();
    return selectedProjectId && url ? `${selectedProjectId}\u0000${url}` : "";
  };

  const syncNoteDraft = () => {
    const key = currentReferenceKey();
    if (key === noteDraftKey) return;
    noteDraftKey = key;
    noteDraftValue = key ? (activeSavedReference()?.note ?? "") : "";
  };

  const allocateTabId = () => {
    while (snapshot.tabs.some((tab) => tab.id === `tab-${nextTabOrdinal}`)) nextTabOrdinal += 1;
    return `tab-${nextTabOrdinal++}`;
  };

  const visibleTabs = () => {
    const query = normalizedTabQuery(tabQuery, locale());
    return snapshot.tabs.filter((tab) => tabMatchesQuery(tab, query, locale()));
  };

  const findTabButton = (slot, tabId) => [...(slot?.querySelectorAll("[data-browser-tab-id]") ?? [])]
    .find((button) => button.dataset.browserTabId === tabId) ?? null;

  const focusTab = (tabId) => {
    windowObject.requestAnimationFrame(() => {
      findTabButton(findSlot(), tabId)?.focus({ preventScroll: true });
    });
  };

  const focusProject = (projectId) => {
    windowObject.requestAnimationFrame(() => {
      const slot = findSlot();
      const option = [...(slot?.querySelectorAll("[data-browser-project-id]") ?? [])]
        .find((button) => button.dataset.browserProjectId === projectId) ?? null;
      option?.focus({ preventScroll: true });
    });
  };

  const syncViewport = () => {
    if (destroyed) return;
    const slot = findSlot();
    const viewport = slot?.querySelector("[data-browser-viewport]") ?? null;
    const tab = activeTab();
    if (!viewport || !snapshot.supported || !tab?.url || !slot.isConnected) {
      port.setViewport({ visible: false, x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const visible = rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.right > 0
      && rect.top < windowObject.innerHeight && rect.left < windowObject.innerWidth;
    port.setViewport({
      visible,
      x: Math.max(0, Math.round(rect.left)),
      y: Math.max(0, Math.round(rect.top)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    });
  };

  const syncSurfaceTarget = () => {
    const target = lifecycle.getAppTarget("internet");
    if (target === null) {
      handledSurfaceTarget = null;
      return;
    }
    if (target === handledSurfaceTarget || !snapshot.supported) return;

    handledSurfaceTarget = target;
    try {
      const url = resolveBrowserNavigation(target, { allowSearch: false })?.url;
      if (!url) return;
      const tab = activeTab();
      clearMessage();
      if (tab) {
        if (tab.url !== url) port.navigate(tab.id, url);
      } else {
        port.openTab(allocateTabId(), url);
      }
    } catch {
      setMessage("internet.address.invalid");
    }
  };

  const ensureTab = () => {
    if (!snapshot.supported || snapshot.tabs.length > 0) return;
    port.openTab(allocateTabId(), "");
  };

  const syncTabs = (slot) => {
    const tabs = slot.querySelector("[data-browser-tabs]");
    if (!tabs) return;
    const searchInput = slot.querySelector("[data-browser-tab-search]");
    if (searchInput && documentObject.activeElement !== searchInput && searchInput.value !== tabQuery) {
      searchInput.value = tabQuery;
    }

    const focusedTabId = documentObject.activeElement?.dataset?.browserTabId ?? null;
    tabs.replaceChildren();
    const query = normalizedTabQuery(tabQuery, locale());
    const filteredTabs = visibleTabs();
    const activeVisible = filteredTabs.some((tab) => tab.id === snapshot.activeTabId);
    for (const tab of filteredTabs) {
      const row = node(documentObject, "div", "ordax-internet-tab");
      row.dataset.selected = String(tab.id === snapshot.activeTabId);
      row.setAttribute("role", "presentation");

      const activate = node(documentObject, "button", "ordax-internet-tab-activate");
      activate.type = "button";
      activate.dataset.browserTabId = tab.id;
      activate.setAttribute("role", "tab");
      activate.setAttribute("aria-selected", String(tab.id === snapshot.activeTabId));
      activate.tabIndex = (
        tab.id === snapshot.activeTabId
        || (!activeVisible && tab.id === filteredTabs[0]?.id)
      ) ? 0 : -1;
      activate.append(node(documentObject, "span", "ordax-internet-tab-icon", tab.loading ? "◌" : "▤"));
      activate.append(node(documentObject, "span", "ordax-internet-tab-title", tab.title || displayHost(tab.url, t("internet.tab.new"))));
      row.append(activate);

      if (snapshot.tabs.length > 1) {
        const close = node(documentObject, "button", "ordax-internet-tab-close", "×");
        close.type = "button";
        close.dataset.browserCloseTab = tab.id;
        close.setAttribute("aria-label", t("internet.tab.close", { title: tab.title || t("internet.search.localeEmptyTitle") }));
        row.append(close);
      }
      tabs.append(row);
    }
    if (query && filteredTabs.length === 0) {
      tabs.append(node(documentObject, "div", "ordax-internet-tab-placeholder", t("internet.tabs.emptySearch")));
    } else if (!snapshot.supported && snapshot.tabs.length === 0) {
      tabs.append(node(documentObject, "div", "ordax-internet-tab-placeholder", t("internet.tabs.localNavigation")));
    }
    if (focusedTabId && filteredTabs.some((tab) => tab.id === focusedTabId)) {
      focusTab(focusedTabId);
    }
  };

  const syncProjectContext = (slot) => {
    const options = slot.querySelector("[data-browser-project-options]");
    const contextName = slot.querySelector("[data-browser-project-context-name]");
    const contextDetail = slot.querySelector("[data-browser-project-context-detail]");
    const folder = slot.querySelector("[data-browser-project-folder]");
    const selected = selectedProject();

    if (contextName) contextName.textContent = selected?.name ?? t("internet.project.none");
    if (contextDetail) {
      if (selected) {
        contextDetail.textContent = t("internet.project.localContext", { path: selected.path });
      } else if (projectSnapshot) {
        contextDetail.textContent = t("internet.project.choose");
      } else {
        contextDetail.textContent = t("internet.project.catalogUnavailable");
      }
    }

    if (folder) {
      folder.replaceChildren();
      folder.append(node(documentObject, "span", "", selected ? "□" : "○"));
      const copy = node(documentObject, "span", "ordax-internet-page-copy");
      copy.append(node(documentObject, "strong", "", t(selected ? "internet.project.folder" : "internet.project.noContext")));
      copy.append(node(documentObject, "small", "", selected?.path ?? t("internet.project.selectForResearch")));
      folder.append(copy);
    }

    if (!options) return;
    const projectEntries = projectSnapshot?.projects ?? [];
    const renderKey = JSON.stringify([
      selectedProjectId,
      projectSnapshot?.persistence ?? "unavailable",
      ...projectEntries.flatMap((project) => [project.id, project.name, project.path]),
    ]);
    if (options.dataset.browserProjectRenderKey === renderKey) return;
    options.dataset.browserProjectRenderKey = renderKey;
    options.replaceChildren();

    if (!projectSnapshot) {
      options.append(node(documentObject, "div", "ordax-internet-tab-placeholder", t("internet.project.catalogUnavailable")));
      return;
    }
    if (projectEntries.length === 0) {
      options.append(node(documentObject, "div", "ordax-internet-tab-placeholder", t("internet.project.noneRegistered")));
      return;
    }

    for (const project of projectEntries) {
      const row = node(documentObject, "button", "ordax-internet-material-row ordax-internet-project-option");
      row.type = "button";
      row.dataset.browserProjectId = project.id;
      row.setAttribute("aria-pressed", String(project.id === selectedProjectId));
      row.title = t("internet.project.useAsContext", { name: project.name });
      row.append(node(documentObject, "span", "", project.id === selectedProjectId ? "●" : "○"));
      const copy = node(documentObject, "span", "ordax-internet-page-copy");
      copy.append(node(documentObject, "strong", "", project.name));
      copy.append(node(documentObject, "small", "", project.path));
      row.append(copy, node(documentObject, "span", "", project.id === selectedProjectId ? t("internet.project.currentMarker") : ""));
      options.append(row);
    }
  };

  const syncHomeStatus = (slot) => {
    const setStatus = (key, value) => {
      const target = slot.querySelector(`[data-browser-home-status="${key}"]`);
      if (target) target.textContent = value;
    };
    const tabCount = snapshot.tabs.length;
    setStatus(
      "session",
      snapshot.supported
        ? t(tabCount === 1 ? "internet.home.status.tabOne" : "internet.home.status.tabs", { count: tabCount })
        : t("internet.home.status.navigationUnavailable"),
    );

    const projectCount = projectSnapshot?.projects.length ?? 0;
    setStatus(
      "projects",
      !projectSnapshot
        ? t("internet.home.status.unavailable")
        : projectCount === 0
          ? t("internet.home.status.projectsNone")
          : t(projectCount === 1 ? "internet.home.status.projectOne" : "internet.home.status.projects", { count: projectCount }),
    );

    const referenceCount = referenceSnapshot?.references.length ?? 0;
    setStatus(
      "references",
      !referenceSnapshot
        ? t("internet.home.status.unavailable")
        : referenceCount === 0
          ? t("internet.home.status.referencesNone")
          : t(referenceCount === 1 ? "internet.home.status.referenceOne" : "internet.home.status.references", { count: referenceCount }),
    );

    const favoriteCount = favoriteSnapshot?.favorites.length ?? 0;
    setStatus(
      "favorites",
      !favoriteSnapshot
        ? t("internet.home.status.unavailable")
        : favoriteCount === 0
          ? t("internet.home.status.favoritesNone")
          : t(favoriteCount === 1 ? "internet.home.status.favoriteOne" : "internet.home.status.favorites", { count: favoriteCount }),
    );

    const historyCount = historySnapshot?.entries.length ?? 0;
    setStatus(
      "history",
      !historySnapshot
        ? t("internet.home.status.unavailable")
        : historyCount === 0
          ? t("internet.home.status.historyNone")
          : t(historyCount === 1 ? "internet.home.status.historyOne" : "internet.home.status.history", { count: historyCount }),
    );
  };

  const syncCurrentPage = (slot) => {
    const tab = activeTab();
    const reference = slot.querySelector("[data-browser-current-page]");
    if (reference) {
      reference.replaceChildren();
      reference.append(node(documentObject, "span", "ordax-internet-page-icon", "▤"));
      const copy = node(documentObject, "span", "ordax-internet-page-copy");
      copy.append(node(documentObject, "strong", "", tab?.title || (tab?.url ? displayHost(tab.url, t("internet.tab.new")) : t("internet.tab.new"))));
      copy.append(node(documentObject, "small", "", tab?.url ? displayHost(tab.url, t("internet.tab.new")) : t("internet.page.none")));
      reference.append(copy);
    }
    const address = slot.querySelector("[data-browser-address]");
    if (address && documentObject.activeElement !== address) address.value = tab?.url ?? "";
    for (const button of slot.querySelectorAll("[data-browser-action]")) {
      const action = button.dataset.browserAction;
      if (action === "back") button.disabled = !tab?.canGoBack;
      if (action === "forward") button.disabled = !tab?.canGoForward;
      if (action === "reload") button.disabled = !tab?.url;
    }
    const viewport = slot.querySelector("[data-browser-viewport]");
    const home = viewport?.querySelector("[data-browser-home]");
    if (home) home.hidden = Boolean(tab?.url);
    let status = slot.querySelector("[data-browser-message]");
    const currentMessage = renderedMessage();
    if (!status && currentMessage) {
      status = node(documentObject, "div", "ordax-internet-message");
      status.dataset.browserMessage = "";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      slot.querySelector(".ordax-internet-center")?.append(status);
    }
    if (status) {
      status.textContent = currentMessage;
      status.hidden = !currentMessage;
    }
  };

  const syncReferenceControls = (slot) => {
    syncNoteDraft();
    const tab = activeTab();
    const url = activeReferenceUrl();
    const project = selectedProject();
    const saved = activeSavedReference();
    const available = Boolean(referencePort && project && url);

    const save = slot.querySelector("[data-browser-save-project]");
    if (save) {
      save.disabled = !available;
      save.textContent = t(saved ? "internet.project.updateReference" : "internet.project.saveReference");
      save.title = !referencePort
        ? t("internet.project.referenceUnavailable")
        : !project
          ? t("internet.project.selectBeforeSave")
          : !url
            ? t("internet.project.openValidBeforeSave")
            : saved
              ? t("internet.project.updateReferenceHint")
              : t("internet.project.saveReferenceHint");
    }

    const textarea = slot.querySelector("[data-browser-reference-note]");
    if (textarea) {
      textarea.disabled = !available;
      if (documentObject.activeElement !== textarea && textarea.value !== noteDraftValue) {
        textarea.value = noteDraftValue;
      }
    }

    const hint = slot.querySelector("[data-browser-reference-note-hint]");
    if (hint) {
      hint.textContent = !referencePort
        ? t("internet.project.referencePersistenceUnavailable")
        : !project
          ? t("internet.project.selectBeforeNote")
          : !url
            ? t("internet.project.openValidForContext")
            : saved
              ? t("internet.project.noteSavedWithReference")
              : t("internet.project.noteWillSaveWithPage");
    }

    const stateNode = slot.querySelector("[data-browser-reference-state]");
    if (stateNode) {
      stateNode.replaceChildren();
      stateNode.hidden = !saved;
      if (saved) {
        const copy = node(
          documentObject,
          "span",
          "ordax-internet-reference-state-copy",
          t(
            referenceSnapshot?.persistence === "device"
              ? "internet.persistence.savedDevice"
              : "internet.persistence.sessionOnly",
          ),
        );
        const remove = node(
          documentObject,
          "button",
          "ordax-internet-reference-remove",
          t("internet.action.remove"),
        );
        remove.type = "button";
        remove.dataset.browserRemoveReference = saved.id;
        remove.setAttribute("aria-label", t("internet.project.removeReference"));
        stateNode.append(copy, remove);
      }
    }
  };

  const syncFavorites = (slot) => {
    const favorite = activeFavorite();
    const url = activeFavoriteUrl();
    const bookmark = slot.querySelector('[data-browser-action="bookmark"]');
    if (bookmark) {
      bookmark.disabled = !favoritePort || !url;
      bookmark.textContent = favorite ? "★" : "☆";
      bookmark.setAttribute("aria-pressed", String(Boolean(favorite)));
      bookmark.setAttribute(
        "aria-label",
        t(favorite ? "internet.favorite.remove" : "internet.favorite.add"),
      );
      bookmark.title = !favoritePort
        ? t("internet.favorite.unavailable")
        : !url
          ? t("internet.favorite.openValidBeforeAdd")
          : favorite
            ? t("internet.favorite.removeHint")
            : t("internet.favorite.addHint");
    }

    const toggle = slot.querySelector("[data-browser-favorites-toggle]");
    const label = slot.querySelector("[data-browser-favorites-label]");
    const list = slot.querySelector("[data-browser-favorites-list]");
    const count = favoriteSnapshot?.favorites.length ?? 0;
    if (label) {
      label.textContent = count > 0
        ? t("internet.favorite.headingCount", { count })
        : t("internet.favorites");
    }
    if (toggle) {
      toggle.disabled = !favoritePort;
      toggle.setAttribute("aria-expanded", String(Boolean(favoritePort && favoritesExpanded)));
      toggle.title = !favoritePort
        ? t("internet.favorite.unavailable")
        : favoriteSnapshot?.persistence === "device"
          ? t("internet.favorite.savedDevice")
          : t("internet.favorite.sessionOnly");
    }
    if (!list) return;
    list.hidden = !favoritePort || !favoritesExpanded;
    list.replaceChildren();
    if (!favoritePort || !favoritesExpanded) return;
    const favorites = favoriteSnapshot?.favorites ?? [];
    if (favorites.length === 0) {
      list.append(node(documentObject, "div", "ordax-internet-tab-placeholder", t("internet.favorite.empty")));
      return;
    }
    for (const entry of favorites) {
      const row = node(documentObject, "div", "ordax-internet-favorite-row");
      const open = node(documentObject, "button", "ordax-internet-favorite-open");
      open.type = "button";
      open.dataset.browserOpenFavorite = entry.id;
      open.title = entry.url;
      const copy = node(documentObject, "span", "ordax-internet-page-copy");
      copy.append(node(documentObject, "strong", "", entry.title));
      copy.append(node(documentObject, "small", "", displayHost(entry.url, t("internet.tab.new"))));
      open.append(node(documentObject, "span", "", "★"), copy);
      const remove = node(documentObject, "button", "ordax-internet-favorite-remove", "×");
      remove.type = "button";
      remove.dataset.browserRemoveFavorite = entry.id;
      remove.setAttribute("aria-label", t("internet.favorite.removeNamed", { title: entry.title }));
      row.append(open, remove);
      list.append(row);
    }
  };

  const syncHistory = (slot) => {
    const toggle = slot.querySelector("[data-browser-history-toggle]");
    const label = slot.querySelector("[data-browser-history-label]");
    const list = slot.querySelector("[data-browser-history-list]");
    const entries = historySnapshot?.entries ?? [];
    const count = entries.length;

    if (label) {
      label.textContent = count > 0
        ? t("internet.history.headingCount", { count })
        : t("internet.history");
    }
    if (toggle) {
      toggle.disabled = !historyPort;
      toggle.setAttribute("aria-expanded", String(Boolean(historyPort && historyExpanded)));
      toggle.title = !historyPort
        ? t("internet.history.unavailable")
        : historySnapshot?.persistence === "device"
          ? t("internet.history.savedDevice")
          : t("internet.history.sessionOnly");
    }
    if (!list) return;
    list.hidden = !historyPort || !historyExpanded;
    list.replaceChildren();
    if (!historyPort || !historyExpanded) return;

    const header = node(documentObject, "div", "ordax-internet-history-header");
    const scope = node(
      documentObject,
      "span",
      "",
      t(
        historySnapshot?.persistence === "device"
          ? "internet.persistence.thisDevice"
          : "internet.persistence.thisSession",
      ),
    );
    const clear = node(documentObject, "button", "ordax-internet-history-clear", t("internet.history.clear"));
    clear.type = "button";
    clear.dataset.browserClearHistory = "";
    clear.disabled = entries.length === 0;
    header.append(scope, clear);
    list.append(header);

    if (entries.length === 0) {
      list.append(node(documentObject, "div", "ordax-internet-tab-placeholder", t("internet.history.empty")));
      return;
    }

    for (const entry of entries.slice(0, 60)) {
      const row = node(documentObject, "div", "ordax-internet-history-row");
      const open = node(documentObject, "button", "ordax-internet-history-open");
      open.type = "button";
      open.dataset.browserOpenHistory = entry.id;
      open.title = entry.url;
      const copy = node(documentObject, "span", "ordax-internet-page-copy");
      copy.append(node(documentObject, "strong", "", entry.title));
      copy.append(
        node(
          documentObject,
          "small",
          "",
          `${displayHost(entry.url, t("internet.tab.new"))} · ${formatHistoryVisit(entry.visitedAt, locale())}`,
        ),
      );
      open.append(node(documentObject, "span", "", "◷"), copy);

      const remove = node(documentObject, "button", "ordax-internet-history-remove", "×");
      remove.type = "button";
      remove.dataset.browserRemoveHistory = entry.id;
      remove.setAttribute("aria-label", t("internet.history.remove", { title: entry.title }));
      row.append(open, remove);
      list.append(row);
    }
  };

  const syncSearchProvider = (slot) => {
    const selector = slot.querySelector("[data-browser-search-provider]");
    if (!selector) return;
    const state = searchPreferencesPort?.getSnapshot() ?? null;
    selector.value = state?.providerId ?? BROWSER_SEARCH_PROVIDER.id;
    selector.disabled = !searchPreferencesPort || !snapshot.supported;
    selector.title = t(state?.persistence === "device"
      ? "internet.searchProvider.persisted"
      : "internet.searchProvider.session");
  };

  const syncDownloads = (slot) => {
    const toggle = slot.querySelector("[data-browser-downloads-toggle]");
    if (toggle) {
      toggle.disabled = !downloadPort;
      toggle.setAttribute("aria-expanded", String(downloadsExpanded));
      toggle.title = t(downloadPort ? "internet.downloads.heading" : "internet.downloads.pending");
    }
    const panel = slot.querySelector("[data-browser-downloads-panel]");
    if (!panel) return;
    panel.hidden = !downloadsExpanded || !downloadPort;
    if (panel.hidden) return;
    const heading = node(documentObject, "h3", "", t("internet.downloads.heading"));
    const rows = [...downloadRecords.values()];
    if (!rows.length) {
      panel.replaceChildren(heading, node(documentObject, "p", "", t("internet.downloads.empty")));
      return;
    }
    const items = rows.map((record) => {
      const row = node(documentObject, "div", "ordax-internet-download-row");
      const info = node(documentObject, "div", "ordax-internet-download-info");
      info.append(
        node(documentObject, "strong", "", record.fileName),
        node(documentObject, "span", "", t("internet.downloads.status." + record.status)),
      );
      row.append(info);
      if (record.status === "pending") {
        const approve = node(documentObject, "button", "ordax-internet-download-approve",
          t("internet.downloads.approve"));
        approve.type = "button";
        approve.dataset.browserDownloadApprove = record.id;
        const cancel = node(documentObject, "button", "ordax-internet-download-cancel",
          t("internet.downloads.cancel"));
        cancel.type = "button";
        cancel.dataset.browserDownloadCancel = record.id;
        row.append(approve, cancel);
      }
      return row;
    });
    panel.replaceChildren(heading, ...items);
  };

  const syncPageFind = (slot) => {
    const tab = activeTab();
    if (findOpen && (findTabId !== tab?.id || !tab?.url || tab.loading)) {
      clearPageFind({ finish: false });
    }
    const toggle = slot.querySelector("[data-browser-find-toggle]");
    if (toggle) {
      toggle.disabled = !findPort || !tab?.url || tab.loading;
      toggle.setAttribute("aria-pressed", String(findOpen));
    }
    const bar = slot.querySelector("[data-browser-find-bar]");
    if (!bar) return;
    bar.hidden = !findOpen;
    const input = slot.querySelector("[data-browser-find-input]");
    if (input && documentObject.activeElement !== input) input.value = findQuery;
    const status = slot.querySelector("[data-browser-find-status]");
    if (status) {
      if (!findQuery) status.textContent = "";
      else if (!findResult) status.textContent = t("internet.pageFind.searching");
      else if (findResult.state === "not-found") status.textContent = t("internet.pageFind.none");
      else status.textContent = t("internet.pageFind.matches", { count: findResult.count });
    }
    for (const selector of ["[data-browser-find-next]", "[data-browser-find-previous]"]) {
      const control = slot.querySelector(selector);
      if (control) control.disabled = !findQuery || findResult?.state === "not-found";
    }
  };

  const syncAssistance = (slot) => {
    const tab = activeTab();
    if (selectedPage && (selectedPage.tabId !== tab?.id || selectedPage.url !== tab?.url || tab.loading)) {
      clearSelectedPage();
    }
    const capture = slot.querySelector("[data-browser-capture-selection]");
    if (capture) capture.disabled = !selectionPort || !tab?.url || tab.loading || selectionCaptureBusy;
    const preview = slot.querySelector("[data-browser-selection-preview]");
    if (preview) {
      preview.hidden = !selectedPage;
      preview.value = selectedPage?.text ?? "";
    }
    const clipped = slot.querySelector("[data-browser-selection-truncated]");
    if (clipped) clipped.hidden = !selectedPage?.truncated;
    const question = slot.querySelector("[data-browser-selection-question]");
    if (question) {
      question.hidden = !selectedPage;
      if (documentObject.activeElement !== question) question.value = questionDraft;
    }
    const send = slot.querySelector("[data-browser-send-selection]");
    const intelligenceReady = intelligencePort?.getSnapshot().state === "ready";
    if (send) {
      send.hidden = !selectedPage;
      send.disabled = !selectedPage || !intelligenceReady || selectionSendBusy;
      send.textContent = t(selectionSendBusy ? "internet.assistance.processing" : "internet.assistance.ask");
    }
    const clear = slot.querySelector("[data-browser-clear-selection]");
    if (clear) clear.hidden = !selectedPage;
    const answer = slot.querySelector("[data-browser-selection-answer]");
    if (answer) {
      answer.hidden = !selectionAnswer;
      answer.textContent = selectionAnswer;
    }
  };

  const clearPageFind = ({ finish = true } = {}) => {
    if (finish && findPort && findTabId && snapshot.activeTabId === findTabId) {
      findPort.finish(findTabId);
    }
    findOpen = false;
    findQuery = "";
    findResult = null;
    findTabId = null;
  };

  const openPageFind = () => {
    if (!findPort || !snapshot.supported) return;
    const tab = activeTab();
    if (!tab?.url || tab.loading) return;
    findOpen = true;
    findTabId = tab.id;
    render();
    windowObject.requestAnimationFrame(() => {
      const input = findSlot()?.querySelector("[data-browser-find-input]");
      input?.focus({ preventScroll: true });
      input?.select();
    });
  };

  const syncPanel = (slot) => {
    const panel = slot.querySelector(`#${PROJECT_PANEL_ID}`);
    panel?.toggleAttribute("hidden", panelCollapsed);
    slot.querySelector(".ordax-internet-body")?.classList.toggle("project-collapsed", panelCollapsed);
    const toggle = slot.querySelector('[data-browser-action="more"]');
    toggle?.setAttribute("aria-expanded", String(!panelCollapsed));
  };

  const render = () => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      syncViewport();
      return;
    }
    const renderLocale = localization.getLocale();
    const localeChanged =
      slot.dataset.ordaxInternetMounted
      && slot.dataset.ordaxInternetLocale !== renderLocale;
    if (mountedSlot !== slot || !slot.dataset.ordaxInternetMounted || localeChanged) {
      slot.replaceChildren(createView(documentObject, snapshot, t));
      slot.dataset.ordaxInternetMounted = "true";
      slot.dataset.ordaxInternetLocale = renderLocale;
      mountedSlot = slot;
      resizeObserver?.disconnect();
      if (typeof windowObject.ResizeObserver === "function") {
        resizeObserver = new windowObject.ResizeObserver(syncViewport);
        resizeObserver.observe(slot.querySelector("[data-browser-viewport]"));
      }
    }
    syncSurfaceTarget();
    syncTabs(slot);
    syncProjectContext(slot);
    syncHomeStatus(slot);
    syncCurrentPage(slot);
    syncReferenceControls(slot);
    syncFavorites(slot);
    syncHistory(slot);
    syncSearchProvider(slot);
    syncDownloads(slot);
    syncPageFind(slot);
    syncAssistance(slot);
    syncPanel(slot);
    windowObject.requestAnimationFrame(syncViewport);
    ensureTab();
  };

  const captureSelectedPage = async () => {
    const tab = activeTab();
    if (!selectionPort || !tab?.url || tab.loading || selectionCaptureBusy) return;
    clearSelectedPage();
    const generation = selectionGeneration;
    selectionCaptureBusy = true;
    render();
    try {
      const captured = validateBrowserPageSelection(await selectionPort.readSelection(tab.id));
      const current = activeTab();
      if (!destroyed && generation === selectionGeneration && current?.id === tab.id
          && current.url === tab.url && !current.loading && captured.url === tab.url) {
        selectedPage = captured;
        clearMessage();
      }
    } catch {
      if (!destroyed && generation === selectionGeneration) setMessage("internet.assistance.captureFailed");
    } finally {
      selectionCaptureBusy = false;
      render();
    }
  };

  const sendSelectedPage = async () => {
    if (!selectedPage || !intelligencePort || selectionSendBusy) return;
    const current = activeTab();
    if (current?.id !== selectedPage.tabId || current.url !== selectedPage.url || current.loading) return;
    const generation = selectionGeneration;
    const request = browserSelectionIntelligenceRequest({
      selection: selectedPage,
      question: questionDraft.trim() || t("internet.assistance.defaultQuestion"),
      confirmed: true,
    });
    selectionSendBusy = true;
    selectionAnswer = "";
    render();
    try {
      const response = validateIntelligenceResponse(await intelligencePort.respond(request));
      const now = activeTab();
      if (!destroyed && generation === selectionGeneration
          && now?.id === current.id && now.url === current.url && !now.loading) {
        selectionAnswer = response.text;
      }
    } catch {
      if (!destroyed && generation === selectionGeneration) setMessage("internet.assistance.askFailed");
    } finally {
      selectionSendBusy = false;
      render();
    }
  };

  const onClick = (event) => {
    const target = event.target.closest("button");
    if (!target || !root.contains(target)) return;
    const slot = findSlot();
    if (!slot?.contains(target)) return;

    if (target.dataset.browserDownloadsToggle !== undefined) {
      if (!downloadPort) return;
      downloadsExpanded = !downloadsExpanded;
      render();
      return;
    }
    const approvedId = target.dataset.browserDownloadApprove;
    const cancelledId = target.dataset.browserDownloadCancel;
    if (approvedId || cancelledId) {
      if (!downloadPort) return;
      const id = approvedId || cancelledId;
      const existing = downloadRecords.get(id);
      if (existing?.status !== "pending") return;
      downloadRecords.set(id, {
        ...existing, status: approvedId ? "downloading" : "cancelled",
      });
      render();
      try {
        if (approvedId) downloadPort.approve(id);
        else downloadPort.cancel(id);
      } catch {
        downloadRecords.set(id, { ...existing, status: "failed" });
        render();
      }
      return;
    }
    if (target.dataset.browserFindToggle !== undefined) {
      if (findOpen) {
        clearPageFind();
        render();
      } else {
        openPageFind();
      }
      return;
    }
    if (target.dataset.browserFindClose !== undefined) {
      clearPageFind();
      render();
      return;
    }
    if (target.dataset.browserFindNext !== undefined || target.dataset.browserFindPrevious !== undefined) {
      if (findPort && findTabId && findQuery) {
        if (target.dataset.browserFindNext !== undefined) findPort.next(findTabId);
        else findPort.previous(findTabId);
      }
      return;
    }
    if (target.dataset.browserCaptureSelection !== undefined) {
      void captureSelectedPage();
      return;
    }
    if (target.dataset.browserSendSelection !== undefined) {
      void sendSelectedPage();
      return;
    }
    if (target.dataset.browserClearSelection !== undefined) {
      clearSelectedPage();
      render();
      return;
    }

    if (target.dataset.browserHistoryToggle !== undefined) {
      if (!historyPort) return;
      historyExpanded = !historyExpanded;
      render();
      return;
    }

    const openHistoryId = target.dataset.browserOpenHistory;
    if (openHistoryId) {
      const entry = historySnapshot?.entries.find((item) => item.id === openHistoryId);
      if (!entry || !snapshot.supported) return;
      const tab = activeTab();
      clearMessage();
      if (tab) {
        port.navigate(tab.id, entry.url);
      } else {
        port.openTab(allocateTabId(), entry.url);
      }
      return;
    }

    const removeHistoryId = target.dataset.browserRemoveHistory;
    if (removeHistoryId) {
      if (!historyPort) return;
      historyPort.remove(removeHistoryId);
      setMessage("internet.history.removed");
      render();
      return;
    }

    if (target.dataset.browserClearHistory !== undefined) {
      if (!historyPort) return;
      historyPort.clear();
      setMessage("internet.history.cleared");
      render();
      return;
    }

    if (target.dataset.browserFavoritesToggle !== undefined) {
      if (!favoritePort) return;
      favoritesExpanded = !favoritesExpanded;
      render();
      return;
    }

    const openFavoriteId = target.dataset.browserOpenFavorite;
    if (openFavoriteId) {
      const favorite = favoriteSnapshot?.favorites.find((entry) => entry.id === openFavoriteId);
      if (!favorite || !snapshot.supported) return;
      const tab = activeTab();
      clearMessage();
      if (tab) {
        port.navigate(tab.id, favorite.url);
      } else {
        port.openTab(allocateTabId(), favorite.url);
      }
      return;
    }

    const removeFavoriteId = target.dataset.browserRemoveFavorite;
    if (removeFavoriteId) {
      if (!favoritePort) return;
      favoritePort.remove(removeFavoriteId);
      setMessage("internet.favorite.removed");
      render();
      return;
    }

    const projectId = target.dataset.browserProjectId;
    if (projectId) {
      if (!projectPort) return;
      try {
        projectPort.recordOpened(projectId);
        selectedProjectId = projectId;
        clearMessage();
      } catch (error) {
        if (error instanceof Error && error.message) setExternalMessage(error.message);
        else setMessage("internet.project.openFailed");
      }
      render();
      focusProject(projectId);
      return;
    }

    if (target.dataset.browserSaveProject !== undefined) {
      const tab = activeTab();
      const url = activeReferenceUrl();
      const project = selectedProject();
      if (!referencePort || !project || !tab || !url) return;
      try {
        referencePort.save({
          projectId: project.id,
          url,
          title: tab.title || displayHost(url, t("internet.tab.new")),
          note: noteDraftValue,
        });
        projectPort?.recordOpened(project.id);
        setMessage(
          referenceSnapshot?.persistence === "session"
            ? "internet.reference.savedSession"
            : "internet.reference.savedProject",
        );
      } catch (error) {
        if (error instanceof Error && error.message) setExternalMessage(error.message);
        else setMessage("internet.reference.saveFailed");
      }
      render();
      return;
    }

    const removeReferenceId = target.dataset.browserRemoveReference;
    if (removeReferenceId) {
      if (!referencePort) return;
      try {
        referencePort.remove(removeReferenceId);
        noteDraftValue = "";
        setMessage("internet.reference.removed");
      } catch (error) {
        if (error instanceof Error && error.message) setExternalMessage(error.message);
        else setMessage("internet.reference.removeFailed");
      }
      render();
      return;
    }

    const closeTabId = target.dataset.browserCloseTab;
    if (closeTabId) {
      event.preventDefault();
      event.stopPropagation();
      const tabs = visibleTabs();
      const closingIndex = tabs.findIndex((tab) => tab.id === closeTabId);
      pendingTabFocusId = tabs[closingIndex + 1]?.id ?? tabs[closingIndex - 1]?.id ?? null;
      port.closeTab(closeTabId);
      return;
    }
    const tabId = target.dataset.browserTabId;
    if (tabId) {
      port.activateTab(tabId);
      return;
    }
    if (target.dataset.browserNewTab !== undefined) {
      if (snapshot.tabs.length >= MAX_UI_TABS) {
        setMessage("internet.tab.limit");
        render();
        return;
      }
      port.openTab(allocateTabId(), "");
      return;
    }
    if (target.dataset.browserPanelClose !== undefined) {
      panelCollapsed = true;
      render();
      findSlot()?.querySelector('[data-browser-action="more"]')?.focus({ preventScroll: true });
      return;
    }
    const action = target.dataset.browserAction;
    if (!action) return;
    if (action === "more") {
      panelCollapsed = !panelCollapsed;
      render();
      return;
    }
    const tab = activeTab();
    if (!tab) return;
    if (action === "back") port.goBack(tab.id);
    if (action === "forward") port.goForward(tab.id);
    if (action === "reload") port.reload(tab.id);
    if (action === "bookmark") {
      if (!favoritePort) return;
      const url = activeFavoriteUrl();
      if (!url) return;
      const existing = activeFavorite();
      try {
        if (existing) {
          favoritePort.remove(existing.id);
          setMessage("internet.favorite.removed");
        } else {
          favoritePort.save({
            url,
            title: tab.title || displayHost(url, t("internet.tab.new")),
          });
          setMessage(
            favoriteSnapshot?.persistence === "session"
              ? "internet.favorite.savedSession"
              : "internet.favorite.savedDeviceMessage",
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message) setExternalMessage(error.message);
        else setMessage("internet.favorite.updateFailed");
      }
      render();
    }
  };

  const onKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key?.toLowerCase() === "f"
        && findPort && findSlot()?.contains(event.target)) {
      event.preventDefault();
      openPageFind();
      return;
    }
    if (findOpen && event.key === "Escape" && findSlot()?.contains(event.target)) {
      event.preventDefault();
      clearPageFind();
      render();
      return;
    }
    const findInput = event.target.closest("[data-browser-find-input]");
    if (findOpen && findInput && findSlot()?.contains(findInput) && event.key === "Enter") {
      event.preventDefault();
      if (findQuery && findTabId) {
        if (event.shiftKey) findPort.previous(findTabId);
        else findPort.next(findTabId);
      }
      return;
    }
    const searchInput = event.target.closest("[data-browser-tab-search]");
    if (searchInput && root.contains(searchInput) && event.key === "Escape" && tabQuery) {
      event.preventDefault();
      tabQuery = "";
      searchInput.value = "";
      const slot = findSlot();
      if (slot) syncTabs(slot);
      return;
    }

    const tabButton = event.target.closest('[role="tab"][data-browser-tab-id]');
    if (!tabButton || !root.contains(tabButton)) return;
    const slot = findSlot();
    if (!slot?.contains(tabButton)) return;

    const tabs = visibleTabs();
    const index = tabs.findIndex((tab) => tab.id === tabButton.dataset.browserTabId);
    if (index < 0 || tabs.length === 0) return;

    let targetIndex = null;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      targetIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      targetIndex = (index + 1) % tabs.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = tabs.length - 1;
    }
    if (targetIndex === null) return;

    event.preventDefault();
    const nextId = tabs[targetIndex].id;
    port.activateTab(nextId);
    focusTab(nextId);
  };

  const onInput = (event) => {
    const findInput = event.target.closest("[data-browser-find-input]");
    if (findInput && root.contains(findInput) && findSlot()?.contains(findInput) && findPort && findTabId) {
      findQuery = findInput.value;
      findResult = null;
      findPort.search(findTabId, findQuery);
      syncPageFind(findSlot());
      return;
    }
    const question = event.target.closest("[data-browser-selection-question]");
    if (question && root.contains(question) && findSlot()?.contains(question)) {
      questionDraft = question.value;
      return;
    }
    const note = event.target.closest("[data-browser-reference-note]");
    if (note && root.contains(note)) {
      const slot = findSlot();
      if (slot?.contains(note)) {
        syncNoteDraft();
        noteDraftValue = note.value;
        return;
      }
    }

    const searchInput = event.target.closest("[data-browser-tab-search]");
    if (!searchInput || !root.contains(searchInput)) return;
    const slot = findSlot();
    if (!slot?.contains(searchInput)) return;
    tabQuery = searchInput.value;
    syncTabs(slot);
  };

  const onChange = (event) => {
    const selector = event.target.closest("[data-browser-search-provider]");
    if (!selector || !searchPreferencesPort || !findSlot()?.contains(selector)) return;
    try {
      searchPreferencesPort.setProvider(selector.value);
      clearMessage();
      render();
    } catch {
      setMessage("internet.searchProvider.invalid");
      render();
    }
  };

  const onSubmit = (event) => {
    const form = event.target.closest("[data-browser-address-form]");
    if (!form || !root.contains(form)) return;
    event.preventDefault();
    const input = form.querySelector("[data-browser-address]");
    const tab = activeTab();
    if (!input || !tab) return;
    try {
      const url = resolveBrowserNavigation(input.value, {
        searchProviderId: searchPreferencesPort?.getSnapshot().providerId ?? BROWSER_SEARCH_PROVIDER.id,
      })?.url;
      if (!url) return;
      clearMessage();
      port.navigate(tab.id, url);
    } catch {
      setMessage("internet.address.invalid");
      render();
    }
  };

  const unsubscribeSession = port.subscribe((nextSnapshot) => {
    snapshot = nextSnapshot;
    if (findOpen && (findTabId !== snapshot.activeTabId
        || snapshot.tabs.find((tab) => tab.id === findTabId)?.loading
        || !snapshot.tabs.find((tab) => tab.id === findTabId)?.url)) {
      clearPageFind({ finish: false });
    }
    if (selectedPage && (selectedPage.tabId !== snapshot.activeTabId
        || snapshot.tabs.find((tab) => tab.id === selectedPage.tabId)?.url !== selectedPage.url
        || snapshot.tabs.find((tab) => tab.id === selectedPage.tabId)?.loading)) {
      clearSelectedPage();
    }
    render();
    if (pendingTabFocusId && snapshot.tabs.some((tab) => tab.id === pendingTabFocusId)) {
      focusTab(pendingTabFocusId);
      pendingTabFocusId = null;
    }
  });
  const unsubscribeProjects = projectPort?.subscribe((nextSnapshot) => {
    projectSnapshot = nextSnapshot;
    if (selectedProjectId && !nextSnapshot.projects.some((project) => project.id === selectedProjectId)) {
      selectedProjectId = null;
    }
    render();
  }) ?? (() => {});
  const unsubscribeReferences = referencePort?.subscribe((nextSnapshot) => {
    referenceSnapshot = nextSnapshot;
    const saved = activeSavedReference();
    if (saved && currentReferenceKey() !== noteDraftKey) {
      noteDraftKey = currentReferenceKey();
      noteDraftValue = saved.note;
    }
    render();
  }) ?? (() => {});
  const unsubscribeFavorites = favoritePort?.subscribe((nextSnapshot) => {
    favoriteSnapshot = nextSnapshot;
    render();
  }) ?? (() => {});
  const unsubscribeSearchPreferences = searchPreferencesPort?.subscribe(() => {
    const slot = findSlot();
    if (slot) syncSearchProvider(slot);
  }) ?? (() => {});
  const unsubscribeHistory = historyPort?.subscribe((nextSnapshot) => {
    historySnapshot = nextSnapshot;
    render();
  }) ?? (() => {});
  const unsubscribeDownloads = downloadPort?.subscribe((event) => {
    if (destroyed) return;
    downloadRecords.delete(event.id);
    downloadRecords.set(event.id, event);
    while (downloadRecords.size > 8) {
      downloadRecords.delete(downloadRecords.keys().next().value);
    }
    if (event.status === "pending") downloadsExpanded = true;
    render();
  }) ?? (() => {});
  const unsubscribeFind = findPort?.subscribe((result) => {
    if (!destroyed && findOpen && findTabId === result.tabId
        && snapshot.activeTabId === result.tabId && findQuery === result.query) {
      findResult = result;
      const slot = findSlot();
      if (slot) syncPageFind(slot);
    }
  }) ?? (() => {});
  const unsubscribeShortcutFind = port.subscribeShortcuts((action) => {
    if (action === "focus-page-find") openPageFind();
  });
  const unsubscribeIntelligence = intelligencePort?.subscribe(() => render()) ?? (() => {});
  const invalidateSelectedContext = () => {
    clearSelectedPage();
    render();
  };
  const unsubscribeIdentity = scopeIdentity?.subscribe(invalidateSelectedContext) ?? (() => {});
  const unsubscribeSpaceSelection = scopeSelection?.subscribe(invalidateSelectedContext) ?? (() => {});
  const unsubscribeProfile = scopeProfile?.subscribe?.(invalidateSelectedContext) ?? (() => {});
  const unsubscribeSurface = lifecycle.subscribeRender(render);
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("submit", onSubmit);
  windowObject.addEventListener("resize", syncViewport);
  windowObject.addEventListener("scroll", syncViewport, true);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      unsubscribeSession();
      unsubscribeProjects();
      unsubscribeReferences();
      unsubscribeFavorites();
      unsubscribeHistory();
      unsubscribeSearchPreferences();
      unsubscribeFind();
      unsubscribeDownloads();
      unsubscribeShortcutFind();
      clearPageFind();
      unsubscribeIntelligence();
      unsubscribeIdentity();
      unsubscribeSpaceSelection();
      unsubscribeProfile();
      unsubscribeSurface();
      clearSelectedPage();
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("input", onInput);
      root.removeEventListener("change", onChange);
      root.removeEventListener("submit", onSubmit);
      windowObject.removeEventListener("resize", syncViewport);
      windowObject.removeEventListener("scroll", syncViewport, true);
      port.setViewport({ visible: false, x: 0, y: 0, width: 0, height: 0 });
    },
  });
}
