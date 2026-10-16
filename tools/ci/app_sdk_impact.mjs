#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SHA = /^[0-9a-f]{40}$/;
const CONTRACT_PREFIX = "system/contracts/";
const OWNED_EXACT = new Set([
  ".github/workflows/app-sdk-contract.yml",
  "tools/ci/app_sdk_impact.mjs",
  "tests/test_causal_workflow_impact.mjs",
  "tests/test_app_sdk_app_data.mjs",
  "tests/test_app_sdk_application_actions.mjs",
  "tests/test_application_action_manifest.mjs",
  "tests/test_application_action_provider.mjs",
  "tests/test_app_sdk_projects_ports.mjs",
  "tests/test_app_sdk_studio_ports.mjs",
  "tests/test_app_sdk_browser_ports.mjs",
  "tests/test_app_sdk_network_draft.mjs",
  "tests/test_app_sdk_files_ports.mjs",
  "tests/test_app_sdk_assistant_public_contracts.mjs",
  "tools/verify/internet_sdk_readiness.py",
  "tests/test_internet_sdk_readiness.py",
]);
const OWNED_PREFIXES = Object.freeze([
  "sdk/app-sdk-v1/",
  "tools/app-sdk/",
  "system/apps/internet/",
]);

function collectSourcePaths(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourcePaths(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (typeof value.source_path === "string") output.add(value.source_path);
  for (const item of Object.values(value)) collectSourcePaths(item, output);
  return output;
}

export function exportedContractSources(bundleValue) {
  const paths = collectSourcePaths(bundleValue);
  if (paths.size === 0) throw new TypeError("App SDK bundle exposes no source_path entries");
  for (const path of paths) {
    if (!path.startsWith(CONTRACT_PREFIX)) {
      throw new TypeError(`App SDK source_path is outside system/contracts: ${path}`);
    }
  }
  return paths;
}

export function classifyAppSdkImpact(changedPaths, exportedSources) {
  if (!Array.isArray(changedPaths) || !(exportedSources instanceof Set)) {
    throw new TypeError("App SDK impact classification requires changed paths and exported sources");
  }
  const reasons = [];
  for (const path of changedPaths) {
    if (typeof path !== "string" || !path) throw new TypeError("Invalid changed path");
    if (path.startsWith(CONTRACT_PREFIX)) {
      if (exportedSources.has(path)) reasons.push(`exported-contract:${path}`);
      continue;
    }
    if (OWNED_EXACT.has(path) || OWNED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      reasons.push(`owned-input:${path}`);
    }
  }
  return Object.freeze({
    required: reasons.length > 0,
    reasons: Object.freeze(reasons.length ? reasons : ["no-public-app-sdk-impact"]),
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

function writeOutput(result) {
  const reason = result.reasons.join(";");
  process.stdout.write(`APP_SDK_CAUSAL_IMPACT=${result.required ? "REQUIRED" : "SKIPPED"}\n`);
  process.stdout.write(`APP_SDK_CAUSAL_REASON=${reason}\n`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,
      `required=${result.required ? "true" : "false"}\nreason=${reason}\n`, "utf8");
  }
}

function main(argv) {
  if (argv[0] !== "classify") throw new TypeError("usage: app_sdk_impact.mjs classify --base <sha> --head <sha>");
  const baseIndex = argv.indexOf("--base");
  const headIndex = argv.indexOf("--head");
  if (baseIndex < 0 || headIndex < 0) throw new TypeError("base/head are required");
  const base = checkedSha(argv[baseIndex + 1], "base");
  const head = checkedSha(argv[headIndex + 1], "head");
  const bundle = JSON.parse(readFileSync(resolve(ROOT, "sdk/app-sdk-v1/bundle.json"), "utf8"));
  writeOutput(classifyAppSdkImpact(changedPathsBetween(base, head), exportedContractSources(bundle)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`APP_SDK_CAUSAL_IMPACT=FAIL\n${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
