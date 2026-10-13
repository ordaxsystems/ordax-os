import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { sha256HexUtf8 } from "../system/services/intelligence/sha256.mjs";

test("browser-safe capability SHA-256 matches native FIPS implementation", () => {
  const vectors = ["", "abc", "😀", "OrdaX: Salvador", "a".repeat(55),
    "a".repeat(56), "a".repeat(64), "a".repeat(1024),
    "🥥".repeat(999), JSON.stringify({b:[3,"🌎"],a:1})];
  for (const value of vectors) {
    assert.equal(sha256HexUtf8(value), createHash("sha256").update(value).digest("hex"));
  }
  assert.throws(() => sha256HexUtf8({}), TypeError);
  assert.throws(() => sha256HexUtf8("a".repeat(1024*1024+1)), RangeError);
});

test("all boot-critical native ES module imports resolve in WebKit without Node builtins", () => {
  // SourceTextModule parses real static import/export declarations, including
  // multiline imports; regex matching in string literals would be unsafe.
  const script = String.raw`
    import { SourceTextModule } from "node:vm";
    import { readFileSync, statSync, existsSync } from "node:fs";
    import { dirname, resolve, sep } from "node:path";
    const repo = process.cwd();
    const system = resolve(repo, "system") + sep;
    const root = resolve(repo, "system/composition/native/main.mjs");
    const visited = new Set();
    const queue = [root];
    while (queue.length) {
      const file = queue.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      const source = readFileSync(file,"utf8");
      const module = new SourceTextModule(source, { identifier: file });
      for (const specifier of module.dependencySpecifiers) {
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
          throw new Error("Native boot module has browser-incompatible specifier " + specifier
            + " in " + file.slice(system.length));
        }
        const resolved = resolve(dirname(file), specifier);
        if (!resolved.startsWith(system) || !existsSync(resolved) ||
            !statSync(resolved).isFile()) {
          throw new Error("Native boot module import is absent or unsafe: " + specifier);
        }
        queue.push(resolved);
      }
    }
    if (visited.size < 100) throw new Error("Native entry graph audit is unexpectedly incomplete");
    process.stdout.write("NATIVE_ESM_CLOSURE_PASS=" + visited.size);
  `;
  const result = spawnSync(process.execPath, ["--no-warnings", "--experimental-vm-modules", "--input-type=module", "-e", script], {
    cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /NATIVE_ESM_CLOSURE_PASS=[1-9][0-9]{2,}/);
});
