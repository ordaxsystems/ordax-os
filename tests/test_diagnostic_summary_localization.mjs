import assert from "node:assert/strict";
import test from "node:test";

import { createWebDiagnosticCopy } from "../system/adapters/web/diagnostic-copy.mjs";
import { DIAGNOSTIC_COPY_SCHEMA } from "../system/contracts/diagnostic-copy.mjs";
import { SURFACE_HOST_SCHEMA } from "../system/contracts/surface-host.mjs";
import { copyDiagnosticReviewSummary } from "../system/services/diagnostics/copy.mjs";
import { createDiagnosticReviewController } from "../system/services/diagnostics/controller.mjs";
import { createDiagnosticReviewSummary } from "../system/services/diagnostics/summary.mjs";

function unavailableReview() {
  const generatedAt = "2026-10-03T13:00:00.000Z";
  return {
    review: {
      schema: "ordax.diagnostic-review/1",
      generatedAt,
      scope: "explicit-local-review",
      manifest: {
        sources: [
          { id: "surface", status: "included", failureCode: "" },
          { id: "update", status: "unavailable", failureCode: "" },
          { id: "metrics", status: "unavailable", failureCode: "" },
          { id: "history", status: "unavailable", failureCode: "" },
          { id: "journal", status: "unavailable", failureCode: "" },
        ],
        includedSourceIds: ["surface"],
        unavailableSourceIds: ["update", "metrics", "history", "journal"],
        failedSourceIds: [],
        hasFailures: false,
      },
      observations: { updateFreshness: null },
      report: {
        schema: "ordax.diagnostic-report/2",
        generatedAt,
        scope: "local-reviewable",
        surface: { connectivity: "offline", capabilityIds: ["system.metrics"] },
        update: null,
        metrics: null,
        history: null,
        journal: null,
      },
    },
    fileName: "ordax-diagnostic-review.json",
    mediaType: "application/json",
    text: "raw document is deliberately not a summary source\n",
  };
}

function host() {
  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot() {
      return { connectivity: "offline", capabilityIds: ["system.metrics"] };
    },
    subscribe() {
      return () => {};
    },
  });
}

function copyPort(copy) {
  return Object.freeze({ schema: DIAGNOSTIC_COPY_SCHEMA, copy });
}

test("en-US diagnostic summary localizes the copied plain-text artifact", () => {
  const summary = createDiagnosticReviewSummary(unavailableReview(), { locale: "en-US" });

  assert.match(summary.text, /^OrdaX — sanitized diagnostic summary/m);
  assert.match(summary.text, /Generated: 2026-10-03T13:00:00\.000Z/);
  assert.match(summary.text, /Scope: explicit local review/);
  assert.match(summary.text, /Review sources:/);
  assert.match(summary.text, /- Update: unavailable/);
  assert.match(summary.text, /Observed connectivity: offline/);
  assert.match(summary.text, /Declared capabilities: system\.metrics/);
  assert.match(summary.text, /Update: unavailable in this review\./);
  assert.match(summary.text, /Metrics: unavailable in this review\./);
  assert.match(summary.text, /History: unavailable in this review\./);
  assert.match(summary.text, /Diagnostic log: unavailable in this review\./);
  assert.match(summary.text, /The absence of the log does not prove the absence of problems\./);
  assert.match(summary.text, /Summary generated only from the structured, sanitized review\./);
  assert.doesNotMatch(
    summary.text,
    /resumo sanitizado|Gerado:|Escopo:|Fontes da revisão|Atualização:|Métricas:|Histórico:|Registro diagnóstico:/,
  );
});

test("unsupported diagnostic summary locales fall back to PT-BR", () => {
  const summary = createDiagnosticReviewSummary(unavailableReview(), { locale: "es-ES" });
  assert.match(summary.text, /^OrdaX — resumo sanitizado de diagnóstico/m);
  assert.match(summary.text, /Atualização: indisponível nesta revisão\./);
});

test("copy boundary forwards en-US into the generated summary", async () => {
  const writes = [];
  const copy = createWebDiagnosticCopy({
    async writeText(value) {
      writes.push(value);
    },
  });

  const result = await copyDiagnosticReviewSummary(unavailableReview(), copy, { locale: "en-US" });
  assert.equal(result.status, "copied");
  assert.equal(writes.length, 1);
  assert.match(writes[0], /^OrdaX — sanitized diagnostic summary/m);
  assert.doesNotMatch(writes[0], /resumo sanitizado|Atualização:|Métricas:|Histórico:/);
});

test("controller resolves locale at copy time instead of preparation time", async () => {
  let locale = "pt-BR";
  let observedSummary = null;
  const controller = createDiagnosticReviewController({
    host: host(),
    diagnosticCopy: copyPort(async (summary) => {
      observedSummary = summary;
      return { status: "copied" };
    }),
    localeProvider: () => locale,
    clock: () => "2026-10-03T13:00:00.000Z",
  });

  assert.equal((await controller.prepare()).status, "ready");
  locale = "en-US";
  assert.equal((await controller.copyPreparedSummary()).status, "copied");
  assert.match(observedSummary.text, /^OrdaX — sanitized diagnostic summary/m);
  assert.doesNotMatch(observedSummary.text, /resumo sanitizado|Atualização:|Métricas:|Histórico:/);
});
