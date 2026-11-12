# REL-001 — Relações externas, portais e acesso limitado a Spaces

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION
- **Prioridade:** P1
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** Account/Spaces authorization + owners de domínio que possuem a relação real
- **Base factual:** `docs/SPACES-AND-PROFILES.md`, Spaces/Identity contracts, Product Modes, Notifications e boundaries server-authoritative atuais
- **Relatórios de apoio:** IDENTITY-001; FOOD-001; FAB-001
- **Dependências:** Account/session, Web/Mobile, Notifications, server-authoritative policies, IDENTITY-001; domínios verticais para a semântica da relação

`READY` descreve maturidade documental. Não autoriza implementação.

## Problema

Membership interno não resolve relações externas como:

- cliente acompanhando pedido;
- pai/mãe acompanhando aluno;
- aluno acessando boletim;
- responsável autorizando saída;
- cliente de escritório acessando documento liberado;
- morador acessando serviço de condomínio;
- paciente acessando informação autorizada no futuro.

Transformar todos esses atores em `member` do Space seria incorreto e perigoso. Também não é aceitável cada vertical inventar seu próprio sistema de portal, convite e token.

## Objetivo

Criar uma fundação horizontal de **External Access / Portal** que permita a um Space expor uma projeção limitada e autorizada de dados pertencentes aos owners corretos.

```text
Space da organização
       |
       +--> membros internos (IDENTITY-001)
       |
       +--> relações externas autorizadas
               |
               +--> Portal Web
               +--> OrdaX Mobile
               +--> link seguro limitado quando permitido
```

A camada horizontal deve resolver autenticação, grants, consentimento, revogação, expiração, deep links e presentation shell. O domínio continua dono do fato de negócio.

## Não objetivos

- não transformar relação externa em membership interno;
- não mover dados de domínio para um banco genérico de portal;
- não compartilhar tabelas indiscriminadamente;
- não usar link público permanente como autenticação de dado sensível;
- não criar um "super perfil" com todos os relacionamentos da vida visíveis a terceiros;
- não permitir publicidade baseada em dados escolares, saúde, localização sensível ou documentos privados;
- não tratar saúde como simples cópia de Education — Healthcare exige plano/compliance próprio antes de rollout.

## Estado atual verificado

### Já implementado

- Account/Spaces e membership server-authoritative;
- Web/Mobile/Native como modos do mesmo produto em arquitetura;
- Notifications e sync possuem boundaries próprios;
- Product Gateway/Action Gateway já adotam scopes explícitos em outras áreas.

### Parcialmente implementado

- vários verticais planejados já necessitam clientes, equipe ou participantes, mas não existe uma fundação única de portal externo;
- a Surface pode representar contexto de Space, porém não há External Portal canônico.

### Ausente

- contrato horizontal de external access;
- grants por recurso/ação;
- lifecycle de relação externa;
- portal universal;
- vínculo opcional com conta OrdaX;
- guest link de baixo risco com TTL;
- revogação e consent receipt comuns.

## Decisões arquiteturais propostas

### 1. Domínio possui a relação; Portal possui o acesso

Exemplo Education:

```text
Education owner
 -> aluno X
 -> responsável Y autorizado

External Access
 -> concede ao Account Y acesso a projections/actions permitidas
```

Exemplo Fabrication:

```text
Fabrication owner
 -> pedido #123 pertence ao cliente C

External Access
 -> cliente C vê status/orçamento aprovado
```

A camada horizontal não deve redefinir `guardian`, `customer`, `patient`, `resident` ou outras regras de negócio.

### 2. Três classes de acesso

- **membro interno:** IDENTITY-001;
- **participante autenticado externo:** possui conta OrdaX e grant específico;
- **guest link limitado:** somente quando classificação de dados e policy permitirem, com escopo mínimo, TTL, uso/revogação e sem upgrade implícito de authority.

### 3. Sensibilidade decide o nível de autenticação

Dados de menor risco podem permitir link limitado. Dados de crianças, saúde, financeiro sensível, documentos privados e localização exigem autenticação apropriada, policy dedicada e, quando necessário, reautenticação/segundo fator.

### 4. Portal é uma Surface, não um segundo backend

```text
portal UI
 -> external-access contract
 -> owner do domínio
 -> projection/action autorizada
```

Sem cópia indiscriminada de tabelas.

### 5. Relação não é necessariamente pública

Uma pessoa pode ser responsável por um aluno, cliente de uma clínica ou morador sem que isso apareça no Network/diretório público.

## Caminhos/owners afetados

Quando promovido:

- Identity/Account/Spaces;
- Web/Mobile Surface;
- Notifications;
- domain adapters para Fabrication/Food/Education/etc.;
- audit/consent;
- Payments para cobranças autorizadas;
- Network somente quando houver uma ação social explicitamente pública.

## Fases

### Fase 0 — auditoria/precondições

- taxonomia de classes de dados;
- threat model de bearer link;
- matriz de relação vs membership;
- identificar owners reais por domínio.

### Fase 1 — fundação

- contrato de external grant;
- lifecycle `pending/active/suspended/revoked/expired` quando aplicável;
- projection/action scopes;
- consent/audit receipt;
- deep-link seguro.

### Fase 2 — implementação mínima

Primeiro piloto recomendado deve ser um caso de baixo risco e alto valor, por exemplo acompanhamento de orçamento/pedido no Fabrication, antes de dados infantis ou saúde.

- convite externo;
- Portal Web responsivo;
- vincular/usar conta OrdaX;
- listar relações autorizadas;
- revogar acesso.

### Fase 3 — hardening

- reautenticação;
- rate limit;
- anti-enumeração;
- token rotation/revoke;
- device/session revocation;
- policy por sensibilidade;
- testes multi-tenant.

### Fase 4 — integração/rollout

- Education usa o Portal para pais/alunos;
- Fabrication usa para clientes;
- Food pode usar para fidelidade/pedidos/conta quando fizer sentido;
- future Healthcare somente após plano dedicado e requisitos legais/segurança próprios.

## Gates de aceite

- externo nunca ganha membership por acidente;
- grant só expõe projection/action explicitamente listada;
- revogação bloqueia acesso novo;
- owner de domínio continua SSOT;
- guest link não pode escalar para sessão geral;
- dados de outro sujeito/tenant não podem ser enumerados;
- portal funciona no Web sem exigir OrdaX OS instalado;
- conta OrdaX melhora continuidade, mas não deve ser exigida para casos públicos/guest permitidos.

## Segurança/privacidade

- consentimento e finalidade explícitos;
- minimização de dados;
- TTL e revogação;
- sem dados sensíveis em URL quando evitável;
- não usar relações privadas para ads;
- crianças e localização recebem policy mais restritiva;
- Healthcare fica fail-closed até owner/compliance próprios.

## Custos/limites

Custos esperados: e-mail/push/SMS opcionais, autenticação, armazenamento de receipts e tráfego Web. Provedores permanecem substituíveis.

## Testes/evidências

- cliente vê somente seu pedido;
- responsável vê somente sujeitos autorizados;
- revogação imediata server-side;
- link expirado falha fechado;
- grant de leitura não executa mutação;
- alteração no domínio aparece por projection/reconciliation, sem dual-write master.

## Rollback/degradação

Se External Access estiver indisponível, operação interna do Space continua funcional. Portal deve mostrar indisponibilidade real, nunca cache stale como dado atual sensível.

## Próxima ação documental

Manter REL-001 como fundação para EDU-001 e portais de clientes. Não criar Healthcare vertical apenas por analogia; exigir plano específico quando houver prioridade real.

## Próxima ação de execução

DEFERRED.

## Handoff para outro chat/agente

External Access é horizontal. O domínio possui a relação/fato; esta fundação possui grants, consentimento, revogação e shell de portal. Não transformar externos em membros internos e não duplicar portal por vertical. **DEFERRED FOR EXECUTION**.
