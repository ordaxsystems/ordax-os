import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPublicSiteBuild,
  PUBLIC_SITE_CHANGE_PATHS,
} from "../tools/public-site/vercel_ignore_build.mjs";

const BEFORE = "a".repeat(40);
const AFTER = "b".repeat(40);

test("first Git import builds without a previous SHA or a fatal git diff", () => {
  let called = false;
  const decision = assessPublicSiteBuild("", AFTER, () => { called = true; });
  assert.deepEqual(decision, { skip: false, reason: "missing-or-invalid-commit-pair" });
  assert.equal(called, false);
});

test("missing current commit or malformed refs never silently skips a build", () => {
  for (const [prev, next] of [[BEFORE, ""], ["not-a-sha", AFTER], [BEFORE, "HEAD~1"]]) {
    assert.equal(assessPublicSiteBuild(prev, next, () => ({ status: 0 })).skip, false);
  }
});

test("no relevant changes skips the redundant deployment", () => {
  assert.deepEqual(
    assessPublicSiteBuild(BEFORE, AFTER, () => ({ status: 0 })),
    { skip: true, reason: "no-public-site-changes" },
  );
});

test("public site changes trigger a build", () => {
  assert.deepEqual(
    assessPublicSiteBuild(BEFORE, AFTER, () => ({ status: 1 })),
    { skip: false, reason: "public-site-changed" },
  );
});

test("unavailable Git history and unexpected errors cause a build, never a fatal ignore step", () => {
  for (const result of [{ status: 128 }, { status: null, error: new Error("git unavailable") }]) {
    assert.deepEqual(
      assessPublicSiteBuild(BEFORE, AFTER, () => result),
      { skip: false, reason: "git-diff-unavailable" },
    );
  }
  assert.equal(
    assessPublicSiteBuild(BEFORE, AFTER, () => { throw new Error("failed"); }).skip,
    false,
  );
});

test("tracked paths include the published site, release owner, proxy and deployment config", () => {
  for (const path of ["sites/public", "api/account-proxy.mjs", "platform/releases/publications.json", "vercel.json"]) {
    assert.ok(PUBLIC_SITE_CHANGE_PATHS.includes(path), path);
  }
});
