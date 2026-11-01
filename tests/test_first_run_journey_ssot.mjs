import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createJourneyScenarios } from "../system/surface/ui/journeys/scenarios.mjs";
import { createJourneyView } from "../system/surface/ui/journeys/view.mjs";

import { FIRST_RUN_JOURNEY, FIRST_RUN_STEP_IDS, FIRST_RUN_STEP_LABELS, getFirstRunStep } from "../system/services/first-run/journey.mjs";

const contract = JSON.parse(await readFile(new URL("../docs/contracts/first-run.json", import.meta.url), "utf8"));

test("first-run contract consumes the canonical runtime journey order", () => {
  assert.deepEqual(contract.flow, [...FIRST_RUN_STEP_IDS]);
  assert.equal(contract.owners.journey, "system/services/first-run/journey.mjs");
});

test("first-run journey identities and labels are unique and complete", () => {
  assert.deepEqual(FIRST_RUN_STEP_IDS, ["welcome", "network", "account", "security", "ready"]);
  assert.equal(new Set(FIRST_RUN_STEP_IDS).size, FIRST_RUN_STEP_IDS.length);
  assert.equal(new Set(FIRST_RUN_STEP_LABELS).size, FIRST_RUN_STEP_LABELS.length);
  assert.equal(FIRST_RUN_JOURNEY.length, FIRST_RUN_STEP_IDS.length);
  for (const step of FIRST_RUN_JOURNEY) {
    assert.equal(getFirstRunStep(step.id), step);
    assert.equal(typeof step.domain, "string");
    assert.ok(step.domain.length > 0);
  }
});

test("optional and skippable semantics live with canonical step metadata", () => {
  assert.equal(getFirstRunStep("network").skippable, true);
  assert.equal(getFirstRunStep("security").optional, true);
  assert.equal(getFirstRunStep("account").optional, true);
  assert.throws(() => getFirstRunStep("unknown"), /Unknown first-run step/);
});

test("emulator loads the Native composition without owning another UI or first-run", async () => {
  const read=path=>readFile(new URL("../"+path,import.meta.url),"utf8");
  const [native,emulator,html,wrapper]=await Promise.all([
    read("system/composition/native/main.mjs"),read("tools/windows-emulator/main.mjs"),
    read("system/composition/native/index.html"),read("tools/windows-emulator/index.html"),
  ]);
  assert.ok(native.includes('mountFirstRunExperience(root,'));
  assert.ok(emulator.includes('"/system/composition/native/index.html"'));
  assert.ok(wrapper.includes('data-surface-src="/system/composition/native/index.html"'));
  assert.doesNotMatch(emulator,/mountFirstRunExperience|createEmulatedPreferences|composition\/web|preview=layout/);
  const wrapperStyles = [...wrapper.matchAll(/<link[^>]+href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(wrapperStyles, ["/system/surface/ui/meridian.tokens.css"], "development chrome may share tokens, never product render styles");
  assert.doesNotMatch(wrapper,/ordax-emulator-root/);
  let previous=-1;
  for(const owner of ["tokens.css","color-palettes.css","first-run.css","meridian.tokens.css","meridian.css"]){
    const index=html.indexOf("surface/ui/"+owner);
    assert.ok(index>previous);previous=index;
  }
});

test("installed Windows refuses to mount Surface without an authenticated Native local-session port", async () => {
  const native = await readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8");
  const durableBootstrap = native.indexOf("requireDurableRead: windowsDesktopHost");
  const resolved = native.indexOf("const [preferenceStore, firstRunStateStore, localSession, bundledProfilePacks]");
  const guard = native.indexOf("if (windowsDesktopHost && localSession === null)");
  assert.ok(durableBootstrap > 0 && durableBootstrap < resolved,
    "installed Windows must verify the durable first-run receipt before mounting Surface");
  const mounted = native.indexOf("const surface = mountSurface(");
  assert.ok(resolved > 0 && guard > resolved && mounted > guard,
    "Windows must fail closed before rendering the Surface, not after a healthy mount");
  assert.match(native.slice(guard, mounted),
    /throw new Error\("Windows Native local session unavailable; Surface remains locked"\)/);
  assert.match(native, /const localSessionPromise = optionalNativeProbe\(/,
    "non-Windows devices must keep their existing optional local-session capability");
});

test("First Run presentation consumes Meridian directly and adapts all canonical steps", async () => {
  const css=await readFile(new URL("../system/surface/ui/first-run.css",import.meta.url),"utf8");
  assert.doesNotMatch(css,/var\(--ordax-|repeat\(7,/);
  assert.ok(css.includes("var(--md-canvas)"));
  assert.ok(css.includes("var(--md-font)"));
  assert.match(css, /\.ordax-first-run-card\s*\{[^}]*grid-template-rows\s*:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(css, /\.ordax-first-run-steps\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /@container\s*\(max-width:\s*900px\)/);
  assert.match(css, /@container\s*\(max-width:\s*600px\)/);
  assert.match(css, /\.ordax-first-run-shell\s*\{[^}]*min-width:\s*0/s);
  assert.doesNotMatch(css, /@media\s*\(max-width:/);
});

test("optional network work never blocks the first-run journey", async () => {
  const ui = await readFile(new URL("../system/surface/ui/first-run.mjs", import.meta.url), "utf8");
  assert.match(ui, /const busy = identityPending !== null \|\| identityAvailabilityPending \|\| localSessionPending \|\| deviceNamePending;/);
  assert.match(ui, /scan\.disabled = networkPending;/);
  assert.match(ui, /connect\.disabled = networkPending;/);
  assert.match(ui, /validateWifiCredentials\(\{ ssid, password \}\)/);
  assert.ok(ui.indexOf("validateWifiCredentials({ ssid, password })") < ui.indexOf("void connectNetwork(ssid, password)", ui.indexOf("validateWifiCredentials({ ssid, password })")));
});

test("runtime journeys cannot expose another first-run; planned design details remain archived", async () => {
  for (const locale of ["pt-BR", "en-US"]) {
    assert.equal(Object.hasOwn(createJourneyScenarios(locale).storyboards, "setup"), false);
  }
  const archive = JSON.parse(await readFile(new URL("../docs/evidence/first-run-ssot-2026-10-17/setup-design-reference.json", import.meta.url), "utf8"));
  assert.equal(archive.status, "REFERENCE_ONLY");
  assert.equal(archive.supersededBy, "system/surface/ui/first-run.mjs");
  for (const design of Object.values(archive.locales)) {
    for (const planned of ["keyboard", "network-connecting", "identity-error", "save-error"]) {
      assert.ok(design.screens[planned], "Preserve planned reference: " + planned);
    }
    assert.throws(() => createJourneyView().journeyView("setup", design, {}, {}, {}), /First Run setup is owned/);
    assert.throws(() => createJourneyView().journeyFrame("", "", true, "setup"), /First Run setup is owned/);
  }
});
