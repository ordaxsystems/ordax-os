# Registry de planos, pesquisas e handoffs

Atualizado: **2026-10-14**

Este catálogo evita que múltiplos chats criem documentos concorrentes para a mesma frente. Classificações abaixo foram revalidadas contra `main@32690a835fc337e5dae52065c5149474a98eddc7`; estado exato continua pertencendo aos contracts/source/canônicos.

| ID | Tipo | Documento / rota | Prioridade | Status | Observação |
|---|---|---|---|---|---|
| EXEC-000 | execution overlay | `PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md` | P0/P1 conforme item | **STALE OVERLAY / REFERENCE** | Cabeçalho ainda marca 02/10; usar `ROADMAP.md` + `docs/CURRENT-STATE.md` para prioridade corrente |
| SURFACE-001 | plano funcional/ledger | `PLANO-FUNCIONAL-SURFACE-E-APPS.md` | conforme owner atual | **ACTIVE REFERENCE** | Muito histórico acumulado; não é snapshot de gaps |
| LEGACY-001 | análise/migração | `PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md` | sem fila própria | **HISTORICAL REFERENCE** | Reuso exige confronto com main + `docs/SOURCE-MIGRATION.md` |
| USB-001 | auditoria pre-USB | `PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md` | P0 quando gate atual | **BASELINE REFERENCE** | Source closure histórico; gates atuais em `docs/PROMOTION-GATES.md`/contracts |
| ECO-001 | fundação ecossistema | `PLANO-04-FUNDACAO-ECOSSISTEMA-PRE-MVP.md` | P1 conforme gates | **ACTIVE / PARTIALLY REALIZED** | Spaces/Memory/model-router/Product boundaries já avançaram; revalidar item a item |
| PROFILE-001 | plano produto | `PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md` | P1 | **ACTIVE** | Foundation avançada; gate real é `first-public-profile-proof` |
| PERSONAL-001 | plano produto | `PLANO-07-PERSONAL-ORDAX-E-TRABALHO-INTELIGENTE.md` | P1/P2 conforme slice | **ACTIVE** | Foreground seguro avançado; autonomia pública continua disabled |
| NETWORK-001 | plano produto | `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md` | P1 no recorte MVP | **ACTIVE CANONICAL PRODUCT PLAN** | Confirmado por `system/network/README.md`; machine boundary em `docs/contracts/network-foundation.json` |
| INTEL-001 | handoff | `INTELLIGENCE-HANDOFF.md` | transversal | **ACTIVE GUIDE** | Router, não owner canônico |
| INTEL-002 | closure plan | `docs/plans/INTELLIGENCE-INTEGRATION-CLOSURE-2026-10-13.md` | transversal/P1 | **ACTIVE** | Phase 1 merged; transport/provider E2E continua separado |
| INTEL-003 | Native boundary plan | `docs/plans/NATIVE-INTELLIGENCE-SERVICE-BOUNDARY-2026-10-14.md` | transversal/P1 | **ACTIVE SOURCE-ONLY** | Service boundary existe; ainda não host-composed/remotely reachable |
| SEC-001 | security/execution closure | `plans/SEC-001-EXTERNAL-EGRESS-AUTHORITY.md` | **P1 transversal** | **ACTIVE — E0 PASS / E1 NEXT** | `external-egress` existe, mas Gateway atual o nega; fechar autoridade explícita no Gateway/Executor, sem broker paralelo |
| WEB-001 | capability + research | `plans/WEB-001-WEB-RESEARCH.md` + `../docs/WEB-RESEARCH.md` | **P1** | **ACTIVE — G0 PASS / G1 PARTIAL / EGRESS BLOCKED** | Contracts/router/usage/projeção existem; nenhum provider/network path ativado |
| WEB-001-R1 | provider research | `reports/WEB-001-PROVIDER-UPDATE-2026-10-14.md` | input de G2 | **TRIAGED** | Parallel/Brave/Tavily/Exa entram no benchmark; preços são snapshot |
| CI-001 | CI/build routing | `ROADMAP.md` + heavy-workflow tests/workflows | transversal | **ACTIVE DISCOVERY** | QEMU ainda observa `system/**` amplo demais; alinhar gates pesados a dependências reais |
| PLAN-AUDIT-001 | auditoria documental | `reports/PLAN-AUDIT-2026-10-14.md` | transversal | **TRIAGED** | Classifica planos e dívida documental sem reescrever owners em massa |

## Regra de retomada

Antes de implementar um item de plano antigo:

1. localizar o owner atual no source/docs;
2. conferir `docs/CURRENT-STATE.md`, contracts e testes recentes;
3. classificar o item como `real`, `já resolvido`, `mudou de owner`, `blocked` ou `future`;
4. só então abrir código/PR.

## Como registrar novo material

1. procurar neste Registry e no source por responsabilidade equivalente;
2. material bruto entra em `inbox/`;
3. após triagem, atribuir ID estável e mover para `reports/` ou `plans/`;
4. registrar owner canônico e dependências;
5. atualizar Registry + `ROADMAP.md` no mesmo change;
6. `DONE` só depois que o source/owner canônico refletir a entrega e a prova aplicável existir.

## IDs sugeridos

- `WEB-*`: Web Research / aquisição de conhecimento externo.
- `INTEL-*`: Intelligence/model routing.
- `USB-*`: mídia física/boot/release portátil.
- `SURFACE-*`: Surface/apps/UI compartilhada.
- `IDENTITY-*`: conta/identidade/entitlements.
- `NETWORK-*`: comunidades/mensagens/realtime social.
- `PROFILE-*`: Spaces/Profile Packs/perfis profissionais.
- `DEV-*`: Developer USB/workflow/tooling.
- `SEC-*`: segurança transversal.
- `CI-*`: roteamento/eficiência/reprodutibilidade de CI e builds.

Novas famílias só quando houver responsabilidade realmente nova; não criar outro ID para o mesmo owner.
