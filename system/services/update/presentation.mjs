const UPDATE_LABELS = Object.freeze({
  running: "Em execução",
  applied: "Atualização aplicada",
  updating: "Atualizando",
  "network-error": "Sem conexão para atualizar",
  "remote-error": "Fonte de atualização indisponível",
  "pull-error": "Falha ao atualizar",
  "rolled-back": "Atualização revertida",
  rejected: "Entrega bloqueada",
  pinned: "Atualizações pausadas por rollback",
  disabled: "Atualização indisponível",
  unavailable: "Estado indisponível",
});

export function updateStatusLabel(status) {
  return UPDATE_LABELS[status] ?? String(status || "Estado indisponível");
}

export function updateIsAlerting(snapshot) {
  return Boolean(snapshot?.bootRefreshRequired) || [
    "network-error",
    "remote-error",
    "pull-error",
    "rolled-back",
    "rejected",
    "pinned",
  ].includes(snapshot?.status);
}

export function shortSha(value) {
  if (typeof value !== "string" || value.length < 8 || value === "unavailable") return "—";
  return value.slice(0, 8);
}

export function deliveryLabel(value) {
  return Number.isSafeInteger(value) && value > 0 ? `Entrega ${value}` : "Entrega sem número";
}

export function updateSummaryLabel(snapshot) {
  if (!snapshot?.bootRefreshRequired) return updateStatusLabel(snapshot?.status);
  switch (snapshot?.baseUpdatePhase) {
    case "candidate-requested": return "Preparando atualização de Base";
    case "candidate-fetching": return "Baixando atualização de Base";
    case "candidate-ready": return "Candidata de Base pronta";
    case "staged": return "Base gravada no slot inativo";
    case "activation-ready": return "Base pronta para ativação";
    default: return "Atualização de base pendente";
  }
}

export function updateSummaryDetail(snapshot) {
  if (!snapshot?.bootRefreshRequired) return "";
  switch (snapshot?.baseUpdatePhase) {
    case "candidate-requested":
      return "A candidata exata foi solicitada ao atualizador de Base. A entrega atual continua em execução.";
    case "candidate-fetching":
      return "Kernel, initramfs e rootfs da candidata estão sendo baixados e verificados sem alterar o boot atual.";
    case "candidate-ready":
      return "A candidata e a rootfs versionada foram verificadas. O staging no slot inativo é a próxima etapa.";
    case "staged":
      return "A candidata foi gravada no slot inativo. O boot atual e a recuperação permanecem preservados.";
    case "activation-ready":
      return "A candidata foi revalidada no slot inativo e está pronta para a etapa de ativação. A ativação automática ainda não está habilitada; reiniciar manualmente não força a aplicação.";
    default:
      return "Reiniciar manualmente agora não conclui esta atualização. O OrdaX preserva o boot atual enquanto prepara e valida a candidata.";
  }
}
