import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_MESSAGE_MAX_CHARACTERS,
  assertNetworkMessagePlainText,
  segmentNetworkMessagePlainText,
} from "../system/contracts/network-message-content-v1.mjs";

test("accepts bounded plain text and preserves markup as inert text", () => {
  const body = "<img src=x onerror=alert(1)> texto normal";
  assert.equal(assertNetworkMessagePlainText(body), body);
  assert.deepEqual(segmentNetworkMessagePlainText(body), [
    { type: "text", text: body },
  ]);
});

test("rejects unsafe control characters while allowing normal multiline text", () => {
  assert.equal(assertNetworkMessagePlainText("linha 1\n\tlinha 2\r\n"), "linha 1\n\tlinha 2\r\n");
  for (const control of ["\u0000", "\u0001", "\u0008", "\u000b", "\u000c", "\u001f", "\u007f"]) {
    assert.throws(() => assertNetworkMessagePlainText(`antes${control}depois`));
  }
});

test("enforces the same 4000-character server bound", () => {
  assert.equal(assertNetworkMessagePlainText("a".repeat(NETWORK_MESSAGE_MAX_CHARACTERS)).length, 4000);
  assert.throws(() => assertNetworkMessagePlainText(""));
  assert.throws(() => assertNetworkMessagePlainText("a".repeat(4001)));
});

test("only http and https become links", () => {
  const body =
    "Veja https://example.com/a?q=1, http://example.org/x. " +
    "javascript:alert(1) data:text/html,test file:///tmp/x vbscript:msgbox(1)";
  assert.deepEqual(segmentNetworkMessagePlainText(body), [
    { type: "text", text: "Veja " },
    { type: "link", text: "https://example.com/a?q=1", href: "https://example.com/a?q=1" },
    { type: "text", text: "," },
    { type: "text", text: " " },
    { type: "link", text: "http://example.org/x", href: "http://example.org/x" },
    { type: "text", text: "." },
    {
      type: "text",
      text: " javascript:alert(1) data:text/html,test file:///tmp/x vbscript:msgbox(1)",
    },
  ]);
});

test("credential-bearing URLs remain inert text", () => {
  const body = "nao abrir https://user:pass@example.com/secret";
  assert.deepEqual(segmentNetworkMessagePlainText(body), [
    { type: "text", text: body },
  ]);
});
