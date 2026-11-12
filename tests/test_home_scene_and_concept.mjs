import assert from "node:assert/strict";
import test from "node:test";
import { resolveHomeScene } from "../system/services/surface/home-scene.mjs";
import {
  handleHomePreviewClick,
  handleHomePreviewKeyDown,
  homeConceptSections,
} from "../system/surface/ui/home-concept.mjs";

function utc(hour, minute = 0) {
  return new Date(Date.UTC(2026, 9, 20, hour, minute));
}

test("shared Home scene uses local time-zone boundaries for greeting and day/night art", () => {
  assert.deepEqual(resolveHomeScene(utc(8, 59), "America/Sao_Paulo"), {
    period: "night",
    greetingId: "shell.home.greeting.evening",
  });
  assert.deepEqual(resolveHomeScene(utc(9, 0), "America/Sao_Paulo"), {
    period: "day",
    greetingId: "shell.home.greeting.morning",
  });
  assert.deepEqual(resolveHomeScene(utc(15, 0), "America/Sao_Paulo"), {
    period: "day",
    greetingId: "shell.home.greeting.afternoon",
  });
  assert.deepEqual(resolveHomeScene(utc(21, 0), "America/Sao_Paulo"), {
    period: "night",
    greetingId: "shell.home.greeting.evening",
  });
  assert.deepEqual(resolveHomeScene(utc(10, 0), "Asia/Tokyo"), {
    period: "night",
    greetingId: "shell.home.greeting.evening",
  });
});

test("Central Home examples remain labelled and provide the existing real destinations", () => {
  const labels = (key) => "translated:" + key;
  const icons = Object.fromEntries(
    ["studio", "apps", "networkWifi", "account", "clock", "folder", "system", "home"]
      .map((name) => [name, "icon-" + name]),
  );
  const sections = homeConceptSections(labels, icons);
  assert.match(sections.continuation, /data-home-example="resume"/);
  assert.match(sections.status, /data-home-copy="shell\.home\.preview\.badge"/);
  assert.match(sections.status, /data-quick-panel-toggle="network"/);
  assert.match(sections.status, /data-launch-app="system" data-app-target="storage"/);
  assert.match(sections.status, /data-launch-app="system" data-app-target="updates"/);
  assert.match(sections.currentSpace, /data-launch-app="account" data-app-target="spaces"/);
  assert.match(sections.recent, /data-home-preview-notice/);
  assert.match(sections.activity, /data-home-preview-notice/);
});

test("Home suggestions, preview notice, Escape dismissal and keyboard submission stay local", () => {
  const input = { value: "", focused: false, focus() { this.focused = true; } };
  const feedbackText = { textContent: "" };
  const feedback = {
    hidden: true,
    setAttribute(name) { if (name === "hidden") this.hidden = true; },
    querySelector() { return feedbackText; },
  };
  const trigger = { isConnected: true, focused: false, focus(options) { this.focused = options.preventScroll; } };
  let sent = 0;
  let root;
  const dismissButton = {
    click() {
      handleHomePreviewClick({
        target: { closest(selector) { return selector === "[data-home-preview-dismiss]" ? {} : null; } },
      }, root, localization);
    },
  };
  root = {
    querySelector(selector) {
      if (selector === "[data-native-aura-prompt]") return input;
      if (selector === "[data-home-preview-feedback]") return feedback;
      if (selector === "[data-home-preview-feedback]:not([hidden])") return feedback.hidden ? null : feedback;
      if (selector === "[data-home-preview-dismiss]") return dismissButton;
      if (selector === "[data-home-preview-send]") return { click() { sent += 1; } };
      return null;
    },
  };
  const localization = { translate(key) { return "translated:" + key; } };

  const suggestion = { dataset: { homePreviewCommand: "shell.home.preview.command.note" } };
  assert.equal(handleHomePreviewClick({
    target: { closest(selector) { return selector === "[data-home-preview-command]" ? suggestion : null; } },
  }, root, localization), true);
  assert.equal(input.value, "translated:shell.home.preview.command.note");
  assert.equal(input.focused, true);

  assert.equal(handleHomePreviewClick({
    target: { closest(selector) { return selector === "[data-home-preview-notice]" ? trigger : null; } },
  }, root, localization), true);
  assert.equal(feedback.hidden, false);
  assert.equal(feedbackText.textContent, "translated:shell.home.preview.feedback");

  assert.equal(handleHomePreviewClick({
    target: { closest(selector) { return selector === "[data-home-preview-dismiss]" ? {} : null; } },
  }, root, localization), true);
  assert.equal(feedback.hidden, true);
  assert.equal(trigger.focused, true);

  const enter = { key: "Enter", isComposing: false, target: input, prevented: false, preventDefault() { this.prevented = true; } };
  input.matches = (selector) => selector === "[data-native-aura-prompt]";
  input.value = "Criar uma nota";
  assert.equal(handleHomePreviewKeyDown(enter, root), true);
  assert.equal(enter.prevented, true);
  assert.equal(sent, 1);

  feedback.hidden = false;
  const escape = { key: "Escape", target: input, prevented: false, preventDefault() { this.prevented = true; } };
  assert.equal(handleHomePreviewKeyDown(escape, root), true);
  assert.equal(escape.prevented, true);
  assert.equal(feedback.hidden, true);
});