import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import {
  FIRST_PARTY_PRODUCT_OAUTH_SCHEMA,
  validateFirstPartyAuthorizationRequest,
  validateFirstPartyProductClient,
} from "../system/contracts/first-party-product-oauth.mjs";

const contract = JSON.parse(
  fs.readFileSync(
    new URL("../docs/contracts/first-party-product-oauth.json", import.meta.url),
    "utf8",
  ),
);

test("Achegue-se first-party client matches the merged product boundary", () => {
  assert.equal(contract.$schema, FIRST_PARTY_PRODUCT_OAUTH_SCHEMA);
  const client = validateFirstPartyProductClient(contract, "acheguese");

  assert.equal(client.runtimeEnabled, false);
  assert.equal(client.audience, "ordax:first-party:acheguese");
  assert.deepEqual(client.readScopes, [
    "network.space.read",
    "network.directory.read",
    "network.communities.read",
    "network.messages.read",
  ]);
  assert.deepEqual(client.writeScopes, [
    "network.groups.join",
    "network.messages.write",
    "product.acheguese.publish",
  ]);
});

test("runtime stays fail-closed until an exact HTTPS redirect is registered", () => {
  const client = validateFirstPartyProductClient(contract, "acheguese");
  assert.equal(client.redirectUris.length, 0);

  assert.throws(
    () =>
      validateFirstPartyAuthorizationRequest(
        {
          client_id: "acheguese",
          redirect_uri: "https://example.invalid/oauth/callback",
          state: "0123456789abcdef",
          code_challenge:
            "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
          code_challenge_method: "S256",
          space_id: "ordax-space-0001",
          scopes: ["network.space.read"],
        },
        client,
      ),
    /runtime is disabled/,
  );
});

test("development and Product MCP credentials/tokens cannot be reused", () => {
  for (const key of [
    "development_mcp_credentials_reused",
    "development_mcp_tokens_accepted",
    "product_mcp_client_registration_reused",
    "product_mcp_tokens_accepted",
    "cross_audience_token_reuse",
  ]) {
    assert.equal(contract.token_separation[key], false);
  }
});

test("Space authority is server-revalidated and owner/admin only", () => {
  assert.equal(contract.authority.space_selection_explicit, true);
  assert.equal(contract.authority.server_revalidates_membership, true);
  assert.equal(contract.authority.client_supplied_space_authority, false);
  assert.deepEqual(contract.authority.space_roles_allowed, ["owner", "admin"]);
  assert.equal(contract.authority.viewer_or_member_cannot_link_product, true);
});

test("wildcard scopes and insecure redirects are rejected", () => {
  const insecure = structuredClone(contract);
  insecure.clients.acheguese.redirect_uris = ["http://acheguese.example/callback"];
  assert.throws(
    () => validateFirstPartyProductClient(insecure, "acheguese"),
    /HTTPS/,
  );

  const wildcard = structuredClone(contract);
  wildcard.clients.acheguese.wildcard_scopes = true;
  assert.throws(
    () => validateFirstPartyProductClient(wildcard, "acheguese"),
    /wildcard scopes/,
  );
});
