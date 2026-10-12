import test from "node:test";
import assert from "node:assert/strict";
import { mountSidebarHints } from "../system/surface/ui/sidebar-hints.mjs";

// EventTarget harness exercises presentation events, not browser state or storage.
class Element extends EventTarget {
  constructor(document, tag, rect = { top: 40, height: 44, right: 64, width: 64 }) {
    super(); this.ownerDocument = document; this.tag = tag;
    this.rect = rect; this.attributes = new Map(); this.children = []; this.style = {};
  }
  append(child) { child.parent = this; this.children.push(child); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  hasAttribute(key) { return this.attributes.has(key); }
  removeAttribute(key) { this.attributes.delete(key); }
  closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag); }
  contains(element) { return !!element && (element === this || this.children.some(child => child.contains(element))); }
  getBoundingClientRect() { return this.rect; }
}
function harness() {
  const document = new EventTarget();
  document.defaultView = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844 });
  document.createElement = tag => new Element(document, tag, { width: 90, height: 32 });
  const host = new Element(document, "div");
  const sidebar = new Element(document, "aside");
  const button = new Element(document, "button");
  const icon = new Element(document, "svg");
  button.setAttribute("title", "Ajustes"); button.append(icon); sidebar.append(button);
  const hints = mountSidebarHints(host, sidebar);
  const hint = host.children[0];
  function fire(type, fields = {}, target = icon) {
    const event = new Event(type);
    Object.defineProperty(event, "target", { value: target });
    Object.assign(event, fields); sidebar.dispatchEvent(event);
  }
  return { document, host, sidebar, button, icon, hints, hint, fire };
}
test("pointer names appear synchronously, stay across icon children and restore native titles on exit", () => {
  const h = harness();
  h.fire("pointerover", { pointerType: "mouse" });
  assert.equal(h.hint.hidden, false);
  assert.equal(h.hint.textContent, "Ajustes");
  assert.equal(h.hint.style.left, "72px");
  assert.equal(h.button.getAttribute("title"), null);
  h.fire("pointerout", { relatedTarget: h.icon });
  assert.equal(h.hint.hidden, false);
  h.fire("pointerout", { relatedTarget: null });
  assert.equal(h.hint.hidden, true);
  assert.equal(h.button.getAttribute("title"), "Ajustes");
  h.hints.destroy();
});
test("keyboard hint preserves existing descriptions and Escape restores the button", () => {
  const h = harness(); h.button.setAttribute("aria-describedby", "original-help");
  h.fire("focusin", {}, h.button);
  assert.equal(h.hint.hidden, false);
  assert.equal(h.button.getAttribute("aria-describedby"), `original-help ${h.hint.id}`);
  const escape = new Event("keydown"); escape.key = "Escape";
  h.document.dispatchEvent(escape);
  assert.equal(h.hint.hidden, true);
  assert.equal(h.button.getAttribute("aria-describedby"), "original-help");
  h.hints.destroy();
});
test("touch, disabled controls and expanded sidebars do not display redundant hints", () => {
  const h = harness(); h.fire("pointerover", { pointerType: "touch" });
  assert.equal(h.hint.hidden, true);
  h.fire("pointerdown", { pointerType: "touch" }); h.fire("focusin", {}, h.button);
  assert.equal(h.hint.hidden, true);
  const tab = new Event("keydown"); tab.key = "Tab"; h.document.dispatchEvent(tab);
  h.button.disabled = true; h.fire("focusin", {}, h.button);
  assert.equal(h.hint.hidden, true);
  h.button.disabled = false; h.sidebar.rect.width = 192;
  h.fire("pointerover", { pointerType: "mouse" });
  assert.equal(h.hint.hidden, true);
  h.hints.destroy();
});
test("destroy releases the hint and handlers without overwriting a refreshed localized title", () => {
  const h = harness(); h.fire("focusin", {}, h.button);
  h.button.setAttribute("title", "Settings"); h.hints.destroy();
  assert.equal(h.host.children.length, 0);
  assert.equal(h.button.getAttribute("title"), "Settings");
  h.fire("focusin", {}, h.button);
  assert.equal(h.button.getAttribute("aria-describedby"), null);
  assert.equal(h.hint.hidden, true);
});
