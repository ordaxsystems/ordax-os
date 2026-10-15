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

## P0 — gates atuais do Stable/MVP

Somente os gates realmente correntes e comprovados pelos owners canônicos são elegíveis nesta janela. O resumo abaixo é um roteador; valores exatos vêm dos contratos e documentos canônicos.

1. **Stable/MVP físico:** consentimento explícito válido para o contexto corrente, seleção segura do alvo, escrita autorizada e prova física exigida pelo contrato atual.
2. **Boot/recovery/cold-health canônicos:** validar o ciclo físico real quando o owner canônico ainda o exigir, sem substituir por mock/synthetic proof.
3. **Surface smoke físico:** executar o harness source-controlled quando ainda pendente e encerrar com evidência canônica `FAIL=0`.
4. **Modo gráfico/Secure Boot e demais provas físicas pendentes:** fechar somente quando permanecerem pendentes nos owners canônicos atuais e com evidência no hardware aplicável.

Fonte de execução: `docs/CURRENT-STATE.md` + `docs/PROMOTION-GATES.md` + `MVP.md` + contratos correntes. `PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md` é apenas overlay auxiliar.

## Planos preservados — execução adiada até pós-MVP

### MODE-001 — OrdaX Web, Cloud & Device Runtime

- **Status documental:** READY
- **Execução agora:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1 para reavaliação pós-MVP

Direção preservada: completar o wiring real do OrdaX Web sobre a mesma Surface, identidade, apps e owners de serviço, com resolução explícita de capabilities entre `web`, `cloud`, `device` e `hybrid`; Files federado; Loja sem lifecycle simulado; Device Agent somente via Action Gateway; cloud compute opcional e provider-neutral.

O plano fecha uma frente de produto já iniciada e, por isso, deve estar entre os primeiros P1 a serem **revalidados** quando a janela pós-MVP abrir. Isso não concede precedência automática nem autoriza implementação antes dessa revalidação.

Plano detalhado: `plans/MODE-001-WEB-CLOUD-DEVICE-RUNTIME.md`.

Nenhuma fase de implementação de MODE-001 deve ser iniciada antes do fechamento do MVP apenas por causa deste roadmap. Fatias já exigidas por owners canônicos do MVP continuam pertencendo aos respectivos owners.

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

## Pós-MVP — ordem a ser revalidada, não pré-autorizada

Depois que os gates do MVP forem fechados:

1. revalidar `main`, contratos, custos, dependências e owners;
2. revisar itens `READY` e referências ainda relevantes;
3. escolher a próxima frente por impacto/dependência real;
4. só então mudar sua elegibilidade para `EXECUTION-ELIGIBLE` e abrir implementação.

Na reavaliação inicial, `MODE-001` merece inspeção antecipada entre os P1 porque consolida boundaries já iniciados de Web/Conta/Loja/Arquivos/Device Agent e pode evitar backends ou mocks paralelos. `WEB-001` continua P1, mas é uma capability aditiva distinta. Essa observação é recomendação de triagem, não fila automática.

Prioridades P1/P2/P3 registradas hoje são **preservação de intenção**, não compromisso automático de sequência futura.

## Regra de promoção

Um item só se torna `EXECUTION-ELIGIBLE` quando existir razão objetiva registrada no owner correto: gate de release, segurança, dependência crítica, impacto/custo comprovado ou decisão arquitetural vigente.

Um chat/agente não pode promover sua própria frente, criar tarefa de implementação ou transformar pesquisa em escopo de MVP por iniciativa própria.
