#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveNativeServiceUpdateReadiness } from "../system/services/components/service-update-readiness.mjs";
import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import { deriveNativeServiceUpdateInventory } from "../system/services/components/service-update-inventory.mjs";
import { coreRuntimeCompatibility } from "../system/services/components/compatibility/core.mjs";
import { deriveServiceCompatibilityCoverage } from "../system/services/components/service-upgrade-preflight.mjs";

const servicesUrl = new URL("../system/services/", import.meta.url);
const base = fileURLToPath(servicesUrl);

const servicePaths = readdirSync(base, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => "system/services/" + entry.name);

const inventory = deriveNativeServiceUpdateInventory({
  manifests: listSystemComponents(),
  servicePaths,
});

// A single source policy, read from the repository: no duplicate list of services
// or manually-maintained release gates in the audit.
const packagePolicy = JSON.parse(readFileSync(
  new URL("../docs/contracts/runtime-component-package.json", import.meta.url), "utf8",
));
const readiness = deriveNativeServiceUpdateReadiness({ inventory, packagePolicy });
const compatibility = deriveServiceCompatibilityCoverage({
  manifests: listSystemComponents(),
  descriptors: coreRuntimeCompatibility,
});

if (process.argv.includes("--check")) {
  process.stdout.write(
    "Service update inventory: " + inventory.summary.domainCount + " source domains, "
    + inventory.summary.componentCount + " declared components, "
    + inventory.summary.embeddedDomainCount + " embedded domains; "
    + readiness.summary.packagingCandidates + " package-policy candidates; "
    + compatibility.summary.declared + " validated compatibility descriptors; "
    + "production evidence " + readiness.summary.productionEvidence + ".\n"
  );
} else {
  process.stdout.write(JSON.stringify({ inventory, readiness, compatibility }, null, 2) + "\n");
}
