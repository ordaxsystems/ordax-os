import test from "node:test";
import assert from "node:assert/strict";

import {
  FIRST_RUN_STATE_SCHEMA,
  completeFirstRunState,
  createInitialFirstRunState,
  matchesFirstRunIdentitySelection,
  verifyFirstRunIdentitySession,
  seedMissingRegionalPreferencesFromFirstRun,
  validateFirstRunState,
} from "../system/services/state/first-run.mjs";
import {
  REGIONAL_LOCALE_OPTIONS,
  REGIONAL_LOCALE_PREFERENCE_ID,
  REGIONAL_TIME_ZONE_PREFERENCE_ID,
  regionalLocalePreference,
  regionalTimeZonePreference,
} from "../system/services/preferences/regional.mjs";
import {
  FIRST_RUN_PUBLIC_MVP_LOCALES,
  FIRST_RUN_SUPPORTED_LOCALES,
} from "../system/contracts/first-run-state-store.mjs";

test("first-run begins incomplete and local/account choice is not preselected", () => {
  assert.deepEqual(createInitialFirstRunState(), {
    schema: FIRST_RUN_STATE_SCHEMA,
    completed: false,
    locale: "pt-BR",
    timeZone: "America/Bahia",
    accountMode: null,
  });
});

test("first-run completion supports local-only and identity modes", () => {
  for (const accountMode of ["local-only", "identity"]) {
    const state = completeFirstRunState({
      locale: "pt-BR",
      timeZone: "America/Bahia",
      accountMode,
    });
    assert.equal(state.completed, true);
    assert.equal(state.accountMode, accountMode);
  }
});

test("first-run accepts launch locales and rejects unsupported locale, timezone and incomplete account persistence", () => {
  for (const locale of ["pt-BR", "en-US", "es-ES", "de-DE", "fr-FR"]) {
    assert.equal(
      completeFirstRunState({ locale, timeZone: "America/Bahia", accountMode: "local-only" }).locale,
      locale,
    );
  }
  assert.throws(
    () => completeFirstRunState({ locale: "it-IT", timeZone: "America/Bahia", accountMode: "local-only" }),
    TypeError,
  );
  assert.throws(
    () => completeFirstRunState({ locale: "pt-BR", timeZone: "Europe/London", accountMode: "local-only" }),
    TypeError,
  );
  assert.throws(
    () => validateFirstRunState({
      schema: FIRST_RUN_STATE_SCHEMA,
      completed: false,
      locale: "pt-BR",
      timeZone: "America/Bahia",
      accountMode: "local-only",
    }),
    TypeError,
  );
});

test("public MVP locale selector is narrower than retained compatibility", () => {
  assert.deepEqual([...FIRST_RUN_PUBLIC_MVP_LOCALES], ["pt-BR", "en-US"]);
  assert.deepEqual(
    REGIONAL_LOCALE_OPTIONS.map((entry) => entry.value),
    ["pt-BR", "en-US"],
  );
  assert.deepEqual(
    [...FIRST_RUN_SUPPORTED_LOCALES],
    ["pt-BR", "en-US", "es-ES", "de-DE", "fr-FR"],
  );
});

test("regional preferences are canonical preference definitions", () => {
  assert.equal(regionalLocalePreference.id, REGIONAL_LOCALE_PREFERENCE_ID);
  assert.equal(regionalLocalePreference.validate("pt-BR"), "pt-BR");
  assert.equal(regionalTimeZonePreference.id, REGIONAL_TIME_ZONE_PREFERENCE_ID);
  assert.equal(regionalTimeZonePreference.validate("America/Bahia"), "America/Bahia");
  for (const locale of ["pt-BR", "en-US", "es-ES", "de-DE", "fr-FR"]) {
    assert.equal(regionalLocalePreference.validate(locale), locale);
  }
  assert.throws(() => regionalLocalePreference.validate("it-IT"), TypeError);
});

test("completed first-run repairs only missing regional preference keys", () => {
  const completed = completeFirstRunState({
    locale: "pt-BR",
    timeZone: "America/Manaus",
    accountMode: "local-only",
  });

  const seeded = seedMissingRegionalPreferencesFromFirstRun(
    { "appearance.theme": "dark" },
    completed,
  );
  assert.equal(seeded.changed, true);
  assert.deepEqual(seeded.snapshot, {
    "appearance.theme": "dark",
    "regional.locale": "pt-BR",
    "regional.time-zone": "America/Manaus",
  });

  const preserved = seedMissingRegionalPreferencesFromFirstRun(
    {
      "regional.locale": "pt-BR",
      "regional.time-zone": "America/Sao_Paulo",
    },
    completed,
  );
  assert.equal(preserved.changed, false);
  assert.equal(preserved.snapshot["regional.time-zone"], "America/Sao_Paulo");

  const incomplete = seedMissingRegionalPreferencesFromFirstRun(
    {},
    createInitialFirstRunState(),
  );
  assert.equal(incomplete.changed, false);
  assert.deepEqual(incomplete.snapshot, {});
});

test("first-run identity choice is bound to the current exact authenticated subject", () => {
  const accountA = { state: "signed-in", subjectId: "account-A", displayName: "Pessoa" };
  const accountB = { state: "signed-in", subjectId: "account-B", displayName: "Pessoa" };
  assert.equal(matchesFirstRunIdentitySelection("account-A", accountA), true);
  assert.equal(matchesFirstRunIdentitySelection("account-A", accountB), false);
  assert.equal(matchesFirstRunIdentitySelection("account-A", { state: "signed-out" }), false);
  assert.equal(matchesFirstRunIdentitySelection("account-A", { state: "unavailable" }), false);
  assert.equal(matchesFirstRunIdentitySelection(null, accountA), false);
  assert.equal(matchesFirstRunIdentitySelection("", accountA), false);
  assert.equal(matchesFirstRunIdentitySelection("account-A", { state: "signed-in", subjectId: "account-A" }), false);
  assert.equal(matchesFirstRunIdentitySelection("account-A", null), false);
});

test("first-run identity completion refreshes the real session before saving a receipt", async () => {
  const accountA = { state: "signed-in", subjectId: "account-A", displayName: "Pessoa" };
  const accountB = { state: "signed-in", subjectId: "account-B", displayName: "Pessoa" };
  let current = accountA;
  let calls = 0;
  const session = {
    getSnapshot: () => current,
    refresh: async () => { calls += 1; },
  };
  assert.equal(await verifyFirstRunIdentitySession(session, "account-A"), true);
  assert.equal(calls, 1);
  current = accountB;
  assert.equal(await verifyFirstRunIdentitySession(session, "account-A"), false);
  current = { state: "signed-out" };
  assert.equal(await verifyFirstRunIdentitySession(session, "account-A"), false);
  assert.equal(calls, 3);
  assert.equal(await verifyFirstRunIdentitySession({ getSnapshot: () => accountA }, "account-A"), false);
  assert.equal(await verifyFirstRunIdentitySession({
    getSnapshot: () => accountA, refresh: async () => { throw new Error("offline"); },
  }, "account-A"), false);
  current = accountA;
  assert.equal(await verifyFirstRunIdentitySession({
    getSnapshot: () => current, refresh: async () => { current = accountB; },
  }, "account-A"), false);
  assert.equal(await verifyFirstRunIdentitySession(null, "account-A"), false);
});

test("first-run must confirm durable regional preferences before committing the receipt", async () => {
  const { persistFirstRunCompletion } = await import("../system/services/state/first-run.mjs");
  const events = [];
  let acknowledge;
  const store = { save: async receipt => {
    events.push("receipt");
    assert.equal(receipt.completed, true);
  } };
  const preferences = {
    set: (id, value) => { events.push(id + "=" + value); },
    persistConfirmed: () => {
      events.push("pending");
      return new Promise(resolve => { acknowledge = resolve; });
    },
  };
  const promise = persistFirstRunCompletion(store, preferences, {
    locale: "en-US", timeZone: "America/Bahia", accountMode: "local-only",
  });
  assert.deepEqual(events, ["regional.locale=en-US", "regional.time-zone=America/Bahia", "pending"]);
  acknowledge(true);
  const receipt = await promise;
  assert.equal(receipt.completed, true);
  assert.equal(events.at(-1), "receipt");
});

test("first-run rejects failed host ACK and never persists a completed receipt", async () => {
  const { persistFirstRunCompletion } = await import("../system/services/state/first-run.mjs");
  let receiptWrites = 0;
  const draft = { locale: "pt-BR", timeZone: "America/Bahia", accountMode: "local-only" };
  const preferences = {
    set() {},
    persistConfirmed: async () => false,
  };
  await assert.rejects(
    persistFirstRunCompletion({ save: async () => { receiptWrites++; } }, preferences, draft),
    /not durably confirmed/,
  );
  assert.equal(receiptWrites, 0);
  await assert.rejects(
    persistFirstRunCompletion({ save: async () => { receiptWrites++; } }, {
      ...preferences,
      persistConfirmed: async () => { throw new Error("USB unavailable"); },
    }, draft),
    /USB unavailable/,
  );
  assert.equal(receiptWrites, 0);
  await assert.rejects(
    persistFirstRunCompletion({ save: async () => { receiptWrites++; } }, { set() {} }, draft),
    /durable state and preference ports/,
  );
});

test("failed receipt keeps First Run incomplete after confirmed preference save", async () => {
  const { persistFirstRunCompletion } = await import("../system/services/state/first-run.mjs");
  const draft = { locale: "pt-BR", timeZone: "America/Bahia", accountMode: "identity" };
  const staged = {};
  const preferences = {
    set(id, value) { staged[id] = value; },
    persistConfirmed: async () => true,
  };
  await assert.rejects(
    persistFirstRunCompletion({ save: async () => { throw Error("Native receipt I/O"); } }, preferences, draft),
    /Native receipt I\/O/,
  );
  assert.deepEqual(staged, { "regional.locale": "pt-BR", "regional.time-zone": "America/Bahia" });
  const incomplete = createInitialFirstRunState();
  assert.equal(incomplete.completed, false);
  assert.equal(seedMissingRegionalPreferencesFromFirstRun(staged, incomplete).changed, false);
});
test("account switch during Native preference ACK blocks identity receipt", async () => {
  const { persistFirstRunCompletion } = await import("../system/services/state/first-run.mjs");
  let current = { state: "signed-in", subjectId: "account-A", displayName: "Pessoa" };
  const identity = { getSnapshot: () => current, refresh: async () => {} };
  let confirm;
  const preferences = {
    set() {},
    persistConfirmed: () => new Promise(resolve => { confirm = resolve; }),
  };
  let receiptWrites = 0;
  const pending = persistFirstRunCompletion(
    { save: async () => { receiptWrites++; } },
    preferences,
    { locale: "pt-BR", timeZone: "America/Bahia", accountMode: "identity" },
    { authorizeCommit: () => verifyFirstRunIdentitySession(identity, "account-A") },
  );
  current = { state: "signed-in", subjectId: "account-B", displayName: "Pessoa" };
  confirm(true);
  await assert.rejects(pending, /authorization changed before receipt/);
  assert.equal(receiptWrites, 0);
});

test("identity commitment revalidates session after preference ACK", async () => {
  const { persistFirstRunCompletion } = await import("../system/services/state/first-run.mjs");
  const current = { state: "signed-in", subjectId: "account-A", displayName: "Pessoa" };
  const identity = { getSnapshot: () => current, refresh: async () => {} };
  let verified = false, receipt = null;
  const completed = await persistFirstRunCompletion(
    { save: async snapshot => { assert.equal(verified, true); receipt = snapshot; } },
    { set() {}, persistConfirmed: async () => true },
    { locale: "pt-BR", timeZone: "America/Bahia", accountMode: "identity" },
    { authorizeCommit: async () => { verified = true; return verifyFirstRunIdentitySession(identity, "account-A"); } },
  );
  assert.equal(completed, receipt);
  assert.equal(receipt.accountMode, "identity");
});
test("guest selection requires native detachment even for stale or unavailable identity", async () => {
  const { ensureFirstRunLocalIsolation } = await import("../system/services/state/first-run.mjs");
  const session = { getSnapshot: () => ({ state: "unavailable" }) };
  assert.equal(await ensureFirstRunLocalIsolation(session, null), false);
  assert.equal(await ensureFirstRunLocalIsolation(session, { disconnectLocal: async () => ({}) }), false);
  assert.equal(await ensureFirstRunLocalIsolation(session, {
    disconnectLocal: async () => ({ localSessionDetached: true, remoteRevocation: "not-applicable" }),
  }), true);
  assert.equal(await ensureFirstRunLocalIsolation({ getSnapshot: () => ({ state: "signed-in" }) }, {
    disconnectLocal: async () => ({ localSessionDetached: true }),
  }), false);
  assert.equal(await ensureFirstRunLocalIsolation(session, {
    disconnectLocal: async () => { throw new Error("offline host unreachable"); },
  }), false);
});

test("guest completion requires a fresh local detachment after preference ACK", async () => {
  const { ensureFirstRunLocalIsolation, persistFirstRunCompletion } =
    await import("../system/services/state/first-run.mjs");
  let proof = false;
  let writes = 0;
  const session = { getSnapshot: () => ({ state: "unavailable" }) };
  const actions = { disconnectLocal: async () => ({ localSessionDetached: proof }) };
  const completed = {
    locale: "pt-BR", timeZone: "America/Bahia", accountMode: "local-only",
  };
  const save = { save: async () => { writes++; } };
  const preferences = { set() {}, persistConfirmed: async () => true };
  await assert.rejects(
    persistFirstRunCompletion(save, preferences, completed, {
      authorizeCommit: () => ensureFirstRunLocalIsolation(session, actions),
    }),
    /authorization changed before receipt/,
  );
  assert.equal(writes, 0);
  proof = true;
  await persistFirstRunCompletion(save, preferences, completed, {
    authorizeCommit: () => ensureFirstRunLocalIsolation(session, actions),
  });
  assert.equal(writes, 1);
});
