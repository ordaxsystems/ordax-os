/**
 * Ephemeral page boundaries for restoring the member's place after a confirmed
 * server mutation. IDs/cursors come only from validated membership pages.
 * No account data is persisted outside the mounted Surface.
 */
export function createMemberPageAnchors() {
  /** @type {Map<string, string | null>} */
  let cursors = new Map();

  return Object.freeze({
    /**
     * @param {{ cursor: string | null, members: readonly { userId: string }[], append: boolean }} page
     */
    record({ cursor, members, append }) {
      if ((cursor !== null && (typeof cursor !== "string" || !cursor))
        || !Array.isArray(members) || typeof append !== "boolean") {
        throw new TypeError("Invalid member page anchor");
      }
      const next = append ? new Map(cursors) : new Map();
      for (const member of members) {
        if (typeof member?.userId !== "string" || !member.userId || next.has(member.userId)) {
          throw new TypeError("Member page anchors must contain unique user IDs");
        }
        next.set(member.userId, cursor);
      }
      cursors = next;
    },
    /** @param {string} userId */
    cursorFor(userId) {
      return cursors.get(userId) ?? null;
    },
    reset() {
      cursors.clear();
    },
  });
}
