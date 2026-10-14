import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createIntelligenceClient } from '../../lib/intelligence/client.mjs';

type IntelligenceClient = ReturnType<typeof createIntelligenceClient>;
type IntelligenceSnapshot = ReturnType<IntelligenceClient['getSnapshot']>;
type IntelligenceContextValue = { client: IntelligenceClient; snapshot: IntelligenceSnapshot };

const IntelligenceClientContext = createContext<IntelligenceContextValue | null>(null);

/** Presentation-only injection point for the canonical Intelligence port. */
export function IntelligenceClientProvider({ port, children }: { port: unknown; children: ReactNode }) {
  const client = useMemo(() => createIntelligenceClient(port), [port]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const value = useMemo(() => ({ client, snapshot }), [client, snapshot]);
  return <IntelligenceClientContext.Provider value={value}>{children}</IntelligenceClientContext.Provider>;
}

export function useIntelligenceClient() {
  const value = useContext(IntelligenceClientContext);
  if (value === null) throw new Error('Intelligence client provider is required');
  return value;
}
