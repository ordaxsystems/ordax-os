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

for (const [label, validate, make] of [
  ["device action v1", validateDeviceActionRequest, v1],
  ["device action v2", validateDeviceActionRequestV2, v2],
  ["operational event", validateOperationalEvent, event],
]) {
  test(`${label} rejects prototype-control keys at every structured depth`, () => {
    for (const key of DANGEROUS_KEYS) {
      assert.throws(() => validate(make(dangerousObject(key))), /prototype-control field/);
      assert.throws(() => validate(make({ nested: dangerousObject(key) })), /prototype-control field/);
    }
  });
}

test("ordinary structured values remain frozen own-property data", () => {
  const values = [
    validateDeviceActionRequest(v1({ nested: { safe: true } })).parameters,
    validateDeviceActionRequestV2(v2({ nested: { safe: true } })).parameters,
    validateOperationalEvent(event({ nested: { safe: true } })).payload,
  ];
  for (const value of values) {
    assert.equal(Object.isFrozen(value), true);
    assert.equal(Object.hasOwn(value, "nested"), true);
    assert.equal(Object.hasOwn(value.nested, "safe"), true);
    assert.equal(value.nested.safe, true);
  }
});
