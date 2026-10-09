import { createNativeProjectCatalogCasRuntime } from "../../services/files/native-project-catalog-runtime.mjs";
import { createProjectNativeStateMigration } from "../../services/files/native-project-state-migration.mjs";

function assertProjectAuthorityDependencies({ legacyStore, nativeTransport }) {
  if (!legacyStore || typeof legacyStore !== "object") {
    throw new TypeError("Native Project authority cutover requires the legacy Project store for migration");
  }
  if (
    !nativeTransport
    || typeof nativeTransport !== "object"
    || typeof nativeTransport.read !== "function"
    || typeof nativeTransport.compareAndSwap !== "function"
  ) {
    throw new TypeError("Native Project authority cutover requires the Native CAS transport");
  }
}

export async function createNativeProjectAuthorityComposition({
  legacyStore,
  nativeTransport,
  now = Date.now,
  maxAttempts,
} = {}) {
  assertProjectAuthorityDependencies({ legacyStore, nativeTransport });
  if (typeof now !== "function") {
    throw new TypeError("Native Project authority cutover requires a clock function");
  }

  const migration = createProjectNativeStateMigration({
    legacyStore,
    nativeTransport,
  });
  const migrationResult = await migration.migrate();

  const runtimeOptions = {
    transport: nativeTransport,
    now,
  };
  if (maxAttempts !== undefined) runtimeOptions.maxAttempts = maxAttempts;

  const runtime = await createNativeProjectCatalogCasRuntime(runtimeOptions);

  return Object.freeze({
    reader: runtime.reader,
    mutations: runtime.mutations,
    refresh: runtime.refresh,
    migrationResult,
  });
}
