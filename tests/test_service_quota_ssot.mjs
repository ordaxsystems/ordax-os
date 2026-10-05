import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

test("every prepared quota resource is owned by the canonical entitlement catalog", async () => {
  const [quota, entitlements] = await Promise.all([
    readJson("../docs/contracts/service-quotas.json"),
    readJson("../docs/contracts/entitlements.json"),
  ]);
  const preparedKeys = new Set(entitlements.prepared_keys);
  for (const resource of quota.prepared_resources) {
    assert.equal(
      preparedKeys.has(resource.key),
      true,
      `quota key is not declared by entitlements SSOT: ${resource.key}`,
    );
  }
});

test("cost-sensitive quota keys stay unpriced until unit economics are validated", async () => {
  const [quota, entitlements] = await Promise.all([
    readJson("../docs/contracts/service-quotas.json"),
    readJson("../docs/contracts/entitlements.json"),
  ]);
  const pending = new Set(entitlements.plan_catalog.cost_sensitive_quota_keys_pending_unit_cost_validation);
  const resources = new Map(quota.prepared_resources.map(resource => [resource.key, resource]));
  for (const key of pending) {
    assert.equal(resources.has(key), true, `missing prepared quota resource: ${key}`);
    assert.equal(resources.get(key).commercial_value_assigned, false, `cost-sensitive quota was priced early: ${key}`);
  }
});
