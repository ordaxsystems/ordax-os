import {
  PRODUCT_CONNECTOR_SCHEMA,
  assertProductConnectorPort,
  validateProductConnectorSnapshot,
} from "../../contracts/product-connector.mjs";

const ENDPOINT = "/__ordax/native/product-connector";

export async function createNativeProductConnector(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Connector requires same-origin fetch");
  }

  const request = async (method, enabled) => {
    const options = {
      method, credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json" },
    };
    if (method === "POST") {
      if (typeof enabled !== "boolean") throw new TypeError("Connector opt-in must be boolean");
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ enabled });
    }
    const response = await windowRef.fetch(ENDPOINT, options);
    if (!response.ok) {
      const error = new Error("Native Connector request rejected");
      error.status = response.status;
      throw error;
    }
    const snapshot = validateProductConnectorSnapshot(await response.json());
    if (method === "POST" && snapshot.enabled !== enabled) {
      throw new TypeError("Connector state differs from the requested policy");
    }
    return snapshot;
  };
  const port = Object.freeze({
    schema: PRODUCT_CONNECTOR_SCHEMA,
    status: () => request("GET"),
    configure: (enabled) => request("POST", enabled),
  });
  assertProductConnectorPort(port);
  await port.status();
  return port;
}
