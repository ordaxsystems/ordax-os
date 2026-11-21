import { recipeIngredients, scaleQty, type ResultEntry } from './demo';

export const SIMULATION_NOTICE = 'AVISO: Simulação de demonstração com dados fictícios. Nenhum provedor, arquivo ou operação real foi utilizado.';
export const AI_NOTICE = 'AVISO: Resposta gerada por IA em prévia provisória. Pode conter erros; nenhuma ação foi executada no OrdaX.';

/** Plain-text export of a result; always carries the notice that applies to it. */
export function entryToText(e: ResultEntry): string {
  const lines = ['OrdaX Intelligence', e.title, `Solicitação: ${e.prompt}`, ''];
  if (e.kind === 'unknown') {
    if (e.ai?.state === 'ready') {
      lines.push(e.ai.answer, '');
      if (e.ai.steps.length) lines.push('Próximos passos:', ...e.ai.steps.map((s, i) => `${i + 1}. ${s}`), '');
      lines.push(AI_NOTICE);
    } else lines.push('Nenhuma resposta disponível.');
    return lines.join('\n');
  }
  lines.push(SIMULATION_NOTICE, '');
  if (e.kind === 'recipe' && e.recipe) {
    lines.push(`Rende ${e.recipe.servings} porções`, 'Ingredientes:', ...recipeIngredients.map(i => `- ${scaleQty(i.qty, e.recipe!.servings)} ${i.unit}`));
    if (e.recipe.shopping) lines.push('', 'Lista de compras:', ...recipeIngredients.map(i => `[ ] ${i.shop}`));
  }
  if (e.mission) lines.push(`Estado da missão: ${e.mission.phase}`);
  if (e.followUps.length) lines.push('', 'Próximos passos sugeridos:', ...e.followUps.map(f => `- ${f}`));
  return lines.join('\n').trim();
}

export async function exportEntryPdf(e: ResultEntry) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const w = doc.internal.pageSize.getWidth() - 96; const h = doc.internal.pageSize.getHeight();
  let y = 56;
  for (const line of entryToText(e).split('\n')) {
    const bold = y === 56 || line.startsWith('AVISO');
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(y === 56 ? 16 : 11);
    for (const part of doc.splitTextToSize(line || ' ', w) as string[]) {
      if (y > h - 48) { doc.addPage(); y = 56; }
      doc.text(part, 48, y); y += 16;
    }
  }
  doc.save(`ordax-intelligence-${e.id}.pdf`);
}
