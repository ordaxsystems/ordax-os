export const FIRST_PARTY_PRODUCT_OAUTH_SCHEMA =
  "prototype-ordax.first-party-product-oauth/1";

const SCOPE = /^[a-z][a-z0-9.-]{2,95}$/;
const AUDIENCE = /^[a-z][a-z0-9:_-]{7,127}$/;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireUniqueScopes(value, label) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError(`${label} must be a bounded scope array`);
  }
  const scopes = value.map((scope) => {
    if (typeof scope !== "string" || !SCOPE.test(scope)) {
      throw new TypeError(`${label} contains an invalid scope`);
    }
    return scope;
  });
  if (new Set(scopes).size !== scopes.length) {
    throw new TypeError(`${label} scopes must be unique`);
  }
  return Object.freeze(scopes);
}

function requireHttpsRedirect(uri) {
  if (typeof uri !== "string" || uri.length > 512) {
    throw new TypeError("redirect URI must be a bounded HTTPS URL");
  }
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TypeError("redirect URI must be a valid HTTPS URL");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw new TypeError(
      "redirect URI must use HTTPS without credentials or fragment",
    );
  }
  return uri;
}

export function validateFirstPartyProductClient(value, clientId) {
  const root = requireObject(value, "first-party OAuth contract");
  if (root.$schema !== FIRST_PARTY_PRODUCT_OAUTH_SCHEMA) {
    throw new TypeError("first-party OAuth schema is incompatible");
  }

  const oauth = requireObject(root.oauth, "oauth");
  if (
    oauth.version !== "2.1"
    || oauth.authorization_code !== true
    || oauth.pkce?.required !== true
    || oauth.pkce?.method !== "S256"
    || oauth.implicit_grant !== false
    || oauth.password_grant !== false
    || oauth.state_required !== true
    || oauth.exact_redirect_uri_registration_required !== true
    || oauth.audience_bound_tokens !== true
  ) {
    throw new TypeError("first-party OAuth security baseline is incomplete");
  }

  const clients = requireObject(root.clients, "clients");
  const client = requireObject(clients[clientId], "client");

  if (client.kind !== "first-party-product") {
    throw new TypeError("client kind is incompatible");
  }
  if (typeof client.runtime_enabled !== "boolean") {
    throw new TypeError("runtime_enabled must be boolean");
  }
  if (typeof client.audience !== "string" || !AUDIENCE.test(client.audience)) {
    throw new TypeError("client audience is invalid");
  }
  if (client.wildcard_scopes !== false) {
    throw new TypeError("wildcard scopes are forbidden");
  }
  if (
    client.space_binding_required !== true
    || client.connection_revocation_required !== true
  ) {
    throw new TypeError("Space binding and revocation are required");
  }

  if (!Array.isArray(client.redirect_uris) || client.redirect_uris.length > 16) {
    throw new TypeError("redirect_uris must be bounded");
  }
  const redirects = client.redirect_uris.map(requireHttpsRedirect);
  if (new Set(redirects).size !== redirects.length) {
    throw new TypeError("redirect URIs must be unique");
  }
  if (client.runtime_enabled && redirects.length === 0) {
    throw new TypeError("enabled client requires registered redirect URI");
  }

  const scopes = requireObject(client.scopes, "client scopes");
  const read = requireUniqueScopes(scopes.read, "read scopes");
  const write = requireUniqueScopes(scopes.write, "write scopes");
  const overlap = read.filter((scope) => write.includes(scope));
  if (overlap.length > 0) {
    throw new TypeError("read/write scopes must not overlap");
  }

  const separation = requireObject(root.token_separation, "token separation");
  for (const key of [
    "development_mcp_credentials_reused",
    "development_mcp_tokens_accepted",
    "product_mcp_client_registration_reused",
    "product_mcp_tokens_accepted",
    "cross_audience_token_reuse",
  ]) {
    if (separation[key] !== false) {
      throw new TypeError(`${key} must remain false`);
    }
  }

  return Object.freeze({
    clientId,
    runtimeEnabled: client.runtime_enabled,
    audience: client.audience,
    redirectUris: Object.freeze(redirects),
    readScopes: read,
    writeScopes: write,
  });
}

export function validateFirstPartyAuthorizationRequest(
  value,
  clientConfig,
) {
  const input = requireObject(value, "authorization request");

  if (input.client_id !== clientConfig.clientId) {
    throw new TypeError("authorization client_id mismatch");
  }
  if (!clientConfig.runtimeEnabled) {
    throw new TypeError("first-party OAuth client runtime is disabled");
  }
  if (!clientConfig.redirectUris.includes(input.redirect_uri)) {
    throw new TypeError("authorization redirect_uri is not registered");
  }
  if (
    typeof input.state !== "string"
    || input.state.length < 16
    || input.state.length > 256
  ) {
    throw new TypeError("authorization state is invalid");
  }
  if (
    typeof input.code_challenge !== "string"
    || input.code_challenge.length < 43
    || input.code_challenge.length > 128
    || input.code_challenge_method !== "S256"
  ) {
    throw new TypeError("authorization PKCE challenge is invalid");
  }
  if (
    typeof input.space_id !== "string"
    || input.space_id.length < 8
    || input.space_id.length > 160
  ) {
    throw new TypeError("authorization requires explicit Space id");
  }

  const allowed = new Set([
    ...clientConfig.readScopes,
    ...clientConfig.writeScopes,
  ]);
  const scopes = requireUniqueScopes(input.scopes, "authorization scopes");
  for (const scope of scopes) {
    if (!allowed.has(scope)) {
      throw new TypeError("authorization scope is not registered");
    }
  }

  return Object.freeze({
    clientId: input.client_id,
    redirectUri: input.redirect_uri,
    spaceId: input.space_id,
    scopes,
    state: input.state,
  });
}
