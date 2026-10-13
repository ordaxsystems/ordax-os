/**
 * OrdaX Store — centralized demo catalog (presentation only).
 * Each product kind keeps its own typed record; the UI consumes them through `toCard`.
 * No real publication, rating, download count, benchmark or integration is represented here.
 */
export type Platform = 'web' | 'os' | 'device';
export type Kind = 'app' | 'model' | 'provider' | 'agent' | 'plugin' | 'connector' | 'package';
export type Tone = 'violet' | 'blue' | 'cyan' | 'green' | 'amber' | 'pink';

type Base = { id: string; name: string; tagline: string; description: string; developer: string; tone: Tone; monogram: string; tags: string[]; illustrative?: boolean };

export type AppItem = Base & { kind: 'app'; category: string; platforms: Platform[]; version: string; permissions: string[]; requirements: string[]; changelog: { version: string; note: string }[]; official: boolean };
export type ModelItem = Base & {
  kind: 'model'; family: string; variant: string; modelId: string; tasks: ('texto' | 'código' | 'imagem' | 'visão' | 'voz' | 'multimodal')[];
  engine: string; format: string; quantization: string; artifactSize: string | null; ram: string | null; vram: string | null;
  gpu: 'necessária' | 'opcional' | 'não homologado'; license: string; languages: string[]; offline: boolean;
};
export type ProviderItem = Base & { kind: 'provider'; capabilities: string[]; access: ('assinatura' | 'credencial de API')[]; costs: string; demoConnectable: boolean };
export type AgentItem = Base & { kind: 'agent'; specialty: string; tasks: string[]; models: string[]; tools: string[]; permissions: string[]; examples: string[]; dependencies: string[] };
export type PluginItem = Base & { kind: 'plugin'; pluginType: 'MCP' | 'Extensão de app' | 'Ferramenta dev' | 'Intelligence'; version: string; provides: string[]; compatibleApps: string[]; permissions: string[] };
export type ConnectorItem = Base & { kind: 'connector'; service: string; provides: string[]; permissions: string[]; platforms: Platform[]; isMcp: boolean };
export type PackageItem = Base & { kind: 'package'; packageType: 'Tema' | 'Idioma' | 'Perfil' | 'Template' | 'Personalização'; version: string; activation: string };
export type StoreItem = AppItem | ModelItem | ProviderItem | AgentItem | PluginItem | ConnectorItem | PackageItem;

export const kindMeta: Record<Kind, { label: string; plural: string; verb: 'Instalar' | 'Conectar' | 'Habilitar' | 'Aplicar' }> = {
  app: { label: 'Aplicativo', plural: 'Aplicativos', verb: 'Instalar' },
  model: { label: 'Modelo local', plural: 'Modelos locais', verb: 'Instalar' },
  provider: { label: 'Provedor de IA', plural: 'Provedores de IA', verb: 'Conectar' },
  agent: { label: 'Agente', plural: 'Agentes', verb: 'Habilitar' },
  plugin: { label: 'Plugin', plural: 'Plugins e extensões', verb: 'Instalar' },
  connector: { label: 'Conector', plural: 'Conectores', verb: 'Conectar' },
  package: { label: 'Pacote', plural: 'Pacotes e temas', verb: 'Aplicar' },
};

export const apps: AppItem[] = [
  { kind: 'app', id: 'studio', name: 'OrdaX Studio', tagline: 'Desenvolvimento visual de aplicativos com IA', description: 'Ambiente oficial para criar, personalizar e publicar aplicativos do ecossistema OrdaX, com assistência do Intelligence e componentes prontos.', developer: 'OrdaX Systems', tone: 'violet', monogram: 'S', tags: ['Desenvolvimento', 'IA'], category: 'Desenvolvimento', platforms: ['web', 'os'], version: 'Aguardando catálogo oficial', permissions: ['Arquivos do projeto aberto', 'Intelligence (mediante aprovação)'], requirements: ['Conta OrdaX'], changelog: [{ version: 'Conceito', note: 'Interface de demonstração no OrdaX Web.' }], official: true },
  { kind: 'app', id: 'files', name: 'Arquivos', tagline: 'Organize documentos e mídias', description: 'Gerenciador de arquivos do ecossistema, com visualização por Spaces e projetos.', developer: 'OrdaX Systems', tone: 'blue', monogram: 'A', tags: ['Produtividade'], category: 'Produtividade', platforms: ['web', 'os'], version: 'Aguardando catálogo oficial', permissions: ['Armazenamento autorizado pela conta'], requirements: [], changelog: [], official: true },
  { kind: 'app', id: 'notes', name: 'Notas', tagline: 'Ideias e textos rápidos', description: 'Bloco de notas com organização por Space.', developer: 'OrdaX Systems', tone: 'amber', monogram: 'N', tags: ['Produtividade'], category: 'Produtividade', platforms: ['web', 'os'], version: 'Aguardando catálogo oficial', permissions: ['Notas do Space ativo'], requirements: [], changelog: [], official: true },
  { kind: 'app', id: 'media', name: 'Player de Mídia', tagline: 'Áudio e vídeo locais', description: 'Reprodutor para arquivos locais em dispositivos com o OrdaX OS.', developer: 'OrdaX Systems', tone: 'pink', monogram: 'P', tags: ['Multimídia'], category: 'Multimídia', platforms: ['os'], version: 'Aguardando catálogo oficial', permissions: ['Pastas de mídia selecionadas'], requirements: ['OrdaX OS nativo'], changelog: [], official: true },
  { kind: 'app', id: 'remote-term', name: 'Terminal Remoto', tagline: 'Shell em computador conectado', description: 'Exemplo de app que depende de um computador com Runtime autorizado.', developer: 'Exemplo de terceiro', tone: 'green', monogram: 'T', tags: ['Utilitários', 'Desenvolvimento'], category: 'Utilitários', platforms: ['device'], version: 'Exemplo', permissions: ['Execução no dispositivo (aprovação explícita)'], requirements: ['Runtime autorizado online'], changelog: [], official: false, illustrative: true },
  { kind: 'app', id: 'puzzle', name: 'Quebra-cabeça Zen', tagline: 'Jogo casual', description: 'Exemplo de jogo Web de terceiro.', developer: 'Exemplo de terceiro', tone: 'cyan', monogram: 'Z', tags: ['Jogos'], category: 'Jogos', platforms: ['web'], version: 'Exemplo', permissions: [], requirements: [], changelog: [], official: false, illustrative: true },
];

export const models: ModelItem[] = [
  { kind: 'model', id: 'llama-8b', name: 'Llama 3.1 8B Instruct', tagline: 'Texto e código de uso geral', description: 'Modelo de linguagem aberto para conversa, redação e código.', developer: 'Meta', tone: 'violet', monogram: 'L', tags: ['Local', 'Texto', 'Código'], family: 'Llama 3.1', variant: '8B Instruct', modelId: 'meta-llama/Llama-3.1-8B-Instruct', tasks: ['texto', 'código'], engine: 'Mecanismo de inferência OrdaX (não homologado)', format: 'GGUF', quantization: 'Q4_K_M', artifactSize: null, ram: null, vram: null, gpu: 'não homologado', license: 'Llama 3.1 Community License', languages: ['Inglês', 'Português', 'Espanhol', '+5'], offline: true, illustrative: true },
  { kind: 'model', id: 'qwen-7b', name: 'Qwen2.5 7B Instruct', tagline: 'Multilíngue e versátil', description: 'Modelo aberto com bom suporte multilíngue.', developer: 'Alibaba Qwen', tone: 'blue', monogram: 'Q', tags: ['Local', 'Texto'], family: 'Qwen2.5', variant: '7B Instruct', modelId: 'Qwen/Qwen2.5-7B-Instruct', tasks: ['texto', 'código'], engine: 'Mecanismo de inferência OrdaX (não homologado)', format: 'GGUF', quantization: 'Q4_K_M', artifactSize: null, ram: null, vram: null, gpu: 'não homologado', license: 'Apache 2.0', languages: ['Multilíngue'], offline: true, illustrative: true },
  { kind: 'model', id: 'phi-mini', name: 'Phi-3 Mini', tagline: 'Leve para tarefas diárias', description: 'Modelo pequeno voltado a dispositivos modestos.', developer: 'Microsoft', tone: 'cyan', monogram: 'Φ', tags: ['Local', 'Texto'], family: 'Phi-3', variant: 'Mini 4K Instruct', modelId: 'microsoft/Phi-3-mini-4k-instruct', tasks: ['texto'], engine: 'Mecanismo de inferência OrdaX (não homologado)', format: 'GGUF', quantization: 'Q4', artifactSize: null, ram: null, vram: null, gpu: 'opcional', license: 'MIT', languages: ['Inglês'], offline: true, illustrative: true },
  { kind: 'model', id: 'sdxl', name: 'Stable Diffusion XL', tagline: 'Geração de imagens local', description: 'Modelo de difusão para criar imagens a partir de texto.', developer: 'Stability AI', tone: 'amber', monogram: 'SD', tags: ['Local', 'Imagem'], family: 'Stable Diffusion', variant: 'XL Base 1.0', modelId: 'stabilityai/stable-diffusion-xl-base-1.0', tasks: ['imagem'], engine: 'Mecanismo de imagem OrdaX (não homologado)', format: 'safetensors', quantization: 'FP16', artifactSize: null, ram: null, vram: null, gpu: 'necessária', license: 'CreativeML Open RAIL++-M', languages: ['Prompts em inglês'], offline: true, illustrative: true },
  { kind: 'model', id: 'whisper', name: 'Whisper Small', tagline: 'Transcrição de voz', description: 'Reconhecimento de fala multilíngue.', developer: 'OpenAI', tone: 'green', monogram: 'W', tags: ['Local', 'Voz'], family: 'Whisper', variant: 'Small', modelId: 'openai/whisper-small', tasks: ['voz'], engine: 'Mecanismo de voz OrdaX (não homologado)', format: 'GGML', quantization: 'FP16', artifactSize: null, ram: null, vram: null, gpu: 'opcional', license: 'MIT', languages: ['Multilíngue'], offline: true, illustrative: true },
];

export const providers: ProviderItem[] = [
  { kind: 'provider', id: 'openai', name: 'OpenAI', tagline: 'Texto, visão e código', description: 'Serviço externo de modelos de IA.', developer: 'OpenAI', tone: 'green', monogram: 'O', tags: ['Nuvem', 'Texto', 'Visão'], capabilities: ['Texto', 'Visão', 'Código', 'Imagem'], access: ['assinatura', 'credencial de API'], costs: 'Definidos pelo provedor; não exibidos sem integração oficial.', demoConnectable: true, illustrative: true },
  { kind: 'provider', id: 'anthropic', name: 'Anthropic', tagline: 'Texto e análise', description: 'Serviço externo de modelos de IA.', developer: 'Anthropic', tone: 'amber', monogram: 'A', tags: ['Nuvem', 'Texto'], capabilities: ['Texto', 'Visão', 'Código'], access: ['credencial de API'], costs: 'Definidos pelo provedor.', demoConnectable: true, illustrative: true },
  { kind: 'provider', id: 'google', name: 'Google Gemini', tagline: 'Multimodal', description: 'Serviço externo de modelos de IA.', developer: 'Google', tone: 'blue', monogram: 'G', tags: ['Nuvem', 'Multimodal'], capabilities: ['Texto', 'Visão', 'Áudio'], access: ['assinatura', 'credencial de API'], costs: 'Definidos pelo provedor.', demoConnectable: true, illustrative: true },
  { kind: 'provider', id: 'xai', name: 'xAI Grok', tagline: 'Texto e pesquisa', description: 'Serviço externo de modelos de IA.', developer: 'xAI', tone: 'cyan', monogram: 'X', tags: ['Nuvem', 'Texto'], capabilities: ['Texto', 'Pesquisa'], access: ['credencial de API'], costs: 'Definidos pelo provedor.', demoConnectable: false, illustrative: true },
];

export const agents: AgentItem[] = [
  { kind: 'agent', id: 'projects-agent', name: 'Assistente de Projetos', tagline: 'Planeja e organiza tarefas', description: 'Agente que propõe planos e organiza tarefas de projetos, sempre pedindo aprovação.', developer: 'Exemplo OrdaX', tone: 'violet', monogram: 'AP', tags: ['Produtividade'], specialty: 'Gestão de projetos', tasks: ['Quebrar objetivos em etapas', 'Resumir andamento'], models: ['Qualquer modelo de texto autorizado'], tools: ['Projetos (leitura)'], permissions: ['Ler projetos do Space ativo'], examples: ['Planeje o lançamento do app em 4 semanas'], dependencies: ['projects-svc'], illustrative: true },
  { kind: 'agent', id: 'data-agent', name: 'Analista de Dados', tagline: 'Analisa planilhas e gráficos', description: 'Agente para explorar dados tabulares autorizados.', developer: 'Exemplo OrdaX', tone: 'blue', monogram: 'AD', tags: ['Dados'], specialty: 'Análise de dados', tasks: ['Resumir tabelas', 'Sugerir gráficos'], models: ['Modelo de texto com código'], tools: ['Arquivos (leitura)'], permissions: ['Ler arquivos selecionados'], examples: ['Resuma as vendas deste CSV'], dependencies: [], illustrative: true },
  { kind: 'agent', id: 'content-agent', name: 'Assistente de Conteúdo', tagline: 'Criação e revisão de textos', description: 'Agente de escrita com revisão de tom.', developer: 'Exemplo OrdaX', tone: 'pink', monogram: 'AC', tags: ['Criatividade'], specialty: 'Redação', tasks: ['Rascunhar', 'Revisar'], models: ['Modelo de texto'], tools: [], permissions: [], examples: ['Revise este e-mail'], dependencies: [], illustrative: true },
];

export const plugins: PluginItem[] = [
  { kind: 'plugin', id: 'mcp-github', name: 'MCP para GitHub', tagline: 'Ferramentas de repositório', description: 'Interface MCP de ferramentas; não é provedor de inferência.', developer: 'Exemplo', tone: 'violet', monogram: 'GH', tags: ['MCP', 'Dev'], pluginType: 'MCP', version: 'Exemplo', provides: ['Listar issues', 'Ler arquivos do repositório'], compatibleApps: ['Studio', 'Intelligence'], permissions: ['Repositórios autorizados'], illustrative: true },
  { kind: 'plugin', id: 'browser-ext', name: 'Extensão de Navegador', tagline: 'Recursos para o app Internet', description: 'Extensão do aplicativo Internet.', developer: 'Exemplo', tone: 'blue', monogram: 'EN', tags: ['Extensão'], pluginType: 'Extensão de app', version: 'Exemplo', provides: ['Leitor de artigos'], compatibleApps: ['Internet'], permissions: ['Página atual'], illustrative: true },
  { kind: 'plugin', id: 'lint-tools', name: 'Ferramentas de Lint', tagline: 'Qualidade de código no Studio', description: 'Ferramenta para desenvolvedores.', developer: 'Exemplo', tone: 'green', monogram: 'LT', tags: ['Dev'], pluginType: 'Ferramenta dev', version: 'Exemplo', provides: ['Análise estática'], compatibleApps: ['Studio'], permissions: ['Projeto aberto'], illustrative: true },
];

export const connectors: ConnectorItem[] = [
  { kind: 'connector', id: 'github', name: 'GitHub', tagline: 'Repositórios e código', description: 'Integração com repositórios hospedados.', developer: 'GitHub (exemplo)', tone: 'violet', monogram: 'GH', tags: ['Dev', 'Nuvem'], service: 'GitHub', provides: ['Sincronizar repositórios'], permissions: ['Leitura de repositórios escolhidos'], platforms: ['web', 'os'], isMcp: false, illustrative: true },
  { kind: 'connector', id: 'notion', name: 'Notion', tagline: 'Conhecimento e documentos', description: 'Interface de ferramentas via MCP para páginas autorizadas.', developer: 'Notion (exemplo)', tone: 'amber', monogram: 'N', tags: ['MCP', 'Produtividade'], service: 'Notion', provides: ['Buscar páginas', 'Ler conteúdo'], permissions: ['Páginas compartilhadas'], platforms: ['web'], isMcp: true, illustrative: true },
  { kind: 'connector', id: 'dropbox', name: 'Dropbox', tagline: 'Armazenamento em nuvem', description: 'Sincronização de arquivos.', developer: 'Dropbox (exemplo)', tone: 'blue', monogram: 'D', tags: ['Armazenamento'], service: 'Dropbox', provides: ['Listar e baixar arquivos'], permissions: ['Pastas escolhidas'], platforms: ['web', 'os'], isMcp: false, illustrative: true },
  { kind: 'connector', id: 'slack', name: 'Slack', tagline: 'Comunicação de equipe', description: 'Mensagens e canais.', developer: 'Slack (exemplo)', tone: 'pink', monogram: 'SL', tags: ['Comunicação'], service: 'Slack', provides: ['Ler canais autorizados'], permissions: ['Canais selecionados'], platforms: ['web'], isMcp: false, illustrative: true },
];

export const packages: PackageItem[] = [
  { kind: 'package', id: 'aurora', name: 'Tema Aurora', tagline: 'Tema visual premium', description: 'Paleta e papel de parede para o OrdaX.', developer: 'OrdaX Design (exemplo)', tone: 'violet', monogram: 'TA', tags: ['Tema'], packageType: 'Tema', version: 'Exemplo', activation: 'Aplicado pelas Preferências do sistema', illustrative: true },
  { kind: 'package', id: 'pt-pt', name: 'Português (Portugal)', tagline: 'Pacote de idioma', description: 'Traduções da interface.', developer: 'OrdaX (exemplo)', tone: 'green', monogram: 'PT', tags: ['Idioma'], packageType: 'Idioma', version: 'Exemplo', activation: 'Requer reinício da sessão', illustrative: true },
  { kind: 'package', id: 'startup-tpl', name: 'Template Startup', tagline: 'Projeto inicial', description: 'Estrutura de projeto pronta para Studio.', developer: 'OrdaX (exemplo)', tone: 'cyan', monogram: 'TS', tags: ['Template'], packageType: 'Template', version: 'Exemplo', activation: 'Usado ao criar projeto', illustrative: true },
];

export const catalog: StoreItem[] = [...apps, ...models, ...providers, ...agents, ...plugins, ...connectors, ...packages];
export const findItem = (id: string) => catalog.find(i => i.id === id) ?? null;

const norm = (v: string) => v.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export function searchCatalog(query: string, kind: Kind | 'all' = 'all', items: StoreItem[] = catalog): StoreItem[] {
  const q = norm(query.trim());
  return items.filter(i => (kind === 'all' || i.kind === kind) && (!q || norm([i.name, i.tagline, i.developer, ...i.tags].join(' ')).includes(q)));
}

/** Platform labels for apps/connectors; never claims availability. */
export function platformLabel(p: Platform[]): string {
  if (!p.length) return 'Compatibilidade não informada pelo catálogo';
  if (p.includes('device')) return 'Requer computador com Runtime autorizado';
  if (p.includes('web') && p.includes('os')) return 'OrdaX Web e OS';
  return p.includes('web') ? 'OrdaX Web' : 'OrdaX OS nativo';
}

export type Compat = 'compatível' | 'incompatível' | 'não avaliado' | 'desempenho não homologado';
/** Without homologated requirements and a connected device, a model is never declared compatible. */
export function evaluateModel(m: ModelItem, device: { connected: boolean; ramGb?: number }): Compat {
  if (!device.connected) return 'não avaliado';
  if (!m.ram) return 'desempenho não homologado';
  const need = parseFloat(m.ram);
  if (!device.ramGb || Number.isNaN(need)) return 'não avaliado';
  return device.ramGb >= need ? 'compatível' : 'incompatível';
}
