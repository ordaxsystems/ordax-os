# Roadmap de prioridades — OrdaX OS

Status: **EXECUTION ROUTER**  
Atualizado: **2026-10-14**

Este roadmap ordena frentes. Ele não substitui `docs/CURRENT-STATE.md`, `docs/PROMOTION-GATES.md`, `MVP.md`, contratos ou ADRs.

## P0 — fechar gates atuais do Stable/MVP

A prioridade máxima continua herdada do estado/overlay atual do repositório. Web Research **não deve deslocar estes gates**.

1. **Stable/MVP físico:** consentimento explícito novo para o contexto corrente, seleção segura do alvo, escrita autorizada e prova física do USB final.
2. **Boot/recovery/cold-health canônicos:** validar o ciclo físico real, sem substituir por mock/synthetic proof.
3. **Surface smoke físico:** executar o harness source-controlled e encerrar com `FAIL=0`.
4. **Modo gráfico/Secure Boot e demais provas físicas pendentes:** fechar apenas com evidência canônica no hardware aplicável.

Fonte de execução: `PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md` + `docs/PROMOTION-GATES.md` + contratos correntes.

## P1 — fundações de alto impacto sem bloquear P0

### WEB-001 — OrdaX Web Research

Status: **READY / NOT IMPLEMENTED**

Objetivo: criar uma capability sistêmica provider-neutral compartilhada por Aura, Studio, Files/Search, Personal OrdaX, IA local e IAs externas via OrdaX MCP.

Ordem:

1. confirmar boundaries atuais de Intelligence, Action Gateway, grants e `external-egress`;
2. definir contratos `ordax.web.*` e modelo `source/provenance`;
3. criar provider interface/router sem dependência de Tavily no domínio;
4. integrar Tavily como provider inicial e Brave como search fallback;
5. adicionar budget/cost accounting, receipts, freshness e política de retenção por provider;
6. adicionar local HTTP extract;
7. somente depois adicionar Playwright sandboxed como fallback JS;
8. implementar `ordax.web.research/1` como orquestrador OrdaX;
9. integrar Aura/Studio com fontes/citações sem expor API keys;
10. expandir para Exa/Firecrawl e outros adapters apenas por necessidade medida.

Plano detalhado: `plans/WEB-001-WEB-RESEARCH.md`.

### Outras frentes P1 existentes

Continuam válidas somente conforme o overlay/canônicos atuais: lacunas locais reais, Identity/Entitlements, Spaces/Profile Packs, Memory provider-neutral, distribuição de apps, Product MCP e OrdaX Network limitada do MVP, desde que não desloquem P0.

Não duplicar owners nem promover capacidade futura por antecipação.

## P2 — evolução após o MVP funcional de Web Research

- Local Web Worker robusto com crawl limitado, SSRF hardening e sandbox.
- Cache/index local com freshness explícita.
- Result fusion multi-provider e health scoring.
- Evaluation harness de recall/freshness/custo.
- Research routing mais sofisticado entre local/remote.
- UX avançada de fontes e histórico de pesquisa.

## P3 — longo prazo / opcional

- Common Crawl / corpus histórico offline.
- Knowledge Graph enterprise (ex.: Diffbot adapter).
- SERP especializado sob demanda (ex.: SerpAPI).
- Indexação web em escala própria, somente se custo/controle justificar.

## Regra de promoção

Um item sobe de prioridade apenas quando existir razão objetiva registrada: gate de release, segurança, dependência crítica, impacto/custo comprovado ou decisão arquitetural.

Um chat/agente **não pode promover sua própria frente para P0** apenas porque está trabalhando nela.
