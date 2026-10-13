import { useState, type ReactNode } from 'react';
import { Clock3, Users, Flame, ShoppingCart, Heart, ChevronLeft, ChevronRight, X, Maximize2, ZoomIn, ZoomOut, FileText, AlertTriangle, CheckCircle2, FileCode2, Lightbulb, ArrowUpRight, Check, Circle, Loader2, ShieldAlert, Unplug, LayoutGrid, Rows3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { recipeIngredients, scaleQty, type MissionState, type ResultEntry } from '@/lib/intelligence/demo';
import recipeImg from '@/assets/demo-recipe.jpg';
import sal1 from '@/assets/demo-salvador-1.jpg';
import sal2 from '@/assets/demo-salvador-2.jpg';
import sal3 from '@/assets/demo-salvador-3.jpg';
import landscape from '@/assets/ordax-landscape.jpg';

function Tabs({ items, value, onChange, label }: { items: string[]; value: string; onChange: (v: string) => void; label: string }) {
  return <div className="oi-tabs" role="tablist" aria-label={label}>{items.map(i => <button type="button" role="tab" aria-selected={value === i} key={i} onClick={() => onChange(i)}>{i}</button>)}</div>;
}
function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`oi-card ${className}`}>{children}</section>; }
export function DemoTag() { return <span className="oi-demo-tag">Demonstração · dados fictícios</span>; }

function Recipe({ entry, onPrompt }: { entry: ResultEntry; onPrompt: (p: string) => void }) {
  const [tab, setTab] = useState('Ingredientes');
  const [saved, setSaved] = useState(false);
  const r = entry.recipe ?? { servings: 6, shopping: false };
  const [checked, setChecked] = useState<string[]>([]);
  return <div className="oi-recipe">
    <img className="oi-recipe-photo" src={recipeImg} alt="Fatias de bolo salgado de atum" width={1024} height={768}/>
    <div className="oi-recipe-body">
      <h2>Bolo salgado de atum</h2>
      <div className="oi-chips"><span><Clock3/>45 minutos</span><span aria-live="polite"><Users/>{r.servings} porções</span><span><Flame/>Fácil</span></div>
      <p className="oi-lead">Uma receita prática e saborosa, perfeita para refeições rápidas.</p>
      <Card><Tabs label="Seções da receita" items={['Ingredientes', 'Modo de preparo', 'Dicas', 'Variações']} value={tab} onChange={setTab}/>
        {tab === 'Ingredientes' && <ul className="oi-ingredients">{recipeIngredients.map(i => <li key={i.unit}>{scaleQty(i.qty, r.servings)} {i.unit}</li>)}<li>Sal e temperos a gosto</li></ul>}
        {tab === 'Modo de preparo' && <ol className="oi-steps">{['Preaqueça o forno a 180 °C e unte uma forma.', 'Bata no liquidificador ovos, leite e óleo.', 'Misture a farinha e, por último, o fermento.', 'Incorpore atum, tomate e cebola.', 'Asse por cerca de 35 minutos até dourar.'].map(s => <li key={s}>{s}</li>)}</ol>}
        {tab === 'Dicas' && <p className="oi-text">Escorra bem o atum e deixe o bolo descansar 10 minutos antes de cortar.</p>}
        {tab === 'Variações' && <p className="oi-text">Troque o atum por frango desfiado ou adicione milho e azeitonas.</p>}
      </Card>
      {r.shopping && <Card className="oi-shopping"><h3><ShoppingCart/>Lista de compras · {r.servings} porções</h3><ul>{recipeIngredients.map(i => <li key={i.shop}><label><input type="checkbox" checked={checked.includes(i.shop)} onChange={() => setChecked(c => c.includes(i.shop) ? c.filter(x => x !== i.shop) : [...c, i.shop])}/>{i.shop}</label></li>)}</ul></Card>}
      <div className="oi-actions">
        {!r.shopping && <Button variant="outline" onClick={() => onPrompt('Faça minha lista de compras')}>Lista de compras</Button>}
        {r.servings !== 4 && <Button variant="outline" onClick={() => onPrompt('Adapte para quatro pessoas')}>Versão para 4 pessoas</Button>}
        <Button onClick={() => setSaved(v => !v)} aria-pressed={saved}><Heart/>{saved ? 'Marcada nesta sessão' : 'Salvar receita'}</Button>
      </div>
      {saved && <p className="oi-note"><Unplug/>Armazenamento não conectado — marcação apenas nesta sessão.</p>}
    </div>
  </div>;
}

const photos = [
  { src: sal1, alt: 'Elevador Lacerda ao pôr do sol', w: 1280, h: 768 }, { src: sal2, alt: 'Pelourinho com casarões coloridos', w: 1024, h: 768 },
  { src: sal3, alt: 'Farol da Barra ao entardecer', w: 1024, h: 768 }, { src: landscape, alt: 'Paisagem ilustrativa OrdaX', w: 1920, h: 640 },
];
function Gallery() {
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<'destaque' | 'grade'>('destaque');
  const [zoom, setZoom] = useState<number | null>(null);
  const go = (d: number) => setI(v => (v + d + photos.length) % photos.length);
  return <div className="oi-gallery">
    <div className="oi-row-head"><h2>Imagens de Salvador</h2><div className="oi-seg"><Button size="icon" variant="ghost" aria-label="Modo destaque" aria-pressed={mode === 'destaque'} onClick={() => setMode('destaque')}><Rows3/></Button><Button size="icon" variant="ghost" aria-label="Modo grade" aria-pressed={mode === 'grade'} onClick={() => setMode('grade')}><LayoutGrid/></Button></div></div>
    {mode === 'destaque' ? <>
      <div className="oi-hero-photo"><img src={photos[i]!.src} alt={photos[i]!.alt} width={photos[i]!.w} height={photos[i]!.h}/><Button size="icon" variant="secondary" className="oi-nav-l" aria-label="Imagem anterior" onClick={() => go(-1)}><ChevronLeft/></Button><Button size="icon" variant="secondary" className="oi-nav-r" aria-label="Próxima imagem" onClick={() => go(1)}><ChevronRight/></Button><Button size="icon" variant="secondary" className="oi-zoom" aria-label="Ampliar imagem" onClick={() => setZoom(i)}><Maximize2/></Button><span className="oi-caption">{photos[i]!.alt}</span></div>
      <div className="oi-thumbs">{photos.map((p, k) => <button type="button" key={p.alt} aria-label={`Ver ${p.alt}`} aria-current={k === i} onClick={() => setI(k)}><img src={p.src} alt="" loading="lazy" width={p.w} height={p.h}/></button>)}</div>
    </> : <div className="oi-grid">{photos.map((p, k) => <button type="button" key={p.alt} onClick={() => setZoom(k)} aria-label={`Ampliar ${p.alt}`}><img src={p.src} alt="" loading="lazy" width={p.w} height={p.h}/></button>)}</div>}
    <p className="oi-note"><Unplug/>Imagens ilustrativas da demonstração; busca na Web não conectada.</p>
    {zoom !== null && <div className="oi-lightbox" role="dialog" aria-modal="true" aria-label={photos[zoom]!.alt} onClick={() => setZoom(null)} onKeyDown={e => e.key === 'Escape' && setZoom(null)}><img src={photos[zoom]!.src} alt={photos[zoom]!.alt}/><Button autoFocus size="icon" variant="secondary" aria-label="Fechar imagem ampliada" onClick={() => setZoom(null)}><X/></Button></div>}
  </div>;
}

const days = [5, 8, 6, 9, 7, 11, 10, 6, 12, 9, 8, 13, 11, 10, 14, 9, 12, 15, 11, 13, 10, 16, 12, 14, 11, 17, 13, 15, 12, 18];
function Report() {
  const [hover, setHover] = useState<number | null>(14);
  const [view, setView] = useState('Gráfico');
  const max = Math.max(...days);
  return <div className="oi-report">
    <div className="oi-kpis"><Card><strong>R$ 12.480</strong><span>Receita total</span><em>+12%</em></Card><Card><strong>320</strong><span>Pedidos</span><em>+8%</em></Card><Card><strong>R$ 39</strong><span>Ticket médio</span><em>+4%</em></Card></div>
    <Card><div className="oi-row-head"><h3>Vendas diárias</h3><Tabs label="Visualização" items={['Gráfico', 'Tabela']} value={view} onChange={setView}/></div>
      {view === 'Gráfico' ? <div className="oi-bars" role="img" aria-label="Gráfico de vendas diárias fictícias">{days.map((d, k) => <button type="button" key={k} style={{ height: `${(d / max) * 100}%` }} className={hover === k ? 'on' : ''} onMouseEnter={() => setHover(k)} onFocus={() => setHover(k)} aria-label={`Dia ${k + 1}: R$ ${d * 80}`}/>)}{hover !== null && <span className="oi-tip" style={{ left: `${(hover / days.length) * 100}%` }}>R$ {days[hover]! * 80}<small>dia {hover + 1}</small></span>}</div>
        : <table className="oi-table"><thead><tr><th>Dia</th><th>Pedidos</th><th>Receita</th></tr></thead><tbody>{days.slice(-7).map((d, k) => <tr key={k}><td>{24 + k}</td><td>{d}</td><td>R$ {d * 80}</td></tr>)}</tbody></table>}
    </Card>
    <Card><h3>Principais produtos</h3>{[['Miniaturas', 38], ['Dioramas', 27], ['Impressões', 18], ['Outros', 17]].map(([n, v]) => <div className="oi-meter" key={n}><span>{n}</span><i><b style={{ width: `${v}%` }}/></i><small>{v}%</small></div>)}</Card>
  </div>;
}

function DocumentView() {
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [more, setMore] = useState(false);
  return <div className="oi-doc">
    <div className="oi-doc-viewer">
      <div className="oi-doc-pages">{[1, 2, 3].map(p => <button type="button" key={p} aria-current={page === p} aria-label={`Página ${p}`} onClick={() => setPage(p)}><span>{p}</span></button>)}</div>
      <div className="oi-doc-canvas"><div className="oi-doc-tools"><Button size="icon" variant="ghost" aria-label="Diminuir zoom" onClick={() => setZoom(z => Math.max(50, z - 25))}><ZoomOut/></Button><span>{zoom}%</span><Button size="icon" variant="ghost" aria-label="Aumentar zoom" onClick={() => setZoom(z => Math.min(200, z + 25))}><ZoomIn/></Button></div>
        <div className="oi-doc-sheet" style={{ transform: `scale(${zoom / 100})` }}>{page === 1 ? <><img src={landscape} alt="" width={1920} height={640}/><h4>Relatório Financeiro 2024</h4><p>OrdaX · documento fictício</p></> : <><h4>Página {page}</h4>{[1, 2, 3, 4, 5, 6].map(l => <i key={l}/>)}</>}</div>
      </div>
    </div>
    <div className="oi-doc-side"><Card><h3><FileText/>Resumo do documento</h3><p className="oi-text">Este relatório apresenta crescimento de 18% na receita em relação ao ano anterior, com destaque para o segmento de produtos digitais.</p>{more && <ul className="oi-list"><li>Página 2: margem operacional estável em 22%.</li><li>Página 3: expansão internacional prevista para o 2º semestre.</li></ul>}<Button variant="outline" size="sm" onClick={() => setMore(v => !v)}>{more ? 'Ocultar detalhes' : 'Ver análise completa'}</Button></Card>
      <p className="oi-note"><Unplug/>Documento de exemplo. Leitura de arquivos reais não conectada.</p></div>
  </div>;
}

function Project({ onOpen }: { onOpen?: (() => void) | undefined }) {
  const [tab, setTab] = useState('Resumo');
  const items: Record<string, { icon: typeof FileCode2; title: string; sub: string; tone?: string }[]> = {
    Resumo: [{ icon: FileCode2, title: '12 arquivos modificados', sub: 'nas últimas 24 horas' }, { icon: AlertTriangle, title: '3 avisos de performance', sub: 'a serem verificados', tone: 'warn' }, { icon: CheckCircle2, title: 'Mapas e colisões ok', sub: 'última auditoria passou (46/46)', tone: 'ok' }, { icon: Lightbulb, title: 'Próximos passos', sub: 'otimizar LOD e ajustar iluminação' }],
    Alterações: [{ icon: FileCode2, title: 'scenes/harbor.umap', sub: '+142 −38' }, { icon: FileCode2, title: 'materials/water.uasset', sub: 'shader atualizado' }],
    Problemas: [{ icon: AlertTriangle, title: 'Draw calls elevados no porto', sub: '2.400 por quadro', tone: 'warn' }, { icon: AlertTriangle, title: 'Textura 8K sem mipmaps', sub: 'buildings_atlas', tone: 'warn' }],
    Sugestões: [{ icon: Lightbulb, title: 'Agrupar instâncias de barcos', sub: 'reduz draw calls' }, { icon: Lightbulb, title: 'Gerar mipmaps', sub: 'economia de memória' }],
  };
  return <div className="oi-project">
    <div className="oi-project-cover"><img src={sal1} alt="Prévia do projeto Bay of All Saints" width={1280} height={768}/><div><strong>Bay of All Saints</strong><span>Unreal Engine 5 · projeto fictício</span></div></div>
    <Card><Tabs label="Análise do projeto" items={Object.keys(items)} value={tab} onChange={setTab}/><ul className="oi-findings">{items[tab]!.map(it => <li key={it.title} className={it.tone}><it.icon/><div><strong>{it.title}</strong><span>{it.sub}</span></div></li>)}</ul></Card>
    <div className="oi-actions">{onOpen && <Button onClick={onOpen}>Abrir interface do Studio<ArrowUpRight/></Button>}</div>
    <p className="oi-note"><Unplug/>Registro de projetos e Runtime não conectados — análise ilustrativa.</p>
  </div>;
}

const missionSteps = [{ t: 'Analisando arquivos', s: '1.248 arquivos de exemplo' }, { t: 'Classificando por tipo', s: 'Documentos, imagens, modelos, vídeos' }, { t: 'Preparando organização', s: 'Prévia das pastas' }, { t: 'Executando organização', s: 'Movimentação simulada' }, { t: 'Concluindo e gerando relatório', s: 'Recibo de demonstração' }];
function Mission({ mission, onMission }: { mission: MissionState; onMission: (a: 'approve' | 'advance' | 'cancel') => void }) {
  const pct = mission.phase === 'completed' ? 100 : Math.round(((mission.step - 1) / missionSteps.length) * 100);
  return <div className="oi-mission">
    <Card><div className="oi-row-head"><div><h3>Organizando documentos</h3><span className="oi-sub">{mission.phase === 'completed' ? 'Concluída (demonstração)' : mission.phase === 'cancelled' ? 'Cancelada' : `${Math.min(mission.step, 5)} de 5 etapas`}</span></div><strong className="oi-pct">{pct}%</strong></div>
      <div className="oi-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da missão"><b style={{ width: `${pct}%` }}/></div>
      <ol className="oi-mission-steps">{missionSteps.map((st, k) => { const n = k + 1; const done = mission.phase === 'completed' || n < mission.step; const current = n === mission.step && mission.phase !== 'completed'; return <li key={st.t} className={done ? 'done' : current ? 'current' : ''}>{done ? <Check/> : current ? (mission.phase === 'running' ? <Loader2 className="oi-spin"/> : <ShieldAlert/>) : <Circle/>}<div><strong>{st.t}</strong><span>{current && mission.phase === 'awaiting-approval' ? 'Aguardando sua autorização' : st.s}</span></div></li>; })}</ol>
    </Card>
    <Card><h3>O que será feito</h3><div className="oi-kpis small">{[['432', 'Documentos'], ['621', 'Imagens'], ['128', 'Modelos 3D'], ['67', 'Vídeos']].map(([v, l]) => <div key={l}><strong>{v}</strong><span>{l}</span></div>)}</div></Card>
    {mission.phase === 'awaiting-approval' && <div className="oi-approval" role="alert"><ShieldAlert/><div><strong>Autorização necessária</strong><p>Esta é uma simulação. Nenhum arquivo real será movido.</p></div></div>}
    <div className="oi-actions">
      {mission.phase === 'awaiting-approval' && <><Button variant="outline" onClick={() => onMission('cancel')}>Cancelar</Button><Button onClick={() => onMission('approve')}>Aprovar simulação<ArrowUpRight/></Button></>}
      {mission.phase === 'running' && <Button variant="outline" onClick={() => onMission('cancel')}>Interromper</Button>}
    </div>
    {mission.phase === 'completed' && <p className="oi-note ok"><CheckCircle2/>Recibo de demonstração · nenhuma operação real foi executada.</p>}
    {mission.phase === 'cancelled' && <p className="oi-note"><X/>Missão cancelada. Nada foi alterado.</p>}
  </div>;
}

function Unknown({ entry, onPrompt }: { entry: ResultEntry; onPrompt: (p: string) => void }) {
  const ai = entry.ai;
  if (ai?.state === 'loading') return <div className="oi-unknown" aria-live="polite"><Loader2 className="animate-spin"/><h2>Gerando resposta…</h2><p>Consultando o modelo de IA para “{entry.prompt}”.</p></div>;
  if (ai?.state === 'ready') return <Card className="oi-ai">
    <span className="oi-sim-tag">Gerado por IA · prévia provisória</span>
    <div className="oi-ai-answer">{ai.answer.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>
    {ai.steps.length > 0 && <><h3><Lightbulb/>Próximos passos</h3><ol className="oi-ai-steps">{ai.steps.map(s => <li key={s}><button type="button" onClick={() => onPrompt(s)}>{s}<ArrowUpRight/></button></li>)}</ol></>}
    <p className="oi-note"><ShieldAlert/>A IA pode errar e não executou nenhuma ação no OrdaX.</p>
  </Card>;
  return <div className="oi-unknown"><Unplug/><h2>Não foi possível responder</h2><p>{ai?.error ?? 'Nenhuma resposta foi gerada.'}</p><Button variant="outline" onClick={() => onPrompt(entry.prompt)}>Tentar novamente</Button></div>;
}

export function ResultRenderer({ entry, onPrompt, onMission, onOpenStudio }: { entry: ResultEntry; onPrompt: (p: string) => void; onMission: (a: 'approve' | 'advance' | 'cancel') => void; onOpenStudio?: (() => void) | undefined }) {
  switch (entry.kind) {
    case 'recipe': return <Recipe entry={entry} onPrompt={onPrompt}/>;
    case 'gallery': return <Gallery/>;
    case 'report': return <Report/>;
    case 'document': return <DocumentView/>;
    case 'project': return <Project onOpen={onOpenStudio}/>;
    case 'mission': return entry.mission ? <Mission mission={entry.mission} onMission={onMission}/> : null;
    default: return <Unknown entry={entry} onPrompt={onPrompt}/>;
  }
}
