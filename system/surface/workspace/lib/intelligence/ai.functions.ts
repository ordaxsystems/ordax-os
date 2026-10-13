import type { ResultEntry } from './demo';

// Preserve the UI response contract; this presentation never invokes a provider.
type PreviewResponse =
  | { ok: true; reply: Pick<NonNullable<ResultEntry['ai']>, 'answer' | 'steps'> }
  | { ok: false; status: number; message: string };

export async function askIntelligence(_: unknown): Promise<PreviewResponse> {
  return { ok: false, status: 503, message: 'Intelligence ainda não conectado.' };
}
