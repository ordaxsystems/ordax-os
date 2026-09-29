import { MEMORY_REVIEW_VIEW_SCHEMA } from "../../services/memory/review-view-model.mjs";

export const MEMORY_REVIEW_CONTROLS_SCHEMA = "ordax.memory-review-controls/1";

function requireElement(value, label) {
  if (!value || typeof value !== "object" || typeof value.querySelector !== "function") {
    throw new TypeError(`${label} must be an Element-like Surface node`);
  }
  return value;
}

function requireViewModel(value) {
  if (!value || typeof value !== "object" || value.getSnapshot?.().schema !== MEMORY_REVIEW_VIEW_SCHEMA) {
    throw new TypeError("Compatible memory review view model is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "setQuery",
    "selectOwner",
    "create",
    "nextPage",
    "previousPage",
    "update",
    "remove",
  ]) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Memory review view model must implement ${method}()`);
    }
  }
  return value;
}

function requireCopy(copy) {
  const required = [
    "title",
    "description",
    "searchPlaceholder",
    "deviceOwner",
    "accountOwner",
    "empty",
    "addPlaceholder",
    "add",
    "save",
    "remove",
    "removePrompt",
    "removeConfirm",
    "removeCancel",
    "previous",
    "next",
    "saving",
    "saved",
    "saveError",
    "contentLabel",
  ];
  if (!copy || typeof copy !== "object") {
    throw new TypeError("Memory review copy is required");
  }
  for (const key of required) {
    if (typeof copy[key] !== "string" || copy[key].length === 0) {
      throw new TypeError(`Memory review copy.${key} must be text`);
    }
  }
  return Object.freeze({ ...copy });
}

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function ownerLabel(owner, copy) {
  return owner.ownerKind === "device" ? copy.deviceOwner : copy.accountOwner;
}

function findItemTextarea(container, id) {
  return Array.from(container.querySelectorAll("textarea[data-memory-review-content]"))
    .find((entry) => entry.dataset.memoryReviewContent === id) ?? null;
}

function findItemActionButton(container, datasetKey, id) {
  return Array.from(container.querySelectorAll("button"))
    .find((entry) => entry.dataset?.[datasetKey] === id) ?? null;
}

export function mountMemoryReviewControls(containerValue, viewModelValue, copyValue) {
  const container = requireElement(containerValue, "Memory review container");
  const viewModel = requireViewModel(viewModelValue);
  const copy = requireCopy(copyValue);
  const documentObject = container.ownerDocument;
  let destroyed = false;
  let mutationPending = false;
  let pendingRemovalId = null;

  const render = (snapshot = viewModel.getSnapshot()) => {
    if (destroyed) return;
    if (
      pendingRemovalId !== null
      && !snapshot.items.some((item) => item.id === pendingRemovalId)
    ) {
      pendingRemovalId = null;
    }
    container.replaceChildren();
    container.dataset.memoryReview = "";

    const header = node(documentObject, "header", "ordax-memory-review-header");
    header.append(
      node(documentObject, "h4", "ordax-memory-review-title", copy.title),
      node(documentObject, "p", "ordax-memory-review-description", copy.description),
    );
    container.append(header);

    const toolbar = node(documentObject, "div", "ordax-memory-review-toolbar");
    const search = documentObject.createElement("input");
    search.type = "search";
    search.maxLength = 1024;
    search.value = snapshot.query;
    search.placeholder = copy.searchPlaceholder;
    search.dataset.memoryReviewSearch = "";
    search.disabled = mutationPending;
    toolbar.append(search);

    if (snapshot.owners.length > 1) {
      const owners = node(documentObject, "div", "ordax-memory-review-owners");
      for (const owner of snapshot.owners) {
        const selected = owner.key === snapshot.selectedOwner.key;
        const button = node(
          documentObject,
          "button",
          "ordax-memory-review-owner",
          ownerLabel(owner, copy),
        );
        button.type = "button";
        button.dataset.memoryReviewOwner = owner.key;
        button.dataset.ownerKind = owner.ownerKind;
        if (owner.ownerId !== null) button.dataset.ownerId = owner.ownerId;
        button.setAttribute("aria-pressed", String(selected));
        button.disabled = mutationPending;
        owners.append(button);
      }
      toolbar.append(owners);
    }
    container.append(toolbar);

    const createBox = node(documentObject, "div", "ordax-memory-review-create");
    const createInput = documentObject.createElement("textarea");
    createInput.maxLength = 32768;
    createInput.placeholder = copy.addPlaceholder;
    createInput.dataset.memoryReviewNew = "";
    createInput.disabled = mutationPending;
    const createButton = node(
      documentObject,
      "button",
      "ordax-memory-review-create-button",
      copy.add,
    );
    createButton.type = "button";
    createButton.dataset.memoryReviewCreate = "";
    createButton.disabled = mutationPending;
    createBox.append(createInput, createButton);
    container.append(createBox);

    const status = node(documentObject, "p", "ordax-memory-review-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    if (snapshot.persistenceState === "pending") status.textContent = copy.saving;
    if (snapshot.persistenceState === "saved") status.textContent = copy.saved;
    if (snapshot.persistenceState === "error") status.textContent = copy.saveError;
    container.append(status);

    const list = node(documentObject, "div", "ordax-memory-review-list");
    if (snapshot.items.length === 0) {
      list.append(node(documentObject, "p", "ordax-memory-review-empty", copy.empty));
    }
    for (const item of snapshot.items) {
      const article = node(documentObject, "article", "ordax-memory-review-item");
      article.dataset.memoryReviewItem = item.id;
      article.dataset.sensitivity = item.sensitivity;
      const meta = node(
        documentObject,
        "small",
        "ordax-memory-review-meta",
        `${item.kind} · ${item.scope} · ${item.sensitivity} · ${item.provenance}`,
      );
      const label = node(
        documentObject,
        "label",
        "ordax-memory-review-content-label",
        copy.contentLabel,
      );
      const textarea = documentObject.createElement("textarea");
      textarea.maxLength = 32768;
      textarea.value = item.content;
      textarea.dataset.memoryReviewContent = item.id;
      textarea.disabled = mutationPending;
      label.append(textarea);
      const actions = node(documentObject, "div", "ordax-memory-review-actions");
      const save = node(documentObject, "button", "ordax-memory-review-save", copy.save);
      save.type = "button";
      save.dataset.memoryReviewSave = item.id;
      save.disabled = mutationPending;
      actions.append(save);

      if (pendingRemovalId === item.id) {
        const prompt = node(
          documentObject,
          "span",
          "ordax-memory-review-remove-prompt",
          copy.removePrompt,
        );
        const confirm = node(
          documentObject,
          "button",
          "ordax-memory-review-remove-confirm",
          copy.removeConfirm,
        );
        confirm.type = "button";
        confirm.dataset.memoryReviewRemoveConfirm = item.id;
        confirm.disabled = mutationPending;
        const cancel = node(
          documentObject,
          "button",
          "ordax-memory-review-remove-cancel",
          copy.removeCancel,
        );
        cancel.type = "button";
        cancel.dataset.memoryReviewRemoveCancel = item.id;
        cancel.disabled = mutationPending;
        actions.append(prompt, confirm, cancel);
      } else {
        const remove = node(documentObject, "button", "ordax-memory-review-remove", copy.remove);
        remove.type = "button";
        remove.dataset.memoryReviewRemove = item.id;
        remove.disabled = mutationPending;
        actions.append(remove);
      }
      article.append(meta, label, actions);
      list.append(article);
    }
    container.append(list);

    const pagination = node(documentObject, "div", "ordax-memory-review-pagination");
    const previous = node(documentObject, "button", "ordax-memory-review-page", copy.previous);
    previous.type = "button";
    previous.dataset.memoryReviewPage = "previous";
    previous.disabled = !snapshot.canPrevious || mutationPending;
    const next = node(documentObject, "button", "ordax-memory-review-page", copy.next);
    next.type = "button";
    next.dataset.memoryReviewPage = "next";
    next.disabled = !snapshot.canNext || mutationPending;
    pagination.append(previous, next);
    container.append(pagination);
  };

  const onInput = (event) => {
    const target = event.target;
    if (!target || target.dataset?.memoryReviewSearch === undefined) return;
    pendingRemovalId = null;
    viewModel.setQuery(target.value);
  };

  const runMutation = async (operation) => {
    if (mutationPending) return;
    mutationPending = true;
    render();
    try {
      await operation();
    } catch {
      // The view model intentionally exposes only a generic persistence state.
      // Do not leak adapter/host error details through an unhandled rejection.
    } finally {
      mutationPending = false;
      render();
    }
  };

  const onClick = (event) => {
    const source = event.target;
    const target = source?.closest?.("button") ?? null;
    if (!target || !container.contains(target)) return;
    if (target.dataset.memoryReviewOwner) {
      pendingRemovalId = null;
      viewModel.selectOwner({
        ownerKind: target.dataset.ownerKind,
        ownerId: target.dataset.ownerKind === "device" ? null : target.dataset.ownerId,
      });
      return;
    }
    if (target.dataset.memoryReviewCreate !== undefined) {
      pendingRemovalId = null;
      const textarea = container.querySelector("textarea[data-memory-review-new]");
      if (!textarea || textarea.value.trim().length === 0) return;
      void runMutation(() => viewModel.create(textarea.value));
      return;
    }
    if (target.dataset.memoryReviewPage === "previous") {
      pendingRemovalId = null;
      viewModel.previousPage();
      return;
    }
    if (target.dataset.memoryReviewPage === "next") {
      pendingRemovalId = null;
      viewModel.nextPage();
      return;
    }
    if (target.dataset.memoryReviewSave) {
      pendingRemovalId = null;
      const id = target.dataset.memoryReviewSave;
      const textarea = findItemTextarea(container, id);
      if (!textarea) return;
      void runMutation(() => viewModel.update(id, { content: textarea.value }));
      return;
    }
    if (target.dataset.memoryReviewRemove) {
      pendingRemovalId = target.dataset.memoryReviewRemove;
      render();
      findItemActionButton(
        container,
        "memoryReviewRemoveConfirm",
        pendingRemovalId,
      )?.focus({ preventScroll: true });
      return;
    }
    if (target.dataset.memoryReviewRemoveCancel) {
      const id = target.dataset.memoryReviewRemoveCancel;
      if (pendingRemovalId === id) {
        pendingRemovalId = null;
        render();
        findItemActionButton(
          container,
          "memoryReviewRemove",
          id,
        )?.focus({ preventScroll: true });
      }
      return;
    }
    if (target.dataset.memoryReviewRemoveConfirm) {
      const id = target.dataset.memoryReviewRemoveConfirm;
      if (pendingRemovalId !== id) return;
      pendingRemovalId = null;
      void runMutation(() => viewModel.remove(id));
    }
  };

  container.addEventListener("input", onInput);
  container.addEventListener("click", onClick);
  const unsubscribe = viewModel.subscribe(render);
  render();

  return Object.freeze({
    schema: MEMORY_REVIEW_CONTROLS_SCHEMA,
    refresh() {
      render();
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      pendingRemovalId = null;
      unsubscribe();
      container.removeEventListener("input", onInput);
      container.removeEventListener("click", onClick);
      container.replaceChildren();
      delete container.dataset.memoryReview;
    },
  });
}
