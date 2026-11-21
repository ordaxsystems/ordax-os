import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../public/assets/landing-accessibility.js", import.meta.url), "utf8"
);

// Run the production controller with simulated hardware media-query changes.
// No policy is reimplemented by these tests.
function mountPointerProfile({ coarse, precise }) {
  const profile = { coarse, precise };
  const listeners = { coarse: [], precise: [] };
  const queries = {
    "(any-pointer: coarse)": "coarse",
    "(any-pointer: fine)": "precise",
  };
  const stage = {
    inert: false,
    toggleAttribute(name, enabled) {
      assert.equal(name, "inert");
      this.inert = enabled;
    },
  };
  runInNewContext(source, {
    document: {
      querySelector(selector) {
        assert.equal(selector, "[data-demo-stage]");
        return stage;
      },
    },
    window: {
      matchMedia(query) {
        const kind = queries[query];
        assert.ok(kind, "unexpected pointer media query: " + query);
        return {
          get matches() { return profile[kind]; },
          addEventListener(event, callback) {
            assert.equal(event, "change");
            listeners[kind].push(callback);
          },
        };
      },
    },
  });
  return {
    stage,
    change(kind, present) {
      assert.ok(kind in profile);
      profile[kind] = present;
      for (const listener of listeners[kind]) listener();
    },
  };
}

test("touch-only compact demo leaves the focus order until expanded", () => {
  assert.equal(mountPointerProfile({ coarse: true, precise: false }).stage.inert, true);
});

test("hybrid touch and precise pointer keeps compact demo accessible", () => {
  assert.equal(mountPointerProfile({ coarse: true, precise: true }).stage.inert, false);
});

test("fine-only and no detected pointers do not disable the demo", () => {
  assert.equal(mountPointerProfile({ coarse: false, precise: true }).stage.inert, false);
  assert.equal(mountPointerProfile({ coarse: false, precise: false }).stage.inert, false);
});

test("plugging and unplugging a precise pointer updates focus eligibility", () => {
  const session = mountPointerProfile({ coarse: true, precise: false });
  assert.equal(session.stage.inert, true);
  session.change("precise", true);
  assert.equal(session.stage.inert, false);
  session.change("precise", false);
  assert.equal(session.stage.inert, true);
  session.change("coarse", false);
  assert.equal(session.stage.inert, false);
});
