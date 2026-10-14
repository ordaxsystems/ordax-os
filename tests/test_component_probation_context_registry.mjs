import assert from "node:assert/strict";
import test from "node:test";

let serial = 0;

async function isolatedRegistry(label) {
  serial += 1;
  return import(
    `../system/services/components/probation-context.mjs?${label}-${serial}`
  );
}

test("probation context returns null without a non-empty provider contribution", async () => {
  {
    const { composeComponentProbationContext } = await isolatedRegistry("empty");
    const result = await composeComponentProbationContext("notes", { timeoutMs: 200 });
    assert.equal(result, null);
  }
  {
    const {
      installComponentProbationContextProvider,
      composeComponentProbationContext,
    } = await isolatedRegistry("empty-object");
    installComponentProbationContextProvider(() => ({}));
    const result = await composeComponentProbationContext("files", { timeoutMs: 200 });
    assert.equal(result, null);
  }
});

test("probation context composes bounded frozen contributions without replacing caller fields", async () => {
  const {
    installComponentProbationContextProvider,
    composeComponentProbationContext,
  } = await isolatedRegistry("compose");
  const calls = [];
  installComponentProbationContextProvider(async (componentId) => {
    calls.push(["first", componentId]);
    return { fileSpace: Object.freeze({ schema: "test.files" }) };
  });
  installComponentProbationContextProvider(async (componentId) => {
    calls.push(["second", componentId]);
    return { projects: Object.freeze({ schema: "test.projects" }) };
  });

  const result = await composeComponentProbationContext("files", {
    context: Object.freeze({ root: "host" }),
    timeoutMs: 200,
  });

  assert.deepEqual(calls, [["first", "files"], ["second", "files"]]);
  assert.equal(result.root, "host");
  assert.equal(result.fileSpace.schema, "test.files");
  assert.equal(result.projects.schema, "test.projects");
  assert.equal(Object.isFrozen(result), true);
});

test("probation context rejects collisions and seals provider installation after composition starts", async () => {
  const {
    installComponentProbationContextProvider,
    composeComponentProbationContext,
  } = await isolatedRegistry("collision");
  installComponentProbationContextProvider(() => ({ shared: "first" }));
  installComponentProbationContextProvider(() => ({ shared: "second" }));
  await assert.rejects(
    () => composeComponentProbationContext("files", { timeoutMs: 200 }),
    /cannot add field: shared/,
  );
  assert.throws(
    () => installComponentProbationContextProvider(() => null),
    /cannot be installed after component probation starts/,
  );
});

test("probation context rejects non-plain, symbol and prototype-sensitive contributions", async () => {
  {
    const {
      installComponentProbationContextProvider,
      composeComponentProbationContext,
    } = await isolatedRegistry("non-plain");
    installComponentProbationContextProvider(() => new Date());
    await assert.rejects(
      () => composeComponentProbationContext("files", { timeoutMs: 200 }),
      /plain object or null/,
    );
  }
  {
    const {
      installComponentProbationContextProvider,
      composeComponentProbationContext,
    } = await isolatedRegistry("symbol");
    installComponentProbationContextProvider(() => ({ [Symbol("hidden")]: true }));
    await assert.rejects(
      () => composeComponentProbationContext("files", { timeoutMs: 200 }),
      /must not return symbol fields/,
    );
  }
  {
    const {
      installComponentProbationContextProvider,
      composeComponentProbationContext,
    } = await isolatedRegistry("prototype");
    installComponentProbationContextProvider(() => Object.defineProperty(
      {},
      "__proto__",
      { value: "blocked", enumerable: true },
    ));
    await assert.rejects(
      () => composeComponentProbationContext("files", { timeoutMs: 200 }),
      /cannot add field: __proto__/,
    );
  }
});

test("probation context timeout is bounded and does not become an indefinite boot wait", async () => {
  const {
    installComponentProbationContextProvider,
    composeComponentProbationContext,
  } = await isolatedRegistry("timeout");
  installComponentProbationContextProvider(() => new Promise(() => {}));
  await assert.rejects(
    () => composeComponentProbationContext("files", { timeoutMs: 100 }),
    /composition timed out/,
  );
});
