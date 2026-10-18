// Presentation labels only. The Store snapshot and its canonical projector own status semantics.
const LABELS: Readonly<Record<string, string>> = Object.freeze({
  unknown: 'Estado indisponível',
  'not-listed': 'Não listado na Loja',
  installed: 'Instalado',
  'update-available': 'Atualização disponível',
  available: 'Disponível na Loja',
  blocked: 'Bloqueado',
  'failed-retained': 'Falha; versão preservada',
  'in-progress': 'Operação em andamento',
  unavailable: 'Indisponível',
});

export function storeAppStatusLabel(status: string): string {
  return LABELS[status] ?? 'Estado desconhecido';
}
