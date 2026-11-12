# ACHEGUESE-002 — proposta anterior de Space de desenvolvimento do Achegue-se

- **Tipo:** PLAN / ROADMAP
- **Status documental:** SUPERSEDED
- **Elegibilidade de execução:** NOT APPLICABLE
- **Prioridade:** histórica
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15

Esta proposta foi substituída após a separação correta entre **operação do produto** e **desenvolvimento horizontal**.

## Sucessores

### Operação do produto Achegue-se

Usar:

`00-PLANOS-PRIORITARIOS/plans/ACHEGUESE-002-ORDAX-OPERATIONS-SPACE.md`

O Space `Achegue-se` representa a operação privada do produto: usuários, empresas, solicitações, territórios, assinaturas, pagamentos, pedidos quando ativos, moderação, suporte, métricas e Aura.

### Desenvolvimento de software

Usar:

`00-PLANOS-PRIORITARIOS/plans/DEV-001-GENERAL-DEVELOPMENT-SPACE.md`

O desenvolvimento do Achegue-se passa a ser um projeto dentro de um **Space geral de Desenvolvimento**, compartilhável com outros projetos como STLForge, sites, apps e serviços. O OrdaX Studio continua sendo ferramenta/app, não um Space.

## Regra substituta

```text
Space Desenvolvimento
 -> Projeto Achegue-se
 -> Studio / Git / CI / Deploy / Docs / Aura

Space Achegue-se
 -> operação real do produto
 -> usuários / empresas / territórios / assinaturas / pagamentos / moderação / métricas / Aura

Achegue-se público
 -> site/app usado pelos usuários
```

O repositório, banco, deploy e owners do Achegue-se continuam independentes do `ordax-os`. `ACHEGUESE-001` continua governando a integração first-party entre os produtos.

Este arquivo permanece apenas para preservar links e histórico. Nenhum novo trabalho deve seguir a arquitetura anterior de `Achegue-se — Desenvolvimento` como Space exclusivo.
