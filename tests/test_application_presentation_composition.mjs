import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { INSTALLED_APPLICATION_SCHEMA } from "../system/contracts/installed-application.mjs";
import { createInstalledApplicationCatalog } from "../system/services/apps/installed-catalog.mjs";
import { composeApplicationPresentations } from "../system/surface/ui/application-presentations.mjs";

function installed(id = "installed-example") {
  return {
    schema: INSTALLED_APPLICATION_SCHEMA,
    id,
    title: "Example",
    description: "Installed app",
    monogram: "EX",
    origin: {
      platform: "windows",
      source: "local-file",
      payloadSha256: "b".repeat(64),
      publisher: null,
    },
    launch: {
      kind: "compatibility-profile",
      profileId: "profile-example",
      runtimeId: "wine-runtime",
      entrypointId: "main",
    },
    lifecycle: {
      installState: "installed",
      uninstallable: true,
      updateMode: "unknown",
    },
    trust: {
      nativeTrust: false,
      runtimeGrantsTrust: false,
    },
  };
}

test("first-party and installed apps share one presentation list without sharing trust class", () => {
  const catalog = createInstalledApplicationCatalog([installed()]);
  const presentations = composeApplicationPresentations(listFirstPartyApps(), catalog);
  const firstParty = presentations.find((app) => app.id === "files");
  const foreign = presentations.find((app) => app.id === "installed-example");

  assert.ok(firstParty);
  assert.ok(foreign);
  assert.equal(firstParty.sourceClass, "first-party");
  assert.equal(firstParty.compatibilityManaged, false);
  assert.equal(foreign.sourceClass, "installed");
  assert.equal(foreign.platform, "windows");
  assert.equal(foreign.compatibilityManaged, true);
  assert.equal(foreign.detailDisclosure, "compatibility-runtime");
});

test("installed application cannot shadow a first-party launcher identity", () => {
  const catalog = createInstalledApplicationCatalog([installed("files")]);
  assert.throws(
    () => composeApplicationPresentations(listFirstPartyApps(), catalog),
    /id collision/,
  );
});

test("presentation composer has no install or launch authority", () => {
  const catalog = createInstalledApplicationCatalog([installed()]);
  const presentations = composeApplicationPresentations(listFirstPartyApps(), catalog);
  assert.equal(typeof presentations.install, "undefined");
  assert.equal(typeof presentations.launch, "undefined");
});
