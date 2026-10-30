import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const boundary = JSON.parse(readFileSync(new URL('../docs/contracts/spaces-and-profile-packs.json', import.meta.url), 'utf8')).update_ownership;
const guide = readFileSync(new URL('../docs/SPACES-AND-PROFILES.md', import.meta.url), 'utf8');

test('Space core is independently versioned, native and preserves Space identity and data', () => {
  assert.equal(boundary.space_structure.owner, 'ordax-spaces-core');
  assert.equal(boundary.space_structure.distribution, 'native-versioned-service');
  assert.deepEqual(boundary.space_structure.independent_of, ['os-base', 'store-apps', 'profile-packs']);
  assert.equal(boundary.space_structure.preserves, 'stable-space-identity-and-data');
});

test('Store owns verified independently updatable app code, never Space data or authorization', () => {
  assert.equal(boundary.store_app.owner, 'ordax-store');
  assert.equal(boundary.store_app.distribution, 'verified-versioned-package');
  assert.equal(boundary.store_app.installation_scope, 'authorized-space');
  assert.equal(boundary.store_app.code_shared_across_spaces, true);
  assert.equal(boundary.store_app.data_owner, 'domain-service-by-space-id');
  assert.deepEqual(boundary.store_app.independent_of, ['os-base', 'space-structure', 'profile-packs']);
});

test('Profile composition references Store packages but never installs or embeds executable apps', () => {
  assert.equal(boundary.profile_pack.owner, 'profile-pack-catalog');
  assert.equal(boundary.profile_pack.contains_app_binaries, false);
  assert.equal(boundary.profile_pack.installs_apps_directly, false);
  assert.equal(boundary.profile_pack.may_request_store_apps, true);
  assert.deepEqual(boundary.profile_pack.activation_requires, ['store-package-trust', 'compatibility', 'entitlement', 'explicit-consent-when-required']);
  assert.equal(boundary.profile_pack.rollback_preserves_business_data, true);
  assert.equal(boundary.os_base.space_data_migration_implicit, false);
  assert.match(boundary.runtime_gate, /never-proves-installed-ready-or-authorized/);
  assert.match(guide, /Space structure is native OrdaX core/);
  assert.match(guide, /Store-distributed, independently versioned verified packages/);
});
