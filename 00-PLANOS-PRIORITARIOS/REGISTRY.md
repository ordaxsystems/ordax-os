# Registry de planos, pesquisas e handoffs

Atualizado: **2026-10-14**

Este catálogo evita que múltiplos chats criem documentos concorrentes para a mesma frente e separa **valor documental** de **autorização para executar**.

Enquanto o MVP atual não estiver fechado, planos futuros permanecem registrados, mas não devem abrir implementação por conta própria. Trabalho pré-MVP só é `EXECUTION-ELIGIBLE` quando já é exigido pelos owners canônicos do MVP, contratos, `docs/CURRENT-STATE.md` ou `docs/PROMOTION-GATES.md`.

| ID | Tipo | Documento / rota | Prioridade | Status documental | Execução agora | Observação |
|---|---|---|---|---|---|---|
| EXEC-000 | execution overlay | `PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md` | P0/P1 conforme item | ACTIVE | EXECUTION-ELIGIBLE somente para gates canônicos correntes | Overlay factual; revalidar contra `main`/canônicos |
| SURFACE-001 | plano funcional | `PLANO-FUNCIONAL-SURFACE-E-APPS.md` | conforme overlay | REFERENCE | DEFERRED FOR EXECUTION salvo requisito canônico do MVP | Especificação funcional detalhada; não é `CURRENT-STATE` nem changelog canônico |
| LEGACY-001 | análise/migração histórica | `PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md` | histórico | REFERENCE | NOT APPLICABLE | Comparação datada do legado; reuso real é governado por `docs/SOURCE-MIGRATION.md` |
| USB-001 | baseline pré-USB | `PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md` | histórico/P0 quando citado por owner | REFERENCE | NOT APPLICABLE como plano; gates físicos vêm dos owners canônicos | Fechamento de source concluído; preservar como baseline até auditoria de links/sucessor |
| ECO-001 | plano de fundação | `PLANO-04-FUNDACAO-ECOSSISTEMA-PRE-MVP.md` | conforme canônicos | REFERENCE | DEFERRED FOR EXECUTION salvo requisito canônico do MVP | Fundação parcialmente realizada; decisões atuais devem viver nos owners/contratos |
| PROFILE-001 | plano de produto | `PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md` | conforme canônicos | REFERENCE | DEFERRED FOR EXECUTION salvo requisito canônico do MVP | Mistura histórico de implementação e evolução; manifests/contracts/owners vencem |
| PERSONAL-000 | referência curta/compatibilidade | `PERSONAL-ORDAX.md` | conforme owner canônico | REFERENCE | NOT APPLICABLE como fila própria | Não canônico; owner humano é `docs/PERSONAL-ORDAX.md`; mantido por compatibilidade/links |
| PERSONAL-001 | plano de execução | `PLANO-07-PERSONAL-ORDAX-E-TRABALHO-INTELIGENTE.md` | conforme canônicos | READY | DEFERRED FOR EXECUTION | Owner canônico: `docs/PERSONAL-ORDAX.md`; preservar fases futuras sem executá-las agora |
| NETWORK-001 | plano de produto | `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md` | conforme `MVP.md`/contracts | REFERENCE | DEFERRED FOR EXECUTION como plano; requisitos reais do MVP seguem owners canônicos | Cabeçalho histórico de “canônico” não altera a hierarquia de `docs/README.md` |
| INTEL-001 | handoff | `INTELLIGENCE-HANDOFF.md` | transversal | GUIDE | NOT APPLICABLE | Guia de retomada; não substitui contracts/owner de Intelligence |
| WEB-001 | pesquisa + roadmap | `reports/WEB-001-WEB-RESEARCH-DEEP-RESEARCH.md` + `plans/WEB-001-WEB-RESEARCH.md` | P1 | READY | **DEFERRED FOR EXECUTION** | Capability provider-neutral preservada para pós-MVP; não boot-critical |

## Interpretação obrigatória

- `READY` significa **documentalmente pronto**, não “começar agora”.
- `REFERENCE` significa que o documento ainda possui valor, mas não representa a fonte factual corrente nem uma fila ativa de execução.
- `DEFERRED FOR EXECUTION` significa: não abrir task/issue/PR de implementação apenas por causa deste plano durante o fechamento do MVP.
- se `MVP.md`, um contrato ou um owner canônico já exigir um comportamento que também aparece em um plano, a execução pertence ao owner canônico, **não ao plano**.
- frases históricas dentro de `PLANO-*` como “canônico”, “obrigatório” ou prioridades antigas não vencem `docs/README.md`.
- referências curtas mantidas na raiz por compatibilidade nunca criam um segundo owner documental.

## Como registrar novo material

1. procurar neste registry e no source por responsabilidade equivalente;
2. se for material bruto, usar `inbox/`;
3. após triagem, atribuir ID estável e mover para `reports/` ou `plans/` quando realmente necessário;
4. registrar owner canônico, status documental, elegibilidade de execução e dependências;
5. atualizar este catálogo e `ROADMAP.md` no mesmo commit quando a classificação mudar;
6. não abrir tarefa de implementação para item `DEFERRED FOR EXECUTION`;
7. quando uma implementação autorizada concluir, refletir a mudança no owner canônico real antes de marcar `DONE`.

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

Novas famílias podem ser criadas quando houver owner real; não reutilizar ID de responsabilidade diferente e não criar ID apenas para preencher sequência numérica.
