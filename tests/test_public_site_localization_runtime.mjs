import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const RUNTIME = fs.readFileSync(path.join(process.cwd(), "sites/public/i18n/runtime.js"), "utf8");

// A small browser-faithful MutationObserver fixture: assigning the SAME
// text node value creates a mutation notification (the original regression).
// Drain the microtask queue with a bounded limit so the test cannot hang.
function browserFixture(locale) {
  const queued = [];
  let characterDataWrites = 0;
  let attributeWrites = 0;
  let observer;

  class Element {
    constructor(tagName, attributes = {}, children = []) {
      this.nodeType = 1;
      this.tagName = tagName;
      this.attributes = new Map(Object.entries(attributes));
      this.children = children;
      for (const child of children) child.parentElement = this;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) {
      attributeWrites += 1;
      this.attributes.set(name, String(value));
    }
    closest() { return null; }
  }
  class TextNode {
    nodeType = 3;
    constructor(value) { this.value = value; }
    get nodeValue() { return this.value; }
    set nodeValue(value) {
      characterDataWrites += 1;
      this.value = String(value);
      if (observer) queued.push({ type: "characterData", target: this });
    }
  }

  const content = new TextNode("Entrar");
  const anchor = new Element("A", { "aria-label": "Entrar" }, [content]);
  const html = new Element("HTML", {}, [anchor]);
  const doc = {
    nodeType: 9,
    documentElement: html,
    querySelector() { return null; },
    dispatchEvent() { return true; },
    createTreeWalker(root) {
      const descendants = [];
      function visit(node) {
        for (const child of node.children ?? []) {
          descendants.push(child);
          visit(child);
        }
      }
      visit(root === doc ? html : root);
      let cursor = 0;
      return { nextNode() { return descendants[cursor++] ?? null; } };
    },
  };
  const catalog = {
    schema: "prototype-ordax.public-site-localization/1",
    sourceLocale: "pt-BR",
    supportedLocales: ["pt-BR", "en-US"],
    sourceIndex: { Entrar: "nav.login" },
    messages: {
      "pt-BR": { "nav.login": "Entrar" },
      "en-US": { "nav.login": "Sign in" },
    },
  };
  const window = { OrdaXPublicI18nCatalog: catalog };
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observer = this; }
  }

  vm.runInNewContext(RUNTIME, {
    window, document: doc,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_NODE: 9 },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    navigator: { languages: [locale], language: locale },
    localStorage: { getItem: () => null, setItem() {} },
    MutationObserver: FakeMutationObserver,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  }, { filename: "sites/public/i18n/runtime.js" });

  function flush() {
    let deliveries = 0;
    while (queued.length) {
      if (++deliveries > 12) {
        throw new Error("localization-MutationObserver-infinite-feedback-loop");
      }
      observer.callback(queued.splice(0));
    }
    return deliveries;
  }
  return {
    window, content, anchor, flush,
    get writes() { return characterDataWrites; },
    get attributes() { return attributeWrites; },
  };
}

test("initial pt-BR source copy does not schedule no-op DOM mutations", () => {
  const browser = browserFixture("pt-BR");
  assert.equal(browser.content.nodeValue, "Entrar");
  assert.equal(browser.writes, 0);
  assert.equal(browser.attributes, 0);
  assert.equal(browser.flush(), 0);
});

test("en-US translation generates at most one mutation, never a feedback loop", () => {
  const browser = browserFixture("en-US");
  assert.equal(browser.content.nodeValue, "Sign in");
  assert.equal(browser.anchor.getAttribute("aria-label"), "Sign in");
  assert.equal(browser.flush(), 0); // the initial translation runs before observe()
  assert.equal(browser.writes, 1);
  assert.equal(browser.attributes, 1);
  browser.window.OrdaXPublicI18n.setLocale("en-US");
  assert.equal(browser.flush(), 0);
  assert.equal(browser.writes, 1);
  assert.equal(browser.attributes, 1);
});

test("locale switching flushes the mutation queue and keeps clicks unblocked", () => {
  const browser = browserFixture("pt-BR");
  browser.window.OrdaXPublicI18n.setLocale("en-US");
  assert.equal(browser.content.nodeValue, "Sign in");
  assert.equal(browser.flush(), 1);
  const writesAfterEnglish = browser.writes;
  browser.window.OrdaXPublicI18n.setLocale("en-US");
  assert.equal(browser.flush(), 0);
  assert.equal(browser.writes, writesAfterEnglish);
  browser.window.OrdaXPublicI18n.setLocale("pt-BR");
  assert.equal(browser.content.nodeValue, "Entrar");
  assert.equal(browser.flush(), 1);
  assert.equal(browser.writes, writesAfterEnglish + 1);
});
