import {
  assertProjectCatalogReader,
  validateProjectCatalogSnapshot,
} from "../../contracts/project-catalog.mjs";
import {
  assertRecentFilesPort,
  validateRecentFilesSnapshot,
} from "../../contracts/recent-files.mjs";
import { validateFileSpacePath } from "../../contracts/file-space.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { resolveRegionalTimeZone } from "../../services/preferences/regional.mjs";
import { restoreHomeCollectionFocus } from "./home-collection-focus.mjs";

const MAX_HOME_CONTINUATION_ITEMS = 4;
const MAX_PROJECT_ITEMS = 2;
const MAX_RECENT_ITEMS = 2;

function parentPath(path) {
  const value = validateFileSpacePath(path);
  if (value === "/") return "/";
  const index = value.lastIndexOf("/");
  return index <= 0 ? "/" : value.slice(0, index);
}

function formatActivity(timestamp, locale, timeZone, unknownLabel) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return unknownLabel;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function createHomeContinuationPresentation({
  projects = null,
  recentFiles = null,
} = {}) {
  const projectSnapshot = projects === null
    ? null
    : validateProjectCatalogSnapshot(projects);
  const recentSnapshot = recentFiles === null
    ? null
    : validateRecentFilesSnapshot(recentFiles);

  const projectItems = projectSnapshot
    ? [...projectSnapshot.projects]
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      .slice(0, MAX_PROJECT_ITEMS)
      .map((project) => Object.freeze({
        key: `project:${project.id}`,
        kind: "project",
        title: project.name,
        detailKind: "project",
        activityAt: project.lastOpenedAt,
        persistence: projectSnapshot.persistence,
        actionMessageId: "home.continuation.projectAction",
        actionParams: Object.freeze({ name: project.name }),
        appId: "files",
        target: project.path,
      }))
    : [];

  const recentItems = recentSnapshot
    ? [...recentSnapshot.entries]
      .sort((left, right) => right.openedAt - left.openedAt)
      .slice(0, MAX_RECENT_ITEMS)
      .map((entry) => {
        const folder = parentPath(entry.path);
        return Object.freeze({
          key: `recent:${entry.path}`,
          kind: "recent-file",
          title: entry.name,
          detailKind: "recent",
          folder,
          activityAt: entry.openedAt,
          persistence: recentSnapshot.persistence,
          actionMessageId: "home.continuation.recentAction",
          actionParams: Object.freeze({ name: entry.name }),
          appId: "files",
          target: folder,
        });
      })
    : [];

  const items = [...projectItems, ...recentItems].slice(0, MAX_HOME_CONTINUATION_ITEMS);
  // No project or recent file means there is no continuation to present.
  // Keep first-use Home focused and free of placeholder cards.
  if (items.length === 0) {
    return Object.freeze({ visible: false, items: Object.freeze([]) });
  }
  return Object.freeze({ visible: true, items: Object.freeze(items) });
}

function node(documentObject, tag, className = "", text = undefined) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function assertHomeRoot(root) {
  if (
    !root
    || typeof root !== "object"
    || typeof root.querySelector !== "function"
    || !root.ownerDocument
  ) {
    throw new TypeError("Home continuation requires a Surface root");
  }
  return root;
}

export function mountHomeContinuation(
  rootValue,
  { projects = null, recentFiles = null, surfaceLifecycle = null } = {},
) {
  const root = assertHomeRoot(rootValue);
  const projectPort = projects === null ? null : assertProjectCatalogReader(projects);
  const recentPort = recentFiles === null ? null : assertRecentFilesPort(recentFiles);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  // The Native composition passes the Surface instance, whose preference port
  // is the same one that drives the system clock. Standalone read-only
  // consumers may pass only the minimal render lifecycle; use the canonical
  // regional default there instead of inventing a local setting.
  const preferencePort = lifecycle.preferences == null
    ? null : assertPreferenceRuntimePort(lifecycle.preferences);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const documentObject = root.ownerDocument;
  const homePanel = root.querySelector(".ordax-home-panel");
  const space = homePanel?.querySelector(".ordax-space");
  if (!homePanel || !space) {
    throw new Error("Home continuation requires the canonical Home panel");
  }

  let destroyed = false;
  let section = null;
  let renderedSignature = null;
  const render = () => {
    if (destroyed) return;
    // Subscription events are notifications, never a second snapshot store.
    // Re-read the OS owners on every repaint so a delayed event cannot
    // recreate a project or recent file that a newer snapshot removed.
    // The existing presentation validates each snapshot exactly once.
    const projectSnapshot = projectPort?.getSnapshot() ?? null;
    const recentSnapshot = recentPort?.getSnapshot() ?? null;
    const activeElement = documentObject.activeElement;
    const focusedWithin = section?.contains?.(activeElement) === true;
    const focusedKey = focusedWithin ? activeElement?.dataset?.homeContinuationKey ?? null : null;
    const focusedAction = focusedWithin ? activeElement?.dataset?.homeContinuationAction ?? null : null;
    const presentation = createHomeContinuationPresentation({
      projects: projectSnapshot,
      recentFiles: recentSnapshot,
    });
    const timeZone = resolveRegionalTimeZone(preferencePort?.getSnapshot() ?? {});
    // Always project fresh OS snapshots; cache only the four-card DOM shape.
    const nextSignature = JSON.stringify([presentation, localization.getLocale(), timeZone]);
    if (nextSignature === renderedSignature && (
      presentation.visible ? section?.parentNode === homePanel : section === null
    )) return;

    if (!presentation.visible) {
      section?.remove();
      section = null;
      renderedSignature = nextSignature;
      restoreHomeCollectionFocus(homePanel, focusedWithin);
      return;
    }

    const next = node(documentObject, "section", "ordax-space");
    next.dataset.homeContinuation = "";
    next.setAttribute("aria-labelledby", "ordax-home-continuation-title");
    const heading = node(documentObject, "div", "ordax-home-section-heading");
    const title = node(documentObject, "h2", "", t("home.continuation.title"));
    title.id = "ordax-home-continuation-title";
    const openFiles = node(documentObject, "button", "", t("home.continuation.openFiles"));
    openFiles.type = "button";
    openFiles.dataset.launchApp = "files";
    openFiles.dataset.homeContinuationAction = "open-files";
    heading.append(title, openFiles);
    next.append(heading);

    for (const item of presentation.items) {
      const button = node(documentObject, "button", "ordax-space-link");
      button.type = "button";
      button.dataset.homeContinuationKey = item.key;
      button.dataset.launchApp = item.appId;
      button.dataset.appTarget = item.target;
      button.setAttribute("aria-label", t(item.actionMessageId, item.actionParams));

      const activity = formatActivity(
        item.activityAt,
        localization.getLocale(),
        timeZone,
        t("home.continuation.activityUnknown"),
      );
      const persistence = item.persistence === "session"
        ? t("home.continuation.sessionSuffix")
        : "";
      const detail = item.detailKind === "project"
        ? t("home.continuation.projectDetail", {
            path: item.target,
            activity,
            persistence,
          })
        : t("home.continuation.recentDetail", {
            folder: item.folder,
            activity,
            persistence,
          });

      const marker = node(
        documentObject,
        "span",
        "ordax-space-icon",
        item.kind === "project" ? "P" : "R",
      );
      marker.setAttribute("aria-hidden", "true");
      const copy = node(documentObject, "span");
      copy.append(
        node(documentObject, "strong", "", item.title),
        node(documentObject, "small", "", detail),
      );
      const arrow = node(documentObject, "span", "ordax-space-arrow", "→");
      arrow.setAttribute("aria-hidden", "true");
      button.append(marker, copy, arrow);
      next.append(button);
    }

    if (section) section.replaceWith(next);
    else homePanel.insertBefore(next, space);
    section = next;
    renderedSignature = nextSignature;

    const target = focusedKey
      ? Array.from(section.querySelectorAll("[data-home-continuation-key]"))
        .find((element) => element.dataset.homeContinuationKey === focusedKey) ?? null
      : focusedAction === "open-files"
        ? section.querySelector("[data-home-continuation-action='open-files']")
        : null;
    restoreHomeCollectionFocus(homePanel, focusedWithin, target);
  };

  const unsubscribeProjects = projectPort?.subscribe(() => {
    render();
  });
  const unsubscribeRecent = recentPort?.subscribe(() => {
    render();
  });
  const unsubscribeLocalization = localization.subscribe(() => {
    // Localization can change translations without changing the locale ID.
    renderedSignature = null;
    render();
  });
  const unsubscribePreferences = preferencePort?.subscribe(render);

  render();

  return Object.freeze({
    dispose() {
      if (destroyed) return;
      destroyed = true;
      unsubscribePreferences?.();
      unsubscribeLocalization?.();
      unsubscribeRecent?.();
      unsubscribeProjects?.();
      section?.remove();
      section = null;
    },
  });
}
