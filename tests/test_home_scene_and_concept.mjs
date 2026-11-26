import assert from "node:assert/strict";
import test from "node:test";
import { resolveHomeScene } from "../system/services/surface/home-scene.mjs";
import { homeStatusNeedsAttention } from "../system/surface/ui/home-status.mjs";
import {
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

test("Home overview uses actual Native network, account, storage and Space routes", () => {
  const t = (key) => "translated:" + key;
  const icons = Object.fromEntries(
    ["networkWifi", "account", "clock", "folder", "system", "home"]
      .map((name) => [name, "icon-" + name]),
  );
  const { status, currentSpace } = homeConceptSections(t, icons);
  assert.match(status, /data-home-status-value="internet"/);
  assert.match(status, /data-home-status-value="updates"/);
  assert.match(status, /data-quick-panel-toggle="network"/);
  assert.match(status, /data-launch-app="system" data-app-target="storage"/);
  assert.match(currentSpace, /data-launch-app="account" data-app-target="spaces"/);
  assert.doesNotMatch(status + currentSpace, /data-home-example|data-home-preview-notice/);
  assert.doesNotMatch(currentSpace, /ordax-home-space-art|ordax-home-space-open/);
  assert.equal((currentSpace.match(/data-app-target="spaces"/g) ?? []).length, 1,
    "the Space card has exactly one canonical action");
  assert.match(status, /data-home-status-toggle aria-controls="ordax-home-status-details" aria-expanded="false"/);
  assert.match(status, /data-home-status-details hidden/);
  assert.match(status, /data-home-status-value="updates"/);
});

test("Home health disclosure highlights actual problems and keeps healthy detail optional", () => {
  const ready = {
    internet: { state: "success" },
    account: { state: "success" },
    sync: { state: "neutral" },
    storage: { state: "success" },
    updates: { state: "success" },
  };
  const sources = { network: "ready", account: "ready", sync: "ready", storage: "ready", updates: "ready" };
  assert.equal(homeStatusNeedsAttention(ready, sources), false);
  assert.equal(homeStatusNeedsAttention({ ...ready, internet: { state: "warning" } }, sources), true);
  assert.equal(homeStatusNeedsAttention({ ...ready, updates: { state: "pending" } }, sources), true);
  assert.equal(homeStatusNeedsAttention(ready, { ...sources, account: "unavailable" }), true);
  assert.equal(homeStatusNeedsAttention(ready, { ...sources, network: "loading" }), false);
});

test("real windows share one state and Home never invents recent activities", async () => {
  const { readFile } = await import("node:fs/promises");
  const shell = await readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8");
  const surface = await readFile(new URL("../system/surface/ui/surface.mjs", import.meta.url), "utf8");
  assert.match(shell, /data-home-running-windows[^>]*hidden/);
  assert.match(shell, /data-home-running-list/);
  assert.match(surface, /const renderHomeWindows = \(area\) => \{/);
  assert.match(surface, /const open = area\.windows\.filter/);
  assert.match(surface, /renderHomeWindows\(area\);/);
  assert.match(surface, /!runningButton\.hasAttribute\("data-home-open-window"\)/,
    "Home window buttons restore or focus without using the dock minimize behavior");
  assert.match(surface, /const runningButton = event\.target\.closest\("\[data-open-window\]"\)/);
  assert.doesNotMatch(shell, /data-home-scene|data-home-example|data-native-store-catalog-preview="home"/);
});
