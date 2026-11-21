/**
 * OrdaX Intelligence — demonstration engine (presentation only).
 * Deterministic keyword matching over isolated fixtures. It never calls a model,
 * never reads user data and never executes operations. Real interpretation
 * belongs to the official OrdaX OS / Intelligence owners.
 */
export type ScenarioKind = 'recipe' | 'gallery' | 'report' | 'document' | 'project' | 'mission' | 'unknown';
export type Stage = 'interpreting' | 'consulting' | 'organizing' | 'preparing';
export const stages: { id: Stage; label: string }[] = [
  { id: 'interpreting', label: 'Interpretando' },
  { id: 'consulting', label: 'Consultando' },
  { id: 'organizing', label: 'Organizando' },
  { id: 'preparing', label: 'Preparando' },
];

export type RecipeState = { servings: number; shopping: boolean };
export type MissionState = { phase: 'awaiting-approval' | 'running' | 'completed' | 'cancelled'; step: number };
export type ResultEntry = {
  id: string;
  kind: ScenarioKind;
  prompt: string;
  title: string;
  recipe?: RecipeState | undefined;
  mission?: MissionState | undefined;
  followUps: string[];
  /** Live model reply for prompts outside the demo scenarios. */
  ai?: { state: 'loading' | 'ready' | 'error'; answer: string; steps: string[]; error?: string } | undefined;
};

const norm = (v: string) => v.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Strict matching: only the six documented scenarios and their explicit variations. Anything else is 'unknown'. */
export function classify(prompt: string): ScenarioKind {
  const t = norm(prompt);
  if (/bolo (salgado )?de atum/.test(t) && /receita|bolo/.test(t)) return 'recipe';
  if (/(imagen|imagem|foto|galeria)/.test(t) && /salvador/.test(t)) return 'gallery';
  if (/vendas/.test(t) && /(este|deste|do|neste) mes|mensal/.test(t)) return 'report';
  if (/\bpdf\b/.test(t) && /analis|resum/.test(t)) return 'document';
  if (/organiz/.test(t) && /documentos/.test(t) && /tipo/.test(t)) return 'mission';
  if (/analis/.test(t) && /(projeto.*studio|studio.*projeto|bay of all saints)/.test(t)) return 'project';
  return 'unknown';
}

const titles: Record<ScenarioKind, string> = {
  recipe: 'Bolo salgado de atum', gallery: 'Imagens de Salvador', report: 'Vendas do mês', document: 'Relatório Financeiro 2024',
  project: 'Projeto Bay of All Saints', mission: 'Organizar documentos por tipo', unknown: 'Solicitação não reconhecida',
};
const followUps: Record<ScenarioKind, string[]> = {
  recipe: ['Adapte para quatro pessoas', 'Faça minha lista de compras'],
  gallery: [], report: [], document: [], project: [], mission: [], unknown: [],
};

/** Applies a follow-up to the current result when the demo understands it; otherwise returns null. */
export function refine(entry: ResultEntry, prompt: string): ResultEntry | null {
  const t = norm(prompt);
  if (entry.kind === 'recipe' && entry.recipe) {
    const match = t.match(/(\d+|duas|dois|tres|quatro|cinco|seis|oito|dez)\s*pessoa/);
    const words: Record<string, number> = { dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, oito: 8, dez: 10 };
    if (match?.[1]) { const n = Number(match[1]) || words[match[1]] || 0; if (n > 0 && n <= 50) return { ...entry, recipe: { ...entry.recipe, servings: n } }; }
    if (/lista de compras|compras/.test(t)) return { ...entry, recipe: { ...entry.recipe, shopping: true } };
  }
  return null;
}

export function createResult(prompt: string, id: string): ResultEntry {
  const kind = classify(prompt);
  return {
    id, kind, prompt, title: kind === 'unknown' ? (prompt.length > 48 ? `${prompt.slice(0, 48)}…` : prompt) : titles[kind], followUps: followUps[kind],
    recipe: kind === 'recipe' ? { servings: 6, shopping: false } : undefined,
    mission: kind === 'mission' ? { phase: 'awaiting-approval', step: 1 } : undefined,
    ai: kind === 'unknown' ? { state: 'loading', answer: '', steps: [] } : undefined,
  };
}

export function missionReducer(state: MissionState, action: 'approve' | 'advance' | 'cancel'): MissionState {
  if (action === 'cancel') return state.phase === 'completed' ? state : { ...state, phase: 'cancelled' };
  if (action === 'approve') return state.phase === 'awaiting-approval' ? { phase: 'running', step: 2 } : state;
  if (state.phase !== 'running') return state;
  return state.step >= 4 ? { phase: 'completed', step: 5 } : { ...state, step: state.step + 1 };
}

/** Fixture quantities are for 6 servings. */
export const recipeIngredients = [
  { qty: 2, unit: 'latas de atum', shop: 'Atum em lata' }, { qty: 2, unit: 'ovos', shop: 'Ovos' },
  { qty: 1, unit: 'xícara de leite', shop: 'Leite' }, { qty: 2, unit: 'xícaras de farinha de trigo', shop: 'Farinha de trigo' },
  { qty: 1, unit: 'tomate picado', shop: 'Tomate' }, { qty: 1, unit: 'cebola picada', shop: 'Cebola' },
  { qty: 0.5, unit: 'xícara de óleo', shop: 'Óleo' }, { qty: 1, unit: 'colher de sopa de fermento', shop: 'Fermento químico' },
];
export function scaleQty(qty: number, servings: number) {
  const v = Math.round((qty * servings / 6) * 4) / 4;
  const whole = Math.floor(v); const frac = v - whole;
  const f = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
  return whole === 0 ? (f || '¼') : `${whole}${f ? ` ${f}` : ''}`;
}

export const demoCommands: { label: string; prompt: string }[] = [
  { label: 'Receita', prompt: 'Mostre uma receita de bolo de atum' },
  { label: 'Galeria', prompt: 'Mostre imagens de Salvador' },
  { label: 'Relatório', prompt: 'Mostre minhas vendas deste mês' },
  { label: 'Documento', prompt: 'Analise este PDF' },
  { label: 'Projeto', prompt: 'Analise meu projeto no Studio' },
  { label: 'Missão', prompt: 'Organize meus documentos por tipo' },
];
