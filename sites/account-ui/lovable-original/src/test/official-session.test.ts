import { describe, expect, it } from "bun:test";
import { fromCanonicalSession } from "@/lib/account/official-session";

const ok = {
  $schema: "prototype-ordax.public-identity-session/1",
  provider: "supabase",
  authenticated: true,
  status: "authenticated",
  subject: "user-id",
  email: "user@example.com",
};

describe("OrdaX verified same-origin account session", () => {
  it("uses only validated canonical sessions", () => {
    expect(fromCanonicalSession(ok)).toEqual({ status: "authenticated", email: "user@example.com" });
    expect(fromCanonicalSession({ ...ok, authenticated: false, status: "anonymous", subject: null })).toEqual({ status: "anonymous" });
  });

  it("never trusts a fake provider, schema or state", () => {
    for (const entry of [
      null, {},
      { ...ok, provider: "mock" }, { ...ok, $schema: "other/1" },
      { ...ok, subject: "" }, { ...ok, authenticated: false, status: "authenticated" },
      { ...ok, authenticated: true, status: "anonymous" },
    ]) expect(() => fromCanonicalSession(entry)).toThrow();
  });

  it("does not expose malformed or excessive identity text", () => {
    expect(fromCanonicalSession({ ...ok, email: "a".repeat(255) }))
      .toEqual({ status: "authenticated", email: null });
    expect(fromCanonicalSession({ ...ok, email: null }))
      .toEqual({ status: "authenticated", email: null });
  });
});
