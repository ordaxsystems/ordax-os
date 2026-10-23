import assert from "node:assert/strict";
import { test } from "node:test";
import { createSurfaceBootScreen } from "../system/surface/ui/boot-screen.mjs";

class FakeElement {
  constructor() {
    this.hidden = false;
    this.dataset = {};
    this.textContent = "";
    this.attributes = new Map();
    this.status = null;
  }

  querySelector(selector) {
    return selector === "[data-ordax-boot-status]" ? this.status : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

globalThis.Element = FakeElement;

function fixture() {
  const root = new FakeElement();
  root.status = new FakeElement();
  const document = {
    querySelector(selector) {
      return selector === "#ordax-boot-screen" ? root : null;
    },
  };
  return { root, controller: createSurfaceBootScreen(document) };
}

test("Native Surface boot overlay closes at ready without a second stage or keyboard event", () => {
  const { root, controller } = fixture();
  assert.equal(controller.setStage("Carregando"), true);
  assert.equal(root.hidden, false);
  assert.equal(controller.ready(), true);
  assert.equal(root.hidden, true);
  assert.equal(root.dataset.state, "ready");
  assert.equal(root.attributes.get("aria-hidden"), "true");
  assert.equal(controller.isFinished(), true);
  assert.equal(controller.setStage("Another stage"), false);
  assert.equal(controller.ready(), false);
});

test("real bootstrap failure keeps a visible error instead of acknowledging health", () => {
  const { root, controller } = fixture();
  assert.equal(controller.fail("Não foi possível iniciar a interface"), true);
  assert.equal(root.dataset.state, "error");
  assert.equal(root.hidden, false);
  assert.equal(root.status.textContent, "Não foi possível iniciar a interface");
  assert.equal(controller.isFinished(), false);
});
