import { House, Sparkles, Folder, FolderOpen, LayoutGrid, Globe, WalletCards, MonitorSmartphone, BriefcaseBusiness, CirclePlus, ListTodo, Compass, Workflow, ShoppingBag, Box, Terminal, Laptop, Smartphone, Monitor, Cloud, RefreshCw, MessageSquare, FileBox, Shield, type LucideIcon } from 'lucide-react';
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
export const projects = [
  { name: 'Bay of All Saints', detail: 'Projeto · Editado há 2h', icon: Folder, tone: 'green' as const, image: true },
  { name: 'Proposta OrdaX', detail: 'Documento · Editado há 5h', icon: Shield, tone: 'blue' as const },
  { name: 'Catálogo STL', detail: 'Pasta · Editado ontem', icon: Box, tone: 'orange' as const },
];
export const activities = [
  { title: 'Instalação concluída', detail: 'Blender 4.2', time: '10:24', icon: CirclePlus, tone: 'green' as const },
  { title: 'Arquivo sincronizado', detail: 'Projeto Salvador', time: '09:17', icon: Cloud, tone: 'violet' as const },
  { title: 'Atualização disponível', detail: 'OrdaX OS Web', time: '08:42', icon: RefreshCw, tone: 'violet' as const },
  { title: 'Novo comentário', detail: 'Catálogo STL', time: '07:55', icon: MessageSquare, tone: 'red' as const },
];
export const devices = [ { name: 'MacBook Pro', platform: 'macOS', icon: Laptop }, { name: 'iPhone 15', platform: 'iOS', icon: Smartphone }, { name: 'OrdaX Hub', platform: 'Local', icon: Monitor } ];

// Presentation-only account fixture shared by the sidebar and Space panel.
export const presentationAccount = { spaceName: 'Espaço Pessoal', planName: 'Plano Pro', storageUsedGb: 128, storageLimitGb: 500 };
export const presentationStoragePercent = Math.min(100, Math.max(0, presentationAccount.storageLimitGb > 0 ? presentationAccount.storageUsedGb / presentationAccount.storageLimitGb * 100 : 0));

// Display fixture only; real signed-in profile integration remains deferred.
export const presentationUser = { displayName: 'João', avatarInitials: 'JO' };
