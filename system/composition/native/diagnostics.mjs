import { createNativeDiagnosticCopy } from "../../adapters/native/diagnostic-copy.mjs";
import { createNativeDiagnosticExport } from "../../adapters/native/diagnostic-export.mjs";
import { createDiagnosticReviewController } from "../../services/diagnostics/controller.mjs";

function nativeSurfaceLocale() {
  const locale = globalThis.document?.documentElement?.lang;
  return locale === "en-US" ? "en-US" : "pt-BR";
}

export function createNativeDiagnosticReviewComposition({
  host,
  updateStatus = null,
  systemMetrics = null,
  updateHistory = null,
  diagnosticJournal = null,
  fileSpace = null,
  clipboard = globalThis.navigator?.clipboard ?? null,
  updateMaxAgeSeconds = undefined,
  localeProvider = nativeSurfaceLocale,
  clock = () => new Date().toISOString(),
}) {
  const diagnosticExport = fileSpace === null
    ? null
    : createNativeDiagnosticExport(fileSpace);
  const diagnosticCopy = clipboard === null
    ? null
    : createNativeDiagnosticCopy(clipboard);

  return createDiagnosticReviewController({
    host,
    updateStatus,
    systemMetrics,
    updateHistory,
    diagnosticJournal,
    diagnosticExport,
    diagnosticCopy,
    ...(updateMaxAgeSeconds === undefined
      ? {}
      : { updateMaxAgeSeconds }),
    localeProvider,
    clock,
  });
}
