import { validateComponentId } from "../../contracts/component-manifest.mjs";
import { createComponentContextProviderRegistry } from "./context-provider-registry.mjs";

export const COMPONENT_PROBATION_CONTEXT_SCHEMA =
  "ordax.component-probation-context/1";

const registry = createComponentContextProviderRegistry({
  label: "Component probation context",
  startDescription: "component probation",
  returnNullWithoutContribution: true,
});

function validateTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) {
    throw new TypeError("Component probation context timeout must be 100..30000 ms");
  }
  return value;
}

export function installComponentProbationContextProvider(provider) {
  registry.install(provider);
}

export async function composeComponentProbationContext(
  componentIdValue,
  {
    context = Object.freeze({}),
    timeoutMs = 5_000,
  } = {},
) {
  const componentId = validateComponentId(componentIdValue);
  const limit = validateTimeout(timeoutMs);
  let timer = null;
  try {
    return await Promise.race([
      registry.compose(componentId, context),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Component probation context composition timed out"));
        }, limit);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
