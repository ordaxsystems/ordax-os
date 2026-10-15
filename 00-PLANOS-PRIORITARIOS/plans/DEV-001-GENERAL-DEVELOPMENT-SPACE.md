# DEV-001 — Space geral de Desenvolvimento

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION
- **Prioridade:** P1
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** Spaces + Projects + Studio + Identity/Policy do OrdaX
- **Base factual:** `docs/SPACES-AND-PROFILES.md`, Owner/Development workflow, OrdaX Studio, Projects/Files e IDENTITY-001
- **Relatórios de apoio:** direção de dogfooding com Achegue-se, STLForge e demais produtos
- **Dependências:** fechamento do MVP; MODE-001 para runtimes Web/Cloud/Device quando necessário; IDENTITY-001 para colaboração; connectors/providers autorizados para Git/CI/deploy

`READY` descreve maturidade documental. Não autoriza implementação. O Space de Desenvolvimento é horizontal e não deve ser confundido com o Studio nem com um produto específico.

## Problema

Projetos de software como Achegue-se, STLForge, sites, apps, Workers, APIs e outros produtos precisam de um contexto persistente no OrdaX. Criar um Space exclusivo de desenvolvimento para cada produto como regra tornaria Spaces excessivamente fragmentados e confundiria produto operacional com workspace técnico.

Ao mesmo tempo, o OrdaX Studio já existe como ferramenta de desenvolvimento. Portanto o Studio não deve ser reinventado como Space.

## Objetivo

Criar um **Space geral de Desenvolvimento** que possa conter múltiplos projetos e usar o Studio e outras ferramentas como apps/capabilities dentro desse contexto.

```text
Space Desenvolvimento
├── Projetos
│   ├── Achegue-se
│   ├── STLForge
│   ├── OrdaX Site
│   └── outros
├── Studio
├── Git / GitHub
├── Arquivos
├── Tarefas
├── Issues / Pull Requests
├── Testes / CI
├── Ambientes
├── Deploys
├── Logs
├── Documentação
└── Aura / Intelligence
```

Regra central:

```text
Space = contexto persistente de trabalho
Studio = ferramenta de desenvolvimento
Projeto = unidade de software trabalhada dentro do Space
```

## Não objetivos

- transformar Studio em Space;
- criar um Profile Pack exclusivo para cada repositório;
- mover repositórios para dentro de `ordax-os`;
- tornar o Space o SSOT de Git, CI ou deploy;
- dar acesso automático a providers por membership;
- armazenar secrets em Memory, Notes, manifest ou ProjectBinding;
- obrigar todos os projetos a compartilharem permissões quando houver necessidade de isolamento.

## Modelo de produto

### Space Desenvolvimento

É um ambiente privado, inicialmente adequado ao owner/desenvolvedor. Ele agrupa contexto técnico, ferramentas e projetos.

### Projeto

Cada projeto mantém identidade própria:

```text
Project
- nome
- repository/provider binding
- branch/default ref
- docs
- tarefas
- ambientes
- CI/deploy bindings
- arquivos/evidências
- contexto autorizado da Intelligence
```

Git continua sendo o SSOT do código. O provider correspondente continua sendo autoridade de PRs, CI, deploys e permissões externas.

### Studio

Studio é aberto no contexto de um projeto:

```text
Space Desenvolvimento
 -> Projeto Achegue-se
 -> Abrir no Studio
 -> repo/branch/docs/contexto já resolvidos
```

O mesmo Studio pode ser usado em qualquer projeto compatível.

## UX proposta

### Home do Space

A tela principal deve destacar projetos, atividade e saúde do workspace, não um único repositório.

Exemplo:

```text
Desenvolvimento

Projetos recentes
- Achegue-se       main       CI verde
- STLForge         main       2 PRs
- OrdaX Site       main       preview ativo

Aura
- 2 projetos possuem testes falhando
- 3 PRs aguardam revisão
- Achegue-se tem deploy de preview pronto
```

### Dentro de um projeto

```text
Resumo
Código
Tarefas
Issues
Pull Requests
Testes / CI
Ambientes
Deploys
Logs
Documentação
Arquivos
Aura
Configurações
```

### Ações rápidas

- Abrir no Studio;
- executar testes autorizados;
- abrir preview;
- ver PRs;
- abrir documentação;
- trocar branch/ref;
- abrir operação do produto quando existir Space operacional vinculado.

## Aura / Intelligence

Aura deve ser visível no dashboard e contextual ao projeto, não apenas um item escondido na navegação.

Exemplos:

```text
Aura — Desenvolvimento

- O PR #182 altera autenticação e ainda não tem teste E2E.
- O preview do Achegue-se está 2 commits atrás da main.
- Existem 4 issues marcadas como blocker.
- Posso resumir as mudanças desde o último deploy.
```

Aura pode analisar e sugerir ações dentro das permissões disponíveis, mas não deve realizar deploy destrutivo, merge, alteração de secret ou mudança de produção sem authority/consentimento exigidos pelo owner correspondente.

## Colaboração e isolamento

Inicialmente, um Space Desenvolvimento owner-only atende bem ao dogfooding.

Quando houver equipe, existem dois níveis possíveis:

1. membership do Space;
2. grants por projeto/capability, quando o modelo estiver formalmente suportado.

Regra de segurança:

```text
membership no Space
!=
acesso automático a todos os repositórios/providers
```

Se project-level grants ainda não existirem e um colaborador não puder conhecer os demais projetos, o projeto deve usar um Space separado até existir isolamento correto. Não criar bypass por conveniência.

## Relação com Spaces operacionais

Um produto pode ter um Space operacional separado do Development Space.

Exemplo:

```text
Space Desenvolvimento
 -> Projeto Achegue-se
      <-> vínculo lógico
Space Achegue-se
 -> operação do produto
```

No projeto:

> Abrir operação do produto

No Space operacional:

> Desenvolver produto

O vínculo nunca funde SSOTs.

## Estado atual verificado

### Já existe

- arquitetura de Spaces;
- Projects/Files como direção reutilizável;
- OrdaX Studio e workflow Owner/Development;
- integrações Git/GitHub usadas no desenvolvimento;
- Identity/Space membership base;
- Intelligence/Aura como capacidade transversal.

### Parcial

- project binding e handoff contextual ainda precisam ser reconciliados com o source vigente;
- colaboração granular depende de IDENTITY-001/capabilities reais;
- CI/deploy/provider access depende das conexões disponíveis.

### Ausente/não provado

- UX final do Space Desenvolvimento;
- ProjectBinding canônico se realmente necessário;
- grants por projeto dentro de um mesmo Space;
- deep link oficial `Abrir no Studio` com contexto completo;
- vínculo genérico entre projeto técnico e Space operacional.

## Modelo conceitual mínimo

```text
DevelopmentSpace
  -> Projects[]

ProjectBinding
  project_id
  provider
  repository/reference
  environments[]
  operational_space_id?   # referência lógica, não FK cross-product

ProviderConnection
  provider
  authorization reference
  scope
```

Isso é apenas direção de produto; contratos finais devem nascer dos owners atuais, não deste documento.

## Fases

### Fase 0 — revalidar owners

- auditar Projects/Files/Studio atuais;
- evitar duplicar Developer Runtime;
- definir boundary de project binding;
- confirmar security model de provider connections.

### Fase 1 — owner-only

- criar Space Desenvolvimento privado;
- adicionar projetos existentes;
- abrir projeto no Studio;
- mostrar docs/tarefas/estado básico;
- Aura contextual por projeto.

### Fase 2 — ambientes e continuidade

- CI/testes;
- previews;
- deploy status;
- logs;
- handoff entre sessões;
- histórico de contexto sem substituir source/receipts.

### Fase 3 — colaboração

- membership;
- project grants se owner canônico suportar;
- revoke/audit;
- provider permissions independentes.

### Fase 4 — vínculos operacionais

- project ↔ operational Space;
- abrir operação a partir do projeto;
- abrir projeto/Studio a partir da operação;
- nenhum dado operacional privado copiado para o workspace sem contrato explícito.

## Gates de aceite

- Studio continua ferramenta, não novo Space owner;
- um Space pode conter vários projetos sem misturar seus SSOTs;
- Git/CI/deploy continuam provider-owned;
- secrets não entram em Memory/manifest;
- member não recebe provider access automaticamente;
- projeto pode ser isolado em outro Space quando necessário;
- Aura respeita capabilities e confirma ações sensíveis;
- vínculo com Space operacional é navegacional/contratual, não dual-write.

## Segurança/privacidade

- private by default;
- least privilege;
- secrets fora de Memory/contexto persistente comum;
- audit para mutações relevantes;
- produção separada de preview/dev;
- project grants fail-closed quando ausentes;
- nenhum cross-Space data leak.

## Próxima ação documental

Reconciliar este plano com a implementação real de Projects/Studio quando a janela pós-MVP abrir e substituir qualquer proposta anterior de `Space <produto> — Desenvolvimento` como regra geral.

## Próxima ação de execução

`DEFERRED`.
