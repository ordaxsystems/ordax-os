import { useEffect, useRef } from 'react';
import { Plus, Mic, ArrowUp, History, Settings2, X, RotateCcw, Paperclip, Maximize2, Copy, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { entryToText, exportEntryPdf } from '@/lib/intelligence/export';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { demoCommands, stages } from '@/lib/intelligence/demo';
import { activeEntry } from '@/lib/intelligence/session';
import { ResultRenderer, DemoTag } from './results';
import { useIntelligenceSession } from './session';
import mark from '@ordax-brand/ordax-symbol.png';

export type Presentation = 'page' | 'panel' | 'compact';

/**
 * One Intelligence experience, rendered responsively per presentation.
 * page = expanded central area · panel = contextual side panel · compact = embedded card (Home, Studio).
 * State lives in IntelligenceSessionProvider, so all presentations show the same session.
 */
export function IntelligenceSurface({ presentation = 'page', onOpenStudio, onExpand }: { presentation?: Presentation; onOpenStudio?: (() => void) | undefined; onExpand?: (() => void) | undefined }) {
  const { state, dispatch, submit } = useIntelligenceSession();
  const input = useRef<HTMLTextAreaElement>(null);
  const active = activeEntry(state);
  const exportable = !!active && (active.kind !== 'unknown' || active.ai?.state === 'ready');
  const busy = state.stage !== null;
  const mode = busy ? 'processing' : active ? 'result' : 'rest';
  const compact = presentation === 'compact';
  const wasBusy = useRef(busy);
  useEffect(() => { if (wasBusy.current && !busy && presentation !== 'compact') input.current?.focus({ preventScroll: true }); wasBusy.current = busy; }, [busy, presentation]);

  const composer = <form className="oi-composer" onSubmit={e => { e.preventDefault(); submit(state.draft); }}>
    <Button type="button" variant="ghost" size="icon" disabled aria-label="Anexar arquivo — não conectado" title="Anexos não conectados"><Plus/></Button>
    <textarea ref={input} rows={1} aria-label="Comando para OrdaX Intelligence" placeholder={active ? 'Continue a partir deste resultado…' : 'Pergunte, peça ou descreva um objetivo…'} value={state.draft} onChange={e => dispatch({ type: 'draft', value: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(state.draft); } }}/>
    <Button type="button" variant="ghost" size="icon" disabled aria-label="Voz — não conectada" title="Entrada por voz não conectada"><Mic/></Button>
    <Button type="submit" size="icon" className="oi-send" disabled={!state.draft.trim() || busy} aria-label="Enviar comando de demonstração"><ArrowUp/></Button>
  </form>;

  const historyMenu = <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Histórico desta sessão" title="Histórico"><History/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="oi-history"><DropdownMenuLabel>Resultados desta sessão</DropdownMenuLabel>{state.entries.length === 0 ? <DropdownMenuItem disabled>Nenhum resultado ainda</DropdownMenuItem> : state.entries.map(e => <DropdownMenuItem key={e.id} onSelect={() => dispatch({ type: 'select', id: e.id })}>{e.title}{e.id === state.activeId ? ' · atual' : ''}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
  const expand = onExpand && <Button variant="ghost" size="icon" aria-label="Abrir Intelligence expandido" title="Expandir" onClick={onExpand}><Maximize2/></Button>;

  const processing = <div className="oi-processing" aria-live="polite">
    <span className="oi-sim-tag">Simulação</span>
    <h2>Entendendo sua solicitação…</h2><p className="oi-pending">“{state.pending}”</p>
    <ol className="oi-stages">{stages.map((s, k) => { const idx = stages.findIndex(x => x.id === state.stage); return <li key={s.id} className={k < idx ? 'done' : k === idx ? 'current' : ''}><span/>{s.label}</li>; })}</ol>
    {!compact && <small>Demonstração local · nenhum provedor de IA, arquivo ou GPT envolvido</small>}
  </div>;

  if (compact) return <div className={`oi-surface oi-compact oi-${mode}`} aria-label="OrdaX Intelligence">
    <header className="oi-compact-head"><img src={mark} alt="" width={36} height={36}/><div><span>OrdaX Intelligence</span><strong>{active ? active.title : 'O que você gostaria de realizar?'}</strong></div>{expand}</header>
    {busy ? processing : active ? <p className="oi-compact-note">Resultado de demonstração pronto. <button type="button" onClick={onExpand}>Ver resultado</button></p> : null}
    {composer}
    <p className="oi-foot"><Paperclip/>Simulação · IA não conectada</p>
  </div>;

  return <div className={`oi-surface oi-${presentation} oi-${mode}`}>
    <div className="oi-atmosphere" aria-hidden="true"/>
    {mode !== 'result' ? <div className="oi-center">
      {presentation === 'panel' && <div className="oi-panel-tools">{historyMenu}{expand}</div>}
      <div className={`oi-orb ${busy ? 'oi-orb-busy' : ''}`}><span className="oi-ring"/><span className="oi-ring r2"/><img src={mark} alt="" width={120} height={120}/></div>
      {busy ? processing : <div className="oi-rest">
        <h1>OrdaX <span>Intelligence</span></h1><p className="oi-question">O que você gostaria de realizar?</p>
        {composer}
        {presentation === 'page' && <div className="oi-rest-tools">{historyMenu}<Button variant="ghost" size="icon" disabled aria-label="Configurações — não conectadas" title="Configurações não conectadas"><Settings2/></Button></div>}
        <details className="oi-demo-commands"><summary>Comandos de demonstração</summary><div>{demoCommands.map(c => <button type="button" key={c.label} onClick={() => submit(c.prompt)}>{c.label}</button>)}</div></details>
      </div>}
    </div> : active && <div className="oi-result">
      <header className="oi-result-bar"><img src={mark} alt="" width={28} height={28}/><p title={active.prompt}>{active.prompt}</p>{active.kind !== 'unknown' && <DemoTag/>}{exportable && <><Button variant="ghost" size="icon" aria-label="Copiar resultado" title="Copiar" onClick={() => { void navigator.clipboard.writeText(entryToText(active)).then(() => toast.success('Resultado copiado'), () => toast.error('Não foi possível copiar')); }}><Copy/></Button><Button variant="ghost" size="icon" aria-label="Exportar PDF" title="Exportar PDF" onClick={() => { void exportEntryPdf(active).catch(() => toast.error('Falha ao gerar PDF')); }}><FileDown/></Button></>}{historyMenu}{expand}<Button variant="ghost" size="icon" aria-label="Nova missão" title="Nova missão" onClick={() => dispatch({ type: 'reset' })}><RotateCcw/></Button><Button variant="ghost" size="icon" aria-label="Voltar ao início" title="Fechar resultado" onClick={() => dispatch({ type: 'reset' })}><X/></Button></header>
      <div className="oi-result-body" key={active.id}><ResultRenderer entry={active} onPrompt={submit} onOpenStudio={onOpenStudio} onMission={a => dispatch({ type: 'mission', id: active.id, action: a })}/></div>
      <div className="oi-result-composer">{active.followUps.length > 0 && <div className="oi-followups">{active.followUps.map(f => <button type="button" key={f} onClick={() => submit(f)}>{f}</button>)}</div>}{composer}<p className="oi-foot"><Paperclip/>Simulação: só os seis cenários usam dados fictícios; outros pedidos indicam IA não conectada.</p></div>
    </div>}
  </div>;
}
