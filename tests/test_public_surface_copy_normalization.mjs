import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripGeneratedSurfaceCopy } from "../tools/public-site/generated_copy.mjs";

test("generated Surface copy is stripped exactly once on LF and CRLF inputs", () => {
  const original = '  const start = true;\n  // BEGIN GENERATED SURFACE COPY\n  register("example", "Texto", "Text");\n  // END GENERATED SURFACE COPY\n  STATIC_PAIRS.forEach(() => {});\n';
  const expected = '  const start = true;\n  STATIC_PAIRS.forEach(() => {});\n';
  assert.equal(stripGeneratedSurfaceCopy(original), expected);
  assert.equal(stripGeneratedSurfaceCopy(original.replaceAll("\n", "\r\n")), expected);
  assert.equal(stripGeneratedSurfaceCopy(expected), expected);
  assert.throws(() => stripGeneratedSurfaceCopy("  // END GENERATED SURFACE COPY\n"), /Unbalanced/);
  assert.throws(() => stripGeneratedSurfaceCopy("  // BEGIN GENERATED SURFACE COPY\n"), /Unbalanced/);
});

test("canonical public catalog has exactly one balanced generated Surface copy block", () => {
  const source = readFileSync(new URL("../sites/public/i18n/catalog.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal((source.match(/^  \/\/ BEGIN GENERATED SURFACE COPY$/gm) ?? []).length, 1);
  assert.equal((source.match(/^  \/\/ END GENERATED SURFACE COPY$/gm) ?? []).length, 1);
  assert.match(stripGeneratedSurfaceCopy(source), /STATIC_PAIRS\.forEach/);
});
