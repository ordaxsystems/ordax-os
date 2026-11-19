import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSourceText } from "./read-source-text.mjs";

test("source-contract assertions are identical for LF and CRLF checkouts", t => {
  const dir = mkdtempSync(join(tmpdir(), "ordax-source-eol-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "fixture.sql");
  writeFileSync(file, "first\r\nsecond\r\nthird\n");
  assert.equal(readSourceText(file), "first\nsecond\nthird\n");
});
