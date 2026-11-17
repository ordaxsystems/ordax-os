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
    ["dhcp-runtime-unavailable", 503, "dhcpRuntime", "Componentes nativos de DHCP"],
    ["scan-failed", 503, "scanFailed", "busca de redes"],
    ["connect-failed", 409, "connectFailure", "O motivo específico"],
    ["reconnect-failed", 409, "reconnectFailure", "rede salva"],
    ["saved-network-unavailable", 409, "noSavedNetwork", "Não há uma rede Wi-Fi salva"],
    ["network-broker-unavailable", 503, "brokerUnavailable", "serviço nativo"],
    ["network-broker-timeout", 503, "brokerTimeout", "demorou demais"],
    ["network-broker-io-failed", 503, "brokerIo", "falhou ao acessar"],
    ["wifi-tools-unavailable", 503, "wifiTools", "ferramentas Wi-Fi"],
    ["no-wifi-interface", 503, "noInterface", "interface Wi-Fi"],
    ["credential-save-failed", 503, "credentialSave", "não pôde ser salva"],
  ]) {
    const error = Object.assign(new Error("private"), { status, networkReason: reason });
    assert.equal(networkManagementFailureMessageId("connect", error), "network.management.error." + kind);
    assert.equal(networkManagementFailureMessageId("reconnect", error), "network.management.error." + kind);
    const message = networkManagementFailureMessage("connect", error);
    assert.ok(message.includes(phrase));
    assert.equal(message.includes("private"), false);
  }
  const expired = Object.assign(new Error("private"), { status: 403 });
  assert.equal(networkManagementFailureMessageId("connect", expired), "network.management.error.sessionUnavailable");
  assert.ok(networkManagementFailureMessage("connect", expired).includes("sessão nativa"));
  const scan = Object.assign(new Error("private"), { status: 503, networkReason: "scan-failed" });
  assert.equal(networkManagementFailureMessageId("scan", scan), "network.management.error.scanFailed");
  assert.equal(networkManagementFailureMessage("scan", scan).includes("private"), false);
  const untrusted = Object.assign(new Error("private"), { status: 409, networkReason: "raw-wpa-secret" });
  assert.equal(networkManagementFailureMessageId("connect", untrusted), "network.management.error.connectConflict");
});

test("first-use differentiates rejected Native HTTP input before WPA or DHCP", () => {
  for (const [reason, kind, phrase] of [
    ["network-request-invalid", "requestInvalid", "antes de acessar o Wi-Fi"],
    ["invalid-credentials", "invalidCredentials", "antes de tentar conectar"],
    ["network-native-response-invalid", "snapshotInvalid", "estado Wi-Fi inválido"],
  ]) {
    const error = Object.assign(new Error("secret-not-for-ui"), { status: reason === "network-native-response-invalid" ? 503 : 400, networkReason: reason });
    assert.equal(networkManagementFailureMessageId("connect", error), "network.management.error." + kind);
    assert.ok(networkManagementFailureMessage("connect", error).includes(phrase));
    assert.equal(networkManagementFailureMessage("connect", error).includes("secret-not-for-ui"), false);
  }
});

test("first-use reports Native transport, missing endpoint and snapshot failures without exposing secrets", () => {
  for (const [reason, kind, expected] of [
    ["network-session-unavailable", "sessionUnavailable", "sessão nativa"],
    ["network-host-unreachable", "hostUnreachable", "serviço nativo"],
    ["network-endpoint-unavailable", "endpointUnavailable", "não oferece esta operação"],
    ["network-native-failure", "nativeFailure", "sem informar a etapa"],
    ["network-snapshot-invalid", "snapshotInvalid", "estado Wi-Fi inválido"],
  ]) {
    const error = Object.assign(new Error("secret-should-never-display"), { networkReason: reason });
    assert.equal(networkManagementFailureMessageId("connect", error), "network.management.error." + kind);
    assert.equal(networkManagementFailureMessageId("scan", error), "network.management.error." + kind);
    const message = networkManagementFailureMessage("connect", error);
    assert.ok(message.includes(expected));
    assert.equal(message.includes("secret-should-never-display"), false);
  }
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
