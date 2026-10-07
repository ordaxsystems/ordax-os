import {
  validateAppLifecyclePlan,
} from "../../contracts/app-lifecycle-plan.mjs";
import {
  validateAppLifecycleRequestResultForRequest,
} from "../../contracts/app-lifecycle-request.mjs";
import {
  APP_LIFECYCLE_DELEGATE_SCHEMA,
  assertAppLifecycleDelegate,
} from "../../services/apps/store-lifecycle-request-service.mjs";

const ENDPOINT = "/__ordax/native/store-lifecycle";
const REQUEST_OPTIONS = Object.freeze({
  method: "POST",
  cache: "no-store",
  credentials: "same-origin",
  redirect: "error",
});

const PROBATION_COMPONENT_IDS = new Set(["internet", "notes"]);
const BROWSER_BRIDGE_HANDLER = "ordaxBrowser";

function requestPostLifecycleProbation(windowRef, plan, result) {
  if (
    result.state !== "accepted"
    || !["install", "update"].includes(plan.request.operation)
    || !PROBATION_COMPONENT_IDS.has(plan.request.appId)
  ) {
    return false;
  }
  const bridge = windowRef?.webkit?.messageHandlers?.[BROWSER_BRIDGE_HANDLER] ?? null;
  if (!bridge || typeof bridge.postMessage !== "function") {
    return false;
  }
  bridge.postMessage(JSON.stringify({
    type: "component.probation.request",
    componentId: plan.request.appId,
  }));
  return true;
}

export function createNativeAppLifecycleDelegate(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native app lifecycle delegate requires window.fetch");
  }

  const delegate = Object.freeze({
    schema: APP_LIFECYCLE_DELEGATE_SCHEMA,
    authority: "platform-component-lifecycle",
    async executeLifecycle(rawPlan) {
      const plan = validateAppLifecyclePlan(rawPlan);
      const response = await windowRef.fetch(ENDPOINT, {
        ...REQUEST_OPTIONS,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(plan),
      });
      if (!response || typeof response.ok !== "boolean") {
        throw new TypeError("Native app lifecycle response is invalid");
      }
      if (!response.ok) {
        throw new Error(`Native app lifecycle unavailable: HTTP ${response.status}`);
      }
      if (typeof response.json !== "function") {
        throw new TypeError("Native app lifecycle response must implement json()");
      }
      const result = validateAppLifecycleRequestResultForRequest(
        await response.json(),
        plan.request,
      );
      try {
        requestPostLifecycleProbation(windowRef, plan, result);
      } catch (error) {
        console.warn(
          "OrdaX post-lifecycle component probation trigger unavailable; candidate remains pending-health",
          error,
        );
      }
      return result;
    },
  });

  return assertAppLifecycleDelegate(delegate);
}
