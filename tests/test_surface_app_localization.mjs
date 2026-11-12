import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { LOCALIZATION_SCHEMA } from "../system/contracts/localization.mjs";
import { createLocaleProfile } from "../system/contracts/locale-profile.mjs";
import {
  SURFACE_RENDER_LIFECYCLE_SCHEMA,
  assertSurfaceRenderLifecycle,
} from "../system/contracts/surface-render-lifecycle.mjs";

function localizationPort() {
  return Object.freeze({
    schema: LOCALIZATION_SCHEMA,
    getLocale() {
      return "en-US";
    },
    getProfile() {
      return createLocaleProfile("en-US");
    },
    translate(messageId) {
      return messageId;
    },
    subscribe(listener) {
      listener("en-US");
      return () => {};
    },
  });
}

test("Surface lifecycle v4 requires the shared localization port", () => {
  const base = {
    schema: SURFACE_RENDER_LIFECYCLE_SCHEMA,
    subscribeRender() {
      return () => {};
    },
    getAppTarget() {
      return null;
    },
    setAppTarget() {
      return null;
    },
  };
  assert.throws(
    () => assertSurfaceRenderLifecycle(base),
    /compatible localization port/,
  );
  const lifecycle = Object.freeze({ ...base, localization: localizationPort() });
  assert.equal(assertSurfaceRenderLifecycle(lifecycle), lifecycle);
  assert.equal(SURFACE_RENDER_LIFECYCLE_SCHEMA, "ordax.surface-render-lifecycle/5");
});

test("Settings and System navigation consume the same localization owner", async () => {
  const settings = await readFile(
    new URL("../system/surface/ui/settings-overview-controls.mjs", import.meta.url),
    "utf8",
  );
  const system = await readFile(
    new URL("../system/surface/ui/system-overview-controls.mjs", import.meta.url),
    "utf8",
  );
  for (const source of [settings, system]) {
    assert.match(source, /const localization = lifecycle\.localization/);
    assert.match(source, /const t = localization\.translate/);
  }
  assert.match(settings, /t\("settings\.navigation\.aria"\)/);
  assert.match(settings, /t\(section\.messageId\)/);
  assert.match(system, /t\("system\.navigation\.aria"\)/);
  assert.match(system, /t\(section\.messageId\)/);
});

test("Account consumes the shared localization owner end to end", async () => {
  const account = await readFile(
    new URL("../system/surface/ui/account-overview-controls.mjs", import.meta.url),
    "utf8",
  );
  const accountCatalog = await readFile(
    new URL("../system/services/i18n/catalog/account.mjs", import.meta.url),
    "utf8",
  );

  assert.match(account, /const localization = lifecycle\.localization/);
  assert.match(account, /const t = localization\.translate/);
  assert.match(account, /t\("account\.navigation\.aria"\)/);
  assert.match(account, /t\("account\.identity\.title"\)/);
  assert.match(account, /t\("account\.card\.offlineQueue"\)/);
  assert.match(accountCatalog, /"account\.section\.overview": "Overview"/);
  assert.match(accountCatalog, /"account\.action\.signIn": "Sign in"/);
  assert.match(accountCatalog, /"account\.card\.queueDurable": "Persistent on this device"/);
  assert.doesNotMatch(
    account,
    /Conta|Sessão ativa|Sincronização|Nenhuma pendência|Fila offline|Aparência/,
  );
});

test("Projects app-owned translations are absent from OS during remove-first Gate A", async () => {
  const surface = await readFile(
    new URL("../system/services/i18n/surface.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(surface, /PROJECTS_SOURCE_MESSAGES|PROJECTS_ENGLISH_MESSAGES/);
  assert.doesNotMatch(surface, /"app\.projects\.title"/);
});

test("Internet product translations cannot leak back into the OS after Gate A", async () => {
  const surface = await readFile(new URL("../system/services/i18n/surface.mjs", import.meta.url), "utf8");
  const shell = await readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8");
  assert.ok(!surface.includes("catalog/internet.mjs"), "No product-owned Internet translations should remain in OS");
  assert.ok(!surface.includes("...INTERNET_SOURCE_MESSAGES"), "Internet-owned localization must not be spread in OS");
  assert.ok(!shell.includes('railButton("internet"'), "Unavailable Internet has no bundled launcher");
});

test("Network tray and quick panel consume the shared localization owner", async () => {
  const quick = await readFile(
    new URL("../system/surface/ui/network-quick-panel.mjs", import.meta.url),
    "utf8",
  );
  const tray = await readFile(
    new URL("../system/surface/ui/network-tray-controls.mjs", import.meta.url),
    "utf8",
  );
  const catalog = await readFile(
    new URL("../system/services/i18n/catalog/network.mjs", import.meta.url),
    "utf8",
  );

  for (const source of [quick, tray]) {
    assert.match(source, /assertSurfaceRenderLifecycle/);
    assert.match(source, /const localization = lifecycle\.localization/);
    assert.match(source, /const t = localization\.translate/);
    assert.match(source, /localization\.subscribe/);
    assert.match(source, /unsubscribeLocalization/);
  }
  assert.match(quick, /networkManagementActionMessageId/);
  assert.match(quick, /networkManagementFailureMessageId/);
  assert.match(quick, /network\.quick\.passwordLabel/);
  assert.match(tray, /labelMessageId/);
  assert.match(tray, /titleMessageId/);
  assert.match(catalog, /"network\.quick\.action\.scan": "Find networks"/);
  assert.match(catalog, /"network\.management\.error\.generic": "The Wi-Fi action could not be completed/);
  assert.doesNotMatch(
    quick,
    /Procurar redes|Conectado|Conectada|Senha de|Abrir Ajustes de rede|Digite a senha/,
  );
  assert.doesNotMatch(
    tray,
    /Rede indisponível|Nenhuma interface de rede observada|Rede por cabo conectada|Dados antigos/,
  );
});

test("Battery tray and quick panel consume the shared localization owner", async () => {
  const tray = await readFile(
    new URL("../system/surface/ui/battery-tray-controls.mjs", import.meta.url),
    "utf8",
  );
  const quick = await readFile(
    new URL("../system/surface/ui/battery-quick-panel.mjs", import.meta.url),
    "utf8",
  );
  const catalog = await readFile(
    new URL("../system/services/i18n/catalog/power.mjs", import.meta.url),
    "utf8",
  );

  for (const source of [tray, quick]) {
    assert.match(source, /assertSurfaceRenderLifecycle/);
    assert.match(source, /const localization = lifecycle\.localization/);
    assert.match(source, /const t = localization\.translate/);
    assert.match(source, /localization\.subscribe/);
    assert.match(source, /unsubscribeLocalization/);
  }
  assert.match(tray, /power\.tray\.stale\.title/);
  assert.match(quick, /power\.quick\.stateStale/);
  assert.match(catalog, /"power\.state\.charging": "Charging"/);
  assert.match(catalog, /"power\.quick\.unavailable\.state": "Battery status unavailable\."/);
  assert.doesNotMatch(
    tray,
    /Bateria não detectada|Dados antigos|Estado da bateria indisponível|energia externa conectada/,
  );
  assert.doesNotMatch(
    quick,
    /Carregando|Usando bateria|Carga completa|Nenhuma bateria válida|fonte de energia/,
  );
});

test("Notification center and first-party update history use shared localization", async () => {
  const center = await readFile(
    new URL("../system/surface/ui/notification-center-controls.mjs", import.meta.url),
    "utf8",
  );
  const presentation = await readFile(
    new URL("../system/services/notifications/presentation.mjs", import.meta.url),
    "utf8",
  );
  const catalog = await readFile(
    new URL("../system/services/i18n/catalog/notifications.mjs", import.meta.url),
    "utf8",
  );

  assert.match(center, /assertSurfaceRenderLifecycle/);
  assert.match(center, /notificationPresentationCopy/);
  assert.match(center, /localization\.subscribe/);
  assert.match(center, /notifications\.center\.title/);
  assert.match(presentation, /system-updates\.applied/);
  assert.match(presentation, /notifications\.update\.applied\.message/);
  assert.match(catalog, /"notifications\.center\.title": "Notifications"/);
  assert.match(catalog, /"notifications\.update\.rolledBack\.title": "Update rolled back"/);
  assert.doesNotMatch(
    center,
    /Abrir notificações|Fechar notificações|Marcar lidas|Limpar lidas|Ativar Não perturbe/,
  );
});

