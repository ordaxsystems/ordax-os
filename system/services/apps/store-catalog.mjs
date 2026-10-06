import { getFirstPartyAppDeliveryPolicy } from "./delivery-policy.mjs";

export const STORE_CATALOG_ENTRY_SCHEMA = "ordax.store-catalog-entry/1";

const RAW_ENTRIES = Object.freeze([
  { appId: "assistant", title: "Assistente", description: "Conversas persistentes com Intelligence e contexto explícito." },
  { appId: "studio", title: "ORDAX Studio", description: "Projetos e ações tipadas sobre ferramentas locais autorizadas." },
  { appId: "projects", title: "Projetos", description: "Hub de projetos, referências e continuidade do trabalho." },
  { appId: "activity", title: "Atividade", description: "Work explícito, aprovações, progresso, resultados e recuperação." },
  { appId: "notes", title: "Notas", description: "Escrita local, projetos, tarefas e referências disponíveis offline." },
  { appId: "network", title: "Rede", description: "Comunidades e mensagens vinculadas explicitamente ao Space remetente." },
]);

function defineEntry(entry) {
  const policy = getFirstPartyAppDeliveryPolicy(entry.appId);
  if (!policy || policy.deliveryClass !== "on-demand") {
    throw new TypeError(`Store catalog entry ${entry.appId} must reference an on-demand first-party delivery policy`);
  }
  return Object.freeze({
    schema: STORE_CATALOG_ENTRY_SCHEMA,
    appId: entry.appId,
    title: entry.title,
    description: entry.description,
    deliveryClass: policy.deliveryClass,
    discovery: policy.discovery,
    removable: policy.removable,
    presentation: "catalog-only",
    installAction: "none",
    authority: "none",
  });
}

const ENTRIES = Object.freeze(RAW_ENTRIES.map(defineEntry));
const ENTRY_BY_ID = new Map(ENTRIES.map((entry) => [entry.appId, entry]));
if (ENTRY_BY_ID.size !== ENTRIES.length) {
  throw new TypeError("Store catalog app ids must be unique");
}

export function listStoreCatalogEntries() {
  return ENTRIES;
}

export function getStoreCatalogEntry(appId) {
  return ENTRY_BY_ID.get(appId) ?? null;
}
