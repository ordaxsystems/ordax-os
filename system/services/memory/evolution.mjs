import {
  MEMORY_STORAGE_MANIFEST_SCHEMA,
  validateMemoryStorageManifest,
} from "../../contracts/memory-evolution.mjs";

function validateStep(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) throw new TypeError("Memory migration step must be an object");
  if (!Number.isSafeInteger(step.from) || step.from < 1) throw new TypeError("Memory migration source format is invalid");
  if (!Number.isSafeInteger(step.to) || step.to !== step.from + 1) {
    throw new TypeError("Memory migrations must advance exactly one storage format");
  }
  if (typeof step.id !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(step.id)) {
    throw new TypeError("Memory migration id is invalid");
  }
  if (typeof step.migrate !== "function") throw new TypeError("Memory migration must implement migrate()");
  return Object.freeze({ from: step.from, to: step.to, id: step.id, migrate: step.migrate });
}

function sameOwner(before, after) {
  return before.ownerKind === after.ownerKind && before.ownerId === after.ownerId;
}

export function createMemoryEvolutionRegistry({ currentFormat, migrations = [] } = {}) {
  if (!Number.isSafeInteger(currentFormat) || currentFormat < 1) {
    throw new TypeError("Current memory storage format is invalid");
  }
  const bySource = new Map();
  for (const candidate of migrations) {
    const step = validateStep(candidate);
    if (bySource.has(step.from)) throw new Error(`Duplicate memory migration from format ${step.from}`);
    bySource.set(step.from, step);
  }

  const plan = (fromFormat) => {
    if (!Number.isSafeInteger(fromFormat) || fromFormat < 1) {
      throw new TypeError("Memory source storage format is invalid");
    }
    if (fromFormat > currentFormat) {
      throw new Error("Memory storage was written by a newer OrdaX; downgrade is refused");
    }
    const result = [];
    for (let format = fromFormat; format < currentFormat; format += 1) {
      const step = bySource.get(format);
      if (!step) throw new Error(`Missing memory migration ${format} -> ${format + 1}`);
      result.push(step);
    }
    return Object.freeze(result);
  };

  return Object.freeze({
    currentFormat,
    plan,
    migrate({ manifest: manifestValue, state }) {
      let manifest = validateMemoryStorageManifest(manifestValue);
      let migratedState = state;
      for (const step of plan(manifest.storageFormat)) {
        const before = manifest;
        const result = step.migrate(Object.freeze({ manifest, state: migratedState }));
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          throw new Error(`Memory migration ${step.id} returned an invalid result`);
        }
        manifest = validateMemoryStorageManifest(result.manifest);
        if (manifest.$schema !== MEMORY_STORAGE_MANIFEST_SCHEMA || manifest.storageFormat !== step.to) {
          throw new Error(`Memory migration ${step.id} did not advance to format ${step.to}`);
        }
        if (!sameOwner(before, manifest)) throw new Error(`Memory migration ${step.id} changed memory owner`);
        if (manifest.canonicalGeneration < before.canonicalGeneration) {
          throw new Error(`Memory migration ${step.id} moved canonical generation backwards`);
        }
        migratedState = result.state;
      }
      return Object.freeze({ manifest, state: migratedState });
    },
  });
}
