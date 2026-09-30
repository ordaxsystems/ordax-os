import test from "node:test";
import assert from "node:assert/strict";

import {
  DEVICE_ACTION_RECEIPT_SCHEMA,
  DEVICE_ACTION_REQUEST_SCHEMA,
  OPERATIONAL_EVENT_SCHEMA,
  OPERATIONAL_SUBSCRIPTION_SCHEMA,
  validateAuthorizedDeviceActionRequest,
  validateDeviceActionReceipt,
  validateDeviceActionRequest,
  validateOperationalEvent,
  validateOperationalSubscription,
} from "../system/contracts/operational-realtime.mjs";

function event(overrides = {}) {
  return {
    schema: OPERATIONAL_EVENT_SCHEMA,
    eventId: "evt-001",
    accountId: "account-1",
    spaceId: "space-print",
    projectId: "project-job-1",
    domain: "fabrication.jobs",
    aggregateType: "print-job",
    aggregateId: "job-42",
    eventType: "print.progress",
    sequence: 21,
    revision: 5,
    occurredAt: 1000,
    sourceKind: "device",
    sourceId: "printer-01",
    payload: { progressPercent: 62, remainingSeconds: 4440 },
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    schema: DEVICE_ACTION_REQUEST_SCHEMA,
    actionId: "action-001",
    idempotencyKey: "idem-001",
    accountId: "account-1",
    spaceId: "space-print",
    projectId: "project-job-1",
    deviceId: "printer-01",
    client: "ordax-mobile",
    capability: "printer.job.pause",
    operation: "pause",
    parameters: { jobId: "job-42" },
    requestedAt: 2000,
    expiresAt: 8000,
    expectedDeviceRevision: 7,
    ...overrides,
  };
}

test("operational events use server sequence and bounded Space-scoped domain identity", () => {
  const value = validateOperationalEvent(event());
  assert.equal(value.domain, "fabrication.jobs");
  assert.equal(value.sequence, 21);
  assert.equal(value.revision, 5);
  assert.equal(value.spaceId, "space-print");

  assert.throws(() => validateOperationalEvent(event({ sequence: 0 })), /sequence/);
  assert.throws(
    () => validateOperationalEvent(event({ payload: { token: "secret-value" } })),
    /credential-like/,
  );
});

test("subscriptions resume from server sequence and cannot subscribe without a domain", () => {
  assert.deepEqual(
    validateOperationalSubscription({
      schema: OPERATIONAL_SUBSCRIPTION_SCHEMA,
      accountId: "account-1",
      spaceId: "space-food",
      projectId: null,
      domains: ["business.production", "business.orders"],
      afterSequence: 99,
      limit: 100,
    }),
    {
      schema: OPERATIONAL_SUBSCRIPTION_SCHEMA,
      accountId: "account-1",
      spaceId: "space-food",
      projectId: null,
      domains: ["business.orders", "business.production"],
      afterSequence: 99,
      limit: 100,
    },
  );

  assert.throws(
    () => validateOperationalSubscription({
      schema: OPERATIONAL_SUBSCRIPTION_SCHEMA,
      accountId: "account-1",
      spaceId: "space-food",
      domains: [],
    }),
    /domains/,
  );
});

test("device action request is typed, expiring and credential-safe", () => {
  const value = validateDeviceActionRequest(action());
  assert.equal(value.client, "ordax-mobile");
  assert.equal(value.capability, "printer.job.pause");

  assert.throws(
    () => validateDeviceActionRequest(action({ capability: "shell.generic" })),
    /forbidden/,
  );
  assert.throws(
    () => validateDeviceActionRequest(action({ expiresAt: 2000 })),
    /after requestedAt/,
  );
  assert.throws(
    () => validateDeviceActionRequest(action({ parameters: { authorization: "Bearer x" } })),
    /credential-like/,
  );
});

test("device action requires exact approved Device Agent write grant", () => {
  const request = action();
  const grant = {
    accountId: "account-1",
    spaceId: "space-print",
    projectId: "project-job-1",
    deviceId: "printer-01",
    client: "ordax-mobile",
    capability: "printer.job.pause",
    mode: "write",
    approved: true,
  };

  assert.equal(validateAuthorizedDeviceActionRequest(request, grant).actionId, "action-001");
  assert.throws(
    () => validateAuthorizedDeviceActionRequest(request, { ...grant, deviceId: "printer-02" }),
    /deviceId/,
  );
  assert.throws(
    () => validateAuthorizedDeviceActionRequest(request, { ...grant, mode: "read", approved: false }),
    /approved write grant/,
  );
});

test("device action receipts distinguish accepted from completed state", () => {
  const accepted = validateDeviceActionReceipt({
    schema: DEVICE_ACTION_RECEIPT_SCHEMA,
    actionId: "action-001",
    deviceId: "printer-01",
    state: "accepted",
    acceptedAt: 2200,
    completedAt: null,
    deviceRevision: 8,
    resultCode: null,
    message: "Aguardando execução no dispositivo",
  });
  assert.equal(accepted.state, "accepted");

  const done = validateDeviceActionReceipt({
    schema: DEVICE_ACTION_RECEIPT_SCHEMA,
    actionId: "action-001",
    deviceId: "printer-01",
    state: "succeeded",
    acceptedAt: 2200,
    completedAt: 2400,
    deviceRevision: 9,
    resultCode: "ok",
    message: "Pausa confirmada",
  });
  assert.equal(done.state, "succeeded");
});
