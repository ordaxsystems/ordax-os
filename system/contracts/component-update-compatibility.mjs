import {
  compareComponentVersions,
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";

export const COMPONENT_COMPATIBILITY_SCHEMA = "ordax.component-compatibility/1";
export const COMPONENT_STATE_MIGRATION_SCHEMA = "ordax.component-state-migration/1";
export const COMPONENT_UPGRADE_DECISION_SCHEMA = "ordax.component-upgrade-decision/1";

const CONTRACT_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const STATE_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} shape is invalid`);
  }
}

function stableId(value, label, pattern = CONTRACT_ID_RE, max = 160) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > max
    || value !== value.trim()
    || value.includes("\0")
    || !pattern.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function positiveInteger(value, label, max = 1_000_000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validateProvidedContract(value) {
  exactKeys(value, ["id", "major"], "Provided component contract");
  return Object.freeze({
    id: stableId(value.id, "Provided contract id"),
    major: positiveInteger(value.major, "Provided contract major", 10_000),
  });
}

function validateRequiredContract(value) {
  exactKeys(value, ["id", "minMajor", "maxMajor", "optional"], "Required component contract");
  const minMajor = positiveInteger(value.minMajor, "Required contract min major", 10_000);
  const maxMajor = positiveInteger(value.maxMajor, "Required contract max major", 10_000);
  if (minMajor > maxMajor) throw new TypeError("Required component contract range is invalid");
  if (typeof value.optional !== "boolean") throw new TypeError("Required component contract optional flag is invalid");
  return Object.freeze({
    id: stableId(value.id, "Required contract id"),
    minMajor,
    maxMajor,
    optional: value.optional,
  });
}

function validateContractList(value, validator, label, identity) {
  if (!Array.isArray(value) || value.length > 128) throw new TypeError(`${label} must be a bounded array`);
  const result = value.map(validator);
  const identities = result.map(identity);
  if (new Set(identities).size !== identities.length) throw new TypeError(`${label} must not contain duplicates`);
  return Object.freeze(result);
}

function validateStateContract(value) {
  if (value === null) return null;
  exactKeys(value, ["id", "writeVersion", "readableFrom", "readableThrough"], "Component state contract");
  const writeVersion = positiveInteger(value.writeVersion, "Component state write version");
  const readableFrom = positiveInteger(value.readableFrom, "Component state readableFrom");
  const readableThrough = positiveInteger(value.readableThrough, "Component state readableThrough");
  if (readableFrom > readableThrough || writeVersion < readableFrom || writeVersion > readableThrough) {
    throw new TypeError("Component state readable range must include its write version");
  }
  return Object.freeze({
    id: stableId(value.id, "Component state id", STATE_ID_RE),
    writeVersion,
    readableFrom,
    readableThrough,
  });
}

export function validateComponentCompatibility(value) {
  exactKeys(
    value,
    ["schema", "componentId", "componentVersion", "provides", "requires", "state", "authority"],
    "Component compatibility descriptor",
  );
  if (value.schema !== COMPONENT_COMPATIBILITY_SCHEMA) throw new TypeError("Component compatibility schema is invalid");
  if (value.authority !== "none") throw new TypeError("Component compatibility cannot carry authority");
  return Object.freeze({
    schema: COMPONENT_COMPATIBILITY_SCHEMA,
    componentId: validateComponentId(value.componentId),
    componentVersion: validateComponentVersion(value.componentVersion),
    provides: validateContractList(
      value.provides,
      validateProvidedContract,
      "Provided component contracts",
      (entry) => `${entry.id}@${entry.major}`,
    ),
    requires: validateContractList(
      value.requires,
      validateRequiredContract,
      "Required component contracts",
      (entry) => entry.id,
    ),
    state: validateStateContract(value.state),
    authority: "none",
  });
}

export function validateComponentCompatibilityCatalog(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    throw new TypeError("Component compatibility catalog must be a bounded non-empty array");
  }
  const descriptors = value.map(validateComponentCompatibility);
  if (new Set(descriptors.map((entry) => entry.componentId)).size !== descriptors.length) {
    throw new TypeError("Component compatibility catalog must contain one active descriptor per component");
  }

  for (const consumer of descriptors) {
    for (const requirement of consumer.requires) {
      const satisfied = descriptors.some((provider) => provider.provides.some((offered) => (
        offered.id === requirement.id
        && offered.major >= requirement.minMajor
        && offered.major <= requirement.maxMajor
      )));
      if (!satisfied && !requirement.optional) {
        throw new TypeError(
          `Component ${consumer.componentId} requires unavailable contract ${requirement.id}@${requirement.minMajor}-${requirement.maxMajor}`,
        );
      }
    }
  }
  return Object.freeze(descriptors);
}

function validateMigrationState(value, label) {
  exactKeys(value, ["id", "version"], label);
  return Object.freeze({
    id: stableId(value.id, `${label} id`, STATE_ID_RE),
    version: positiveInteger(value.version, `${label} version`),
  });
}

function validateMigrationStep(value, index) {
  exactKeys(value, ["id", "from", "to"], `Component migration step ${index}`);
  const from = validateMigrationState(value.from, `Component migration step ${index} from`);
  const to = validateMigrationState(value.to, `Component migration step ${index} to`);
  if (from.id === to.id) {
    if (to.version !== from.version + 1) {
      throw new TypeError("Same-schema component state migrations must be sequential N -> N+1");
    }
  } else if (to.version !== 1) {
    throw new TypeError("A component state schema transition must begin at version 1");
  }
  return Object.freeze({
    id: stableId(value.id, `Component migration step ${index} id`),
    from,
    to,
  });
}

export function validateComponentStateMigrationPlan(value) {
  exactKeys(
    value,
    [
      "schema",
      "componentId",
      "fromComponentVersion",
      "toComponentVersion",
      "fromState",
      "toState",
      "steps",
      "copyOnWrite",
      "verifyBeforeSwitch",
      "retainPreviousGeneration",
      "ownerPreserving",
      "authority",
    ],
    "Component state migration plan",
  );
  if (value.schema !== COMPONENT_STATE_MIGRATION_SCHEMA) throw new TypeError("Component migration schema is invalid");
  if (value.authority !== "none") throw new TypeError("Component migration plan cannot carry authority");
  for (const flag of ["copyOnWrite", "verifyBeforeSwitch", "retainPreviousGeneration", "ownerPreserving"]) {
    if (value[flag] !== true) throw new TypeError(`Component migration ${flag} must be true`);
  }
  const fromComponentVersion = validateComponentVersion(value.fromComponentVersion);
  const toComponentVersion = validateComponentVersion(value.toComponentVersion);
  if (compareComponentVersions(toComponentVersion, fromComponentVersion) <= 0) {
    throw new TypeError("Component migration must target a newer component version");
  }
  const fromState = validateMigrationState(value.fromState, "Component migration fromState");
  const toState = validateMigrationState(value.toState, "Component migration toState");
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 64) {
    throw new TypeError("Component migration steps must be a bounded non-empty array");
  }
  const steps = value.steps.map(validateMigrationStep);
  if (steps[0].from.id !== fromState.id || steps[0].from.version !== fromState.version) {
    throw new TypeError("Component migration first step does not match fromState");
  }
  const last = steps[steps.length - 1];
  if (last.to.id !== toState.id || last.to.version !== toState.version) {
    throw new TypeError("Component migration last step does not match toState");
  }
  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1].to;
    const current = steps[index].from;
    if (previous.id !== current.id || previous.version !== current.version) {
      throw new TypeError("Component migration steps must form one contiguous path");
    }
  }
  return Object.freeze({
    schema: COMPONENT_STATE_MIGRATION_SCHEMA,
    componentId: validateComponentId(value.componentId),
    fromComponentVersion,
    toComponentVersion,
    fromState,
    toState,
    steps: Object.freeze(steps),
    copyOnWrite: true,
    verifyBeforeSwitch: true,
    retainPreviousGeneration: true,
    ownerPreserving: true,
    authority: "none",
  });
}

function decision({ allowed, reasonCode, migrationRequired = false }) {
  return Object.freeze({
    schema: COMPONENT_UPGRADE_DECISION_SCHEMA,
    allowed,
    reasonCode,
    migrationRequired,
    authority: "none",
  });
}

function stateMatchesMigration(state, migrationState) {
  return state.id === migrationState.id && state.writeVersion === migrationState.version;
}

export function evaluateComponentUpgrade({
  current: currentValue,
  candidate: candidateValue,
  active = [],
  migrationPlan = null,
} = {}) {
  const current = validateComponentCompatibility(currentValue);
  const candidate = validateComponentCompatibility(candidateValue);
  if (candidate.componentId !== current.componentId) {
    return decision({ allowed: false, reasonCode: "component-identity-mismatch" });
  }
  if (compareComponentVersions(candidate.componentVersion, current.componentVersion) <= 0) {
    return decision({ allowed: false, reasonCode: "candidate-not-newer" });
  }

  const activeDescriptors = active.map(validateComponentCompatibility).filter(
    (entry) => entry.componentId !== current.componentId,
  );
  try {
    validateComponentCompatibilityCatalog([...activeDescriptors, candidate]);
  } catch {
    return decision({ allowed: false, reasonCode: "contract-compatibility-failed" });
  }

  if (current.state === null && candidate.state === null) {
    return decision({ allowed: true, reasonCode: "compatible-stateless" });
  }
  if (current.state === null && candidate.state !== null) {
    return decision({ allowed: true, reasonCode: "compatible-new-state-owner" });
  }
  if (current.state !== null && candidate.state === null) {
    return decision({ allowed: false, reasonCode: "state-owner-removed" });
  }

  const sameStateVersion = current.state.id === candidate.state.id
    && current.state.writeVersion === candidate.state.writeVersion;
  const candidateReadsCurrent = current.state.id === candidate.state.id
    && current.state.writeVersion >= candidate.state.readableFrom
    && current.state.writeVersion <= candidate.state.readableThrough;
  if (sameStateVersion && candidateReadsCurrent) {
    return decision({ allowed: true, reasonCode: "compatible-state" });
  }

  if (migrationPlan === null) {
    return decision({
      allowed: false,
      reasonCode: "explicit-state-migration-required",
      migrationRequired: true,
    });
  }

  let plan;
  try {
    plan = validateComponentStateMigrationPlan(migrationPlan);
  } catch {
    return decision({
      allowed: false,
      reasonCode: "state-migration-invalid",
      migrationRequired: true,
    });
  }
  if (
    plan.componentId !== current.componentId
    || plan.fromComponentVersion !== current.componentVersion
    || plan.toComponentVersion !== candidate.componentVersion
    || !stateMatchesMigration(current.state, plan.fromState)
    || !stateMatchesMigration(candidate.state, plan.toState)
  ) {
    return decision({
      allowed: false,
      reasonCode: "state-migration-binding-mismatch",
      migrationRequired: true,
    });
  }

  return decision({ allowed: true, reasonCode: "compatible-with-explicit-migration", migrationRequired: true });
}
