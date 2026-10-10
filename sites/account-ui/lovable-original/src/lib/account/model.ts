import { LayoutDashboard, UserRound, Crown, ChartNoAxesCombined, CreditCard, ShieldCheck, MonitorSmartphone, Fingerprint, SlidersHorizontal, CircleHelp, History } from 'lucide-react';
export const account = { connection: 'unavailable' as const, profile: null, subscription: null, usage: null, invoices: [] as never[], sessions: [] as never[] };
export const sections = [
  { path: '/', title: 'Visão geral', icon: LayoutDashboard, description: 'Sua identidade, assinatura e recursos em um só lugar.' },
  { path: '/dados-pessoais', title: 'Dados pessoais', icon: UserRound, description: 'Seu perfil e suas informações cadastrais.' },
  { path: '/assinatura', title: 'Plano e assinatura', icon: Crown, description: 'Seu plano, benefícios e opções de assinatura.' },
  { path: '/consumo', title: 'Consumo e limites', icon: ChartNoAxesCombined, description: 'Acompanhe seus recursos em todo o ecossistema OrdaX.' },
  { path: '/faturamento', title: 'Pagamentos e faturas', icon: CreditCard, description: 'Métodos de pagamento, cobranças e documentos fiscais.' },
  { path: '/seguranca', title: 'Segurança e acesso', icon: ShieldCheck, description: 'Proteja sua identidade e controle o acesso à sua conta.' },
  { path: '/dispositivos', title: 'Meus dispositivos', icon: MonitorSmartphone, description: 'Dispositivos e sessões vinculados à sua conta.' },
  { path: '/privacidade', title: 'Dados e privacidade', icon: Fingerprint, description: 'Seus dados, suas escolhas. Você está no controle.' },
  { path: '/preferencias', title: 'Preferências', icon: SlidersHorizontal, description: 'Personalize a experiência da sua conta.' },
  { path: '/atividade', title: 'Atividade da conta', icon: History, description: 'Histórico de acesso e alterações importantes.' },
  { path: '/suporte', title: 'Central de ajuda', icon: CircleHelp, description: 'Encontre respostas e cuide da sua experiência OrdaX.' },
] as const;
export type AccountPath = typeof sections[number]['path'];

/** Absolute public URL -> single canonical account-section route.
 * TanStack Router's location.pathname includes the /conta basepath.
 */
export function accountSectionFromUrl(pathname: string): AccountPath {
  const canonical = pathname.replace(/\/$/, '');
  const subpath = canonical === '/conta' ? '/' :
    canonical.startsWith('/conta/') ? canonical.slice('/conta'.length) : canonical;
  return (sections.find(section => section.path === subpath)?.path ?? '/') as AccountPath;
}
export function getAccountSummary() { return { plan: account.subscription, usage: account.usage, nextCharge: null, authenticated: account.profile !== null }; }
export const unavailableMessage = 'Os serviços da conta ainda não estão conectados. Nenhuma informação de assinatura, pagamento ou consumo está disponível.';
export type ServiceStatus = 'unavailable' | 'connected';
/** SSOT: official owner and capabilities that power each account section. */
export const sectionServices: Partial<Record<AccountPath, { owner: string; status: ServiceStatus; capabilities: string[] }>> = {
  '/': { owner: 'Identidade e conta OrdaX', status: 'unavailable', capabilities: ['Perfil autenticado', 'Resumo do plano', 'Indicadores de consumo'] },
  '/dados-pessoais': { owner: 'Identidade OrdaX', status: 'unavailable', capabilities: ['Leitura do perfil', 'Edição de dados cadastrais', 'Foto de perfil'] },
  '/assinatura': { owner: 'Direitos e assinaturas OrdaX', status: 'unavailable', capabilities: ['Plano contratado', 'Catálogo oficial de planos', 'Alteração e cancelamento'] },
  '/consumo': { owner: 'Medição de uso OrdaX', status: 'unavailable', capabilities: ['Créditos de IA', 'Armazenamento', 'Chamadas de API', 'Histórico por período'] },
  '/faturamento': { owner: 'Faturamento OrdaX', status: 'unavailable', capabilities: ['Métodos de pagamento', 'Faturas e recibos', 'Dados fiscais'] },
  '/seguranca': { owner: 'Identidade OrdaX', status: 'unavailable', capabilities: ['Senha', 'Verificação em duas etapas', 'Recuperação', 'Eventos de acesso'] },
  '/dispositivos': { owner: 'Sessões e dispositivos OrdaX', status: 'unavailable', capabilities: ['Sessões ativas', 'Dispositivos OrdaX OS', 'Encerramento remoto'] },
  '/privacidade': { owner: 'Privacidade OrdaX', status: 'unavailable', capabilities: ['Exportação de dados', 'Consentimentos', 'Exclusão da conta'] },
  '/atividade': { owner: 'Auditoria da conta OrdaX', status: 'unavailable', capabilities: ['Eventos de acesso', 'Alterações de conta', 'Filtros por período'] },
};
