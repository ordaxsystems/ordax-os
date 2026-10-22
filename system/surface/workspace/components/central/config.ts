import { MERIDIAN_RAIL_DESTINATIONS } from '../../../../services/surface/meridian-navigation.mjs';
import { HOME_SHORTCUTS } from '../../../../services/preferences/home-shortcuts.mjs';
import { getSurfaceDestination, resolveSurfaceWindowTitle } from '../../../../services/surface/destination-catalog.mjs';
import { House, Bell, Settings, Sparkles, Folder, FolderOpen, LayoutGrid, Globe, WalletCards, MonitorSmartphone, BriefcaseBusiness, CirclePlus, ListTodo, Compass, Workflow, ShoppingBag, Box, Terminal, FileBox, UserRound, type LucideIcon } from 'lucide-react';

export type IconTone = 'orange' | 'violet' | 'blue' | 'green' | 'red' | 'lime' | 'ink';
export type AppItem = { id: string; name: string; icon: LucideIcon; tone: IconTone; caption?: string };

const surfaceName = (id: string): string => getSurfaceDestination(id).label;

export const navigation: { name: string; icon: LucideIcon; target?: string; rail?: boolean; group?: 'principal' | 'ecossistema' }[] = [
  ...MERIDIAN_RAIL_DESTINATIONS.map(item => ({name:item.name, icon:({LayoutGrid,Sparkles,WalletCards,BriefcaseBusiness,MonitorSmartphone,ShoppingBag} as Record<string,LucideIcon>)[item.icon], rail:true, group:item.group as 'principal'|'ecossistema'|undefined})),
  { name: surfaceName('projects'), icon: Folder }, { name: surfaceName('files'), icon: FolderOpen },
  { name: surfaceName('internet'), icon: Globe }, { name: 'Ajustes', icon: Settings, target: 'Configurações' },
];

export const shortcuts: AppItem[] = [
  { id: 'projects', name: surfaceName('projects'), icon: Folder, tone: 'orange', caption: 'Continue seus projetos' },
  { id: 'files', name: surfaceName('files'), icon: FileBox, tone: 'orange', caption: 'Acesse seus documentos' },
  { id: 'apps', name: 'Aplicativos', icon: LayoutGrid, tone: 'blue', caption: 'Abra seus apps favoritos' },
  { id: 'internet', name: surfaceName('internet'), icon: Globe, tone: 'green', caption: 'Navegação segura e privada' },
];

export const modes = [
  { name: 'Trabalhar', icon: BriefcaseBusiness },
  { name: 'Criar', icon: CirclePlus },
  { name: 'Organizar', icon: ListTodo },
  { name: 'Explorar', icon: Compass },
  { name: 'Automatizar', icon: Workflow },
];

const shortcutAppearance: Record<string, { icon: LucideIcon; tone: IconTone }> = {
  projects: { icon: Folder, tone: 'violet' }, files: { icon: FolderOpen, tone: 'orange' },
  internet: { icon: Globe, tone: 'green' }, store: { icon: ShoppingBag, tone: 'red' },
  intelligence: { icon: Sparkles, tone: 'lime' }, 'editor-3d': { icon: Box, tone: 'violet' },
  terminal: { icon: Terminal, tone: 'ink' },
};

export const favorites: AppItem[] = HOME_SHORTCUTS.map(shortcut => ({
  ...shortcut,
  ...shortcutAppearance[shortcut.id],
}));

export const unavailableServices = {
  projects: 'Seus projetos precisam de um dispositivo OrdaX conectado. Este acesso ainda não está disponível no Web.',
  files: 'Seus arquivos precisam de um dispositivo OrdaX autorizado e conectado. Este acesso ainda não está disponível no Web.',
  activity: 'O serviço de atividade ainda não está conectado a esta sessão.',
  devices: 'Não foi possível consultar seus dispositivos. A conexão com dispositivos ainda não está disponível nesta sessão.',
  storage: 'Uso e limite de armazenamento indisponíveis.',
  intelligence: 'Aura ainda não está conectada a um serviço de inteligência artificial.',
} as const;

// Window chrome reuses destination metadata instead of keeping a second identity catalog.
const panelIcons: Record<string, LucideIcon> = {
  'Configurações': Settings,
  'Notificações': Bell,
  'Atividades': ListTodo,
  'Minha conta': UserRound,
};

export function getWindowIcon(title: string): LucideIcon {
  return navigation.find(app => app.name === title)?.icon
    ?? favorites.find(app => app.name === title)?.icon
    ?? panelIcons[title]
    ?? LayoutGrid;
}

// Presentation labels resolve through the canonical destination identity when possible.
export function getWindowTitle(title: string): string {
  return resolveSurfaceWindowTitle(title);
}

// Search uses destination labels and canonical targets, with accent-insensitive tokens.
export function matchesNavigationQuery(item: {name:string;target?:string}, query:string): boolean {
  const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  const haystack=normalize(item.name+' '+(item.target??''));
  return normalize(query).trim().split(/\s+/).every(token=>haystack.includes(token));
}
