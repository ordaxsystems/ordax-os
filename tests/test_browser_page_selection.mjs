import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_PAGE_SELECTION_SCHEMA,
  BROWSER_PAGE_SELECTION_PORT_SCHEMA,
  MAX_BROWSER_PAGE_SELECTION_CHARS,
  MAX_BROWSER_PAGE_QUESTION_CHARS,
  assertBrowserPageSelectionPort,
  validateBrowserPageSelection,
  browserSelectionIntelligenceRequest,
} from "../system/contracts/browser-page-selection.mjs";
import { validateIntelligenceRequest } from "../system/contracts/intelligence.mjs";

const example = Object.freeze({
  schema: BROWSER_PAGE_SELECTION_SCHEMA,
  kind: "selection",
  source: "untrusted-web-content",
  tabId: "tab-1",
  url: "https://example.org/document",
  title: "External page",
  text: "Some selected website content",
  truncated: false,
});

test("selection is bounded, frozen and identified as untrusted website data", () => {
  const result = validateBrowserPageSelection(example);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(result, example);
  assert.equal(validateBrowserPageSelection({...example, url: "https://EXAMPLE.ORG/document"}).url,
    "https://example.org/document");
});

test("selection rejects malformed, oversized, or forged data", () => {
  for (const changed of [
    {schema: "ordax.browser-page-selection/0"},
    {source: "system"}, {kind: "full-dom"}, {truncated: "false"},
    {tabId: "../host"}, {url: "file:///etc/hosts"},
    {url: "https://user:pass@example.org/"},
    {text: ""}, {text: "\0"}, {text: "x".repeat(MAX_BROWSER_PAGE_SELECTION_CHARS+1)},
    {title: "x".repeat(257)},
  ]) {
    assert.throws(() => validateBrowserPageSelection({...example,...changed}), TypeError);
  }
});

test("a separate confirmed user action is required to send to Intelligence", () => {
  assert.throws(() => browserSelectionIntelligenceRequest({
    selection:example, question:"Resuma",
  }), /explicitly confirm/);
  const request = browserSelectionIntelligenceRequest({
    selection:example, question:"Resuma", confirmed:true,
  });
  assert.equal(request.intent, "ask");
  assert.equal(request.context.length, 1);
  assert.equal(request.context[0].scope, "document");
  assert.equal(request.context[0].text, example.text);
  assert.equal(request.context[0].provenance, "ordax.internet.untrusted-selection:https://example.org");
  assert.match(request.prompt, /não confiáveis/);
  assert.deepEqual(validateIntelligenceRequest(request),request);
  assert.throws(() => browserSelectionIntelligenceRequest({
    selection: example, question:"x".repeat(MAX_BROWSER_PAGE_QUESTION_CHARS+1), confirmed:true,
  }), TypeError);
});

test("capture port is separate from privileged browser session", () => {
  const port={schema:BROWSER_PAGE_SELECTION_PORT_SCHEMA,readSelection: async()=>example,dispose(){}};
  assert.equal(assertBrowserPageSelectionPort(port),port);
  assert.throws(()=>assertBrowserPageSelectionPort({schema:BROWSER_PAGE_SELECTION_PORT_SCHEMA}),TypeError);
});
