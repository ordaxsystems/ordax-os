# IDENTITY-001 — Membros, convites, papéis e acesso a Spaces

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION
- **Prioridade:** P1
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** Account/Identity + Spaces membership contracts; autorização server-side do Control Plane
- **Base factual:** `system/contracts/spaces.mjs`, `docs/contracts/spaces-and-profile-packs.json`, `docs/CURRENT-STATE.md`, migrations do produto e Product Gateway verificados na `main`
- **Relatórios de apoio:** `docs/SPACES-AND-PROFILES.md`
- **Dependências:** Account/session real, Spaces, server-authoritative authorization, Entitlements; REL-001 para participantes externos

`READY` descreve maturidade documental. Não autoriza implementação. O fechamento do MVP continua prioritário.

## Problema

O OrdaX já possui a noção técnica de membership de Space e os papéis `owner`, `admin`, `member` e `viewer`, mas a experiência completa de colaboração ainda não está definida como produto: convite, aceite, expiração, revogação, troca de papel, saída, transferência de ownership, auditoria e permissões por função de trabalho.

Sem esse fechamento, verticais comerciais podem acabar inventando seus próprios sistemas de usuário/equipe, o que criaria identidades e authorities paralelas.

## Objetivo

Definir uma experiência única e reutilizável de membros para qualquer Space:

```text
Space
 -> Membros
 -> Convidar
 -> convite pendente
 -> pessoa autentica/cria conta OrdaX
 -> aceita
 -> membership server-authoritative
 -> papel + capabilities permitidas
```

A mesma fundação deve servir Pizzaria, Impressão 3D, Escola e futuros Spaces sem duplicação.

## Não objetivos

- não transformar funcionário em membro automaticamente;
- não fazer People/Workforce ser autoridade de login;
- não usar Profile Pack para conceder acesso;
- não compartilhar senha;
- não permitir que frontend seja autoridade de role;
- não criar um sistema de permissões diferente por vertical;
- não tratar cliente, pai/responsável, aluno ou paciente como membro interno apenas para dar acesso externo — isso pertence a REL-001.

## Estado atual verificado

### Já implementado

- contrato de Space;
- membership com `spaceId`, `userId` e `role`;
- papéis `owner`, `admin`, `member`, `viewer`;
- schema persistido de membros no backend do produto;
- policies server-side para leitura/administração de Space;
- Product Gateway revalida membership para ações sensíveis;
- owner/admin já possuem authority diferenciada em boundaries existentes.

### Parcialmente implementado

- Surface consegue consumir Spaces, mas a porta atual é deliberadamente limitada e não constitui UX completa de mutação de membership;
- existem roles básicas, mas ainda não há catálogo de funções de trabalho/capabilities por vertical.

### Ausente

- convite canônico;
- aceite/rejeição;
- expiração/revogação;
- UI de membros;
- mudança de papel com auditoria de produto;
- saída voluntária segura;
- transferência de ownership;
- permissões refinadas por função de trabalho;
- lifecycle explícito para usuário suspenso/removido.

## Decisões arquiteturais propostas

### 1. Membership e emprego são conceitos diferentes

```text
People/Workforce
 -> vínculo de trabalho, função, turno, ponto, comissão etc.

Identity/Spaces
 -> login, membership, papel e authority de sistema
```

Cadastrar alguém como funcionário não concede login. Dar login não cria contrato de trabalho.

### 2. Convite não é membership

Convite pendente deve ser uma entidade temporária separada. Somente o aceite autenticado e validado cria membership.

### 3. Papéis gerais permanecem pequenos

Papéis base:

- `owner` — proprietário e authority máxima do Space;
- `admin` — administração delegada;
- `member` — trabalho operacional normal;
- `viewer` — leitura permitida conforme policy.

Funções como `garcom`, `pizzaiolo`, `operador-3d`, `professor` ou `financeiro` não devem aumentar a enumeração global de membership. Devem ser capacidades/policies de domínio ou People vinculadas ao membro.

### 4. Convites devem ser seguros e revogáveis

Convite por e-mail/link deve usar token aleatório de uso único, armazenado server-side de forma não recuperável quando aplicável, com TTL, destino/Space/papel vinculados e revogação explícita.

### 5. Ownership exige cerimônia específica

Transferir proprietário não deve ser uma simples troca de dropdown. Deve exigir reautenticação/consentimento explícito, destinatário elegível e receipt auditável.

### 6. Remoção é fail-closed

Ao remover/suspender membership, novos tokens/actions não podem continuar herdando authority antiga. Sessões/caches devem revalidar acesso no boundary server-side.

## Caminhos/owners afetados

Quando a execução for autorizada, auditar antes de alterar:

- contratos de Spaces/Identity;
- Control Plane membership/authorization;
- Surface/Account/Spaces;
- Notifications para convite;
- People/Workforce para vínculo opcional de função;
- auditoria/security events;
- Web/Mobile/Native adapters.

## Fases

### Fase 0 — auditoria/precondições

- reconciliar schema live atual e contratos;
- mapear toda policy que já diferencia owner/admin/member/viewer;
- confirmar owner de notifications/e-mail;
- definir threat model de convite e takeover.

### Fase 1 — fundação

- contrato de convite versionado;
- estados `pending`, `accepted`, `declined`, `expired`, `revoked`;
- policies de criação/revogação;
- aceite idempotente;
- receipts/auditoria.

### Fase 2 — implementação mínima

- `Space -> Membros`;
- convidar pessoa;
- listar membros e convites pendentes;
- alterar `admin/member/viewer` conforme authority;
- remover/suspender;
- aceitar/rejeitar convite no Web/Mobile/Surface aplicável.

### Fase 3 — hardening

- reautenticação em mudanças sensíveis;
- proteção contra enumeração/spam;
- rate limits;
- testes multi-tenant negativos;
- ownership transfer;
- revogação e stale-session proof.

### Fase 4 — integração/rollout

- People/Workforce pode associar uma função de trabalho a um membro existente sem virar authority de identidade;
- Food/Fabrication/Education reutilizam o mesmo membership;
- REL-001 cobre externos sem membership interno.

## Gates de aceite

- convite não concede acesso antes do aceite;
- membro nunca acessa outro Space por ID previsível;
- frontend não consegue elevar role sozinho;
- role removida perde authority no servidor;
- owner não pode ser removido de forma a deixar Space órfão sem fluxo explícito;
- funcionário sem membership não ganha login;
- participante externo não precisa virar membro interno;
- todas as mutações sensíveis possuem audit receipt.

## Segurança/privacidade

- sem senha compartilhada;
- sem invite token em logs/analytics;
- TTL curto e uso único;
- não revelar existência de conta por respostas diferenciadas de convite;
- rate limit por actor/Space/destino;
- revalidação server-side em toda ação sensível;
- princípio do menor privilégio.

## Custos/limites

Custos relevantes serão principalmente e-mail/SMS/push e storage de auditoria. Nenhum provedor é requisito arquitetural. Preços devem ser revalidados quando a execução for promovida.

## Testes/evidências

- owner convida admin/member/viewer;
- não-admin proibido quando policy exigir;
- convite expirado/revogado falha fechado;
- token de convite não pode ser reutilizado;
- usuário A/Space A não altera Space B;
- downgrade de role remove authority;
- remoção invalida novas ações;
- transferência de owner exige cerimônia e mantém exatamente um owner válido conforme policy.

## Rollback/degradação

Falha no serviço de convite não pode bloquear acesso de membros já válidos. Surface deve degradar para lista read-only/indisponível sem inventar estado local de membership.

## Próxima ação documental

Manter este plano alinhado ao schema/control-plane real e a qualquer owner futuro de People/Workforce. Não abrir implementação durante a janela atual.

## Próxima ação de execução

DEFERRED.

## Handoff para outro chat/agente

Este plano fecha a UX/arquitetura de colaboração interna de Spaces. Não criar outro sistema de usuários dentro de Food, Fabrication ou Education. Antes de executar, revalidar `main`, schema live e owners canônicos; status atual: **DEFERRED FOR EXECUTION**.
