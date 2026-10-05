import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_ACTION_REQUEST_SCHEMA,
  validateDeviceActionRequest,
} from "../system/contracts/device-action-envelope.mjs";
import {
  DEVICE_ACTION_REQUEST_V2_SCHEMA,
  validateDeviceActionRequestV2,
} from "../system/contracts/device-action-envelope-v2.mjs";
import {
  OPERATIONAL_EVENT_SCHEMA,
  validateOperationalEvent,
} from "../system/contracts/operational-realtime.mjs";

const DANGEROUS_KEYS = ["__proto__", "prototype", "constructor"];

function dangerousObject(key) {
  return JSON.parse(`{"${key}":{"polluted":true}}`);
}

function v1(parameters = {}) {
  return {
    schema: DEVICE_ACTION_REQUEST_SCHEMA,
    actionId: "action-1",
    idempotencyKey: "idem-1",
    accountId: "account-1",
    spaceId: "space-1",
    projectId: "project-1",
    deviceId: "device-1",
    client: "ordax-desktop",
    capability: "files.write",
    operation: "text.write",
    parameters,
    requestedAt: 1,
    expiresAt: 2,
    expectedDeviceRevision: null,
  };
}

function v2(parameters = {}) {
  return {
    schema: DEVICE_ACTION_REQUEST_V2_SCHEMA,
    actionId: "action-2",
    idempotencyKey: "idem-2",
    actor: { kind: "device-owner", subjectId: null },
    spaceId: null,
    projectId: null,
    deviceId: "device-1",
    client: "ordax-desktop",
    capability: "computer.windows",
    parameters,
    requestedAt: 1,
    expiresAt: 2,
    expectedDeviceRevision: null,
  };
}

function event(payload = {}) {
  return {
    schema: OPERATIONAL_EVENT_SCHEMA,
    eventId: "event-1",
    accountId: "account-1",
    spaceId: "space-1",
    projectId: null,
    domain: "studio",
    aggregateType: "action",
    aggregateId: "action-1",
    eventType: "action.updated",
    sequence: 1,
    revision: 1,
    occurredAt: 1,
    sourceKind: "server",
    sourceId: "gateway-1",
    payload,
  };
}

test("device action v1 rejects prototype-control keys at every structured depth", () => {
  for (const key of DANGEROUS_KEYS) {
    assert.throws(() => validateDeviceActionRequest(v1(dangerousObject(key))), /prototype-control field/);
    assert.throws(
      () => validateDeviceActionRequest(v1({ nested: dangerousObject(key) })),
      /prototype-control field/,
    );
  }
});

test("device action v2 rejects prototype-control keys at every structured depth", () => {
  for (const key of DANGEROUS_KEYS) {
    assert.throws(() => validateDeviceActionRequestV2(v2(dangerousObject(key))), /prototype-control field/);
    assert.throws(
      () => validateDeviceActionRequestV2(v2({ nested: dangerousObject(key) })),
      /prototype-control field/,
    );
  }
});

test("operational event payload rejects prototype-control keys at every structured depth", () => {
  for (const key of DANGEROUS_KEYS) {
    assert.throws(() => validateOperationalEvent(event(dangerousObject(key))), /prototype-control field/);
    assert.throws(
      () => validateOperationalEvent(event({ nested: dangerousObject(key) })),
      /prototype-control field/,
    );
  }
});

test("ordinary structured values remain frozen own-property data", () => {
  const validatedV1 = validateDeviceActionRequest(v1({ nested: { safe: true } }));
  const validatedV2 = validateDeviceActionRequestV2(v2({ nested: { safe: true } }));
  const validatedEvent = validateOperationalEvent(event({ nested: { safe: true } }));

  for (const value of [validatedV1.parameters, validatedV2.parameters, validatedEvent.payload]) {
    assert.equal(Object.isFrozen(value), true);
    assert.equal(Object.hasOwn(value, "nested"), true);
    assert.equal(Object.hasOwn(value.nested, "safe"), true);
    assert.equal(value.nested.safe, true);
  }
});
