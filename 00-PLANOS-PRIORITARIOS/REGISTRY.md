# Registry de planos, pesquisas e handoffs

Atualizado: **2026-10-15**

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
| COMP-001 | análise comparativa | `reports/COMP-001-SPACED-LINUX-ORDAX-COMPARISON.md` | referência | REFERENCE | NOT APPLICABLE | Auditoria que separa lacunas reais de capacidades já existentes; evita importar stack/owners paralelos por comparação superficial |
| NATIVE-001 | plano de fechamento MVP | `plans/NATIVE-001-USB-TO-NATIVE-MVP-CLOSURE.md` | **P0** | READY | **EXECUTION-ELIGIBLE somente no recorte já exigido pelos owners canônicos do MVP; APPLY físico continua gated** | USB → Native whole-disk usando infraestrutura existente; não cria novo instalador; boot/recovery/first-boot health e hardware claim continuam fail-closed |
| HARDWARE-001 | plano de produto/plataforma | `plans/HARDWARE-001-HARDWARE-DRIVERS-AND-PACKS.md` | **P1** | READY | **DEFERRED FOR EXECUTION**, salvo subconjunto exigido por NATIVE-001/MVP | Evolui hardware packs assinados, exact modalias/ABI e rollback até Hardware & Drivers; não adota APT/DKMS como arquitetura |
| DESKTOP-001 | plano de experiência | `plans/DESKTOP-001-DAILY-USE-EXPERIENCE.md` | **P1** | READY | **DEFERRED FOR EXECUTION**, salvo promoção canônica | Lacunas cotidianas: Displays, Help, SMB/MTP/PTP no Files, UX de Updates; reutiliza owners existentes e mantém Theme Packs como P2 |
| MODE-001 | plano de produto/arquitetura | `plans/MODE-001-WEB-CLOUD-DEVICE-RUNTIME.md` | **P1** | READY | **DEFERRED FOR EXECUTION** | Fecha wiring real do OrdaX Web e boundaries Web/Cloud/Device sem fork; candidato fundacional a revalidar cedo no pós-MVP |
| FAB-001 | plano de produto/vertical comercial | `plans/FAB-001-ORDAX-FABRICATION-3D-PRINTING-PILOT.md` | **P1** | READY | **DEFERRED FOR EXECUTION**, exceto recorte `impressao-3d-br@1` já exigido por owner canônico do MVP | Primeiro vertical comercial recomendado; une negócio, produção, arquivos, jobs, materiais, print farm, devices e Intelligence; piloto real na operação de impressão 3D do owner |
| FOOD-001 | plano de produto/vertical comercial | `plans/FOOD-001-ORDAX-FOOD-PIZZA-PILOT.md` | **P1** | READY | **DEFERRED FOR EXECUTION**, exceto recorte `pizzaria-br@1` já exigido por owner canônico do MVP | Estrutura OrdaX Food sobre o Profile/Space Pizzaria existente; Pizza é o segundo piloto comercial recomendado após FAB-001; reutiliza Account/Spaces/Realtime/Intelligence e proíbe backend/conta/authority paralelos |
| IDENTITY-001 | plano de identidade/colaboração | `plans/IDENTITY-001-SPACE-MEMBERS-INVITES-AND-ACCESS.md` | **P1** | READY | **DEFERRED FOR EXECUTION** | Fecha convite, aceite, roles, revogação e ownership de Spaces; People/emprego continua separado de login/membership |
| REL-001 | plano de plataforma | `plans/REL-001-EXTERNAL-RELATIONSHIPS-AND-PORTALS.md` | **P1** | READY | **DEFERRED FOR EXECUTION** | Fundação horizontal para clientes, responsáveis, alunos e outros externos sem transformá-los em membros internos; domínio mantém SSOT da relação |
| ACHEGUESE-001 | plano first-party/ecossistema | `plans/ACHEGUESE-001-FIRST-PARTY-PRODUCT-INTEGRATION.md` | **P1** | READY | **DEFERRED FOR EXECUTION** | Mantém Achegue-se independente e territory-first; integração somente por Product OAuth/API/events/projections, sem banco/credencial/SSOT compartilhado |
| ACHEGUESE-002 | plano de workspace/dogfooding | `plans/ACHEGUESE-002-ORDAX-DEVELOPER-SPACE.md` | **P1** | READY | **DEFERRED FOR EXECUTION** | Space privado owner-only para desenvolver o Achegue-se usando OrdaX como workspace; não move o repo, não cria Profile público e pode receber membros depois via IDENTITY-001 |
| TALENT-001 | plano de produto/ecossistema | `plans/TALENT-001-PROFESSIONAL-IDENTITY-JOBS-AND-HIRING.md` | **P2** | READY | **DEFERRED FOR EXECUTION** | Identidade profissional pessoal fora do Space + vagas/candidaturas/contratação; Network/People/Space continuam owners separados |
| EDU-001 | plano de vertical | `plans/EDU-001-ORDAX-EDUCATION-SCHOOL-AND-FAMILY-PORTAL.md` | **P2** | READY | **DEFERRED FOR EXECUTION** | Escola operacional no OrdaX + Portal da Família via REL-001; Achegue-se permanece página/descoberta pública; menores recebem privacy gates reforçados |
| MARKET-001 | plano de comércio/ecossistema | `plans/MARKET-001-OFFERS-DISCOVERY-AND-MARKETPLACE.md` | **P2** | READY | **DEFERRED FOR EXECUTION** | OrdaX pode author/publicar ofertas; Achegue-se é canal territorial natural; targeting sensível e ads baseados em dados privados são proibidos |
| HEALTH-001 | plano exploratório de vertical | `plans/HEALTH-001-HEALTHCARE-CLINIC-AND-PATIENT-PORTAL.md` | **P3** | TRIAGED | **DEFERRED FOR EXECUTION** | Preserva futura direção clínica/paciente sem declarar prontidão; exige pesquisa jurídica, segurança e owner clínico antes de qualquer promoção para READY |
| WEB-001 | pesquisa + roadmap | `reports/WEB-001-WEB-RESEARCH-DEEP-RESEARCH.md` + `plans/WEB-001-WEB-RESEARCH.md` | P1 | READY | **DEFERRED FOR EXECUTION** | Capability provider-neutral preservada para pós-MVP; não boot-critical |

## Interpretação obrigatória

- `READY` significa **documentalmente pronto**, não “começar agora”.
- `REFERENCE` significa que o documento ainda possui valor, mas não representa a fonte factual corrente nem uma fila ativa de execução.
- `TRIAGED` preserva uma direção ainda imatura; não deve ser tratada como plano pronto para implementação.
- `DEFERRED FOR EXECUTION` significa: não abrir task/issue/PR de implementação apenas por causa deste plano durante o fechamento do MVP.
- `NATIVE-001` é uma exceção apenas porque organiza trabalho que **já está no ciclo canônico do MVP**; ele não autoriza escrita física, não altera flags fail-closed e não substitui `MVP.md`, `docs/NATIVE-INSTALLATION.md`, contratos ou promotion gates.
- `FAB-001` não amplia o escopo do MVP: o `impressao-3d-br@1` atual continua sendo a prova segura governada pelos owners de Profile/MVP; farm comercial, adapters físicos, costing avançado, storefront e demais módulos permanecem pós-MVP até promoção explícita.
- `FOOD-001` não amplia o escopo do MVP: o `pizzaria-br@1` atual continua sendo a prova pública segura governada pelos owners de Profile/MVP; PDV, KDS, WhatsApp, delivery e demais módulos comerciais permanecem pós-MVP até promoção explícita.
- FAB-001 e FOOD-001 reutilizam as mesmas capacidades horizontais do OrdaX e não podem criar cópias de Account, Spaces, Realtime, Intelligence, Files/Projects ou Device authority.
- `IDENTITY-001` reutiliza o membership já existente; não autoriza People/Workforce a conceder login nem cria roles globais por profissão.
- `REL-001` é a fundação para acesso externo limitado; cliente, responsável, aluno ou paciente não vira `member` apenas para abrir um portal.
- `EDU-001`, `TALENT-001` e `MARKET-001` são expansões pós-MVP e não ativam Education/Jobs/Offers automaticamente em nenhum produto.
- `HEALTH-001` é deliberadamente P3/TRIAGED: não autoriza prontuário, prescrição, farmácia ou IA clínica; primeiro exige pesquisa regulatória/segurança e owner próprio.
- `ACHEGUESE-001` formaliza uma integração já iniciada em source, mas o runtime público continua fail-closed; Achegue-se e OrdaX mantêm bancos, releases, roadmaps e ownership independentes.
- `ACHEGUESE-002` é dogfooding interno: o Space de desenvolvimento organiza o trabalho sobre o repo externo, não se torna SSOT do Achegue-se, não exige Profile público e não habilita ACHEGUESE-001 por consequência.
- dados escolares, de saúde, de menores, Memory, mensagens privadas e relações privadas nunca podem ser usados como fonte de targeting comercial no MARKET-001.
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
- `MODE-*`: modos de produto, continuidade entre Web/Cloud/Device e resolução de runtime/capability sem forks.
- `NATIVE-*`: instalação/execução em disco interno e fechamento da jornada USB → Native; nunca substitui contracts de storage/boot/recovery.
- `HARDWARE-*`: hardware discovery, support claims, hardware packs, drivers e expansão física da matriz.
- `DESKTOP-*`: experiência cotidiana transversal que consome owners existentes de Surface/System/Files sem criar shell paralelo.
- `FAB-*`: fabricação digital e verticais de produção; reutilizam Spaces/Profile/Realtime/Intelligence/Device Agent e não criam backend ou device authority paralelos.
- `FOOD-*`: domínio/verticais comerciais de alimentação; reutilizam Spaces/Profile/Realtime/Intelligence e não criam produto/backend paralelo.
- `REL-*`: relações externas, grants e portais; não substituem membership nem o owner do domínio relacional.
- `TALENT-*`: identidade profissional pessoal, vagas, candidatura e contratação; separado de Profile Pack.
- `EDU-*`: Education/escola e experiências de alunos/responsáveis; exige privacy gates para menores.
- `MARKET-*`: ofertas/commerce/publication/marketplace; separado da Loja de apps.
- `HEALTH-*`: Healthcare/clinics/patient portal; começa como pesquisa de alta sensibilidade e exige owner/compliance próprios.
- `ACHEGUESE-*`: integração first-party e workspaces internos relacionados ao produto Achegue-se; mantém produtos, repositórios e SSOTs independentes.
- `COMP-*`: comparação/auditoria de referência externa; nunca executável por si só.
- `INTEL-*`: Intelligence/model routing.
- `USB-*`: mídia física/boot/release portátil.
- `SURFACE-*`: Surface/apps/UI compartilhada.
- `IDENTITY-*`: conta/identidade/entitlements/membership e convites de Space.
- `NETWORK-*`: comunidades/mensagens/realtime social.
- `PROFILE-*`: Spaces/Profile Packs/perfis profissionais.
- `DEV-*`: Developer USB/workflow/tooling.
- `SEC-*`: segurança transversal.

Novas famílias podem ser criadas quando houver owner real; não reutilizar ID de responsabilidade diferente e não criar ID apenas para preencher sequência numérica.