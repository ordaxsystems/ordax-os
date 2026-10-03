import assert from "node:assert/strict";
import test from "node:test";

import { DIAGNOSTIC_COPY_SCHEMA } from "../system/contracts/diagnostic-copy.mjs";
import { DIAGNOSTIC_EXPORT_SCHEMA } from "../system/contracts/diagnostic-export.mjs";
import { DIAGNOSTIC_JOURNAL_STORE_SCHEMA } from "../system/contracts/diagnostic-journal-store.mjs";
import { SURFACE_HOST_SCHEMA } from "../system/contracts/surface-host.mjs";
import { SYSTEM_METRICS_SCHEMA } from "../system/contracts/system-metrics.mjs";
import { UPDATE_STATUS_SCHEMA } from "../system/contracts/update-status.mjs";
import { createDiagnosticReviewController } from "../system/services/diagnostics/controller.mjs";
import { createDiagnosticJournalRuntime } from "../system/services/diagnostics/runtime.mjs";
import { LOCALIZATION_SCHEMA } from "../system/contracts/localization.mjs";
import { createLocaleProfile } from "../system/services/i18n/locale-profile.mjs";
import {
  SYSTEM_DIAGNOSTICS_SOURCE_MESSAGES,
  SYSTEM_DIAGNOSTICS_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/system-diagnostics.mjs";
import { createDiagnosticReviewPresentation } from "../system/surface/ui/system-diagnostics-review.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const TARGET_SHA = "89abcdef0123456789abcdef0123456789abcdef";
const GENERATED_AT = "2026-09-18T23:30:00Z";

function localization(locale = "pt-BR") {
  const table = locale === "en-US"
    ? SYSTEM_DIAGNOSTICS_ENGLISH_MESSAGES
    : SYSTEM_DIAGNOSTICS_SOURCE_MESSAGES;
  return Object.freeze({
    schema: LOCALIZATION_SCHEMA,
    getLocale() {
      return locale;
    },
    getProfile() {
      return createLocaleProfile(locale);
    },
    translate(messageId, values = {}) {
      const source = SYSTEM_DIAGNOSTICS_SOURCE_MESSAGES[messageId];
      if (typeof source !== "string") throw new TypeError(`Unknown test message: ${messageId}`);
      const message = table[messageId] ?? source;
      return message.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key) => (
        values[key] === undefined || values[key] === null ? match : String(values[key])
      ));
    },
    subscribe(listener) {
      listener(locale);
      return () => {};
    },
  });
}

function host() {
  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot() {
      return {
        connectivity: "online",
        capabilityIds: ["system.metrics", "filesystem.user-space"],
      };
    },
    subscribe() {
      return () => {};
    },
  });
}

function updateSnapshot(overrides = {}) {
  return {
    sourceSha: SOURCE_SHA,
    deliveryNumber: 51,
    runtimeSurfaceSha: SOURCE_SHA,
    targetSha: TARGET_SHA,
    status: "running",
    phase: "idle",
    applyMode: "none",
    attemptId: "attempt-51",
    bootRefreshRequired: false,
    checkedAt: "2026-09-18T23:25:00Z",
    lastAppliedSha: SOURCE_SHA,
    lastAppliedAt: "2026-09-18T22:00:00Z",
    rejectedSha: "",
    lastError: "token=secret-value user@example.com 10.20.30.40 /home/alice/private",
    healthToken: "raw-health-token",
    ...overrides,
  };
}

function updatePort(snapshot = updateSnapshot()) {
  return Object.freeze({
    schema: UPDATE_STATUS_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe() {
      return () => {};
    },
  });
}

function metricsPort(read) {
  return Object.freeze({ schema: SYSTEM_METRICS_SCHEMA, read });
}

function exportPort(save) {
  return Object.freeze({ schema: DIAGNOSTIC_EXPORT_SCHEMA, save });
}

function copyPort(copy) {
  return Object.freeze({ schema: DIAGNOSTIC_COPY_SCHEMA, copy });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function degradedJournal() {
  const store = Object.freeze({
    schema: DIAGNOSTIC_JOURNAL_STORE_SCHEMA,
    scope: "device",
    async load() {
      return null;
    },
    async save() {
      throw new Error("disk failure token=store-secret");
    },
  });
  const runtime = await createDiagnosticJournalRuntime({ store });
  await runtime.appendUpdate(updateSnapshot(), "2026-09-18T23:24:59Z");
  return runtime;
}

test("idle presentation asks for explicit review and never invents review material", () => {
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: exportPort(async () => ({ status: "saved" })),
    diagnosticCopy: copyPort(async () => ({ status: "copied" })),
    clock: () => GENERATED_AT,
  });

  const presentation = createDiagnosticReviewPresentation(controller.getSnapshot(), localization());
  assert.equal(presentation.phase, "idle");
  assert.equal(presentation.review, null);
  assert.equal(presentation.copy.visible, false);
  assert.equal(presentation.export.visible, false);
  assert.equal(presentation.copyAvailable, true);
  assert.equal(presentation.exportAvailable, true);
  assert.equal(presentation.action, null);
  assert.ok(Object.isFrozen(presentation));
});

test("ready presentation preserves partial review, stale observation and degraded persistence honestly", async () => {
  const journal = await degradedJournal();
  const controller = createDiagnosticReviewController({
    host: host(),
    updateStatus: updatePort(),
    systemMetrics: metricsPort(async () => {
      throw new Error("metrics user@example.com token=metrics-secret");
    }),
    diagnosticJournal: journal,
    diagnosticExport: exportPort(async () => ({ status: "saved" })),
    diagnosticCopy: copyPort(async () => ({ status: "copied" })),
    updateMaxAgeSeconds: 90,
    clock: () => GENERATED_AT,
  });

  const prepared = await controller.prepare();
  assert.equal(prepared.status, "ready");
  const presentation = createDiagnosticReviewPresentation(controller.getSnapshot(), localization());

  assert.equal(presentation.phase, "ready");
  assert.equal(presentation.copy.visible, true);
  assert.equal(presentation.copy.disabled, false);
  assert.equal(presentation.copy.label, "Copiar resumo sanitizado");
  assert.equal(presentation.review.hasFailures, true);
  assert.equal(presentation.review.freshness.state, "stale");
  assert.equal(presentation.review.freshness.label, "Observação antiga");
  assert.match(presentation.review.freshness.detail, /não prova falha do supervisor/i);
  assert.equal(presentation.review.persistence.state, "degraded");
  assert.equal(presentation.review.persistence.label, "Persistência degradada");
  assert.equal(presentation.review.eventCount, 1);
  assert.equal(presentation.review.events.length, 1);
  assert.equal(presentation.review.events[0].severityLabel, "Informação");
  assert.equal(presentation.review.update.status, "Em execução");

  const metricsSource = presentation.review.sources.find((source) => source.id === "metrics");
  assert.equal(metricsSource.status, "failed");
  assert.equal(metricsSource.statusLabel, "Falha na leitura");
  assert.equal(metricsSource.detail, "As métricas locais não puderam ser lidas.");

  const serialized = JSON.stringify(presentation);
  assert.doesNotMatch(serialized, /secret-value|metrics-secret|store-secret|raw-health-token/);
  assert.doesNotMatch(serialized, /user@example\.com|10\.20\.30\.40|\/home\/alice/);
  assert.match(serialized, /\[redacted\]|\[email\]|\[ip\]|\/home\/\[user\]/);
});

test("missing journal stays unavailable instead of becoming an empty-health claim", async () => {
  const controller = createDiagnosticReviewController({
    host: host(),
    updateStatus: updatePort({
      ...updateSnapshot(),
      checkedAt: "unknown",
    }),
    clock: () => GENERATED_AT,
  });
  await controller.prepare();

  const presentation = createDiagnosticReviewPresentation(controller.getSnapshot(), localization());
  const journalSource = presentation.review.sources.find((source) => source.id === "journal");
  assert.equal(journalSource.status, "unavailable");
  assert.equal(presentation.review.eventCount, null);
  assert.deepEqual(presentation.review.events, []);
  assert.equal(presentation.review.persistence.state, "unavailable");
  assert.equal(presentation.review.freshness.state, "unknown");
  assert.equal(presentation.review.freshness.label, "Atualidade desconhecida");
});

test("copy presentation shows progress, success and stable retryable failure", async () => {
  const gate = deferred();
  let fail = false;
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticCopy: copyPort(async () => {
      await gate.promise;
      if (fail) throw new Error("clipboard secret=do-not-leak");
      return { status: "copied" };
    }),
    diagnosticExport: exportPort(async () => ({ status: "saved" })),
    clock: () => GENERATED_AT,
  });

  await controller.prepare();
  const copying = controller.copyPreparedSummary();
  let presentation = createDiagnosticReviewPresentation(controller.getSnapshot(), localization());
  assert.equal(presentation.phase, "copying");
  assert.equal(presentation.action.kind, "progress");
  assert.equal(presentation.action.text, "Copiando resumo sanitizado…");
  assert.equal(presentation.prepare.disabled, true);
  assert.equal(presentation.copy.disabled, true);
  assert.equal(presentation.export.disabled, true);

  gate.resolve();
  assert.equal((await copying).status, "copied");
  presentation = createDiagnosticReviewPresentation(controller.getSnapshot(), localization());
  assert.equal(presentation.phase, "ready");
  assert.equal(presentation.action.kind, "success");
  assert.equal(presentation.action.text, "Resumo sanitizado copiado.");
  assert.notEqual(presentation.review, null);

  const failingController = createDiagnosticReviewController({
    host: host(),
    diagnosticCopy: copyPort(async () => {
      throw new Error("clipboard secret=do-not-leak");
    }),
    clock: () => GENERATED_AT,
  });
  await failingController.prepare();
  fail = true;
  await failingController.copyPreparedSummary();
  presentation = createDiagnosticReviewPresentation(failingController.getSnapshot(), localization());
  assert.equal(presentation.phase, "ready");
  assert.equal(presentation.action.kind, "warning");
  assert.match(presentation.action.text, /Não foi possível copiar o resumo sanitizado/);
  assert.notEqual(presentation.review, null);
  assert.doesNotMatch(JSON.stringify(presentation), /do-not-leak/);
});

test("export action distinguishes saved, cancelled and stable failures", async () => {
  let exportStatus = "cancelled";
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticExport: exportPort(async () => ({ status: exportStatus })),
    clock: () => GENERATED_AT,
  });

  await controller.prepare();
  let presentation = createDiagnosticReviewPresentation(controller.getSnapshot(), localization());
  assert.equal(presentation.action.kind, "success");
  assert.match(presentation.action.text, /Revisão preparada localmente/);

  await controller.exportPrepared();
  presentation = createDiagnosticReviewPresentation(controller.getSnapshot(), localization());
  assert.equal(presentation.phase, "ready");
  assert.equal(presentation.action.kind, "neutral");
  assert.match(presentation.action.text, /Salvamento cancelado/);

  exportStatus = "invalid";
  await controller.exportPrepared();
  presentation = createDiagnosticReviewPresentation(controller.getSnapshot(), localization());
  assert.equal(presentation.action.kind, "warning");
  assert.match(presentation.action.text, /Não foi possível salvar/);

  exportStatus = "saved";
  await controller.exportPrepared();
  presentation = createDiagnosticReviewPresentation(controller.getSnapshot(), localization());
  assert.equal(presentation.phase, "idle");
  assert.equal(presentation.review, null);
  assert.equal(presentation.action.kind, "success");
  assert.equal(presentation.action.text, "Diagnóstico salvo em Downloads.");
});


test("English diagnostic presentation uses the shared semantic catalog", async () => {
  const controller = createDiagnosticReviewController({
    host: host(),
    updateStatus: updatePort(),
    diagnosticCopy: copyPort(async () => ({ status: "copied" })),
    diagnosticExport: exportPort(async () => ({ status: "saved" })),
    clock: () => GENERATED_AT,
  });
  await controller.prepare();

  const presentation = createDiagnosticReviewPresentation(
    controller.getSnapshot(),
    localization("en-US"),
  );

  assert.equal(presentation.copy.label, "Copy sanitized summary");
  assert.equal(presentation.review.freshness.label, "Stale observation");
  assert.equal(presentation.review.update.delivery, "Delivery 51");
  assert.equal(presentation.review.update.status, "Running");
  assert.equal(presentation.review.update.phase, "Idle");
  const source = presentation.review.sources.find((entry) => entry.id === "update");
  assert.equal(source.label, "Update");
  assert.equal(source.statusLabel, "Included");
  assert.doesNotMatch(JSON.stringify(presentation), /Copiar resumo|Observação antiga|Em execução/);
});

test("presentation rejects misleading controller state shapes", () => {
  assert.throws(
    () => createDiagnosticReviewPresentation({
      schema: "ordax.diagnostic-review-controller-state/1",
      phase: "ready",
      exportAvailable: true,
      copyAvailable: true,
      document: null,
      lastResult: null,
    }, localization()),
    /requires a prepared document/,
  );
  assert.throws(
    () => createDiagnosticReviewPresentation({
      schema: "ordax.diagnostic-review-controller-state/1",
      phase: "healthy",
      exportAvailable: true,
      copyAvailable: true,
      document: null,
      lastResult: null,
    }, localization()),
    /Unsupported diagnostic review controller phase/,
  );
  assert.throws(
    () => createDiagnosticReviewPresentation({
      schema: "ordax.diagnostic-review-controller-state/1",
      phase: "idle",
      exportAvailable: false,
      copyAvailable: "yes",
      document: null,
      lastResult: null,
    }, localization()),
    /copyAvailable must be boolean/,
  );
});
