const MAX_COMPONENT_CONTEXT_PROVIDERS = 16;
const MAX_COMPONENT_CONTEXT_FIELDS_PER_PROVIDER = 16;
const FORBIDDEN_COMPONENT_CONTEXT_FIELDS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function validateText(value, label) {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be non-empty text`);
  }
  return value.trim();
}

function applyProviderContribution(value, context, label) {
  if (value === null) {
    return Object.freeze({ context, contributed: false });
  }
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (
      Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    )
  ) {
    throw new TypeError(`${label} provider must return a plain object or null`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} provider must not return symbol fields`);
  }
  const additions = Object.entries(value);
  if (additions.length > MAX_COMPONENT_CONTEXT_FIELDS_PER_PROVIDER) {
    throw new RangeError(`${label} provider returned too many fields`);
  }
  for (const [key] of additions) {
    if (
      key.length === 0
      || key.length > 128
      || /[\u0000-\u001f\u007f]/.test(key)
      || FORBIDDEN_COMPONENT_CONTEXT_FIELDS.has(key)
      || Object.prototype.hasOwnProperty.call(context, key)
    ) {
      throw new TypeError(`${label} cannot add field: ${key}`);
    }
  }
  if (additions.length === 0) {
    return Object.freeze({ context, contributed: true });
  }
  return Object.freeze({
    context: Object.freeze({ ...context, ...value }),
    contributed: true,
  });
}

export function createComponentContextProviderRegistry({
  label,
  startDescription,
  returnNullWithoutContribution = false,
} = {}) {
  const boundaryLabel = validateText(label, "Component context registry label");
  const startLabel = validateText(
    startDescription,
    "Component context registry start description",
  );
  if (typeof returnNullWithoutContribution !== "boolean") {
    throw new TypeError("Component context registry null-result policy must be boolean");
  }

  const providers = [];
  let compositionStarted = false;

  async function compose(componentId, callerContext) {
    compositionStarted = true;
    let context = callerContext;
    let contributed = false;
    for (const provider of providers) {
      const applied = applyProviderContribution(
        await provider(componentId),
        context,
        boundaryLabel,
      );
      context = applied.context;
      contributed = contributed || applied.contributed;
    }
    if (returnNullWithoutContribution && !contributed) return null;
    return context;
  }

  function install(provider) {
    if (typeof provider !== "function") {
      throw new TypeError(`${boundaryLabel} provider must be a function`);
    }
    if (compositionStarted) {
      throw new Error(
        `${boundaryLabel} provider cannot be installed after ${startLabel} starts`,
      );
    }
    if (providers.includes(provider)) {
      throw new Error(`${boundaryLabel} provider is already installed`);
    }
    if (providers.length >= MAX_COMPONENT_CONTEXT_PROVIDERS) {
      throw new RangeError(`${boundaryLabel} provider limit reached`);
    }
    providers.push(provider);
  }

  return Object.freeze({ compose, install });
}
