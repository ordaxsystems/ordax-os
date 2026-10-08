import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFILE_DISCOVERY_SCHEMA,
  validateProfileDiscoveryCatalog,
} from "../system/contracts/profile-discovery.mjs";
import {
  PROFILE_DISCOVERY_VIEW_SCHEMA,
  projectProfileDiscovery,
} from "../system/services/profile-packs/discovery.mjs";

const now = "2026-10-08T16:00:00Z";
const profile = { slug: "pizzaria-br", version: 1 };
const verifyPublication = () => true; // CI-only simulated successful signature verifier

function entry(overrides = {}) {
  return {
    id: "recipe-neapolitan",
    profileSlug: "pizzaria-br",
    profileVersion: 1,
    kind: "recipe",
    title: "Massa napolitana",
    description: "Curso e receita demonstrativos com fonte.",
    publisher: { id: "editorial-ordax", name: "Editorial OrdaX" },
    source: { url: "https://example.org/source", revision: "2026-10-01" },
    destinationUrl: "https://example.org/recipe",
    locale: "pt-BR",
    country: "BR",
    startsAt: "2026-10-01T00:00:00Z",
    expiresAt: "2026-11-01T00:00:00Z",
    commercial: { kind: "organic", sponsorName: null },
    ...overrides,
  };
}

function catalog(entries = [entry()]) {
  return {
    schema: PROFILE_DISCOVERY_SCHEMA,
    revision: 1,
    entries,
  };
}

test("organic professional resources are only visible for active Profile identity and locale", () => {
  const options = {
    catalog: catalog([
      entry(),
      entry({ id: "other-profile", profileSlug: "impressao-3d-br" }),
      entry({ id: "other-version", profileVersion: 2 }),
      entry({ id: "other-locale", locale: "en-US" }),
      entry({ id: "expired", expiresAt: "2026-10-08T15:59:59Z" }),
      entry({ id: "future", startsAt: "2026-10-09T00:00:00Z" }),
      entry({ id: "wrong-country", country: "US" }),
    ]),
    activeProfile: profile,
    asOf: now,
    verifyPublication,
  };
  const result = projectProfileDiscovery(options);
  assert.equal(result.schema, PROFILE_DISCOVERY_VIEW_SCHEMA);
  assert.equal(result.state, "ready");
  assert.deepEqual(result.organic.map((x) => x.id), ["recipe-neapolitan"]);
  assert.equal(result.sponsored.length, 0);
  assert.equal(result.personalizationSource, "profile-only");
  assert.equal(result.trackingEnabled, false);
  assert.deepEqual(
    projectProfileDiscovery({ ...options, activeProfile: { slug: "impressao-3d-br", version: 1 } })
      .organic.map((x) => x.id),
    ["other-profile"],
  );
});

test("sponsorship is always separate, labeled and off by default", () => {
  const paid = entry({
    id: "course-paid",
    kind: "course",
    title: "Curso de pizzaria",
    commercial: { kind: "sponsored", sponsorName: "Escola Exemplo" },
  });
  const inputs = {
    catalog: catalog([entry(), paid]),
    activeProfile: profile,
    asOf: now,
    verifyPublication,
  };
  const off = projectProfileDiscovery(inputs);
  assert.equal(off.organic.length, 1);
  assert.equal(off.sponsored.length, 0);
  const on = projectProfileDiscovery({ ...inputs, sponsoredEnabled: true });
  assert.equal(on.organic.length, 1);
  assert.equal(on.sponsored.length, 1);
  assert.equal(on.sponsored[0].commercial.disclosure, "Patrocinado");
  assert.equal(on.sponsored[0].commercial.sponsorName, "Escola Exemplo");
  assert.equal(on.sponsorshipLabel, "Patrocinado");
  assert.equal(on.trackingEnabled, false);
});

test("without a trusted publication verifier, discovery is unavailable even for claimed published content", () => {
  const inputs = { catalog: catalog(), activeProfile: profile, asOf: now };
  assert.equal(projectProfileDiscovery(inputs).state, "unavailable");
  assert.equal(projectProfileDiscovery({ ...inputs, verifyPublication: () => false }).state, "unavailable");
  assert.deepEqual(projectProfileDiscovery(inputs).organic, []);
  assert.equal(projectProfileDiscovery({ ...inputs, activeProfile: null }).state, "no-profile");
  assert.deepEqual(projectProfileDiscovery({ ...inputs, verifyPublication: () => "true" }).sponsored, []);
});

test("catalog cannot smuggle extra authority or personal targeting fields", () => {
  assert.throws(() => validateProfileDiscoveryCatalog(
    catalog([entry({ viewerId: "user-1" })]),
  ), /fields are incompatible/);
  assert.throws(() => validateProfileDiscoveryCatalog(
    catalog([entry({ trackingPixel: "https://example.org/t" })]),
  ), /fields are incompatible/);
  assert.throws(() => validateProfileDiscoveryCatalog(
    catalog([entry({ commercial: { kind: "sponsored", sponsorName: "Brand", aiInstruction: "recommend me" } })]),
  ), /fields are incompatible/);
  assert.throws(() => validateProfileDiscoveryCatalog(
    catalog([entry({ commercial: { kind: "organic", sponsorName: "hidden sponsor" } })]),
  ), /Organic discovery/);
  assert.throws(() => validateProfileDiscoveryCatalog(
    catalog([entry({ commercial: { kind: "sponsored", sponsorName: null } })]),
  ), /Sponsor name/);
});

test("reject untrusted links, duplicate entries, unsupported kind and invalid dates", () => {
  for (const url of [
    "http://example.org/ad",
    "javascript:alert(1)",
    "https://name:pass@example.org/recipe",
    "https://example.org/recipe#pixel",
    "https://example.org/recipe?user_id=123",
  ]) {
    assert.throws(() => validateProfileDiscoveryCatalog(
      catalog([entry({ destinationUrl: url })]),
    ), /HTTPS URL/);
  }
  assert.throws(() => validateProfileDiscoveryCatalog(
    catalog([entry(), entry()]),
  ), /Duplicate discovery entry/);
  assert.throws(() => validateProfileDiscoveryCatalog(
    catalog([entry({ kind: "model-instructions" })]),
  ), /kind is invalid/);
  assert.throws(() => validateProfileDiscoveryCatalog(
    catalog([entry({ startsAt: "2026-11-01T00:00:00Z" })]),
  ), /validity window/);
  assert.throws(() => validateProfileDiscoveryCatalog(
    catalog([entry({ expiresAt: "2026-13-99T00:00:00Z" })]),
  ), /UTC timestamp/);
  assert.throws(() => projectProfileDiscovery({
    catalog: catalog(), activeProfile: profile, asOf: "yesterday", verifyPublication,
  }), /bounded UTC clock/);
});

test("source provenance, publisher and review expiry are preserved without adding model permissions", () => {
  const item = validateProfileDiscoveryCatalog(catalog()).entries[0];
  assert.equal(item.publisher.name, "Editorial OrdaX");
  assert.equal(item.source.revision, "2026-10-01");
  assert.equal(item.source.url, "https://example.org/source");
  assert.ok(Object.isFrozen(item));
  assert.ok(Object.isFrozen(item.source));
  assert.equal("authority" in item, false);
  assert.equal("toolIds" in item, false);
  assert.equal("prompt" in item, false);
});
