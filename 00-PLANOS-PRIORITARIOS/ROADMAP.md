# Roadmap de prioridades — OrdaX OS

Status: **EXECUTION ROUTER**  
Atualizado: **2026-10-14**

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

O plano fecha uma frente de produto já iniciada e, por isso, deve estar entre os primeiros P1 a serem **revalidados** quando a janela pós-MVP abrir. Isso não concede precedência automática nem autoriza implementação antes dessa revalidação.

Plano detalhado: `plans/MODE-001-WEB-CLOUD-DEVICE-RUNTIME.md`.

Nenhuma fase de implementação de MODE-001 deve ser iniciada antes do fechamento do MVP apenas por causa deste roadmap. Fatias já exigidas por owners canônicos do MVP continuam pertencendo aos respectivos owners.

### HARDWARE-001 — Hardware, Drivers e Hardware Packs

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**, salvo recorte que NATIVE-001/owner do MVP já exigir
- **Prioridade preservada:** P1

Direção: transformar a estratégia já prevista de `small-baseline-plus-signed-hardware-packs` numa experiência de Hardware & Drivers com exact modalias/kernel ABI, assinatura, staging, health, known-good e rollback.

Não adotar APT/DKMS/driver manager de outra distribuição como arquitetura. Detection, pack availability e support claim permanecem verdades distintas.

Plano detalhado: `plans/HARDWARE-001-HARDWARE-DRIVERS-AND-PACKS.md`.

Áudio/suspend necessários ao hardware oficialmente anunciado no Native MVP pertencem ao fechamento P0 daquele modelo; o gerenciador amplo de packs continua P1.

### DESKTOP-001 — Experiência cotidiana

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**, salvo promoção por owner canônico
- **Prioridade preservada:** P1

Direção: completar lacunas cotidianas sem duplicar Surface/Files/Diagnostics/Update:

- Tela e monitores com apply/revert seguro;
- Ajuda/Primeiros passos offline integrada aos docs e diagnóstico;
- Files providers para MTP/PTP/telefone USB e SMB;
- UX de Updates mais clara sobre o updater existente;
- descoberta de apps por intenção sobre catálogo oficial;
- Theme Packs somente depois, como P2 interno.

Plano detalhado: `plans/DESKTOP-001-DAILY-USE-EXPERIENCE.md`.

### WEB-001 — OrdaX Web Research

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1 para reavaliação pós-MVP

Direção preservada: capability sistêmica provider-neutral compartilhável por Aura, Studio, Files/Search, Personal OrdaX, IA local e IAs externas via OrdaX MCP, sem colocar Tavily/Brave/Exa/Firecrawl no domínio do produto.

Plano detalhado: `plans/WEB-001-WEB-RESEARCH.md`.

Nenhuma fase de implementação de WEB-001 deve ser iniciada antes do fechamento do MVP apenas por causa deste roadmap.

### Demais planos existentes

`SURFACE-001`, `ECO-001`, `PROFILE-001`, `PERSONAL-001`, `NETWORK-001` e demais itens catalogados permanecem preservados conforme `REGISTRY.md`.

Regra comum:

```text
plano preservado
!=
trabalho autorizado agora
```

Se um comportamento descrito nesses planos já for requisito real do MVP, seu trabalho é governado pelo owner canônico correspondente. O plano não cria uma segunda fila de execução.

## Ordem recomendada de produto — sem transformar P1 em autorização

A ordem estratégica atual fica assim:

```text
P0 AGORA
1. Stable/MVP físico corrente
2. boot/recovery/cold-health/Surface físicos
3. NATIVE-001: USB -> SSD/NVMe/HDD whole-disk
4. hardware mínimo do modelo Native anunciado

APÓS FECHAR O MVP — REVALIDAR
5. MODE-001: Web/Cloud/Device runtime real
6. HARDWARE-001: Hardware & Drivers / packs amplos
7. DESKTOP-001: Displays, Help, Files providers, Update UX
8. PROFILE/PERSONAL/SURFACE gaps que permanecerem reais
9. WEB-001: Web Research e demais capabilities aditivas
10. expansões P2/P3
```

Esta ordem é recomendação de triagem, não uma sequência irrevogável. Mudanças na `main`, dependências ou risco podem alterar a ordem no momento da promoção.

## Pós-MVP — procedimento de revalidação

Depois que os gates do MVP forem fechados:

1. revalidar `main`, contratos, custos, dependências e owners;
2. revisar itens `READY` e referências ainda relevantes;
3. comparar gaps reais com o estado então implementado;
4. escolher a próxima frente por impacto/dependência real;
5. só então mudar sua elegibilidade para `EXECUTION-ELIGIBLE` e abrir implementação.

Na reavaliação inicial, `MODE-001` merece inspeção antecipada porque consolida boundaries já iniciados de Web/Conta/Loja/Arquivos/Device Agent. `HARDWARE-001` e `DESKTOP-001` vêm logo depois como maturidade do computador cotidiano. `WEB-001` continua P1, mas é uma capability aditiva distinta.

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

Não importar Calamares, Timeshift, APT/Flatpak, MATE/Compiz ou outro stack externo para resolver superficialmente problemas que o OrdaX já possui owner próprio.

## Regra de promoção

Um item só se torna `EXECUTION-ELIGIBLE` quando existir razão objetiva registrada no owner correto: gate de release, segurança, dependência crítica, impacto/custo comprovado ou decisão arquitetural vigente.

Um chat/agente não pode promover sua própria frente, criar tarefa de implementação ou transformar pesquisa em escopo de MVP por iniciativa própria.

Para NATIVE-001, esta regra significa: o plano organiza um escopo já presente no MVP, mas **não** pode ligar `native_install_capability_enabled`, permitir escrita em disco interno ou selecionar alvo físico sem que os owners/contracts/gates canônicos tenham chegado ao estado exigido.
