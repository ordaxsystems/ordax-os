import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import {
  inspectProfileContentPackHealth,
  validateProfileContentPack,
} from "../system/contracts/profile-content-pack.mjs";

const digest = (value) =>
  createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");

const source = {
  uri: "https://example.invalid/source",
  revision: "rev-1",
  license: "test-only",
  jurisdiction: "BR",
  title: "Fonte de teste",
};

test("Knowledge Pack requires per-entry content hash and provenance", () => {
  const content = "Texto jurídico de teste.";
  const pack = validateProfileContentPack({
    schema: "ordax.profile-content-pack/1",
    kind: "knowledge-pack",
    entries: [{
      id: "legal.example",
      mediaType: "text/plain",
      content,
      contentSha256: digest(content),
      source,
    }],
  });
  assert.equal(pack.entries.length, 1);
  assert.equal(pack.entries[0].source.jurisdiction, "BR");

  const health = inspectProfileContentPackHealth(pack, "knowledge-pack");
  assert.equal(health.state, "healthy");
  assert.equal(health.perEntryHashVerified, true);
  assert.equal(health.perEntryProvenanceVerified, true);
  assert.equal(health.executablePayloadAllowed, false);
});

test("Knowledge Pack rejects stale hash and executable media types", () => {
  const content = "conteúdo";
  const stale = {
    schema: "ordax.profile-content-pack/1",
    kind: "knowledge-pack",
    entries: [{
      id: "legal.example",
      mediaType: "text/plain",
      content,
      contentSha256: "a".repeat(64),
      source,
    }],
  };
  assert.throws(() => validateProfileContentPack(stale), /does not match content/);

  stale.entries[0].contentSha256 = digest(content);
  stale.entries[0].mediaType = "text/html";
  assert.throws(() => validateProfileContentPack(stale), /mediaType is unsupported/);
});

test("Skill Pack is declarative and cannot carry tools or authority", () => {
  const instructions = "Revise o documento e destaque inconsistências sem executar ações.";
  const skill = {
    schema: "ordax.profile-content-pack/1",
    kind: "skill-pack",
    entries: [{
      id: "legal.review",
      title: "Revisão jurídica",
      instructions,
      instructionsSha256: digest(instructions),
      authority: "none",
      toolIds: [],
      source,
    }],
  };
  assert.equal(validateProfileContentPack(skill).entries[0].authority, "none");
  assert.equal(inspectProfileContentPackHealth(skill, "skill-pack").authority, "none");

  skill.entries[0].toolIds = ["filesystem.write"];
  assert.throws(() => validateProfileContentPack(skill), /toolIds must remain empty/);
  skill.entries[0].toolIds = [];
  skill.entries[0].authority = "mutable";
  assert.throws(() => validateProfileContentPack(skill), /authority must remain none/);
});

test("Pack rejects kind mismatch and duplicate entry ids", () => {
  const content = "a";
  const entry = {
    id: "knowledge.same",
    mediaType: "text/plain",
    content,
    contentSha256: digest(content),
    source,
  };
  const pack = {
    schema: "ordax.profile-content-pack/1",
    kind: "knowledge-pack",
    entries: [entry, { ...entry }],
  };
  assert.throws(() => validateProfileContentPack(pack), /entry ids must be unique/);

  const healthy = {
    ...pack,
    entries: [entry],
  };
  assert.throws(
    () => inspectProfileContentPackHealth(healthy, "skill-pack"),
    /kind does not match signed artifact kind/,
  );
});
