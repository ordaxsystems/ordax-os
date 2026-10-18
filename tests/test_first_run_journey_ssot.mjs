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
  assert.doesNotMatch(wrapper,/<link[^>]+stylesheet|ordax-emulator-root/);
  let previous=-1;
  for(const owner of ["tokens.css","color-palettes.css","first-run.css","meridian.tokens.css","meridian.css"]){
    const index=html.indexOf("surface/ui/"+owner);
    assert.ok(index>previous);previous=index;
  }
});

test("First Run presentation consumes Meridian directly and adapts all canonical steps", async () => {
  const css=await readFile(new URL("../system/surface/ui/first-run.css",import.meta.url),"utf8");
  assert.doesNotMatch(css,/var\(--ordax-|repeat\(7,/);
  assert.ok(css.includes("var(--md-canvas)"));
  assert.ok(css.includes("var(--md-font)"));
  assert.ok(css.includes("grid-template-rows:auto minmax(0,1fr)"));
  assert.ok(css.includes("grid-auto-flow:column"));
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
