# WEB-001 — Deep Research: Web Research no OrdaX OS

- **Tipo:** RESEARCH / ARCHITECTURAL ANALYSIS
- **Status documental:** REFERENCE
- **Execução:** NOT APPLICABLE — recomendações preservadas para eventual plano pós-MVP
- **Data da pesquisa:** 2026-10-14
- **Prioridade resultante:** P1 para reavaliação pós-MVP
- **Plano relacionado:** `../plans/WEB-001-WEB-RESEARCH.md`
- **Natureza:** resumo durável e triado do relatório de Deep Research fornecido ao projeto

> Este documento registra conclusões e números relevantes do relatório de pesquisa. Preços, rate limits e termos de terceiros são snapshots de 14/10/2026 e precisam ser revalidados antes de contratação/rollout. Este relatório não é owner canônico de arquitetura, não prova implementação e não autoriza iniciar trabalho durante a janela atual de fechamento do MVP.

## Conclusão

A pesquisa conclui que Web Research faz sentido como capability sistêmica do OrdaX, porém **fora do kernel, boot, initramfs e Base mínima** e somente quando sua janela de execução for liberada após o MVP.

O OrdaX deve possuir a semântica, política, provenance, grants, orçamento e orquestração. Tavily, Brave, Exa, Firecrawl e outros entram como **adapters substituíveis**.

Contratos propostos:

```text
ordax.web.search/1
ordax.web.extract/1
ordax.web.map/1
ordax.web.crawl/1
ordax.web.research/1
ordax.web.source/1
ordax.web.provenance/1
```

MCP deve ser borda de interoperabilidade externa, não o contrato interno do domínio.

## Stack recomendada

| Papel | Recomendação |
|---|---|
| Contratos/policy | OrdaX próprio |
| Busca geral inicial | Tavily + Brave |
| Busca semântica/deep | Exa opcional |
| Extract/crawl gerenciado | Tavily ou Firecrawl |
| Extract/crawl local | HTTP/Scrapy + Playwright fallback |
| SERP especializado | SerpAPI opcional |
| Knowledge Graph | Diffbot opcional/enterprise |
| Histórico/offline | Common Crawl futuro |
| Research | Orquestrador OrdaX |
| IA externa | OrdaX MCP -> `ordax.web.*` |

A recomendação não é “integrar Tavily ao Aura”. É criar **OrdaX Web** e colocar Tavily atrás de um adapter quando essa frente se tornar elegível para execução.

## Por que isso ajuda a IA local

Web Research não aumenta os pesos/capacidade intrínseca do modelo local. Ele melhora:

- atualidade;
- grounding factual;
- cobertura de documentação rara;
- verificação de versões/notícias;
- comparação de fontes;
- disponibilidade de evidência reduzida e ranqueada.

Para modelos pequenos, o OrdaX deve pré-processar fora do LLM: canonicalizar, deduplicar, ranquear, extrair e selecionar poucas passagens antes de montar contexto.

## Custos Tavily — snapshot da pesquisa

O relatório encontrou, em 14/10/2026:

- aproximadamente **1.000 créditos gratuitos/mês**;
- PAYG na ordem de **US$ 0,008 por crédito**;
- planos mensais efetivos aproximadamente **US$ 0,005–0,0075/crédito**;
- Basic Search normalmente na ordem de 1 crédito;
- extract/crawl/deep podem consumir mais créditos dependendo da operação/configuração.

Conclusão econômica: a cota gratuita é adequada para desenvolvimento/PoC, **não para usuários ilimitados em produção**.

Exemplos teóricos no PAYG, assumindo apenas 1 crédito por busca básica e 30 dias:

| Uso | Créditos/mês | Custo aproximado |
|---|---:|---:|
| 100 usuários x 1 busca/dia | 3.000 | US$ 24 |
| 100 usuários x 5 buscas/dia | 15.000 | US$ 120 |
| 1.000 usuários x 1 busca/dia | 30.000 | US$ 240 |
| 1.000 usuários x 5 buscas/dia | 150.000 | US$ 1.200 |
| 10.000 usuários x 1 busca/dia | 300.000 | US$ 2.400 |

Esses exemplos **subestimam research complexo**, pois uma solicitação pode gerar múltiplas buscas + extracts + retries. Portanto o produto não deve modelar `1 pergunta = 1 crédito`.

## Estratégia econômica recomendada

```text
pergunta
  -> cache/corpus local resolve?
  -> URL conhecida: local extract resolve?
  -> busca simples remota necessária?
  -> Tavily/Brave conforme router/budget
  -> deep research necessário?
  -> multi-provider somente dentro de grant + budget
```

O OrdaX deve medir por operação:

```text
maxRequests
maxCredits
maxUSD
maxPages
maxExternalBytes
deadline
```

E registrar consumo real em receipt. Não oferecer Web Research remoto ilimitado no plano gratuito sem modelo econômico medido.

## Alternativas pesquisadas

- **Brave Search API:** forte segundo search provider e índice independente; política de armazenamento precisa ser respeitada.
- **Exa:** útil para semântica/deep, porém mais caro/latente; não deve definir a semântica de `ordax.web.research`.
- **Firecrawl:** forte em extract/map/crawl; bom para evitar construir crawler robusto logo no início.
- **SerpAPI:** útil para SERPs/verticais específicas; não recomendado como default geral.
- **Diffbot:** mais adequado a Knowledge Graph/extração estruturada enterprise.
- **Common Crawl:** futuro para corpus histórico/offline, não para busca atual em tempo real.
- **Scrapy:** engine local HTTP/crawl madura.
- **Playwright:** browser fallback para JS; não deve ser fetch padrão.
- **SearXNG:** metasearch útil para dev/fallback, mas continua dependente de upstreams.
- **Crawl4AI:** PoC interessante para extract/crawl local, porém não deve virar authority do OS.
- **Haystack/LlamaIndex/LangChain:** podem acelerar experimentação, mas não devem definir contratos do OrdaX.

## Segurança obrigatória

### External egress

Toda chamada remota deve passar pelo modelo de grant/policy do OrdaX e declarar destino/dados/custo/contexto. Credenciais do OrdaX para providers não são tokens do cliente MCP e não devem ser repassadas.

### SSRF

`extract(url)` é potencial primitive de SSRF. Worker local deve bloquear loopback, link-local, private ranges, metadata cloud, schemes indevidos e revalidar redirects/DNS, com limites de bytes/tempo.

### Prompt injection

Conteúdo web é **DATA, nunca AUTHORITY**. Texto obtido de páginas não pode conceder permissões nem acionar Action Gateway por si só.

### Browser isolation

Playwright deve rodar isolado, sem HOME/cookies/secrets/filesystem global/sockets locais, com egress controlado.

### Robots/ToS/licenciamento

`robots.txt` deve ser respeitado por padrão para crawler próprio, mas não equivale a licença de armazenamento/redistribuição. Cache precisa considerar provider policy + site policy + user policy.

## Cache/offline

Camadas recomendadas:

- L0: coalescing de requests concorrentes;
- L1: metadata de busca com TTL curto;
- L2: conteúdo extraído quando política permitir;
- L3: corpus local autorizado/licenciado/dados do usuário/Common Crawl.

Offline-first significa usar cache/corpus com freshness explícita, não fingir conhecimento atual sem rede.

## Research Orchestrator

`ordax.web.research/1` deve controlar, quando implementado:

```text
pergunta
 -> classificação/decomposição
 -> seleção de providers
 -> search
 -> merge/dedupe/ranking
 -> extract
 -> freshness
 -> consultas adicionais quando necessário
 -> comparação de fontes
 -> evidence set
 -> síntese
 -> provenance/citations/receipt
```

Provider-native research pode ser usado como otimização, nunca como definição canônica do contrato.

## Recomendação preservada para reavaliação pós-MVP

Quando `WEB-001` se tornar `EXECUTION-ELIGIBLE`, revalidar custos, contratos, providers e owners antes de usar esta sequência como base:

1. OrdaX Web como capability sistêmica;
2. provider-neutral desde o primeiro contrato;
3. Tavily como possível provider inicial e Brave como segundo índice/fallback;
4. provenance, grants e budget desde a primeira versão;
5. local HTTP extract cedo para reduzir dependência/custo;
6. browser apenas como fallback;
7. OrdaX controlar `research`;
8. nada no caminho crítico de boot;
9. evolução para offline/index próprio somente se uso/custo justificar;
10. não investir pesadamente em agentes autônomos complexos antes de medir essa fundação.
