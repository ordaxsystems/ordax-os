# Roadmap de prioridades — OrdaX OS

Status: **EXECUTION ROUTER**  
Atualizado: **2026-10-15**

Este roadmap ordena **janelas de execução**, não redefine arquitetura. Ele não substitui `docs/CURRENT-STATE.md`, `docs/PROMOTION-GATES.md`, `MVP.md`, contratos ou ADRs.

## Janela atual — fechar o MVP antes de executar planos futuros

A janela corrente é exclusivamente o fechamento do MVP conforme seus owners canônicos.

Durante esta janela:

- planos P1/P2/P3 permanecem documentados, pesquisáveis e reconciliáveis;
- nenhum plano futuro abre task/issue/PR de implementação apenas por estar `READY`;
- requisitos que já pertencem ao MVP continuam sendo executados por `MVP.md`, contratos, `docs/CURRENT-STATE.md`, `docs/PROMOTION-GATES.md` e owners canônicos;
- corrigir documentação, links, classificação e SSOT não promove capacidade de produto;
- após o fechamento do MVP, este roadmap deve ser revalidado antes de liberar a próxima frente.

Isso inclui uma distinção importante:

```text
primeiro proof/release USB
!=
fechamento completo da jornada MVP instalável
```

`MVP.md` já inclui Native SSD/NVMe/HDD no ciclo integrado do MVP. Portanto o trabalho real de Native pode ser P0 **quando exigido pelos owners canônicos**, mesmo que a primeira candidata Stable permaneça temporariamente USB-only até os gates Native passarem.

## P0 — gates atuais do Stable/MVP

Somente os gates realmente correntes e comprovados pelos owners canônicos são elegíveis nesta janela. O resumo abaixo é um roteador; valores exatos vêm dos contratos e documentos canônicos.

1. **Stable/MVP físico USB:** consentimento explícito válido para o contexto corrente, seleção segura do alvo, escrita autorizada e prova física exigida pelo contrato atual.
2. **Boot/recovery/cold-health canônicos:** validar o ciclo físico real quando o owner canônico ainda o exigir, sem substituir por mock/synthetic proof.
3. **Surface smoke físico:** executar o harness source-controlled quando ainda pendente e encerrar com evidência canônica `FAIL=0`.
4. **Modo gráfico/Secure Boot e demais provas físicas pendentes:** fechar somente quando permanecerem pendentes nos owners canônicos atuais e com evidência no hardware aplicável.
5. **NATIVE-001 — USB → Native whole-disk:** continuar a infraestrutura já existente até APPLY físico autorizado, release materialization, boot sem USB, first-boot health, known-good e recovery, **sem criar novo instalador e sem relaxar flags fail-closed**.
6. **Hardware mínimo do modelo Native anunciado:** quando necessário ao claim de produto, áudio e suspend/resume deixam de ser "extras" para aquele hardware específico e passam a integrar a homologação real do modelo; não generalizar suporte para outras máquinas.
7. **Profiles profissionais já exigidos pelo MVP:** fechar somente os recortes seguros de `pizzaria-br@1` e `impressao-3d-br@1` definidos pelos owners atuais de Profile/MVP; isso **não** promove OrdaX Food ou OrdaX Fabrication comerciais completos para P0.

Fonte de execução: `docs/CURRENT-STATE.md` + `docs/PROMOTION-GATES.md` + `MVP.md` + `docs/NATIVE-INSTALLATION.md` + contratos correntes. `PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md` é apenas overlay auxiliar.

### NATIVE-001 — posição exata na janela P0

- **Status documental:** READY
- **Elegibilidade:** EXECUTION-ELIGIBLE somente no recorte que os owners canônicos do MVP já exigirem
- **Prioridade:** P0
- **Autoridade destrutiva:** continua nos contratos/gates existentes, nunca neste roadmap

Objetivo de produto:

```text
Creator/release
 -> USB Stable
 -> usar OrdaX sem alterar disco interno
 -> Instalar OrdaX
 -> disco inteiro explicitamente selecionado
 -> release Stable assinada
 -> boot sem USB
 -> first-boot health
 -> known-good/recovery
```

Plano detalhado: `plans/NATIVE-001-USB-TO-NATIVE-MVP-CLOSURE.md`.

## Planos preservados — execução adiada até pós-MVP

### MODE-001 — OrdaX Web, Cloud & Device Runtime

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1

Completar o wiring real do OrdaX Web sobre a mesma Surface, identidade, apps e owners de serviço, com resolução explícita de capabilities `web | cloud | device | hybrid`, Files federado, Loja sem lifecycle simulado, Device Agent somente via Action Gateway e cloud compute provider-neutral.

Plano detalhado: `plans/MODE-001-WEB-CLOUD-DEVICE-RUNTIME.md`.

### FAB-001 — OrdaX Fabrication e piloto Impressão 3D

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**, exceto qualquer comportamento de `impressao-3d-br@1` já explicitamente exigido pelos owners canônicos do MVP
- **Prioridade preservada:** P1 estratégico; primeiro vertical comercial recomendado após MODE-001

Construir Fabrication como domínio compartilhado e usar Impressão 3D como primeiro piloto comercial real, com dogfooding na operação existente.

Plano detalhado: `plans/FAB-001-ORDAX-FABRICATION-3D-PRINTING-PILOT.md`.

### FOOD-001 — OrdaX Food e piloto Pizza

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**, exceto qualquer comportamento de `pizzaria-br@1` já explicitamente exigido pelos owners canônicos do MVP
- **Prioridade preservada:** P1 estratégico; segundo vertical comercial recomendado após FAB-001

Construir Food como domínio compartilhado de alimentação e usar Pizza/Pizzaria como primeiro vertical da família, reutilizando Account/Spaces/Entitlements/Realtime/Intelligence.

Plano detalhado: `plans/FOOD-001-ORDAX-FOOD-PIZZA-PILOT.md`.

### IDENTITY-001 — Membros, convites e acesso a Spaces

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1 horizontal

Fecha convite, aceite, expiração, revogação, roles `owner/admin/member/viewer`, mudança de papel, saída, ownership transfer e audit receipts sobre o membership já existente.

Regra central:

```text
funcionário/People != membership/login
participante externo != member interno
```

Plano detalhado: `plans/IDENTITY-001-SPACE-MEMBERS-INVITES-AND-ACCESS.md`.

### REL-001 — Relações externas e portais

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1 horizontal

Fundação para clientes, pais/responsáveis, alunos e outros externos acessarem somente projections/actions autorizadas sem membership interno. O owner de domínio mantém o fato/relação; REL-001 possui grants/consent/revoke e shell de Portal.

Plano detalhado: `plans/REL-001-EXTERNAL-RELATIONSHIPS-AND-PORTALS.md`.

### ACHEGUESE-001 — integração first-party OrdaX × Achegue-se

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1 de ecossistema

> **Achegue-se descobre e conecta. OrdaX organiza e opera.**

Os produtos permanecem separados em repositório, banco, deployment, identidade visual, roadmap e release. Integração somente por Product OAuth/API/events/projections autorizadas.

Plano detalhado: `plans/ACHEGUESE-001-FIRST-PARTY-PRODUCT-INTEGRATION.md`.

### HARDWARE-001 — Hardware, Drivers e Hardware Packs

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**, salvo recorte que NATIVE-001/owner do MVP já exigir
- **Prioridade preservada:** P1

Evoluir hardware packs assinados/exact-match para Hardware & Drivers com health/rollback.

Plano detalhado: `plans/HARDWARE-001-HARDWARE-DRIVERS-AND-PACKS.md`.

### DESKTOP-001 — Experiência cotidiana

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1

Displays, Help offline, Files providers para MTP/PTP/SMB, UX de Updates e descoberta de apps por intenção sem duplicar owners.

Plano detalhado: `plans/DESKTOP-001-DAILY-USE-EXPERIENCE.md`.

### WEB-001 — OrdaX Web Research

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1

Capability provider-neutral para pesquisa externa compartilhável por Intelligence/Aura/Studio.

Plano detalhado: `plans/WEB-001-WEB-RESEARCH.md`.

### TALENT-001 — identidade profissional, vagas e contratação

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P2

Identidade profissional pertence à pessoa/Account, fora de Space e Profile Pack. Spaces empregadores publicam vagas; contratação humana pode gerar People relationship e convite ao Space separadamente. IA é somente assistiva e não usa atributos sensíveis para decidir contratação.

Plano detalhado: `plans/TALENT-001-PROFESSIONAL-IDENTITY-JOBS-AND-HIRING.md`.

### EDU-001 — OrdaX Education e Portal da Família

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P2

Operação privada da escola no OrdaX: alunos, responsáveis, turmas, presença, notas/boletim, atividades, autorizações, reuniões, documentos, pagamentos e transporte delimitado. Achegue-se permanece owner da descoberta/página pública. Dados de menores nunca viram ads ou conteúdo público por conveniência.

Plano detalhado: `plans/EDU-001-ORDAX-EDUCATION-SCHOOL-AND-FAMILY-PORTAL.md`.

### MARKET-001 — Ofertas, descoberta e Marketplace

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P2

OrdaX pode ser origem operacional de ofertas; Achegue-se é canal territorial natural quando explicitamente vinculado. Publicação é opt-in, revisionada e revogável. Targeting com dados escolares, saúde, menores, Memory, mensagens privadas ou localização sensível é proibido.

Plano detalhado: `plans/MARKET-001-OFFERS-DISCOVERY-AND-MARKETPLACE.md`.

### HEALTH-001 — Healthcare, Clínica e Portal do Paciente

- **Status documental:** TRIAGED
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P3 exploratório

Preserva a direção de clínicas/paciente sem fingir prontidão. Healthcare exige pesquisa própria de dados sensíveis, LGPD, segurança, retenção, interoperabilidade e responsabilidades clínicas antes de promoção para `READY`. Farmácia/dispensação/prescrição precisa de subplano/owner específico antes de qualquer execução.

Plano detalhado: `plans/HEALTH-001-HEALTHCARE-CLINIC-AND-PATIENT-PORTAL.md`.

### Demais planos existentes

`SURFACE-001`, `ECO-001`, `PROFILE-001`, `PERSONAL-001`, `NETWORK-001` e demais itens catalogados permanecem preservados conforme `REGISTRY.md`.

Regra comum:

```text
plano preservado
!=
trabalho autorizado agora
```

## Ordem recomendada de produto — sem transformar prioridade em autorização

```text
P0 AGORA
1. Stable/MVP físico corrente
2. boot/recovery/cold-health/Surface físicos
3. NATIVE-001: USB -> SSD/NVMe/HDD whole-disk
4. hardware mínimo do modelo Native anunciado
5. fechar somente os recortes de pizzaria-br@1 e impressao-3d-br@1 já exigidos pelo MVP

APÓS FECHAR O MVP — REVALIDAR P1
6. MODE-001: Web/Cloud/Device runtime real
7. FAB-001: Fabrication Core + Impressão 3D como primeiro piloto comercial
8. FOOD-001: Food Core + Pizza como segundo piloto comercial
9. IDENTITY-001: colaboração/membros conforme necessidade dos pilotos
10. REL-001: external access/portais; começar por caso de menor risco
11. ACHEGUESE-001: linking first-party read-only real
12. HARDWARE-001: Hardware & Drivers / packs amplos
13. DESKTOP-001: experiência cotidiana
14. PROFILE/PERSONAL/SURFACE gaps reais
15. WEB-001: Web Research/capabilities aditivas

P2 — APÓS REVALIDAÇÃO DAS FUNDAÇÕES
16. TALENT-001: identidade profissional + vagas/contratação
17. EDU-001: Education + Portal da Família
18. MARKET-001: ofertas/marketplace/publicação territorial
19. demais expansões P2

P3 — PESQUISA ANTES DE PRODUTO
20. HEALTH-001: Healthcare/Clinic/Patient Portal; primeiro compliance/threat model/owner
21. demais investigações de alta sensibilidade
```

A ordem é recomendação de triagem, não sequência irrevogável. Fatias horizontais de IDENTITY/REL podem ser promovidas somente quando um piloto autorizado realmente depender delas. ACHEGUESE-001 só avança quando os gates dos dois produtos permitirem. HEALTH-001 não pode ser promovido por analogia com Education.

## Pós-MVP — procedimento de revalidação

Depois que os gates do MVP forem fechados:

1. revalidar `main`, contratos, custos, dependências e owners;
2. revisar itens `READY`/`TRIAGED` e referências ainda relevantes;
3. comparar gaps reais com o estado então implementado;
4. escolher a próxima frente por impacto/dependência real;
5. só então mudar sua elegibilidade para `EXECUTION-ELIGIBLE` e abrir implementação.

Prioridades P1/P2/P3 registradas hoje são **preservação de intenção**, não compromisso automático de sequência futura.

## Regra de promoção

Um item só se torna `EXECUTION-ELIGIBLE` quando existir razão objetiva registrada no owner correto: gate de release, segurança, dependência crítica, impacto/custo comprovado ou decisão arquitetural vigente.

Um chat/agente não pode promover sua própria frente, criar tarefa de implementação ou transformar pesquisa em escopo de MVP por iniciativa própria.

- NATIVE-001 não autoriza flags/escrita física sem contracts/gates.
- FAB/FOOD não inflam Profile Packs mínimos do MVP.
- IDENTITY/REL não autorizam rollout público nem handling de dado sensível só porque os planos existem.
- ACHEGUESE-001 não transforma source OAuth/API em runtime público.
- TALENT/EDU/MARKET não ativam verticais nem publicação.
- HEALTH-001 permanece `TRIAGED` até pesquisa regulatória/segurança e owner explícito.
