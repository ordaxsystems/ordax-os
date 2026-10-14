# <ID> — <Título do plano>

- **Tipo:** PLAN / ROADMAP
- **Status documental:** INBOX | TRIAGED | READY | ACTIVE | BLOCKED | REFERENCE | DONE | SUPERSEDED | ARCHIVED
- **Elegibilidade de execução:** EXECUTION-ELIGIBLE | DEFERRED FOR EXECUTION | NOT APPLICABLE
- **Prioridade:** P0 | P1 | P2 | P3
- **Criado:** YYYY-MM-DD
- **Atualizado:** YYYY-MM-DD
- **Owner canônico:** <arquivo/contrato/service owner>
- **Base factual:** <main + docs/source verificados>
- **Relatórios de apoio:** <paths>
- **Dependências:** <IDs/contratos/gates>

`READY` descreve maturidade documental. Não autoriza implementação. A elegibilidade de execução deve ser compatível com `00-PLANOS-PRIORITARIOS/ROADMAP.md` e com os owners canônicos atuais.

## Problema

## Objetivo

## Não objetivos

## Estado atual verificado

Separar explicitamente:

- já implementado;
- parcialmente implementado;
- ausente;
- desconhecido/não provado.

Estado factual deve convergir para `docs/CURRENT-STATE.md`, contratos, evidence ou owner canônico; não usar este plano como changelog infinito.

## Decisões arquiteturais propostas

Proposta não altera contrato, ADR, MVP ou owner por si só.

## Caminhos/owners afetados

Não inventar paths finais antes de verificar a arquitetura atual.

## Fases

### Fase 0 — auditoria/precondições

### Fase 1 — fundação

### Fase 2 — implementação mínima

### Fase 3 — hardening

### Fase 4 — integração/rollout

Fases podem ser documentadas enquanto o plano estiver `DEFERRED FOR EXECUTION`, mas não devem ser iniciadas nessa condição.

## Gates de aceite

## Segurança/privacidade

## Custos/limites

Se houver terceiros, registrar data dos preços/limites e política de revalidação.

## Testes/evidências

## Rollback/degradação

## Próxima ação documental

Registrar somente a próxima ação de documentação/auditoria quando a execução estiver adiada. Não transformar esta seção em autorização implícita para abrir implementação.

## Próxima ação de execução

Preencher somente quando `EXECUTION-ELIGIBLE`; caso contrário, escrever `DEFERRED`.

## Handoff para outro chat/agente

Incluir o mínimo necessário para retomar sem depender de memória da conversa e repetir explicitamente a elegibilidade de execução.
