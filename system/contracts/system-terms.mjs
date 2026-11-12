// Device first-use acknowledgement, separate from account registration policy.
// Development text only. Publication requires the OS legal document owner.
export const SYSTEM_TERMS_DOCUMENT = Object.freeze({
  id: "ordax-os-terms",
  version: "draft-2026-10-20",
  status: "draft",
  sections: Object.freeze([
    Object.freeze({ title: "Documento em preparação", text: "Os Termos de Uso do OrdaX OS ainda estão sendo elaborados. Este texto provisório permite avaliar o fluxo de primeiro uso e será substituído pela versão definitiva." }),
    Object.freeze({ title: "Uso do sistema", text: "Este aceite se refere ao OrdaX OS neste dispositivo e é separado dos documentos da Conta OrdaX. Você pode usar o sistema com ou sem conta." }),
    Object.freeze({ title: "Memória e permissões", text: "As opções de Memória, privacidade e permissões continuam disponíveis em Ajustes e nos recursos correspondentes. Marcar esta caixa não altera essas opções nem ativa sincronização ou serviços pagos." }),
  ]),
});

export function validateSystemTermsAcceptance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "accepted,documentId,status,version"
    || value.documentId !== SYSTEM_TERMS_DOCUMENT.id
    || value.accepted !== true || value.status !== "draft"
    || typeof value.version !== "string" || !/^draft-[A-Za-z0-9._-]{1,64}$/.test(value.version)) {
    throw new TypeError("Invalid OrdaX OS terms acknowledgement");
  }
  return Object.freeze({ documentId: value.documentId, version: value.version, status: value.status, accepted: true });
}

export function createSystemTermsAcceptance(accepted) {
  return validateSystemTermsAcceptance({ documentId: SYSTEM_TERMS_DOCUMENT.id,
    version: SYSTEM_TERMS_DOCUMENT.version, status: SYSTEM_TERMS_DOCUMENT.status, accepted });
}
