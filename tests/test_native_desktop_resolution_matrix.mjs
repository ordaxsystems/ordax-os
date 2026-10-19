import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const tokensUrl = new URL("../system/surface/ui/tokens.css", import.meta.url);
const identityUrl = new URL("../system/surface/ui/identity.css", import.meta.url);
const sharedSidebarUrl = new URL("../system/surface/ui/sidebar-layout.css", import.meta.url);
const meridianUrl = new URL("../system/surface/ui/meridian.css", import.meta.url);

async function readLayoutSources() {
  const [tokens, identity, sidebar, meridian] = await Promise.all([
    readFile(tokensUrl, "utf8"),
    readFile(identityUrl, "utf8"),
    readFile(sharedSidebarUrl, "utf8"),
    readFile(meridianUrl, "utf8"),
  ]);
  return { tokens, identity, sidebar, meridian };
}

function automaticScaleRules(tokens) {
  return [...tokens.matchAll(/@media\s*\(min-width:\s*(\d+)px\)\s*and\s*\(min-height:\s*(\d+)px\)\s*\{\s*html\[data-ordax-display-scale="automatic"\]\s*\{\s*--ordax-display-scale-factor:\s*([\d.]+);\s*--ordax-display-scale-viewport-width:\s*([\d.]+)vw;\s*--ordax-display-scale-viewport-height:\s*([\d.]+)dvh;/g)]
    .map(([, width, height, factor, viewportWidth, viewportHeight]) => ({
      width: Number(width),
      height: Number(height),
      factor: Number(factor),
      viewportWidth: Number(viewportWidth),
      viewportHeight: Number(viewportHeight),
    }));
}

function automaticScaleAt(width, height, rules) {
  return rules.reduce((scale, rule) => width >= rule.width && height >= rule.height ? rule.factor : scale, 1);
}

test("automatic Meridian scale covers notebook, desktop, ultrawide, 4K, 5K and 8K viewport matrix", async () => {
  const { tokens } = await readLayoutSources();
  const rules = automaticScaleRules(tokens);
  assert.deepEqual(rules.map(({ width, height, factor }) => [width, height, factor]), [
    [2560, 1200, 1.0625],
    [3200, 1800, 1.125],
    [5120, 2160, 1.25],
  ]);

  const cases = [
    ["small desktop window", 800, 600, 1],
    ["HD notebook", 1280, 720, 1],
    ["common notebook", 1366, 768, 1],
    ["Full HD monitor", 1920, 1080, 1],
    ["ultrawide 1080p", 2560, 1080, 1],
    ["WQHD monitor", 2560, 1440, 1.0625],
    ["2560px-wide threshold", 2560, 1200, 1.0625],
    ["height threshold below 2560 tier", 2560, 1199, 1],
    ["ultrawide QHD", 3440, 1440, 1.0625],
    ["4K height-limited window", 3840, 1080, 1],
    ["3200px-wide tier before height threshold", 3200, 1799, 1.0625],
    ["3200px-wide tier threshold", 3200, 1800, 1.125],
    ["4K UHD", 3840, 2160, 1.125],
    ["4K DCI", 4096, 2160, 1.125],
    ["wide 5K", 5120, 1440, 1.0625],
    ["5120px-wide tier before height threshold", 5120, 2159, 1.125],
    ["5120px-wide tier threshold", 5120, 2160, 1.25],
    ["5K monitor", 5120, 2880, 1.25],
    ["8K monitor", 7680, 4320, 1.25],
  ];
  for (const [name, width, height, expected] of cases) {
    assert.equal(automaticScaleAt(width, height, rules), expected, name);
  }

  for (const rule of rules) {
    assert.equal(automaticScaleAt(rule.width - 1, rule.height, rules) < rule.factor, true,
      `automatic scale steps up only after the ${rule.width}×${rule.height} width threshold`);
    assert.ok(Math.abs(rule.factor * rule.viewportWidth / 100 - 1) < 0.00001,
      `${rule.width}×${rule.height} width remains fitted after scaling`);
    assert.ok(Math.abs(rule.factor * rule.viewportHeight / 100 - 1) < 0.00001,
      `${rule.width}×${rule.height} height remains fitted after scaling`);
  }
});

test("every manual and automatic scale profile preserves full viewport coverage", async () => {
  const { tokens } = await readLayoutSources();
  const profiles = [
    ["compact", 0.9, 111.111111, 111.111111],
    ["comfortable", 1.1, 90.909091, 90.909091],
    ["large", 1.2, 83.333333, 83.333333],
  ];
  for (const [name, factor, width, height] of profiles) {
    const rule = new RegExp(`html\\[data-ordax-display-scale="${name}"\\]\\s*\\{[^}]*--ordax-display-scale-factor:\\s*${factor};[^}]*--ordax-display-scale-viewport-width:\\s*${width}vw;[^}]*--ordax-display-scale-viewport-height:\\s*${height}dvh;`);
    assert.match(tokens, rule, `${name} scale keeps its matching inverse viewport dimensions`);
    assert.ok(Math.abs(factor * width / 100 - 1) < 0.00001, `${name} width fills the screen`);
    assert.ok(Math.abs(factor * height / 100 - 1) < 0.00001, `${name} height fills the screen`);
  }
  assert.match(tokens, /--ordax-display-scale-factor:\s*1;[\s\S]*?--ordax-display-scale-viewport-width:\s*100vw;[\s\S]*?--ordax-display-scale-viewport-height:\s*100dvh;/);
});

test("Meridian desktop rail and taskbar remain bounded at the narrow end of computer viewports", async () => {
  const { identity, sidebar, meridian } = await readLayoutSources();
  assert.match(identity, /\.ordax-shell\.meridian-native-workspace\s*\{\s*grid-template-columns:\s*var\(--ordax-rail-width\)\s+minmax\(0,\s*1fr\)/);
  assert.match(identity, /\.meridian-native-workspace\s*>\s*\.ordax-statusbar\s*\{\s*grid-column:\s*2;\s*grid-row:\s*2;/);
  assert.match(meridian, /grid-template-columns:minmax\(var\(--md-taskbar-side-min\),1fr\) minmax\(0,auto\) minmax\(var\(--md-taskbar-side-min\),1fr\)/);
  assert.match(identity, /\.meridian-native-workspace \.meridian-native-dock \{[^}]*min-width:0;[^}]*max-width:min\(100%,[^}]+\);[^}]*overflow-x:auto;/);
  assert.match(sidebar, /\.ordax-product-sidebar \[data-sidebar-slot="navigation"\]\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*44px;[^}]*overflow:\s*hidden;/);
  assert.match(sidebar, /\.meridian-workspace \.ordax-product-sidebar \[data-sidebar-slot="navigation"\]\s*\{[^}]*min-height:var\(--md-sidebar-nav-height\);[^}]*overflow:hidden;/);

  const expandedRail = 208;
  const sideTrackMinimum = 85;
  const taskbarPadding = 40;
  const taskbarGaps = 32;
  for (const [width, scale] of [[640, 1], [768, 1], [800, 1], [1024, 1], [1280, 1], [1366, 1], [1920, 1], [2560, 1.0625], [3440, 1.0625], [3840, 1.125], [5120, 1.25], [7680, 1.25]]) {
    const availableDockWidth = width - (expandedRail + 2 * sideTrackMinimum + taskbarPadding + taskbarGaps) * scale;
    assert.ok(availableDockWidth > 0, `${width}px viewport leaves a usable, scrollable dock track at scale ${scale}`);
  }
});
