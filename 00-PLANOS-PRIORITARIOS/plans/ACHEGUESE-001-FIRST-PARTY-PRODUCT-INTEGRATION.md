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

OrdaX e Achegue-se se aproximam em empresas, escolas, vagas, ofertas, pedidos e relacionamento, mas possuem missões diferentes. Fundi-los criaria acoplamento, duplicação de SSOT e risco de o Achegue-se perder seu foco territorial ou o OrdaX absorver catálogo/SEO/mapa que não pertencem à plataforma.

Ao mesmo tempo, manter os produtos totalmente isolados desperdiçaria Account/Spaces/Network e impediria fluxos valiosos como publicar uma vaga/oferta de um Space no portal territorial ou encaminhar um pedido iniciado no Achegue-se ao sistema operacional correto do estabelecimento.

## Objetivo

Preservar dois produtos independentes e conectá-los por uma boundary first-party versionada:

```text
Achegue-se
território + descoberta + páginas públicas + jornada de compra/pedido quando ativada
         ^
         | OAuth / APIs / projections / events / provider ports
         v
OrdaX
Account + Spaces + operação + Network + Intelligence
```

Princípio de produto:

> **Achegue-se descobre, conecta e pode iniciar a transação. OrdaX organiza e opera.**

Isso não obriga o OrdaX a ser o owner de todo pedido. O princípio permanente é: **cada pedido possui exatamente um SSOT transacional**.

## Não objetivos

- não mesclar repositórios;
- não mesclar bancos;
- não compartilhar `service_role`/credenciais privilegiadas;
- não criar foreign keys cross-product;
- não obrigar usuário do Achegue-se a possuir OrdaX;
- não tornar Achegue-se dependente da disponibilidade do OrdaX para suas funções básicas;
- não duplicar Mapa/Perto de mim/território no OrdaX;
- não transformar Achegue-se em ERP/KDS/estoque/financeiro completo do estabelecimento;
- não impedir que Achegue-se ofereça carrinho, checkout, criação e acompanhamento de pedido como jornada do consumidor;
- não manter dois masters gravando o mesmo pedido;
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
- produto continua independentemente utilizável;
- a vertical Gastronomy preservada possui superfícies de carrinho, checkout, criação e detalhe de pedido sob `src/modules/business/gastronomy/**`, com persistência/serviços compartilháveis governados pelos owners de `src/core/business/**`; essa vertical permanece pausada no lifecycle atual e a presença do source não autoriza ativação.

### Parcialmente implementado

- source do OAuth e resources existe nos dois lados;
- apenas scopes read-only iniciais estão previstos;
- existe experiência histórica/preservada de pedido no Achegue-se, mas não existe ainda boundary provider-neutral homologada para escolher entre order owner próprio, OrdaX Food ou outro POS/provider;
- ainda não há runtime público real, redirect HTTPS registrado e linking E2E homologado.

### Ausente/não provado

- client público habilitado;
- callback runtime real;
- two-account E2E público;
- write/publication scopes;
- projection de ofertas/vagas/eventos;
- contract de `Order Gateway`/provider-neutral order handoff;
- receipts/idempotency/status mapping para pedido cross-product;
- UX final de `Conectar ao OrdaX`/`Publicar no Achegue-se`.

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
- seus próprios inbox/notifications conforme owners atuais;
- jornada pública de descoberta → catálogo/cardápio → carrinho/checkout → acompanhamento quando a vertical/capability correspondente estiver formalmente ativa.

**OrdaX possui:**

- Account;
- Space;
- membership/entitlements;
- operação privada do negócio;
- Network/Identity/Intelligence;
- People/Payments/Finance quando existirem;
- Portal/relações externas conforme REL-001;
- Order Core operacional quando um vertical OrdaX, como Food, for o provider/SSOT daquele pedido.

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

### 4. Pedido é transação, não projection pública

Pedidos exigem boundary distinta de ofertas/posts.

A experiência pode permanecer totalmente no Achegue-se para o consumidor:

```text
Descobrir negócio
 -> abrir catálogo/cardápio
 -> montar carrinho
 -> checkout
 -> criar pedido
 -> acompanhar status
```

O backend resolve explicitamente o provider daquele merchant:

```text
Achegue-se Order Channel
        |
        v
Order Gateway
   |-- Achegue-se-owned order service
   |-- OrdaX Food
   |-- POS/provider externo homologado
```

Regras:

- exatamente um owner/SSOT transacional por pedido;
- o Achegue-se pode ser SSOT do pedido básico quando o merchant não usa OrdaX e o owner próprio estiver ativo/homologado;
- quando OrdaX Food for escolhido, o pedido canônico pertence ao Food Order Core e Achegue-se mantém apenas seu channel reference/read model autorizado;
- outro POS/provider pode assumir o mesmo papel mediante contrato homologado;
- nunca há dual-write de dois masters para o mesmo pedido;
- criação usa idempotency key e retorna receipt/provider order id canônico;
- status público é mapeado a partir do owner canônico, sem inventar `preparando`, `entregue` ou pagamento confirmado localmente;
- unlink não pode apagar pedido já contratado/confirmado nem quebrar obrigações de retenção/auditoria;
- falha do provider deve aparecer como erro/pending real, sem pedido fantasma.

A presença dessa arquitetura não reativa Gastronomy no MVP atual.

### 5. Nenhum dado privado vira projection pública

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

### 6. Sign in with OrdaX é opcional

Achegue-se pode oferecer login/vínculo OrdaX sem eliminar seus próprios caminhos de acesso. Descoberta pública continua sem login quando hoje for pública.

### 7. Falhas são independentes

OrdaX offline/indisponível não derruba catálogo/mapa/Busca do Achegue-se. Achegue-se indisponível não impede operação do Space OrdaX. Se um merchant escolheu OrdaX como provider de pedidos, somente a criação/sincronização daquele fluxo transacional pode degradar de forma explícita; o portal público não deve fingir aceitação de pedido.

## Matriz de integração futura

| Caso | SSOT | Projection/destino |
|---|---|---|
| Página pública de empresa | Achegue-se Business | OrdaX pode apenas vincular/deep-linkar |
| Operação interna da empresa | OrdaX vertical/Space | não projetar automaticamente |
| Oferta local | OrdaX Offer ou Achegue-se owner conforme origem | Achegue-se para descoberta territorial |
| Pedido iniciado no Achegue-se sem provider externo | owner de pedidos do Achegue-se, quando ativo | Achegue-se mantém pedido e status canônicos |
| Pedido iniciado no Achegue-se com OrdaX Food | OrdaX Food Order Core | Achegue-se mantém channel reference/read model/status autorizado |
| Pedido com POS externo | provider homologado | Achegue-se mantém channel reference/read model autorizado |
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
- future Food/order provider port;
- consent/audit.

Achegue-se:

- `src/integrations/ordax`;
- server-side OAuth functions;
- lifecycle/owners de Business, Education, Jobs, Offers;
- `src/modules/business/gastronomy/**` e owners canônicos em `src/core/business/**` somente quando Gastronomy/order lifecycle for promovido;
- future provider-neutral Order Gateway boundary;
- docs/contract de first-party integration.

## Fases

### Fase 0 — auditoria/precondições

- ambos MVPs em estado compatível com integração;
- revalidar client/audience/scopes;
- threat model cross-product;
- definir canonical HTTPS redirects;
- auditar o order/checkout preservado no Achegue-se antes de criar qualquer novo owner transacional.

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

### Fase 4 — Order Gateway/provider boundary

Somente quando o owner de pedidos do Achegue-se e/ou OrdaX Food estiverem formalmente promovidos:

- definir capability discovery do merchant;
- selecionar provider explicitamente e persistir binding;
- contrato de create/status/cancel quando permitido;
- idempotency/receipt/retry;
- mapping público de status;
- testes Achegue-se-owned, OrdaX Food e provider externo;
- garantir ausência de dual-write.

### Fase 5 — expansão de ecossistema

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
- pedidos possuem exatamente um owner canônico;
- retry de criação não duplica pedido;
- status mostrado ao comprador deriva do owner canônico;
- dados privados nunca cruzam boundary por conveniência.

## Segurança/privacidade

- OAuth 2.1 + PKCE;
- state/nonce e redirect allowlist exatos;
- bearer token fora de URL/browser storage proibido conforme boundary atual;
- consentimento por scope;
- server-side revalidation de Space authority;
- audit sem tokens/segredos;
- data minimization;
- dados de pagamento/receipts seguem owner especializado e nunca são reconstruídos por inference do frontend.

## Custos/limites

A integração deve começar com APIs e infraestrutura já existente, sem exigir banco compartilhado ou VPS dedicado só para a ponte. Custos de escala/publication e processamento transacional devem ser medidos quando houver tráfego real.

## Testes/evidências

- duas contas + múltiplos Spaces;
- wrong audience/redirect/scope negados;
- revoke token/link;
- unlink preserva dados próprios;
- failover independente;
- publication idempotente e revisionada;
- order create idempotente sem duplicidade;
- provider binding não muda silenciosamente em pedido existente;
- status mapping fail-closed para estados desconhecidos;
- negative tests de dados privados.

## Rollback/degradação

Boundary fica disabled por default até promoção. Se falhar em produção, desligar integração/publication sem retirar funções locais dos dois produtos. Para pedidos, indisponibilidade do provider bloqueia nova confirmação quando não houver receipt canônico; nunca criar sucesso local fictício.

## Próxima ação documental

Manter este plano sincronizado com `washingtonmsdj/acheguese/docs/03-architecture/ORDAX_FIRST_PARTY_INTEGRATION.md` e com o SSOT atual de Gastronomy do Achegue-se, sem transformar nenhum desses documentos em SSOT do outro produto.

## Próxima ação de execução

DEFERRED.

## Handoff para outro chat/agente

Nunca fundir Achegue-se no OrdaX nem usar OrdaX como banco obrigatório do Achegue-se. Achegue-se pode oferecer a jornada pública de pedido; o backend escolhe um único order owner por transação. Integrar por Product OAuth/API/events/provider ports. **DEFERRED FOR EXECUTION**.
