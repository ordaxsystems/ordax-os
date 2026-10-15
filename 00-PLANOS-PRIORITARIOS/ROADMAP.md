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

O primeiro Native não inclui dual boot, shrink automático nem editor manual de partições. O USB de origem continua proibido como alvo. O target permanece identity-bound e revalidado antes do APPLY.

## Planos preservados — execução adiada até pós-MVP

### MODE-001 — OrdaX Web, Cloud & Device Runtime

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1 para reavaliação pós-MVP

Direção preservada: completar o wiring real do OrdaX Web sobre a mesma Surface, identidade, apps e owners de serviço, com resolução explícita de capabilities entre `web`, `cloud`, `device` e `hybrid`; Files federado; Loja sem lifecycle simulado; Device Agent somente via Action Gateway; cloud compute opcional e provider-neutral.

Plano detalhado: `plans/MODE-001-WEB-CLOUD-DEVICE-RUNTIME.md`.

### FAB-001 — OrdaX Fabrication e piloto Impressão 3D

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**, exceto qualquer comportamento de `impressao-3d-br@1` já explicitamente exigido pelos owners canônicos do MVP
- **Prioridade preservada:** P1 estratégico e **primeiro vertical comercial recomendado** para reavaliação pós-MVP após MODE-001

Direção preservada: construir **OrdaX Fabrication** como domínio compartilhado de fabricação digital e usar **Impressão 3D como primeiro vertical comercial real**, com a operação/loja existente como piloto de dogfooding.

```text
cliente
 -> orçamento
 -> pedido
 -> arquivo/modelo
 -> produção
 -> job
 -> impressora
 -> material
 -> qualidade
 -> acabamento
 -> embalagem/entrega
 -> custo/lucro
```

Plano detalhado: `plans/FAB-001-ORDAX-FABRICATION-3D-PRINTING-PILOT.md`.

A primeira ação quando a janela abrir deve ser **auditar owners e implementar o Fabrication Core de negócio/produção**, não começar por UI visual, IA autônoma ou compatibilidade com dezenas de modelos de impressora. `impressao-3d-br@1` atual continua cumprindo seu recorte pequeno do MVP e não deve ser inflado pelo FAB-001.

### FOOD-001 — OrdaX Food e piloto Pizza

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**, exceto qualquer comportamento de `pizzaria-br@1` já explicitamente exigido pelos owners canônicos do MVP
- **Prioridade preservada:** P1 estratégico; segundo vertical comercial recomendado após FAB-001

Direção preservada: construir **OrdaX Food** como domínio compartilhado de alimentação e usar **Pizza/Pizzaria como primeiro vertical da família Food**, sem criar segunda conta, segundo backend ou segundo runtime.

O plano cobre Menu, pizza builder, Orders, POS, KDS, produção, estoque/fichas técnicas, compras, CRM, WhatsApp oficial, delivery, pagamentos, financeiro operacional, mesas/comandas, equipe/permissões, Intelligence e offline/edge.

Plano detalhado: `plans/FOOD-001-ORDAX-FOOD-PIZZA-PILOT.md`.

### IDENTITY-001 — Membros, convites e acesso a Spaces

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1 horizontal

Fecha a lacuna entre o membership backend já existente e uma UX completa de colaboração: convite, aceite, expiração, revogação, roles `owner/admin/member/viewer`, mudança de papel, saída, ownership transfer e audit receipts.

Regra central:

```text
funcionário/People != membership/login
participante externo != member interno
```

Food, Fabrication, Education e futuros verticais devem reutilizar este owner em vez de criar sistemas de usuários próprios.

Plano detalhado: `plans/IDENTITY-001-SPACE-MEMBERS-INVITES-AND-ACCESS.md`.

### REL-001 — Relações externas e portais

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1 horizontal

Cria a fundação para clientes, pais/responsáveis, alunos e outros atores externos acessarem somente projections/actions autorizadas sem virarem membros internos do Space.

```text
owner do domínio mantém o fato/relação
 -> REL-001 concede acesso limitado
 -> Portal Web/Mobile
```

O primeiro piloto futuro deve preferir um caso de risco menor, como acompanhamento de pedido/orçamento, antes de dados de menores ou saúde.

Plano detalhado: `plans/REL-001-EXTERNAL-RELATIONSHIPS-AND-PORTALS.md`.

### ACHEGUESE-001 — integração first-party OrdaX × Achegue-se

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1 de ecossistema; somente depois dos gates próprios dos dois produtos

Princípio preservado:

> **Achegue-se descobre e conecta. OrdaX organiza e opera.**

Os produtos continuam separados em repositório, banco, deployment, identidade visual, roadmap e release. A integração usa Product OAuth/API/events/projections autorizadas. Achegue-se permanece owner de território, Mapa, Perto de mim, Business público e descoberta; OrdaX permanece owner de Account, Spaces, operação privada, Network e Intelligence.

Plano detalhado: `plans/ACHEGUESE-001-FIRST-PARTY-PRODUCT-INTEGRATION.md`.

### HARDWARE-001 — Hardware, Drivers e Hardware Packs

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**, salvo recorte que NATIVE-001/owner do MVP já exigir
- **Prioridade preservada:** P1

Direção: transformar a estratégia já prevista de `small-baseline-plus-signed-hardware-packs` numa experiência de Hardware & Drivers com exact modalias/kernel ABI, assinatura, staging, health, known-good e rollback.

Plano detalhado: `plans/HARDWARE-001-HARDWARE-DRIVERS-AND-PACKS.md`.

### DESKTOP-001 — Experiência cotidiana

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**, salvo promoção por owner canônico
- **Prioridade preservada:** P1

Direção: Displays, Help offline, Files providers para MTP/PTP/SMB, UX de Updates e descoberta de apps por intenção, sem duplicar owners existentes.

Plano detalhado: `plans/DESKTOP-001-DAILY-USE-EXPERIENCE.md`.

### WEB-001 — OrdaX Web Research

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1

Capability sistêmica provider-neutral compartilhável por Aura, Studio, Files/Search, Personal OrdaX, IA local e IAs externas via OrdaX MCP.

Plano detalhado: `plans/WEB-001-WEB-RESEARCH.md`.

### TALENT-001 — identidade profissional, vagas e contratação

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P2

A identidade profissional pertence à pessoa/Account, fora do Space e fora de Profile Pack. Spaces empregadores publicam vagas; Network/Messaging suportam descoberta/conversa; contratação humana pode gerar People relationship e convite ao Space separadamente.

Matching de IA é apenas assistivo, explicável e limitado a requisitos profissionais objetivos; não decide contratação nem usa atributos sensíveis.

Plano detalhado: `plans/TALENT-001-PROFESSIONAL-IDENTITY-JOBS-AND-HIRING.md`.

### EDU-001 — OrdaX Education e Portal da Família

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P2

Define a operação privada da escola no OrdaX: alunos, responsáveis, turmas, presença, notas/boletim, atividades, autorizações, reuniões, documentos, pagamentos e transporte delimitado. Pais/alunos entram pelo REL-001; equipe usa People + membership quando aplicável.

Achegue-se continua dono da página/descoberta pública da escola. Dados de menores, boletim, faltas e localização não viram conteúdo público. Câmera de sala e rastreamento contínuo ficam fora do primeiro rollout e exigem gates dedicados.

Plano detalhado: `plans/EDU-001-ORDAX-EDUCATION-SCHOOL-AND-FAMILY-PORTAL.md`.

### MARKET-001 — Ofertas, descoberta e Marketplace

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P2

OrdaX pode ser origem operacional de oferta/campanha; Achegue-se é o canal territorial natural de descoberta quando explicitamente vinculado. Não há publicação automática, banco compartilhado ou targeting comportamental baseado em dados privados.

Proibido usar dados escolares, saúde, menores, Memory, mensagens privadas ou localização sensível para publicidade.

Plano detalhado: `plans/MARKET-001-OFFERS-DISCOVERY-AND-MARKETPLACE.md`.

### Demais planos existentes

`SURFACE-001`, `ECO-001`, `PROFILE-001`, `PERSONAL-001`, `NETWORK-001` e demais itens catalogados permanecem preservados conforme `REGISTRY.md`.

Regra comum:

```text
plano preservado
!=
trabalho autorizado agora
```

## Ordem recomendada de produto — sem transformar prioridade em autorização

A ordem estratégica atual fica assim:

```text
P0 AGORA
1. Stable/MVP físico corrente
2. boot/recovery/cold-health/Surface físicos
3. NATIVE-001: USB -> SSD/NVMe/HDD whole-disk
4. hardware mínimo do modelo Native anunciado
5. fechar somente os recortes de pizzaria-br@1 e impressao-3d-br@1 já exigidos pelo MVP

APÓS FECHAR O MVP — REVALIDAR P1
6. MODE-001: Web/Cloud/Device runtime real
7. FAB-001: Fabrication Core + Impressão 3D como primeiro piloto comercial real
8. FOOD-001: Food Core + Pizza como segundo piloto comercial
9. IDENTITY-001: colaboração/membros conforme necessidade dos pilotos multiusuário
10. REL-001: external access/portais; começar por caso de menor risco
11. ACHEGUESE-001: linking first-party read-only real entre produtos
12. HARDWARE-001: Hardware & Drivers / packs amplos
13. DESKTOP-001: Displays, Help, Files providers, Update UX
14. PROFILE/PERSONAL/SURFACE gaps que permanecerem reais
15. WEB-001: Web Research e demais capabilities aditivas

P2 — SOMENTE APÓS REVALIDAÇÃO DAS FUNDAÇÕES
16. TALENT-001: identidade profissional + vagas/contratação
17. EDU-001: Education + Portal da Família
18. MARKET-001: ofertas/marketplace/publicação territorial
19. demais expansões P2/P3
```

Esta ordem é recomendação de triagem, não sequência irrevogável. IDENTITY-001/REL-001 podem ter fatias antecipadas somente quando um piloto autorizado realmente depender delas; isso não cria uma frente paralela automática. ACHEGUESE-001 só avança quando os gates de ambos os produtos permitirem.

## Pós-MVP — procedimento de revalidação

Depois que os gates do MVP forem fechados:

1. revalidar `main`, contratos, custos, dependências e owners;
2. revisar itens `READY` e referências ainda relevantes;
3. comparar gaps reais com o estado então implementado;
4. escolher a próxima frente por impacto/dependência real;
5. só então mudar sua elegibilidade para `EXECUTION-ELIGIBLE` e abrir implementação.

Na reavaliação inicial, `MODE-001` merece inspeção antecipada porque consolida boundaries já iniciados de Web/Conta/Loja/Arquivos/Device Agent. **FAB-001 vem em seguida** porque a operação real de impressão 3D permite dogfooding diário. `FOOD-001` prova generalização para outro setor. IDENTITY-001 e REL-001 devem ser promovidos de forma incremental quando multiusuário e portais externos deixarem de ser opcionais nos pilotos. ACHEGUESE-001 deve preservar a independência do produto territorial e começar read-only. TALENT/EDU/MARKET ficam depois das foundations correspondentes.

Prioridades P1/P2/P3 registradas hoje são **preservação de intenção**, não compromisso automático de sequência futura.

## Relatório comparativo de referência

`reports/COMP-001-SPACED-LINUX-ORDAX-COMPARISON.md` registra a auditoria que levou a NATIVE-001/HARDWARE-001/DESKTOP-001.

Regra resultante:

```text
feature vista em outro sistema
 -> procurar owner/implementação equivalente no OrdaX
 -> se já existe, completar no owner atual
 -> se parcial, fechar wiring/gates
 -> só criar capability nova quando a lacuna for real
```

## Regra de promoção

Um item só se torna `EXECUTION-ELIGIBLE` quando existir razão objetiva registrada no owner correto: gate de release, segurança, dependência crítica, impacto/custo comprovado ou decisão arquitetural vigente.

Um chat/agente não pode promover sua própria frente, criar tarefa de implementação ou transformar pesquisa em escopo de MVP por iniciativa própria.

Para NATIVE-001, o plano organiza um escopo já presente no MVP, mas **não** pode ligar flags ou autorizar escrita física sem owners/contracts/gates canônicos.

Para FAB-001/FOOD-001, os planos orientam execução futura sem inflar os Profile Packs mínimos do MVP.

Para IDENTITY-001/REL-001, a existência de membership ou de um caso de portal não autoriza automaticamente rollout público ou handling de dados sensíveis.

Para ACHEGUESE-001, source OAuth/API existente não significa runtime público: client, redirect, listener, scopes e E2E continuam gated.

Para TALENT-001/EDU-001/MARKET-001, documentação pronta não ativa as verticais, não cria anúncios, não publica dados e não transforma o roadmap em fila de implementação.
