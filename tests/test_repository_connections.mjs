import assert from "node:assert/strict";

import {
  assertRepositoryConnectionsPort,
  validateRepositoryConnection,
} from "../system/contracts/repository-connections.mjs";
import { createRepositoryConnectionsCatalog } from "../system/services/projects/repository-connections.mjs";

const spaceA = "11111111-1111-4111-8111-111111111111";
const spaceB = "22222222-2222-4222-8222-222222222222";
const projectA = "33333333-3333-4333-8333-333333333333";
const projectB = "44444444-4444-4444-8444-444444444444";

const row = {
  connection_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  space_id: spaceA,
  project_id: projectA,
  owner_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  provider: "github",
  external_account_id: "github-user-123",
  installation_id: 987654321,
  repository_id: "1234567890123456789",
  repository_full_name: "ordaxsystems/ordax-os",
  default_branch: "main",
  access_mode: "read-write",
  state: "active",
  metadata: { provider_token: "must-never-surface" },
};

{
  const catalog = createRepositoryConnectionsCatalog({
    rows: [
      row,
      {
        ...row,
        connection_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        space_id: spaceB,
        project_id: projectB,
        repository_id: 42,
        repository_full_name: "example/docs",
        access_mode: "read",
        state: "error",
      },
    ],
  });
  assert.equal(assertRepositoryConnectionsPort(catalog), catalog);
  const entries = catalog.listForSpace(spaceA);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.schema, "ordax.repository-connection/1");
  assert.equal(entry.spaceId, spaceA);
  assert.equal(entry.projectId, projectA);
  assert.equal(entry.provider, "github");
  assert.equal(entry.repositoryId, "1234567890123456789");
  assert.equal(entry.repositoryFullName, "ordaxsystems/ordax-os");
  assert.equal(entry.accessMode, "read-write");
  assert.equal(entry.selection, "explicit-repository");
  assert.equal(entry.mutationAuthority, "none");
  assert.equal(entry.credentialExposure, "none");
  for (const secretField of ["owner_user_id", "external_account_id", "installation_id", "metadata", "provider_token"]) {
    assert.equal(secretField in entry, false, `${secretField} leaked into Surface projection`);
  }
  assert.equal(catalog.get(row.connection_id), entry);
  assert.equal(catalog.listForSpace(spaceB)[0].state, "error");
}

{
  const revoked = { ...row, state: "revoked" };
  assert.throws(
    () => createRepositoryConnectionsCatalog({ rows: [revoked] }),
    /revoked connections are not Surface-visible/,
  );
}

{
  const wholeAccount = { ...row, repository_id: null, repository_full_name: null };
  assert.throws(
    () => createRepositoryConnectionsCatalog({ rows: [wholeAccount] }),
    /repository_id is invalid|repository_full_name/,
  );
}

{
  const missingProject = { ...row, project_id: null };
  assert.throws(
    () => createRepositoryConnectionsCatalog({ rows: [missingProject] }),
    /project_id must be a UUID/,
  );
}

{
  const duplicateForSameProject = {
    ...row,
    connection_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  };
  assert.throws(
    () => createRepositoryConnectionsCatalog({ rows: [row, duplicateForSameProject] }),
    /selected only once per project/,
  );

  const sameRepositoryForAnotherProject = {
    ...row,
    connection_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    project_id: projectB,
  };
  const catalog = createRepositoryConnectionsCatalog({ rows: [row, sameRepositoryForAnotherProject] });
  assert.equal(catalog.listForSpace(spaceA).length, 2);
  assert.deepEqual(
    catalog.listForSpace(spaceA).map((entry) => entry.projectId).sort(),
    [projectA, projectB].sort(),
  );
}

{
  const safeProjection = createRepositoryConnectionsCatalog({ rows: [row] }).listForSpace(spaceA)[0];
  assert.throws(
    () => validateRepositoryConnection({ ...safeProjection, accessToken: "must-not-cross" }),
    /fields are incompatible/,
  );
}

for (const method of ["connect", "disconnect", "execute", "link", "mutate", "unlink", "update"]) {
  assert.throws(
    () => assertRepositoryConnectionsPort({
      schema: "ordax.repository-connections/1",
      listForSpace() { return []; },
      get() { return null; },
      [method]() {},
    }),
    new RegExp(`must not expose ${method}`),
  );
}

console.log("REPOSITORY_CONNECTIONS=PASS");
