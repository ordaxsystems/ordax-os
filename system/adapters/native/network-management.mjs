import { readNativeSession } from "./session-read.mjs";

import {
  NETWORK_MANAGEMENT_SCHEMA,
  assertNetworkManagementPort,
  validateNetworkManagementSnapshot,
  validateWifiCredentials,
} from "../../contracts/network-management.mjs";


const NETWORK_ENDPOINT = "/__ordax/native/network-management";
const TOKEN_HEADER = "X-OrdaX-Network-Token";

// Keep transport/protocol failures distinct from WPA and DHCP errors. Never
// expose fetch exceptions, SSIDs, credentials or native response bodies.
function nativeNetworkFailure(reason) {
  const error = new Error("Native Wi-Fi request did not yield a verified result");
  error.networkReason = reason;
  return error;
}

async function readNetworkToken(windowRef) {
  let response;
  try {
    response = await readNativeSession(windowRef);
  } catch {
    throw nativeNetworkFailure("network-session-unavailable");
  }
  if (!response.ok || typeof response.payload?.networkToken !== "string"
      || response.payload.networkToken.length < 16) {
    throw nativeNetworkFailure("network-session-unavailable");
  }
  return response.payload.networkToken;
}

async function fetchNetwork(windowRef, options) {
  try {
    return await windowRef.fetch(NETWORK_ENDPOINT, options);
  } catch {
    // A failed localhost transport cannot be interpreted as wrong Wi-Fi credentials.
    // Never replay a possibly accepted POST after a transport failure.
    throw nativeNetworkFailure("network-host-unreachable");
  }
}

export async function createNativeNetworkManagement(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native network management adapter requires window.fetch");
  }

  let token = await readNetworkToken(windowRef);

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
    let response = await fetchNetwork(windowRef, options);
    if (response.status === 403) {
      // The Native host can restart while First Run remains open, rotating
      // its independent network grant. 403 occurs before any Wi-Fi action;
      // retry only when an authenticated session supplies a DIFFERENT token.
      // Do not repeat an action that reached the broker (409/503/timeout).
      const refreshedToken = await readNetworkToken(windowRef);
      if (refreshedToken !== token) {
        token = refreshedToken;
        options.headers[TOKEN_HEADER] = token;
        response = await fetchNetwork(windowRef, options);
      }
    }
    if (!response.ok) {
      const error = new Error(`Native network management request failed: ${response.status}`);
      error.status = response.status;
      if (method === "POST" && [400, 409, 503].includes(response.status)) {
        // Only allowlisted, non-secret reason codes cross the Native boundary.
        try {
          const body = await response.json();
          if (["authentication-failed", "dhcp-failed", "supplicant-start-failed",
               "network-owner-unavailable", "dhcp-runtime-unavailable",
               "scan-failed", "connect-failed", "reconnect-failed",
               "saved-network-unavailable",
               "network-broker-unavailable",
               "network-broker-timeout", "network-broker-io-failed",
               "wifi-tools-unavailable", "no-wifi-interface",
               "credential-save-failed",
               "network-request-invalid", "invalid-credentials",
               "network-native-response-invalid"].includes(body?.reason)) {
            error.networkReason = body.reason;
          }
        } catch {
          // A legacy empty response remains a bounded generic failure.
        }
      }
      if (!error.networkReason && response.status === 400) {
        // Old/empty Native error bodies still mean the request was rejected
        // before the broker. Never invent a WPA or password failure.
        error.networkReason = "network-request-invalid";
      }
      if (!error.networkReason && response.status === 503) {
        error.networkReason = "network-native-failure";
      }
      if (response.status === 404) {
        error.networkReason = "network-endpoint-unavailable";
      }
      throw error;
    }
    // A successful native operation may still return an unreadable snapshot.
    // Report missing confirmation separately; never replay a connection POST.
    try {
      return validateNetworkManagementSnapshot(await response.json());
    } catch {
      throw nativeNetworkFailure("network-snapshot-invalid");
    }
  };

  const port = {
    schema: NETWORK_MANAGEMENT_SCHEMA,
    status() {
      return request("GET");
    },
    scan() {
      return request("POST", "scan");
    },
    connect(credentials) {
      const value = validateWifiCredentials(credentials);
      return request("POST", "connect", value);
    },
    disconnect() {
      return request("POST", "disconnect");
    },
    forget() {
      return request("POST", "forget");
    },
    reconnect() {
      return request("POST", "reconnect");
    },
  };

  assertNetworkManagementPort(port);
  const first = await port.status();
  // Status is meaningful for diagnostics, but this is not an operational
  // management capability until a real WLAN control broker exists.
  if (first.wifiInterface === null) {
    throw new Error("Native Wi-Fi management unavailable: no WLAN interface");
  }
  return Object.freeze(port);
}
