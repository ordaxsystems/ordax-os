import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_MEMBERS_PAGE_SCHEMA,
  SPACE_MEMBERS_READ_SCHEMA,
  assertSpaceMembersReadPort,
  validateSpaceMember,
  validateSpaceMembersListRequest,
  validateSpaceMembersPage,
} from "../system/contracts/space-members.mjs";
import {
  SPACES_PORT_SCHEMA,
  SPACES_SNAPSHOT_SCHEMA,
} from "../system/contracts/spaces.mjs";
import { createSpaceMembersReader } from "../system/services/spaces/members.mjs";

const SPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function spacesPort(state = "ready", spaces = null) {
  const snapshot = Object.freeze({
    schema: SPACES_SNAPSHOT_SCHEMA,
    state,
    spaces: Object.freeze(spaces ?? (state === "ready" ? [{
      id: SPACE_ID,
      name: "Members test",
      kind: "professional",
      state: "active",
      ownerId: USER_ID,
      profilePack: "pizzaria-br@1",
      domain: "food",
      subtype: "pizzeria",
    }] : [])),
  });
  return Object.freeze({
    schema: SPACES_PORT_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
    async refresh() {
      return snapshot;
    },
    reset() {},
  });
}

function membersPort(handler) {
  return Object.freeze({
    schema: SPACE_MEMBERS_READ_SCHEMA,
    listMembers: handler,
  });
}

function page(spaceId = SPACE_ID, extra = {}) {
  return {
    schema: SPACE_MEMBERS_PAGE_SCHEMA,
    spaceId,
    members: [{
      spaceId,
      userId: USER_ID,
      role: "owner",
      state: "active",
    }],
    nextCursor: null,
    ...extra,
  };
}

test("Space member projection reuses canonical membership roles and adds lifecycle state", () => {
  assert.deepEqual(validateSpaceMember({
    spaceId: SPACE_ID,
    userId: USER_ID,
    role: "admin",
    state: "suspended",
  }), {
    spaceId: SPACE_ID,
    userId: USER_ID,
    role: "admin",
    state: "suspended",
  });
  assert.throws(() => validateSpaceMember({
    spaceId: SPACE_ID,
    userId: USER_ID,
    role: "manager",
    state: "active",
  }), /role is invalid/);
  assert.throws(() => validateSpaceMember({
    spaceId: SPACE_ID,
    userId: USER_ID,
    role: "member",
    state: "removed",
  }), /state is invalid/);
});

test("Space members pages are bounded, single-Space and duplicate-free", () => {
  const value = validateSpaceMembersPage(page());
  assert.equal(value.spaceId, SPACE_ID);
  assert.equal(value.members.length, 1);

  assert.throws(() => validateSpaceMembersPage(page(SPACE_ID, {
    members: [{
      spaceId: "33333333-3333-4333-8333-333333333333",
      userId: USER_ID,
      role: "member",
      state: "active",
    }],
  })), /another Space/);

  assert.throws(() => validateSpaceMembersPage(page(SPACE_ID, {
    members: [
      { spaceId: SPACE_ID, userId: USER_ID, role: "member", state: "active" },
      { spaceId: SPACE_ID, userId: USER_ID, role: "viewer", state: "active" },
    ],
  })), /duplicate users/);
});

test("Space members list request is exact and cursor remains opaque", () => {
  assert.deepEqual(validateSpaceMembersListRequest({
    spaceId: `  ${SPACE_ID}  `,
    cursor: "opaque-page-cursor",
  }), {
    spaceId: SPACE_ID,
    cursor: "opaque-page-cursor",
  });
  assert.throws(() => validateSpaceMembersListRequest({
    spaceId: SPACE_ID,
    role: "admin",
  }), /unsupported field role/);
});

test("Space members read port cannot acquire mutation authority", () => {
  assert.equal(assertSpaceMembersReadPort(membersPort(async () => page())).schema, SPACE_MEMBERS_READ_SCHEMA);
  assert.throws(() => assertSpaceMembersReadPort({
    schema: SPACE_MEMBERS_READ_SCHEMA,
    listMembers: async () => page(),
    removeMember() {},
  }), /must not implement removeMember/);
});

test("members reader refuses unavailable or stale Space targets before transport", async () => {
  let calls = 0;
  const port = membersPort(async () => {
    calls += 1;
    return page();
  });

  await assert.rejects(
    () => createSpaceMembersReader({ spaces: spacesPort("loading", []), members: port }).list({ spaceId: SPACE_ID }),
    /catalog is not ready/,
  );
  await assert.rejects(
    () => createSpaceMembersReader({ spaces: spacesPort("ready", []), members: port }).list({ spaceId: SPACE_ID }),
    /not present in the current authorized Spaces catalog/,
  );
  assert.equal(calls, 0);
});

test("members reader validates provider Space and preserves pagination cursor", async () => {
  let received = null;
  const reader = createSpaceMembersReader({
    spaces: spacesPort(),
    members: membersPort(async (request) => {
      received = request;
      return page(SPACE_ID, { nextCursor: "next-page" });
    }),
  });
  const result = await reader.list({ spaceId: SPACE_ID, cursor: "page-1" });
  assert.deepEqual(received, { spaceId: SPACE_ID, cursor: "page-1" });
  assert.equal(result.nextCursor, "next-page");

  const badReader = createSpaceMembersReader({
    spaces: spacesPort(),
    members: membersPort(async () => page("44444444-4444-4444-8444-444444444444")),
  });
  await assert.rejects(() => badReader.list({ spaceId: SPACE_ID }), /another Space/);
});
