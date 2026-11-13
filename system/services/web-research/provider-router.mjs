import { assertWebProvider } from "../../contracts/web-research.mjs";

function boundedId(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 96) {
    throw new TypeError(`${label} must be a bounded provider id`);
  }
  return value.trim().toLowerCase();
}

function normalizeProviders(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("Web provider router requires a providers array");
  }
  const providers = value.map((provider) => assertWebProvider(provider));
  const ids = providers.map((provider) => provider.providerId.toLowerCase());
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Web provider router cannot register duplicate provider ids");
  }
  return Object.freeze(providers.slice());
}

function normalizePreferredIds(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError("Preferred Web providers must be a bounded array");
  }
  const ids = value.map((entry, index) => boundedId(entry, `Preferred Web provider[${index}]`));
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Preferred Web providers cannot contain duplicates");
  }
  return Object.freeze(ids);
}

export function createWebProviderRouter({ providers = [] } = {}) {
  const registered = normalizeProviders(providers);
  const byId = new Map(registered.map((provider) => [provider.providerId.toLowerCase(), provider]));

  function candidates(capability) {
    if (typeof capability !== "string" || !capability.trim()) {
      throw new TypeError("Web provider capability is required");
    }
    const normalized = capability.trim();
    return registered.filter((provider) => provider.capabilities.includes(normalized));
  }

  return Object.freeze({
    schema: "ordax.web-provider-router/1",

    getSnapshot() {
      return Object.freeze({
        schema: "ordax.web-provider-router-snapshot/1",
        providers: Object.freeze(registered.map((provider) => Object.freeze({
          providerId: provider.providerId,
          capabilities: Object.freeze([...provider.capabilities]),
        }))),
      });
    },

    resolve(capability, { preferredProviderIds } = {}) {
      const available = candidates(capability);
      const preferred = normalizePreferredIds(preferredProviderIds);
      if (preferred.length > 0) {
        for (const providerId of preferred) {
          const provider = byId.get(providerId);
          if (provider && provider.capabilities.includes(capability)) {
            return provider;
          }
        }
      }
      if (available.length === 0) {
        throw new Error(`No configured Web provider supports ${capability}`);
      }
      return available[0];
    },
  });
}
