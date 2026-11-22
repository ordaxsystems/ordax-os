import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/package.mjs", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ordax-source-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "test.0" }) + "\n");
  writeFileSync(join(root, "src", "example.mjs"), "export const example = true;\n");
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

test("source handoff accepts only the byte-identical canonical provenance receipt", t => {
  const root = fixture(t);
  const build = run(root);
  assert.equal(build.status, 0, build.stderr);
  const receiptPath = join(root, "dist", "receipt.json");
  const original = readFileSync(receiptPath);
  assert.equal(run(root, "--verify").status, 0);

  for (const mutation of [
    value => { value.activationAuthorized = true; },
    value => { value.modelIncluded = true; },
    value => { value.engineIncluded = true; },
    value => { value.kind = "signed-source"; },
    value => { value.archive = "different.tar"; },
    value => { value.sha256 = "0".repeat(64); },
    value => { value.size += 1; },
    value => { value.unreviewedFlag = false; },
  ]) {
    const changed = JSON.parse(original.toString("utf8"));
    mutation(changed);
    writeFileSync(receiptPath, JSON.stringify(changed, null, 2) + "\n");
    const result = run(root, "--verify");
    assert.notEqual(result.status, 0, "Altered receipt must be rejected");
    assert.match(result.stderr, /provenance receipt is not reproducible/);
  }
  // Even rewriting the same JSON with a different byte representation is not
  // the canonical source-only handoff that the verifier originally produced.
  writeFileSync(receiptPath, JSON.stringify(JSON.parse(original.toString("utf8"))) + "\n");
  assert.notEqual(run(root, "--verify").status, 0);

  writeFileSync(receiptPath, original);
  assert.equal(run(root, "--verify").status, 0);
});

test("source handoff verification rejects tampered archive and modified inputs", t => {
  const root = fixture(t);
  assert.equal(run(root).status, 0);
  const archive = join(root, "dist", "ordax-intelligence-source-test.0.tar");
  const original = readFileSync(archive);
  const altered = Buffer.from(original);
  altered[0] ^= 1;
  writeFileSync(archive, altered);
  assert.notEqual(run(root, "--verify").status, 0);

  writeFileSync(archive, original);
  writeFileSync(join(root, "src", "example.mjs"), "export const example = false;\n");
  assert.notEqual(run(root, "--verify").status, 0);
});

test("source handoff refuses symlinks rather than silently omitting them", { skip: process.platform === "win32" }, t => {
  const root = fixture(t);
  symlinkSync("example.mjs", join(root, "src", "shadow.mjs"));
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Source package refuses symbolic links/);
});


test("source package rejects a symlinked portable source root outside the checkout", { skip: process.platform === "win32" }, t => {
  const root = fixture(t);
  const external = join(root, "external");
  mkdirSync(external);
  writeFileSync(join(external, "external.mjs"), "export const foreign = true;\n");
  rmSync(join(root, "src"), { recursive: true });
  symlinkSync("external", join(root, "src"), "dir");
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Non-regular directory forbidden.*src/);
  assert.equal(existsSync(join(root, "dist", "receipt.json")), false);
});

test("source package refuses symlinked package metadata", { skip: process.platform === "win32" }, t => {
  const root = fixture(t);
  const manifest = join(root, "package.json");
  const original = readFileSync(manifest);
  unlinkSync(manifest);
  writeFileSync(join(root, "package-source.json"), original);
  symlinkSync("package-source.json", manifest, "file");
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Non-regular file forbidden.*package\.json/);
});

test("source package refuses symlinked dist output without writing outside", { skip: process.platform === "win32" }, t => {
  const root = fixture(t);
  const external = join(root, "external");
  mkdirSync(external);
  symlinkSync("external", join(root, "dist"), "dir");
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Non-regular directory forbidden.*dist/);
  assert.equal(existsSync(join(external, "receipt.json")), false);
});

test("unsigned source handoff rejects names that classic ustar cannot represent", async t => {
  for (const filename of ["nível.mjs", "a".repeat(98) + ".mjs"]) {
    await t.test(filename, subtest => {
      const root = fixture(subtest);
      writeFileSync(join(root, "src", filename), "export const fixture = true;\n");
      const result = run(root);
      assert.notEqual(result.status, 0, "unsafe tar path must block publication");
      assert.match(result.stderr, /Unsafe or non-ASCII ustar member path/);
      assert.equal(existsSync(join(root, "dist", "receipt.json")), false);
    });
  }
});

test("unsigned source handoff refuses unrepresentable filenames with control bytes", { skip: process.platform === "win32" }, t => {
  const root = fixture(t);
  writeFileSync(join(root, "src", "line\nbreak.mjs"), "export const invalid = true;\n");
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsafe or non-ASCII ustar member path/);
  assert.equal(existsSync(join(root, "dist", "receipt.json")), false);
});

test("source handoff archive version is a safe single filename component", async t => {
  for (const version of ["../escape", "1.0.0/../../escape", "line\nbreak", "", null, "x".repeat(81)]) {
    await t.test(String(version), subtest => {
      const root = fixture(subtest);
      writeFileSync(join(root, "package.json"), JSON.stringify({ version }) + "\n");
      const result = run(root);
      assert.notEqual(result.status, 0, "unsafe version must fail before output");
      assert.match(result.stderr, /Invalid source handoff package version/);
      assert.equal(existsSync(join(root, "dist", "receipt.json")), false);
    });
  }
});

test("source package refuses an empty portable source tree", t => {
  const root = fixture(t);
  unlinkSync(join(root, "src", "example.mjs"));
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Portable source tree contains no modules/);
});


test("source handoff never follows existing or dangling archive/receipt symlinks", { skip: process.platform === "win32" }, async t => {
  for (const output of ["receipt.json", "ordax-intelligence-source-test.0.tar"]) {
    await t.test(output, subtest => {
      const root = fixture(subtest);
      mkdirSync(join(root, "dist"));
      const external = join(root, "external");
      mkdirSync(external);
      // A dangling symlink would be missed by existsSync() but is visible
      // through lstatSync() and would otherwise create a file outside dist.
      symlinkSync("../external/target", join(root, "dist", output), "file");
      const result = run(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Non-regular file forbidden/);
      assert.equal(existsSync(join(external, "target")), false);
    });
  }
});
