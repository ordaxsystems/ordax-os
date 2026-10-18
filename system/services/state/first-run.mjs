import {
  FIRST_RUN_STATE_SCHEMA,
  createInitialFirstRunState,
  validateFirstRunState,
} from "../../contracts/first-run-state-store.mjs";
import { validatePreferenceRecord } from "../../contracts/preference-store.mjs";
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

// The First Run receipt is monotonic. Never commit it until the complete
// regional preference snapshot is durably confirmed by the canonical store.
// An interrupted receipt write may leave a staged non-secret preference, but
// First Run remains incomplete and can retry without any parallel state.
export async function persistFirstRunCompletion(store, preferences, draft) {
  if (
    !store || typeof store.save !== "function"
    || !preferences || typeof preferences.set !== "function"
    || typeof preferences.persistConfirmed !== "function"
  ) {
    throw new TypeError("First Run completion requires durable state and preference ports");
  }
  const completed = completeFirstRunState(draft);
  preferences.set(REGIONAL_LOCALE_PREFERENCE_ID, completed.locale);
  preferences.set(REGIONAL_TIME_ZONE_PREFERENCE_ID, completed.timeZone);
  const preferenceConfirmed = await preferences.persistConfirmed();
  if (preferenceConfirmed !== true) {
    throw new Error("First Run regional preferences were not durably confirmed");
  }
  await store.save(completed);
  return completed;
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
