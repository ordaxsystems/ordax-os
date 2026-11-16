import { assertNetworkManagementPort, WifiCredentialsValidationError } from "../../contracts/network-management.mjs";

const ACTIONS = new Set(["scan", "connect", "disconnect", "forget", "reconnect"]);

const ACTION_MESSAGE_IDS = Object.freeze({
  scan: Object.freeze(["network.management.scan.pending", "network.management.scan.success"]),
  connect: Object.freeze(["network.management.connect.pending", "network.management.connect.success"]),
  disconnect: Object.freeze(["network.management.disconnect.pending", "network.management.disconnect.success"]),
  forget: Object.freeze(["network.management.forget.pending", "network.management.forget.success"]),
  reconnect: Object.freeze(["network.management.reconnect.pending", "network.management.reconnect.success"]),
});

const ACTION_MESSAGES = Object.freeze({
  scan: Object.freeze(["Procurando redes Wi-Fi…", "Redes Wi-Fi atualizadas."]),
  connect: Object.freeze(["Conectando ao Wi-Fi…", "Wi-Fi conectado."]),
  disconnect: Object.freeze(["Desconectando do Wi-Fi…", "Wi-Fi desconectado."]),
  forget: Object.freeze(["Esquecendo a rede salva…", "Rede Wi-Fi esquecida."]),
  reconnect: Object.freeze(["Reconectando ao Wi-Fi salvo…", "Wi-Fi reconectado."]),
});

function assertAction(action) {
  if (!ACTIONS.has(action)) throw new TypeError("Ação de Wi-Fi inválida");
  return action;
}

function failureKind(action, error) {
  assertAction(action);
  if ([409, 503].includes(error?.status)) {
    const reasons = {
      "authentication-failed": "authentication",
      "dhcp-failed": "dhcp",
      "supplicant-start-failed": "supplicant",
      "network-owner-unavailable": "ownerUnavailable",
      "dhcp-runtime-unavailable": "dhcpRuntime",
      "scan-failed": "scanFailed",
      "connect-failed": "connectFailure",
      "reconnect-failed": "reconnectFailure",
      "saved-network-unavailable": "noSavedNetwork",
      "network-broker-unavailable": "brokerUnavailable",
      "network-broker-timeout": "brokerTimeout",
      "network-broker-io-failed": "brokerIo",
      "wifi-tools-unavailable": "wifiTools",
      "no-wifi-interface": "noInterface",
      "credential-save-failed": "credentialSave",
    };
    if (Object.hasOwn(reasons, error?.networkReason)) return reasons[error.networkReason];
  }
  if (error?.status === 403) return "sessionUnavailable";
  if (error?.status === 409 && action === "connect") return "connectConflict";
  if (error?.status === 409 && action === "reconnect") return "reconnectConflict";
  // A malformed native snapshot also throws TypeError; it is not a bad password.
  if (error instanceof WifiCredentialsValidationError) return "validation";
  return "generic";
}

export function networkManagementActionMessageId(action, state) {
  return ACTION_MESSAGE_IDS[assertAction(action)][state === 1 ? 1 : 0];
}

export function networkManagementFailureMessageId(action, error) {
  return `network.management.error.${failureKind(action, error)}`;
}

export function networkManagementActionMessage(action, state) {
  return ACTION_MESSAGES[assertAction(action)][state === 1 ? 1 : 0];
}

export function networkManagementFailureMessage(action, error) {
  const messages = {
    connectConflict: "Não foi possível conectar. Confira a senha e se a rede ainda está disponível.",
    authentication: "O Wi-Fi não concluiu a autenticação WPA. Confira a senha e o modo de segurança do roteador.",
    dhcp: "O Wi-Fi autenticou, mas o roteador não forneceu um endereço IP (DHCP).",
    supplicant: "O serviço de autenticação Wi-Fi não conseguiu iniciar neste dispositivo.",
    ownerUnavailable: "O controlador Wi-Fi não respondeu. A conexão anterior foi preservada.",
    dhcpRuntime: "Componentes nativos de DHCP ausentes nesta instalação. A conexão Wi-Fi existente foi preservada.",
    scanFailed: "O adaptador Wi-Fi não conseguiu concluir a busca de redes.",
    connectFailure: "O controlador Wi-Fi não confirmou a nova conexão. O motivo específico ainda não foi identificado.",
    reconnectFailure: "O controlador Wi-Fi não confirmou a reconexão. A rede salva foi preservada.",
    noSavedNetwork: "Não há uma rede Wi-Fi salva para reconectar. Escolha uma rede e informe a senha.",
    sessionUnavailable: "A sessão nativa de Wi-Fi não autorizou a ação. Reinicie a etapa de Rede e tente novamente.",
    brokerUnavailable: "O serviço nativo de Wi-Fi não está disponível. Reinicie a Surface para recuperar o controlador.",
    brokerTimeout: "O serviço nativo de Wi-Fi demorou demais para responder. A conexão não foi confirmada.",
    brokerIo: "O serviço nativo de Wi-Fi falhou ao acessar o controlador. Nenhuma conexão foi confirmada.",
    wifiTools: "As ferramentas Wi-Fi necessárias não estão disponíveis no sistema.",
    noInterface: "Nenhuma interface Wi-Fi foi detectada pelo sistema. Verifique o adaptador sem fio.",
    credentialSave: "A conexão Wi-Fi foi iniciada, mas a configuração não pôde ser salva.",
    reconnectConflict: "A rede salva não pôde ser reconectada. A configuração salva foi preservada.",
    validation: "SSID ou senha fora dos limites aceitos para esta rede Wi-Fi.",
    generic: "A ação de Wi-Fi não pôde ser concluída. A rede anterior foi preservada quando aplicável.",
  };
  return messages[failureKind(action, error)];
}

export async function runNetworkManagementAction(port, action, credentials = null) {
  const management = assertNetworkManagementPort(port);
  assertAction(action);
  switch (action) {
    case "scan":
      return management.scan();
    case "connect":
      return management.connect(credentials);
    case "disconnect":
      return management.disconnect();
    case "forget":
      return management.forget();
    case "reconnect":
      return management.reconnect();
    default:
      throw new TypeError("Ação de Wi-Fi inválida");
  }
}
