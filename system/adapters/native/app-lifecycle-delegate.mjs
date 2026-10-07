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
      return validateAppLifecycleRequestResultForRequest(
        await response.json(),
        plan.request,
      );
    },
  });

  return assertAppLifecycleDelegate(delegate);
}
