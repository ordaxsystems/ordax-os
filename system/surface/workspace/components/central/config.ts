import { House, Bell, Settings, Sparkles, Folder, FolderOpen, LayoutGrid, Globe, WalletCards, MonitorSmartphone, BriefcaseBusiness, CirclePlus, ListTodo, Compass, Workflow, ShoppingBag, Box, Terminal, FileBox, UserRound, type LucideIcon } from 'lucide-react';
export type IconTone = 'orange' | 'violet' | 'blue' | 'green' | 'red' | 'lime' | 'ink';
export type AppItem = { name: string; icon: LucideIcon; tone: IconTone; caption?: string };
export const navigation = [
  { name: 'Início', icon: House }, { name: 'Aura', icon: Sparkles },
  { name: 'Projetos', icon: Folder }, { name: 'Aplicativos', icon: LayoutGrid },
  { name: 'Arquivos', icon: FolderOpen }, { name: 'Internet', icon: Globe },
  { name: 'Espaços', icon: WalletCards }, { name: 'Dispositivos', icon: MonitorSmartphone },
];
export const shortcuts: AppItem[] = [
  { name: 'Projetos', icon: Folder, tone: 'orange', caption: 'Continue seus projetos' },
  { name: 'Arquivos', icon: FileBox, tone: 'orange', caption: 'Acesse seus documentos' },
  { name: 'Aplicativos', icon: LayoutGrid, tone: 'blue', caption: 'Abra seus apps favoritos' },
  { name: 'Internet', icon: Globe, tone: 'green', caption: 'Navegação segura e privada' },
];
export const modes = [ { name: 'Trabalhar', icon: BriefcaseBusiness }, { name: 'Criar', icon: CirclePlus }, { name: 'Organizar', icon: ListTodo }, { name: 'Explorar', icon: Compass }, { name: 'Automatizar', icon: Workflow } ];
export const favorites: AppItem[] = [
  { name: 'Projetos', icon: Folder, tone: 'violet' }, { name: 'Arquivos', icon: FolderOpen, tone: 'orange' },
  { name: 'Internet', icon: Globe, tone: 'green' }, { name: 'Loja', icon: ShoppingBag, tone: 'red' },
  { name: 'Inteligência', icon: Sparkles, tone: 'lime' }, { name: 'Editor 3D', icon: Box, tone: 'violet' },
  { name: 'Terminal', icon: Terminal, tone: 'ink' },
];
export const unavailableServices = {
  projects: 'Seus projetos precisam de um dispositivo OrdaX conectado. Este acesso ainda não está disponível no Web.',
  files: 'Seus arquivos precisam de um dispositivo OrdaX autorizado e conectado. Este acesso ainda não está disponível no Web.',
  activity: 'O serviço de atividade ainda não está conectado a esta sessão.',
  devices: 'Não foi possível consultar seus dispositivos. A conexão com dispositivos ainda não está disponível nesta sessão.',
  storage: 'Uso e limite de armazenamento indisponíveis.',
  intelligence: 'Aura ainda não está conectada a um serviço de inteligência artificial.',
} as const;
// Window chrome reuses app metadata instead of a second icon catalog.
const panelIcons: Record<string, LucideIcon> = { 'Configurações': Settings, 'Notificações': Bell, 'Atividades': ListTodo, 'Minha conta': UserRound };
export function getWindowIcon(title: string): LucideIcon {
  return navigation.find(app => app.name === title)?.icon
    ?? favorites.find(app => app.name === title)?.icon
    ?? panelIcons[title]
    ?? LayoutGrid;
}
