import { LOCALIZATION_SCHEMA, assertLocalizationPort } from "../../contracts/localization.mjs";
import { createLocaleProfile } from "../../contracts/locale-profile.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { REGIONAL_LOCALE_PREFERENCE_ID } from "../preferences/regional.mjs";
import { interpolateLocalizationMessage } from "./interpolation.mjs";
import { FILES_SOURCE_MESSAGES, FILES_ENGLISH_MESSAGES } from "./catalog/files.mjs";
import { SETTINGS_SOURCE_MESSAGES, SETTINGS_ENGLISH_MESSAGES } from "./catalog/settings.mjs";
import { STORE_SOURCE_MESSAGES, STORE_ENGLISH_MESSAGES } from "./catalog/store.mjs";
import { SYSTEM_SOURCE_MESSAGES, SYSTEM_ENGLISH_MESSAGES } from "./catalog/system.mjs";
import { SYSTEM_DIAGNOSTICS_SOURCE_MESSAGES, SYSTEM_DIAGNOSTICS_ENGLISH_MESSAGES } from "./catalog/system-diagnostics.mjs";
import { INTERNET_SOURCE_MESSAGES, INTERNET_ENGLISH_MESSAGES } from "./catalog/internet.mjs";
import { PROJECTS_SOURCE_MESSAGES, PROJECTS_ENGLISH_MESSAGES } from "./catalog/projects.mjs";
import { ACCOUNT_SOURCE_MESSAGES, ACCOUNT_ENGLISH_MESSAGES } from "./catalog/account.mjs";
import { ASSISTANT_SOURCE_MESSAGES, ASSISTANT_ENGLISH_MESSAGES } from "./catalog/assistant.mjs";
import { ACTIVITY_SOURCE_MESSAGES, ACTIVITY_ENGLISH_MESSAGES } from "./catalog/activity.mjs";
import { NETWORK_SOURCE_MESSAGES, NETWORK_ENGLISH_MESSAGES } from "./catalog/network.mjs";
import { NETWORK_APP_SOURCE_MESSAGES, NETWORK_APP_ENGLISH_MESSAGES } from "./catalog/network-app.mjs";
import { POWER_SOURCE_MESSAGES, POWER_ENGLISH_MESSAGES } from "./catalog/power.mjs";
import { NOTIFICATIONS_SOURCE_MESSAGES, NOTIFICATIONS_ENGLISH_MESSAGES } from "./catalog/notifications.mjs";
import { LOCAL_SESSION_SOURCE_MESSAGES, LOCAL_SESSION_ENGLISH_MESSAGES } from "./catalog/local-session.mjs";

export const SURFACE_SOURCE_LOCALE = "pt-BR";
export const SURFACE_COMPLETE_LOCALES = Object.freeze(["pt-BR", "en-US"]);
export const SURFACE_ENGLISH_TARGET_LOCALE = "en-US";

const SOURCE = Object.freeze({
  "shell.rail.aria": "Aplicativos principais",
  "shell.home.title": "Início",
  "shell.home.tagline": "Inteligência no centro.",
  "shell.home.quickAccess": "Acesso rápido",
  "shell.home.loadingDate": "Carregando data…",
  "shell.launcher.command": "Abrir aplicativo…",
  "shell.space.title": "Seu espaço",
  "shell.space.documents": "Documentos",
  "shell.space.images": "Imagens",
  "shell.space.downloads": "Downloads",
  "shell.slogan": "IDEIAS\nORGANIZAM\nREALIDADES",
  "shell.launcher.dialog": "Abrir aplicativo",
  "shell.launcher.search": "Pesquisar aplicativos",
  "shell.statusbar.aria": "Estado e áreas da Surface",
  "shell.areas.aria": "Áreas de trabalho",
  "shell.runningApps.aria": "Aplicações abertas",
  "shell.systemStatus.aria": "Estado do sistema",
  "shell.network.quickOpen": "Abrir acesso rápido de Wi-Fi",
  "shell.battery.quickOpen": "Abrir estado da bateria",
  "shell.datetime.quickOpen": "Abrir data e hora",
  "shell.quick.access": "Acesso rápido",
  "shell.quick.wifiClose": "Fechar acesso rápido de Wi-Fi",
  "shell.quick.wifiReading": "Lendo estado do Wi-Fi…",
  "shell.quick.energy": "Energia",
  "shell.quick.battery": "Bateria",
  "shell.quick.batteryClose": "Fechar estado da bateria",
  "shell.quick.batteryReading": "Lendo estado da bateria…",
  "shell.quick.powerSource": "Fonte de energia",
  "shell.quick.checking": "Verificando…",
  "shell.quick.dateTime": "Data e hora",
  "shell.quick.dateTimeClose": "Fechar data e hora",
  "shell.quick.timeZone": "Fuso horário",
  "shell.clock.timeZone": "Fuso horário: {timeZone}",
  "surface.boot.loadingSurface": "Carregando superfície…",
  "surface.boot.loadingApps": "Carregando aplicativos…",
  "surface.boot.preparingFirstRun": "Preparando primeiro uso…",
  "surface.boot.failed": "Não foi possível iniciar a interface",
  "home.continuation.heading": "Continuar trabalho",
  "home.continuation.activityUnknown": "atividade desconhecida",
  "home.continuation.sessionSuffix": " · somente nesta sessão",
  "home.continuation.projectDetail": "Projeto · {path} · {activity}{persistence}",
  "home.continuation.projectAction": "Continuar projeto {name}",
  "home.continuation.recentDetail": "Arquivo recente · {folder} · {activity}{persistence}",
  "home.continuation.recentAction": "Mostrar {name} em Arquivos",
  "home.pending.heading": "Pendências",
  "home.pending.notifications.title.one": "1 notificação não lida",
  "home.pending.notifications.title.many": "{count} notificações não lidas",
  "home.pending.notifications.detail.center": "Central de Notificações",
  "home.pending.notifications.detail.dnd": "Não perturbe ativo",
  "home.pending.notifications.detail.session": "histórico somente nesta sessão",
  "home.pending.notifications.action.one": "Abrir notificações — 1 não lida",
  "home.pending.notifications.action.many": "Abrir notificações — {count} não lidas",
  "home.pending.sync.title.one": "1 alteração local pendente",
  "home.pending.sync.title.many": "{count} alterações locais pendentes",
  "home.pending.sync.transport.available": "transporte disponível",
  "home.pending.sync.transport.unavailable": "transporte remoto não está ativo",
  "home.pending.sync.account.active": "continuidade de conta ativa",
  "home.pending.sync.account.inactive": "continuidade de conta não está ativa",
  "home.pending.sync.queue.device": "fila salva neste dispositivo",
  "home.pending.sync.queue.session": "fila somente nesta sessão",
  "home.pending.sync.action": "Abrir Conta em Sincronização",

  "surface.connectivity.online": "Online",
  "surface.connectivity.offline": "Offline",
  "surface.connectivity.unknown": "Conectividade desconhecida",
  "surface.area.label": "Área {ordinal}",
  "surface.capability.available": "Disponível",
  "surface.capability.unavailable": "Indisponível neste host",
  "surface.capability.none": "Nenhuma capacidade adicional foi declarada.",
  "surface.window.move": "Mover {app}. Use Alt mais setas ou arraste quando houver espaço.",
  "surface.window.minimize": "Minimizar {app}",
  "surface.window.maximize": "Maximizar {app}",
  "surface.window.restore": "Restaurar {app}",
  "surface.window.close": "Fechar {app}",
  "surface.launcher.open": "Abrir {app}",
  "surface.launcher.unavailable": "{app} indisponível",
  "surface.launcher.requirementsUnavailable": "Capacidades necessárias indisponíveis",
  "surface.launcher.empty": "Nenhum aplicativo encontrado.",
  "surface.dock.restore": "Restaurar {app}",
  "surface.dock.focus": "Focar {app}",
  "surface.area.switch": "Mudar para {area}",
  "surface.area.create": "Criar nova área de trabalho",
  "surface.network.label": "Rede: {status}",
  "surface.capability.destinationRequired": "Este destino requer o espaço local do usuário.",

  "app.files.title": "Arquivos",
  "app.files.description": "Organize documentos, imagens, downloads e conteúdo persistente do usuário.",
  "app.files.panel.0.label": "Espaço do usuário",
  "app.files.panel.0.title": "Arquivos",
  "app.files.panel.0.body": "Este host não expõe um espaço local de arquivos para esta Surface.",
  "app.projects.title": "Projetos",
  "app.projects.description": "Organize projetos locais, conexões e continuidade entre dispositivos.",
  "app.projects.panel.0.label": "Projetos",
  "app.projects.panel.0.title": "Seu trabalho",
  "app.projects.panel.0.body": "O catálogo de projetos não está disponível nesta composição.",
  "app.studio.title": "ORDAX Studio",
  "app.studio.description": "Acesse seus projetos e confira a integração do Studio com este host.",
  "app.studio.panel.0.label": "Studio",
  "app.studio.panel.0.title": "ORDAX Studio",
  "app.studio.panel.0.body": "O runtime do Studio ainda não está disponível nesta composição.",
  "app.notes.title": "Notas",
  "app.notes.description": "Escrita local, projetos, tarefas e referências disponíveis offline.",
  "app.notes.panel.0.label": "Notas",
  "app.notes.panel.0.title": "Seu espaço de escrita",
  "app.notes.panel.0.body": "O espaço local de Notas não está disponível nesta composição.",
  "app.internet.title": "Internet",
  "app.internet.description": "Navegue, organize referências e conecte pesquisa ao seu trabalho.",
  "app.internet.panel.0.label": "Navegador",
  "app.internet.panel.0.title": "Internet",
  "app.internet.panel.0.body": "A navegação integrada depende de um engine isolado fornecido pelo host.",
  "app.network.title": "Rede",
  "app.network.description": "Comunidades profissionais e mensagens vinculadas explicitamente ao Space remetente.",
  "app.network.panel.0.label": "Rede",
  "app.network.panel.0.title": "Rede profissional",
  "app.network.panel.0.body": "O backend da Rede ainda não está ativo nesta composição.",
  "app.settings.title": "Ajustes",
  "app.settings.description": "Preferências compartilhadas, aparência e rede do OrdaX.",
  "app.settings.panel.0.label": "Ajustes",
  "app.settings.panel.0.title": "Preferências do OrdaX",
  "app.settings.panel.0.body": "As preferências desta Surface não estão disponíveis neste host.",
  "app.account.title": "Conta",
  "app.account.description": "Identidade, acesso e continuidade segura entre os modos do OrdaX.",
  "app.account.panel.0.label": "Conta",
  "app.account.panel.0.title": "Identidade e continuidade",
  "app.account.panel.0.body": "Este host não oferece uma integração de identidade para esta Surface.",
  "app.store.title": "Loja",
  "app.store.description": "Descubra aplicativos verificados e solicite instalação pelo lifecycle da plataforma.",
  "app.store.panel.0.label": "Loja",
  "app.store.panel.0.title": "Aplicativos OrdaX",
  "app.store.panel.0.body": "O catálogo verificado ainda não está disponível neste host.",
  "app.system.title": "Sistema",
  "app.system.description": "Entrega, atualizações, conectividade e recursos desta execução do OrdaX.",
  "app.system.panel.0.label": "Sistema",
  "app.system.panel.0.title": "Visão geral",
  "app.system.panel.0.body": "O estado detalhado do sistema não está disponível neste host.",
  ...FILES_SOURCE_MESSAGES,
  ...SETTINGS_SOURCE_MESSAGES,
  ...STORE_SOURCE_MESSAGES,
  ...SYSTEM_SOURCE_MESSAGES,
  ...SYSTEM_DIAGNOSTICS_SOURCE_MESSAGES,
  ...ACCOUNT_SOURCE_MESSAGES,
  ...ASSISTANT_SOURCE_MESSAGES,
  ...ACTIVITY_SOURCE_MESSAGES,
  ...INTERNET_SOURCE_MESSAGES,
  ...PROJECTS_SOURCE_MESSAGES,
  ...NETWORK_SOURCE_MESSAGES,
  ...NETWORK_APP_SOURCE_MESSAGES,
  ...POWER_SOURCE_MESSAGES,
  ...NOTIFICATIONS_SOURCE_MESSAGES,
  ...LOCAL_SESSION_SOURCE_MESSAGES
});

const ENGLISH = Object.freeze({
  "shell.rail.aria": "Main applications",
  "shell.home.title": "Home",
  "shell.home.tagline": "Intelligence at the core.",
  "shell.home.quickAccess": "Quick access",
  "shell.home.loadingDate": "Loading date…",
  "shell.launcher.command": "Open application…",
  "shell.space.title": "Your space",
  "shell.space.documents": "Documents",
  "shell.space.images": "Pictures",
  "shell.space.downloads": "Downloads",
  "shell.slogan": "IDEAS\nORGANIZE\nREALITIES",
  "shell.launcher.dialog": "Open application",
  "shell.launcher.search": "Search applications",
  "shell.statusbar.aria": "Surface status and workspaces",
  "shell.areas.aria": "Workspaces",
  "shell.runningApps.aria": "Open applications",
  "shell.systemStatus.aria": "System status",
  "shell.network.quickOpen": "Open Wi-Fi quick access",
  "shell.battery.quickOpen": "Open battery status",
  "shell.datetime.quickOpen": "Open date and time",
  "shell.quick.access": "Quick access",
  "shell.quick.wifiClose": "Close Wi-Fi quick access",
  "shell.quick.wifiReading": "Reading Wi-Fi status…",
  "shell.quick.energy": "Power",
  "shell.quick.battery": "Battery",
  "shell.quick.batteryClose": "Close battery status",
  "shell.quick.batteryReading": "Reading battery status…",
  "shell.quick.powerSource": "Power source",
  "shell.quick.checking": "Checking…",
  "shell.quick.dateTime": "Date and time",
  "shell.quick.dateTimeClose": "Close date and time",
  "shell.quick.timeZone": "Time zone",
  "shell.clock.timeZone": "Time zone: {timeZone}",
  "surface.boot.loadingSurface": "Loading Surface…",
  "surface.boot.loadingApps": "Loading applications…",
  "surface.boot.preparingFirstRun": "Preparing first use…",
  "surface.boot.failed": "The interface could not be started",
  "home.continuation.heading": "Continue working",
  "home.continuation.activityUnknown": "unknown activity",
  "home.continuation.sessionSuffix": " · this session only",
  "home.continuation.projectDetail": "Project · {path} · {activity}{persistence}",
  "home.continuation.projectAction": "Continue project {name}",
  "home.continuation.recentDetail": "Recent file · {folder} · {activity}{persistence}",
  "home.continuation.recentAction": "Show {name} in Files",
  "home.pending.heading": "Pending",
  "home.pending.notifications.title.one": "1 unread notification",
  "home.pending.notifications.title.many": "{count} unread notifications",
  "home.pending.notifications.detail.center": "Notification Center",
  "home.pending.notifications.detail.dnd": "Do Not Disturb active",
  "home.pending.notifications.detail.session": "history for this session only",
  "home.pending.notifications.action.one": "Open notifications — 1 unread",
  "home.pending.notifications.action.many": "Open notifications — {count} unread",
  "home.pending.sync.title.one": "1 pending local change",
  "home.pending.sync.title.many": "{count} pending local changes",
  "home.pending.sync.transport.available": "transport available",
  "home.pending.sync.transport.unavailable": "remote transport is not active",
  "home.pending.sync.account.active": "account continuity active",
  "home.pending.sync.account.inactive": "account continuity is not active",
  "home.pending.sync.queue.device": "queue saved on this device",
  "home.pending.sync.queue.session": "queue for this session only",
  "home.pending.sync.action": "Open Account in Sync",

  "surface.connectivity.online": "Online",
  "surface.connectivity.offline": "Offline",
  "surface.connectivity.unknown": "Connectivity unknown",
  "surface.area.label": "Area {ordinal}",
  "surface.capability.available": "Available",
  "surface.capability.unavailable": "Unavailable on this host",
  "surface.capability.none": "No additional capabilities were declared.",
  "surface.window.move": "Move {app}. Use Alt plus arrow keys or drag when there is space.",
  "surface.window.minimize": "Minimize {app}",
  "surface.window.maximize": "Maximize {app}",
  "surface.window.restore": "Restore {app}",
  "surface.window.close": "Close {app}",
  "surface.launcher.open": "Open {app}",
  "surface.launcher.unavailable": "{app} unavailable",
  "surface.launcher.requirementsUnavailable": "Required capabilities unavailable",
  "surface.launcher.empty": "No applications found.",
  "surface.dock.restore": "Restore {app}",
  "surface.dock.focus": "Focus {app}",
  "surface.area.switch": "Switch to {area}",
  "surface.area.create": "Create a new workspace",
  "surface.network.label": "Network: {status}",
  "surface.capability.destinationRequired": "This destination requires local user storage.",

  "app.files.title": "Files",
  "app.files.description": "Organize documents, pictures, downloads, and persistent user content.",
  "app.files.panel.0.label": "User space",
  "app.files.panel.0.title": "Files",
  "app.files.panel.0.body": "This host does not expose local file storage to this Surface.",
  "app.projects.title": "Projects",
  "app.projects.description": "Organize local projects, connections, and continuity across devices.",
  "app.projects.panel.0.label": "Projects",
  "app.projects.panel.0.title": "Your work",
  "app.projects.panel.0.body": "The project catalog is unavailable in this composition.",
  "app.studio.title": "ORDAX Studio",
  "app.studio.description": "Access your projects and check Studio integration with this host.",
  "app.studio.panel.0.label": "Studio",
  "app.studio.panel.0.title": "ORDAX Studio",
  "app.studio.panel.0.body": "The Studio runtime is not yet available in this composition.",
  "app.notes.title": "Notes",
  "app.notes.description": "Local writing, projects, tasks, and references available offline.",
  "app.notes.panel.0.label": "Notes",
  "app.notes.panel.0.title": "Your writing space",
  "app.notes.panel.0.body": "The local Notes workspace is unavailable in this composition.",
  "app.internet.title": "Internet",
  "app.internet.description": "Browse, organize references, and connect research to your work.",
  "app.internet.panel.0.label": "Browser",
  "app.internet.panel.0.title": "Internet",
  "app.internet.panel.0.body": "Integrated browsing depends on an isolated engine supplied by the host.",
  "app.network.title": "Network",
  "app.network.description": "Professional communities and messages explicitly bound to the sender Space.",
  "app.network.panel.0.label": "Network",
  "app.network.panel.0.title": "Professional network",
  "app.network.panel.0.body": "The Network backend is not active in this composition yet.",
  "app.settings.title": "Settings",
  "app.settings.description": "Shared preferences, appearance, and OrdaX network settings.",
  "app.settings.panel.0.label": "Settings",
  "app.settings.panel.0.title": "OrdaX preferences",
  "app.settings.panel.0.body": "Surface preferences are unavailable on this host.",
  "app.account.title": "Account",
  "app.account.description": "Identity, access, and secure continuity across OrdaX modes.",
  "app.account.panel.0.label": "Account",
  "app.account.panel.0.title": "Identity and continuity",
  "app.account.panel.0.body": "This host does not provide identity integration for this Surface.",
  "app.store.title": "Store",
  "app.store.description": "Discover verified apps and request installation through the platform lifecycle.",
  "app.store.panel.0.label": "Store",
  "app.store.panel.0.title": "OrdaX applications",
  "app.store.panel.0.body": "The verified catalog is not available on this host yet.",
  "app.system.title": "System",
  "app.system.description": "Delivery, updates, connectivity, and resources for this OrdaX run.",
  "app.system.panel.0.label": "System",
  "app.system.panel.0.title": "Overview",
  "app.system.panel.0.body": "Detailed system status is unavailable on this host.",
  ...FILES_ENGLISH_MESSAGES,
  ...SETTINGS_ENGLISH_MESSAGES,
  ...STORE_ENGLISH_MESSAGES,
  ...SYSTEM_ENGLISH_MESSAGES,
  ...SYSTEM_DIAGNOSTICS_ENGLISH_MESSAGES,
  ...ACCOUNT_ENGLISH_MESSAGES,
  ...ASSISTANT_ENGLISH_MESSAGES,
  ...ACTIVITY_ENGLISH_MESSAGES,
  ...INTERNET_ENGLISH_MESSAGES,
  ...PROJECTS_ENGLISH_MESSAGES,
  ...NETWORK_ENGLISH_MESSAGES,
  ...NETWORK_APP_ENGLISH_MESSAGES,
  ...POWER_ENGLISH_MESSAGES,
  ...NOTIFICATIONS_ENGLISH_MESSAGES,
  ...LOCAL_SESSION_ENGLISH_MESSAGES
});

const TABLES = Object.freeze({
  [SURFACE_SOURCE_LOCALE]: SOURCE,
  [SURFACE_ENGLISH_TARGET_LOCALE]: ENGLISH,
});

export function translateSurfaceMessage(locale, messageId, values = {}) {
  if (typeof messageId !== "string" || !messageId) {
    throw new TypeError("Localization message id must be a non-empty string");
  }
  const source = SOURCE[messageId];
  if (typeof source !== "string") {
    throw new TypeError(`Unknown Surface localization message: ${messageId}`);
  }
  const translated = TABLES[locale]?.[messageId] ?? source;
  return interpolateLocalizationMessage(translated, values);
}

export function createSurfaceLocalization(preferenceRuntime) {
  const preferences = assertPreferenceRuntimePort(preferenceRuntime);
  let observedLocale = preferences.getSnapshot()[REGIONAL_LOCALE_PREFERENCE_ID] ?? SURFACE_SOURCE_LOCALE;
  const listeners = new Set();
  const currentLocale = () => preferences.getSnapshot()[REGIONAL_LOCALE_PREFERENCE_ID] ?? SURFACE_SOURCE_LOCALE;

  const translate = (messageId, values = {}) =>
    translateSurfaceMessage(currentLocale(), messageId, values);

  const port = {
    schema: LOCALIZATION_SCHEMA,
    getLocale() { return currentLocale(); },
    getProfile() { return createLocaleProfile(currentLocale()); },
    translate,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Localization listener must be a function");
      listeners.add(listener);
      listener(currentLocale());
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribePreferences();
      listeners.clear();
    },
  };

  const unsubscribePreferences = preferences.subscribe((snapshot) => {
    const next = snapshot[REGIONAL_LOCALE_PREFERENCE_ID] ?? SURFACE_SOURCE_LOCALE;
    if (next === observedLocale) return;
    observedLocale = next;
    for (const listener of [...listeners]) listener(observedLocale);
  });

  assertLocalizationPort(port);
  return Object.freeze(port);
}

export function surfaceMessageIds() {
  return Object.freeze(Object.keys(SOURCE));
}

export function surfaceCatalogCoverage(locale) {
  const table = TABLES[locale] ?? null;
  const sourceIds = Object.keys(SOURCE);
  const tableIds = table ? Object.keys(table) : [];
  const total = sourceIds.length;
  const translated = table
    ? sourceIds.reduce((count, messageId) => count + (typeof table[messageId] === "string" ? 1 : 0), 0)
    : 0;
  const exactIdentity = table !== null
    && tableIds.length === total
    && sourceIds.every((messageId) => Object.prototype.hasOwnProperty.call(table, messageId))
    && tableIds.every((messageId) => Object.prototype.hasOwnProperty.call(SOURCE, messageId));
  return Object.freeze({
    locale,
    sourceLocale: SURFACE_SOURCE_LOCALE,
    translated,
    total,
    complete: locale === SURFACE_SOURCE_LOCALE || exactIdentity,
  });
}
