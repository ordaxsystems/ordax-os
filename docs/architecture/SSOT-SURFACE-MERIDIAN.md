# SSOT transversal — Surface, Meridian, First Run, Web e Site

## Objetivo

Consolidar a arquitetura do OrdaX OS para que cada conceito tenha um único owner canônico, consumido pelas superfícies Native, Web e Site sem cópia de regras, identidade, fluxo, texto de domínio ou contratos.

SSOT aqui não significa apenas design. Significa uma única fonte de verdade para identidade, contratos, estado, capabilities, navegação, first-run, preferências, i18n, tokens visuais, componentes, rotas e evidências.

## Regra de autoridade

- `main` é a única source authority do produto.
- branches Meridian/first-run existentes são fontes de implementação e evidência, nunca autoridades paralelas.
- conteúdo útil dessas branches deve ser absorvido por owners canônicos atuais antes de sua remoção.
- Native, Web e Site podem ter adaptações de composição, mas não redefinem domínio.

## Mapa de owners

### 1. Identidade e destinos da Surface

Owner: `system/services/surface/destination-catalog.mjs`.

Responsável por IDs estáveis, nomes canônicos, aliases de janela e identidade de destinos. Ícones, layout e geometria permanecem em apresentação.

Consumidores: Central, favoritos, launcher, busca, dock, Web composition e futuras superfícies.

### 2. First Run / boas-vindas

Owner de contrato: `docs/contracts/first-run.json` + contrato executável correspondente em `system/contracts/`.

Fluxo canônico do MVP:

1. Bem-vindo;
2. Idioma, teclado e região;
3. Rede, com possibilidade de pular;
4. Conta OrdaX: entrar, criar ou continuar sem conta;
5. Privacidade;
6. Nome do dispositivo;
7. conclusão e entrega para a sessão.

A UI não pode inventar ordem, obrigatoriedade, defaults, capabilities ou regras de persistência. Native e Web compõem a mesma jornada sobre adapters diferentes.

### 3. Preferências

Owners: `system/services/preferences/` e contratos em `system/contracts/`.

Preferências definem IDs, schema, defaults e validação. UI apenas apresenta. Adapters persistem. Nenhum componente mantém defaults paralelos.

### 4. Identidade/Conta/Spaces

Owners de domínio e contratos existentes em `system/contracts/`, `system/services/` e control-plane correspondente.

Surface, Web e Site reutilizam a mesma semântica de identidade. O Site pode ter cópia editorial própria apenas quando for conteúdo de marketing, não quando representar estado ou regra da Conta OrdaX.

### 5. Capacidades e disponibilidade

Disponibilidade de serviços deve vir de capabilities/estado observável, não de strings hardcoded espalhadas em componentes.

Exemplos: projetos, arquivos, dispositivos, armazenamento, inteligência, rede, conta e Spaces.

UI pode traduzir o estado em mensagem, mas não decidir sozinha se uma capacidade existe.

### 6. Navegação e rotas

Destino e identidade são canônicos. Cada host pode mapear para uma rota/apresentação específica, mas aliases e significado não podem divergir.

### 7. i18n

Owner: `system/services/i18n/catalog/` e serviços relacionados.

Textos de produto e jornada devem usar IDs estáveis. Catálogos podem ser separados por domínio para reduzir carregamento, mas sem duplicar tradução. Site mantém catálogo próprio apenas para conteúdo editorial público que não seja mensagem canônica do produto.

### 8. Meridian visual

Owners canônicos devem separar:

- tokens: cor, espaçamento, tipografia, radius, elevação, breakpoints e motion;
- primitives: controles e containers reutilizáveis;
- compositions: Central, janelas, first-run, dialogs e system screens;
- host adapters: diferenças inevitáveis entre Native/Web/Site.

`docs/design/MERIDIAN-VISUAL-SYSTEM.md` das branches históricas deve ser tratado como material de migração até seu conteúdo ser absorvido em owners e contratos atuais.

Nenhuma branch de design vira dependência de runtime.

### 9. Estado e persistência

Estado de janela, first-run, preferências, sessão e device identity devem possuir contrato explícito e owner único. Componentes não criam storage keys ou formatos próprios.

### 10. Evidência e testes

Cada SSOT deve possuir gate que prove:

- IDs únicos;
- nenhum catálogo paralelo autorizado;
- adapters não redefinem defaults;
- aliases resolvem para uma identidade canônica;
- UI não redefine ordem/regra do first-run;
- Native e Web consomem os mesmos contratos quando representam o mesmo domínio;
- Site não copia regra de produto para conteúdo estático;
- branches históricas não permanecem como dependência após absorção.

## Branches Meridian existentes

Materiais identificados:

- `codex/meridian-design-lab`;
- `feat/meridian-system-screens`;
- `feat/first-run-meridian-launch`.

Essas branches estão divergentes da `main`. A migração deve ser seletiva: comparar, extrair conceitos/implementações válidos, adaptar aos owners atuais, testar e integrar por PR. Não fazer merge bruto nem cherry-pick de grandes blocos sem reconciliação arquitetural.

## Ordem de limpeza

1. identidade/destinos da Surface;
2. navegação e window identity;
3. capabilities/disponibilidade;
4. first-run contract e state machine;
5. preferências e persistência;
6. i18n por domínio;
7. Meridian tokens/primitives;
8. Central/Desktop/Windows;
9. Web composition;
10. Site apenas onde compartilha semântica real de produto;
11. remoção das branches históricas quando todo material útil estiver absorvido.

## Regra anti-duplicidade

Uma abstração só vira SSOT quando há uma responsabilidade clara e consumidores reais. Não criar `shared`, `common`, wrappers ou catálogos genéricos apenas para mover duplicidade de lugar.

Para cada refactor:

1. identificar duas ou mais definições da mesma verdade;
2. escolher o owner pelo domínio, não pela conveniência de import;
3. migrar consumidores;
4. adicionar teste que proíba a duplicação de voltar;
5. remover definição antiga no mesmo incremento quando seguro.

## Limites desta trilha

A limpeza da Surface não altera kernel, Buildroot, boot chain, autorização de escrita física nem release authority. Mudanças nesses owners seguem seus gates próprios.
