# WEB-001 — provider/cost update — 2026-10-14

Status: **TRIAGED RESEARCH / snapshot externo**  
Owner de implementação: `docs/WEB-RESEARCH.md` + `system/contracts/web-research.mjs`  
Este relatório não ativa provider e não substitui contracts/policy.

## Motivo da atualização

A pesquisa profunda original já recomendava arquitetura provider-neutral. Uma nova verificação em 14/10/2026 encontrou mudanças materiais de preço/produto e opções que merecem entrar no benchmark antes de congelar um default.

## Principais mudanças

### Parallel Search — novo candidato forte para busca barata

Fonte oficial consultada: `https://parallel.ai/products/search`.

A página atual anuncia:

- Turbo: cerca de **US$1 / 1.000 requests**;
- Fast: cerca de **US$1 / 1.000 requests**;
- Basic: cerca de **US$5 / 1.000 requests**;
- Advanced: cerca de **US$5 / 1.000 requests**;
- até **80.000 search requests gratuitos** na oferta atual indicada pela página;
- cerca de 600 requests/min de rate limit indicado na página;
- resultado com URLs + excerpts comprimidos e controles de domínio/freshness.

O fornecedor também publica benchmarks contra Tavily/Exa. Esses benchmarks são **evidência do fornecedor**, não proof OrdaX; precisam ser reproduzidos com nosso harness.

**Decisão de pesquisa:** adicionar Parallel ao primeiro benchmark de `search`. Não promovê-lo automaticamente a default antes de medir qualidade/freshness/latência/custo em queries OrdaX.

### Exa — piso de Search menor que no snapshot anterior

Fonte oficial consultada: `https://exa.ai/pricing`.

A página atual informa:

- Free: **US$10 de créditos/mês** + onboarding credit;
- Search a partir de **US$4 / 1.000 requests** para Instant;
- Fast/Auto em torno de **US$7 / 1.000**;
- Deep Search ~**US$12 / 1.000**;
- Deep-Reasoning ~**US$15 / 1.000**;
- Contents ~**US$1 / 1.000 páginas** por content type.

**Decisão de pesquisa:** Exa deixa de ser apenas “deep caro” e merece entrar também no benchmark de search, especialmente para semantic/coding/documentation retrieval.

### Tavily — continua simples e completo, mas não é automaticamente o mais barato

Fonte oficial consultada: `https://www.tavily.com/pricing`.

Snapshot atual:

- **1.000 API credits/mês grátis**;
- PAYG **US$0,008/crédito**;
- Project plan configurável;
- valor continua forte pela combinação Search/Extract/Map/Crawl/Research e integração orientada a agentes.

**Decisão de pesquisa:** Tavily continua excelente candidato para acelerar o Remote MVP e operações além de busca simples. Para `search` puro, custo/qualidade devem ser comparados com Parallel, Brave, Exa e outros.

### Brave Search API — bom baseline independente

Fonte oficial consultada: `https://brave.com/search/api/`.

Snapshot atual:

- Search **US$5 / 1.000 requests**;
- **US$5 de créditos mensais**;
- página indica capacidade de 50 QPS no plano Search;
- índice independente permanece vantagem para diversidade/fallback.

**Decisão de pesquisa:** manter Brave no primeiro benchmark e como forte candidato a fallback/diversificação.

### Kagi API — agregação premium multi-source

Fontes oficiais consultadas:

- `https://kagi.com/products/api`
- `https://help.kagi.com/kagi/api/api-portal.html`

Snapshot atual:

- Search API v1 **US$12 / 1.000 queries**;
- Extract **US$4 / 1.000 extracts/pages** na página de produto;
- Kagi afirma combinar múltiplas fontes e reranking;
- termos precisam ser avaliados antes de retenção/redistribuição de resultados.

**Decisão de pesquisa:** candidato opcional de qualidade/diversidade, não prioridade de custo para o MVP.

### Jina Reader/Search — candidato interessante para extract/search token-based

Fonte oficial consultada: `https://jina.ai/api-dashboard/pricing/`.

Snapshot atual:

- Reader API converte URL para texto LLM-friendly;
- Search API retorna busca + conteúdo em formato amigável a LLM;
- pricing por tokens no Search Foundation API;
- tier gratuito indicado como **non-commercial**;
- paid tiers com token packs e rate limits maiores.

**Decisão de pesquisa:** avaliar principalmente para `extract`/reader e experimentação; o free não deve ser tratado como entitlement comercial do OrdaX.

### Perplexity — Sonar não deve entrar como novo adapter

Fontes atuais consultadas:

- Perplexity announcement/community sobre migração Sonar -> Agent API;
- Perplexity Agent API product announcement.

O fornecedor anunciou aposentadoria dos endpoints Sonar em **27/09/2026** e migração para Agent API, que reúne web search, fetch URL, tools e research.

**Decisão de pesquisa:** não criar novo adapter Sonar. Se Perplexity for avaliado, avaliar **Agent API** como provider-native research/agent, atrás dos contratos OrdaX; nunca como SSOT de `ordax.web.research`.

### SearXNG — permanece útil, mas não substitui índice próprio

Fonte oficial consultada: `https://docs.searxng.org/dev/search_api.html`.

A API continua oferecendo `/search` com formatos como JSON quando habilitados. Self-hosting dá controle de agregação, mas consultas ainda dependem de engines upstream e podem sofrer bloqueios/rate limits.

**Decisão de pesquisa:** dev/fallback/privacidade relativa; não tratar como índice offline independente.

## Novo shortlist do primeiro benchmark

### Search

Obrigatórios no harness inicial, se credenciais/test tiers estiverem disponíveis:

1. Parallel Turbo/Fast;
2. Brave Search;
3. Tavily Basic Search;
4. Exa Instant/Fast.

Opcionais após baseline:

5. Kagi Search;
6. Jina Search;
7. SearXNG self-host/dev;
8. Perplexity Agent API apenas em classe `provider-native research`, não comparação direta simples sem separar custos de modelo/agente.

### Extract

Comparar:

1. local HTTP/parser seguro — quando implementado;
2. Tavily Extract;
3. Exa Contents;
4. Kagi Extract;
5. Jina Reader;
6. Firecrawl.

### Crawl/map

Tavily e Firecrawl continuam os candidatos gerenciados mais óbvios. Local crawl deve nascer limitado e politeness-first; browser não é crawler default.

## Harness obrigatório antes de escolher default

O benchmark OrdaX deve usar um corpus fixado/versionado com classes como:

- versão atual de software;
- documentação técnica rara;
- notícia/fato recente;
- fonte oficial brasileira;
- consulta em PT-BR;
- consulta ambígua;
- query com domínios allow/exclude;
- resultado que exige freshness;
- query com cobertura ruim em um índice;
- pesquisa de código/docs.

Métricas:

- recall/coverage;
- precisão/relevância;
- presença da fonte oficial;
- freshness;
- duplicação;
- latência p50/p95;
- 429/5xx/timeouts;
- bytes retornados;
- custo efetivo por query;
- custo por resposta útil;
- qualidade dos snippets/excerpts;
- retenção/ToS/privacy compatíveis com o uso pretendido.

## Consequência para o roadmap

A ordem antiga “Tavily primário + Brave fallback” vira:

```text
provider-neutral contracts
  -> evaluation harness
  -> benchmark Parallel / Brave / Tavily / Exa
  -> escolher defaults por classe de operação
  -> manter fallback autorizado
```

Isso reduz risco econômico e lock-in sem atrasar a fundação: nenhum provider é necessário para concluir G0/G1.

## Nota econômica

Preços externos mudam. Todos os números acima são **snapshot de 14/10/2026**, não constantes de arquitetura. O router e os budgets devem aceitar configuração/versionamento de custo por provider sem alterar contracts de consumidor.
