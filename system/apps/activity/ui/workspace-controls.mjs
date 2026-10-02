import { assertPersonalApprovalConsent } from "../../../contracts/personal-approval-consent.mjs";
import { assertPersonalActivityExportPort } from "../../../contracts/personal-activity-export.mjs";
import { PERSONAL_ORDAX_RUNTIME_SCHEMA } from "../../../contracts/personal-ordax-store.mjs";
import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";
import { createPersonalActivityExportDocument } from "../../../services/personal-ordax/export.mjs";
import { projectPersonalActivitySnapshot } from "../view-model.mjs";

const EXTENSION_SELECTOR = '[data-app-extension="personal-activity"]';
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

function requireRuntime(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || value.schema !== PERSONAL_ORDAX_RUNTIME_SCHEMA) {
    throw new TypeError("Compatible Personal OrdaX runtime is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "create",
    "run",
    "pause",
    "resume",
    "cancel",
    "remove",
  ]) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Personal OrdaX runtime must implement ${method}()`);
    }
  }
  projectPersonalActivitySnapshot(value.getSnapshot());
  return value;
}

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function stateMessageId(state) {
  return `activity.state.${state}`;
}

function ownerCopy(view, t) {
  return view.ownerKind === "account"
    ? t("activity.owner.account")
    : t("activity.owner.device");
}

function persistenceCopy(view, t) {
  return view.persistence === "device"
    ? t("activity.persistence.device")
    : t("activity.persistence.session");
}

export function mountPersonalActivityControls(
  root,
  personalOrdaxValue,
  surfaceLifecycle,
  approvalConsentValue = null,
  activityExportValue = null,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Activity controls require a Surface root Element");
  }
  const personalOrdax = requireRuntime(personalOrdaxValue);
  const approvalConsent = approvalConsentValue === null
    ? null
    : assertPersonalApprovalConsent(approvalConsentValue);
  const activityExport = activityExportValue === null
    ? null
    : assertPersonalActivityExportPort(activityExportValue);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const t = lifecycle.localization.translate;
  const documentObject = root.ownerDocument;
  let destroyed = false;
  let draft = "";
  const actionDrafts = new Map();
  const proposalStates = new Map();
  const proposalBusy = new Set();
  let proposalOwnerKey = null;
  let localError = null;
  let exportStatus = null;
  let exportBusy = false;
  let mountedSlot = null;

  const render = () => {
    if (destroyed) return;
    const slot = root.querySelector(EXTENSION_SELECTOR);
    if (!slot) {
      mountedSlot = null;
      return;
    }
    mountedSlot = slot;
    slot.replaceChildren();
    slot.classList.add("ordax-activity-host");

    const header = node(documentObject, "header", "ordax-activity-header");
    const copy = node(documentObject, "div");
    copy.append(
      node(documentObject, "span", "ordax-activity-eyebrow", t("activity.eyebrow")),
      node(documentObject, "h3", "ordax-activity-title", t("activity.title")),
      node(documentObject, "p", "ordax-activity-description", t("activity.description")),
    );
    header.append(copy);

    if (personalOrdax === null) {
      header.append(node(documentObject, "span", "ordax-activity-status", t("activity.unavailable")));
      slot.append(
        header,
        node(documentObject, "p", "ordax-activity-empty", t("activity.unavailable.detail")),
      );
      return;
    }

    const view = projectPersonalActivitySnapshot(personalOrdax.getSnapshot());
    const currentProposalOwnerKey = view.ownerKind === "account"
      ? `account:${view.ownerId}`
      : "device";
    if (proposalOwnerKey !== currentProposalOwnerKey) {
      proposalOwnerKey = currentProposalOwnerKey;
      proposalStates.clear();
      proposalBusy.clear();
    }
    const availableActions = typeof personalOrdax.listAvailableActions === "function"
      ? personalOrdax.listAvailableActions()
      : [];
    const owner = node(
      documentObject,
      "span",
      "ordax-activity-status",
      `${ownerCopy(view, t)} · ${persistenceCopy(view, t)}`,
    );
    owner.dataset.persistence = view.persistence;
    header.append(owner);
    if (activityExport !== null) {
      const exportButton = node(
        documentObject,
        "button",
        "",
        exportBusy ? t("activity.export.saving") : t("activity.action.export"),
      );
      exportButton.type = "button";
      exportButton.dataset.personalActivityExport = "";
      exportButton.disabled = exportBusy;
      header.append(exportButton);
    }
    slot.append(header);
    if (exportStatus) {
      const status = node(
        documentObject,
        "p",
        exportStatus.kind === "error" ? "ordax-activity-error" : "ordax-activity-latest",
        exportStatus.text,
      );
      status.setAttribute("role", exportStatus.kind === "error" ? "alert" : "status");
      slot.append(status);
    }

    const createBox = node(documentObject, "section", "ordax-activity-create");
    createBox.append(node(documentObject, "strong", "", t("activity.create.title")));
    const input = documentObject.createElement("textarea");
    input.maxLength = 32000;
    input.rows = 3;
    input.value = draft;
    input.placeholder = t("activity.create.placeholder");
    input.setAttribute("aria-label", t("activity.create.aria"));
    input.dataset.personalWorkInput = "";
    const createButton = node(
      documentObject,
      "button",
      "ordax-activity-primary",
      t("activity.action.create"),
    );
    createButton.type = "button";
    createButton.dataset.personalWorkCreate = "";
    createButton.disabled = draft.trim().length === 0;
    createBox.append(input, createButton);
    slot.append(createBox);

    if (localError) {
      const error = node(documentObject, "p", "ordax-activity-error", localError);
      error.setAttribute("role", "alert");
      slot.append(error);
    }

    const list = node(documentObject, "div", "ordax-activity-list");
    if (view.work.length === 0) {
      list.append(node(documentObject, "p", "ordax-activity-empty", t("activity.empty")));
    } else {
      for (const entry of [...view.work].reverse()) {
        const { item, activities, result } = entry;
        const article = node(documentObject, "article", "ordax-activity-work");
        article.dataset.personalWorkId = item.id;

        const top = node(documentObject, "div", "ordax-activity-work-top");
        const goal = node(documentObject, "div");
        goal.append(
          node(documentObject, "strong", "ordax-activity-work-goal", item.goal),
          node(
            documentObject,
            "span",
            "ordax-activity-work-meta",
            `${t(stateMessageId(item.state))} · ${item.id}`,
          ),
        );
        top.append(goal);

        const actions = node(documentObject, "div", "ordax-activity-work-actions");
        const addAction = (action, label) => {
          const button = node(documentObject, "button", "", label);
          button.type = "button";
          button.dataset.personalWorkAction = action;
          button.dataset.personalWorkId = item.id;
          actions.append(button);
        };
        if (item.state === "queued" && entry.approvedApproval === null) {
          addAction("run", t("activity.action.run"));
        }
        if (item.state === "running") addAction("pause", t("activity.action.pause"));
        if (item.state === "paused") {
          addAction("resume", t("activity.action.resume"));
          addAction("cancel", t("activity.action.cancel"));
        }
        if (item.state === "waiting-approval") addAction("cancel", t("activity.action.cancel"));
        if (item.state === "queued" || item.state === "running") {
          addAction("cancel", t("activity.action.cancel"));
        }
        if (TERMINAL_STATES.has(item.state)) addAction("remove", t("activity.action.remove"));
        if (
          (item.state === "queued" || item.state === "paused")
          && entry.pendingApproval === null
          && entry.approvedApproval === null
          && availableActions.length > 0
          && typeof personalOrdax.proposeActionForWork === "function"
        ) {
          const suggest = node(
            documentObject,
            "button",
            "",
            proposalBusy.has(item.id)
              ? t("activity.proposal.planning")
              : t("activity.action.suggest"),
          );
          suggest.type = "button";
          suggest.dataset.personalProposalSuggest = "";
          suggest.dataset.personalWorkId = item.id;
          suggest.disabled = proposalBusy.has(item.id);
          actions.append(suggest);
        }
        top.append(actions);
        article.append(top);

        const latest = activities.at(-1);
        if (latest) {
          article.append(
            node(
              documentObject,
              "p",
              "ordax-activity-latest",
              `${t("activity.latest")}: ${latest.summary}`,
            ),
          );
        }

        if (entry.latestAttempt) {
          const attempt = entry.latestAttempt;
          const attemptBox = node(
            documentObject,
            "section",
            attempt.status === "uncertain"
              ? "ordax-activity-approval ordax-activity-attempt-uncertain"
              : "ordax-activity-approval",
          );
          attemptBox.append(
            node(documentObject, "strong", "", t("activity.attempt.title")),
            node(
              documentObject,
              "span",
              "ordax-activity-result-meta",
              `${t(`activity.attempt.status.${attempt.status}`)} · ${attempt.id}`,
            ),
          );
          if (attempt.summary) {
            attemptBox.append(node(documentObject, "p", "", attempt.summary));
          }
          if (attempt.status === "uncertain") {
            attemptBox.append(
              node(documentObject, "p", "ordax-activity-error", t("activity.attempt.uncertain.detail")),
            );
          }
          article.append(attemptBox);
        }

        const proposalState = proposalStates.get(item.id);
        if (
          proposalState
          && (item.state === "queued" || item.state === "paused")
          && entry.pendingApproval === null
          && entry.approvedApproval === null
        ) {
          const proposalBox = node(documentObject, "section", "ordax-activity-approval");
          proposalBox.append(
            node(documentObject, "strong", "", t("activity.proposal.title")),
          );
          if (proposalState.kind === "none") {
            proposalBox.append(node(documentObject, "p", "", t("activity.proposal.none")));
          } else {
            const proposal = proposalState.value;
            proposalBox.append(
              node(documentObject, "p", "", proposal.rationale),
              node(
                documentObject,
                "span",
                "ordax-activity-result-meta",
                `${proposal.entryId} · authority=${proposal.authority}`,
              ),
              node(
                documentObject,
                "span",
                "ordax-activity-result-meta",
                `${t("activity.proposal.resource")}: ${proposal.resourceValue}`,
              ),
            );
            const proposalActions = node(
              documentObject,
              "div",
              "ordax-activity-work-actions ordax-activity-approval-actions",
            );
            const request = node(
              documentObject,
              "button",
              "ordax-activity-primary",
              t("activity.action.requestProposalApproval"),
            );
            request.type = "button";
            request.dataset.personalProposalAction = "request";
            request.dataset.personalWorkId = item.id;
            const discard = node(
              documentObject,
              "button",
              "",
              t("activity.action.discardProposal"),
            );
            discard.type = "button";
            discard.dataset.personalProposalAction = "discard";
            discard.dataset.personalWorkId = item.id;
            proposalActions.append(request, discard);
            proposalBox.append(proposalActions);
          }
          article.append(proposalBox);
        }

        if (
          (item.state === "queued" || item.state === "paused")
          && entry.pendingApproval === null
          && entry.approvedApproval === null
          && availableActions.length > 0
          && typeof personalOrdax.requestAvailableAction === "function"
        ) {
          const catalogBox = node(documentObject, "section", "ordax-activity-approval");
          catalogBox.append(
            node(documentObject, "strong", "", t("activity.catalog.title")),
            node(documentObject, "p", "", t("activity.catalog.description")),
          );
          for (const actionEntry of availableActions) {
            const key = `${item.id}:${actionEntry.id}`;
            const actionRow = node(documentObject, "div", "ordax-activity-action-entry");
            actionRow.append(
              node(
                documentObject,
                "strong",
                "ordax-activity-action-entry-title",
                t(`activity.catalog.${actionEntry.id}.title`),
              ),
              node(
                documentObject,
                "span",
                "ordax-activity-result-meta",
                `${actionEntry.actionId} · ${actionEntry.effect} · ${actionEntry.resourceScheme}`,
              ),
            );
            const resourceInput = documentObject.createElement("input");
            resourceInput.type = "text";
            resourceInput.maxLength = 4096;
            resourceInput.value = actionDrafts.get(key) ?? "";
            resourceInput.placeholder = t(`activity.catalog.${actionEntry.id}.placeholder`);
            resourceInput.setAttribute(
              "aria-label",
              t(`activity.catalog.${actionEntry.id}.aria`),
            );
            resourceInput.dataset.personalActionResource = "";
            resourceInput.dataset.personalActionEntryId = actionEntry.id;
            resourceInput.dataset.personalWorkId = item.id;

            const requestButton = node(
              documentObject,
              "button",
              "",
              t("activity.action.requestApproval"),
            );
            requestButton.type = "button";
            requestButton.dataset.personalActionRequest = "";
            requestButton.dataset.personalActionEntryId = actionEntry.id;
            requestButton.dataset.personalWorkId = item.id;
            requestButton.disabled = resourceInput.value.trim().length === 0;
            actionRow.append(resourceInput, requestButton);
            catalogBox.append(actionRow);
          }
          article.append(catalogBox);
        }

        if (entry.pendingApproval) {
          const approvalBox = node(documentObject, "section", "ordax-activity-approval");
          approvalBox.append(
            node(documentObject, "strong", "", t("activity.approval.title")),
            node(documentObject, "p", "", entry.pendingApproval.reason),
            node(
              documentObject,
              "span",
              "ordax-activity-result-meta",
              `${entry.pendingApproval.actionId} · ${entry.pendingApproval.effect}`,
            ),
            ...(entry.pendingApproval.resourceRef === null ? [] : [
              node(
                documentObject,
                "span",
                "ordax-activity-result-meta",
                `${t("activity.approval.resource")}: ${entry.pendingApproval.resourceRef}`,
              ),
            ]),
            node(
              documentObject,
              "span",
              "ordax-activity-result-meta",
              `${t("activity.approval.tool")}: ${entry.pendingApproval.toolId} · sha256:${entry.pendingApproval.toolArtifactSha256.slice(0, 12)}…`,
            ),
            node(
              documentObject,
              "span",
              "ordax-activity-result-meta",
              t("activity.approval.grantRequired"),
            ),
          );
          if (approvalConsent !== null) {
            const approvalActions = node(
              documentObject,
              "div",
              "ordax-activity-work-actions ordax-activity-approval-actions",
            );
            const addApprovalAction = (action, label) => {
              const button = node(documentObject, "button", "", label);
              button.type = "button";
              button.dataset.personalApprovalAction = action;
              button.dataset.personalApprovalId = entry.pendingApproval.id;
              button.dataset.personalWorkId = item.id;
              approvalActions.append(button);
            };
            if (approvalConsent.canApprove(item.id, entry.pendingApproval.id)) {
              addApprovalAction("approve", t("activity.action.approve"));
            }
            addApprovalAction("deny", t("activity.action.deny"));
            approvalBox.append(approvalActions);
          }
          article.append(approvalBox);
        }

        if (entry.approvedApproval) {
          const approved = entry.approvedApproval;
          const approvedBox = node(documentObject, "section", "ordax-activity-approval");
          approvedBox.append(
            node(documentObject, "strong", "", t("activity.approval.approvedTitle")),
            node(documentObject, "p", "", approved.reason),
            node(
              documentObject,
              "span",
              "ordax-activity-result-meta",
              `${approved.actionId} · ${approved.effect}`,
            ),
            ...(approved.resourceRef === null ? [] : [
              node(
                documentObject,
                "span",
                "ordax-activity-result-meta",
                `${t("activity.approval.resource")}: ${approved.resourceRef}`,
              ),
            ]),
            node(
              documentObject,
              "span",
              "ordax-activity-result-meta",
              `${t("activity.approval.tool")}: ${approved.toolId} · sha256:${approved.toolArtifactSha256.slice(0, 12)}…`,
            ),
          );
          if (
            typeof personalOrdax.canExecuteApprovedAction === "function"
            && typeof personalOrdax.executeApprovedAction === "function"
            && personalOrdax.canExecuteApprovedAction(item.id, approved.id)
          ) {
            const execute = node(
              documentObject,
              "button",
              "ordax-activity-primary",
              t("activity.action.executeApproved"),
            );
            execute.type = "button";
            execute.dataset.personalApprovedActionExecute = "";
            execute.dataset.personalApprovalId = approved.id;
            execute.dataset.personalWorkId = item.id;
            approvedBox.append(execute);
          }
          article.append(approvedBox);
        }

        if (result) {
          const resultBox = node(documentObject, "section", "ordax-activity-result");
          resultBox.append(
            node(documentObject, "strong", "", t("activity.result.title")),
            node(documentObject, "p", "", result.text),
            node(
              documentObject,
              "span",
              "ordax-activity-result-meta",
              `${result.engineId} · ${result.modelId} · authority=${result.authority}`,
            ),
          );
          article.append(resultBox);
        }
        list.append(article);
      }
    }
    slot.append(list);
  };

  const runAction = async (id, action) => {
    if (personalOrdax === null) return;
    localError = null;
    try {
      if (action === "run") {
        await personalOrdax.run(id);
      } else if (action === "pause") {
        personalOrdax.pause(id);
      } else if (action === "resume") {
        personalOrdax.resume(id);
      } else if (action === "cancel") {
        personalOrdax.cancel(id);
      } else if (action === "remove") {
        personalOrdax.remove(id);
      }
    } catch {
      const current = personalOrdax.getSnapshot().workItems.find((item) => item.id === id);
      if (current?.state === "failed" || current?.state === "running") {
        localError = t("activity.error.action");
      }
    } finally {
      render();
    }
  };

  const runApprovedAction = async (workItemId, approvalId) => {
    if (
      personalOrdax === null
      || typeof personalOrdax.executeApprovedAction !== "function"
    ) return;
    localError = null;
    try {
      await personalOrdax.executeApprovedAction(workItemId, approvalId);
    } catch {
      const current = personalOrdax.getSnapshot().workItems.find((item) => item.id === workItemId);
      if (current?.state === "failed" || current?.state === "running") {
        localError = t("activity.error.action");
      }
    } finally {
      render();
    }
  };

  const runApprovalAction = (workItemId, approvalId, action) => {
    if (approvalConsent === null) return;
    localError = null;
    try {
      if (action === "approve") {
        approvalConsent.approve(workItemId, approvalId);
      } else if (action === "deny") {
        approvalConsent.deny(workItemId, approvalId);
      }
    } catch {
      localError = t("activity.error.approval");
    } finally {
      render();
    }
  };

  const runProposalSuggestion = async (workItemId) => {
    if (
      personalOrdax === null
      || typeof personalOrdax.proposeActionForWork !== "function"
      || proposalBusy.has(workItemId)
    ) return;

    const before = personalOrdax.getSnapshot();
    const ownerKey = before.ownerKind === "account"
      ? `account:${before.ownerId}`
      : "device";
    proposalBusy.add(workItemId);
    proposalStates.delete(workItemId);
    localError = null;
    render();

    try {
      const proposal = await personalOrdax.proposeActionForWork(workItemId);
      const after = personalOrdax.getSnapshot();
      const currentOwnerKey = after.ownerKind === "account"
        ? `account:${after.ownerId}`
        : "device";
      if (
        currentOwnerKey !== ownerKey
        || !after.workItems.some((item) => item.id === workItemId)
      ) {
        return;
      }
      proposalStates.set(
        workItemId,
        proposal === null
          ? { kind: "none" }
          : { kind: "proposal", value: proposal },
      );
    } catch {
      localError = t("activity.error.proposal");
    } finally {
      proposalBusy.delete(workItemId);
      render();
    }
  };

  const runExport = async () => {
    if (personalOrdax === null || activityExport === null || exportBusy) return;
    exportBusy = true;
    exportStatus = null;
    render();
    try {
      const document = createPersonalActivityExportDocument(personalOrdax.getSnapshot());
      const result = await activityExport.save(document);
      if (!result || result.status !== "saved" || result.fileName !== document.fileName) {
        throw new Error("Personal Activity export save confirmation is invalid");
      }
      exportStatus = {
        kind: "success",
        text: `${t("activity.export.saved")}: ${result.fileName}`,
      };
    } catch {
      exportStatus = { kind: "error", text: t("activity.error.export") };
    } finally {
      exportBusy = false;
      render();
    }
  };

  const onInput = (event) => {
    if (event.target?.dataset?.personalActionResource !== undefined) {
      const workItemId = event.target.dataset.personalWorkId;
      const entryId = event.target.dataset.personalActionEntryId;
      if (!workItemId || !entryId) return;
      actionDrafts.set(`${workItemId}:${entryId}`, event.target.value);
      const button = event.target
        .closest(".ordax-activity-action-entry")
        ?.querySelector("[data-personal-action-request]");
      if (button) button.disabled = event.target.value.trim().length === 0;
      return;
    }
    if (event.target?.dataset?.personalWorkInput === undefined) return;
    draft = event.target.value;
    const button = mountedSlot?.querySelector("[data-personal-work-create]");
    if (button) button.disabled = draft.trim().length === 0;
  };

  const onClick = (event) => {
    const target = event.target?.closest?.("button");
    if (!target || !mountedSlot?.contains(target) || personalOrdax === null) return;

    if (target.dataset.personalActivityExport !== undefined) {
      void runExport();
      return;
    }

    const proposalWorkId = target.dataset.personalWorkId;
    if (target.dataset.personalProposalSuggest !== undefined && proposalWorkId) {
      void runProposalSuggestion(proposalWorkId);
      return;
    }

    const proposalAction = target.dataset.personalProposalAction;
    if (proposalAction && proposalWorkId) {
      if (proposalAction === "discard") {
        proposalStates.delete(proposalWorkId);
        render();
        return;
      }
      if (
        proposalAction === "request"
        && typeof personalOrdax.requestProposedAction === "function"
      ) {
        const proposalState = proposalStates.get(proposalWorkId);
        if (proposalState?.kind !== "proposal") return;
        try {
          personalOrdax.requestProposedAction(proposalState.value);
          proposalStates.delete(proposalWorkId);
          localError = null;
        } catch {
          localError = t("activity.error.approval");
        }
        render();
        return;
      }
    }

    const actionRequest = target.dataset.personalActionRequest;
    const actionEntryId = target.dataset.personalActionEntryId;
    const actionWorkId = target.dataset.personalWorkId;
    if (
      actionRequest !== undefined
      && actionEntryId
      && actionWorkId
      && typeof personalOrdax.requestAvailableAction === "function"
    ) {
      const key = `${actionWorkId}:${actionEntryId}`;
      const resourceValue = actionDrafts.get(key)?.trim() ?? "";
      if (!resourceValue) return;
      try {
        personalOrdax.requestAvailableAction(actionWorkId, actionEntryId, { resourceValue });
        actionDrafts.delete(key);
        localError = null;
      } catch {
        localError = t("activity.error.approval");
      }
      render();
      return;
    }

    const approvedExecute = target.dataset.personalApprovedActionExecute;
    const approvedId = target.dataset.personalApprovalId;
    const approvedWorkId = target.dataset.personalWorkId;
    if (approvedExecute !== undefined && approvedId && approvedWorkId) {
      void runApprovedAction(approvedWorkId, approvedId);
      return;
    }

    const approvalAction = target.dataset.personalApprovalAction;
    const approvalId = target.dataset.personalApprovalId;
    const approvalWorkId = target.dataset.personalWorkId;
    if (approvalAction && approvalId && approvalWorkId) {
      runApprovalAction(approvalWorkId, approvalId, approvalAction);
      return;
    }

    if (target.dataset.personalWorkCreate !== undefined) {
      const goal = draft.trim();
      if (!goal) return;
      try {
        personalOrdax.create(goal);
        draft = "";
        localError = null;
      } catch {
        localError = t("activity.error.create");
      }
      render();
      return;
    }

    const action = target.dataset.personalWorkAction;
    const id = target.dataset.personalWorkId;
    if (action && id) void runAction(id, action);
  };

  root.addEventListener("input", onInput);
  root.addEventListener("click", onClick);
  const unsubscribeRuntime = personalOrdax?.subscribe(() => render()) ?? (() => {});
  const unsubscribeRender = lifecycle.subscribeRender(() => render());

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeRender();
      unsubscribeRuntime();
      root.removeEventListener("input", onInput);
      root.removeEventListener("click", onClick);
      if (mountedSlot) {
        mountedSlot.classList.remove("ordax-activity-host");
        mountedSlot.replaceChildren();
      }
      mountedSlot = null;
    },
  });
}
