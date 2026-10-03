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

test("Files primary journey consumes shared localization and live locale", async () => {
  const files = await readFile(
    new URL("../system/surface/ui/file-space-controls.mjs", import.meta.url),
    "utf8",
  );
  assert.match(files, /const localization = lifecycle\.localization/);
  assert.match(files, /const locale = \(\) => localization\.getLocale\(\)/);
  assert.match(files, /t\("files\.location\.recents"\)/);
  assert.match(files, /t\("files\.location\.trash"\)/);
  assert.match(files, /t\("files\.recents\.boundary"\)/);
  assert.match(files, /t\("files\.trash\.boundary"\)/);
  assert.match(files, /localeCompare\(right\.name, locale\(\)/);
  assert.doesNotMatch(files, /FILE_SEARCH_LOCALE/);
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

test("English catalog contains primary Files, Settings and System entries", async () => {
  const filesCatalog = await readFile(
    new URL("../system/services/i18n/catalog/files.mjs", import.meta.url),
    "utf8",
  );
  const settingsCatalog = await readFile(
    new URL("../system/services/i18n/catalog/settings.mjs", import.meta.url),
    "utf8",
  );
  const systemCatalog = await readFile(
    new URL("../system/services/i18n/catalog/system.mjs", import.meta.url),
    "utf8",
  );
  const localSessionCatalog = await readFile(
    new URL("../system/services/i18n/catalog/local-session.mjs", import.meta.url),
    "utf8",
  );

  assert.match(filesCatalog, /"files\.location\.trash": "Trash"/);
  assert.match(filesCatalog, /"files\.recents\.clearHistory": "Clear history"/);
  assert.match(filesCatalog, /"files\.trash\.restore": "Restore"/);
  assert.match(settingsCatalog, /"settings\.section\.regional": "Language and region"/);
  assert.match(settingsCatalog, /"settings\.notifications\.dnd\.title": "Do Not Disturb"/);
  assert.match(settingsCatalog, /"settings\.notifications\.sources\.title": "Sources that actually notify"/);
  assert.match(settingsCatalog, /"settings\.security\.title": "Lock this OrdaX"/);
  assert.match(settingsCatalog, /"settings\.security\.action\.lock": "Lock now"/);
  assert.match(settingsCatalog, /"settings\.security\.message\.changeFailed": "The local lock could not be changed\."/);
  assert.match(systemCatalog, /"system\.section\.diagnostics": "Diagnostics"/);
  assert.match(systemCatalog, /"system\.overview\.card\.productVersion": "Prototype version"/);
  assert.match(systemCatalog, /"system\.overview\.update\.status\.networkError": "No connection for updates"/);
  assert.match(systemCatalog, /"system\.overview\.update\.detail\.activationReady": "The candidate was revalidated/);
  assert.match(localSessionCatalog, /"localSession\.lock\.title": "Session locked"/);
  assert.match(localSessionCatalog, /"localSession\.lock\.message\.rateLimited": "Too many attempts\./);
});

test("Projects primary journey uses shared localization in PT-BR and English", async () => {
  const controls = await readFile(
    new URL("../system/apps/projects/ui/workspace-controls.mjs", import.meta.url),
    "utf8",
  );
  const catalog = await readFile(
    new URL("../system/services/i18n/catalog/projects.mjs", import.meta.url),
    "utf8",
  );

  assert.match(controls, /const localization = lifecycle\.localization/);
  assert.match(controls, /t\("projects\.action\.openFiles"\)/);
  assert.match(controls, /ordaxProjectsLocale/);
  assert.match(catalog, /"projects\.title": "Projetos"/);
  assert.match(catalog, /"projects\.title": "Projects"/);
  assert.match(catalog, /"projects\.status\.localOnly": "Somente local"/);
  assert.match(catalog, /"projects\.status\.localOnly": "Local only"/);
  assert.doesNotMatch(controls, /timeZone:\s*"America\/Bahia"/);
});

test("Notes and Internet primary journeys use the shared localization owner", async () => {
  const notes = await readFile(
    new URL("../system/apps/notes/ui/workspace-controls.mjs", import.meta.url),
    "utf8",
  );
  const internet = await readFile(
    new URL("../system/apps/internet/ui/browser-controls.mjs", import.meta.url),
    "utf8",
  );
  const notesCatalog = await readFile(
    new URL("../system/services/i18n/catalog/notes.mjs", import.meta.url),
    "utf8",
  );
  const internetCatalog = await readFile(
    new URL("../system/services/i18n/catalog/internet.mjs", import.meta.url),
    "utf8",
  );

  assert.match(notes, /const localization = lifecycle\.localization/);
  assert.match(notes, /buildShell\(documentObject, t\)/);
  assert.match(notes, /t\("notes\.search\.placeholder"\)/);
  assert.match(notes, /t\("notes\.nav\.trash"\)/);
  assert.match(notes, /ordaxNotesLocale/);
  assert.match(notesCatalog, /"notes\.action\.newNote": "New note"/);
  assert.match(notesCatalog, /"notes\.intelligence\.summary": "Summarize"/);
  assert.match(notesCatalog, /"notes\.filePicker\.openFailed": "This folder could not be opened\."/);
  assert.match(notesCatalog, /"notes\.prompt\.newProjectName": "New project name:"/);
  assert.match(notes, /t\("notes\.filePicker\.loading"\)/);
  assert.match(notes, /t\("notes\.confirm\.deleteForever"/);
  assert.match(notes, /formatNotesRelativeTime\(note\.updatedAt, Date\.now\(\), \{ locale: localization\.getLocale\(\)/);
  assert.doesNotMatch(
    notes,
    /Não foi possível salvar esta edição|Carregando imagem|Fechar seletor de arquivos|Nome do novo projeto|Use um endereço da web válido/,
  );

  assert.match(internet, /const localization = lifecycle\.localization/);
  assert.match(internet, /createView\(documentObject, snapshot, t\)/);
  assert.match(internet, /t\("internet\.toolbar\.aria"\)/);
  assert.match(internet, /t\("internet\.project\.save"\)/);
  assert.match(internet, /ordaxInternetLocale/);
  assert.match(internet, /formatHistoryVisit\(entry\.visitedAt, locale\(\)\)/);
  assert.doesNotMatch(internet, /toLocaleLowerCase\("pt-BR"\)/);
  assert.match(internetCatalog, /"internet\.action\.newTab": "New tab"/);
  assert.match(internetCatalog, /"internet\.project\.currentPage": "Current page"/);
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

