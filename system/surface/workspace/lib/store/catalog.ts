import * as runtime from './catalog.mjs';
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

export type Compat = 'compatível' | 'incompatível' | 'não avaliado' | 'desempenho não homologado';

// Typed facade; all runtime data and behavior live in the shared browser module.
export const kindMeta = runtime.kindMeta as Record<Kind, { label: string; plural: string; verb: 'Instalar' | 'Conectar' | 'Habilitar' | 'Aplicar' }>;
export const apps = runtime.apps as AppItem[];
export const models = runtime.models as ModelItem[];
export const providers = runtime.providers as ProviderItem[];
export const agents = runtime.agents as AgentItem[];
export const plugins = runtime.plugins as PluginItem[];
export const connectors = runtime.connectors as ConnectorItem[];
export const packages = runtime.packages as PackageItem[];
export const catalog = runtime.catalog as StoreItem[];
export const findItem = runtime.findItem as (id: string) => StoreItem | null;
export const searchCatalog = runtime.searchCatalog as (query: string, kind?: Kind | 'all', items?: StoreItem[]) => StoreItem[];
export const platformLabel = runtime.platformLabel as (platforms: Platform[]) => string;
export const evaluateModel = runtime.evaluateModel as (model: ModelItem, device: {connected: boolean; ramGb?: number}) => Compat;
