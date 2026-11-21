import { createResult, missionReducer, refine, stages, type ResultEntry, type Stage } from './demo';

/** Single session owner shared by every Intelligence presentation (page, panel, compact). Session-only, demo fixtures. */
export type SessionState = { entries: ResultEntry[]; activeId: string | null; stage: Stage | null; pending: string; draft: string };
export type SessionAction =
  | { type: 'draft'; value: string }
  | { type: 'begin'; prompt: string }
  | { type: 'stage'; stage: Stage }
  | { type: 'complete'; prompt: string; id: string }
  | { type: 'select'; id: string }
  | { type: 'reset' }
  | { type: 'mission'; id: string; action: 'approve' | 'advance' | 'cancel' }
  | { type: 'ai'; id: string; ai: NonNullable<ResultEntry['ai']> };
export const initialSession: SessionState = { entries: [], activeId: null, stage: null, pending: '', draft: '' };
export const activeEntry = (s: SessionState) => s.entries.find(e => e.id === s.activeId) ?? null;

/** Stages the demo shows for a prompt: short flow when it refines the current result. */
export function flowFor(s: SessionState, prompt: string): Stage[] {
  const a = activeEntry(s);
  return a && refine(a, prompt) ? ['interpreting', 'preparing'] : stages.map(x => x.id);
}

export function sessionReducer(s: SessionState, a: SessionAction): SessionState {
  switch (a.type) {
    case 'draft': return { ...s, draft: a.value };
    case 'begin': return s.stage ? s : { ...s, draft: '', pending: a.prompt, stage: 'interpreting' };
    case 'stage': return s.stage ? { ...s, stage: a.stage } : s;
    case 'complete': {
      const current = activeEntry(s);
      const refined = current ? refine(current, a.prompt) : null;
      if (refined) return { ...s, stage: null, pending: '', entries: s.entries.map(e => e.id === refined.id ? refined : e) };
      const entry = createResult(a.prompt, a.id);
      return { ...s, stage: null, pending: '', entries: [entry, ...s.entries.filter(e => e.id !== a.id)].slice(0, 12), activeId: entry.id };
    }
    case 'select': return s.entries.some(e => e.id === a.id) ? { ...s, activeId: a.id } : s;
    case 'reset': return { ...s, activeId: null, draft: '' };
    case 'mission': return { ...s, entries: s.entries.map(e => e.id === a.id && e.mission ? { ...e, mission: missionReducer(e.mission, a.action) } : e) };
    case 'ai': return { ...s, entries: s.entries.map(e => e.id === a.id && e.ai ? { ...e, ai: a.ai } : e) };
  }
}
