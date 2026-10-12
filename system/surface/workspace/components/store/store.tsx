import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import './styles.css';
import { Search, Compass, LayoutGrid, Brain, Puzzle, Plug, Palette, Library, RefreshCw, Heart, ArrowLeft, ShieldCheck, Cpu, Cloud, Bot, Info, AlertTriangle, CheckCircle2, Loader2, XCircle, Ban, Wifi, HardDrive, Monitor, Globe2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { catalog, kindMeta, platformLabel, evaluateModel, type Kind, type StoreItem, type ModelItem, type Platform } from '@/lib/store/catalog';
import { useStoreCatalog } from './catalog-context';
import { officialEntryStatus, projectOfficialStoreItems, type ProductStatus, type StoreSnapshot, type StoreEntry } from '@/lib/store/official';
import { initialStore, storeReducer, statusOf, activeOps, type OpKind, type Operation, type StoreState } from '@/lib/store/state';
import hero from '@/assets/store-hero.jpg';

type Section = 'discover' | 'apps' | 'ai' | 'plugins' | 'connectors' | 'packages' | 'library' | 'updates';
const sections: { id: Section; label: string; icon: typeof Compass }[] = [
  { id: 'discover', label: 'Descobrir', icon: Compass }, { id: 'apps', label: 'Aplicativos', icon: LayoutGrid },
  { id: 'ai', label: 'Inteligências Artificiais', icon: Brain }, { id: 'plugins', label: 'Plugins e extensões', icon: Puzzle },
  { id: 'connectors', label: 'Conectores', icon: Plug }, { id: 'packages', label: 'Pacotes e temas', icon: Palette },
  { id: 'library', label: 'Minha biblioteca', icon: Library }, { id: 'updates', label: 'Atualizações', icon: RefreshCw },
];
const statusText: Record<ProductStatus, string> = {
  available: 'Disponível', installed: 'Instalado', 'update-available': 'Atualização disponível', informational: 'Informativo',
  disconnected: 'Desconectado', 'authorization-required': 'Autorização necessária', connected: 'Conectado', unavailable: 'Indisponível',
  disabled: 'Desabilitado', enabled: 'Habilitado', installing: 'Instalando', updating: 'Atualizando', removing: 'Removendo',
  staged: 'Preparado, aguardando ativação', blocked: 'Bloqueado', 'failed-retained': 'Falhou · versão anterior mantida',
};

function Mark({ item, size = 'md' }: { item: StoreItem; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`st-mark st-${size} st-tone-${item.tone}`} aria-hidden="true">{item.monogram}</span>;
}
function Pill({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`st-pill ${tone}`}>{children}</span>; }
function SimTag() { return <span className="st-sim">Simulação</span>; }

/** Primary action per kind and state: install, connect and enable are distinct operations. */
function primaryAction(i: StoreItem, st: ProductStatus): { label: string; op: OpKind | null } {
  if (i.kind === 'model') return { label: 'Instalar (não habilitado)', op: 'install' };
  if (i.kind === 'provider' || i.kind === 'connector') return st === 'connected' ? { label: 'Desconectar', op: 'disconnect' } : st === 'authorization-required' ? { label: 'Autorizar…', op: null } : { label: 'Conectar', op: 'connect' };
  if (i.kind === 'agent') return st === 'enabled' ? { label: 'Desabilitar', op: 'disable' } : { label: 'Habilitar', op: 'enable' };
  if (i.kind === 'package') return st === 'installed' ? { label: 'Aplicado', op: null } : { label: 'Aplicar', op: 'apply' };
  if (st === 'update-available') return { label: 'Atualizar', op: 'update' };
  if (st === 'installed') return { label: i.kind === 'app' ? 'Abrir' : 'Instalado', op: null };
  return { label: 'Instalar', op: 'install' };
}

export function StoreExperience({ onOpenApp }: { onOpenApp?: ((id: string) => void) | undefined }) {
  const snapshot = useStoreCatalog();
  const [demo, setDemo] = useState(false);
  // A mode change disposes timers and session state; simulations never become host state.
  return <StoreBody key={demo ? 'demo' : 'official'} snapshot={snapshot} demo={demo} onModeChange={() => setDemo(value => !value)} onOpenApp={onOpenApp}/>;
}

function StoreBody({ snapshot, demo, onModeChange, onOpenApp }: { snapshot: StoreSnapshot; demo: boolean; onModeChange: () => void; onOpenApp?: ((id: string) => void) | undefined }) {
  const [state, dispatch] = useReducer(storeReducer, demo ? initialStore : { status: {}, ops: [], favorites: [], history: [] });
  const items = useMemo(() => demo ? catalog : projectOfficialStoreItems(snapshot), [demo, snapshot]);
  const entries = useMemo(() => new Map<string, StoreEntry>(snapshot.entries.map((entry: StoreEntry) => [entry.appId, entry] as const)), [snapshot]);
  const find = (id: string) => items.find(item => item.id === id);
  const status = (item: StoreItem): ProductStatus => demo ? statusOf(state, item) : item.kind === 'model' ? 'informational' : entries.has(item.id) ? officialEntryStatus(entries.get(item.id)!) : 'unavailable';
  const [section, setSection] = useState<Section>('discover');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const running = activeOps(state);
  const runKey = running.map(o => `${o.id}:${o.state}`).join('|');
  useEffect(() => {
    if (!demo || !running.length) return;
    const t = window.setTimeout(() => running.forEach(o => dispatch({ type: 'advance', id: o.id })), 900);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, runKey]);

  const request = (i: StoreItem, op: OpKind) => { if (demo) dispatch({ type: 'request', itemId: i.id, op, id: `op-${i.id}-${Date.now()}` }); };
  const open = (id: string) => { setSelected(id); dispatch({ type: 'visit', itemId: id }); };
  const go = (s: Section) => { setSection(s); setSelected(null); setQuery(''); };
  const item = selected ? find(selected) : null;
  const ups = items.filter(item => status(item) === 'update-available');
  const term = query.trim().toLocaleLowerCase('pt-BR');
  const results = term ? items.filter(item => (kind === 'all' || item.kind === kind) && [item.name, item.tagline, item.description, ...item.tags].join(' ').toLocaleLowerCase('pt-BR').includes(term)) : null;
  const ctx: Ctx = { state, open, request, dispatch, onOpenApp, demo, items, entries, status, find, catalogState: snapshot.state };

  return <div className="st-root" data-store-mode={demo ? 'demo' : 'official'}>
    <nav className="st-nav" aria-label="Seções da Loja">
      {sections.map(s => <button type="button" key={s.id} aria-current={section === s.id && !item ? 'page' : undefined} onClick={() => go(s.id)}><s.icon/><span>{s.label}</span>{s.id === 'updates' && ups.length > 0 && <b>{ups.length}</b>}</button>)}
    </nav>
    <div className="st-main">
      <div className="st-mode">
        <div role="status"><strong>{demo ? 'Demonstração da Loja' : 'Loja oficial'}</strong><p>{demo ? 'Exemplos e operações simuladas nesta sessão. Nenhuma alteração no dispositivo.' : snapshot.state === 'ready' ? 'Estado recebido do catálogo oficial. Operações no dispositivo ainda indisponíveis nesta versão Web.' : 'O catálogo verificado ainda não está conectado à versão Web. Explore a demonstração para avaliar os recursos previstos.'}</p></div>
        <Button variant="outline" onClick={onModeChange} aria-label={demo ? 'Voltar à Loja oficial' : 'Ver demonstração da Loja'}>{demo ? 'Voltar à Loja oficial' : 'Ver demonstração'}</Button>
      </div>
      <div className="st-searchbar">
        <label><Search/><input aria-label="Pesquisar no catálogo" placeholder="Pesquisar aplicativos, IAs, agentes, plugins, conectores…" value={query} onChange={e => { setQuery(e.target.value); setSelected(null); }}/></label>
        <select aria-label="Filtrar por tipo" value={kind} onChange={e => setKind(e.target.value as Kind | 'all')}><option value="all">Todos</option>{(Object.keys(kindMeta) as Kind[]).map(k => <option key={k} value={k}>{kindMeta[k].plural}</option>)}</select>
        {running.length > 0 && <span className="st-running" aria-live="polite"><Loader2 className="animate-spin"/>{running.length} em andamento</span>}
      </div>
      <div className="st-body">
        {item ? <Detail item={item} ctx={ctx} onBack={() => setSelected(null)}/>
          : results ? <SearchResults items={results} ctx={ctx} query={query}/>
          : section === 'discover' ? <Discover ctx={ctx} go={go}/>
          : section === 'apps' ? <AppsSection ctx={ctx}/>
          : section === 'ai' ? <AiSection ctx={ctx}/>
          : section === 'plugins' ? <Grid title="Plugins e extensões" note="Plugins ampliam apps e o Intelligence; não são aplicativos nem provedores de inferência." items={ofKind(ctx, 'plugin')} ctx={ctx}/>
          : section === 'connectors' ? <Grid title="Conectores" note="Conectores autorizam acesso a serviços externos. Conectores MCP são interfaces de ferramentas, não necessariamente provedores de IA." items={ofKind(ctx, 'connector')} ctx={ctx}/>
          : section === 'packages' ? <Grid title="Pacotes e personalização" note="Cada tipo de pacote é ativado de forma diferente: temas pelas Preferências, idiomas com reinício, templates ao criar projeto." items={ofKind(ctx, 'package')} ctx={ctx}/>
          : section === 'library' ? <LibrarySection ctx={ctx}/>
          : <UpdatesSection ctx={ctx}/>}
      </div>
      <p className="st-foot"><Info/>{demo ? 'Catálogo demonstrativo. Marcas de terceiros são exemplos ilustrativos, sem integração oficial.' : 'Consulta sem autoridade de execução. Instalação, atualização e permissões pertencem aos serviços oficiais do OrdaX OS.'}</p>
    </div>
  </div>;
}

type Ctx = { demo: boolean; items: StoreItem[]; entries: Map<string, StoreEntry>; catalogState: StoreSnapshot['state']; status: (item: StoreItem) => ProductStatus; find: (id: string) => StoreItem | undefined; state: StoreState; open: (id: string) => void; request: (i: StoreItem, op: OpKind) => void; dispatch: React.Dispatch<Parameters<typeof storeReducer>[1]>; onOpenApp?: ((id: string) => void) | undefined };

function ofKind<K extends Kind>(ctx: Ctx, kind: K): Extract<StoreItem, { kind: K }>[] {
  return ctx.items.filter((item): item is Extract<StoreItem, { kind: K }> => item.kind === kind);
}

function ActionButton({ item, ctx, size = 'sm' }: { item: StoreItem; ctx: Ctx; size?: 'sm' | 'default' }) {
  const st = ctx.status(item);
  const busy = activeOps(ctx.state).some(o => o.itemId === item.id);
  const a = primaryAction(item, st);
  if (!ctx.demo) return <Button size={size} variant="outline" disabled title="As operações exigem o serviço autorizado do OrdaX OS">{item.kind === 'model' ? 'Informativo' : 'Operação indisponível'}</Button>;
  if (busy) return <Button size={size} variant="outline" disabled><Loader2 className="animate-spin"/>Em andamento</Button>;
  if (st === 'authorization-required') return <Button size={size} onClick={() => ctx.open(item.id)}>Autorizar…</Button>;
  if (a.label === 'Abrir' && item.kind === 'app') return <Button size={size} onClick={() => ctx.onOpenApp?.(item.id)} disabled={!ctx.onOpenApp}>Abrir</Button>;
  return <Button size={size} variant={a.op === 'disconnect' || a.op === 'disable' || item.kind === 'model' ? 'outline' : 'default'} disabled={!a.op} onClick={() => a.op && ctx.request(item, a.op)}>{a.label}</Button>;
}

function Card({ item, ctx }: { item: StoreItem; ctx: Ctx }) {
  const st = ctx.status(item);
  return <article className="st-card">
    <button type="button" className="st-card-hit" onClick={() => ctx.open(item.id)} aria-label={`Ver detalhes de ${item.name}`}/>
    <div className="st-card-top"><Mark item={item}/><Pill tone={`st-k-${item.kind}`}>{kindMeta[item.kind].label}</Pill></div>
    <h3>{item.name}</h3><p>{item.tagline}</p>
    <div className="st-tags">{item.tags.slice(0, 3).map(t => <span key={t}>{t}</span>)}</div>
    <div className="st-card-foot"><small className={`st-status st-s-${st}`}>{statusText[st]}</small><ActionButton item={item} ctx={ctx}/></div>
  </article>;
}

function Grid({ title, note, items, ctx }: { title: string; note?: string; items: StoreItem[]; ctx: Ctx }) {
  return <section className="st-section"><header className="st-h"><h2>{title}</h2>{note && <p>{note}</p>}</header>
    {items.length ? <div className="st-grid">{items.map(i => <Card key={i.id} item={i} ctx={ctx}/>)}</div> : <Empty text={ctx.demo ? "Nada por aqui ainda." : ctx.catalogState === 'unavailable' ? "Catálogo indisponível nesta versão Web." : "Nenhum item publicado nesta seção do catálogo."}/>}</section>;
}
function Empty({ text }: { text: string }) { return <div className="st-empty"><Ban/><p>{text}</p></div>; }

function SearchResults({ items, ctx, query }: { items: StoreItem[]; ctx: Ctx; query: string }) {
  return <Grid title={`Resultados para “${query}”`} note={`${items.length} ${items.length === 1 ? 'item' : 'itens'} ${ctx.demo ? 'na demonstração' : 'no catálogo oficial'}`} items={items} ctx={ctx}/>;
}

function Discover({ ctx, go }: { ctx: Ctx; go: (s: Section) => void }) {
  const featured = ctx.demo ? ['studio', 'llama-8b', 'openai', 'projects-agent', 'github', 'aurora'].map(ctx.find).filter((x): x is StoreItem => !!x) : ctx.items;
  return <>
    <section className="st-hero">
      <img src={hero} alt="" width={1600} height={640}/>
      <div className="st-hero-copy"><span>ORDAX STORE</span><h1>Expanda suas possibilidades.</h1><p>Aplicativos, inteligências artificiais, agentes, plugins, conectores e pacotes — em um só lugar.</p>
        <div><Button onClick={() => go('apps')}>Explorar catálogo</Button><Button variant="outline" onClick={() => go('ai')}>Ver IAs</Button></div></div>
    </section>
    <div className="st-kinds">{([['apps', 'Aplicativos', 'Web, OS e terceiros', LayoutGrid], ['ai', 'Inteligências', 'Modelos, provedores, agentes', Brain], ['plugins', 'Plugins', 'MCP e extensões', Puzzle], ['connectors', 'Conectores', 'Serviços externos', Plug], ['packages', 'Pacotes', 'Temas e idiomas', Palette]] as const).map(([id, t, d, I]) => <button type="button" key={id} onClick={() => go(id)}><I/><span><strong>{t}</strong><small>{d}</small></span></button>)}</div>
    <Grid title={ctx.demo ? "Destaques" : "Catálogos do sistema"} note={ctx.demo ? "Seleção editorial demonstrativa, sem avaliações ou downloads." : "Aplicativos do catálogo verificado e candidato de IA registrado no OS. Um candidato não comprova instalação ou disponibilidade neste dispositivo."} items={featured} ctx={ctx}/>
    <section className="st-section st-ai-band"><header className="st-h"><h2>Inteligência no seu ritmo</h2><p>Execute localmente, conecte serviços na nuvem ou habilite agentes. Cada caminho tem regras próprias.</p></header>
      <div className="st-ai-paths">
        <button type="button" onClick={() => go('ai')}><Cpu/><strong>Modelos locais</strong><small>No seu computador, via mecanismos OrdaX. Seção informativa.</small></button>
        <button type="button" onClick={() => go('ai')}><Cloud/><strong>Provedores de nuvem</strong><small>Serviços externos mediante integração oficial.</small></button>
        <button type="button" onClick={() => go('ai')}><Bot/><strong>Agentes</strong><small>Especialistas que pedem permissão antes de agir.</small></button>
      </div></section>
  </>;
}

function AppsSection({ ctx }: { ctx: Ctx }) {
  const [plat, setPlat] = useState<Platform | 'all'>('all');
  const list = ofKind(ctx, 'app').filter(a => plat === 'all' || a.platforms.includes(plat));
  return <>
    <div className="st-chips" role="group" aria-label="Plataforma">{([['all', 'Todas'], ['web', 'OrdaX Web'], ['os', 'OrdaX OS'], ['device', 'Dispositivo conectado']] as const).map(([v, l]) => <button type="button" key={v} aria-pressed={plat === v} onClick={() => setPlat(v)}>{l}</button>)}</div>
    <Grid title="Aplicativos" note="Diferencie onde cada app funciona: no navegador, no OS nativo ou em um computador com Runtime autorizado." items={list} ctx={ctx}/>
  </>;
}

function AiSection({ ctx }: { ctx: Ctx }) {
  const [tab, setTab] = useState<'models' | 'providers' | 'agents' | 'compare'>('models');
  return <>
    <header className="st-h st-ai-head"><h2>Inteligências Artificiais</h2><p>Modelos locais, provedores de nuvem e agentes são tecnicamente diferentes e seguem fluxos diferentes.</p></header>
    <div className="st-chips" role="tablist" aria-label="Tipos de IA">{([['models', 'Modelos locais'], ['providers', 'Provedores de nuvem'], ['agents', 'Agentes'], ['compare', 'Comparar modelos']] as const).map(([v, l]) => <button type="button" role="tab" key={v} aria-selected={tab === v} onClick={() => setTab(v)}>{l}</button>)}</div>
    {tab === 'models' && <><Notice icon={Info}>A seção de modelos é informativa: a instalação independente ainda não está habilitada no OrdaX oficial. Requisitos e desempenho só aparecem quando homologados.</Notice><Grid title="Modelos locais" items={ofKind(ctx, 'model')} ctx={ctx}/></>}
    {tab === 'providers' && <><Notice icon={Info}>{ctx.demo ? 'Exemplos ilustrativos. Não há integração oficial, login externo nem armazenamento de chaves nesta prévia.' : 'O catálogo de provedores ainda não está conectado à versão Web.'}</Notice><Grid title="Provedores de nuvem" items={ofKind(ctx, 'provider')} ctx={ctx}/></>}
    {tab === 'agents' && <><Notice icon={Lock}>Habilitar um agente não concede acesso ao sistema. Cada permissão exige aprovação separada.</Notice><Grid title="Agentes" items={ofKind(ctx, 'agent')} ctx={ctx}/></>}
    {tab === 'compare' && <Compare ctx={ctx}/>}
  </>;
}

function Notice({ icon: I, children, tone = '' }: { icon: typeof Info; children: ReactNode; tone?: string }) { return <p className={`st-notice ${tone}`}><I/>{children}</p>; }

function Compare({ ctx }: { ctx: Ctx }) {
  const models = ofKind(ctx, 'model');
  const rows: [string, (m: ModelItem) => string][] = [['Tarefas', m => m.tasks.join(', ') || 'Não informado'], ['Formato', m => `${m.format} · ${m.quantization}`], ['Tamanho', m => m.artifactSize ?? 'Não informado'], ['RAM / VRAM', m => m.ram || m.vram ? `${m.ram ?? '—'} / ${m.vram ?? '—'}` : 'Não homologado'], ['GPU', m => m.gpu], ['Licença', m => m.license], ['Offline', m => m.offline ? 'Sim' : 'Não'], ['Compatibilidade', m => evaluateModel(m, { connected: false })]];
  return <section className="st-section"><header className="st-h"><h2>Comparar modelos</h2><p>Sem computador conectado, nenhuma compatibilidade é avaliada. Nenhum benchmark é exibido sem medição válida.</p></header>
    <div className="st-table-wrap"><table className="st-table"><thead><tr><th scope="col">Atributo</th>{models.map(m => <th scope="col" key={m.id}><button type="button" onClick={() => ctx.open(m.id)}>{m.name}</button></th>)}</tr></thead>
      <tbody>{rows.map(([l, f]) => <tr key={l}><th scope="row">{l}</th>{models.map(m => <td key={m.id}>{f(m)}</td>)}</tr>)}</tbody></table></div></section>;
}

function LibrarySection({ ctx }: { ctx: Ctx }) {
  const by = (pred: (i: StoreItem, s: ProductStatus) => boolean) => ctx.items.filter(i => pred(i, ctx.status(i)));
  const groups: [string, StoreItem[]][] = [
    ['Aplicativos instalados', by((i, s) => (i.kind === 'app' || i.kind === 'plugin') && (ctx.demo ? s === 'installed' || s === 'update-available' : ctx.entries.get(i.id)?.installedVersion != null))],
    ['Provedores e conectores conectados', by((i, s) => (i.kind === 'provider' || i.kind === 'connector') && s === 'connected')],
    ['Agentes habilitados', by((i, s) => i.kind === 'agent' && s === 'enabled')],
    ['Pacotes aplicados', by((i, s) => i.kind === 'package' && s === 'installed')],
    ['Modelos de IA (informativos)', ofKind(ctx, 'model')],
    ['Favoritos', ctx.state.favorites.map(ctx.find).filter((x): x is StoreItem => !!x)],
    ['Vistos recentemente', ctx.state.history.map(ctx.find).filter((x): x is StoreItem => !!x)],
  ];
  return <><Notice icon={Info} tone="warn">{ctx.demo ? 'Biblioteca demonstrativa da sessão. Não reflete instalações reais do seu dispositivo.' : ctx.catalogState === 'unavailable' ? 'Sem conexão com o catálogo, não é possível consultar as instalações do dispositivo.' : 'Instalações informadas pelo catálogo oficial. Favoritos e itens vistos permanecem apenas nesta sessão.'}</Notice>
    {groups.map(([t, items]) => <section className="st-section" key={t}><header className="st-h"><h2>{t} <small>{items.length}</small></h2></header>
      {items.length ? <ul className="st-list">{items.map(i => <Row key={i.id} item={i} ctx={ctx}/>)}</ul> : <Empty text="Nenhum item."/>}</section>)}</>;
}

function Row({ item, ctx }: { item: StoreItem; ctx: Ctx }) {
  const st = ctx.status(item);
  return <li className="st-row"><Mark item={item} size="sm"/><button type="button" className="st-row-name" onClick={() => ctx.open(item.id)}><strong>{item.name}</strong><small>{kindMeta[item.kind].label} · <span className={`st-status st-s-${st}`}>{statusText[st]}</span></small></button><ActionButton item={item} ctx={ctx}/></li>;
}

function OpIcon({ s }: { s: Operation['state'] }) {
  return s === 'succeeded' ? <CheckCircle2 className="st-ok"/> : s === 'failed' ? <XCircle className="st-bad"/> : s === 'blocked' ? <Ban className="st-warn"/> : <Loader2 className="animate-spin"/>;
}
function UpdatesSection({ ctx }: { ctx: Ctx }) {
  const ups = ctx.items.filter(item => ctx.status(item) === 'update-available');
  return <>
    <section className="st-section"><header className="st-h st-h-row"><div><h2>Atualizações elegíveis</h2><p>Atualizar envia uma solicitação; aceitar não significa concluir.</p></div>{ctx.demo && ups.length > 0 && <Button onClick={() => ups.forEach(i => ctx.request(i, 'update'))}><RefreshCw/>Atualizar tudo <SimTag/></Button>}</header>
      {ups.length ? <ul className="st-list">{ups.map(i => <Row key={i.id} item={i} ctx={ctx}/>)}</ul> : <Empty text={ctx.demo ? "Tudo em dia nesta demonstração." : ctx.catalogState === 'unavailable' ? "Conecte o catálogo para consultar atualizações." : "Nenhuma atualização elegível informada pelo catálogo."}/>}</section>
    <section className="st-section"><header className="st-h"><h2>Solicitações e operações</h2><p>Progresso, bloqueios e falhas da sessão. Uma falha nunca é mostrada como sucesso.</p></header>
      {ctx.state.ops.length ? <ul className="st-ops">{ctx.state.ops.map(o => { const i = ctx.find(o.itemId); return <li key={o.id} className={`st-op st-op-${o.state}`}><OpIcon s={o.state}/><div><strong>{i?.name}</strong><small>{o.message}</small></div><span className="st-op-state">{o.state === 'requested' ? 'Solicitada' : o.state === 'accepted' ? 'Aceita' : o.state === 'running' ? 'Em andamento' : o.state === 'succeeded' ? 'Concluída' : o.state === 'failed' ? 'Falhou' : 'Bloqueada'}</span>{['succeeded', 'failed', 'blocked'].includes(o.state) && <Button size="sm" variant="ghost" onClick={() => ctx.dispatch({ type: 'dismiss', id: o.id })}>Dispensar</Button>}{o.state === 'failed' && i && <Button size="sm" variant="outline" onClick={() => ctx.request(i, o.op)}>Tentar de novo</Button>}</li>; })}</ul> : <Empty text="Nenhuma operação nesta sessão."/>}</section>
  </>;
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="st-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
function List({ title, items, empty = 'Nenhum informado.' }: { title: string; items: string[]; empty?: string }) {
  return <section className="st-block"><h3>{title}</h3>{items.length ? <ul>{items.map(x => <li key={x}>{x}</li>)}</ul> : <p className="st-muted">{empty}</p>}</section>;
}

function Detail({ item, ctx, onBack }: { item: StoreItem; ctx: Ctx; onBack: () => void }) {
  const st = ctx.status(item);
  const fav = ctx.state.favorites.includes(item.id);
  const lastOp = ctx.state.ops.find(o => o.itemId === item.id);
  const body = useMemo(() => <KindBody item={item} ctx={ctx}/>, [item, ctx]);
  return <article className="st-detail">
    <button type="button" className="st-back" onClick={onBack}><ArrowLeft/>Voltar</button>
    <header className="st-detail-head"><Mark item={item} size="lg"/>
      <div><Pill tone={`st-k-${item.kind}`}>{kindMeta[item.kind].label}</Pill><h1>{item.name}</h1><p>{item.tagline}</p><small>{item.developer}{item.illustrative ? ' · exemplo ilustrativo' : ''}</small></div>
      <div className="st-detail-actions"><ActionButton item={item} ctx={ctx} size="default"/><Button variant="ghost" size="icon" aria-pressed={fav} aria-label={fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} onClick={() => ctx.dispatch({ type: 'favorite', itemId: item.id })}><Heart className={fav ? 'st-fav' : ''}/></Button>
        {ctx.demo && (item.kind === 'app' || item.kind === 'plugin') && (st === 'installed' || st === 'update-available') && <Button variant="outline" onClick={() => ctx.request(item, 'remove')}>Remover</Button>}
        <small className={`st-status st-s-${st}`}>{statusText[st]}</small></div>
    </header>
    {lastOp && <p className={`st-notice st-op-${lastOp.state}`}><OpIcon s={lastOp.state}/>{lastOp.message}</p>}
    {ctx.demo && st === 'authorization-required' && (item.kind === 'provider' || item.kind === 'connector') && <ConnectFlow item={item} ctx={ctx}/>}
    <p className="st-desc">{item.description}</p>
    {body}
  </article>;
}

function ConnectFlow({ item, ctx }: { item: StoreItem; ctx: Ctx }) {
  return <section className="st-connect" aria-label="Autorização simulada">
    <header><ShieldCheck/><div><h3>Autorizar {item.name} <SimTag/></h3><p>No fluxo oficial, você seria levado à página do serviço. Nenhum login, token ou chave é solicitado aqui.</p></div></header>
    <ol><li>Revisar permissões solicitadas</li><li>Confirmar no serviço externo (não executado)</li><li>Aguardar confirmação do OrdaX</li></ol>
    <div><Button onClick={() => ctx.dispatch({ type: 'authorize', itemId: item.id, approve: true })}>Simular autorização</Button><Button variant="outline" onClick={() => ctx.dispatch({ type: 'authorize', itemId: item.id, approve: false })}>Cancelar</Button></div>
  </section>;
}

function compatBadge(c: string) {
  const tone = c === 'compatível' ? 'st-ok' : c === 'incompatível' ? 'st-bad' : 'st-warn';
  return <span className={`st-compat ${tone}`}>{c === 'compatível' ? <CheckCircle2/> : c === 'incompatível' ? <XCircle/> : <AlertTriangle/>}{c}</span>;
}

function KindBody({ item, ctx }: { item: StoreItem; ctx: Ctx }) {
  if (!ctx.demo && item.kind === 'app') {
    const entry = ctx.entries.get(item.id)!;
    return <div className="st-detail-grid">
      <Facts rows={[[ 'Estado', statusText[ctx.status(item)] ], ['Versão instalada', entry.installedVersion ?? 'Nenhuma informada'], ['Versão disponível', entry.availableVersion ?? 'Nenhuma informada'], ['Identidade do artefato verificada', entry.artifactIdentityVerified ? 'Sim' : 'Não'], ['Procedência verificada', entry.provenanceVerified ? 'Sim' : 'Não'], ['Bloqueio', entry.blockedReason ?? 'Nenhum informado']]}/>
      <Notice icon={Info}>Plataformas, permissões e requisitos não são informados por este contrato. Consulte a publicação oficial antes de instalar.</Notice>
    </div>;
  }
  switch (item.kind) {
    case 'app': return <div className="st-detail-grid">
      <Facts rows={[['Categoria', item.category], ['Versão', item.version], ['Funciona em', <span className="st-plat">{item.platforms.includes('device') ? <HardDrive/> : item.platforms.length > 1 ? <Globe2/> : item.platforms[0] === 'web' ? <Globe2/> : <Monitor/>}{platformLabel(item.platforms)}</span>], ['Procedência', item.official ? 'OrdaX Systems (catálogo oficial pendente)' : 'Terceiro · exemplo']]}/>
      <List title="Permissões" items={item.permissions}/><List title="Requisitos" items={item.requirements}/>
      <section className="st-block"><h3>Histórico de atualizações</h3>{item.changelog.length ? <ul>{item.changelog.map(c => <li key={c.version}><strong>{c.version}</strong> — {c.note}</li>)}</ul> : <p className="st-muted">Aguardando catálogo oficial.</p>}</section>
    </div>;
    case 'model': {
      const c = evaluateModel(item, { connected: false });
      return <>
        <Notice icon={Info} tone="warn">{ctx.demo ? 'Seção informativa: a instalação independente de modelos ainda não está habilitada. Esta página demonstra a experiência futura.' : 'Candidato registrado no catálogo canônico de IA do OS. A publicação, instalação e compatibilidade neste dispositivo não foram verificadas pela versão Web.'}</Notice>
        <section className="st-compat-panel"><div><h3>Compatibilidade com seu dispositivo</h3><p>A versão Web não recebeu dados de hardware nem de instalação, então não há avaliação. Requisitos mínimos ainda não foram homologados.</p></div>{compatBadge(c)}</section>
        <div className="st-detail-grid">
          <Facts rows={[['Desenvolvedor', item.developer], ['Família', item.family], ['Variante', item.variant], ['Identificador', <code>{item.modelId}</code>], ['Tarefas', item.tasks.join(', ') || 'Não informado' || 'Não informado'], ['Motor', item.engine], ['Formato / quantização', `${item.format} · ${item.quantization}`], ['Tamanho do pacote', item.artifactSize ?? 'Não informado']]}/>
          <Facts rows={[['RAM', item.ram ?? 'Não homologado'], ['VRAM', item.vram ?? 'Não homologado'], ['GPU', item.gpu], ['Offline', item.offline ? <span className="st-plat"><Wifi/>Funciona sem internet após instalado</span> : 'Requer internet'], ['Licença', item.license], ['Idiomas', item.languages.join(', ')], ['Desempenho', 'Sem medições válidas'], ['Estado', ctx.demo ? 'Não instalado · informativo' : 'Instalação não verificada · candidato informativo']]}/>
        </div></>;
    }
    case 'provider': return <div className="st-detail-grid">
      <List title="Capacidades oferecidas" items={item.capabilities}/>
      <section className="st-block"><h3>Formas de acesso</h3><ul>{item.access.map(a => <li key={a}>{a === 'assinatura' ? 'Assinatura do serviço (conta no provedor)' : 'Credencial de API (cobrança por uso no provedor)'}</li>)}<li>Diferente de execução local: os dados saem do seu dispositivo.</li></ul></section>
      <Facts rows={[['Custos', item.costs], ['Fluxo previsto', 'Autorização na página do provedor → confirmação no OrdaX'], ['Integração oficial', 'Não disponível'], ['Uso pelo Intelligence', 'Somente após autorização e contratos oficiais']]}/>
    </div>;
    case 'agent': return <div className="st-detail-grid">
      <Facts rows={[['Especialidade', item.specialty], ['Modelos compatíveis', item.models.join(', ')], ['Relação com o Intelligence', 'Executado através do OrdaX Intelligence; não é outro assistente'], ['Permissões concedidas', 'Nenhuma — cada uma exige aprovação']]}/>
      <List title="Tarefas" items={item.tasks}/><List title="Ferramentas necessárias" items={item.tools}/><List title="Permissões que pode solicitar" items={item.permissions}/><List title="Exemplos de uso" items={item.examples}/>
      <List title="Dependências" items={item.dependencies.map(d => d === 'projects-svc' ? 'Serviço de Projetos (não conectado)' : d)} empty="Nenhuma."/>
    </div>;
    case 'plugin': return <div className="st-detail-grid">
      <Facts rows={[['Tipo', item.pluginType], ['Versão', item.version], ['Origem', item.developer], ['Natureza', item.pluginType === 'MCP' ? 'Interface de ferramentas MCP, não provedor de inferência' : 'Extensão']]}/>
      <List title="Recursos disponibilizados" items={item.provides}/><List title="Apps compatíveis" items={item.compatibleApps}/><List title="Permissões" items={item.permissions}/>
    </div>;
    case 'connector': return <div className="st-detail-grid">
      <Facts rows={[['Serviço', item.service], ['Tipo', item.isMcp ? 'Conector MCP (ferramentas)' : 'Integração de serviço'], ['Compatibilidade', platformLabel(item.platforms)], ['Requer internet', 'Sim'], ['Estado', statusText[ctx.status(item)]]]}/>
      <List title="Recursos" items={item.provides}/><List title="Permissões necessárias" items={item.permissions}/>
    </div>;
    case 'package': return <Facts rows={[['Tipo', item.packageType], ['Versão', item.version], ['Ativação', item.activation]]}/>;
  }
}
