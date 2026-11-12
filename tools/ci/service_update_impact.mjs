#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SHA = /^[0-9a-f]{40}$/;
const SERVICES_PREFIX = "system/services/";
const COMPONENTS_PREFIX = "system/services/components/";
const OWNED_EXACT = new Set([
  ".github/workflows/service-update-inventory.yml",
  "system/apps/component-catalog.mjs",
  "docs/contracts/runtime-component-package.json",
  "docs/contracts/runtime-component-trust-policy.json",
  "docs/contracts/component-update-compatibility.json",
  "sdk/app-sdk-v1/runtime-component-package-policy.json",
  "system/contracts/component-manifest.mjs",
  "system/contracts/component-update-compatibility.mjs",
  "tools/runtime-component-channel/check_production_readiness.py",
  "tools/service-update-inventory.mjs",
  "tools/ci/service_update_impact.mjs",
  "tests/test_causal_workflow_impact.mjs",
  "tools/component-package/compatibility.mjs",
  "tests/test_service_update_inventory.mjs",
  "tests/test_service_update_readiness.mjs",
  "tests/test_service_upgrade_preflight.mjs",
]);

export function classifyServiceUpdateImpact(changedPaths, baseServiceDirs, headServiceDirs) {
  if (!Array.isArray(changedPaths) || !(baseServiceDirs instanceof Set) || !(headServiceDirs instanceof Set)) {
    throw new TypeError("Service update impact requires changed paths and service directory sets");
  }
  const reasons = [];
  const directorySetChanged = (
    baseServiceDirs.size !== headServiceDirs.size
    || [...baseServiceDirs].some((path) => !headServiceDirs.has(path))
  );

  for (const path of changedPaths) {
    if (typeof path !== "string" || !path) throw new TypeError("Invalid changed path");
    if (path.startsWith(COMPONENTS_PREFIX)) {
      reasons.push(`component-owner:${path}`);
      continue;
    }
    if (path.startsWith(SERVICES_PREFIX)) {
      if (directorySetChanged) reasons.push("service-directory-set-changed");
      continue;
    }
    if (OWNED_EXACT.has(path)) reasons.push(`owned-input:${path}`);
  }

  return Object.freeze({
    required: reasons.length > 0,
    reasons: Object.freeze([...new Set(reasons.length ? reasons : ["no-service-inventory-impact"])]),
    changedPaths: Object.freeze([...changedPaths]),
  });
}

function checkedSha(value, label) {
  if (!SHA.test(value ?? "") || value === "0".repeat(40)) {
    throw new TypeError(`${label} must be a non-zero lowercase 40-hex commit`);
  }
  execFileSync("git", ["-C", ROOT, "rev-parse", "--verify", `${value}^{commit}`], { stdio: "ignore" });
  return value;
}

function changedPathsBetween(base, head) {
  const stdout = execFileSync("git", [
    "-C", ROOT, "diff", "--name-only", "--no-renames", base, head, "--",
  ], { encoding: "utf8" });
  return stdout.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
}

function serviceDirsAt(commit) {
  const stdout = execFileSync("git", [
    "-C", ROOT, "ls-tree", "-d", "--name-only", `${commit}:system/services`,
  ], { encoding: "utf8" });
  const dirs = stdout.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)
    .map((name) => `system/services/${name}`);
  for (const path of dirs) {
    if (!/^system\/services\/[a-z][a-z0-9-]*$/u.test(path)) {
      throw new TypeError(`Unexpected top-level service directory path: ${path}`);
    }
  }
  return new Set(dirs);
}

function writeOutput(result) {
  const reason = result.reasons.join(";");
  process.stdout.write(`SERVICE_UPDATE_CAUSAL_IMPACT=${result.required ? "REQUIRED" : "SKIPPED"}\n`);
  process.stdout.write(`SERVICE_UPDATE_CAUSAL_REASON=${reason}\n`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,
      `required=${result.required ? "true" : "false"}\nreason=${reason}\n`, "utf8");
  }
}

function main(argv) {
  if (argv[0] !== "classify") {
    throw new TypeError("usage: service_update_impact.mjs classify --base <sha> --head <sha>");
  }
  const baseIndex = argv.indexOf("--base");
  const headIndex = argv.indexOf("--head");
  if (baseIndex < 0 || headIndex < 0) throw new TypeError("base/head are required");
  const base = checkedSha(argv[baseIndex + 1], "base");
  const head = checkedSha(argv[headIndex + 1], "head");
  const result = classifyServiceUpdateImpact(
    changedPathsBetween(base, head), serviceDirsAt(base), serviceDirsAt(head),
  );
  writeOutput(result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`SERVICE_UPDATE_CAUSAL_IMPACT=FAIL\n${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
