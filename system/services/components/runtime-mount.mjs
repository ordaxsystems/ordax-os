import { validateMountedComponent } from "../../contracts/component-runtime.mjs";

function labelPrefix(label) {
  if (typeof label !== "string" || !label.trim()) {
    throw new TypeError("Component mount label must be non-empty text");
  }
  return label.trim();
}

export function assertComponentMountParent(context, { label = "Component" } = {}) {
  const prefix = labelPrefix(label);
  if (!context || typeof context !== "object" || Array.isArray(context)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(context))) {
    throw new TypeError(`${prefix} context must be a plain object`);
  }
  const hasOwnRoot = Object.prototype.hasOwnProperty.call(context, "root");
  if ("root" in context && !hasOwnRoot) {
    throw new TypeError(`${prefix} mount parent cannot be inherited`);
  }
  if (!hasOwnRoot) return context;
  const descriptor = Object.getOwnPropertyDescriptor(context, "root");
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw new TypeError(`${prefix} mount parent must be a data property`);
  }
  const parent = descriptor.value;
  if (!parent || typeof parent !== "object" || parent.nodeType !== 1
    || typeof parent.append !== "function"
    || !parent.ownerDocument
    || typeof parent.ownerDocument.createElement !== "function") {
    throw new TypeError(`${prefix} mount parent must be a Surface Element`);
  }
  return context;
}

export function createComponentMountContext(context, componentId, { label = "Component" } = {}) {
  const prefix = labelPrefix(label);
  assertComponentMountParent(context, { label: prefix });
  if (!Object.prototype.hasOwnProperty.call(context, "root")) {
    return Object.freeze({ context, releaseRoot: null });
  }
  const parent = Object.getOwnPropertyDescriptor(context, "root").value;
  const root = parent.ownerDocument.createElement("div");
  if (!root || root.nodeType !== 1 || typeof root.append !== "function"
    || typeof root.remove !== "function" || !root.dataset || !root.style
    || !root.childNodes || root.childNodes.length !== 0) {
    try { root?.remove?.(); } catch { /* invalid DOM factory output is isolated */ }
    throw new TypeError(`${prefix} mount root must be a fresh empty Element`);
  }

  let released = false;
  const releaseRoot = () => {
    if (released) return;
    released = true;
    root.remove();
  };
  const mountContext = Object.freeze({ ...context, root });
  try {
    root.className = "ordax-native-installed-component-root";
    root.dataset.ordaxComponentRoot = componentId;
    root.style.display = "contents";
    parent.append(root);
    if (root.parentNode !== parent) {
      throw new TypeError(`${prefix} mount root was not attached to its Surface`);
    }
  } catch (error) {
    try { releaseRoot(); } catch { /* mount root teardown is best effort */ }
    throw error;
  }
  return Object.freeze({ context: mountContext, releaseRoot });
}

export async function mountComponentRuntimeBounded(
  runtime,
  context,
  milliseconds,
  componentId,
  { label = "Component" } = {},
) {
  const prefix = labelPrefix(label);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 100 || milliseconds > 30_000) {
    throw new TypeError(`${prefix} timeout must be 100..30000 ms`);
  }
  let expired = false;
  let timer;
  const pending = Promise.resolve()
    .then(() => runtime.mount(context))
    .then((value) => {
      const mounted = validateMountedComponent(value, componentId);
      if (expired) {
        try { mounted.destroy(); } catch { /* app-owned cleanup is isolated */ }
        throw new Error(`${prefix} mount completed after its deadline`);
      }
      return mounted;
    });
  try {
    return await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error(`${prefix} mount timed out`));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
