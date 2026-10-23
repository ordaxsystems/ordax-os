import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { unavailableServices } from '../central/config';
import { useIntelligenceClient } from './client-context';
import { getSurfaceWindowTitle } from '../../../../services/surface/destination-catalog.mjs';

type Props = { initialPrompt?: { text: string } | undefined };
type ResultState =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'ready'; text: string; engineId: string; modelId: string }
  | { state: 'unavailable' }
  | { state: 'error' };

/** Aura is a client of `ordax.intelligence/1`; it never discovers or executes providers itself. */
export function AuraContent({ initialPrompt }: Props) {
  const { client, snapshot } = useIntelligenceClient();
  const productName = getSurfaceWindowTitle('intelligence');
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<ResultState>({ state: 'idle' });
  const activeRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const consumedInitialPrompt = useRef<Props['initialPrompt']>(undefined);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const run = useCallback(async (raw: string) => {
    const normalized = raw.trim();
    if (!normalized) return;
    if (snapshot.state !== 'ready') {
      setResult({ state: 'unavailable' });
      return;
    }
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const generation = ++requestGeneration.current;
    setResult({ state: 'pending' });
    try {
      const response = await client.ask(normalized, { signal: controller.signal });
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      setResult({ state: 'ready', text: response.text, engineId: response.engineId, modelId: response.modelId });
    } catch {
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      setResult(snapshot.state === 'ready' ? { state: 'error' } : { state: 'unavailable' });
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [client, snapshot.state]);

  useEffect(() => {
    if (initialPrompt === undefined || consumedInitialPrompt.current === initialPrompt) return;
    consumedInitialPrompt.current = initialPrompt;
    setPrompt(initialPrompt.text);
    void run(initialPrompt.text);
  }, [initialPrompt, run]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(prompt);
  }

  const pending = result.state === 'pending';
  return <>
    <div className="desktop-content-heading"><Sparkles/><h2>{productName}</h2></div>
    <form className="aura-search" onSubmit={submit}>
      <Sparkles className="aura-star"/>
      <input aria-label="Pergunta para a inteligência" placeholder="Faça uma pergunta ou descreva uma tarefa..." value={prompt} onChange={event => setPrompt(event.target.value)} disabled={pending}/>
      <Button type="submit" className="send-button" aria-label="Enviar pergunta" disabled={pending || !prompt.trim()}><Send/></Button>
    </form>
    {snapshot.state === 'ready' && <p className="service-state" role="status">Modelo disponível: {snapshot.modelId}</p>}
    {pending && <p className="service-state" role="status">Processando sua solicitação.</p>}
    {result.state === 'ready' && <article aria-label="Resposta da inteligência"><p>{result.text}</p><p className="service-state">{result.engineId} · {result.modelId}</p></article>}
    {result.state === 'unavailable' && <p className="desktop-unconnected" role="status">{unavailableServices.intelligence}</p>}
    {result.state === 'error' && <p className="desktop-unconnected" role="alert">Não foi possível concluir a solicitação. Tente novamente.</p>}
  </>;
}
