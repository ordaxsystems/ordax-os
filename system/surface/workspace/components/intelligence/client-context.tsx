import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createUnavailableWebIntelligencePort } from '../../../../adapters/web/intelligence.mjs';
import { createIntelligenceClient } from '../../lib/intelligence/client.mjs';

const fallbackClient = createIntelligenceClient(createUnavailableWebIntelligencePort());
type IntelligenceClient = typeof fallbackClient;
type IntelligenceSnapshot = ReturnType<IntelligenceClient['getSnapshot']>;
type IntelligenceContextValue = { client: IntelligenceClient; snapshot: IntelligenceSnapshot };

const IntelligenceClientContext = createContext<IntelligenceContextValue>({
  client: fallbackClient,
  snapshot: fallbackClient.getSnapshot(),
});

/** Presentation-only injection point for the canonical Intelligence port. */
export function IntelligenceClientProvider({ port, children }: { port: unknown; children: ReactNode }) {
  const client = useMemo(() => createIntelligenceClient(port), [port]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const value = useMemo(() => ({ client, snapshot }), [client, snapshot]);
  return <IntelligenceClientContext.Provider value={value}>{children}</IntelligenceClientContext.Provider>;
}

export function useIntelligenceClient() { return useContext(IntelligenceClientContext); }
