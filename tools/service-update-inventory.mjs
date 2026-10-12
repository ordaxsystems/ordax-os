#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import { deriveNativeServiceUpdateInventory } from "../system/services/components/service-update-inventory.mjs";

const servicesUrl = new URL("../system/services/", import.meta.url);
const base = fileURLToPath(servicesUrl);

const servicePaths = readdirSync(base, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^[a-z][a-z0-9-]*$/.test(entry.name))
  .map((entry) => "system/services/" + entry.name);

const inventory = deriveNativeServiceUpdateInventory({
  manifests: listSystemComponents(),
  servicePaths,
});

const essential = [
  "account", "components", "diagnostics", "intelligence", "local-ai",
  "memory", "notifications", "personal-ordax", "preferences", "profile-packs",
  "scheduler", "spaces", "state", "sync", "system-foundation", "update",
];
const available = new Set(inventory.domains.map((domain) => domain.path));
const missing = essential.filter((name) => !available.has("system/services/" + name));
if (missing.length > 0) {
  throw new Error("Canonical service directories missing: " + missing.join(", "));
}

if (process.argv.includes("--check")) {
  process.stdout.write(
    "Service update inventory: " + inventory.summary.domainCount + " source domains, "
    + inventory.summary.componentCount + " declared components, "
    + inventory.summary.embeddedDomainCount + " embedded domains; no independent release claimed.\n"
  );
} else {
  process.stdout.write(JSON.stringify(inventory, null, 2) + "\n");
}
