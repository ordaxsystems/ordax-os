import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createIntelligenceClient } from '../../lib/intelligence/client.mjs';
import { createAuraConversationStore } from '../../lib/intelligence/conversation.mjs';

type IntelligenceClient = ReturnType<typeof createIntelligenceClient>;
type IntelligenceSnapshot = ReturnType<IntelligenceClient['getSnapshot']>;
type IntelligenceContextValue = { client: IntelligenceClient; snapshot: IntelligenceSnapshot; conversation: ReturnType<typeof createAuraConversationStore> };

const IntelligenceClientContext = createContext<IntelligenceContextValue | null>(null);

/** Presentation-only injection point for the canonical Intelligence port. */
export function IntelligenceClientProvider({ port, children }: { port: unknown; children: ReactNode }) {
  const client = useMemo(() => createIntelligenceClient(port), [port]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const conversation = useMemo(() => createAuraConversationStore(), [client]);
  const value = useMemo(() => ({ client, snapshot, conversation }), [client, snapshot, conversation]);
  return <IntelligenceClientContext.Provider value={value}>{children}</IntelligenceClientContext.Provider>;
}

export function useIntelligenceClient() {
  const value = useContext(IntelligenceClientContext);
  if (value === null) throw new Error('Intelligence client provider is required');
  return value;
}
