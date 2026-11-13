import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SPACE_TYPE_CATALOG } from "../system/services/spaces/type-catalog.mjs";
import { validateProfilePack } from "../system/contracts/profile-pack.mjs";

test("Personal Space MVP uses the single approved zero-component profile", async () => {
  const type=SPACE_TYPE_CATALOG.types.find(t=>t.key==="general.personal");
  assert.ok(type);
  assert.equal(type.lifecycle,"mvp-foundation");
  assert.deepEqual(type.creationDefaultProfile,{slug:"pessoal-basico",version:1,identity:"pessoal-basico@1"});
  assert.deepEqual(type.navigation.map(x=>x.id),["overview","settings"]);
  assert.deepEqual(type.dashboard,[]);
  assert.deepEqual(type.resources,[]);
  const raw=JSON.parse(await readFile(new URL("../system/profile-packs/pessoal-basico/v1/manifest.json",import.meta.url),"utf8"));
  const pack=validateProfilePack(raw);
  assert.equal(pack.slug,type.creationDefaultProfile.slug);
  assert.equal(pack.state,"active");
  assert.equal(pack.spaceKind,"personal");
  assert.equal(pack.activation.publiclyAvailable,true);
  assert.deepEqual(pack.components,[]);
  assert.deepEqual(pack.apps,[]);
  assert.deepEqual(pack.templates,[]);
  assert.equal(pack.security.autoGrantPrivileges,false);
  assert.equal(pack.security.allowUnsignedApps,false);
});
