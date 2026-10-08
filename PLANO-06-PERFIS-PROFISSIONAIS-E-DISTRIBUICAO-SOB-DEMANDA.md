# OrdaX — parte 6: Profiles profissionais e distribuição sob demanda

**Estado:** fundação MVP em implementação.  
**Decisão canônica:** o pendrive Stable não carrega todos os Profiles profissionais. Ele carrega o Runtime único, Intelligence, Memory, apps essenciais e um catálogo leve. Conteúdo profissional é provisionado sob demanda e, depois de instalado, deve continuar utilizável offline dentro de suas capacidades locais.

> **Arquitetura cognitiva/RAG:** consultar [`docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md`](docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md). A fundação atual já combina conteúdo Profile Pack e Memory segregada; RAG vetorial operacional e distribuição pública de conhecimento em escala continuam pendentes. O único OrdaX Intelligence atende todos os perfis, sem modelos duplicados ou treinamento por Space.

## 1. Princípio

```text
Profissão é composição.
Runtime é único.
Dados do usuário pertencem ao Space/Memory, não ao Profile.
```

Um Profile profissional é um **Profile Pack versionado aplicado a um Space**. Ele não cria outra conta, outro sistema operacional nem outro runtime.

O Profile pode compor:

- apps;
- templates;
- Knowledge Packs;
- Skill Packs;
- conectores;
- políticas de Intelligence;
- políticas de contexto/memória;
- dependências de componentes.

O Profile solicita capacidades. Runtime e Policy decidem. Usuário autoriza quando necessário.

## 2. O que fica no pendrive inicial

A imagem Stable deve permanecer pequena e previsível:

```text
Stable USB
├── OrdaX Base
├── Surface
├── Intelligence
├── Memory
├── Model Router
├── navegador / arquivos / notas / ajustes / conta / sistema
├── updater / rollback / recovery
└── Profile Catalog leve
```

O catálogo pode conter título, categoria, versão, compatibilidade, disponibilidade e composição declarada. Isso não significa que o payload pesado esteja pré-instalado.

Não colocar na imagem inicial todos os Knowledge Packs, modelos, apps verticais e assets de todos os domínios.

## 3. Distribuição

Há quatro classes distintas:

```text
Profile Pack   -> composição do ambiente profissional
App            -> software executável
Knowledge Pack -> conhecimento versionado/proveniente
Skill Pack     -> workflow/instruções/capacidades cognitivas
```

Model Packs e Connectors permanecem tipos separados quando necessários.

A instalação de um Profile é um **plano de provisionamento**, não um arquivo monolítico:

1. selecionar Profile;
2. validar Space;
3. validar compatibilidade;
4. resolver dependências;
5. identificar o que já está instalado;
6. baixar somente o que falta;
7. verificar hash/assinatura/proveniência;
8. stage;
9. instalar/registrar componentes;
10. health check;
11. ativar;
12. manter rollback/receipt.

Instalar não significa ativar automaticamente.

## 4. Offline-first

Depois de instalado, um Profile deve continuar funcionando offline para tudo que estiver localmente disponível.

- catálogo remoto pode ficar indisponível;
- Profile já instalado continua registrado;
- apps locais continuam funcionando;
- Memory/Space permanecem locais;
- Knowledge Pack local continua consultável;
- recursos que dependem de cloud degradam explicitamente;
- atualização pode esperar a rede voltar.

Nenhuma conexão cloud é requisito para simplesmente abrir um Profile já instalado.

## 5. Dados e atualização

Profile nunca é dono dos dados do usuário.

```text
Space
├── Profile ativo
├── Memory
├── Projects/Objects
├── Documents
└── Settings
```

Atualizar, desativar ou remover um Profile não apaga Memory, documentos, projetos ou objetos do Space.

Knowledge, Skills, apps e modelos são atualizados independentemente. Trocar um Knowledge Pack não exige reinstalar o Profile inteiro. Trocar um modelo não muda a identidade da Memory.

## 6. MVP

O MVP deve provar o mecanismo antes de abrir uma Store pública.

### Já existente

- `ordax.profile-pack/1`;
- runtime de Profile Pack;
- catálogo read-only;
- Spaces;
- entitlements;
- Memory/Context;
- Developer Profile como prova interna;
- Legal-BR draft e fail-closed.

### Implementação desta etapa

- contrato `ordax.profile-provisioning/1`;
- catálogo local de distribuição leve;
- planner que calcula componentes presentes/ausentes por identidade de conteúdo;
- inventário Native persistente e somente leitura para a Surface;
- Web usa inventário de sessão vazio e não finge instalação local;
- mesmo ID com SHA-256 diferente é tratado como ausente/stale;
- download somente do que falta;
- metadados de offline/cache;
- estado installable/blocked explícito;
- nenhum download sem artifact identity + versão + SHA-256 + assinatura exigida;
- Knowledge/Skill possuem proof Ed25519, health estrutural por entrada e proveniência, ainda sem ativação pública;
- stage saudável gera evidence verificável, receipt e inventário Native sob lock;
- ativação local possui estado Native privado `current/previous` por Space, com rollback da composição;
- manifests canônicos são JSON versionados em `system/profile-packs/<slug>/v<version>/manifest.json`, indexados por catálogo bundled leve;
- múltiplas versões do mesmo Profile podem coexistir para atualização/rollback sem sobrescrever o manifest anterior;
- boot Native revalida `current` contra manifest, `spaceKind`, provisioning e receipts; drift entra em `disabled-safe`;
- restore desta etapa é **metadata-only**: nenhuma app, tool, Knowledge ou policy é aplicada automaticamente;
- comando Native de ativação interna exige intenção explícita, token efêmero específico, loopback/same-origin e revisão esperada validada dentro do lock;
- comando revalida o Profile contra catálogo/manifest bundled canônico e continua bloqueado no Stable/MVP;
- nenhum Profile com componentes está promovido para uso real no MVP; a ativação interna só pode prosseguir quando os componentes publicados coincidirem com o manifest canônico, possuírem receipts de provisioning válidos e passarem pela revisão/consentimento Native;
- permission diff é derivado do manifest canônico e pode ser pré-visualizado com digest SHA-256 vinculado a Space/Profile/componentes/revisão;
- o digest impede aceitar uma composição diferente da revisada e não é tratado como prova de gesto humano; quando houver componentes ativáveis, a confirmação explícita ocorre na superfície Native GTK confiável já implementada em Owner/Development;
- autoridade Native one-shot de consentimento existe sem endpoint HTTP: receipt curto, HMAC, TTL, vínculo a digest/revisão/Space/Profile e consumo único; a emissão ocorre somente após aprovação na UI Native GTK confiável, portanto a Surface não consegue autoemitir nem transportar consentimento;
- coordinator Native de apresentação/decisão define requests curtos e one-shot; rejeição é terminal, expiração falha fechado e somente decisão Native aprovada pode pedir à authority que emita receipt;
- host gráfico Native GTK apresenta o permission diff fora do DOM/WebView e responde approve/reject por Unix socket privado 0600;
- manifests versionados são a fonte única da composição do Profile; o catálogo de distribuição mantém somente política de entrega e deriva componentes dos manifests validados;
- o receipt humano não atravessa Surface nem HTTP: o Native control server solicita o diálogo, recebe a decisão, emite o receipt one-shot e o consome internamente antes da mutação;
- o prompt Native confiável reutiliza a preferência persistida `regional.locale` e possui catálogo mínimo próprio apenas para mensagens de segurança (PT-BR, EN-US, ES-ES, DE-DE, FR-FR), com fallback PT-BR; isso não cria uma segunda UI/localização do produto;
- a seleção de “Space em uso” é explícita e separada das áreas visuais do desktop: somente um Space ativo retornado pelo catálogo autenticado pode ser selecionado;
- a seleção local é vinculada ao `subjectId` da conta e persiste somente `subjectId + selectedSpaceId`; troca/logout de identidade não pode herdar o Space de outro usuário;
- o snapshot do catálogo de Spaces também é vinculado ao `subjectId` que o recebeu; uma troca direta de conta reseta/aborta o catálogo anterior e exige nova resposta autenticada, impedindo seleção ou conclusão de refresh com dados stale de outro usuário;
- indisponibilidade temporária do catálogo oculta o Space selecionado sem convertê-lo em autorização; quando o catálogo autenticado volta, a seleção só é restaurada se o mesmo Space continuar ativo e visível;
- Space selecionado é contexto/navegação, não membership, permissão, Profile activation nem fonte de autoridade;
- conteúdo Knowledge/Skill de um Profile ativo possui reader Native read-only que revalida inventário, receipt, slot content-addressed, hash exato e estrutura antes de projetar contexto bounded para Intelligence;
- a ponte de Intelligence é vinculada explicitamente por `spaceId`; ela nunca escolhe/inventa um Space, preserva contexto do consumidor como prioridade e trata Skill como contexto declarativo com `authority=none` e sem tools;
- a composição de Intelligence agora usa o `Space em uso` explicitamente selecionado e validado pela sessão; sem seleção, a Intelligence continua sem conteúdo de Profile, nunca escolhe o primeiro Space nem converte seleção em autorização;
- a mesma seleção pode autorizar contexto de Memory apenas no escopo `space`, com owner igual ao `subjectId` atual, `spaceId` exato e `includeRestricted=false`; sem Space selecionado não há leitura de Memory, e Profile nunca amplia essa autorização;
- esse caminho permanece Owner/Development-only e dormente enquanto não existir componente Profile canônico realmente publicado/instalado/ativado; Stable/MVP continua sem endpoint de Profile content context;
- rollback de Profile nunca rebobina Memory, documentos ou outros dados autoritativos do Space;
- nenhum Profile pode conceder privilégio ao ser provisionado.

### Gate atual real

Os gates de receipt/inventory, executor confiável, health/rollback e UI de catálogo já estão implementados e cobertos por CI/source tests. O próximo gate real é **first-public-profile-proof**, agora concretizado pelos candidatos não regulados `pizzaria-br@1` e `impressao-3d-br@1`, ambos usando a mesma política de ativação segura.

Esse gate continua bloqueado até existir um Profile canônico com componente realmente publicado sob trust anchor canônica, receipt real, instalação/health válidos e revisão de domínio. Chave efêmera de CI, fixture de teste ou payload inventado não satisfaz esse gate.

### Ainda bloqueado

- Store pública;
- instalação arbitrária de terceiros;
- Legal-BR público;
- Knowledge jurídico real sem pipeline de fontes oficiais;
- billing;
- downloads reais de payload sem trust/publicação canônica.

## 7. Perfis iniciais

### Impressão 3D / Fabricação digital

`impressao-3d-br@1` é o segundo Profile demonstrável e reutiliza **o mesmo** boundary
seguro do Profile Pizzaria. Ele não cria um runtime separado e não adiciona payload pesado
ao USB.

Recorte v1:

- Arquivos, Notas, Internet e Projetos já existentes;
- fila de produção;
- pedidos/orçamentos;
- materiais e filamentos;
- perfis de impressão;
- controle de qualidade/falhas;
- manutenção de impressoras;
- clientes/entregas;
- custos e preços;
- Memory restrita ao Space/projeto;
- nenhum slicer, CAD, driver de impressora, conector cloud ou automação privilegiada embutidos nesta etapa.

No pós-MVP, apps/Skills/Connectors podem acrescentar slicer, gestão de farm, estimativa de
material/tempo, monitoramento de impressoras, CAD/3D e integrações. Esses recursos devem
entrar como componentes versionados, não como exceções dentro do Profile.

### Pizzaria / Pequeno negócio de alimentação

O MVP passa a exigir **um Profile comercial demonstrável e não regulado** antes do
fechamento. O primeiro candidato é `pizzaria-br@1`.

Recorte v1:

- usa somente apps first-party já existentes: Arquivos, Notas, Internet e Projetos;
- nenhum componente externo, download, conector ou modelo adicional;
- funciona offline depois de selecionado;
- Memory limitada ao Space/projeto;
- sem shell, privilégios, cross-Space ou provider externo obrigatório;
- catálogo sugere organização para operação diária, pedidos/encomendas, insumos/estoque,
  fornecedores, custos/preços e marketing/promoções;
- não pretende substituir PDV, fiscal, ERP, delivery ou financeiro completo no v1.

O manifesto e o provisioning zero-download podem entrar antes do USB final. Para a
demonstração ao usuário final, porém, o Profile só conta como pronto quando o
Stable/MVP permitir ativar/desativar esse Profile explicitamente em um Space profissional,
mostrar claramente que **Pizzaria** está em uso e passar smoke físico sem ampliar
permissões. Essa promoção é o `first-public-profile-proof`.

### Developer

Serve como prova da composição e pode continuar interno no MVP enquanto apps/capabilities reais são conectados.

O primeiro conteúdo técnico real já possui **source canônico determinístico** em
`system/profile-content-sources/developer-core/v0.1.0/`, com manifest de
Profile content, hashes por entrada e binding a fontes versionadas do próprio
repositório. O componente `knowledge.developer-core@0.1.0` permanece
`planned`, sem publish hash no Profile Pack e sem envelope assinado. Isso
prepara o candidato para a primeira prova pública sem confundir source pronto
com publicação/trust concluídos. A transição para `available` exige artefato
assinado sob a âncora canônica, publicação real, receipt/install/health e revisão
do conteúdo.

### Legal BR / Advocacia Brasil

O catálogo pode conhecer o Profile, mas a ativação pública permanece bloqueada até existir:

- pipeline de fontes oficiais;
- freshness/versionamento;
- citations/proveniência;
- Knowledge Pack assinado;
- validação profissional;
- policy de dados/confidencialidade.

O modelo de IA nunca é fonte jurídica autoritativa.

## 8. Evolução

Depois da prova MVP:

1. promover o reader/bridge já implementado para Knowledge Pack ao uso de produto somente após existir componente canônico realmente publicado, instalado e ativado; Knowledge continua contexto derivado, nunca memória autoritativa;
2. promover o mesmo caminho para Skill Pack declarativo somente com `authority=none`, sem tools e com Space explícito; a ponte de contexto já está implementada;
3. manter a promoção de Profiles com componentes restrita a Owner/Development até existir pelo menos um Profile canônico com componente publicado, receipt real e validação de domínio; a infraestrutura de confirmação humana Native já está fechada ponta a ponta;
4. promover o restore metadata-only para aplicação real de composição somente após trust/policy e health de cada efeito, mantendo Profile não crítico ao boot;
5. Store/catalog remoto assinado;
6. downloads transacionais;
7. Profile Stack com resolução de conflitos pela policy mais restritiva;
8. UI de escolha no primeiro uso/Conta;
9. atualização independente por componente com permission diff;
10. compartilhamento de Spaces;
11. packs adicionais: Comércio, Clínica administrativa, Educação, Creator etc.

## 9. Regras invariantes

- Runtime único.
- Base pequena.
- Profile não concede privilégio.
- Dados sobrevivem à remoção do Profile.
- Download somente após verificação.
- Componentes compartilhados não são duplicados.
- Perfil instalado pode funcionar offline.
- Falha de Profile não impede boot.
- Profile incompatível entra em disabled-safe.
- Nenhum Profile exige reinstalar o pendrive para atualização normal.
- Nenhum domínio regulado ganha autonomia irrestrita da IA.

## 10. Origem da decisão

A referência legada foi consultada diretamente no repositório
`washingtonmsdj/novo-ordax-os`, default branch `main`, snapshot observado no
commit `49fe41fa67d9032f2e349e86592304e64d6c2d88`.

Documentos de referência principais:

- `rfcs/RFC-0009-ordax-profiles.md`;
- `docs/PROFESSIONAL-RUNTIME.md`;
- `docs/STORE-VISION.md`;
- `docs/ECOSYSTEM.md`;
- `docs/ORDAX-CONSTITUTION.md`;
- `docs/USER-JOURNEYS.md`.

Os invariantes reaproveitados são:

- Runtime único;
- Profiles instaláveis, alternáveis e combináveis;
- Adaptive Workspace;
- Profile Stack;
- Store/Package Platform;
- instalação com resolução de dependências;
- stage, health, rollback e receipts;
- Profile solicita capacidades, Runtime/Policy decidem e usuário autoriza;
- remover Profile não apaga automaticamente objetos do usuário.

O runtime legado não é copiado. Os conceitos são reimplementados sobre os contratos atuais do
`prototipo-ordax-os`, com USB-only MVP, component slots, assinatura, Spaces,
Memory e Intelligence provider-neutral.


## Interface de Spaces e Profiles — contrato visual MVP

A Surface possui **um seletor de Space na barra de sistema** (`system/surface/ui/space-switcher-controls.mjs`) e apresenta cartões de Spaces e Profile Packs no aplicativo Conta. O seletor de Space consome exclusivamente os contratos canônicos `ordax.spaces/1`, `ordax.space-selection/1` e a sessão de identidade existente. Ele não cria uma identidade, organização, Space ou plano de instalação paralelo.

- **Native:** seleciona somente um Space ativo, visível no catálogo autenticado para o `subjectId` atual; a seleção é persistida exclusivamente pela implementação canônica.
- **Web:** exibe contexto e catálogo quando disponíveis, mas não finge capacidade de seleção Native ausente.
- **Troca de conta/catálogo:** o seletor não exibe dados antigos quando o sujeito muda, a resposta do catálogo está pendente ou o Space deixa de estar visível.
- **Gerenciar espaços:** abre o aplicativo Conta na seção Spaces pelo canal de ativação já existente.
- **Perfis profissionais:** o grid usa somente planos retornados pelo provisionamento e o estado de ativação Native, sem pedidos, faturamento, estoque ou permissões fictícios.
- **Criar/renomear/remover Spaces:** não são expostos porque o port da Surface permanece read-only e as mutações têm de ser autorizadas pelo backend canônico antes de existir UI de criação.
- **Estética:** a própria Surface mantém tokens, contraste, localização, foco visível, navegação por teclado, modo responsivo e movimento reduzido. Um Profile é composição do Space, não tema independente nem fork do OS.

A integração visual não promove um Profile bloqueado à distribuição pública. Permanecem gates independentes de ativação de componentes, prova física e pacote assinado. A priorização futura é: autorização server-side para criação de Space → assistente nativo de criação → personalização de preferências no escopo correto → bibliotecas de aplicativos profissionais sem duplicar a Store.

