// Ephemeral UI retry receipts, never an authorization decision or persistent member record.
// Server-side idempotency remains authoritative. The scope prevents cross-account/Space reuse.
/** @param {() => string} makeId */
export function createScopedMemberActionAttempts(makeId) {
  if (typeof makeId !== "function") throw new TypeError("An idempotency key factory is required");
  const attempts = new Map();

  return Object.freeze({
    /** @param {{subjectId: string, spaceId: string, action: string, targetUserId: string, role?: string | null}} request */
    begin({ subjectId, spaceId, action, targetUserId, role = null }) {
      for (const value of [subjectId, spaceId, action, targetUserId]) {
        if (typeof value !== "string" || value.length === 0) {
          throw new TypeError("An authenticated, scoped membership action is required");
        }
      }
      const scope = JSON.stringify([subjectId, spaceId, action, targetUserId, role]);
      let idempotencyKey = attempts.get(scope);
      if (!idempotencyKey) {
        idempotencyKey = makeId();
        if (typeof idempotencyKey !== "string" || !idempotencyKey) {
          throw new TypeError("A valid idempotency key is required");
        }
        attempts.set(scope, idempotencyKey);
      }
      // Capturing the exact key prevents an old completion from removing a newer retry.
      const issuedKey = idempotencyKey;
      return Object.freeze({
        idempotencyKey: issuedKey,
        confirm() {
          if (attempts.get(scope) === issuedKey) attempts.delete(scope);
        },
      });
    },
    clear() {
      attempts.clear();
    },
  });
}
