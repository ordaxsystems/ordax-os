import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_MEMBERS_PAGE_SCHEMA,
  SPACE_MEMBERS_TRANSPORT_PAGE_SIZE,
  parseSpaceMembersReadQuery,
  projectSpaceMembersPage,
} from "../infra/supabase/functions/_shared/space_members_read.mjs";
import { createWebSpaceMembersRead } from "../system/adapters/web/space-members.mjs";

const SPACE_ID = "11111111-1111-4111-8111-111111111111";
const memberId = (index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

function row(index, overrides = {}) {
  return {
    space_id: SPACE_ID,
    user_id: memberId(index),
    role: index === 1 ? "owner" : "member",
    state: "active",
    ...overrides,
  };
}

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}

test("Space members transport query is exact and UUID-bound", () => {
  const parsed = parseSpaceMembersReadQuery(new URL(
    `https://ordax.invalid/account/space-members?spaceId=${SPACE_ID}&cursor=${memberId(5)}`,
  ));
  assert.deepEqual(parsed, { spaceId: SPACE_ID, cursor: memberId(5) });

  assert.throws(
    () => parseSpaceMembersReadQuery(new URL("https://ordax.invalid/account/space-members")),
    /spaceId is required/,
  );
  assert.throws(
    () => parseSpaceMembersReadQuery(new URL(
      `https://ordax.invalid/account/space-members?spaceId=${SPACE_ID}&spaceId=${SPACE_ID}`,
    )),
    /spaceId must be one UUID/,
  );
  assert.throws(
    () => parseSpaceMembersReadQuery(new URL(
      `https://ordax.invalid/account/space-members?spaceId=${SPACE_ID}&role=admin`,
    )),
    /Unsupported Space members query field role/,
  );
});

test("Space members transport page is bounded and keyset-paginated", () => {
  const rows = Array.from({ length: SPACE_MEMBERS_TRANSPORT_PAGE_SIZE + 1 }, (_, index) => row(index + 1));
  const page = projectSpaceMembersPage(rows, SPACE_ID);
  assert.equal(page.schema, SPACE_MEMBERS_PAGE_SCHEMA);
  assert.equal(page.members.length, SPACE_MEMBERS_TRANSPORT_PAGE_SIZE);
  assert.equal(page.nextCursor, memberId(SPACE_MEMBERS_TRANSPORT_PAGE_SIZE));
  assert.equal(page.members[0].role, "owner");
  assert.equal(page.members.at(-1).userId, page.nextCursor);

  const finalPage = projectSpaceMembersPage([row(90)], SPACE_ID);
  assert.equal(finalPage.nextCursor, null);
});

test("Space members transport rejects malformed or cross-Space provider rows", () => {
  assert.throws(
    () => projectSpaceMembersPage([row(1, { role: "manager" })], SPACE_ID),
    /Invalid Space member row/,
  );
  assert.throws(
    () => projectSpaceMembersPage([row(1, { state: "removed" })], SPACE_ID),
    /Invalid Space member row/,
  );
  assert.throws(
    () => projectSpaceMembersPage([row(1, { space_id: memberId(999) })], SPACE_ID),
    /Invalid Space member row/,
  );
});

test("Web Space members adapter performs only bounded same-origin GET", async () => {
  const calls = [];
  const adapter = createWebSpaceMembersRead({
    fetch: async (path, options) => {
      calls.push([path, options]);
      return response({
        schema: SPACE_MEMBERS_PAGE_SCHEMA,
        spaceId: SPACE_ID,
        members: [{ spaceId: SPACE_ID, userId: memberId(1), role: "owner", state: "active" }],
        nextCursor: memberId(1),
      });
    },
  });
  try {
    const page = await adapter.listMembers({ spaceId: SPACE_ID, cursor: memberId(0) });
    assert.equal(page.members.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0][0],
      `/account/space-members?spaceId=${encodeURIComponent(SPACE_ID)}&cursor=${encodeURIComponent(memberId(0))}`,
    );
    assert.equal(calls[0][1].method, "GET");
    assert.equal(calls[0][1].credentials, "same-origin");
    assert.equal(calls[0][1].cache, "no-store");
  } finally {
    adapter.dispose();
  }
});

test("Web Space members adapter fails closed on transport and malformed pages", async () => {
  const unavailable = createWebSpaceMembersRead({ fetch: async () => response({}, 503) });
  await assert.rejects(() => unavailable.listMembers({ spaceId: SPACE_ID }), /read failed: 503/);
  unavailable.dispose();

  const malformed = createWebSpaceMembersRead({
    fetch: async () => response({
      schema: SPACE_MEMBERS_PAGE_SCHEMA,
      spaceId: SPACE_ID,
      members: [{ spaceId: SPACE_ID, userId: memberId(1), role: "owner", state: "removed" }],
      nextCursor: null,
    }),
  });
  await assert.rejects(() => malformed.listMembers({ spaceId: SPACE_ID }), /state is invalid/);
  malformed.dispose();
});
