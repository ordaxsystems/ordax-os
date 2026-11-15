import assert from "node:assert/strict";
import test from "node:test";

import { NETWORK_MANAGEMENT_SCHEMA, WifiCredentialsValidationError } from "../system/contracts/network-management.mjs";
import {
  networkManagementActionMessage,
  networkManagementActionMessageId,
  networkManagementFailureMessage,
  networkManagementFailureMessageId,
  runNetworkManagementAction,
} from "../system/services/network/management-runtime.mjs";

function port(calls) {
  return {
    schema: NETWORK_MANAGEMENT_SCHEMA,
    status() { calls.push("status"); return Promise.resolve({}); },
    scan() { calls.push("scan"); return Promise.resolve({ action: "scan" }); },
    connect(value) { calls.push(["connect", value]); return Promise.resolve({ action: "connect" }); },
    disconnect() { calls.push("disconnect"); return Promise.resolve({ action: "disconnect" }); },
    forget() { calls.push("forget"); return Promise.resolve({ action: "forget" }); },
    reconnect() { calls.push("reconnect"); return Promise.resolve({ action: "reconnect" }); },
  };
}

test("shared network management runtime dispatches only explicit actions", async () => {
  const calls = [];
  const management = port(calls);
  await runNetworkManagementAction(management, "scan");
  await runNetworkManagementAction(management, "connect", { ssid: "Casa", password: "12345678" });
  await runNetworkManagementAction(management, "disconnect");
  await runNetworkManagementAction(management, "forget");
  await runNetworkManagementAction(management, "reconnect");
  assert.deepEqual(calls, [
    "scan",
    ["connect", { ssid: "Casa", password: "12345678" }],
    "disconnect",
    "forget",
    "reconnect",
  ]);
  await assert.rejects(
    runNetworkManagementAction(management, "unknown"),
    /Ação de Wi-Fi inválida/,
  );
});

test("shared network management runtime owns PT-BR action messages", () => {
  assert.equal(networkManagementActionMessage("scan", 0), "Procurando redes Wi-Fi…");
  assert.equal(networkManagementActionMessage("scan", 1), "Redes Wi-Fi atualizadas.");
  assert.equal(networkManagementActionMessage("connect", 1), "Wi-Fi conectado.");
  assert.equal(networkManagementActionMessage("forget", 1), "Rede Wi-Fi esquecida.");
  assert.throws(() => networkManagementActionMessage("unknown", 0));
});

test("shared network management runtime exposes locale-neutral presentation ids", () => {
  assert.equal(
    networkManagementActionMessageId("scan", 0),
    "network.management.scan.pending",
  );
  assert.equal(
    networkManagementActionMessageId("reconnect", 1),
    "network.management.reconnect.success",
  );
  const conflict = Object.assign(new Error("must not surface"), { status: 409 });
  assert.equal(
    networkManagementFailureMessageId("connect", conflict),
    "network.management.error.connectConflict",
  );
  assert.equal(
    networkManagementFailureMessageId("disconnect", new TypeError("invalid native snapshot")),
    "network.management.error.generic",
  );
  assert.equal(
    networkManagementFailureMessageId("connect", new WifiCredentialsValidationError("invalid credentials")),
    "network.management.error.validation",
  );
  assert.equal(
    networkManagementFailureMessage("connect", new TypeError("native snapshot invalid")),
    "A ação de Wi-Fi não pôde ser concluída. A rede anterior foi preservada quando aplicável.",
  );
});

test("network failures distinguish WPA, DHCP and controller issues without secrets", () => {
  for (const [reason, status, kind, phrase] of [
    ["authentication-failed", 409, "authentication", "autenticação WPA"],
    ["dhcp-failed", 409, "dhcp", "DHCP"],
    ["supplicant-start-failed", 503, "supplicant", "serviço de autenticação"],
    ["network-owner-unavailable", 503, "ownerUnavailable", "controlador Wi-Fi"],
  ]) {
    const error = Object.assign(new Error("private"), { status, networkReason: reason });
    assert.equal(networkManagementFailureMessageId("connect", error), "network.management.error." + kind);
    assert.equal(networkManagementFailureMessageId("reconnect", error), "network.management.error." + kind);
    const message = networkManagementFailureMessage("connect", error);
    assert.ok(message.includes(phrase));
    assert.equal(message.includes("private"), false);
  }
  const untrusted = Object.assign(new Error("private"), { status: 409, networkReason: "raw-wpa-secret" });
  assert.equal(networkManagementFailureMessageId("connect", untrusted), "network.management.error.connectConflict");
});

test("shared network management runtime maps bounded failures without secrets", () => {
  const rejected = Object.assign(new Error("server detail that must not surface"), { status: 409 });
  assert.equal(
    networkManagementFailureMessage("connect", rejected),
    "Não foi possível conectar. Confira a senha e se a rede ainda está disponível.",
  );
  const message = networkManagementFailureMessage("disconnect", new Error("secret text"));
  assert.equal(
    message,
    "A ação de Wi-Fi não pôde ser concluída. A rede anterior foi preservada quando aplicável.",
  );
  assert.equal(message.includes("secret text"), false);
});
