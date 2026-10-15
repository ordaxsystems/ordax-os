# ACHEGUESE-002 — Space privado de desenvolvimento do Achegue-se no OrdaX

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION
- **Prioridade:** P1
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** Spaces/Projects/Identity do OrdaX para workspace; repositório e owners próprios do Achegue-se para produto/código; ACHEGUESE-001 para integração first-party entre os produtos
- **Base factual:** `docs/SPACES-AND-PROFILES.md`, `00-PLANOS-PRIORITARIOS/plans/ACHEGUESE-001-FIRST-PARTY-PRODUCT-INTEGRATION.md`, `00-PLANOS-PRIORITARIOS/plans/IDENTITY-001-SPACE-MEMBERS-INVITES-AND-ACCESS.md`, Owner/Development workflow do OrdaX e repositório `washingtonmsdj/acheguese`
- **Relatórios de apoio:** análise atual da vertical Gastronomia do Achegue-se e sua futura boundary com OrdaX Food/Commerce
- **Dependências:** Spaces funcional, Projects/Files funcional, identidade e autorização do owner, Git/provider access autorizado; IDENTITY-001 somente quando houver colaboração; ACHEGUESE-001 somente para integração de produto, não para o workspace de desenvolvimento

`READY` descreve maturidade documental. Não autoriza implementação. A criação real do Space deve respeitar a janela de execução vigente e os owners canônicos do OrdaX.

## Problema

O Achegue-se é um produto separado, com repositório, dados, deploy, arquitetura e roadmap próprios. Hoje o trabalho sobre ele pode acontecer fora do contexto do OrdaX, o que reduz o dogfooding da própria plataforma e espalha contexto de desenvolvimento entre chats, arquivos, repositório, deploys e ferramentas.

Ao mesmo tempo, transformar o Achegue-se em um Profile público do OrdaX ou copiar seu código para dentro de `ordax-os` seria arquiteturalmente errado. O objetivo é permitir que o próprio OrdaX seja usado como ambiente de trabalho para desenvolver e operar o projeto Achegue-se sem fundir os produtos.

## Objetivo

Criar, quando a infraestrutura corrente permitir, um **Space privado de desenvolvimento** chamado conceitualmente:

```text
Achegue-se — Desenvolvimento
```

Esse Space pertence inicialmente ao owner/desenvolvedor e funciona como workspace do projeto:

```text
Space Achegue-se — Desenvolvimento
├── projeto/repositório Achegue-se
├── documentação e planos
├── tarefas/issues/PRs
├── ambientes e deploys autorizados
├── arquivos/evidências
├── contexto técnico da Intelligence
├── ferramentas de desenvolvimento autorizadas
└── integrações externas por capability/connector
```

O Space não é o Achegue-se em si. Ele é o **contexto privado no OrdaX usado para trabalhar no produto Achegue-se**.

## Decisão principal

Sim, o OrdaX deve poder ser usado para trabalhar no próprio Achegue-se.

A relação correta é:

```text
OrdaX Space privado
        |
        | workspace / tools / context / authorization
        v
repositório e serviços do Achegue-se
```

Não:

```text
Achegue-se copiado para dentro do ordax-os
```

nem:

```text
Space = banco/SSOT do Achegue-se
```

nem:

```text
Profile público Achegue-se obrigatório para usuários
```

## Escopo inicial: owner-only

A primeira forma recomendada é **privada e somente para o desenvolvedor/owner**.

Exemplo conceitual:

```text
Space: Achegue-se — Desenvolvimento
visibility: private
owner: conta do desenvolvedor
members: somente owner
```

Motivos:

- reduz superfície de permissão enquanto o fluxo ainda é provado;
- evita publicar uma composição interna como produto para usuários;
- permite dogfooding real do OrdaX;
- facilita organizar repo, deploy, docs e memória contextual;
- torna a futura colaboração uma evolução de membership, não uma reconstrução do Space.

## Colaboração futura

Depois que `IDENTITY-001`/membership estiverem maduros, o mesmo Space pode receber membros explicitamente:

```text
owner
admin
member
viewer
```

Atribuir alguém ao projeto deve signific **adicionar membership ao Space com role/capabilities apropriadas**, não transferir automaticamente ownership nem conceder acesso ao repositório, produção ou segredos por associação implícita.

Acesso externo continua condicionado às permissões reais de GitHub, Cloudflare, Vercel, Supabase ou qualquer outro provider. Membership no Space não cria credenciais externas magicamente.

Transferência de ownership do Space, quando suportada, deve seguir IDENTITY-001 e gerar audit/consent explícitos.

## Space versus Profile Pack

Não criar agora `acheguese@1` ou `acheguese-dev@1` como Profile Pack público apenas para este caso.

Um projeto específico pode existir como Space privado sem virar template distribuível.

Regra:

```text
um projeto privado específico
-> Space

uma composição reutilizável para vários Spaces equivalentes
-> Profile Pack, somente se houver caso real
```

Se futuramente vários produtos internos precisarem da mesma composição de desenvolvimento, criar um Profile Pack genérico do tipo `product-development`/`software-project` pode fazer sentido. O Achegue-se consumiria esse template sem ganhar um Profile exclusivo desnecessário.

## O que o Space deve organizar

### 1. Projeto e código

- referência ao repositório `washingtonmsdj/acheguese`;
- branch/commit corrente;
- issues e pull requests quando o provider estiver autorizado;
- status de working tree quando executado em device/runtime autorizado;
- comandos de build/test somente através de capability compatível;
- histórico/evidências de mudanças sem substituir Git como SSOT de código.

### 2. Documentação e arquitetura

- acesso rápido aos documentos canônicos do Achegue-se;
- planos ativos e decisões relevantes;
- arquitetura dos módulos;
- contratos e migrations;
- contexto específico de frentes como Gastronomia, Empresas, Mapa e Perto de mim;
- links para ACHEGUESE-001 quando a mudança envolver integração com OrdaX.

A Memory/Intelligence pode ajudar a recuperar contexto, mas nunca substitui source, contratos ou documentação canônica.

### 3. Desenvolvimento

O Space pode agregar as capabilities disponíveis no runtime corrente, por exemplo:

- Files/Projects;
- Git/GitHub autorizado;
- terminal/processos no device quando permitido;
- preview/local server;
- navegador/pesquisa quando permitido;
- integração de deploy/provider via connectors oficiais;
- logs e testes;
- Intelligence/Aura para análise e execução assistida.

Os nomes finais de apps/capabilities devem seguir o source real no momento da implementação; este plano não inventa um segundo Developer Runtime.

### 4. Ambientes

O Space deve distinguir explicitamente:

```text
local/dev
preview/staging
production
```

Regras:

- produção nunca é inferida pelo nome de uma branch;
- nenhuma secret fica gravada em Memory, Notes ou manifest do Space;
- deploy destrutivo exige authority real do provider e política aplicável;
- previews não podem ser tratados como produção;
- logs/evidências devem registrar alvo e receipt sem expor segredo.

### 5. Tarefas e continuidade

O Space deve permitir que um novo chat/agente recupere rapidamente:

- objetivo atual;
- repo correto;
- docs relevantes;
- branches/PRs ativos;
- testes pendentes;
- ambiente alvo;
- decisões já tomadas;
- blockers reais.

Isso reduz a dependência de prompts enormes e ajuda o OrdaX a funcionar como workspace persistente do projeto.

## Relação com ACHEGUESE-001

`ACHEGUESE-001` e `ACHEGUESE-002` possuem responsabilidades diferentes.

### ACHEGUESE-001

Integra **produto Achegue-se ↔ plataforma OrdaX** para usuários/empresas por OAuth/API/events/projections e, futuramente, Orders/provider boundaries.

### ACHEGUESE-002

Usa **OrdaX como workspace privado para desenvolver o Achegue-se**.

Portanto:

```text
ACHEGUESE-002 pode existir sem runtime público de ACHEGUESE-001
```

Um desenvolvedor pode trabalhar no repo pelo Space mesmo com a integração pública completamente desligada.

## Relação com Gastronomia e OrdaX Food

O Space de desenvolvimento é especialmente útil para a retomada futura de Gastronomia porque permite manter no mesmo contexto de projeto:

- source atual do módulo Gastronomia;
- owners `core/business`;
- dívida de boundaries de Orders/Payments;
- ACHEGUESE-001;
- FOOD-001;
- testes e migrations do Achegue-se.

Mas o Space não deve fundir as responsabilidades.

Direção preservada:

```text
Achegue-se Gastronomia
= descoberta pública + página + catálogo/cardápio + jornada do consumidor

Order/Commerce boundary
= transação provider-neutral quando promovida

OrdaX Food / POS provider
= operação interna quando escolhido pelo merchant
```

## Não objetivos

- mover o repositório Achegue-se para `ordax-os`;
- transformar Achegue-se em app obrigatório do sistema;
- criar Profile Pack público só para o owner;
- dar acesso de produção automaticamente a membros do Space;
- armazenar tokens, passwords ou service-role secrets na Memory;
- compartilhar banco de dados entre OrdaX e Achegue-se;
- tornar o Space um novo SSOT de issues, Git, deploy ou dados do produto;
- ativar Gastronomia ou qualquer módulo pausado apenas por existir o Space;
- abrir execução de ACHEGUESE-001 automaticamente.

## Estado atual verificado

### Já existe

- arquitetura de Spaces no OrdaX;
- Account/Space como contexto de isolamento;
- Projects/Files como capacidades reutilizáveis na direção atual do produto;
- Owner/Development workflow do OrdaX;
- conectividade Git/GitHub e ferramentas externas em ambientes de desenvolvimento já usadas pelo projeto;
- `ACHEGUESE-001` documentando a integração first-party entre os produtos;
- repositório Achegue-se independente e funcional como fonte própria de código.

### Parcial

- experiência do OrdaX como workspace de desenvolvimento ainda depende da maturidade real das capabilities disponíveis no runtime usado;
- membership/roles avançados estão cobertos por IDENTITY-001, mas não devem ser presumidos como totalmente promovidos;
- integração de providers precisa respeitar conectores/capabilities realmente disponíveis.

### Ausente/não provado

- Space real `Achegue-se — Desenvolvimento` provisionado na experiência final;
- contract/manifest específico de project binding, caso seja necessário;
- fluxo UX consolidado de `Adicionar projeto existente` ao Space;
- política final de compartilhamento de um workspace de desenvolvimento com equipe;
- handoff automático completo entre chats/agentes baseado no estado do Space.

## Modelo de dados conceitual

Não é contrato final, mas o mínimo sem hardcode seria equivalente a:

```text
Space
  id
  kind = project/workspace
  visibility = private
  owner_account_id

ProjectBinding
  space_id
  provider = github
  repository = washingtonmsdj/acheguese
  default_branch = main
  environment bindings[]

SpaceMembership
  account_id
  role
  capabilities[]

ProviderConnection
  account/space scope
  provider
  authorization reference
```

Credenciais ficam no owner especializado de secrets/connection do provider, nunca dentro de `ProjectBinding` ou Memory.

## UX proposta

### Criação inicial

```text
Espaços
 -> Criar novo espaço
 -> Projeto / Desenvolvimento
 -> Vincular projeto existente
 -> GitHub
 -> washingtonmsdj/acheguese
 -> nome: Achegue-se — Desenvolvimento
 -> Privado
 -> Criar
```

Se a UI de tipo `Projeto / Desenvolvimento` ainda não existir, não criar uma tela exclusiva hardcoded para Achegue-se; primeiro usar/completar a capability genérica adequada.

### Tela do Space

A navegação contextual pode incluir, conforme apps/capabilities realmente disponíveis:

```text
Visão geral
Código / Projeto
Tarefas
Arquivos
Documentação
Ambientes
Deploys
Testes
Logs
Intelligence
Configurações
Membros
```

`Membros` aparece somente quando collaboration/membership estiver efetivamente suportado.

### Dashboard útil

O primeiro dashboard não precisa virar um IDE completo. Deve responder rapidamente:

- qual branch/commit está em foco?;
- existe PR ativo?;
- quais testes estão falhando?;
- qual deploy/preview está ligado ao trabalho?;
- qual a tarefa corrente?;
- quais docs/owners governam a frente?;
- há mudanças não publicadas?;
- qual próximo gate?

## Segurança e isolamento

- Space privado por padrão;
- least privilege por provider;
- secrets nunca serializados em contexto conversacional;
- produção requer autorização separada quando o provider exigir;
- audit de ações mutáveis;
- nenhum membro herda acesso de provider apenas por membership;
- device commands passam pelos owners/capabilities existentes do OrdaX;
- paths externos nunca são presumidos; devem ser resolvidos pelo runtime autorizado;
- contexto de outro Space não pode vazar para o Space Achegue-se.

## Fases

### Fase 0 — validação arquitetural

- revalidar Spaces/Projects atuais;
- confirmar como project/repository bindings devem ser representados sem criar owner paralelo;
- verificar quais capabilities Git/device/provider estão realmente disponíveis;
- manter ACHEGUESE-001 separado.

### Fase 1 — owner-only workspace

- criar Space privado;
- vincular o repositório Achegue-se;
- expor Files/Projects/docs/contexto autorizados;
- permitir build/test/preview somente pelas capabilities existentes;
- provar que nenhuma credencial é copiada para o Space.

### Fase 2 — continuidade de desenvolvimento

- status de repo/branch/PR/testes;
- contexto persistente do projeto;
- handoff entre sessões/chats;
- links para docs e planos relevantes;
- ambientes claramente rotulados.

### Fase 3 — colaboração

Somente após IDENTITY-001/owners correspondentes:

- invite;
- accept;
- roles;
- revoke;
- audit;
- capability binding por membro;
- eventual ownership transfer explícito.

### Fase 4 — first-party/product integration

Somente via ACHEGUESE-001:

- OAuth/linking real;
- projections;
- publish;
- futuras boundaries de pedidos;
- nunca usar o workspace de desenvolvimento como atalho para integração de produção.

## Gates de aceite

- repo Achegue-se continua separado de `ordax-os`;
- Space privado pode existir sem ACHEGUESE-001 público habilitado;
- owner inicial é único/explicito;
- adicionar membro não entrega segredo ou permissão externa automaticamente;
- remover membro corta acesso do Space sem apagar o repo/provider externo;
- disconnect do Git/provider não apaga código remoto;
- Memory não contém segredo;
- build/test/deploy sempre mostra alvo real;
- produção não é confundida com preview;
- um novo chat/agente consegue identificar projeto, owner, repo e tarefa sem depender de prompt manual gigante;
- nenhuma capability específica do Achegue-se é hardcoded no core quando uma abstração genérica serve.

## Custos/limites

O Space deve reutilizar capacidades já contratadas/conectadas. Não requer VPS ou banco novo apenas para existir como workspace. Custos de providers externos continuam pertencendo aos respectivos serviços e só devem ser apresentados quando houver dados medidos e atuais.

## Testes/evidências

Quando a execução for autorizada:

- criar Space owner-only;
- conectar/desconectar repo sem perda de dados;
- leitura correta de branch/commit;
- build/test em runtime autorizado;
- deny para provider sem grant;
- deny para membro sem capability;
- invite/revoke quando colaboração estiver promovida;
- teste de isolamento entre dois Spaces;
- teste de ausência de secrets em logs/context/Memory;
- handoff entre duas sessões apontando o mesmo estado canônico do projeto.

## Rollback/degradação

Se integrações do workspace falharem:

- o repositório remoto continua íntegro;
- o Achegue-se continua desenvolvível fora do OrdaX;
- remover/desconectar o Space não remove projeto externo;
- falha de Intelligence não impede Git/build/test básicos quando suas capabilities estiverem disponíveis;
- ACHEGUESE-001 permanece independente.

## Próxima ação documental

Manter este plano sincronizado com a evolução real de Spaces/Projects/Identity e atualizar somente quando houver owner/capability comprovado. Não criar um Profile Pack exclusivo do Achegue-se antes de haver necessidade reutilizável demonstrada.

## Próxima ação de execução

**DEFERRED.** Quando a janela pós-MVP permitir e Spaces/Projects estiverem aptos, o primeiro slice deve ser apenas o Space privado owner-only vinculado ao repositório Achegue-se, sem colaboração e sem integração pública de produto.

## Handoff para outro chat/agente

Retomar este plano somente após verificar `00-PLANOS-PRIORITARIOS/ROADMAP.md`, `REGISTRY.md`, `docs/SPACES-AND-PROFILES.md`, o estado real de Projects/Files/Identity e `ACHEGUESE-001`. A primeira prova deve ser genérica e não destrutiva: um Space privado do owner usado para trabalhar no repositório `washingtonmsdj/acheguese`. Não criar `acheguese-dev@1`, não mover o repo e não habilitar integração pública por conveniência.
