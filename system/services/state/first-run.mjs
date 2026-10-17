import {
  FIRST_RUN_STATE_SCHEMA,
  FIRST_RUN_RESUME_STEP_IDS,
  createInitialFirstRunState,
  validateFirstRunState,
} from "../../contracts/first-run-state-store.mjs";
import { validatePreferenceRecord } from "../../contracts/preference-store.mjs";
import { FIRST_RUN_STEP_IDS } from "../first-run/journey.mjs";
import { validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import {
  REGIONAL_LOCALE_PREFERENCE_ID,
  REGIONAL_TIME_ZONE_PREFERENCE_ID,
} from "../preferences/regional.mjs";

export {
  FIRST_RUN_STATE_SCHEMA,
  createInitialFirstRunState,
  validateFirstRunState,
};

// Resume checkpoints stay in the existing first-run owner, never in a second store.
// Privacy/name/ready require a new account decision after a Surface relaunch.
export function checkpointFirstRunState({ locale, timeZone }, requestedStep) {
  if (!FIRST_RUN_STEP_IDS.includes(requestedStep)) {
    throw new TypeError(`Unknown first-run checkpoint step: ${String(requestedStep)}`);
  }
  const resumeStep = FIRST_RUN_RESUME_STEP_IDS.includes(requestedStep) ? requestedStep : "account";
  return validateFirstRunState({
    schema: FIRST_RUN_STATE_SCHEMA,
    completed: false,
    locale,
    timeZone,
    accountMode: null,
    resumeStep,
  });
}

export function resolveFirstRunResumeStep(snapshot) {
  const state = validateFirstRunState(snapshot);
  return state.completed ? "welcome" : (state.resumeStep ?? "welcome");
}

// Identity is a live session choice, not an identity receipt persisted in first-run.json.
export function matchesFirstRunIdentitySelection(selectedSubjectId, candidateSession) {
  if (typeof selectedSubjectId !== "string" || selectedSubjectId.length === 0) return false;
  try {
    const session = validateIdentitySessionSnapshot(candidateSession);
    return session.state === "signed-in" && session.subjectId === selectedSubjectId;
  } catch {
    return false;
  }
}

// Requires an actual same-origin session refresh; a cached state is not acceptance evidence.
export async function verifyFirstRunIdentitySession(sessionPort, selectedSubjectId) {
  if (
    !sessionPort
    || typeof sessionPort.refresh !== "function"
    || typeof sessionPort.getSnapshot !== "function"
  ) return false;
  try {
    await sessionPort.refresh();
    return matchesFirstRunIdentitySelection(selectedSubjectId, sessionPort.getSnapshot());
  } catch {
    return false;
  }
}

export function completeFirstRunState({ locale, timeZone, accountMode }) {
  return validateFirstRunState({
    schema: FIRST_RUN_STATE_SCHEMA,
    completed: true,
    locale,
    timeZone,
    accountMode,
  });
}

export function seedMissingRegionalPreferencesFromFirstRun(preferenceRecord, firstRunState) {
  const current = validatePreferenceRecord(preferenceRecord);
  const firstRun = validateFirstRunState(firstRunState);
  if (!firstRun.completed) {
    return Object.freeze({ changed: false, snapshot: current });
  }

  const next = { ...current };
  let changed = false;
  if (!Object.prototype.hasOwnProperty.call(next, REGIONAL_LOCALE_PREFERENCE_ID)) {
    next[REGIONAL_LOCALE_PREFERENCE_ID] = firstRun.locale;
    changed = true;
  }
  if (!Object.prototype.hasOwnProperty.call(next, REGIONAL_TIME_ZONE_PREFERENCE_ID)) {
    next[REGIONAL_TIME_ZONE_PREFERENCE_ID] = firstRun.timeZone;
    changed = true;
  }

  return Object.freeze({
    changed,
    snapshot: changed ? validatePreferenceRecord(next) : current,
  });
}
