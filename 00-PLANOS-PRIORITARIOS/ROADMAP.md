# Roadmap de prioridades — OrdaX OS

Status: **EXECUTION ROUTER**  
Atualizado: **2026-10-14**  
Revalidado contra: `main@ef6c111fb6fadc7eba2c63fe51e2abb50e44af58`

Este roadmap ordena frentes. Ele não substitui `docs/CURRENT-STATE.md`, `docs/PROMOTION-GATES.md`, `MVP.md`, contratos ou ADRs. O relatório de auditoria corrente é `reports/PLAN-AUDIT-2026-10-14.md`.

## P0 — gates correntes do Stable/MVP

Os P0 físicos/release continuam vencendo qualquer nova iniciativa. Como os planos longos possuem snapshots históricos, o estado exato de cada gate deve ser lido em `docs/PROMOTION-GATES.md` e nos contratos/evidências atuais, não inferido de SHAs antigos.

Classes P0 atuais:

1. autorização/seleção/escrita física somente no contexto canônico corrente;
2. boot/recovery/cold-health reais do Stable/MVP, sem mock/synthetic proof;
3. smoke físico da Surface e hardware/graphical/Secure Boot conforme gates atuais;
4. qualquer regressão crítica de trust, integridade, rollback ou physical writer.

`WEB-001` não desloca esses gates e não exige build de kernel/Portable quando os paths alterados não têm dependência real nesses artefatos.

## P1 — fundações de alto impacto em paralelo seguro

### WEB-001 — OrdaX Web Research

Status: **ACTIVE — G0 PASS_SOURCE / G1 IN PROGRESS**

Já executado:

- owners atuais auditados;
- owner canônico criado em `docs/WEB-RESEARCH.md`;
- contratos provider-neutral `search`, `extract`, `source`, `provenance`, provider interface iniciados;
- authority fields proibidos nos requests/result metadata;
- conteúdo externo classificado como não confiável;
- tests source adicionados;
- pesquisa de providers/custos atualizada.

Próxima ordem:

1. rodar CI/testes da fundação e corrigir regressões reais;
2. fechar provider router/service sem hard-code de marca;
3. projetar remote execution sobre Action Gateway/grant/`external-egress`/budget já existentes;
4. definir usage/receipt/errors;
5. criar evaluation harness;
6. benchmark inicial: Parallel, Brave, Tavily, Exa;
7. escolher primeiro provider por evidência, não por preferência prévia;
8. depois adicionar local HTTP extract seguro;
9. somente mais tarde `ordax.web.research/1`, browser fallback e integrações Aura/Studio.

Plano: `plans/WEB-001-WEB-RESEARCH.md`.

### PROFILE-001 — Profiles

Foundation já avançou bastante. Não reiniciar provisioning/Memory/context/consent. Próximo valor real é fechar `first-public-profile-proof` de um Profile canônico não regulado com trust/publicação/receipt/health/revisão válidos.

### PERSONAL-001 — Personal OrdaX

Foreground seguro, grants/Gateway/Executor, Work/Activity/Results, Background Runtime e Scheduler já possuem foundation. Próximas ativações públicas continuam condicionadas a host/composition/policy/evidência; não expor autonomia só porque os contracts existem.

### NETWORK-001 — OrdaX Network

Continua plano canônico de produto do recorte Network MVP. Source/backend v1/v2 já avançaram; ativação pública continua separada/fail-closed. Trabalhar somente nos gaps atuais do owner `system/network/` e contratos, não reconstruir directory/messages/groups.

### INTEL-002/003 — Intelligence transport closure

Continuar a boundary Web/remote + Native service sem criar segundo Intelligence/model-router/Memory owner. Provider externo e remote deployment continuam gates independentes.

## P2 — evolução após foundations comprovadas

- Web Research: local safe extract, cache/index, result fusion, provider health scoring, browser fallback sandboxed e research orchestration.
- Personal OrdaX: background/autonomy pública apenas com rollout explícito e receipts/gates completos.
- Profiles: distribuição remota real/Store após first-public-profile-proof.
- Sync/Mobile/Desktop: continuidade pública somente após transport/E2E reais.
- Surface/apps: melhorias de uso devem nascer de gaps revalidados, não da fila histórica do plano grande.

## P3 — longo prazo / opcional

- Common Crawl / corpus histórico offline;
- Knowledge Graph enterprise;
- SERP especializado;
- índice web em escala própria somente se custo/controle justificar;
- recursos experimentais de produto sem gate atual.

## Planos históricos e referências

- `PLANO-02-*` não é fila atual; é referência de legado/migração.
- `PLANO-03-*` preserva baseline pré-USB; gates atuais ficam nos canônicos.
- `PLANO-FUNCIONAL-SURFACE-E-APPS.md` é referência funcional/ledger, não snapshot.
- `PLANO-00-*` permanece overlay transitório, mas seu cabeçalho está stale; este Roadmap é o router prático de prioridade.

## Regra de promoção

Um item sobe de prioridade somente por gate de release, segurança, dependência crítica, impacto/custo comprovado ou decisão arquitetural registrada. Um chat/agente não promove sua própria frente para P0.

## Regra de CI/build

Validar **somente artefatos afetados e dependências justificadas**. Uma mudança documental ou de contrato Web Research não deve reconstruir kernel, initramfs, Portable image ou outros artefatos pesados sem dependência real. Gates globais podem existir para integração/release, mas não devem ser confundidos com necessidade de rebuild por path.
