import {
  assertProjectCatalogPort,
  validateProjectCatalogSnapshot,
} from "../../../contracts/project-catalog.mjs";
import {
  assertProjectCloudLinksPort,
  validateProjectCloudLinksSnapshot,
} from "../../../contracts/project-cloud-links.mjs";
import {
  assertProjectWebReferencePort,
  validateProjectWebReference,
  validateProjectWebReferenceSnapshot,
} from "../../../contracts/project-web-references.mjs";
import { assertAppActivationPort } from "../../../contracts/app-activation.mjs";
import { assertIntelligenceContextSharePort } from "../../../contracts/intelligence-context-share.mjs";
import { encodeIntelligenceHandoffTarget } from "../../../contracts/intelligence-handoff.mjs";
import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";

const PROJECTS_WINDOW_SELECTOR = '[data-window-id="projects"]';
const PROJECTS_EXTENSION_SELECTOR = '[data-app-extension="projects-workspace"]';
const PROJECT_CONTEXT_SOURCE_ID = "project-selection";
const PROJECT_PERSISTENCE = new Set(["device", "session"]);
const MAX_PROJECT_CONTEXT_REFERENCES = 8;
const MAX_PROJECT_CONTEXT_REFERENCE_NOTE_CHARS = 600;

function node(documentObject, tag, className = "", text = undefined) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatActivity(timestamp, locale, unknownLabel) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return unknownLabel;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function projectPersistence(value) {
  if (!PROJECT_PERSISTENCE.has(value)) {
    throw new TypeError("Project Intelligence catalog persistence is invalid");
  }
  return value;
}

function projectReferenceEvidence(referenceValue) {
  const reference = validateProjectWebReference(referenceValue);
  return Object.freeze({
    title: reference.title,
    note: reference.note.slice(0, MAX_PROJECT_CONTEXT_REFERENCE_NOTE_CHARS),
    updatedAt: reference.updatedAt,
  });
}

export function createProjectIntelligenceContext(
  project,
  {
    cloudLinked = false,
    catalogPersistence = "session",
    webReferences = [],
  } = {},
) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new TypeError("Project Intelligence context requires a project");
  }
  if (typeof project.id !== "string" || !project.id.trim()) {
    throw new TypeError("Project Intelligence context requires a project id");
  }
  if (typeof project.name !== "string" || !project.name.trim()) {
    throw new TypeError("Project Intelligence context requires a project name");
  }
  if (typeof cloudLinked !== "boolean") {
    throw new TypeError("Project Intelligence cloud linkage must be boolean");
  }
  if (!Array.isArray(webReferences)) {
    throw new TypeError("Project Intelligence web references must be an array");
  }
  const lastOpenedAt = Number.isSafeInteger(project.lastOpenedAt) && project.lastOpenedAt >= 0
    ? project.lastOpenedAt
    : null;
  const references = webReferences.map(projectReferenceEvidence);
  const includedReferences = references.slice(0, MAX_PROJECT_CONTEXT_REFERENCES);
  return Object.freeze([Object.freeze({
    id: `${PROJECT_CONTEXT_SOURCE_ID}-${project.id}`,
    scope: "workspace",
    text: JSON.stringify({
      name: project.name.trim(),
      lastOpenedAt,
      catalogPersistence: projectPersistence(catalogPersistence),
      cloudLinked,
      referenceCount: references.length,
      referencesIncluded: includedReferences.length,
      references: includedReferences,
    }),
    provenance: "ordax:projects:user-authorized-selection:catalog-cloud-reference-metadata",
  })]);
}

export function createProjectsPresentation({
  projects = null,
  cloudLinks = null,
  webReferences = null,
} = {}) {
  const projectSnapshot = projects === null
    ? null
    : validateProjectCatalogSnapshot(projects);
  const linkSnapshot = cloudLinks === null
    ? null
    : validateProjectCloudLinksSnapshot(cloudLinks);
  const referenceSnapshot = webReferences === null
    ? null
    : validateProjectWebReferenceSnapshot(webReferences);

  if (projectSnapshot === null) {
    return Object.freeze({
      available: false,
      persistence: "session",
      items: Object.freeze([]),
      linkedCount: 0,
    });
  }

  const linkByLocalId = new Map(
    (linkSnapshot?.links ?? []).map((link) => [link.localProjectId, link]),
  );
  const referenceCountByProject = new Map();
  for (const reference of referenceSnapshot?.references ?? []) {
    referenceCountByProject.set(
      reference.projectId,
      (referenceCountByProject.get(reference.projectId) ?? 0) + 1,
    );
  }
  const items = projectSnapshot.projects.map((project) => {
    const link = linkByLocalId.get(project.id) ?? null;
    return Object.freeze({
      id: project.id,
      name: project.name,
      path: project.path,
      lastOpenedAt: project.lastOpenedAt,
      linked: link !== null,
      cloudProjectId: link?.cloudProjectId ?? null,
      spaceId: link?.spaceId ?? null,
      referenceCount: referenceCountByProject.get(project.id) ?? 0,
    });
  });

  return Object.freeze({
    available: true,
    persistence: projectSnapshot.persistence,
    items: Object.freeze(items),
    linkedCount: items.filter((item) => item.linked).length,
  });
}

function buildShell(documentObject, t) {
  const view = node(documentObject, "div", "ordax-projects-view");
  view.dataset.ordaxProjectsView = "";

  const header = node(documentObject, "header", "ordax-projects-header");
  header.append(
    node(documentObject, "p", "ordax-projects-kicker", t("projects.kicker")),
    node(documentObject, "h2", "ordax-projects-title", t("projects.title")),
    node(documentObject, "p", "ordax-projects-intro", t("projects.intro")),
  );

  const summary = node(documentObject, "div", "ordax-projects-summary");
  summary.append(
    node(documentObject, "span", "ordax-projects-summary-item"),
    node(documentObject, "span", "ordax-projects-summary-item"),
  );
  summary.children[0].dataset.projectsCount = "";
  summary.children[1].dataset.projectsPersistence = "";

  const body = node(documentObject, "div", "ordax-projects-body");
  body.dataset.projectsBody = "";

  view.append(header, summary, body);
  return view;
}

function projectReferenceLabel(t, count) {
  if (count === 0) return t("projects.references.none");
  if (count === 1) return t("projects.references.one");
  return t("projects.references.many", { count });
}

function projectCard(documentObject, item, localization, canUseIntelligence) {
  const t = localization.translate;
  const card = node(documentObject, "article", "ordax-project-card");
  card.dataset.projectId = item.id;

  const heading = node(documentObject, "div", "ordax-project-card-heading");
  const copy = node(documentObject, "div", "ordax-project-card-copy");
  copy.append(
    node(documentObject, "strong", "ordax-project-card-title", item.name),
    node(documentObject, "span", "ordax-project-card-path", item.path),
  );
  const badge = node(
    documentObject,
    "span",
    `ordax-project-badge ${item.linked ? "is-cloud" : "is-local"}`,
    t(item.linked ? "projects.status.cloudLinked" : "projects.status.localOnly"),
  );
  heading.append(copy, badge);

  const activity = node(
    documentObject,
    "p",
    "ordax-project-card-meta",
    t("projects.activity", {
      date: formatActivity(
        item.lastOpenedAt,
        localization.getLocale(),
        t("projects.activityUnknown"),
      ),
    }),
  );
  const references = node(
    documentObject,
    "p",
    "ordax-project-card-meta",
    projectReferenceLabel(t, item.referenceCount),
  );

  const actions = node(documentObject, "div", "ordax-project-card-actions");
  const open = node(documentObject, "button", "ordax-project-action", t("projects.action.openFiles"));
  open.type = "button";
  open.dataset.projectsOpen = item.id;
  actions.append(open);

  if (canUseIntelligence) {
    const ask = node(
      documentObject,
      "button",
      "ordax-project-action",
      t("projects.action.askIntelligence"),
    );
    ask.type = "button";
    ask.dataset.projectsAskIntelligence = item.id;
    const plan = node(
      documentObject,
      "button",
      "ordax-project-action",
      t("projects.action.planWithIntelligence"),
    );
    plan.type = "button";
    plan.dataset.projectsPlanWithIntelligence = item.id;
    actions.append(ask, plan);
  }

  card.append(heading, activity, references, actions);
  return card;
}

export function mountProjectsWorkspaceControls(
  root,
  {
    projects = null,
    projectCloudLinks = null,
    projectWebReferences = null,
    surfaceLifecycle,
    appActivation = null,
    intelligenceContextShare = null,
  } = {},
) {
  if (!root || typeof root.querySelector !== "function" || !root.ownerDocument) {
    throw new TypeError("Projects workspace requires a Surface root");
  }
  const projectPort = projects === null ? null : assertProjectCatalogPort(projects);
  const cloudPort = projectCloudLinks === null
    ? null
    : assertProjectCloudLinksPort(projectCloudLinks);
  const referencePort = projectWebReferences === null
    ? null
    : assertProjectWebReferencePort(projectWebReferences);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const activation = appActivation === null ? null : assertAppActivationPort(appActivation);
  const contextShare = intelligenceContextShare === null
    ? null
    : assertIntelligenceContextSharePort(intelligenceContextShare);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const documentObject = root.ownerDocument;

  let projectSnapshot = projectPort?.getSnapshot() ?? null;
  let linkSnapshot = cloudPort?.getSnapshot() ?? null;
  let referenceSnapshot = referencePort?.getSnapshot() ?? null;
  let mountedSlot = null;
  let destroyed = false;

  const projectReferencesFor = (projectId) => Object.freeze(
    (referenceSnapshot?.references ?? []).filter((reference) => reference.projectId === projectId),
  );

  const projectIsCloudLinked = (projectId) =>
    (linkSnapshot?.links ?? []).some((link) => link.localProjectId === projectId);

  const offerProjectToIntelligence = (project, mode) => {
    if (!activation || !contextShare) return;
    const target = { kind: "project", id: project.id };
    contextShare.offer({
      sourceAppId: "projects",
      sourceId: PROJECT_CONTEXT_SOURCE_ID,
      target,
      displayLabel: project.name,
      context: createProjectIntelligenceContext(project, {
        cloudLinked: projectIsCloudLinked(project.id),
        catalogPersistence: projectSnapshot?.persistence ?? "session",
        webReferences: projectReferencesFor(project.id),
      }),
      authority: "none",
      executable: false,
      toolExecution: false,
    });
    activation.publish({
      appId: "intelligence",
      target: encodeIntelligenceHandoffTarget({
        sourceAppId: "projects",
        mode,
        target,
        displayLabel: project.name,
        suggestedPrompt: t(
          mode === "plan"
            ? "projects.action.planWithIntelligencePrompt"
            : "projects.action.askIntelligencePrompt",
        ),
        authority: "none",
        executable: false,
        toolExecution: false,
      }),
    });
  };

  const render = () => {
    if (destroyed) return;
    const windowNode = root.querySelector(PROJECTS_WINDOW_SELECTOR);
    const slot = windowNode?.querySelector(PROJECTS_EXTENSION_SELECTOR) ?? null;
    if (!slot) {
      mountedSlot = null;
      return;
    }

    const locale = localization.getLocale();
    if (
      !slot.dataset.ordaxProjectsMounted
      || slot.dataset.ordaxProjectsLocale !== locale
    ) {
      slot.replaceChildren(buildShell(documentObject, t));
      slot.dataset.ordaxProjectsMounted = "true";
      slot.dataset.ordaxProjectsLocale = locale;
    }
    mountedSlot = slot;

    const presentation = createProjectsPresentation({
      projects: projectSnapshot,
      cloudLinks: linkSnapshot,
      webReferences: referenceSnapshot,
    });
    const view = slot.querySelector("[data-ordax-projects-view]");
    view.dataset.projectsAvailable = String(presentation.available);
    view.dataset.projectsPersistence = presentation.persistence;
    const summary = view.querySelectorAll(".ordax-projects-summary-item");
    summary[0].textContent = presentation.items.length === 1
      ? t("projects.count.one")
      : t("projects.count.many", { count: presentation.items.length });
    summary[1].textContent = presentation.persistence === "device"
      ? t("projects.persistence.device")
      : t("projects.persistence.session");

    const body = view.querySelector("[data-projects-body]");
    body.replaceChildren();

    if (!presentation.available) {
      body.append(
        node(documentObject, "h3", "ordax-projects-empty-title", t("projects.unavailable.title")),
        node(documentObject, "p", "ordax-projects-empty-copy", t("projects.unavailable.body")),
      );
      return;
    }

    if (presentation.items.length === 0) {
      body.append(
        node(documentObject, "h3", "ordax-projects-empty-title", t("projects.empty.title")),
        node(documentObject, "p", "ordax-projects-empty-copy", t("projects.empty.body")),
      );
      if (activation) {
        const openFiles = node(
          documentObject,
          "button",
          "ordax-project-action",
          t("projects.action.openFilesToCreate"),
        );
        openFiles.type = "button";
        openFiles.dataset.projectsOpenFiles = "";
        body.append(openFiles);
      }
      return;
    }

    const linked = node(
      documentObject,
      "p",
      "ordax-projects-cloud-summary",
      t("projects.cloudSummary", {
        linked: presentation.linkedCount,
        total: presentation.items.length,
      }),
    );
    const list = node(documentObject, "div", "ordax-projects-list");
    const canUseIntelligence = activation !== null && contextShare !== null;
    for (const item of presentation.items) {
      list.append(projectCard(documentObject, item, localization, canUseIntelligence));
    }
    body.append(linked, list);
  };

  const onClick = (event) => {
    const open = event.target?.closest?.("[data-projects-open]");
    if (open && mountedSlot?.contains(open)) {
      const item = projectSnapshot?.projects.find(
        (project) => project.id === open.dataset.projectsOpen,
      );
      if (item && activation) {
        activation.publish({ appId: "files", target: item.path });
      }
      return;
    }

    const ask = event.target?.closest?.("[data-projects-ask-intelligence]");
    if (ask && mountedSlot?.contains(ask)) {
      const item = projectSnapshot?.projects.find(
        (project) => project.id === ask.dataset.projectsAskIntelligence,
      );
      if (item) offerProjectToIntelligence(item, "chat");
      return;
    }

    const plan = event.target?.closest?.("[data-projects-plan-with-intelligence]");
    if (plan && mountedSlot?.contains(plan)) {
      const item = projectSnapshot?.projects.find(
        (project) => project.id === plan.dataset.projectsPlanWithIntelligence,
      );
      if (item) offerProjectToIntelligence(item, "plan");
      return;
    }

    const openFiles = event.target?.closest?.("[data-projects-open-files]");
    if (openFiles && mountedSlot?.contains(openFiles) && activation) {
      activation.publish({ appId: "files", target: "/Documentos" });
    }
  };

  const unsubscribeProjects = projectPort?.subscribe((snapshot) => {
    projectSnapshot = validateProjectCatalogSnapshot(snapshot);
    render();
  });
  const unsubscribeLinks = cloudPort?.subscribe((snapshot) => {
    linkSnapshot = validateProjectCloudLinksSnapshot(snapshot);
    render();
  });
  const unsubscribeReferences = referencePort?.subscribe((snapshot) => {
    referenceSnapshot = validateProjectWebReferenceSnapshot(snapshot);
    render();
  });
  const unsubscribeLocalization = localization.subscribe(() => render());
  const unsubscribeRender = lifecycle.subscribeRender(() => render());
  root.addEventListener("click", onClick);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeRender();
      unsubscribeLocalization();
      unsubscribeReferences?.();
      unsubscribeLinks?.();
      unsubscribeProjects?.();
      root.removeEventListener("click", onClick);
      mountedSlot = null;
    },
  });
}
