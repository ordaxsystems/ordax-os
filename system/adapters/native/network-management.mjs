import {
  NETWORK_MANAGEMENT_SCHEMA,
  assertNetworkManagementPort,
  validateNetworkManagementSnapshot,
  validateWifiCredentials,
} from "../../contracts/network-management.mjs";
import { NETWORK_CONNECTIVITY_ESTABLISHED_EVENT } from "../../contracts/connectivity-signal.mjs";

const SESSION_ENDPOINT = "/__ordax/native/session";
const NETWORK_ENDPOINT = "/__ordax/native/network-management";
const TOKEN_HEADER = "X-OrdaX-Network-Token";

async function readNetworkToken(windowRef) {
  const response = await windowRef.fetch(SESSION_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Native network session failed: ${response.status}`);
  const payload = await response.json();
  if (typeof payload.networkToken !== "string" || payload.networkToken.length < 16) {
    throw new Error("Native network token is unavailable");
  }
  return payload.networkToken;
}

function signalConnectivityEstablished(windowRef) {
  if (typeof windowRef.dispatchEvent !== "function") return false;
  const EventConstructor = windowRef.Event ?? globalThis.Event;
  if (typeof EventConstructor !== "function") return false;
  try {
    return windowRef.dispatchEvent(new EventConstructor(NETWORK_CONNECTIVITY_ESTABLISHED_EVENT));
  } catch {
    return false;
  }
}

export async function createNativeNetworkManagement(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native network management adapter requires window.fetch");
  }

  const token = await readNetworkToken(windowRef);

  const request = async (method, action = null, payload = {}) => {
    const options = {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: { [TOKEN_HEADER]: token },
    };
    if (method === "POST") {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ action, ...payload });
    }
    const response = await windowRef.fetch(NETWORK_ENDPOINT, options);
    if (!response.ok) {
      const error = new Error(`Native network management request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return validateNetworkManagementSnapshot(await response.json());
  };

  const port = {
    schema: NETWORK_MANAGEMENT_SCHEMA,
    status() {
      return request("GET");
    },
    scan() {
      return request("POST", "scan");
    },
    async connect(credentials) {
      const value = validateWifiCredentials(credentials);
      const snapshot = await request("POST", "connect", value);
      if (snapshot.currentSsid === value.ssid) signalConnectivityEstablished(windowRef);
      return snapshot;
    },
    disconnect() {
      return request("POST", "disconnect");
    },
    forget() {
      return request("POST", "forget");
    },
    async reconnect() {
      const snapshot = await request("POST", "reconnect");
      if (
        snapshot.currentSsid !== null
        && snapshot.savedSsid !== null
        && snapshot.currentSsid === snapshot.savedSsid
      ) {
        signalConnectivityEstablished(windowRef);
      }
      return snapshot;
    },
  };

  assertNetworkManagementPort(port);
  await port.status();
  return Object.freeze(port);
}
