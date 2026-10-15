# ACHEGUESE-001 — Integração first-party OrdaX × Achegue-se

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION
- **Prioridade:** P1
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** OrdaX Product OAuth/Product Gateway + owners próprios do Achegue-se
- **Base factual:** `services/product-oauth/`, `services/product-gateway/`, `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md`, `docs/CURRENT-STATE.md`, e boundary first-party do repositório `washingtonmsdj/acheguese`
- **Relatórios de apoio:** nenhum; integração já possui source/contratos nos dois produtos
- **Dependências:** fechamento do MVP OrdaX, homologação do MVP Achegue-se, Product OAuth público, Network resource boundary; REL-001/TALENT-001/MARKET-001 apenas para expansões futuras

`READY` descreve maturidade documental. Não autoriza implementação. O runtime público da integração permanece fail-closed até os gates próprios passarem.

## Problema

OrdaX e Achegue-se se aproximam em empresas, escolas, vagas, ofertas e relacionamento, mas possuem missões diferentes. Fundi-los criaria acoplamento, duplicação de SSOT e risco de o Achegue-se perder seu foco territorial ou o OrdaX absorver catálogo/SEO/mapa que não pertencem à plataforma.

Ao mesmo tempo, manter os produtos totalmente isolados desperdiçaria Account/Spaces/Network e impediria fluxos valiosos como publicar uma vaga/oferta de um Space no portal territorial.

## Objetivo

Preservar dois produtos independentes e conectá-los por uma boundary first-party versionada:

```text
Achegue-se
território + descoberta + páginas públicas
         ^
         | OAuth / APIs / projections / events
         v
OrdaX
Account + Spaces + operação + Network + Intelligence
```

Princípio de produto:

> **Achegue-se descobre e conecta. OrdaX organiza e opera.**

## Não objetivos

- não mesclar repositórios;
- não mesclar bancos;
- não compartilhar `service_role`/credenciais privilegiadas;
- não criar foreign keys cross-product;
- não obrigar usuário do Achegue-se a possuir OrdaX;
- não tornar Achegue-se dependente da disponibilidade do OrdaX para suas funções básicas;
- não duplicar Mapa/Perto de mim/território no OrdaX;
- não mover operação privada de escola/empresa para o Achegue-se;
- não espelhar todos os campos ou posts automaticamente.

## Estado atual verificado

### Já implementado

No OrdaX:

- Product OAuth authority protocol em source;
- Product Gateway para first-party products;
- client canônico do Achegue-se conhecido e deliberadamente disabled;
- resource boundary read-only de Network para scopes iniciais;
- Network multi-tenant provada;
- contratos/testes que reconhecem Achegue-se como first-party product.

No Achegue-se:

- `docs/03-architecture/ORDAX_FIRST_PARTY_INTEGRATION.md`;
- `docs/contracts/ordax-first-party-integration.json`;
- boundary `src/integrations/ordax`;
- primitivas OAuth/PKCE server-side;
- primitivas de Product Network read-only;
- produto continua independentemente utilizável.

### Parcialmente implementado

- source do OAuth e resources existe nos dois lados;
- apenas scopes read-only iniciais estão previstos;
- ainda não há runtime público real, redirect HTTPS registrado e linking E2E homologado.

### Ausente/não provado

- client público habilitado;
- callback runtime real;
- two-account E2E público;
- write/publication scopes;
- projection de ofertas/vagas/eventos;
- UX final de "Conectar ao OrdaX"/"Publicar no Achegue-se".

## Decisões arquiteturais propostas

### 1. Missões e SSOT permanecem separados

**Achegue-se possui:**

- território;
- Mapa;
- Perto de mim;
- Busca territorial;
- Business/página pública;
- descoberta pública;
- SEO e rotas territoriais;
- seus próprios inbox/notifications conforme owners atuais.

**OrdaX possui:**

- Account;
- Space;
- membership/entitlements;
- operação privada do negócio;
- Network/Identity/Intelligence;
- People/Payments/Finance quando existirem;
- Portal/relações externas conforme REL-001.

### 2. Integração é opt-in e revogável

Uma empresa/escola pode usar Achegue-se sem OrdaX. Se desejar integrar:

```text
Achegue-se owner
 -> Conectar OrdaX
 -> OAuth 2.1 + PKCE
 -> escolher Space elegível
 -> consentir scopes
 -> vínculo revogável
```

### 3. Publicação cruzada é explícita

Exemplos futuros:

- página Business pode indicar vínculo verificado com Space;
- OrdaX Space publica oferta no Achegue-se;
- OrdaX Talent publica vaga territorial;
- OrdaX Education projeta apenas dados públicos institucionais aprovados;
- eventos públicos podem ser projetados quando owner existir.

Cada publicação exige alvo/canal explícito, scope de escrita, event/revision/idempotency, server-side ingest e revoke/update.

### 4. Nenhum dado privado vira projection pública

Proibido projetar para o Achegue-se:

- boletim/frequência individual;
- localização de criança;
- saúde/prontuário;
- financeiro interno;
- folha/equipe privada;
- Memory;
- mensagens privadas;
- documentos privados;
- estoque interno salvo campo/public catalog explicitamente aprovado.

### 5. Sign in with OrdaX é opcional

Achegue-se pode oferecer login/vínculo OrdaX sem eliminar seus próprios caminhos de acesso. Descoberta pública continua sem login quando hoje for pública.

### 6. Falhas são independentes

OrdaX offline/indisponível não derruba catálogo/mapa/Busca do Achegue-se. Achegue-se indisponível não impede operação do Space OrdaX.

## Matriz de integração futura

| Caso | SSOT | Projection/destino |
|---|---|---|
| Página pública de empresa | Achegue-se Business | OrdaX pode apenas vincular/deep-linkar |
| Operação interna da empresa | OrdaX vertical/Space | não projetar automaticamente |
| Oferta local | OrdaX Offer ou Achegue-se owner conforme origem | Achegue-se para descoberta territorial |
| Vaga | OrdaX Talent quando originada no Space | Achegue-se para descoberta territorial |
| Candidatura/processo seletivo | OrdaX Talent | não copiar para catálogo público |
| Escola pública | Achegue-se Education/Business public page | vínculo para Portal OrdaX |
| Boletim/responsáveis | OrdaX Education | somente Portal OrdaX autorizado |
| Network communities | OrdaX Network | Achegue-se consome scopes autorizados |

## Caminhos/owners afetados

OrdaX:

- `services/product-oauth/`;
- `services/product-gateway/`;
- Network resource boundary;
- future publication adapters;
- consent/audit.

Achegue-se:

- `src/integrations/ordax`;
- server-side OAuth functions;
- lifecycle/owners de Business, Education, Jobs, Offers;
- docs/contract de first-party integration.

## Fases

### Fase 0 — auditoria/precondições

- ambos MVPs em estado compatível com integração;
- revalidar client/audience/scopes;
- threat model cross-product;
- definir canonical HTTPS redirects.

### Fase 1 — linking read-only real

- registrar redirect real;
- habilitar listener/callback autorizado;
- two-account E2E;
- conectar/desconectar Space;
- consumir apenas scopes read-only já registrados.

### Fase 2 — UX first-party

- `Conectar OrdaX` no Achegue-se;
- selecionar Space;
- mostrar vínculo/revoke;
- deep links entre página pública e Space/Portal quando autorizado.

### Fase 3 — publication API

Somente depois do read-only estar provado:

- write scopes específicos;
- projection schema;
- publish/update/revoke;
- ofertas/vagas/eventos em owners separados;
- receipts/auditoria.

### Fase 4 — expansão de ecossistema

- MARKET-001;
- TALENT-001;
- EDU-001 public projections;
- outros first-party products pela mesma boundary, sem hardcode exclusivo ao Achegue-se.

## Gates de aceite

- unlink não apaga dados owned pelo outro produto;
- nenhuma tabela cross-product é acessada diretamente;
- token permanece server-side quando contrato exigir;
- scopes mínimos e audience exata;
- Achegue-se funciona sem OrdaX;
- OrdaX funciona sem Achegue-se;
- stale projection rejeitada;
- publication revoke funciona;
- dados privados nunca cruzam boundary por conveniência.

## Segurança/privacidade

- OAuth 2.1 + PKCE;
- state/nonce e redirect allowlist exatos;
- bearer token fora de URL/browser storage proibido conforme boundary atual;
- consentimento por scope;
- server-side revalidation de Space authority;
- audit sem tokens/segredos;
- data minimization.

## Custos/limites

A integração deve começar com APIs e infraestrutura já existente, sem exigir banco compartilhado ou VPS dedicado só para a ponte. Custos de escala/publication devem ser medidos quando houver tráfego real.

## Testes/evidências

- duas contas + múltiplos Spaces;
- wrong audience/redirect/scope negados;
- revoke token/link;
- unlink preserva dados próprios;
- failover independente;
- publication idempotente e revisionada;
- negative tests de dados privados.

## Rollback/degradação

Boundary fica disabled por default até promoção. Se falhar em produção, desligar integração/publication sem retirar funções locais dos dois produtos.

## Próxima ação documental

Manter este plano sincronizado com `washingtonmsdj/acheguese/docs/03-architecture/ORDAX_FIRST_PARTY_INTEGRATION.md` sem transformar nenhum dos dois documentos em SSOT do outro produto.

## Próxima ação de execução

DEFERRED.

## Handoff para outro chat/agente

Nunca fundir Achegue-se no OrdaX nem usar OrdaX como banco obrigatório do Achegue-se. Integrar por Product OAuth/API/events. Missão: Achegue-se descobre/conecta; OrdaX organiza/opera. **DEFERRED FOR EXECUTION**.
