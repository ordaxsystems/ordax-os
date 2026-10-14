# Registry de planos, pesquisas e handoffs

Atualizado: **2026-10-14**

Este catálogo evita que múltiplos chats criem documentos concorrentes para a mesma frente.

| ID | Tipo | Documento / rota | Prioridade | Status | Observação |
|---|---|---|---|---|---|
| EXEC-000 | execution overlay | `PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md` | P0/P1 conforme item | ACTIVE | Overlay factual atual; revalidar contra `main`/canônicos |
| SURFACE-001 | plano funcional | `PLANO-FUNCIONAL-SURFACE-E-APPS.md` | conforme overlay | ACTIVE REFERENCE | Plano detalhado; não é estado factual |
| LEGACY-001 | plano/migração | `PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md` | conforme overlay | ACTIVE REFERENCE | Reuso exige `docs/SOURCE-MIGRATION.md` |
| USB-001 | plano pre-USB | `PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md` | P0 quando aplicável | ACTIVE REFERENCE | Gates pré-USB; canônicos vencem |
| ECO-001 | plano fundação | `PLANO-04-FUNDACAO-ECOSSISTEMA-PRE-MVP.md` | conforme canônicos | TRIAGED | Não reclassificar sem revalidar main |
| PROFILE-001 | plano produto | `PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md` | conforme canônicos | TRIAGED | Perfis/distribuição sob demanda |
| PERSONAL-001 | plano produto | `PLANO-07-PERSONAL-ORDAX-E-TRABALHO-INTELIGENTE.md` | conforme canônicos | TRIAGED | Conferir também owner canônico em `docs/` |
| NETWORK-001 | plano produto | `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md` | P1 no recorte MVP definido | ACTIVE REFERENCE | Escopo limitado pelo overlay atual |
| INTEL-001 | handoff | `INTELLIGENCE-HANDOFF.md` | transversal | ACTIVE GUIDE | Não substitui contracts/owner de Intelligence |
| WEB-001 | pesquisa + roadmap | `reports/WEB-001-WEB-RESEARCH-DEEP-RESEARCH.md` + `plans/WEB-001-WEB-RESEARCH.md` | **P1** | **READY** | Capability sistêmica provider-neutral; não boot-critical |

## Como registrar novo material

1. procurar neste registry e no source por responsabilidade equivalente;
2. se for material bruto, usar `inbox/`;
3. após triagem, atribuir ID estável e mover para `reports/` ou `plans/`;
4. registrar owner canônico e dependências no plano;
5. atualizar este catálogo e `ROADMAP.md` no mesmo commit;
6. quando concluído, refletir a mudança no owner canônico real e marcar este item como `DONE`.

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

Novas famílias podem ser criadas quando houver owner real; não reutilizar ID de responsabilidade diferente.
