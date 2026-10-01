import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateNetworkProfileAffiliations } from "../system/contracts/network-profile-affiliations.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function json(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

test("MVP Network affiliations are recommendation-only and bind to known Profiles", async () => {
  const [catalog, affiliations] = await Promise.all([
    json("system/profile-packs/catalog.json"),
    json("system/network/profile-affiliations.json"),
  ]);
  const knownProfiles = new Set(catalog.entries.map((entry) => `${entry.slug}@${entry.version}`));
  const normalized = validateNetworkProfileAffiliations(affiliations, { knownProfiles });

  assert.equal(normalized.rules.recommendationOnly, true);
  assert.equal(normalized.rules.autoJoin, false);
  assert.equal(normalized.rules.autoPublishSpace, false);
  assert.equal(normalized.rules.membershipServerAuthoritative, true);
  assert.deepEqual(
    normalized.profiles["pizzaria-br@1"].recommendedCommunities,
    ["industry.food.pizzeria.br"],
  );
  assert.equal(normalized.communities["industry.food.pizzeria.br"].joinPolicy, "explicit-consent");
});

test("Network affiliations fail closed on auto-join or auto-publication", async () => {
  const affiliations = await json("system/network/profile-affiliations.json");

  assert.throws(
    () => validateNetworkProfileAffiliations({
      ...affiliations,
      rules: { ...affiliations.rules, auto_join: true },
    }),
    /auto_join must be false/,
  );

  assert.throws(
    () => validateNetworkProfileAffiliations({
      ...affiliations,
      rules: { ...affiliations.rules, auto_publish_space: true },
    }),
    /auto_publish_space must be false/,
  );
});

test("Network affiliations reject unknown Profiles and communities", async () => {
  const affiliations = await json("system/network/profile-affiliations.json");

  assert.throws(
    () => validateNetworkProfileAffiliations(affiliations, { knownProfiles: new Set(["developer@1"]) }),
    /Unknown Profile identity/,
  );

  assert.throws(
    () => validateNetworkProfileAffiliations({
      ...affiliations,
      profiles: {
        ...affiliations.profiles,
        "pizzaria-br@1": {
          ...affiliations.profiles["pizzaria-br@1"],
          recommended_communities: ["industry.food.unknown.br"],
        },
      },
    }),
    /references unknown community/,
  );
});
