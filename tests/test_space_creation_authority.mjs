import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import { SPACE_TYPE_CATALOG } from "../system/services/spaces/type-catalog.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = join(
  ROOT,
  "infra/supabase/product/migrations/20261016014500_space_creation_authority_v1.sql",
);

function expectedProjection() {
  return SPACE_TYPE_CATALOG.types
    .filter((type) => type.lifecycle === "mvp-foundation")
    .map((type) => {
      assert.notEqual(type.creationDefaultProfile, null, `${type.key} must have a creation default`);
      const profile = type.creationDefaultProfile;
      const manifestPath = join(
        ROOT,
        "system/profile-packs",
        profile.slug,
        `v${profile.version}`,
        "manifest.json",
      );
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      assert.equal(manifest.slug, profile.slug);
      assert.equal(manifest.version, profile.version);
      assert.equal(manifest.state, "active");
      assert.equal(manifest.activation?.publicly_available, true);
      return {
        domain: type.domain,
        subtype: type.subtype,
        kind: manifest.space_kind,
        profileSlug: profile.slug,
        profileVersion: profile.version,
      };
    })
    .sort((left, right) => `${left.domain}.${left.subtype}`.localeCompare(`${right.domain}.${right.subtype}`));
}

function migrationProjection() {
  const source = readFileSync(MIGRATION, "utf-8");
  const insert = source.match(
    /insert into private\.ordax_space_creation_type_projection\([\s\S]*?\) values([\s\S]*?);/,
  );
  assert.ok(insert, "creation projection INSERT must exist");
  const rows = [];
  const rowPattern = /\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+)\)/g;
  for (const match of insert[1].matchAll(rowPattern)) {
    rows.push({
      domain: match[1],
      subtype: match[2],
      kind: match[3],
      profileSlug: match[4],
      profileVersion: Number(match[5]),
    });
  }
  return rows.sort((left, right) => `${left.domain}.${left.subtype}`.localeCompare(`${right.domain}.${right.subtype}`));
}

test("database creation projection is exactly derived from canonical MVP Space types", () => {
  assert.deepEqual(migrationProjection(), expectedProjection());
});

test("deferred Space types never enter the database creation projection", () => {
  const allowed = new Set(migrationProjection().map((item) => `${item.domain}.${item.subtype}`));
  for (const type of SPACE_TYPE_CATALOG.types.filter((item) => item.lifecycle === "deferred")) {
    assert.equal(allowed.has(type.key), false, `${type.key} must remain non-creatable`);
  }
});

test("creation RPC removes direct authenticated INSERT and keeps mutation bounded", () => {
  const source = readFileSync(MIGRATION, "utf-8");
  assert.match(source, /revoke insert on table public\.ordax_spaces from authenticated;/);
  assert.match(source, /security definer\nset search_path = ''/);
  assert.match(source, /v_actor uuid := \(select auth\.uid\(\)\)/);
  assert.match(source, /v_owned_count >= 64/);
  assert.match(source, /space-create-idempotency-conflict/);
  assert.match(source, /insert into public\.ordax_space_members/);
  assert.match(source, /'owner', 'active'/);
  assert.match(
    source,
    /grant execute on function public\.ordax_create_space_v1\(text, text, text, uuid\)\n  to authenticated;/,
  );
  assert.doesNotMatch(source, /grant execute[\s\S]*to anon;/);
});
