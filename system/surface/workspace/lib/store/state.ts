import { findItem, type StoreItem } from './catalog';

/** Session-only demo state for the Store library and operations. Requests never become results by themselves. */
export type ItemStatus =
  | 'available' | 'installed' | 'update-available' | 'informational'
  | 'disconnected' | 'authorization-required' | 'connected' | 'unavailable'
  | 'disabled' | 'enabled';
export type OpKind = 'install' | 'update' | 'remove' | 'connect' | 'disconnect' | 'enable' | 'disable' | 'apply';
export type OpState = 'requested' | 'accepted' | 'running' | 'succeeded' | 'failed' | 'blocked';
export type Operation = { id: string; itemId: string; op: OpKind; state: OpState; message: string };
export type StoreState = { status: Record<string, ItemStatus>; ops: Operation[]; favorites: string[]; history: string[] };
export type StoreAction =
  | { type: 'request'; itemId: string; op: OpKind; id: string }
  | { type: 'advance'; id: string }
  | { type: 'authorize'; itemId: string; approve: boolean }
  | { type: 'favorite'; itemId: string }
  | { type: 'visit'; itemId: string }
  | { type: 'dismiss'; id: string };

/** Demo outcome: this update always fails, to show failure handling. */
export const DEMO_FAILING = new Set(['notes']);
/** Services an agent may depend on that are not connected in this prototype. */
export const UNAVAILABLE_DEPENDENCIES = new Set(['projects-svc']);

export function defaultStatus(i: StoreItem): ItemStatus {
  switch (i.kind) {
    case 'model': return 'informational';
    case 'provider': case 'connector': return 'disconnected';
    case 'agent': return 'disabled';
    default: return 'available';
  }
}
export const initialStore: StoreState = {
  status: { studio: 'installed', files: 'update-available', notes: 'update-available', aurora: 'installed', github: 'connected', 'content-agent': 'enabled', 'lint-tools': 'update-available' },
  ops: [], favorites: ['studio', 'llama-8b'], history: [],
};
export const statusOf = (s: StoreState, i: StoreItem) => s.status[i.id] ?? defaultStatus(i);

const label: Record<OpKind, string> = { install: 'Instalação', update: 'Atualização', remove: 'Remoção', connect: 'Conexão', disconnect: 'Desconexão', enable: 'Habilitação', disable: 'Desabilitação', apply: 'Aplicação' };

/** Immediate block reasons; null means the request can be queued. */
export function blockReason(i: StoreItem, op: OpKind): string | null {
  if (i.kind === 'model' && op === 'install') return 'A instalação independente de modelos ainda não está habilitada no OrdaX oficial.';
  if (i.kind === 'agent' && op === 'enable') {
    const missing = i.dependencies.filter(d => UNAVAILABLE_DEPENDENCIES.has(d));
    if (missing.length) return 'Dependência não atendida: serviço de Projetos não conectado.';
  }
  if (i.kind === 'provider' && op === 'connect' && !i.demoConnectable) return 'Provedor indisponível nesta demonstração.';
  return null;
}

function finish(s: StoreState, o: Operation): StoreState {
  const i = findItem(o.itemId); if (!i) return s;
  if (o.op === 'update' && DEMO_FAILING.has(i.id)) {
    return { ...s, ops: s.ops.map(x => x.id === o.id ? { ...x, state: 'failed', message: 'Falha simulada na verificação do pacote. A versão anterior foi mantida.' } : x) };
  }
  const next: ItemStatus = o.op === 'install' || o.op === 'update' || o.op === 'apply' ? 'installed' : o.op === 'remove' ? 'available' : o.op === 'disconnect' ? 'disconnected' : o.op === 'enable' ? 'enabled' : o.op === 'disable' ? 'disabled' : 'connected';
  return { ...s, status: { ...s.status, [i.id]: next }, ops: s.ops.map(x => x.id === o.id ? { ...x, state: 'succeeded', message: `${label[o.op]} concluída (simulação).` } : x) };
}

export function storeReducer(s: StoreState, a: StoreAction): StoreState {
  switch (a.type) {
    case 'request': {
      const i = findItem(a.itemId); if (!i) return s;
      if (s.ops.some(o => o.itemId === a.itemId && ['requested', 'accepted', 'running'].includes(o.state))) return s;
      const reason = blockReason(i, a.op);
      if (reason) return { ...s, ops: [{ id: a.id, itemId: i.id, op: a.op, state: 'blocked', message: reason }, ...s.ops] };
      if (a.op === 'connect') return { ...s, status: { ...s.status, [i.id]: 'authorization-required' } };
      return { ...s, ops: [{ id: a.id, itemId: i.id, op: a.op, state: 'requested', message: `${label[a.op]} solicitada (simulação).` }, ...s.ops] };
    }
    case 'authorize': {
      const i = findItem(a.itemId); if (!i || s.status[i.id] !== 'authorization-required') return s;
      if (!a.approve) return { ...s, status: { ...s.status, [i.id]: 'disconnected' } };
      return { ...s, ops: [{ id: `auth-${i.id}-${s.ops.length}`, itemId: i.id, op: 'connect', state: 'accepted', message: 'Autorização simulada recebida; aguardando confirmação.' }, ...s.ops] };
    }
    case 'advance': {
      const o = s.ops.find(x => x.id === a.id); if (!o) return s;
      if (o.state === 'requested') return { ...s, ops: s.ops.map(x => x.id === o.id ? { ...x, state: 'accepted', message: 'Solicitação aceita. Ainda não concluída.' } : x) };
      if (o.state === 'accepted') return { ...s, ops: s.ops.map(x => x.id === o.id ? { ...x, state: 'running', message: 'Em andamento (simulação)…' } : x) };
      if (o.state === 'running') return finish(s, o);
      return s;
    }
    case 'favorite': return { ...s, favorites: s.favorites.includes(a.itemId) ? s.favorites.filter(f => f !== a.itemId) : [...s.favorites, a.itemId] };
    case 'visit': return { ...s, history: [a.itemId, ...s.history.filter(h => h !== a.itemId)].slice(0, 10) };
    case 'dismiss': return { ...s, ops: s.ops.filter(o => o.id !== a.id) };
  }
}

export const activeOps = (s: StoreState) => s.ops.filter(o => ['requested', 'accepted', 'running'].includes(o.state));
export const updatable = (s: StoreState) => Object.entries(s.status).filter(([, v]) => v === 'update-available').map(([k]) => k);
