import { House, Sparkles, LayoutGrid, FolderKanban, Folder, Layers3, Globe2, ShoppingBag, Settings2, Code2, FileText, Image, Bell } from 'lucide-react';
import { account } from '@/lib/account/model';

/** Presentation catalog only: these IDs are documented targets, not installed manifests. */
export const webApps = [
  { id: 'studio', name: 'Studio', subtitle: 'Desenvolvimento', icon: Code2, tone: 'violet', owner: 'OrdaX Apps', service: 'Runtime e registro de projetos não conectados.' },
  { id: 'files', name: 'Arquivos', subtitle: 'Seus arquivos', icon: Folder, tone: 'blue', owner: 'OrdaX Apps / File Space', service: 'File Space não conectado. Nenhuma pasta ou arquivo foi acessado.' },
  { id: 'internet', name: 'Internet', subtitle: 'Navegação', icon: Globe2, tone: 'cyan', owner: 'Host de navegação OrdaX', service: 'Host de navegação não conectado. Links abrem em uma nova aba do navegador.' },
  { id: 'image-viewer', name: 'Galeria', subtitle: 'Imagens', icon: Image, tone: 'violet', owner: 'OrdaX Apps / File Space', service: 'Nenhuma biblioteca autorizada está conectada.' },
  { id: 'notes', name: 'Notas', subtitle: 'Anotações', icon: FileText, tone: 'mint', owner: 'OrdaX Apps', service: 'Armazenamento de notas não conectado.' },
  { id: 'projects', name: 'Projetos', subtitle: 'Seus trabalhos', icon: FolderKanban, tone: 'blue', owner: 'Registro de projetos OrdaX', service: 'Registro de projetos não conectado.' },
  { id: 'assistant', name: 'Intelligence', subtitle: 'Assistente contextual', icon: Sparkles, tone: 'violet', owner: 'OrdaX Intelligence / Platform', service: 'Intelligence não conectado. Nenhuma mensagem é enviada ou ação executada.' },
  { id: 'spaces', name: 'Spaces', subtitle: 'Contextos de trabalho', icon: Layers3, tone: 'mint', owner: 'Serviço Spaces OrdaX', service: 'Spaces e participantes não conectados.' },
  { id: 'settings', name: 'Ajustes', subtitle: 'Seu ambiente', icon: Settings2, tone: 'neutral', owner: 'OrdaX Surface', service: 'Prévia de aparência válida apenas nesta sessão. Não altera a conta ou o dispositivo.' },
  { id: 'store', name: 'Loja', subtitle: 'Descoberta de apps', icon: ShoppingBag, tone: 'cyan', owner: 'OrdaX Surface / Package lifecycle', service: 'Catálogo de distribuição não conectado. Instalação e atualização indisponíveis.' },
  { id: 'activity', name: 'Notificações', subtitle: 'Eventos do ambiente', icon: Bell, tone: 'neutral', owner: 'OrdaX Surface / Platform', service: 'Feed de notificações não conectado. Não há eventos verificados disponíveis.' },
] as const;
export type WebAppId = typeof webApps[number]['id'];
export const webViews = ['home', 'assistant', 'apps', 'projects', 'files', 'spaces', 'internet', 'store'] as const;
export type WebView = typeof webViews[number];
export const webNavigation: { id: WebView; title: string; icon: typeof House; kind: 'page' | 'app' | 'panel'; app?: WebAppId }[] = [
  { id: 'home', title: 'Início', icon: House, kind: 'page' },
  { id: 'assistant', title: 'OrdaX Intelligence', icon: Sparkles, kind: 'page' },
  { id: 'apps', title: 'Aplicativos', icon: LayoutGrid, kind: 'page' },
  { id: 'projects', title: 'Projetos', icon: FolderKanban, kind: 'page' },
  { id: 'files', title: 'Arquivos', icon: Folder, kind: 'app', app: 'files' },
  { id: 'spaces', title: 'Spaces', icon: Layers3, kind: 'page' },
  { id: 'internet', title: 'Internet', icon: Globe2, kind: 'app', app: 'internet' },
  { id: 'store', title: 'Loja', icon: ShoppingBag, kind: 'page' },
];
export const webServices = { identity: account.connection, intelligence: 'unavailable', fileSpace: 'unavailable', projects: 'unavailable', spaces: 'unavailable', lifecycle: 'unavailable', sync: 'unavailable' } as const;
export const getWebApp = (id: WebAppId) => webApps.find(app => app.id === id) ?? webApps[0];
export const normalizeWebView = (value: unknown): WebView => webViews.find(view => view === value) ?? 'home';
/** Explicit Home visual fixtures. Session-only examples, never a connected service or account state. */
export const homeDemo = {
  space: { name: 'Space Pessoal', status: 'Exemplo de Space ativo' },
  projects: [
    { id: 'os', name: 'OrdaX OS', description: 'Ajustes na interface e evolução do sistema.', edited: 'Editado há 2 horas', cover: 'landscape' },
    { id: 'apps', name: 'OrdaX Apps', description: 'Planejamento da próxima versão de aplicativos.', edited: 'Editado há 5 horas', cover: 'apps' },
    { id: 'bay', name: 'Bay of All Saints', description: 'Pesquisa e organização de referências.', edited: 'Editado ontem', cover: 'bay' },
    { id: 'catalog', name: 'Catálogo', description: 'Estrutura e conteúdo do catálogo.', edited: 'Editado há 2 dias', cover: 'catalog' },
  ],
  activity: [
    { id: 'update', title: 'Atualização do OrdaX OS', detail: 'Exemplo: preparando pacote', progress: 78, time: 'Em demonstração', kind: 'download' },
    { id: 'sync', title: 'Sincronização de arquivos', detail: 'Exemplo: envio ao Space Pessoal', progress: 45, time: 'Em demonstração', kind: 'sync' },
    { id: 'download', title: 'Download concluído', detail: 'Pacote de ícones de exemplo', progress: null, time: 'Há 12 min', kind: 'download' },
    { id: 'install', title: 'Instalação de aplicativo', detail: 'OrdaX Notes · cenário de exemplo', progress: null, time: 'Há 28 min', kind: 'app' },
    { id: 'security', title: 'Verificação de segurança', detail: 'Cenário de sistema protegido', progress: null, time: 'Há 1 hora', kind: 'security' },
  ],
  devices: [
    { id: 'notebook', name: 'MacBook Pro', platform: 'macOS · OrdaX Web', status: 'Online · exemplo', kind: 'desktop' },
    { id: 'phone', name: 'iPhone 15', platform: 'iOS · OrdaX App', status: 'Online · exemplo', kind: 'phone' },
    { id: 'tablet', name: 'iPad Air', platform: 'iPadOS · OrdaX App', status: 'Offline · exemplo', kind: 'tablet' },
  ],
} as const;
