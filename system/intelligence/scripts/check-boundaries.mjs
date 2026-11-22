import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { collectPortableSourceFiles } from "./source-tree.mjs";
const files = collectPortableSourceFiles();
// The OS owns both its Intelligence source pin and the engine/model lock.
// Ignore generated output, dependencies, and the explicitly checked-out OS
// upstream; inspect every first-party source/documentation path only once.
const excludedRoots = new Set([".git", "_upstream", "node_modules", "dist"]);
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (directory === "." && excludedRoots.has(entry.name)) continue;
    const target = join(directory, entry.name);
    if (entry.name === "source-lock.json") {
      throw new Error(`Secondary source lock forbidden: ${target}; OrdaX OS is the authority`);
    }
    if (entry.isDirectory()) visit(target);
  }
}
visit(".");
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const executable = source.split("\n").filter(line => !line.trimStart().startsWith("// Source:")).join("\n");
  for (const forbidden of ["../../contracts/", "system/services/", "system/contracts/", "node:fs", "node:net", "node:child_process"]) {
    if (executable.includes(forbidden)) throw new Error(`Forbidden private import in ${file}: ${forbidden}`);
  }
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
console.log(`Verified ${files.length} portable module(s)`);
