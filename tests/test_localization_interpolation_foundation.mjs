import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCALIZATION_INTERPOLATION_MAX_TEXT_LENGTH,
  interpolateLocalizationMessage,
} from "../system/services/i18n/interpolation.mjs";

test("interpolation preserves text and formats finite numeric values", () => {
  assert.equal(
    interpolateLocalizationMessage("Close {app} — {count}", { app: " Files ", count: 2 }),
    "Close  Files  — 2",
  );
  assert.equal(
    interpolateLocalizationMessage("Optional:{suffix}", { suffix: "" }),
    "Optional:",
  );
});

test("missing, null and undefined values preserve placeholder identity", () => {
  assert.equal(interpolateLocalizationMessage("Hello {name}", {}), "Hello {name}");
  assert.equal(interpolateLocalizationMessage("Hello {name}", { name: null }), "Hello {name}");
  assert.equal(interpolateLocalizationMessage("Hello {name}", { name: undefined }), "Hello {name}");
});

test("only own interpolation values are consumed", () => {
  const inherited = { name: "inherited" };
  const values = Object.create(inherited);
  assert.equal(interpolateLocalizationMessage("Hello {name}", values), "Hello {name}");

  Object.defineProperty(values, "name", {
    value: "owned",
    enumerable: true,
  });
  assert.equal(interpolateLocalizationMessage("Hello {name}", values), "Hello owned");
});

test("interpolation rejects coercive value types", () => {
  const rejected = [
    true,
    false,
    1n,
    ["a"],
    { text: "a" },
    () => "a",
    Symbol("a"),
  ];
  for (const value of rejected) {
    assert.throws(
      () => interpolateLocalizationMessage("Value {value}", { value }),
      /must be text or a finite number/,
    );
  }
});

test("interpolation rejects non-finite numbers through the canonical semantic value contract", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => interpolateLocalizationMessage("Value {value}", { value }),
      /must be text or a finite number/,
    );
  }
});

test("interpolation rejects oversized text without truncating it", () => {
  const value = "x".repeat(LOCALIZATION_INTERPOLATION_MAX_TEXT_LENGTH + 1);
  assert.throws(
    () => interpolateLocalizationMessage("Value {value}", { value }),
    /exceeds 4096 UTF-16 code units/,
  );
});

test("interpolation accepts the exact text boundary", () => {
  const value = "x".repeat(LOCALIZATION_INTERPOLATION_MAX_TEXT_LENGTH);
  assert.equal(
    interpolateLocalizationMessage("{value}", { value }),
    value,
  );
});

test("interpolation values container must be an object", () => {
  for (const values of [null, "text", 3, true, []]) {
    assert.throws(
      () => interpolateLocalizationMessage("Hello {name}", values),
      /values must be an object/,
    );
  }
});

test("message text is not coerced from non-string values", () => {
  assert.throws(
    () => interpolateLocalizationMessage({ text: "Hello {name}" }, { name: "Ada" }),
    /message text must be a string/,
  );
});
