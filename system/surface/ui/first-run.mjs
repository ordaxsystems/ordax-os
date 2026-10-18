import { assertDeviceProfilePort } from "../../contracts/device-profile.mjs";
import { assertFirstRunCursorPort, safeFirstRunResumeStep } from "../../contracts/first-run-cursor.mjs";
import { assertKeyboardLayoutPort, validateKeyboardLayoutSnapshot } from "../../contracts/keyboard-layout.mjs";
import { keyboardLayoutOption } from "../../services/input/keyboard-layout.mjs";
import { assertFirstRunStateStore } from "../../contracts/first-run-state-store.mjs";
import { FIRST_RUN_APP_SELECTION_SCHEMA } from "../../services/apps/first-run-selection.mjs";
import {
  assertIdentityActionsPort,
  isIdentityActionSupported,
} from "../../contracts/identity-actions.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { assertIdentityCredentialsPort, sameRegistrationLegalPolicy } from "../../contracts/identity-credentials.mjs";
import {
  assertLocalSessionPort,
  validateLocalSessionSnapshot,
} from "../../contracts/local-session.mjs";
import { assertNetworkManagementPort } from "../../contracts/network-management.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { createLocaleProfile } from "../../contracts/locale-profile.mjs";
import {
  REGIONAL_LOCALE_OPTIONS,
  REGIONAL_LOCALE_PREFERENCE_ID,
  REGIONAL_TIME_ZONE_OPTIONS,
  REGIONAL_TIME_ZONE_PREFERENCE_ID,
  isSupportedRegionalTimeZone,
} from "../../services/preferences/regional.mjs";
import {
  MEMORY_AUTO_CAPTURE_PREFERENCE_ID,
  memoryAutoCaptureEnabled,
} from "../../services/preferences/memory.mjs";
import { translateFirstRunText } from "../../services/i18n/first-run.mjs";
import { FIRST_RUN_STEP_IDS, FIRST_RUN_STEP_LABELS, getFirstRunStepIndex } from "../../services/first-run/journey.mjs";
import { deriveFirstRunCapabilities } from "../../services/first-run/capabilities.mjs";
import { completeFirstRunState, matchesFirstRunIdentitySelection, validateFirstRunState, verifyFirstRunIdentitySession } from "../../services/state/first-run.mjs";
import {
  networkManagementActionMessage,
  networkManagementFailureMessage,
  runNetworkManagementAction,
} from "../../services/network/management-runtime.mjs";

const STEPS = FIRST_RUN_STEP_IDS;
const STEP_LABELS = FIRST_RUN_STEP_LABELS;

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
  const button = el(
    documentObject,
    "button",
    primary ? "ordax-first-run-action ordax-first-run-action-primary" : "ordax-first-run-action",
    label,
  );
  button.type = "button";
  button.dataset.firstRunAction = id;
  return button;
}

function availabilityPanel(documentObject, title, detail) {
  const panel = el(documentObject, "article", "ordax-first-run-availability");
  panel.append(el(documentObject, "strong", "", title), el(documentObject, "p", "", detail));
  return panel;
}

function signalLabel(dbm) {
  if (dbm >= -50) return "Sinal forte";
  if (dbm >= -60) return "Sinal bom";
  if (dbm >= -70) return "Sinal regular";
  return "Sinal fraco";
}

export function mountFirstRunExperience(
  root,
  {
    stateStore,
    firstRunAppSelection = null,
    preferences,
    networkManagement = null,
    identitySession,
    identityActions,
    identityCredentials = null,
    localSession = null,
    deviceProfile = null,
    keyboardLayout = null,
    resumeCursor = null,
  },
) {
  if (!(root instanceof Element)) {
    throw new TypeError("First-run experience requires the Surface root Element");
  }
  const store = assertFirstRunStateStore(stateStore);
  const preferencePort = assertPreferenceRuntimePort(preferences);
  const networkPort = networkManagement === null ? null : assertNetworkManagementPort(networkManagement);
  const sessionPort = assertIdentitySessionPort(identitySession);
  const actionsPort = assertIdentityActionsPort(identityActions);
  const credentialsPort = identityCredentials === null ? null : assertIdentityCredentialsPort(identityCredentials);
  const localSessionPort = localSession === null ? null : assertLocalSessionPort(localSession);
  const deviceProfilePort = deviceProfile === null ? null : assertDeviceProfilePort(deviceProfile);
  const keyboardLayoutPort = keyboardLayout === null ? null : assertKeyboardLayoutPort(keyboardLayout);
  const cursorPort = resumeCursor === null ? null : assertFirstRunCursorPort(resumeCursor);
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
  )) {
    throw new TypeError("First Run application overview requires a verified authority-free plan");
  }

  if (initial.completed) {
    return Object.freeze({ shown: false, destroy() {} });
  }

  const documentObject = root.ownerDocument;
  let detectedTimeZone = null;
  try {
    detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    detectedTimeZone = null;
  }

  const storedRegional = preferencePort.getSnapshot();
  const resumedStep = safeFirstRunResumeStep(cursorPort?.load().step);
  const continuingSetup = resumedStep !== "welcome" && resumedStep !== "regional";
  const savedLocale = storedRegional[REGIONAL_LOCALE_PREFERENCE_ID];
  const savedTimeZone = storedRegional[REGIONAL_TIME_ZONE_PREFERENCE_ID];
  const draft = {
    locale: continuingSetup && REGIONAL_LOCALE_OPTIONS.some((entry) => entry.value === savedLocale)
      ? savedLocale : initial.locale,
    timeZone: continuingSetup && isSupportedRegionalTimeZone(savedTimeZone)
      ? savedTimeZone
      : isSupportedRegionalTimeZone(detectedTimeZone) ? detectedTimeZone : initial.timeZone,
    accountMode: null,
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
  const card = el(documentObject, "main", "ordax-first-run-card");
  shell.append(progress, card);
  overlay.append(shell);
  documentObject.body.append(overlay);

  // The cursor is observed once: locale selection and initial navigation must agree.
  let stepIndex = getFirstRunStepIndex(resumedStep);
  let cursorQueue = Promise.resolve();
  let destroyed = false;
  let finishing = false;
  let networkSnapshot = null;
  let networkPending = false;
  let networkMessage = "";
  let networkOrdinal = 0;
  let selectedSsid = null;
  let passwordDraft = "";
  let sessionSnapshot = sessionPort.getSnapshot();
  let actionsSnapshot = actionsPort.getSnapshot();
  let identityPending = null;
  let identityMessage = "";
  let identityEmailDraft = "";
  let identityPasswordDraft = "";
  let selectedIdentitySubjectId = null;
  let registrationPolicy = null;
  let registrationLegalAccepted = false;
  let registrationPolicyPending = false;
  let localSessionSnapshot = localSessionPort === null
    ? null
    : validateLocalSessionSnapshot(localSessionPort.getSnapshot());
  let deviceProfileSnapshot = deviceProfilePort === null ? null : deviceProfilePort.getSnapshot();
  let capabilitySnapshot = deriveFirstRunCapabilities({
    networkManagement: networkPort,
    localSession: localSessionPort,
    deviceProfile: deviceProfilePort,
    identityCredentials: credentialsPort,
    identityActionsSnapshot: actionsSnapshot,
  });
  let localSessionPending = false;
  let localSessionMessage = "";
  let localSessionSecretDraft = "";
  let localSessionConfirmDraft = "";
  let deviceNameDraft = deviceProfileSnapshot?.displayName ?? "";
  let deviceNamePending = false;
  let deviceNameMessage = "";
  let keyboardLayoutSnapshot = null;
  let keyboardLayoutReadFailed = false;
  let keyboardLayoutOrdinal = 0;
  let completionError = "";
  let unsubscribeSession = null;
  let unsubscribeActions = null;
  let unsubscribeLocalSession = null;

  const restoreRoot = () => {
    root.inert = previousInert;
    if (previousAriaHidden === null) root.removeAttribute("aria-hidden");
    else root.setAttribute("aria-hidden", previousAriaHidden);
  };

  const close = () => {
    if (destroyed) return;
    destroyed = true;
    networkOrdinal += 1;
    keyboardLayoutOrdinal += 1;
    passwordDraft = "";
    identityPasswordDraft = "";
    selectedIdentitySubjectId = null;
    localSessionSecretDraft = "";
    localSessionConfirmDraft = "";
    unsubscribeLocalSession?.();
    unsubscribeSession?.();
    unsubscribeActions?.();
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
    header.append(
      el(documentObject, "span", "ordax-first-run-eyebrow", eyebrow),
      titleNode,
      el(documentObject, "p", "", detail),
    );
    return header;
  };

  const renderProgress = () => {
    progress.replaceChildren();
    const brand = el(documentObject, "div", "ordax-first-run-brand");
    const mark = el(documentObject, "div", "ordax-first-run-brand-mark");
    const symbol = el(documentObject, "img", "");
    symbol.src = new URL("./brand/ordax-symbol.png", import.meta.url).href;
    symbol.alt = "";
    mark.append(symbol, el(documentObject, "strong", "", "OrdaX"));
    brand.append(mark, el(documentObject, "span", "", "Primeiro uso"));
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
    body.append(heading(
      "Bem-vindo",
      "Seu OrdaX começa aqui.",
      "Escolha o idioma e prepare seu OrdaX para começar.",
    ));
    const grid = el(documentObject, "div", "ordax-first-run-grid");
    [
      ["USB primeiro", "O sistema e seu estado persistente permanecem no pendrive."],
      ["Conta opcional", "Arquivos, Notas, Internet e Ajustes funcionam sem identidade online."],
      ["Offline utilizável", "A falta de internet não deve impedir o computador de iniciar."],
    ].forEach(([title, detail]) => {
      const item = el(documentObject, "article", "ordax-first-run-tile");
      item.append(el(documentObject, "strong", "", title), el(documentObject, "p", "", detail));
      grid.append(item);
    });
    body.append(grid);
  };

  const renderRegional = (body) => {
    body.append(heading(
      "Idioma e região",
      "Ajuste idioma e horário.",
      "Escolha como o OrdaX apresenta os textos e o horário. Você pode alterar essas opções depois em Ajustes.",
    ));
    const form = el(documentObject, "div", "ordax-first-run-form");
    const localeField = el(documentObject, "label", "ordax-first-run-field");
    localeField.append(el(documentObject, "span", "", "Idioma"));
    const locale = documentObject.createElement("select");
    locale.dataset.firstRunLocale = "";
    REGIONAL_LOCALE_OPTIONS.forEach((entry) => {
      const option = documentObject.createElement("option");
      option.value = entry.value;
      option.textContent = entry.label;
      option.selected = entry.value === draft.locale;
      locale.append(option);
    });
    localeField.append(locale);

    const zoneField = el(documentObject, "label", "ordax-first-run-field");
    zoneField.append(el(documentObject, "span", "", "Fuso horário"));
    const zone = documentObject.createElement("select");
    zone.dataset.firstRunTimeZone = "";
    REGIONAL_TIME_ZONE_OPTIONS.forEach((entry) => {
      const option = documentObject.createElement("option");
      option.value = entry.value;
      option.textContent = `${entry.label} · ${entry.value}`;
      option.selected = entry.value === draft.timeZone;
      zone.append(option);
    });
    zoneField.append(zone);
    form.append(localeField, zoneField);
    body.append(form);

    if (keyboardLayoutPort) {
      const status = el(documentObject, "section", "ordax-first-run-notice");
      status.dataset.firstRunKeyboardStatus = "";
      status.append(el(documentObject, "strong", "", "Teclado físico"));
      if (keyboardLayoutSnapshot) {
        const configured = keyboardLayoutOption(keyboardLayoutSnapshot.configuredLayoutId)?.label
          ?? keyboardLayoutSnapshot.configuredLayoutId;
        const applied = keyboardLayoutOption(keyboardLayoutSnapshot.appliedLayoutId)?.label
          ?? keyboardLayoutSnapshot.appliedLayoutId;
        const configuredLine = el(documentObject, "p");
        configuredLine.append(
          el(documentObject, "span", "", "Layout configurado:"),
          documentObject.createTextNode(" " + configured),
        );
        const appliedLine = el(documentObject, "p");
        appliedLine.append(
          el(documentObject, "span", "", "Layout informado para esta sessão:"),
          documentObject.createTextNode(" " + applied),
        );
        status.append(configuredLine, appliedLine);
        if (keyboardLayoutSnapshot.restartRequired) {
          status.append(el(documentObject, "p", "", "A nova configuração será usada no próximo início da Surface."));
        }
      } else {
        status.append(el(
          documentObject,
          "p",
          "",
          keyboardLayoutReadFailed
            ? "Não foi possível consultar o teclado nesta sessão."
            : "Lendo configuração do teclado…",
        ));
      }
      status.append(el(
        documentObject,
        "p",
        "",
        "Informação do host nativo. Este assistente ainda não altera o teclado.",
      ));
      body.append(status);
    }
  };

  const renderNetwork = (body) => {
    body.append(heading(
      "Rede",
      "Conecte-se agora ou continue offline.",
      "Escolha uma rede Wi-Fi para acessar os serviços online. Você também pode continuar offline e conectar depois em Ajustes.",
    ));
    if (!capabilitySnapshot.networkManagement) {
      body.append(availabilityPanel(
        documentObject,
        "Wi-Fi",
        "Não é possível configurar o Wi-Fi nesta sessão. Você pode continuar; nenhuma conexão será alterada.",
      ));
      return;
    }

    const toolbar = el(documentObject, "div", "ordax-first-run-network-toolbar");
    const current = el(documentObject, "div", "ordax-first-run-network-current");
    current.append(
      el(documentObject, "span", "", networkSnapshot?.currentSsid ? "Conectado" : "Wi-Fi"),
      el(documentObject, "strong", "", networkSnapshot?.currentSsid ?? (networkSnapshot ? "Sem rede conectada" : "Lendo estado…")),
    );
    const scan = action(documentObject, networkPending ? "Aguarde…" : "Procurar redes", "network-scan");
    scan.disabled = networkPending;
    toolbar.append(current, scan);
    body.append(toolbar);

    if (networkMessage) {
      const status = el(documentObject, "p", "ordax-first-run-status", networkMessage);
      status.setAttribute("role", "status");
      body.append(status);
    }
    if (!networkSnapshot) return;

    const list = el(documentObject, "div", "ordax-first-run-network-list");
    const networks = [...networkSnapshot.networks]
      .sort((left, right) => right.signalDbm - left.signalDbm)
      .slice(0, 10);
    if (networks.length === 0) {
      list.append(el(documentObject, "p", "ordax-first-run-empty", "Nenhuma rede listada. Use “Procurar redes”."));
    }
    networks.forEach((entry) => {
      const button = action(documentObject, entry.ssid, "network-select");
      button.dataset.firstRunSsid = entry.ssid;
      button.dataset.selected = String(selectedSsid === entry.ssid);
      button.setAttribute("aria-pressed", String(selectedSsid === entry.ssid));
      button.disabled = networkPending || entry.connected;
      button.append(el(
        documentObject,
        "small",
        "",
        `${translateFirstRunText(draft.locale, entry.connected ? "Conectada" : entry.saved ? "Salva" : "Disponível")} · ${translateFirstRunText(draft.locale, signalLabel(entry.signalDbm))}`,
      ));
      list.append(button);
    });
    body.append(list);

    const selected = networkSnapshot.networks.find((entry) => entry.ssid === selectedSsid);
    if (selected && !selected.connected) {
      const connectForm = el(documentObject, "div", "ordax-first-run-connect");
      const passwordField = el(documentObject, "label", "ordax-first-run-field");
      passwordField.append(el(documentObject, "span", "", `Senha de ${selected.ssid}`));
      const input = documentObject.createElement("input");
      input.type = "password";
      input.autocomplete = "off";
      input.dataset.firstRunWifiPassword = "";
      input.value = passwordDraft;
      input.disabled = networkPending;
      passwordField.append(input);
      const connect = action(documentObject, "Conectar", "network-connect", true);
      connect.dataset.firstRunSsid = selected.ssid;
      connect.disabled = networkPending;
      connectForm.append(passwordField, connect);
      body.append(connectForm);
    }
  };

  const renderSecurity = (body) => {
    body.append(heading(
      "Segurança local",
      "Proteja seu OrdaX.",
      "Use um PIN ou senha local para proteger a sessão do OrdaX. A credencial fica neste dispositivo e não criptografa os arquivos do pendrive.",
    ));

    if (!capabilitySnapshot.localSession || !localSessionSnapshot) {
      body.append(availabilityPanel(
        documentObject,
        "Segurança local",
        "O bloqueio local não está disponível nesta sessão. Nenhum PIN ou senha será criado ao continuar.",
      ));
      return;
    }

    if (localSessionSnapshot.credentialConfigured) {
      const configured = el(documentObject, "article", "ordax-first-run-account");
      configured.append(
        el(documentObject, "strong", "", "Bloqueio local configurado"),
        el(documentObject, "p", "", "Na próxima inicialização, use seu PIN ou senha local para desbloquear o OrdaX."),
      );
      body.append(configured);
      return;
    }

    const form = el(documentObject, "div", "ordax-first-run-form");
    const secretField = el(documentObject, "label", "ordax-first-run-field");
    secretField.append(el(documentObject, "span", "", "PIN ou senha local"));
    const secret = documentObject.createElement("input");
    secret.type = "password";
    secret.autocomplete = "new-password";
    secret.minLength = 6;
    secret.maxLength = 128;
    secret.value = localSessionSecretDraft;
    secret.placeholder = translateFirstRunText(draft.locale, "PIN ou senha local");
    secret.dataset.firstRunLocalSessionSecret = "";
    secret.disabled = localSessionPending;
    secretField.append(secret);

    const confirmField = el(documentObject, "label", "ordax-first-run-field");
    confirmField.append(el(documentObject, "span", "", "Confirmar PIN ou senha"));
    const confirm = documentObject.createElement("input");
    confirm.type = "password";
    confirm.autocomplete = "new-password";
    confirm.minLength = 6;
    confirm.maxLength = 128;
    confirm.value = localSessionConfirmDraft;
    confirm.placeholder = translateFirstRunText(draft.locale, "Confirmar PIN ou senha");
    confirm.dataset.firstRunLocalSessionConfirm = "";
    confirm.disabled = localSessionPending;
    confirmField.append(confirm);
    form.append(secretField, confirmField);
    body.append(form);

    body.append(el(
      documentObject,
      "p",
      "ordax-first-run-note",
      "Use pelo menos 6 caracteres e repita exatamente a mesma credencial.",
    ));
    body.append(el(
      documentObject,
      "p",
      "ordax-first-run-note",
      "Deixe os dois campos vazios para continuar sem bloqueio autenticado. Você poderá configurar depois em Ajustes.",
    ));
    if (localSessionMessage) {
      const status = el(documentObject, "p", "ordax-first-run-status", localSessionMessage);
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      body.append(status);
    }
  };

  const renderAccount = (body) => {
    body.append(heading(
      "Conta OrdaX",
      "A conta é opcional.",
      "Entre com sua Conta OrdaX ou comece sem conta. Seus aplicativos locais continuam disponíveis sem internet.",
    ));
    const state = el(documentObject, "article", "ordax-first-run-account");
    const copy = sessionSnapshot.state === "signed-in"
      ? `Conta autenticada como ${sessionSnapshot.displayName}.`
      : sessionSnapshot.state === "signed-out"
        ? "Entre para usar sua Conta OrdaX neste dispositivo."
        : "O acesso à Conta OrdaX ainda não está disponível nesta sessão.";
    state.append(
      el(documentObject, "strong", "", sessionSnapshot.state === "signed-in" ? sessionSnapshot.displayName : "Conta OrdaX"),
      el(documentObject, "p", "", copy),
    );
    body.append(state);

    if (identityMessage) {
      const status = el(documentObject, "p", "ordax-first-run-status", identityMessage);
      status.setAttribute("role", "status");
      body.append(status);
    }

    if (sessionSnapshot.state === "signed-out" && capabilitySnapshot.identityCredentials) {
      const form = el(documentObject, "div", "ordax-first-run-form");
      const emailField = el(documentObject, "label", "ordax-first-run-field");
      emailField.append(el(documentObject, "span", "", "E-mail"));
      const email = documentObject.createElement("input");
      email.type = "email";
      email.autocomplete = "email";
      email.maxLength = 320;
      email.value = identityEmailDraft;
      email.dataset.firstRunIdentityEmail = "";
      email.disabled = identityPending !== null;
      emailField.append(email);

      const passwordField = el(documentObject, "label", "ordax-first-run-field");
      passwordField.append(el(documentObject, "span", "", "Senha"));
      const password = documentObject.createElement("input");
      password.type = "password";
      password.autocomplete = "current-password";
      password.maxLength = 1024;
      password.value = identityPasswordDraft;
      password.dataset.firstRunIdentityPassword = "";
      password.disabled = identityPending !== null;
      passwordField.append(password);
      form.append(emailField, passwordField);

      if (
        registrationPolicy
        && capabilitySnapshot.identityRegister
      ) {
        const legal = el(documentObject, "div", "ordax-first-run-legal");
        legal.append(
          el(documentObject, "strong", "", "Documentos vigentes"),
          el(documentObject, "p", "", "Leia os Termos e a Política de Privacidade antes de criar sua conta."),
        );
        const links = el(documentObject, "div", "ordax-first-run-legal-links");
        const privacy = documentObject.createElement("a");
        privacy.href = registrationPolicy.privacy.url;
        privacy.target = "_blank";
        privacy.rel = "noopener noreferrer";
        privacy.textContent = `${translateFirstRunText(draft.locale, "Privacidade")} · v${registrationPolicy.privacy.version} · ${registrationPolicy.privacy.effectiveDate}`;
        const terms = documentObject.createElement("a");
        terms.href = registrationPolicy.terms.url;
        terms.target = "_blank";
        terms.rel = "noopener noreferrer";
        terms.textContent = `${translateFirstRunText(draft.locale, "Termos")} · v${registrationPolicy.terms.version} · ${registrationPolicy.terms.effectiveDate}`;
        links.append(privacy, terms);
        const acceptance = el(documentObject, "label", "ordax-first-run-legal-acceptance");
        const checkbox = documentObject.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = registrationLegalAccepted;
        checkbox.dataset.firstRunRegistrationLegalAcceptance = "";
        checkbox.disabled = identityPending !== null;
        acceptance.append(
          checkbox,
          el(documentObject, "span", "", "Li e aceito os documentos vigentes indicados acima."),
        );
        legal.append(links, acceptance);
        form.append(legal);
      }

      body.append(form);
    }

    const buttons = el(documentObject, "div", "ordax-first-run-account-actions");
    if (sessionSnapshot.state === "signed-in") {
      buttons.append(action(documentObject, "Usar esta conta", "account-identity", true));
    } else {
      const signIn = action(documentObject, identityPending === "sign-in" ? "Entrando…" : "Entrar", "account-sign-in", true);
      signIn.disabled = identityPending !== null || !capabilitySnapshot.identitySignIn;
      const register = action(documentObject, identityPending === "register" ? "Criando conta…" : "Criar conta", "account-register");
      register.disabled = (
        identityPending !== null
        || registrationPolicyPending
        || !registrationPolicy
        || !registrationLegalAccepted
        || !capabilitySnapshot.identityRegister
      );
      buttons.append(signIn, register);
    }
    body.append(buttons);

    if (
      sessionSnapshot.state !== "signed-in"
      && !capabilitySnapshot.identitySignIn
      && !capabilitySnapshot.identityRegister
    ) {
      body.append(el(
        documentObject,
        "p",
        "ordax-first-run-note",
        "Você pode começar sem conta e entrar depois em Ajustes. Entrar e criar conta ficam disponíveis quando o serviço de conta estiver conectado.",
      ));
    }
  };

  const renderPrivacy = (body) => {
    body.append(heading(
      "Privacidade",
      "Você no controle.",
      "Escolha como o OrdaX usa a memória local. Esta configuração não ativa sincronização, backup ou cobrança.",
    ));
    const grid = el(documentObject, "div", "ordax-first-run-grid");
    [
      ["Dados locais", "Arquivos, Notas e preferências continuam no armazenamento persistente do USB."],
      ["Conta independente", "Seus aplicativos locais continuam disponíveis sem conta e sem internet."],
      ["Sem disco interno", "Esta configuração não instala o OrdaX no disco interno do computador."],
    ].forEach(([title, detail]) => {
      const item = el(documentObject, "article", "ordax-first-run-tile");
      item.append(el(documentObject, "strong", "", title), el(documentObject, "p", "", detail));
      grid.append(item);
    });

    const memory = el(documentObject, "article", "ordax-first-run-memory");
    memory.dataset.firstRunPrivacyMemory = "";
    memory.append(
      el(documentObject, "strong", "", "Memória automática"),
      el(documentObject, "p", "", "Permite à OrdaX Intelligence registrar memórias úteis localmente, conforme as permissões do dispositivo. Você pode alterar esta opção em Ajustes."),
    );
    memory.querySelector("p").id = "ordax-first-run-memory-description";
    const memoryChoice = el(documentObject, "label", "ordax-first-run-memory-choice");
    const memoryToggle = documentObject.createElement("input");
    memoryToggle.type = "checkbox";
    memoryToggle.setAttribute("role", "switch");
    memoryToggle.setAttribute("aria-label", translateFirstRunText(draft.locale, "Memória automática"));
    memoryToggle.setAttribute("aria-describedby", "ordax-first-run-memory-description");
    memoryToggle.checked = memoryAutoCaptureEnabled(preferencePort.getSnapshot());
    memoryToggle.dataset.firstRunMemoryAutoCapture = "";
    memoryChoice.append(
      memoryToggle,
      el(documentObject, "span", "", memoryToggle.checked ? "Ativada" : "Desativada"),
    );
    memory.append(memoryChoice);
    body.append(memory, grid);
  };

  const renderName = (body) => {
    body.append(heading(
      "Nome do dispositivo",
      "Identifique este OrdaX.",
      "Dê um nome fácil de reconhecer ao seu dispositivo. Você pode alterá-lo depois em Ajustes.",
    ));
    if (!capabilitySnapshot.deviceProfile || !deviceProfilePort || !deviceProfileSnapshot) {
      body.append(availabilityPanel(
        documentObject,
        "Nome do dispositivo",
        "O nome do dispositivo está indisponível agora. O OrdaX manterá o nome já gerenciado pelo sistema.",
      ));
      return;
    }
    const field = el(documentObject, "label", "ordax-first-run-field");
    field.append(el(documentObject, "span", "", "Nome do dispositivo"));
    const input = documentObject.createElement("input");
    input.type = "text";
    input.maxLength = 120;
    input.autocomplete = "off";
    input.value = deviceNameDraft;
    input.disabled = deviceNamePending;
    input.dataset.firstRunDeviceName = "";
    field.append(input);
    body.append(field);
    if (deviceNameMessage) {
      const message = el(documentObject, "p", "ordax-first-run-note", deviceNameMessage);
      message.setAttribute("role", "status");
      body.append(message);
    }
  };

  const renderReady = (body) => {
    body.append(heading(
      "Tudo pronto",
      "Revise suas escolhas.",
      "Confira as opções abaixo. Ao entrar, o OrdaX salva a conclusão desta configuração no pendrive.",
    ));
    const summary = el(documentObject, "dl", "ordax-first-run-summary");
    const localeLabel = REGIONAL_LOCALE_OPTIONS.find((entry) => entry.value === draft.locale)?.label ?? draft.locale;
    [
      ["Idioma", localeLabel],
      ["Fuso", draft.timeZone],
      ["Bloqueio", localSessionSnapshot?.credentialConfigured ? "PIN/senha local" : "Não configurado"],
      ["Conta", draft.accountMode === "identity" ? "Conta OrdaX" : "Somente local"],
      ["Dispositivo", deviceProfileSnapshot?.displayName ?? "Nome gerenciado pelo sistema"],
      ["Execução", "Pendrive USB"],
    ].forEach(([key, value]) => {
      summary.append(el(documentObject, "dt", "", key), el(documentObject, "dd", "", value));
    });
    body.append(summary);
    if (firstRunAppSelection !== null) {
      const appSummary = el(documentObject, "details", "ordax-first-run-essentials");
      appSummary.dataset.firstRunEssentials = "";
      appSummary.append(el(documentObject, "summary", "", "Aplicativos essenciais"));
      for (const [label, count] of [
        ["Aplicativos independentes verificados:", firstRunAppSelection.alreadyInstalledAppIds.length],
        ["Candidatos verificados para futura distribuição:", firstRunAppSelection.eligibleCandidateAppIds.length],
        ["Removidos ou fora desta configuração:", firstRunAppSelection.suppressedAppIds.length],
        ["Distribuição ainda não verificada:", firstRunAppSelection.unavailableAppIds.length],
      ]) {
        const line = el(documentObject, "p", "", label);
        line.append(documentObject.createTextNode(` ${count}`));
        appSummary.append(line);
      }
      appSummary.append(el(documentObject, "p", "",
        "Esta lista é informativa e não instala aplicativos. Aplicativos integrados fora do catálogo verificado não entram nesta contagem."
      ));
      body.append(appSummary);
    }
    if (completionError) {
      const error = el(documentObject, "p", "ordax-first-run-error", completionError);
      error.setAttribute("role", "alert");
      body.append(error);
    }
  };

  const render = () => {
    if (destroyed) return;
    renderProgress();
    card.replaceChildren();
    const body = el(documentObject, "div", "ordax-first-run-body");
    const step = STEPS[stepIndex];
    overlay.dataset.firstRunStep = step;
    if (step === "welcome") renderWelcome(body);
    else if (step === "regional") renderRegional(body);
    else if (step === "network") renderNetwork(body);
    else if (step === "security") renderSecurity(body);
    else if (step === "account") renderAccount(body);
    else if (step === "privacy") renderPrivacy(body);
    else if (step === "name") renderName(body);
    else renderReady(body);

    const footer = el(documentObject, "footer", "ordax-first-run-footer");
    if (stepIndex > 0 && !finishing) footer.append(action(documentObject, "Voltar", "back"));
    if (step === "account") {
      const local = action(documentObject, "Continuar sem conta", "account-local", !capabilitySnapshot.identitySignIn && !capabilitySnapshot.identityRegister);
      local.disabled = identityPending !== null;
      footer.append(local);
    } else {
      const label = step === "ready"
        ? finishing ? "Salvando…" : "Entrar no OrdaX"
        : "Continuar";
      const next = action(documentObject, label, step === "ready" ? "finish" : "next", true);
      next.disabled = (
        finishing
        || (step === "security" && localSessionPending)
        || (step === "name" && deviceNamePending)
      );
      footer.append(next);
    }
    card.append(body, footer);
  };

  const refreshKeyboardLayout = async () => {
    if (!keyboardLayoutPort || destroyed) return;
    const ordinal = ++keyboardLayoutOrdinal;
    try {
      const snapshot = validateKeyboardLayoutSnapshot(await keyboardLayoutPort.read());
      if (destroyed || ordinal !== keyboardLayoutOrdinal) return;
      keyboardLayoutSnapshot = snapshot;
      keyboardLayoutReadFailed = false;
    } catch {
      if (destroyed || ordinal !== keyboardLayoutOrdinal) return;
      keyboardLayoutSnapshot = null;
      keyboardLayoutReadFailed = true;
    }
    if (!destroyed && STEPS[stepIndex] === "regional") render();
  };

  const go = (nextIndex) => {
    if (STEPS[stepIndex] === "regional" && nextIndex > stepIndex) {
      // Region data has one authority: the regular preference runtime.
      // The navigation cursor never duplicates these values.
      preferencePort.set(REGIONAL_LOCALE_PREFERENCE_ID, draft.locale);
      preferencePort.set(REGIONAL_TIME_ZONE_PREFERENCE_ID, draft.timeZone);
    }
    if (STEPS[stepIndex] === "network") passwordDraft = "";
    if (STEPS[stepIndex] === "security") {
      localSessionSecretDraft = "";
      localSessionConfirmDraft = "";
      localSessionMessage = "";
    }
    stepIndex = Math.max(0, Math.min(STEPS.length - 1, nextIndex));
    if (cursorPort) {
      const safeStep = safeFirstRunResumeStep(STEPS[stepIndex]);
      cursorQueue = cursorQueue.catch(() => {}).then(() => cursorPort.save(safeStep));
      void cursorQueue.catch(() => {});
    }
    completionError = "";
    render();
    if (STEPS[stepIndex] === "network" && networkPort && networkSnapshot === null) {
      void refreshNetwork(false);
    }
  };

  const refreshNetwork = async (scan) => {
    if (!networkPort || destroyed || networkPending) return;
    const ordinal = ++networkOrdinal;
    networkPending = true;
    networkMessage = scan ? networkManagementActionMessage("scan", 0) : "Lendo estado do Wi-Fi…";
    render();
    try {
      networkSnapshot = await (scan ? networkPort.scan() : networkPort.status());
      if (destroyed || ordinal !== networkOrdinal) return;
      networkMessage = scan ? networkManagementActionMessage("scan", 1) : "";
      if (selectedSsid && !networkSnapshot.networks.some((entry) => entry.ssid === selectedSsid)) {
        selectedSsid = null;
        passwordDraft = "";
      }
    } catch (error) {
      if (destroyed || ordinal !== networkOrdinal) return;
      networkMessage = scan
        ? networkManagementFailureMessage("scan", error)
        : "O Wi-Fi não pôde ser lido. Você pode continuar offline.";
    } finally {
      if (!destroyed && ordinal === networkOrdinal) {
        networkPending = false;
        render();
      }
    }
  };

  const connectNetwork = async (ssid, password) => {
    if (!networkPort || destroyed || networkPending) return;
    const ordinal = ++networkOrdinal;
    networkPending = true;
    networkMessage = networkManagementActionMessage("connect", 0);
    passwordDraft = "";
    render();
    try {
      networkSnapshot = await runNetworkManagementAction(networkPort, "connect", { ssid, password });
      if (destroyed || ordinal !== networkOrdinal) return;
      selectedSsid = null;
      networkMessage = networkManagementActionMessage("connect", 1);
    } catch (error) {
      if (destroyed || ordinal !== networkOrdinal) return;
      networkMessage = networkManagementFailureMessage("connect", error);
    } finally {
      if (!destroyed && ordinal === networkOrdinal) {
        networkPending = false;
        render();
      }
    }
  };

  const continueSecurity = async () => {
    if (destroyed || localSessionPending) return;
    if (!localSessionPort || !localSessionSnapshot || localSessionSnapshot.credentialConfigured) {
      go(stepIndex + 1);
      return;
    }
    if (!localSessionSecretDraft && !localSessionConfirmDraft) {
      go(stepIndex + 1);
      return;
    }
    if (
      localSessionSecretDraft.length < 6
      || localSessionSecretDraft !== localSessionConfirmDraft
    ) {
      localSessionMessage = "Use pelo menos 6 caracteres e repita exatamente a mesma credencial.";
      render();
      return;
    }
    let secret = localSessionSecretDraft;
    localSessionSecretDraft = "";
    localSessionConfirmDraft = "";
    localSessionPending = true;
    localSessionMessage = "Criando credencial local…";
    render();
    const operationSecret = secret;
    secret = "";
    try {
      localSessionSnapshot = validateLocalSessionSnapshot(
        await localSessionPort.configureCredential(operationSecret),
      );
      if (destroyed) return;
      localSessionMessage = "";
      go(stepIndex + 1);
    } catch {
      if (destroyed) return;
      localSessionMessage = "Não foi possível criar a credencial local. Nenhuma senha foi salva no First Run.";
      render();
    } finally {
      if (!destroyed) {
        localSessionPending = false;
        if (STEPS[stepIndex] === "security") render();
      }
    }
  };

  const continueDeviceName = async () => {
    if (destroyed || deviceNamePending) return;
    if (!deviceProfilePort || !deviceProfileSnapshot) {
      go(stepIndex + 1);
      return;
    }
    const nextName = deviceNameDraft.trim().replace(/\s+/g, " ");
    if (!nextName) {
      deviceNameMessage = "Digite um nome para identificar este dispositivo.";
      render();
      return;
    }
    if (nextName === deviceProfileSnapshot.displayName) {
      deviceNameDraft = nextName;
      deviceNameMessage = "";
      go(stepIndex + 1);
      return;
    }
    deviceNamePending = true;
    deviceNameMessage = "Salvando nome do dispositivo…";
    render();
    try {
      deviceProfileSnapshot = await deviceProfilePort.rename(nextName);
      if (destroyed) return;
      deviceNameDraft = deviceProfileSnapshot.displayName;
      deviceNameMessage = "";
      go(stepIndex + 1);
    } catch {
      if (destroyed) return;
      deviceNameMessage = "Não foi possível salvar o nome do dispositivo. O assistente continua aberto sem simular a alteração.";
      render();
    } finally {
      if (!destroyed) {
        deviceNamePending = false;
        if (STEPS[stepIndex] === "name") render();
      }
    }
  };

  const refreshRegistrationPolicy = async () => {
    if (
      destroyed
      || registrationPolicyPending
      || !capabilitySnapshot.registrationPolicy
    ) {
      if (!capabilitySnapshot.identityRegister) {
        registrationPolicy = null;
        registrationLegalAccepted = false;
      }
      return;
    }
    registrationPolicyPending = true;
    try {
      const policy = await credentialsPort.registrationPolicy();
      if (destroyed) return;
      const nextPolicy = (
        policy.registrationEnabled === true
        && capabilitySnapshot.identityRegister
      ) ? policy : null;
      if (!sameRegistrationLegalPolicy(registrationPolicy, nextPolicy)) {
        registrationLegalAccepted = false;
      }
      registrationPolicy = nextPolicy;
    } catch {
      if (!destroyed) {
        registrationPolicy = null;
        registrationLegalAccepted = false;
      }
    } finally {
      registrationPolicyPending = false;
      if (!destroyed && STEPS[stepIndex] === "account") render();
    }
  };

  const runIdentity = async (kind) => {
    if (destroyed || identityPending || !isIdentityActionSupported(actionsSnapshot, kind)) return;
    const credentialInput = credentialsPort && (kind === "sign-in" || kind === "register")
      ? {
          email: identityEmailDraft,
          password: identityPasswordDraft,
          ...(kind === "register" ? { legalAccepted: registrationLegalAccepted } : {}),
        }
      : null;
    identityPasswordDraft = "";
    identityPending = kind;
    identityMessage = "";
    render();
    try {
      let result = null;
      if (credentialInput) {
        result = kind === "sign-in"
          ? await credentialsPort.signIn(credentialInput)
          : await credentialsPort.register(credentialInput);
        if (typeof sessionPort.refresh === "function") {
          await sessionPort.refresh();
        }
      } else {
        await actionsPort.execute(kind);
      }
      if (destroyed) return;
      sessionSnapshot = sessionPort.getSnapshot();
      actionsSnapshot = actionsPort.getSnapshot();
      identityMessage = sessionSnapshot.state === "signed-in"
        ? "Conta autenticada. Você pode usá-la neste pendrive."
        : result?.confirmationRequired
          ? "Cadastro recebido. Confirme seu e-mail para entrar."
          : "A autenticação foi iniciada. O uso local continua disponível.";
    } catch {
      if (!destroyed) identityMessage = "A ação de conta não pôde ser concluída. O uso local continua disponível.";
    } finally {
      if (!destroyed) {
        identityPending = null;
        render();
      }
    }
  };

  const finish = async () => {
    if (destroyed || finishing || draft.accountMode === null) return;
    finishing = true;
    completionError = "";
    render();
    try {
      if (draft.accountMode === "identity") {
        // Recheck the live authority before persisting an identity-mode first run.
        // A cached or unavailable session must never become an authenticated receipt.
        const identityStillCurrent = await verifyFirstRunIdentitySession(sessionPort, selectedIdentitySubjectId);
        if (destroyed) return;
        if (!identityStillCurrent) {
          draft.accountMode = null;
          selectedIdentitySubjectId = null;
          stepIndex = getFirstRunStepIndex("account");
          identityMessage = "A sessão da Conta OrdaX mudou. Entre novamente ou continue sem conta.";
          finishing = false;
          render();
          return;
        }
      }
      preferencePort.set(REGIONAL_LOCALE_PREFERENCE_ID, draft.locale);
      preferencePort.set(REGIONAL_TIME_ZONE_PREFERENCE_ID, draft.timeZone);
      await store.save(completeFirstRunState(draft));
      close();
    } catch {
      if (destroyed) return;
      finishing = false;
      completionError = "Não foi possível confirmar a gravação do primeiro uso no pendrive. O assistente continua aberto para não perder a configuração.";
      render();
    }
  };

  const onClick = (event) => {
    const button = event.target.closest("[data-first-run-action]");
    if (!button || !overlay.contains(button) || button.disabled) return;
    const kind = button.dataset.firstRunAction;
    if (kind === "back") go(stepIndex - 1);
    else if (kind === "next" && STEPS[stepIndex] === "security") void continueSecurity();
    else if (kind === "next" && STEPS[stepIndex] === "name") void continueDeviceName();
    else if (kind === "next") go(stepIndex + 1);
    else if (kind === "finish") void finish();
    else if (kind === "network-scan") void refreshNetwork(true);
    else if (kind === "network-select") {
      const ssid = button.dataset.firstRunSsid ?? null;
      if (ssid !== selectedSsid) passwordDraft = "";
      selectedSsid = ssid;
      networkMessage = "";
      render();
      overlay.querySelector("[data-first-run-wifi-password]")?.focus();
    } else if (kind === "network-connect") {
      const input = overlay.querySelector("[data-first-run-wifi-password]");
      const ssid = button.dataset.firstRunSsid;
      if (!(input instanceof HTMLInputElement) || !ssid) return;
      const password = input.value;
      input.value = "";
      passwordDraft = "";
      if (!password) {
        networkMessage = "Digite a senha da rede Wi-Fi.";
        render();
      } else {
        void connectNetwork(ssid, password);
      }
    } else if (kind === "account-sign-in") void runIdentity("sign-in");
    else if (kind === "account-register") void runIdentity("register");
    else if (kind === "account-identity") {
      const currentSession = sessionPort.getSnapshot();
      if (currentSession.state !== "signed-in") {
        identityMessage = "A sessão da Conta OrdaX mudou. Entre novamente ou continue sem conta.";
        render();
        return;
      }
      selectedIdentitySubjectId = currentSession.subjectId;
      draft.accountMode = "identity";
      go(stepIndex + 1);
    } else if (kind === "account-local") {
      selectedIdentitySubjectId = null;
      draft.accountMode = "local-only";
      go(stepIndex + 1);
    }
  };

  const onInput = (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !overlay.contains(input)) return;
    if (input.matches("[data-first-run-wifi-password]")) {
      passwordDraft = input.value;
    } else if (input.matches("[data-first-run-identity-email]")) {
      identityEmailDraft = input.value;
    } else if (input.matches("[data-first-run-identity-password]")) {
      identityPasswordDraft = input.value;
    } else if (input.matches("[data-first-run-local-session-secret]")) {
      localSessionSecretDraft = input.value;
    } else if (input.matches("[data-first-run-local-session-confirm]")) {
      localSessionConfirmDraft = input.value;
    } else if (input.matches("[data-first-run-device-name]")) {
      deviceNameDraft = input.value;
      deviceNameMessage = "";
    }
  };

  const onChange = (event) => {
    if (event.target.matches("[data-first-run-locale]")) {
      draft.locale = event.target.value;
      syncFirstRunDocumentLocale(documentObject, draft.locale);
      render();
    } else if (event.target.matches("[data-first-run-time-zone]")) {
      draft.timeZone = event.target.value;
    } else if (event.target.matches("[data-first-run-memory-auto-capture]")) {
      preferencePort.set(
        MEMORY_AUTO_CAPTURE_PREFERENCE_ID,
        event.target.checked === true ? "on" : "off",
      );
      render();
    } else if (event.target.matches("[data-first-run-registration-legal-acceptance]")) {
      registrationLegalAccepted = event.target.checked === true;
      render();
    }
  };

  const onKeyDown = (event) => {
    if (event.key !== "Enter") return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !overlay.contains(input)) return;
    if (input.matches("[data-first-run-wifi-password]")) {
      event.preventDefault();
      overlay.querySelector('[data-first-run-action="network-connect"]')?.click();
    } else if (input.matches("[data-first-run-identity-email], [data-first-run-identity-password]")) {
      event.preventDefault();
      overlay.querySelector('[data-first-run-action="account-sign-in"]')?.click();
    } else if (
      input.matches("[data-first-run-local-session-secret], [data-first-run-local-session-confirm]")
    ) {
      event.preventDefault();
      overlay.querySelector('[data-first-run-action="next"]')?.click();
    }
  };

  overlay.addEventListener("click", onClick);
  overlay.addEventListener("input", onInput);
  overlay.addEventListener("change", onChange);
  overlay.addEventListener("keydown", onKeyDown);

  unsubscribeSession = sessionPort.subscribe((snapshot) => {
    sessionSnapshot = snapshot;
    if (
      draft.accountMode === "identity"
      && !finishing
      && !matchesFirstRunIdentitySelection(selectedIdentitySubjectId, sessionSnapshot)
    ) {
      draft.accountMode = null;
      selectedIdentitySubjectId = null;
      stepIndex = getFirstRunStepIndex("account");
      identityMessage = "A sessão da Conta OrdaX mudou. Entre novamente ou continue sem conta.";
    }
    if (sessionSnapshot.state === "signed-in") {
      registrationPolicy = null;
      registrationLegalAccepted = false;
    }
    if (!destroyed && STEPS[stepIndex] === "account") render();
  });
  unsubscribeActions = actionsPort.subscribe((snapshot) => {
    actionsSnapshot = snapshot;
    capabilitySnapshot = deriveFirstRunCapabilities({
      networkManagement: networkPort,
      localSession: localSessionPort,
      deviceProfile: deviceProfilePort,
      identityCredentials: credentialsPort,
      identityActionsSnapshot: actionsSnapshot,
    });
    if (!capabilitySnapshot.identityRegister) {
      registrationPolicy = null;
      registrationLegalAccepted = false;
    }
    if (!destroyed && STEPS[stepIndex] === "account") render();
    if (capabilitySnapshot.registrationPolicy && registrationPolicy === null) {
      void refreshRegistrationPolicy();
    }
  });
  unsubscribeLocalSession = localSessionPort?.subscribe((snapshot) => {
    localSessionSnapshot = validateLocalSessionSnapshot(snapshot);
    if (!destroyed && STEPS[stepIndex] === "security") render();
  });

  render();
  if (keyboardLayoutPort) void refreshKeyboardLayout();
  if (capabilitySnapshot.registrationPolicy) {
    void refreshRegistrationPolicy();
  }
  queueMicrotask(() => overlay.querySelector("button, select, input")?.focus?.());

  return Object.freeze({
    shown: true,
    destroy() {
      close();
    },
  });
}
