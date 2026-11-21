import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { activeEntry, flowFor, initialSession, sessionReducer, type SessionAction, type SessionState } from '@/lib/intelligence/session';
import { classify, type ResultEntry } from '@/lib/intelligence/demo';
import { askIntelligence } from '@/lib/intelligence/ai.functions';

type Ctx = { state: SessionState; dispatch: (a: SessionAction) => void; submit: (prompt: string) => void };
const SessionContext = createContext<Ctx | null>(null);
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Owns the one Intelligence session; every presentation reads it, so results survive switching between them. */
export function IntelligenceSessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSession);
  const ref = useRef(state); ref.current = state;
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);

  const submit = useCallback((raw: string) => {
    const prompt = raw.trim(); const s = ref.current;
    if (!prompt || s.stage) return;
    const flow = flowFor(s, prompt);
    const step = reduced() ? 80 : flow.length === 2 ? 300 : 520;
    const current = activeEntry(s);
    const live = flow.length !== 2 && classify(prompt) === 'unknown';
    dispatch({ type: 'begin', prompt });
    flow.slice(1).forEach((st, k) => timers.current.push(window.setTimeout(() => dispatch({ type: 'stage', stage: st }), (k + 1) * step)));
    const id = `r${Date.now()}`;
    const shown = new Promise<void>(res => timers.current.push(window.setTimeout(() => { dispatch({ type: 'complete', prompt, id }); res(); }, flow.length * step)));
    if (live) {
      const apply = (ai: NonNullable<ResultEntry['ai']>) => void shown.then(() => dispatch({ type: 'ai', id, ai }));
      askIntelligence({ data: { prompt: prompt.slice(0, 2000), ...(current ? { context: current.title.slice(0, 300) } : {}) } })
        .then(r => apply(r.ok ? { state: 'ready', ...r.reply } : { state: 'error', answer: '', steps: [], error: r.message }))
        .catch(() => apply({ state: 'error', answer: '', steps: [], error: 'Falha de conexão com o servidor.' }));
    }
  }, []);

  const active = activeEntry(state);
  const phase = active?.mission?.phase; const step = active?.mission?.step; const activeId = active?.id;
  useEffect(() => {
    if (!activeId || phase !== 'running') return;
    const t = window.setTimeout(() => dispatch({ type: 'mission', id: activeId, action: 'advance' }), reduced() ? 300 : 1300);
    return () => window.clearTimeout(t);
  }, [activeId, phase, step]);

  const value = useMemo(() => ({ state, dispatch, submit }), [state, submit]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export function useIntelligenceSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('IntelligenceSessionProvider ausente');
  return ctx;
}
