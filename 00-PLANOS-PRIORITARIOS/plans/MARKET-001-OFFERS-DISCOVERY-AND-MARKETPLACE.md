# MARKET-001 — Ofertas, descoberta e Marketplace territorial

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION
- **Prioridade:** P2
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** future Commerce/Offers domain no OrdaX para authoring operacional; Achegue-se para descoberta territorial pública quando integrado
- **Base factual:** Spaces/Business directions atuais, Achegue-se Business/territory capabilities, Network/Notifications/Entitlements boundaries
- **Relatórios de apoio:** ACHEGUESE-001
- **Dependências:** ACHEGUESE-001 para distribuição territorial first-party; Notifications/preferences; Payments opcional; Business/vertical owners

`READY` descreve maturidade documental. Não autoriza implementação.

## Problema

Empresas/Spaces podem desejar publicar promoções, ofertas, cupons e campanhas locais. Se cada vertical construir seu próprio feed/anúncios, haverá duplicação de catálogo, segmentação e consentimento. Ao mesmo tempo, transformar o OrdaX numa rede de anúncios comportamentais conflitaria com privacidade e com o papel territorial já natural do Achegue-se.

Marketplace também pode levar a carrinho/checkout/pedido, mas **oferta/publicação e pedido transacional não são o mesmo owner**. Misturar os dois faria um post promocional virar autoridade sobre pagamento, fulfillment e status operacional.

## Objetivo

Definir uma camada de **Offers/Commerce publication** no OrdaX e usar produtos públicos como Achegue-se como canais explícitos de descoberta quando vinculados.

```text
Space da empresa
 -> campanha/oferta aprovada
 -> publicação explícita
 -> projection pública versionada
 -> Achegue-se / outro canal autorizado
 -> descoberta territorial
```

O OrdaX pode exibir ofertas ao usuário quando ele optar por categorias/canais, mas a descoberta territorial pública deve permanecer com o produto que possui território e catálogo público.

Quando uma oferta resultar em compra/pedido, o checkout deve usar uma boundary transacional própria conforme ACHEGUESE-001: exatamente um owner/SSOT do pedido, podendo ser Achegue-se, OrdaX Food ou provider externo homologado.

## Não objetivos

- não criar ad-tech comportamental baseado em rastreamento oculto;
- não usar dados de escola, crianças, saúde, Memory, mensagens privadas ou localização sensível para targeting;
- não duplicar o Achegue-se dentro da Surface;
- não criar outro Apps Store — Marketplace comercial e Loja de apps são domínios diferentes;
- não compartilhar estoque/financeiro interno como publicação pública;
- não publicar automaticamente qualquer alteração de preço do Space;
- não transformar Offer/Campaign em Order Core;
- não manter dois masters para o mesmo pedido;
- não exigir OrdaX para que um merchant do Achegue-se possa futuramente aceitar pedidos por um owner próprio homologado.

## Estado atual verificado

### Já implementado

- Spaces e Profiles;
- Notifications/preferences em arquitetura;
- Achegue-se possui Business, Map, Nearby, Search e território como capacidades próprias;
- integração first-party OrdaX↔Achegue-se possui boundary OAuth/API em source, ainda desativado publicamente;
- Achegue-se preserva source de carrinho/checkout/pedido dentro da vertical Gastronomy, atualmente pausada, portanto sem autorização de runtime público.

### Parcialmente implementado

- verticais como Food/Fabrication podem possuir catálogo/preço no futuro;
- Achegue-se possui módulos futuros de cupons/ofertas/classificados, atualmente pausados conforme lifecycle;
- carrinho/checkout existente no Achegue-se demonstra que a jornada transacional do consumidor é uma capacidade plausível do produto, mas não existe ainda Order Gateway/provider-neutral homologado.

### Ausente

- Offer/Campaign contract compartilhado;
- consent/preferences de recebimento no OrdaX;
- publication projection server-side;
- update/revoke cross-product;
- contract provider-neutral para handoff de checkout/pedido quando aplicável;
- analytics privacy-safe e billing/ad model, se algum dia necessário.

## Decisões arquiteturais propostas

### 1. Oferta é conteúdo público explícito

A oferta publicada deve possuir:

- owner Space;
- título/descrição;
- produto/serviço ou referência pública;
- preço/condição quando aplicável;
- território/alvo público permitido;
- validade;
- imagem/asset autorizado;
- estado/version/revision;
- canais explicitamente escolhidos.

### 2. Publicar não é sincronizar banco

Cross-product usa projection/evento idempotente, revisionado, atualizável e revogável. Achegue-se não lê tabelas privadas do Space.

### 3. Segmentação deve ser baseada em preferência explícita/contexto público

Exemplo permitido:

```text
usuário: quero ofertas de supermercado em até 5 km
```

Exemplo proibido:

```text
usar boletim do filho, prontuário, conversas, Memory ou histórico sensível para inferir anúncio
```

### 4. Achegue-se é canal territorial natural

Achegue-se pode possuir a apresentação, ranking territorial, filtros, SEO e descoberta. OrdaX pode ser uma origem de oferta autorizada, não a única origem. Comerciantes sem OrdaX continuam elegíveis a usar Achegue-se conforme regras do produto.

### 5. Oferta pode abrir checkout, mas não possui o pedido

Fluxo permitido:

```text
Oferta no Achegue-se
 -> usuário escolhe comprar/pedir
 -> checkout autorizado
 -> Order Gateway resolve provider
 -> um único Order Core confirma a transação
```

O Offer ID pode aparecer como referência de origem/atribuição, mas não substitui order id, payment receipt nem status de fulfillment.

### 6. Ad inventory é decisão futura separada

Promoções orgânicas/publicações do próprio negócio não implicam marketplace pago. Cobrança por destaque, sponsored ranking ou bidding exigem plano/compliance/transparência próprios.

## Caminhos/owners afetados

- future Offers/Commerce contract;
- Spaces/Entitlements;
- Notifications/preferences;
- Food/Fabrication/Business owners como fontes;
- Product OAuth/Gateway;
- Achegue-se Business/Search/Nearby/Public surfaces;
- Achegue-se Order Channel/owner transacional apenas por contrato separado quando checkout existir;
- Payments somente se checkout for futuro.

## Fases

### Fase 0 — auditoria/precondições

- taxonomia de conteúdo comercial;
- regras de targeting proibido;
- boundary com Achegue-se;
- lifecycle de preço/validade/revoke;
- separar explicitamente projection de oferta de transação de pedido.

### Fase 1 — fundação

- Offer/Campaign schema;
- public projection;
- revision/idempotency;
- publish/update/revoke;
- preferences/opt-in.

### Fase 2 — implementação mínima

- Space cria oferta;
- preview público;
- escolhe canal autorizado;
- publica;
- Achegue-se recebe projection e mostra territorialmente quando sua vertical estiver ativa;
- usuário pode seguir categorias/empresas sem profiling sensível.

### Fase 3 — hardening

- moderação;
- anti-spam/fraud;
- price/validity checks;
- rate limits;
- audit;
- transparency labels.

### Fase 4 — integração/rollout

- Food promotions;
- retail/local business;
- Fabrication catalog campaigns;
- coupons/loyalty quando owners existirem;
- eventual CTA de checkout somente pela boundary transacional de ACHEGUESE-001, sem mover Order Core para MARKET-001.

## Gates de aceite

- nenhuma oferta é publicada por default;
- unlink/revoke interrompe publicação futura;
- update stale é rejeitado;
- dados internos permanecem privados;
- usuário controla categorias/notificações;
- targeting sensível é proibido por contrato/policy;
- Achegue-se continua utilizável sem OrdaX;
- oferta nunca é tratada como confirmação de pedido/pagamento;
- checkout, se existir, retorna receipt de um único owner transacional.

## Segurança/privacidade

- opt-in claro;
- frequência controlável;
- sem dark patterns;
- sem cross-use de dados escolares/saúde/crianças;
- logs e analytics minimizados;
- sponsored content, se futuro, precisa rótulo explícito e política própria.

## Custos/limites

Publicação básica pode operar com infraestrutura existente/API. Media/CDN, push e eventual billing adicionam custos depois. Nenhum ad network externo é requisito.

## Testes/evidências

- publish/update/revoke idempotentes;
- Offer A não vaza detalhes privados do Space A;
- usuário opt-out para notificações;
- cross-product stale revision rejeitada;
- expired offer deixa de aparecer sem apagar histórico de auditoria;
- CTA de checkout não cria pedido duplicado em retry e não usa Offer como receipt.

## Rollback/degradação

Falha do Achegue-se/canal não bloqueia operação do Space. Oferta pode ficar `publication_pending/error` sem fingir que foi publicada. Falha de provider transacional deve bloquear/indicar falha do checkout, nunca converter publicação de oferta em pedido aceito.

## Próxima ação documental

Revalidar após ACHEGUESE-001 e depois que um vertical comercial real possuir catálogo/campanhas úteis. Não criar um segundo Order Core neste plano.

## Próxima ação de execução

DEFERRED.

## Handoff para outro chat/agente

Não construir feed publicitário genérico dentro do OrdaX. OrdaX pode author/publish; Achegue-se é canal territorial natural e continua independente. Oferta e pedido são owners diferentes; checkout resolve exatamente um provider transacional. Nunca usar dados sensíveis para segmentação. **DEFERRED FOR EXECUTION**.
