import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE } from "../../services/local-ai/model-candidate.generated.mjs";
import { assessBundledLocalAiModel } from "../../services/local-ai/model-compatibility.mjs";

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function bytesText(bytes, locale) {
  if (bytes === null || !Number.isSafeInteger(bytes)) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
    .format(bytes / (1024 ** 3)) + " GiB";
}

function fact(documentObject, parent, label, value) {
  const row = node(documentObject, "div", "ordax-store-detail-fact");
  row.append(node(documentObject, "dt", "", label), node(documentObject, "dd", "", value));
  parent.append(row);
}

/**
 * Read-only visual projection. No app-store lifecycle, model downloads, or
 * "Install" buttons can be introduced through this component.
 */
export function appendStoreLocalAiModels(documentObject, target, {
  hardware = null,
  metrics = null,
  readState = "idle",
  t,
  locale = "pt-BR",
} = {}) {
  const candidate = BUNDLED_LOCAL_AI_MODEL_CANDIDATE;
  const result = assessBundledLocalAiModel({ candidate, hardware, metrics });

  const panel = node(documentObject, "section", "ordax-store-models");
  panel.dataset.storeModelsView = "true";
  panel.dataset.storeModelCompatibility = result.status;
  panel.dataset.storeModelAuthority = "none";
  panel.append(
    node(documentObject, "span", "ordax-store-eyebrow", t("store.models.kicker")),
    node(documentObject, "h3", "ordax-store-list-title", t("store.models.title")),
    node(documentObject, "p", "ordax-store-list-description", t("store.models.description")),
  );
  const card = node(documentObject, "article", "ordax-store-card ordax-store-model-card");
  const heading = node(documentObject, "div", "ordax-store-card-heading");
  heading.append(
    node(documentObject, "h3", "ordax-store-card-title", candidate.title),
    node(documentObject, "p", "ordax-store-card-meta", t("store.models.releaseMode")),
  );
  const status = node(documentObject, "span", "ordax-store-card-status", t("store.models.status." + result.status));
  status.dataset.storeModelStatus = result.status;
  card.append(heading, status);

  const info = node(documentObject, "dl", "ordax-store-detail-facts");
  fact(documentObject, info, t("store.models.engine"), candidate.engine);
  fact(documentObject, info, t("store.models.format"), candidate.modelFormat + " · " + candidate.quantization);
  fact(documentObject, info, t("store.models.license"), candidate.license + " / " + candidate.engineLicense);
  fact(documentObject, info, t("store.models.architecture"), result.artifactArchitecture);
  fact(documentObject, info, t("store.models.deviceArchitecture"), result.deviceArchitecture ?? t("store.models.unknown"));
  fact(documentObject, info, t("store.models.ramTotal"), bytesText(result.memoryTotalBytes, locale));
  fact(documentObject, info, t("store.models.ramAvailable"), bytesText(result.memoryAvailableBytes, locale));
  fact(documentObject, info, t("store.models.storageFree"), bytesText(result.userStorageFreeBytes, locale));
  fact(documentObject, info, t("store.models.binaryLowerBound"), bytesText(result.modelAndEngineBytesLowerBound, locale));
  fact(documentObject, info, t("store.models.minimumRam"), t("store.models.unqualified"));
  fact(documentObject, info, t("store.models.performance"), t("store.models.unqualified"));
  card.append(info);
  const explanation = node(documentObject, "p", "ordax-store-detail-note",
    result.status === "blocked-architecture"
      ? t("store.models.architectureBlocked")
      : t("store.models.performanceDisclaimer"));
  card.append(explanation);
  card.append(node(documentObject, "p", "ordax-store-detail-note", t("store.models.storageDisclaimer")));
  card.append(node(documentObject, "p", "ordax-store-detail-note", t("store.models.noIndependentLifecycle")));
  const refresh = node(documentObject, "button", "ordax-store-action ordax-store-action-secondary",
    readState === "loading" ? t("store.models.checking") : t("store.models.check"));
  refresh.type = "button";
  refresh.dataset.storeModelsRefresh = "true";
  refresh.disabled = readState === "loading";
  card.append(refresh);
  if (readState === "error") {
    const note = node(documentObject, "p", "ordax-store-detail-warning", t("store.models.readFailed"));
    note.setAttribute("role", "status");
    card.append(note);
  }
  panel.append(card);
  target.append(panel);
}
