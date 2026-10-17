export const SPACE_MEMBERS_PAGE_SCHEMA = "ordax.space-members-page/1";
export const SPACE_MEMBERS_TRANSPORT_PAGE_SIZE = 64;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(["owner", "admin", "member", "viewer"]);
const STATES = new Set(["active", "suspended"]);

function singleQueryValue(searchParams, name, { required = false } = {}) {
  const values = searchParams.getAll(name);
  if (values.length === 0) {
    if (required) throw new TypeError(`${name} is required`);
    return null;
  }
  if (values.length !== 1 || !UUID.test(values[0])) {
    throw new TypeError(`${name} must be one UUID`);
  }
  return values[0].toLowerCase();
}

export function parseSpaceMembersReadQuery(url) {
  if (!(url instanceof URL)) throw new TypeError("Space members URL is required");
  for (const key of url.searchParams.keys()) {
    if (key !== "spaceId" && key !== "cursor") {
      throw new TypeError(`Unsupported Space members query field ${key}`);
    }
  }
  return Object.freeze({
    spaceId: singleQueryValue(url.searchParams, "spaceId", { required: true }),
    cursor: singleQueryValue(url.searchParams, "cursor"),
  });
}

export function projectSpaceMembersPage(rows, spaceId) {
  if (!UUID.test(spaceId) || !Array.isArray(rows) || rows.length > SPACE_MEMBERS_TRANSPORT_PAGE_SIZE + 1) {
    throw new TypeError("Invalid Space members provider response");
  }
  const validatedRows = rows.map((row) => {
    if (
      !row || typeof row !== "object" || Array.isArray(row)
      || row.space_id !== spaceId
      || typeof row.user_id !== "string" || !UUID.test(row.user_id)
      || !ROLES.has(row.role)
      || !STATES.has(row.state)
    ) {
      throw new TypeError("Invalid Space member row");
    }
    return Object.freeze({
      spaceId,
      userId: row.user_id.toLowerCase(),
      role: row.role,
      state: row.state,
    });
  });
  const members = validatedRows.slice(0, SPACE_MEMBERS_TRANSPORT_PAGE_SIZE);
  return Object.freeze({
    schema: SPACE_MEMBERS_PAGE_SCHEMA,
    spaceId: spaceId.toLowerCase(),
    members: Object.freeze(members),
    nextCursor: rows.length > SPACE_MEMBERS_TRANSPORT_PAGE_SIZE
      ? members[members.length - 1]?.userId ?? null
      : null,
  });
}
