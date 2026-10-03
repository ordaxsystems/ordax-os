import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  createStudioLocalization,
  studioCatalogCoverage,
} from "../system/apps/studio/i18n.mjs";

function surfaceLocalization(initialLocale = "pt-BR") {
  let locale = initialLocale;
  const listeners = new Set();
  return Object.freeze({
    getLocale: () => locale,
    subscribe(listener) {
      listeners.add(listener);
      listener(locale);
      return () => listeners.delete(listener);
    },
    setLocale(next) {
      locale = next;
      for (const listener of [...listeners]) listener(locale);
    },
  });
}

test("Studio English catalog covers every source message", () => {
  assert.equal(studioCatalogCoverage("pt-BR").complete, true);
  assert.equal(studioCatalogCoverage("en-US").complete, true);
  assert.equal(studioCatalogCoverage("es-ES").complete, false);
});

test("Studio localization follows the shared Surface locale without owning locale state", () => {
  const owner = surfaceLocalization("pt-BR");
  const localization = createStudioLocalization(owner);
  assert.equal(localization.translate("studio.runtime.ready"), "Device Agent pronto");
  owner.setLocale("en-US");
  assert.equal(localization.getLocale(), "en-US");
  assert.equal(localization.translate("studio.runtime.ready"), "Device Agent ready");
  assert.equal(localization.translate("studio.metrics.read"), "Read");
  assert.equal(
    localization.translate("studio.security.readOnly"),
    "Read-only discovery. Mutation authority: none.",
  );
});

test("Studio unknown message ids fail closed", () => {
  const localization = createStudioLocalization(surfaceLocalization("en-US"));
  assert.throws(
    () => localization.translate("studio.missing"),
    /Unknown Studio localization message/,
  );
});

test("Studio workspace has no renderable Portuguese copy outside its catalog", async () => {
  const workspace = await readFile(
    new URL("../system/apps/studio/ui/workspace-controls.mjs", import.meta.url),
    "utf8",
  );
  for (const raw of [
    "Device Agent pronto",
    "Device Agent degradado",
    "Runtime ainda não conectado",
    "Leitura",
    "Escrita",
    "Descoberta somente-leitura. Autoridade de mutação: nenhuma.",
  ]) {
    assert.equal(workspace.includes(raw), false, `raw Studio copy escaped catalog: ${raw}`);
  }
  for (const messageId of [
    "studio.runtime.ready",
    "studio.runtime.degraded",
    "studio.runtime.disconnected",
    "studio.metrics.capabilities",
    "studio.metrics.read",
    "studio.metrics.write",
    "studio.security.readOnly",
  ]) {
    assert.equal(workspace.includes(messageId), true, `missing Studio message id: ${messageId}`);
  }
  assert.match(workspace, /createStudioLocalization\(lifecycle\.localization\)/);
  assert.match(workspace, /localization\.subscribe\(\(\) => render\(\)\)/);
});
