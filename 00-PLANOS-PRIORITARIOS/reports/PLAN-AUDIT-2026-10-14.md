# Auditoria transversal dos planos — 2026-10-14

Status: **TRIAGED / EXECUTION ROUTER INPUT**  
Base auditada: `ordaxsystems/ordax-os@ef6c111fb6fadc7eba2c63fe51e2abb50e44af58`  
Autoridade: este relatório **não** substitui source, contratos, `docs/CURRENT-STATE.md`, `MVP.md`, ADRs ou owners canônicos.

## Objetivo

Reclassificar os planos existentes por utilidade real no estado atual do projeto, evitando implementar novamente algo que a `main` já resolveu ou arquivar um plano que ainda é owner real de escopo/produto.

## Resultado executivo

| ID | Documento | Classificação 14/10 | Ação recomendada |
|---|---|---|---|
| EXEC-000 | `PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md` | **STALE OVERLAY / ainda útil** | Não usar como snapshot sem revalidar. Substituir gradualmente seu papel corrente por `ROADMAP.md` + `docs/CURRENT-STATE.md`; manter histórico até links migrarem. |
| SURFACE-001 | `PLANO-FUNCIONAL-SURFACE-E-APPS.md` | **ACTIVE REFERENCE / execution ledger** | Preservar requisitos/decisões, mas parar de tratá-lo como snapshot. Novos trabalhos começam pelos owners canônicos. |
| LEGACY-001 | `PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md` | **HISTORICAL REFERENCE** | Retirar da prioridade ativa. Consultar para provenance/ideias/migração seletiva junto de `docs/SOURCE-MIGRATION.md`. |
| USB-001 | `PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md` | **BASELINE AUDIT / physical retest reference** | Preservar baseline; gates correntes pertencem a `docs/PROMOTION-GATES.md` + contratos/evidências atuais. |
| ECO-001 | `PLANO-04-FUNDACAO-ECOSSISTEMA-PRE-MVP.md` | **ACTIVE FOUNDATION, parcialmente concretizada** | Revalidar itens futuros: Spaces, Memory, model router, Product MCP/foundations e várias fronteiras já existem em source. |
| PROFILE-001 | `PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md` | **ACTIVE / advanced source implementation** | Manter ativo. Gargalo real: `first-public-profile-proof`/trust/publicação/ativação comprovada. |
| PERSONAL-001 | `PLANO-07-PERSONAL-ORDAX-E-TRABALHO-INTELIGENTE.md` | **ACTIVE / foreground foundation advanced** | Manter. Work/Activity/approvals/grants/Gateway/Executor/background/scheduler foundations já existem; autonomia pública segue desabilitada. |
| NETWORK-001 | `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md` | **ACTIVE CANONICAL PRODUCT PLAN** | Manter status. `system/network/README.md` o referencia como plano canônico e `docs/contracts/network-foundation.json` é a boundary machine-readable. |
| INTEL-001 | `INTELLIGENCE-HANDOFF.md` | **ACTIVE GUIDE** | Manter como router transversal; não substitui `docs/INTELLIGENCE.md`/contracts. |
| INTEL-002 | `docs/plans/INTELLIGENCE-INTEGRATION-CLOSURE-2026-10-13.md` | **ACTIVE CLOSURE PLAN** | Phase 1 mergeada; Phase 2/transport e external-provider gates continuam distintos. |
| INTEL-003 | `docs/plans/NATIVE-INTELLIGENCE-SERVICE-BOUNDARY-2026-10-14.md` | **ACTIVE SOURCE-ONLY PLAN** | Native service boundary existe, ainda não host-composed/remotely reachable. |
| WEB-001 | `00-PLANOS-PRIORITARIOS/plans/WEB-001-WEB-RESEARCH.md` | **ACTIVE / G0 PASS_SOURCE / G1 IN PROGRESS** | Continuar na branch dedicada; contratos provider-neutral iniciados, nenhum provider ativado. |

## Evoluções que invalidam leituras antigas

### Intelligence

A `main` já possui `ordax.intelligence/1`, Local AI, model router, Memory autorizada, consumidores first-party e boundary Web/remote provider-neutral em evolução. Planos antigos que digam “criar IA”, “criar Memory” ou “criar model router” devem ser reinterpretados como integrar/ampliar owners existentes.

### Autoridade e ações

A `main` já possui `ordax.action-gateway/1`, effects `read|write|external-egress|device-control`, grants, Action Executor com revalidação, Action Policy/Review e Background Runtime com budgets incluindo bytes de `external-egress`. Novos conectores/Web Research/MCP não devem criar outra permission layer, grant registry ou budget authority.

### Web/untrusted content

O Internet app já possui `ordax.browser-page-selection/1`, classifica texto da página como `untrusted-web-content` e o envia à Intelligence como dado não confiável. Web Research deve generalizar esse princípio, não inventar outro trust model.

### Network

A Network já possui contracts v1/v2, backend/migrations, content safety, mutation outcomes e transport v2 same-origin; a ativação pública continua fail-closed. `PLANO-08` segue relevante, mas novas mudanças devem partir do source atual.

### Profiles

Provisioning, inventory, activation metadata, permission diff, Native trusted consent, selected Space, Knowledge/Skill reader/context e Memory segregation já avançaram. A prioridade é provar um Profile público canônico com trust/receipt/health/domínio válidos.

### Personal OrdaX

Foreground seguro, approvals/grants, Action Gateway/Executor, Work/Activity/Results, background foundation e scheduler já existem. Proactive Research local/read-only também aparece como foundation. `WEB-001` é aquisição de evidência externa, não substituto do Personal OrdaX nem sinônimo de autonomia.

## Dívida documental

### `PLANO-00`

O cabeçalho ainda declara revisão 02/10/2026 embora o projeto tenha avançado muito depois. `00-PLANOS-PRIORITARIOS/ROADMAP.md` passa a ser o router de prioridade corrente; `PLANO-00` permanece referência transitória. `docs/CURRENT-STATE.md` e `docs/PROMOTION-GATES.md` vencem ambos.

### `PLANO-FUNCIONAL-SURFACE-E-APPS.md`

Virou também um ledger cronológico de muitas integrações. É útil para provenance, mas ruim para descobrir “o que falta agora”. Não reescrever/apagar em massa; novos gaps devem entrar no Registry/Roadmap e apontar ao owner específico.

### `PLANO-02`

A análise de setembro continua útil para aprender do legado, mas vários gaps já foram resolvidos por outra arquitetura. Não usar como fila.

### Planos com “canônico” no status

Não remover mecanicamente. Network foi verificada e continua explicitamente roteada pelo source como plano canônico de produto; segurança exata continua machine-readable.

## Regra operacional

```text
item do plano
  -> localizar owner atual
  -> verificar CURRENT-STATE/contracts/source
  -> procurar implementação/tests recentes
  -> classificar: real | já resolvido | mudou de owner | bloqueado | futuro
  -> só então implementar
```

“Está escrito no plano” não prova que ainda falta.

## Próximas reconciliações

1. atualizar `REGISTRY.md` com estas classificações;
2. tornar `ROADMAP.md` o router prático de prioridade corrente;
3. concluir `WEB-001` G1 e abrir PR isolada;
4. revisar em slices os planos grandes, começando por `PLANO-00` e Surface, sem alterar owners por texto histórico;
5. criar novos planos apenas para responsabilidades realmente novas.
