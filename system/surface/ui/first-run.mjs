import { assertFirstRunStateStore } from "../../contracts/first-run-state-store.mjs";
import { FIRST_RUN_APP_SELECTION_SCHEMA } from "../../services/apps/first-run-selection.mjs";
import { assertIdentityActionsPort, isIdentityActionSupported } from "../../contracts/identity-actions.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { assertIdentityCredentialsPort, sameRegistrationLegalPolicy } from "../../contracts/identity-credentials.mjs";
import { assertLocalSessionPort, validateLocalSessionSnapshot } from "../../contracts/local-session.mjs";
import { assertNetworkManagementPort } from "../../contracts/network-management.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { assertKeyboardLayoutPort, validateKeyboardLayoutSnapshot } from "../../contracts/keyboard-layout.mjs";
import { assertDeviceProfilePort, validateDeviceDisplayName } from "../../contracts/device-profile.mjs";
import { assertPowerActionsPort, isPowerActionSupported } from "../../contracts/power-actions.mjs";
import { createLocaleProfile } from "../../contracts/locale-profile.mjs";
import {
  REGIONAL_LOCALE_OPTIONS,
  REGIONAL_LOCALE_PREFERENCE_ID,
  REGIONAL_TIME_ZONE_OPTIONS,
  REGIONAL_TIME_ZONE_PREFERENCE_ID,
  isSupportedRegionalTimeZone,
} from "../../services/preferences/regional.mjs";
import { MEMORY_AUTO_CAPTURE_PREFERENCE_ID } from "../../services/preferences/memory.mjs";
import { translateFirstRunText } from "../../services/i18n/first-run.mjs";
import {
  completeFirstRunState,
  matchesFirstRunIdentitySelection,
  validateFirstRunState,
  verifyFirstRunIdentitySession,
} from "../../services/state/first-run.mjs";
import {
  networkManagementActionMessage,
  networkManagementFailureMessage,
  runNetworkManagementAction,
} from "../../services/network/management-runtime.mjs";

const STEPS = Object.freeze([
  "welcome", "language", "keyboard", "region", "network", "account",
  "security", "privacy", "name", "review", "complete",
]);
const STEP_LABELS = Object.freeze([
  "Boas-vindas", "Idioma", "Teclado", "Região", "Rede", "Conta",
  "Proteção", "Privacidade", "Dispositivo", "Revisão", "Concluído",
]);
const KEYBOARD_LABELS = Object.freeze({ "br-abnt2": "Português (Brasil) · ABNT2", us: "English (US)" });

function syncFirstRunDocumentLocale(documentObject, locale) {
  const profile = createLocaleProfile(locale);
  documentObject.documentElement.lang = profile.locale;
  documentObject.documentElement.dir = profile.direction;
  return profile;
}

function el(documentObject, tag, className = "", text = undefined) {
  const node = documentObject.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) {
    const locale = documentObject.documentElement?.lang || "pt-BR";
    node.textContent = translateFirstRunText(locale, text);
  }
  return node;
}

function action(documentObject, label, id, primary = false) {
  const button = el(documentObject, "button", primary
    ? "ordax-first-run-action ordax-first-run-action-primary"
    : "ordax-first-run-action", label);
  button.type = "button";
  button.dataset.firstRunAction = id;
  return button;
}

function signalLabel(dbm) {
  if (dbm >= -50) return "Sinal forte";
  if (dbm >= -60) return "Sinal bom";
  if (dbm >= -70) return "Sinal regular";
  return "Sinal fraco";
}

function passwordField(documentObject, { label, value, datasetKey, visible, disabled = false, autocomplete = "off", minLength = null }) {
  const field = el(documentObject, "label", "ordax-first-run-field");
  field.append(el(documentObject, "span", "", label));
  const row = el(documentObject, "div", "ordax-first-run-secret-row");
  const input = documentObject.createElement("input");
  input.type = visible ? "text" : "password";
  input.autocomplete = autocomplete;
  input.maxLength = 1024;
  if (minLength !== null) input.minLength = minLength;
  input.value = value;
  input.disabled = disabled;
  input.dataset[datasetKey] = "";
  const reveal = action(documentObject, visible ? "Ocultar" : "Mostrar", `toggle-${datasetKey}`);
  reveal.classList.add("ordax-first-run-secret-toggle");
  reveal.setAttribute("aria-pressed", String(visible));
  reveal.disabled = disabled;
  row.append(input, reveal);
  field.append(row);
  return { field, input };
}

export function mountFirstRunExperience(root, {
  stateStore,
  firstRunAppSelection = null,
  preferences,
  networkManagement = null,
  keyboardLayout = null,
  deviceProfile = null,
  powerActions = null,
  identitySession,
  identityActions,
  identityCredentials = null,
  localSession = null,
}) {
  if (!(root instanceof Element)) throw new TypeError("First-run experience requires the Surface root Element");
  const store = assertFirstRunStateStore(stateStore);
  const preferencePort = assertPreferenceRuntimePort(preferences);
  if (typeof preferencePort.setManyConfirmed !== "function") {
    throw new TypeError("First Run requires confirmed preference persistence");
  }
  const networkPort = networkManagement === null ? null : assertNetworkManagementPort(networkManagement);
  const keyboardPort = keyboardLayout === null ? null : assertKeyboardLayoutPort(keyboardLayout);
  const deviceProfilePort = deviceProfile === null ? null : assertDeviceProfilePort(deviceProfile);
  const powerPort = powerActions === null ? null : assertPowerActionsPort(powerActions);
  const sessionPort = assertIdentitySessionPort(identitySession);
  const actionsPort = assertIdentityActionsPort(identityActions);
  const credentialsPort = identityCredentials === null ? null : assertIdentityCredentialsPort(identityCredentials);
  const localSessionPort = localSession === null ? null : assertLocalSessionPort(localSession);
  const initial = validateFirstRunState(store.load());

  if (firstRunAppSelection !== null && (
    firstRunAppSelection.schema !== FIRST_RUN_APP_SELECTION_SCHEMA
    || firstRunAppSelection.authority !== "none"
    || firstRunAppSelection.installedByThisPlan !== false
    || firstRunAppSelection.mayInstallWithoutVerifiedLifecycle !== false
    || !Array.isArray(firstRunAppSelection.alreadyInstalledAppIds)
    || !Array.isArray(firstRunAppSelection.eligibleCandidateAppIds)
    || !Array.isArray(firstRunAppSelection.suppressedAppIds)
    || !Array.isArray(firstRunAppSelection.unavailableAppIds)
  )) throw new TypeError("First Run application overview requires a verified authority-free plan");
  if (initial.completed) return Object.freeze({ shown: false, destroy() {} });

  const documentObject = root.ownerDocument;
  const preferenceInitial = preferencePort.getSnapshot();
  const keyboardInitial = keyboardPort ? validateKeyboardLayoutSnapshot(keyboardPort.getSnapshot()) : null;
  const deviceInitial = deviceProfilePort?.getSnapshot() ?? null;
  let detectedTimeZone = null;
  try { detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { detectedTimeZone = null; }
  const draft = {
    locale: initial.locale,
    timeZone: isSupportedRegionalTimeZone(detectedTimeZone) ? detectedTimeZone : initial.timeZone,
    keyboardLayoutId: keyboardInitial?.configuredLayoutId ?? null,
    accountMode: null,
    memoryAutoCapture: preferenceInitial[MEMORY_AUTO_CAPTURE_PREFERENCE_ID] ?? "on",
    deviceName: deviceInitial?.displayName ?? "Meu OrdaX",
  };
  syncFirstRunDocumentLocale(documentObject, draft.locale);

  const previousInert = root.inert;
  const previousAriaHidden = root.getAttribute("aria-hidden");
  root.inert = true;
  root.setAttribute("aria-hidden", "true");
  const overlay = el(documentObject, "section", "ordax-first-run");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "ordax-first-run-title");
  const shell = el(documentObject, "div", "ordax-first-run-shell");
  const progress = el(documentObject, "aside", "ordax-first-run-progress");
  progress.setAttribute("aria-label", "Progresso da configuração");
  const card = el(documentObject, "main", "ordax-first-run-card");
  shell.append(progress, card);
  overlay.append(shell);
  documentObject.body.append(overlay);

  let stepIndex = 0;
  let destroyed = false;
  let finishing = false;
  let completionPersisted = false;
  let completionError = "";
  let networkSnapshot = null;
  let networkPending = false;
  let networkMessage = "";
  let networkOrdinal = 0;
  let selectedSsid = null;
  let wifiPasswordDraft = "";
  let wifiPasswordVisible = false;
  let keyboardSnapshot = keyboardInitial;
  let keyboardMessage = "";
  let sessionSnapshot = sessionPort.getSnapshot();
  let actionsSnapshot = actionsPort.getSnapshot();
  let identityPending = null;
  let identityMessage = "";
  let identityEmailDraft = "";
  let identityPasswordDraft = "";
  let identityPasswordVisible = false;
  let identityRecoveryOpen = false;
  let selectedIdentitySubjectId = null;
  let registrationPolicy = null;
  let registrationLegalAccepted = false;
  let registrationPolicyPending = false;
  let localSessionSnapshot = localSessionPort === null ? null : validateLocalSessionSnapshot(localSessionPort.getSnapshot());
  let localSessionPending = false;
  let localSessionMessage = "";
  let localSessionSecretDraft = "";
  let localSessionConfirmDraft = "";
  let localSessionSecretVisible = false;
  let powerPending = false;
  let unsubscribeSession = null;
  let unsubscribeActions = null;
  let unsubscribeLocalSession = null;

  const restoreRoot = () => {
    root.inert = previousInert;
    if (previousAriaHidden === null) root.removeAttribute("aria-hidden");
    else root.setAttribute("aria-hidden", previousAriaHidden);
  };
  const clearSecrets = () => {
    wifiPasswordDraft = "";
    identityPasswordDraft = "";
    localSessionSecretDraft = "";
    localSessionConfirmDraft = "";
  };
  const close = () => {
    if (destroyed) return;
    destroyed = true;
    networkOrdinal += 1;
    clearSecrets();
    selectedIdentitySubjectId = null;
    unsubscribeLocalSession?.(); unsubscribeSession?.(); unsubscribeActions?.();
    overlay.removeEventListener("click", onClick);
    overlay.removeEventListener("input", onInput);
    overlay.removeEventListener("change", onChange);
    overlay.removeEventListener("keydown", onKeyDown);
    overlay.remove();
    restoreRoot();
  };
  const heading = (eyebrow, title, detail) => {
    const header = el(documentObject, "header", "ordax-first-run-header");
    const titleNode = el(documentObject, "h1", "", title);
    titleNode.id = "ordax-first-run-title";
    titleNode.tabIndex = -1;
    header.append(el(documentObject, "span", "ordax-first-run-eyebrow", eyebrow), titleNode, el(documentObject, "p", "", detail));
    return header;
  };
  const status = (body, message, role = "status") => {
    if (!message) return;
    const node = el(documentObject, "p", role === "alert" ? "ordax-first-run-error" : "ordax-first-run-status", message);
    node.setAttribute("role", role);
    node.setAttribute("aria-live", role === "alert" ? "assertive" : "polite");
    body.append(node);
  };
  const renderProgress = () => {
    progress.replaceChildren();
    const brand = el(documentObject, "div", "ordax-first-run-brand");
    brand.append(el(documentObject, "strong", "", "OrdaX"), el(documentObject, "span", "", "Configuração inicial"));
    const list = el(documentObject, "ol", "ordax-first-run-steps");
    STEP_LABELS.forEach((label, index) => {
      const item = el(documentObject, "li", "", label);
      item.dataset.state = index < stepIndex ? "done" : index === stepIndex ? "current" : "pending";
      if (index === stepIndex) item.setAttribute("aria-current", "step");
      list.append(item);
    });
    progress.append(brand, list);
  };

  const renderWelcome = (body) => {
    body.append(heading("Bem-vindo", "Seu OrdaX começa aqui.", "Vamos configurar idioma, entrada, rede, Conta, proteção local e privacidade usando os serviços reais do sistema."));
    const grid = el(documentObject, "div", "ordax-first-run-grid");
    [["USB primeiro", "O sistema e o estado persistente permanecem no pendrive."], ["Conta opcional", "Você pode usar o OrdaX offline sem criar uma segunda identidade."], ["Configuração real", "Nada nesta jornada simula login, Wi‑Fi, PIN ou persistência."]].forEach(([title, detail]) => {
      const item = el(documentObject, "article", "ordax-first-run-tile"); item.append(el(documentObject, "strong", "", title), el(documentObject, "p", "", detail)); grid.append(item);
    });
    body.append(grid);
  };

  const renderLanguage = (body) => {
    body.append(heading("Idioma", "Escolha o idioma do sistema.", "Somente idiomas com Surface pronta para lançamento aparecem aqui; traduções ainda em migração continuam ocultas."));
    const form = el(documentObject, "div", "ordax-first-run-form");
    const field = el(documentObject, "label", "ordax-first-run-field"); field.append(el(documentObject, "span", "", "Idioma"));
    const select = documentObject.createElement("select"); select.dataset.firstRunLocale = "";
    REGIONAL_LOCALE_OPTIONS.forEach((entry) => { const option = documentObject.createElement("option"); option.value = entry.value; option.textContent = entry.label; option.selected = entry.value === draft.locale; select.append(option); });
    field.append(select); form.append(field); body.append(form);
  };

  const renderKeyboard = (body) => {
    body.append(heading("Teclado", "Escolha o layout físico.", "A escolha é gravada pelo owner Native de teclado. Se o layout atual da Surface for diferente, a aplicação completa ocorrerá na próxima inicialização."));
    if (!keyboardPort || !keyboardSnapshot) {
      body.append(el(documentObject, "p", "ordax-first-run-notice", "O owner de teclado não está disponível nesta execução. Nenhum layout será fingido ou alterado."));
      return;
    }
    const options = el(documentObject, "div", "ordax-first-run-choice-list");
    keyboardSnapshot.supportedLayoutIds.forEach((layoutId) => {
      const label = el(documentObject, "label", "ordax-first-run-choice");
      const radio = documentObject.createElement("input"); radio.type = "radio"; radio.name = "first-run-keyboard"; radio.value = layoutId; radio.checked = draft.keyboardLayoutId === layoutId; radio.dataset.firstRunKeyboardLayout = "";
      const copy = el(documentObject, "span", ""); copy.append(el(documentObject, "strong", "", KEYBOARD_LABELS[layoutId] ?? layoutId), el(documentObject, "small", "", layoutId === keyboardSnapshot.appliedLayoutId ? "Em uso nesta Surface" : layoutId === keyboardSnapshot.configuredLayoutId ? "Configurado para a próxima inicialização" : "Disponível"));
      label.append(radio, copy); options.append(label);
    });
    body.append(options);
    status(body, keyboardMessage);
  };

  const renderRegion = (body) => {
    body.append(heading("Região e horário", "Ajuste o fuso do dispositivo.", "O fuso é persistido no owner de preferências e continua editável em Ajustes."));
    const form = el(documentObject, "div", "ordax-first-run-form");
    const zoneField = el(documentObject, "label", "ordax-first-run-field"); zoneField.append(el(documentObject, "span", "", "Fuso horário"));
    const zone = documentObject.createElement("select"); zone.dataset.firstRunTimeZone = "";
    REGIONAL_TIME_ZONE_OPTIONS.forEach((entry) => { const option = documentObject.createElement("option"); option.value = entry.value; option.textContent = `${entry.label} · ${entry.value}`; option.selected = entry.value === draft.timeZone; zone.append(option); });
    zoneField.append(zone); form.append(zoneField); body.append(form);
  };

  const renderNetwork = (body) => {
    body.append(heading("Rede", "Conecte-se ou continue offline.", "Este passo usa o mesmo broker Native de Wi‑Fi da Surface. Falha de conexão nunca vira sucesso visual."));
    if (!networkPort) { body.append(el(documentObject, "p", "ordax-first-run-notice", "O gerenciamento de Wi‑Fi está indisponível neste host. O uso offline continua disponível.")); return; }
    const toolbar = el(documentObject, "div", "ordax-first-run-network-toolbar");
    const current = el(documentObject, "div", "ordax-first-run-network-current"); current.append(el(documentObject, "span", "", networkSnapshot?.currentSsid ? "Conectado" : "Wi‑Fi"), el(documentObject, "strong", "", networkSnapshot?.currentSsid ?? (networkSnapshot ? "Sem rede conectada" : "Lendo estado…")));
    const scan = action(documentObject, networkPending ? "Aguarde…" : "Procurar redes", "network-scan"); scan.disabled = networkPending; toolbar.append(current, scan); body.append(toolbar); status(body, networkMessage);
    if (!networkSnapshot) return;
    const list = el(documentObject, "div", "ordax-first-run-network-list");
    [...networkSnapshot.networks].sort((a, b) => b.signalDbm - a.signalDbm).slice(0, 10).forEach((entry) => {
      const button = action(documentObject, entry.ssid, "network-select"); button.dataset.firstRunSsid = entry.ssid; button.dataset.selected = String(selectedSsid === entry.ssid); button.disabled = networkPending || entry.connected;
      button.append(el(documentObject, "small", "", `${entry.connected ? "Conectada" : entry.saved ? "Salva" : "Disponível"} · ${signalLabel(entry.signalDbm)}`)); list.append(button);
    });
    if (!networkSnapshot.networks.length) list.append(el(documentObject, "p", "ordax-first-run-empty", "Nenhuma rede listada. Use “Procurar redes”."));
    body.append(list);
    const selected = networkSnapshot.networks.find((entry) => entry.ssid === selectedSsid);
    if (selected && !selected.connected) {
      const connectForm = el(documentObject, "div", "ordax-first-run-connect");
      const secret = passwordField(documentObject, { label: `Senha de ${selected.ssid}`, value: wifiPasswordDraft, datasetKey: "firstRunWifiPassword", visible: wifiPasswordVisible, disabled: networkPending });
      const connect = action(documentObject, "Conectar", "network-connect", true); connect.dataset.firstRunSsid = selected.ssid; connect.disabled = networkPending; connectForm.append(secret.field, connect); body.append(connectForm);
    }
  };

  const renderAccount = (body) => {
    body.append(heading("Conta OrdaX", "Entre, crie uma conta ou continue sem conta.", "A Conta OrdaX é a identidade online. Ela não substitui o PIN ou senha local deste dispositivo."));
    const state = el(documentObject, "article", "ordax-first-run-account");
    state.append(el(documentObject, "strong", "", sessionSnapshot.state === "signed-in" ? sessionSnapshot.displayName : "Conta OrdaX"), el(documentObject, "p", "", sessionSnapshot.state === "signed-in" ? `Conta autenticada como ${sessionSnapshot.displayName}.` : sessionSnapshot.state === "signed-out" ? "Nenhuma sessão online está ativa." : "O provedor de Conta está indisponível nesta execução.")); body.append(state);
    status(body, identityMessage);
    if (sessionSnapshot.state === "signed-out" && credentialsPort) {
      const form = el(documentObject, "div", "ordax-first-run-form");
      const emailField = el(documentObject, "label", "ordax-first-run-field"); emailField.append(el(documentObject, "span", "", "E-mail"));
      const email = documentObject.createElement("input"); email.type = "email"; email.autocomplete = "email"; email.maxLength = 320; email.value = identityEmailDraft; email.dataset.firstRunIdentityEmail = ""; email.disabled = identityPending !== null; emailField.append(email); form.append(emailField);
      if (!identityRecoveryOpen) {
        const secret = passwordField(documentObject, { label: "Senha da Conta", value: identityPasswordDraft, datasetKey: "firstRunIdentityPassword", visible: identityPasswordVisible, disabled: identityPending !== null, autocomplete: "current-password" }); form.append(secret.field);
        if (registrationPolicy && isIdentityActionSupported(actionsSnapshot, "register")) {
          const legal = el(documentObject, "div", "ordax-first-run-legal"); legal.append(el(documentObject, "strong", "", "Documentos vigentes"));
          const links = el(documentObject, "div", "ordax-first-run-legal-links");
          const privacy = documentObject.createElement("a");
          privacy.href = registrationPolicy.privacy.url;
          privacy.target = "_blank";
          privacy.rel = "noopener noreferrer";
          privacy.textContent = `${translateFirstRunText(draft.locale, "Privacidade")} · v${registrationPolicy.privacy.version}`;
          const terms = documentObject.createElement("a");
          terms.href = registrationPolicy.terms.url;
          terms.target = "_blank";
          terms.rel = "noopener noreferrer";
          terms.textContent = `${translateFirstRunText(draft.locale, "Termos")} · v${registrationPolicy.terms.version}`;
          links.append(privacy, terms);
          const acceptance = el(documentObject, "label", "ordax-first-run-legal-acceptance"); const checkbox = documentObject.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = registrationLegalAccepted; checkbox.dataset.firstRunRegistrationLegalAcceptance = ""; checkbox.disabled = identityPending !== null; acceptance.append(checkbox, el(documentObject, "span", "", "Li e aceito os documentos vigentes indicados acima.")); legal.append(links, acceptance); form.append(legal);
        }
      } else form.append(el(documentObject, "p", "ordax-first-run-note", "Informe o e-mail da Conta. A resposta é genérica para não revelar se uma conta existe."));
      body.append(form);
    }
    const buttons = el(documentObject, "div", "ordax-first-run-account-actions");
    if (sessionSnapshot.state === "signed-in") buttons.append(action(documentObject, "Usar esta conta", "account-identity", true));
    else if (identityRecoveryOpen) {
      const recover = action(documentObject, identityPending === "recover" ? "Enviando…" : "Enviar recuperação", "account-recover-submit", true); recover.disabled = identityPending !== null || !credentialsPort; buttons.append(recover, action(documentObject, "Voltar ao login", "account-recover-close"));
    } else {
      const signIn = action(documentObject, identityPending === "sign-in" ? "Entrando…" : "Entrar", "account-sign-in", true); signIn.disabled = identityPending !== null || !isIdentityActionSupported(actionsSnapshot, "sign-in") || !credentialsPort;
      const register = action(documentObject, identityPending === "register" ? "Criando…" : "Criar conta", "account-register"); register.disabled = identityPending !== null || registrationPolicyPending || !registrationPolicy || !registrationLegalAccepted || !isIdentityActionSupported(actionsSnapshot, "register") || !credentialsPort;
      const recover = action(documentObject, "Esqueci minha senha", "account-recover-open"); recover.disabled = identityPending !== null || typeof credentialsPort?.recover !== "function";
      buttons.append(signIn, register, recover);
    }
    const local = action(documentObject, "Continuar sem conta", "account-local"); local.disabled = identityPending !== null; buttons.append(local); body.append(buttons);
  };

  const renderSecurity = (body) => {
    body.append(heading("Proteção local", "Proteja esta Surface independentemente da Conta.", "O PIN ou senha local desbloqueia esta sessão e continua funcionando offline. Não reutilizamos nem armazenamos a senha da Conta."));
    if (!localSessionPort || !localSessionSnapshot) { body.append(el(documentObject, "p", "ordax-first-run-notice", "O owner de sessão local está indisponível. Você pode continuar sem alegar uma proteção que não foi criada.")); return; }
    if (localSessionSnapshot.credentialConfigured) { const configured = el(documentObject, "article", "ordax-first-run-account"); configured.append(el(documentObject, "strong", "", "Proteção local configurada"), el(documentObject, "p", "", "A próxima inicialização da Surface exigirá esta credencial local.")); body.append(configured); return; }
    const form = el(documentObject, "div", "ordax-first-run-form");
    const secret = passwordField(documentObject, { label: "PIN ou senha local", value: localSessionSecretDraft, datasetKey: "firstRunLocalSessionSecret", visible: localSessionSecretVisible, disabled: localSessionPending, autocomplete: "new-password", minLength: 6 });
    const confirm = passwordField(documentObject, { label: "Confirmar PIN ou senha", value: localSessionConfirmDraft, datasetKey: "firstRunLocalSessionConfirm", visible: localSessionSecretVisible, disabled: localSessionPending, autocomplete: "new-password", minLength: 6 });
    form.append(secret.field, confirm.field); body.append(form);
    body.append(el(documentObject, "p", "ordax-first-run-note", "Use pelo menos 6 caracteres e repita exatamente a mesma credencial."), el(documentObject, "p", "ordax-first-run-note", "Deixe os dois campos vazios para continuar sem bloqueio autenticado. Você poderá configurar depois em Ajustes.")); status(body, localSessionMessage);
  };

  const renderPrivacy = (body) => {
    body.append(heading("Privacidade", "Escolha como a memória automática funciona.", "Esta opção é persistida pelo owner real de preferências. Sync, backup e cobrança não são ativados por esta tela."));
    const choice = el(documentObject, "label", "ordax-first-run-switch-card");
    const checkbox = documentObject.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = draft.memoryAutoCapture === "on"; checkbox.dataset.firstRunMemoryAutoCapture = "";
    const copy = el(documentObject, "span", ""); copy.append(el(documentObject, "strong", "", "Memória automática da OrdaX Intelligence"), el(documentObject, "small", "", "Permite registrar memórias úteis dentro das regras de privacidade e autorização do dispositivo.")); choice.append(checkbox, copy); body.append(choice);
    body.append(el(documentObject, "p", "ordax-first-run-note", "Você pode alterar esta preferência depois. Desativar não apaga memórias já existentes."));
  };

  const renderName = (body) => {
    body.append(heading("Nome do dispositivo", "Dê um nome reconhecível a este OrdaX.", "O nome é salvo no perfil canônico do dispositivo e pode ser usado por experiências que precisem identificar este computador."));
    if (!deviceProfilePort) { body.append(el(documentObject, "p", "ordax-first-run-notice", "O perfil de dispositivo está indisponível. O first-run não inventará um nome salvo.")); return; }
    const field = el(documentObject, "label", "ordax-first-run-field"); field.append(el(documentObject, "span", "", "Nome do dispositivo")); const input = documentObject.createElement("input"); input.type = "text"; input.maxLength = 120; input.value = draft.deviceName; input.dataset.firstRunDeviceName = ""; input.autocomplete = "off"; field.append(input); body.append(field);
  };

  const renderReview = (body) => {
    body.append(heading("Revisão", "Confira antes de concluir.", "Esta revisão lê o mesmo draft e os mesmos owners que serão persistidos. Não existe uma segunda cópia autoritativa só para esta tela."));
    const summary = el(documentObject, "dl", "ordax-first-run-summary");
    const localeLabel = REGIONAL_LOCALE_OPTIONS.find((entry) => entry.value === draft.locale)?.label ?? draft.locale;
    const rows = [
      ["Idioma", localeLabel], ["Teclado", draft.keyboardLayoutId ? (KEYBOARD_LABELS[draft.keyboardLayoutId] ?? draft.keyboardLayoutId) : "Indisponível"],
      ["Fuso", draft.timeZone], ["Rede", networkSnapshot?.currentSsid ?? "Offline"],
      ["Conta", draft.accountMode === "identity" ? "Conta OrdaX" : "Somente local"],
      ["Proteção local", localSessionSnapshot?.credentialConfigured ? "PIN/senha configurado" : "Não configurada"],
      ["Memória automática", draft.memoryAutoCapture === "on" ? "Ativada" : "Desativada"],
      ["Dispositivo", deviceProfilePort ? draft.deviceName : "Perfil indisponível"],
    ];
    rows.forEach(([key, value]) => summary.append(el(documentObject, "dt", "", key), el(documentObject, "dd", "", value))); body.append(summary);
    if (firstRunAppSelection !== null) { const apps = el(documentObject, "section", "ordax-first-run-tile"); apps.dataset.firstRunEssentials = ""; apps.append(el(documentObject, "strong", "", "Aplicativos essenciais"), el(documentObject, "p", "", `Pacotes independentes confirmados: ${firstRunAppSelection.alreadyInstalledAppIds.length}. Nenhum aplicativo adicional será instalado por apresentação.`)); body.append(apps); }
    status(body, completionError, completionError ? "alert" : "status");
  };

  const renderComplete = (body) => {
    body.append(heading("Concluído", "Seu OrdaX está configurado.", "A conclusão só foi exibida depois que o receipt do first-run e as configurações obrigatórias foram persistidos com sucesso."));
    if (keyboardSnapshot?.restartRequired) body.append(el(documentObject, "p", "ordax-first-run-notice", "O layout de teclado foi salvo, mas a Surface atual ainda usa o layout anterior. Reinicie agora para aplicá-lo, ou ele será aplicado na próxima inicialização."));
    else body.append(el(documentObject, "p", "ordax-first-run-status", "As configurações estão ativas. Você pode entrar na Surface."));
    status(body, completionError, completionError ? "alert" : "status");
  };

  const render = () => {
    if (destroyed) return;
    renderProgress(); card.replaceChildren();
    const body = el(documentObject, "div", "ordax-first-run-body"); const step = STEPS[stepIndex];
    ({ welcome: renderWelcome, language: renderLanguage, keyboard: renderKeyboard, region: renderRegion, network: renderNetwork, account: renderAccount, security: renderSecurity, privacy: renderPrivacy, name: renderName, review: renderReview, complete: renderComplete })[step](body);
    const footer = el(documentObject, "footer", "ordax-first-run-footer");
    if (stepIndex > 0 && !completionPersisted && !finishing) footer.append(action(documentObject, "Voltar", "back"));
    if (step === "account") {
      // Account owns its explicit routes; no implicit Next can bypass the local/identity choice.
    } else if (step === "review") {
      const finishButton = action(documentObject, finishing ? "Salvando…" : "Concluir configuração", "finish", true); finishButton.disabled = finishing || draft.accountMode === null; footer.append(finishButton);
    } else if (step === "complete") {
      if (keyboardSnapshot?.restartRequired && powerPort && isPowerActionSupported(powerPort.getSnapshot(), "restart")) { const restart = action(documentObject, powerPending ? "Reiniciando…" : "Reiniciar e aplicar teclado", "restart-device", true); restart.disabled = powerPending; footer.append(restart); }
      const enter = action(documentObject, "Entrar na Surface", "enter-surface", !keyboardSnapshot?.restartRequired); enter.disabled = powerPending; footer.append(enter);
    } else {
      const label = step === "network" ? "Continuar offline ou conectado" : "Continuar"; const next = action(documentObject, label, "next", true); next.disabled = finishing || (step === "security" && localSessionPending) || (step === "name" && deviceProfilePort && !draft.deviceName.trim()); footer.append(next);
    }
    card.append(body, footer);
    queueMicrotask(() => card.querySelector("h1")?.focus?.());
  };

  const go = (nextIndex) => {
    if (completionPersisted && STEPS[nextIndex] !== "complete") return;
    if (STEPS[stepIndex] === "network") { wifiPasswordDraft = ""; wifiPasswordVisible = false; }
    if (STEPS[stepIndex] === "security") { localSessionSecretDraft = ""; localSessionConfirmDraft = ""; localSessionMessage = ""; }
    stepIndex = Math.max(0, Math.min(STEPS.length - 1, nextIndex)); completionError = ""; render();
    if (STEPS[stepIndex] === "network" && networkPort && networkSnapshot === null) void refreshNetwork(false);
  };

  const refreshNetwork = async (scan) => {
    if (!networkPort || destroyed || networkPending) return; const ordinal = ++networkOrdinal; networkPending = true; networkMessage = scan ? networkManagementActionMessage("scan", 0) : "Lendo estado do Wi‑Fi…"; render();
    try { networkSnapshot = await (scan ? networkPort.scan() : networkPort.status()); if (destroyed || ordinal !== networkOrdinal) return; networkMessage = scan ? networkManagementActionMessage("scan", 1) : ""; if (selectedSsid && !networkSnapshot.networks.some((entry) => entry.ssid === selectedSsid)) selectedSsid = null; }
    catch (error) { if (!destroyed && ordinal === networkOrdinal) networkMessage = scan ? networkManagementFailureMessage("scan", error) : "O Wi‑Fi não pôde ser lido. Você pode continuar offline."; }
    finally { if (!destroyed && ordinal === networkOrdinal) { networkPending = false; render(); } }
  };
  const connectNetwork = async (ssid, password) => {
    if (!networkPort || destroyed || networkPending) return; const ordinal = ++networkOrdinal; networkPending = true; networkMessage = networkManagementActionMessage("connect", 0); wifiPasswordDraft = ""; render();
    try { networkSnapshot = await runNetworkManagementAction(networkPort, "connect", { ssid, password }); if (destroyed || ordinal !== networkOrdinal) return; selectedSsid = null; networkMessage = networkManagementActionMessage("connect", 1); }
    catch (error) { if (!destroyed && ordinal === networkOrdinal) networkMessage = networkManagementFailureMessage("connect", error); }
    finally { if (!destroyed && ordinal === networkOrdinal) { networkPending = false; render(); } }
  };
  const continueSecurity = async () => {
    if (destroyed || localSessionPending) return;
    if (!localSessionPort || !localSessionSnapshot || localSessionSnapshot.credentialConfigured || (!localSessionSecretDraft && !localSessionConfirmDraft)) { go(stepIndex + 1); return; }
    if (localSessionSecretDraft.length < 6 || localSessionSecretDraft !== localSessionConfirmDraft) { localSessionMessage = "Use pelo menos 6 caracteres e repita exatamente a mesma credencial."; render(); return; }
    let secret = localSessionSecretDraft; localSessionSecretDraft = ""; localSessionConfirmDraft = ""; localSessionPending = true; localSessionMessage = "Criando credencial local…"; render(); const operationSecret = secret; secret = "";
    try { localSessionSnapshot = validateLocalSessionSnapshot(await localSessionPort.configureCredential(operationSecret)); if (!destroyed) { localSessionMessage = ""; go(stepIndex + 1); } }
    catch { if (!destroyed) { localSessionMessage = "Não foi possível criar a credencial local. Nenhuma senha foi salva no First Run."; render(); } }
    finally { if (!destroyed) { localSessionPending = false; if (STEPS[stepIndex] === "security") render(); } }
  };
  const refreshRegistrationPolicy = async () => {
    if (destroyed || registrationPolicyPending || !credentialsPort || typeof credentialsPort.registrationPolicy !== "function" || !isIdentityActionSupported(actionsSnapshot, "register")) return;
    registrationPolicyPending = true;
    try { const policy = await credentialsPort.registrationPolicy(); if (destroyed) return; const nextPolicy = policy.registrationEnabled === true ? policy : null; if (!sameRegistrationLegalPolicy(registrationPolicy, nextPolicy)) registrationLegalAccepted = false; registrationPolicy = nextPolicy; }
    catch { registrationPolicy = null; registrationLegalAccepted = false; }
    finally { registrationPolicyPending = false; if (!destroyed && STEPS[stepIndex] === "account") render(); }
  };
  const runIdentity = async (kind) => {
    if (destroyed || identityPending || !credentialsPort) return;
    if (kind === "recover" && typeof credentialsPort.recover !== "function") return;
    if (kind !== "recover" && !isIdentityActionSupported(actionsSnapshot, kind)) return;
    identityPending = kind; identityMessage = ""; const email = identityEmailDraft; const password = identityPasswordDraft; identityPasswordDraft = ""; render();
    try {
      if (kind === "recover") { await credentialsPort.recover({ email }); identityMessage = "Se a Conta puder ser recuperada, as instruções serão enviadas para esse e-mail."; identityRecoveryOpen = false; }
      else {
        const result = kind === "sign-in" ? await credentialsPort.signIn({ email, password }) : await credentialsPort.register({ email, password, legalAccepted: registrationLegalAccepted });
        if (typeof sessionPort.refresh === "function") await sessionPort.refresh(); sessionSnapshot = sessionPort.getSnapshot(); actionsSnapshot = actionsPort.getSnapshot();
        identityMessage = sessionSnapshot.state === "signed-in" ? "Conta autenticada. Você pode usá-la neste dispositivo." : result?.confirmationRequired ? "Cadastro recebido. Confirme seu e-mail para entrar." : "A autenticação foi iniciada. O uso local continua disponível.";
      }
    } catch { identityMessage = kind === "recover" ? "A recuperação de acesso está indisponível agora. O uso local continua disponível." : "A ação de conta não pôde ser concluída. O uso local continua disponível."; }
    finally { if (!destroyed) { identityPending = null; render(); } }
  };

  const finish = async () => {
    if (destroyed || finishing || draft.accountMode === null || completionPersisted) return;
    finishing = true; completionError = ""; render();
    const originalPreferences = preferencePort.getSnapshot();
    const originalKeyboard = keyboardPort ? validateKeyboardLayoutSnapshot(keyboardPort.getSnapshot()) : null;
    const originalDevice = deviceProfilePort?.getSnapshot() ?? null;
    let preferenceChanged = false; let keyboardChanged = false; let deviceChanged = false; let receiptAttempted = false;
    try {
      if (draft.accountMode === "identity") {
        const current = await verifyFirstRunIdentitySession(sessionPort, selectedIdentitySubjectId);
        if (!current) { draft.accountMode = null; selectedIdentitySubjectId = null; stepIndex = STEPS.indexOf("account"); identityMessage = "A sessão da Conta OrdaX mudou. Entre novamente ou continue sem conta."; finishing = false; render(); return; }
      }
      await preferencePort.setManyConfirmed({
        [REGIONAL_LOCALE_PREFERENCE_ID]: draft.locale,
        [REGIONAL_TIME_ZONE_PREFERENCE_ID]: draft.timeZone,
        [MEMORY_AUTO_CAPTURE_PREFERENCE_ID]: draft.memoryAutoCapture,
      });
      preferenceChanged = true;
      if (keyboardPort && draft.keyboardLayoutId && draft.keyboardLayoutId !== originalKeyboard.configuredLayoutId) { keyboardSnapshot = validateKeyboardLayoutSnapshot(await keyboardPort.configure(draft.keyboardLayoutId)); keyboardChanged = true; }
      if (deviceProfilePort) { const normalizedName = validateDeviceDisplayName(draft.deviceName); if (normalizedName !== originalDevice.displayName) { await deviceProfilePort.rename(normalizedName); deviceChanged = true; } }
      receiptAttempted = true;
      await store.save(completeFirstRunState(draft));
      completionPersisted = true; stepIndex = STEPS.indexOf("complete"); finishing = false; render();
    } catch {
      let rollbackFailed = false;
      if (!receiptAttempted) {
        if (deviceChanged && deviceProfilePort && originalDevice) { try { await deviceProfilePort.rename(originalDevice.displayName); } catch { rollbackFailed = true; } }
        if (keyboardChanged && keyboardPort && originalKeyboard) { try { keyboardSnapshot = validateKeyboardLayoutSnapshot(await keyboardPort.configure(originalKeyboard.configuredLayoutId)); } catch { rollbackFailed = true; } }
        if (preferenceChanged) { try { await preferencePort.setManyConfirmed({ [REGIONAL_LOCALE_PREFERENCE_ID]: originalPreferences[REGIONAL_LOCALE_PREFERENCE_ID], [REGIONAL_TIME_ZONE_PREFERENCE_ID]: originalPreferences[REGIONAL_TIME_ZONE_PREFERENCE_ID], [MEMORY_AUTO_CAPTURE_PREFERENCE_ID]: originalPreferences[MEMORY_AUTO_CAPTURE_PREFERENCE_ID] }); } catch { rollbackFailed = true; } }
      }
      finishing = false;
      completionError = receiptAttempted
        ? "Não foi possível confirmar o receipt de conclusão. As configurações já aplicadas foram preservadas para uma nova tentativa idempotente."
        : rollbackFailed
          ? "A conclusão falhou e parte do rollback também falhou. O assistente permanece aberto; revise a persistência antes de tentar novamente."
          : "Não foi possível persistir toda a configuração. As alterações desta conclusão foram revertidas e o assistente continua aberto.";
      render();
    }
  };

  const toggleSecret = (kind) => { if (kind.includes("Wifi")) wifiPasswordVisible = !wifiPasswordVisible; else if (kind.includes("Identity")) identityPasswordVisible = !identityPasswordVisible; else localSessionSecretVisible = !localSessionSecretVisible; render(); };
  const onClick = (event) => {
    const button = event.target.closest("[data-first-run-action]"); if (!button || !overlay.contains(button) || button.disabled) return; const kind = button.dataset.firstRunAction;
    if (kind.startsWith("toggle-")) { toggleSecret(kind); return; }
    if (kind === "back") go(stepIndex - 1);
    else if (kind === "next" && STEPS[stepIndex] === "security") void continueSecurity();
    else if (kind === "next") go(stepIndex + 1);
    else if (kind === "finish") void finish();
    else if (kind === "enter-surface") close();
    else if (kind === "restart-device") { if (!powerPort || powerPending) return; powerPending = true; completionError = ""; render(); void powerPort.execute("restart").catch(() => { powerPending = false; completionError = "O reinício não pôde ser solicitado. A configuração continua salva e será aplicada na próxima inicialização."; render(); }); }
    else if (kind === "network-scan") void refreshNetwork(true);
    else if (kind === "network-select") { const ssid = button.dataset.firstRunSsid ?? null; if (ssid !== selectedSsid) wifiPasswordDraft = ""; selectedSsid = ssid; networkMessage = ""; render(); queueMicrotask(() => overlay.querySelector("[data-first-run-wifi-password]")?.focus()); }
    else if (kind === "network-connect") { const input = overlay.querySelector("[data-first-run-wifi-password]"); const ssid = button.dataset.firstRunSsid; if (!(input instanceof HTMLInputElement) || !ssid) return; const password = input.value; input.value = ""; wifiPasswordDraft = ""; if (!password) { networkMessage = "Digite a senha da rede Wi‑Fi."; render(); } else void connectNetwork(ssid, password); }
    else if (kind === "account-sign-in") void runIdentity("sign-in");
    else if (kind === "account-register") void runIdentity("register");
    else if (kind === "account-recover-open") { identityRecoveryOpen = true; identityPasswordDraft = ""; identityMessage = ""; render(); }
    else if (kind === "account-recover-close") { identityRecoveryOpen = false; identityMessage = ""; render(); }
    else if (kind === "account-recover-submit") void runIdentity("recover");
    else if (kind === "account-identity") { const current = sessionPort.getSnapshot(); if (current.state !== "signed-in") { identityMessage = "A sessão da Conta OrdaX mudou. Entre novamente ou continue sem conta."; render(); return; } selectedIdentitySubjectId = current.subjectId; draft.accountMode = "identity"; go(stepIndex + 1); }
    else if (kind === "account-local") { selectedIdentitySubjectId = null; draft.accountMode = "local-only"; go(stepIndex + 1); }
  };
  const onInput = (event) => {
    const input = event.target; if (!(input instanceof HTMLInputElement) || !overlay.contains(input)) return;
    if (input.matches("[data-first-run-wifi-password]")) wifiPasswordDraft = input.value;
    else if (input.matches("[data-first-run-identity-email]")) identityEmailDraft = input.value;
    else if (input.matches("[data-first-run-identity-password]")) identityPasswordDraft = input.value;
    else if (input.matches("[data-first-run-local-session-secret]")) localSessionSecretDraft = input.value;
    else if (input.matches("[data-first-run-local-session-confirm]")) localSessionConfirmDraft = input.value;
    else if (input.matches("[data-first-run-device-name]")) draft.deviceName = input.value;
  };
  const onChange = (event) => {
    if (event.target.matches("[data-first-run-locale]")) { draft.locale = event.target.value; syncFirstRunDocumentLocale(documentObject, draft.locale); render(); }
    else if (event.target.matches("[data-first-run-time-zone]")) draft.timeZone = event.target.value;
    else if (event.target.matches("[data-first-run-keyboard-layout]")) { draft.keyboardLayoutId = event.target.value; keyboardMessage = keyboardSnapshot?.appliedLayoutId === draft.keyboardLayoutId ? "Este layout já está ativo." : "Este layout será salvo ao concluir e aplicado na próxima inicialização da Surface."; render(); }
    else if (event.target.matches("[data-first-run-memory-auto-capture]")) draft.memoryAutoCapture = event.target.checked ? "on" : "off";
    else if (event.target.matches("[data-first-run-registration-legal-acceptance]")) { registrationLegalAccepted = event.target.checked === true; render(); }
  };
  const onKeyDown = (event) => {
    if (event.key === "Tab") {
      const focusable = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]; if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && documentObject.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && documentObject.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key === "Escape") {
      if (identityRecoveryOpen && STEPS[stepIndex] === "account") { event.preventDefault(); identityRecoveryOpen = false; identityMessage = ""; render(); }
      else if (selectedSsid && STEPS[stepIndex] === "network") { event.preventDefault(); selectedSsid = null; wifiPasswordDraft = ""; render(); }
      else if (!completionPersisted && stepIndex > 0) { event.preventDefault(); go(stepIndex - 1); }
      return;
    }
    if (event.key !== "Enter") return;
    const input = event.target; if (!(input instanceof HTMLInputElement) || !overlay.contains(input)) return;
    if (input.matches("[data-first-run-wifi-password]")) { event.preventDefault(); overlay.querySelector('[data-first-run-action="network-connect"]')?.click(); }
    else if (input.matches("[data-first-run-identity-email], [data-first-run-identity-password]")) { event.preventDefault(); overlay.querySelector(`[data-first-run-action="${identityRecoveryOpen ? "account-recover-submit" : "account-sign-in"}"]`)?.click(); }
    else if (input.matches("[data-first-run-local-session-secret], [data-first-run-local-session-confirm]")) { event.preventDefault(); overlay.querySelector('[data-first-run-action="next"]')?.click(); }
    else if (input.matches("[data-first-run-device-name]")) { event.preventDefault(); overlay.querySelector('[data-first-run-action="next"]')?.click(); }
  };

  overlay.addEventListener("click", onClick); overlay.addEventListener("input", onInput); overlay.addEventListener("change", onChange); overlay.addEventListener("keydown", onKeyDown);
  unsubscribeSession = sessionPort.subscribe((snapshot) => { sessionSnapshot = snapshot; if (draft.accountMode === "identity" && !finishing && !completionPersisted && !matchesFirstRunIdentitySelection(selectedIdentitySubjectId, sessionSnapshot)) { draft.accountMode = null; selectedIdentitySubjectId = null; stepIndex = STEPS.indexOf("account"); identityMessage = "A sessão da Conta OrdaX mudou. Entre novamente ou continue sem conta."; } if (sessionSnapshot.state === "signed-in") { registrationPolicy = null; registrationLegalAccepted = false; } if (!destroyed && STEPS[stepIndex] === "account") render(); });
  unsubscribeActions = actionsPort.subscribe((snapshot) => { actionsSnapshot = snapshot; if (!isIdentityActionSupported(actionsSnapshot, "register")) { registrationPolicy = null; registrationLegalAccepted = false; } if (!destroyed && STEPS[stepIndex] === "account") render(); if (isIdentityActionSupported(actionsSnapshot, "register") && registrationPolicy === null) void refreshRegistrationPolicy(); });
  unsubscribeLocalSession = localSessionPort?.subscribe((snapshot) => { localSessionSnapshot = validateLocalSessionSnapshot(snapshot); if (!destroyed && STEPS[stepIndex] === "security") render(); });
  render(); if (isIdentityActionSupported(actionsSnapshot, "register")) void refreshRegistrationPolicy();
  return Object.freeze({ shown: true, destroy() { close(); } });
}
