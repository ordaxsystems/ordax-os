# FOOD-001 — OrdaX Food e piloto Pizza

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION, exceto o recorte `pizzaria-br@1` que já for exigido pelos owners canônicos do MVP
- **Prioridade:** P1 estratégico pós-MVP; o recorte atual de prova pública do Profile Pizzaria continua governado pelo MVP/PROFILE owner
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** `system/profile-packs/`, `docs/OPERATIONAL-REALTIME.md`, `docs/contracts/operational-realtime.json`, `docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md`, owners canônicos de Account/Spaces/Entitlements/Store/Applications/Intelligence
- **Base factual:** `main` verificada em 2026-10-15; `pizzaria-br@1` já existe como Profile Pack first-party ativo e demonstrável
- **Relatórios de apoio:** `PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md`, `INTELLIGENCE-HANDOFF.md`
- **Dependências:** PROFILE-001, MODE-001, Account/Spaces, Entitlements, Operational Realtime, Action Gateway/Device Agent quando houver equipamento local, Intelligence/Model Router, Store/Billing quando monetização for promovida

`READY` descreve maturidade documental. Este plano **não autoriza** iniciar o OrdaX Food completo durante a janela atual de fechamento do MVP. O único recorte pré-MVP elegível continua sendo aquilo que `MVP.md`, contratos e owners canônicos já exigirem do `pizzaria-br@1`.

## 1. Problema

O OrdaX já possui o Profile profissional `pizzaria-br@1`, mas o recorte atual foi deliberadamente construído como prova segura de composição de Space: Arquivos, Notas, Internet, Projetos, templates operacionais, Memory limitada ao Space/projeto e zero dependência externa obrigatória.

Esse recorte **não é** um produto completo de gestão de pizzaria e não pretende substituir PDV, ERP, delivery, KDS, estoque operacional, pagamentos, financeiro ou CRM.

Ao mesmo tempo, Pizzaria é um excelente primeiro vertical comercial do ecossistema porque força a plataforma a resolver, de forma real e reutilizável:

- catálogo altamente configurável;
- pedidos multicanal;
- produção em cozinha;
- baixa de insumos por ficha técnica;
- atendimento e relacionamento com clientes;
- delivery/retirada/salão;
- integração local com impressoras/telas;
- realtime entre vários dispositivos;
- operação degradada quando a conectividade falha;
- automação por IA com autoridade limitada;
- integrações externas como WhatsApp, pagamentos e marketplaces;
- dados privados estritamente isolados por Space;
- monetização por entitlements sem transformar o sistema operacional em licença obrigatória.

Sem um plano único, existe risco de um segundo chat criar "um app de pizzaria" isolado, outro backend, outro banco, outra identidade, outro fluxo de IA ou uma automação de WhatsApp desconectada da arquitetura do OrdaX.

## 2. Decisão de produto

A direção proposta é:

```text
OrdaX Food
  -> domínio/plataforma vertical compartilhada
  -> funciona nos modos OrdaX Web / Mobile / Desktop / USB / Native
  -> usa a mesma Conta, Space, Entitlements, Intelligence e Operational Realtime

OrdaX Food — Pizza
  -> primeiro vertical comercial e piloto real
  -> no OrdaX aparece como experiência do Space Pizzaria
  -> especializa o Food Core sem criar outro runtime

Depois
  -> Burger
  -> Açaí
  -> Restaurante
  -> Padaria
  -> Cafeteria
  -> Bar
  -> Dark kitchen
```

### Regra central

```text
Food é domínio compartilhado.
Pizza é especialização.
Space é contexto/autorização.
Profile é composição.
Business data pertence ao domínio Food dentro do Space.
IA interpreta e orienta; não vira source of truth.
```

## 3. Nomenclatura

### Marca/produto

- **OrdaX Food**: família/plataforma comercial para alimentação.
- **OrdaX Food — Pizza**: primeiro vertical comercial.
- **Space Pizzaria**: experiência do usuário dentro do OrdaX.

### Identidade técnica existente

`pizzaria-br@1` continua válido como Profile Pack atual e não deve ser renomeado destrutivamente apenas por este plano.

Qualquer evolução de identidade técnica deve ser versionada e reconciliada com:

- manifests existentes;
- catálogo;
- receipts/provisioning;
- migração de Spaces;
- compatibilidade de dados;
- links/documentação.

Não criar `pizzaria-v2-final`, `food-pizza-new`, outro Profile paralelo ou alias permanente sem decisão explícita.

## 4. Objetivo

Construir, depois da abertura da janela de execução, um vertical comercial capaz de operar uma pizzaria real e servir como primeira prova de que Spaces profissionais podem virar produtos sustentáveis do ecossistema OrdaX.

O piloto deve provar:

1. operação diária real;
2. dados compartilhados entre dispositivos sem fork de backend;
3. produção de cozinha em realtime;
4. catálogo de pizza sem hacks;
5. estoque derivado de fichas técnicas;
6. atendimento por WhatsApp via API oficial e connector provider-neutral;
7. IA útil sem controlar preços/pedidos/pagamentos por texto livre;
8. continuidade local para funções permitidas quando a internet falhar;
9. isolamento total por Space;
10. capacidade de generalizar o mesmo Food Core para outros segmentos.

## 5. Não objetivos

Não fazer nesta frente:

- criar uma segunda conta "OrdaX Food";
- criar backend separado por plataforma;
- usar Account Sync como fila de pedidos;
- usar push/notification como source of truth;
- transformar Profile Pack em banco de dados do negócio;
- permitir que LLM invente preço, promoção, estoque, endereço, pagamento ou estado de pedido;
- automatizar WhatsApp por scraping, WhatsApp Web não oficial ou automação de interface;
- armazenar número completo de cartão quando um provider/tokenização puder ser usado;
- implementar engine fiscal própria antes de existir decisão/owner apropriado;
- acoplar regras brasileiras ao core global quando puderem ser adapters (`PIX`, fiscal, CPF/CNPJ etc.);
- exigir OrdaX OS para vender/usar OrdaX Food;
- duplicar KDS, delivery, CRM, estoque ou analytics em apps independentes que não compartilham domínio;
- construir ERP contábil completo no primeiro piloto;
- incluir marketplace/iFood/99Food por engenharia reversa sem integração autorizada;
- prometer operação online quando a loja perdeu toda conectividade.

## 6. Estado atual verificado

### Já implementado

- `pizzaria-br@1` em `system/profile-packs/pizzaria-br/v1/manifest.json`;
- Space profissional;
- composição first-party com Arquivos, Notas, Internet e Projetos;
- templates de operação diária, pedidos/encomendas, estoque, fornecedores, custos/preços e marketing;
- Memory restrita a Space/projeto;
- Profile provisioning/versionamento/rollback infrastructure;
- catálogo de Profiles;
- Intelligence compartilhada com contexto de Profile/Space;
- fundação de Operational Realtime com domínios de pedidos/produção previstos;
- mesma família de produto entre Web/Mobile/Desktop/USB/Native;
- Action Gateway/Device Agent como boundary obrigatório para ações locais privilegiadas.

### Parcialmente implementado / fundação existente

- realtime operacional: contrato/fundação existe; runtime amplo é pós-MVP;
- Intelligence profissional: leitura/contexto e fundações existem; RAG vetorial completo não está entregue;
- Mobile/Web: compartilham contratos, mas não constituem ainda um produto Food completo;
- Store/entitlements: fundação existe, mas billing do Food não deve ser presumido pronto;
- edge/device integration: arquitetura existe, mas adapters de impressora/cozinha devem ser implementados somente quando promovidos.

### Ausente para OrdaX Food comercial

- Food domain model;
- menu/catalog service;
- pizza builder completo;
- order service operacional;
- POS/caixa;
- KDS/cozinha;
- receitas/fichas técnicas e estoque transacional;
- compras/fornecedores operacionais;
- CRM de clientes;
- delivery/dispatch;
- payment provider ports;
- messaging/channel gateway;
- WhatsApp connector oficial;
- storefront/cardápio web transacional;
- analytics comercial;
- loyalty/promotions engine;
- human handoff/inbox de atendimento;
- intelligence tools tipadas do Food;
- piloto real com comerciante.

### Desconhecido / precisa ser provado quando a execução abrir

- provider fiscal escolhido;
- disponibilidade/contratos de marketplaces por país;
- custo real de WhatsApp/API/LLM na data de implementação;
- hardware local do primeiro piloto;
- topologia cloud/edge exata do estabelecimento;
- volumes reais de pedidos, mensagens e impressão;
- requisitos fiscais/operacionais do país/município do piloto.

## 7. Arquitetura alvo

```text
CANAIS
  WhatsApp | Web | Mobile | Balcão | Caixa | Telefone/voz | Marketplace
                              |
                              v
                    Food Channel Gateway
                              |
                              v
+---------------------------------------------------------------+
|                        ORDaX FOOD CORE                         |
|                                                               |
| Menu | Orders | Customers | Production | Inventory | Delivery |
| Payments | Purchasing | Promotions | Analytics | Audit        |
+---------------------------------------------------------------+
             |                  |                   |
             v                  v                   v
   Operational Realtime   Intelligence Tools   Provider Ports
             |                  |                   |
      Web/Mobile/KDS       Model Router        WhatsApp/PIX/etc.
             |
             v
     Action Gateway / Edge Runtime
             |
       impressora/KDS/equipamento local
```

### 7.1 SSOT

Cada agregado possui um único owner de estado.

Exemplos:

- preço vem de Menu/Pricing;
- pedido vem de Orders;
- disponibilidade vem de Catalog/Inventory policy;
- produção vem de Production;
- pagamento vem de Payments/provider receipt;
- entrega vem de Delivery;
- cliente vem de Customer domain;
- conversa vem de Messaging/Channel domain;
- Memory não substitui nenhum desses dados.

Operational Realtime replica eventos/estado para clientes; não vira owner alternativo.

### 7.2 Um backend lógico, vários modos

Web, Mobile, Desktop, USB e Native usam o mesmo contrato de negócio.

Adapters de UI/capability podem variar, mas regras de preço, pedido, estoque e autorização não podem divergir por plataforma.

### 7.3 Cloud, local e edge

Pedidos recebidos por canais online precisam de autoridade cloud/reconciliável. Operação local não deve parar desnecessariamente por perda de rede.

O desenho deve separar:

- **cloud-authoritative** para canais públicos/online e sincronização multi-device;
- **local/edge durable state** para funções explicitamente suportadas no estabelecimento, como fila local de impressão/KDS e pedidos originados localmente durante degradação;
- **reconciliação idempotente** ao reconectar;
- nenhuma promessa de receber pedidos online se o estabelecimento estiver sem qualquer link de dados;
- telefone em rede celular pode continuar como cliente independente quando autorizado.

Não implementar dual-master improvisado.

## 8. Ferramentas do Space Food / Pizzaria

A navegação final pode variar, mas o produto deve cobrir estes domínios sem duplicar owners.

### 8.1 Visão geral

Dashboard operacional com:

- vendas do turno/dia;
- pedidos em aberto;
- fila da cozinha;
- tempo médio atual;
- atrasos;
- pedidos por canal;
- ticket médio;
- alertas de estoque;
- entregas ativas;
- caixa/turno;
- principais desvios que exigem ação humana.

IA pode resumir os dados, mas números vêm dos owners reais.

### 8.2 Cardápio

Ferramentas:

- categorias;
- produtos;
- tamanhos;
- preços;
- disponibilidade por dia/horário/canal;
- fotos/descrições;
- grupos de modificadores;
- adicionais;
- remoções permitidas;
- combos;
- regras de canal;
- promoções elegíveis;
- versionamento/publicação;
- itens temporariamente indisponíveis;
- metadados de ingredientes/alérgenos preenchidos por responsável humano.

Nenhuma IA deve inferir alérgeno como verdade operacional.

### 8.3 Montador de pizza

É requisito de primeira classe, não addon.

Deve suportar, por configuração:

- inteira;
- meia/meia;
- terços;
- quartos quando o estabelecimento permitir;
- tamanhos;
- massas;
- bordas;
- sabores por fração;
- adicionais na pizza toda ou em frações;
- remoção de ingredientes por fração quando semanticamente suportada;
- observações;
- limites de sabores por tamanho;
- incompatibilidades;
- disponibilidade do sabor;
- regras de preço configuráveis, por exemplo maior sabor, média ponderada ou política própria;
- cálculo determinístico e explicável;
- serialização completa para cozinha, recibo e repetição de pedido.

Preço nunca é calculado pelo LLM.

### 8.4 Pedidos

Suportar:

- balcão;
- retirada;
- delivery;
- salão quando habilitado;
- pedido agendado;
- origem/canal;
- carrinho/draft;
- confirmação;
- pagamento pendente/pago conforme provider;
- cancelamento;
- reembolso via capability/provider permitido;
- observações;
- status;
- histórico e auditoria;
- idempotência;
- deduplicação de retries/webhooks;
- repetição de pedido;
- alterações apenas dentro da política temporal/estado permitido.

### 8.5 Caixa / PDV

Ferramentas:

- abertura/fechamento de turno;
- usuário/terminal;
- venda rápida;
- formas de pagamento;
- troco;
- sangria/suprimento quando modelados por owner apropriado;
- recibos;
- cancelamentos com permissão;
- conciliação operacional;
- fechamento resumido;
- modo degradado explicitamente sinalizado.

PDV não deve virar contabilidade geral.

### 8.6 Cozinha / KDS

Ferramentas:

- estações configuráveis;
- roteamento de itens para estação;
- tickets;
- prioridade;
- cronômetros;
- preparação/montagem;
- forno;
- finalização;
- embalagem;
- expedição;
- pronto/retirado;
- atraso;
- reimpressão controlada;
- tela grande/tablet;
- histórico operacional;
- capacidade/ocupação quando modelada.

A UI deve mostrar somente o necessário para a função/estação.

### 8.7 Produção e preparo

Para pizzaria, incluir depois da fundação mínima:

- preparação de massa;
- lotes;
- fermentação/validade quando informadas pelo operador;
- pré-preparo de ingredientes;
- necessidade prevista para o turno;
- desperdício/perda;
- disponibilidade operacional;
- capacidade de forno/produção como dado configurável.

### 8.8 Estoque e ficha técnica

Ferramentas:

- ingredientes/insumos;
- unidades e conversões controladas;
- ficha técnica/receita;
- consumo teórico por item/fração/modificador;
- baixa automática por pedido confirmado conforme política;
- entradas;
- ajustes com motivo/permissão;
- contagem física;
- perdas/desperdício;
- estoque mínimo;
- custo médio/metodologia definida pelo owner;
- alertas;
- lotes/validade quando necessários;
- inventário por localização futura.

O sistema deve distinguir consumo teórico de contagem física real.

### 8.9 Compras e fornecedores

Ferramentas:

- fornecedores;
- contatos;
- itens fornecidos;
- preços históricos;
- lista sugerida de compra;
- cotação;
- pedido de compra;
- recebimento;
- divergência entre pedido/recebido;
- atualização de custo sob confirmação;
- documentos/notas anexas;
- sugestão por IA sem compra automática por padrão.

### 8.10 Clientes / CRM

Ferramentas:

- cadastro mínimo;
- telefones;
- endereços;
- consentimentos;
- pedidos anteriores;
- preferências explicitamente fornecidas ou derivadas com policy;
- ticket/histórico;
- frequência;
- tags operacionais;
- atendimento pendente;
- bloqueio/opt-out de marketing;
- merge seguro de duplicados;
- exportação/exclusão conforme regras de privacidade aplicáveis.

Não usar Memory como substituto do cadastro transacional do cliente.

### 8.11 Inbox / Atendimento

Uma caixa omnichannel para:

- WhatsApp;
- futuro Instagram/DM apenas por integração oficial;
- chat do cardápio/site;
- solicitações internas;
- handoff IA -> humano;
- fila por atendente;
- status da conversa;
- vínculo com cliente/pedido quando autorizado;
- notas internas separadas de mensagens ao cliente.

### 8.12 WhatsApp

Implementar como connector oficial provider-neutral.

Fluxo alvo:

```text
WhatsApp Business Platform
 -> webhook verificado
 -> Food Channel Gateway
 -> identidade/conversa
 -> interpretação/intenção
 -> Food Core
 -> validação determinística
 -> confirmação quando necessária
 -> resposta pelo connector
```

Casos prioritários:

- iniciar atendimento;
- ver cardápio;
- montar pedido por linguagem natural;
- repetir pedido anterior;
- confirmar endereço;
- informar retirada/delivery;
- informar preço total calculado pelo core;
- informar status do pedido;
- solicitar atendimento humano;
- mensagens operacionais permitidas pelo provider;
- campanhas somente com consentimento/política adequada.

#### Regra para IA no WhatsApp

O LLM pode produzir estrutura como:

```text
intent = repeat_order
changes.remove = onion
changes.crust = catupiry
```

Depois o Food Core valida produto, modificador, disponibilidade, preço, endereço, canal e estado.

O LLM **não** grava pedido diretamente e **não** inventa preço.

#### Custos e ChatGPT

- assinatura pessoal do ChatGPT/Studio não deve ser dependência de produção do Food;
- desenvolvimento pode usar as ferramentas do desenvolvedor, mas atendimento de clientes deve passar pelo Model Router/provider configurado para produção;
- consumo de LLM e mensageria deve ser medido por tenant/Space;
- tarefas determinísticas devem evitar LLM quando consulta direta ao domínio resolver;
- classificação/extração local pode ser usada quando segura e economicamente útil;
- preços/regras de terceiros devem ser revalidados na data da implementação.

### 8.13 Delivery

Ferramentas:

- endereço validado por provider/adapters;
- zona de entrega;
- taxa;
- distância/tempo estimado quando houver provider;
- motoboy/entregador;
- despacho;
- saída;
- entregue/não entregue;
- prova/status conforme capability;
- agrupamento de rotas futuro;
- integração com plataformas externas somente por APIs/contratos autorizados.

### 8.14 Pagamentos

Provider-neutral:

- dinheiro;
- PIX via provider quando integrado;
- cartão por provider/terminal;
- link de pagamento;
- status/autorização/captura/estorno conforme provider;
- receipts;
- idempotência;
- conciliação operacional.

Não armazenar PAN/CVV e não reinventar adquirência.

### 8.15 Fiscal

Tratar como adapter/região, não como core Food.

Futuro:

- NFC-e/NF-e/SAT ou equivalentes somente através de owner/connector apropriado;
- configuração tributária validada por profissional/fornecedor competente;
- nenhum cálculo fiscal crítico baseado apenas em resposta de IA;
- regras versionadas por jurisdição/provider.

### 8.16 Financeiro operacional

Primeiro recorte:

- vendas;
- recebimentos;
- custos dos insumos;
- despesas operacionais cadastradas;
- CMV teórico;
- margem/contribuição estimada;
- fluxo operacional;
- comparação por período/canal/produto.

Não chamar isso de contabilidade completa.

### 8.17 Relatórios e Analytics

- faturamento/vendas;
- ticket médio;
- produtos/sabores;
- horários/dias;
- canais;
- cancelamentos;
- descontos;
- tempo de produção;
- atrasos;
- delivery;
- estoque/perdas;
- CMV/margens estimadas;
- retenção/recorrência;
- clientes inativos;
- desempenho por unidade futuramente;
- exportação.

### 8.18 Marketing, promoções e fidelidade

- cupons;
- regras de promoção;
- combos;
- programas de pontos/crédito quando houver owner;
- aniversários/segmentos com consentimento;
- campanhas;
- atribuição básica;
- canais permitidos;
- frequência/limites anti-spam;
- opt-out obrigatório.

IA pode sugerir campanha; publicação/envio continua gated.

### 8.19 Equipe e permissões

Perfis iniciais sugeridos:

- proprietário/admin;
- gerente;
- caixa;
- atendente;
- cozinha/pizzaiolo;
- expedição;
- entrega;
- leitura/relatórios.

Princípios:

- least privilege;
- Space membership real;
- ações sensíveis auditadas;
- nenhum papel implícito criado por prompt;
- PIN/reauth para ações locais quando fizer sentido;
- permissões versionadas.

Escala/folha de pagamento não pertence ao piloto inicial.

### 8.20 Arquivos, Notas, Internet e Projetos

Os apps first-party existentes continuam úteis e não devem ser duplicados dentro do Food.

Exemplos:

- contratos de fornecedores em Arquivos;
- procedimentos em Notas;
- pesquisa no Internet;
- campanhas/reformas/lançamentos em Projetos.

Food deve integrar contexto/links a esses apps, não criar cópias inferiores.

## 9. OrdaX Intelligence para Food

### 9.1 Papéis permitidos

- responder perguntas sobre dados autorizados do negócio;
- resumir turno/dia/período;
- explicar variações;
- identificar gargalos;
- gerar lista de atenção;
- sugerir compra;
- prever risco de ruptura quando houver modelo/dados adequados;
- sugerir escala de preparo, não escala trabalhista automática;
- ajudar a montar campanha;
- interpretar pedido por linguagem natural;
- resumir atendimento;
- pesquisar procedimentos/Knowledge verificado;
- explicar cardápio e disponibilidade real.

### 9.2 Autopilot

`Autopilot` deve começar como **gerente consultivo**, não executor autônomo irrestrito.

Exemplo:

```text
17:00
- previsão de demanda: alta
- risco de ruptura: mussarela
- dois pedidos agendados grandes
- tempo de forno de ontem acima da linha-base
- sugestão: preparar X e revisar estoque Y
```

Ações como alterar preço, publicar promoção, cancelar pedido, enviar campanha, comprar insumo ou reembolsar pagamento exigem capability/consentimento/policy próprios.

### 9.3 Router de modelos

Preferência:

```text
regra/consulta determinística
 -> sem LLM

classificação/extração simples
 -> modelo local/barato quando apropriado

linguagem complexa/raciocínio
 -> Model Router / provider autorizado
```

Não acoplar Food a um único provedor de IA.

## 10. Storefront / Cardápio público

OrdaX Food deve poder vender sem exigir que o consumidor use OrdaX.

Primeiro canal próprio futuro:

- página/cardápio responsivo;
- localização/unidade;
- disponibilidade;
- pizza builder;
- carrinho;
- retirada/delivery;
- identificação do cliente;
- pagamento quando provider estiver integrado;
- acompanhamento do pedido;
- acessibilidade;
- baixo peso e boa experiência mobile.

O storefront é um adapter do Food Core, não outro sistema de pedidos.

## 11. Integrações provider-neutral

Criar ports antes de providers concretos quando a frente for promovida.

Famílias:

- Messaging/WhatsApp;
- Payments/PIX/cards;
- Fiscal;
- Maps/geocoding/routes;
- Delivery marketplaces;
- POS/payment terminals;
- printers;
- identity/contact verification quando necessário;
- analytics/export;
- accounting/export futuro.

Regra:

```text
Food domain
 -> stable port
 -> provider adapter
```

Não espalhar SDK de terceiro pela regra de negócio.

## 12. Modelo de dados conceitual

Nomes finais dependem da auditoria da arquitetura na fase 0, mas o domínio precisa representar ao menos:

- Space/Business context;
- Store/Location;
- StaffRole/Grant;
- Menu/MenuVersion;
- Product;
- PizzaSize/Dough/Crust;
- Flavor;
- ModifierGroup/Modifier;
- Recipe/Ingredient;
- InventoryItem/StockMovement/Count;
- Supplier/PurchaseOrder/Receiving;
- Customer/Address/Consent;
- Cart/DraftOrder/Order/OrderItem/OrderPartition;
- ProductionTicket/Station;
- Payment/PaymentIntent/ProviderReceipt;
- Delivery/Driver/Dispatch;
- Conversation/Message/Handoff;
- Promotion/Coupon/LoyaltyEvent;
- OperationalEvent/AuditEvent.

Essas entidades são conceitos; não criam automaticamente tabelas ou paths finais.

## 13. Eventos realtime iniciais

Reutilizar `Operational Realtime` e versionar eventos tipados.

Primeiro conjunto provável:

```text
food.orders
  order.created
  order.confirmed
  order.updated
  order.cancelled
  order.state-changed

food.production
  ticket.created
  ticket.station-changed
  ticket.ready
  queue.changed

food.inventory
  stock.alerted
  availability.changed

food.delivery
  delivery.assigned
  delivery.state-changed

food.messaging
  conversation.handoff-requested
```

Nomes finais exigem contrato próprio; não criar eventos como API pública antes da revisão.

## 14. Offline e degradação

### Deve funcionar localmente quando suportado pela topologia

- abrir dados locais necessários já sincronizados;
- operar KDS local;
- imprimir localmente via Edge/Device Agent autorizado;
- registrar pedidos locais em modo degradado quando o contrato permitir;
- manter fila durável bounded;
- informar claramente que canais externos podem estar indisponíveis;
- reconciliar por idempotência/revisão ao reconectar.

### Não prometer

- receber WhatsApp sem conectividade;
- receber marketplace sem conectividade;
- confirmar pagamento cloud sem conectividade;
- sincronizar dispositivos que não possuem canal de rede entre si;
- executar ação stale automaticamente após longo período offline.

## 15. Segurança e privacidade

### Obrigatório

- isolamento por Account/Space;
- autenticação/reautorização adequada;
- RBAC/capabilities explícitas;
- verificação de assinatura de webhook;
- replay/idempotency protection;
- audit trail para mudanças sensíveis;
- criptografia/transporte padrão;
- segregação de secrets;
- retenção configurada por finalidade;
- minimização de dados;
- consentimento/opt-out de marketing;
- exportação/exclusão conforme política/legal;
- pagamentos tokenizados/provider-owned;
- PII fora de logs quando possível;
- nenhum cross-Space por Intelligence/Memory;
- prompt injection nunca concede authority;
- ações externas passam por tools tipadas/policy;
- nenhuma automação de WhatsApp por técnica não oficial.

### LGPD/global

Brasil é o primeiro mercado possível, não uma restrição arquitetural.

Dados/consentimentos brasileiros entram via policy/adapters. Core deve suportar localização, moedas, fusos e jurisdições sem hardcode de BR.

## 16. Modelo comercial — somente fundação de produto

Não fixar preço neste plano.

O domínio deve permitir futuramente entitlements como:

- Food básico por Space/unidade;
- Food Pro;
- Intelligence/cota avançada;
- WhatsApp/mensageria com custo pass-through ou franquia;
- multi-unidade;
- módulos avançados;
- marketplace/add-ons;
- suporte/implantação.

Billing real pertence ao owner de planos/entitlements e deve ser revalidado antes do lançamento.

## 17. Roadmap de implementação

Enquanto `DEFERRED FOR EXECUTION`, as fases abaixo são documentação, não autorização.

### Fase 0 — auditoria e contrato de fronteiras

- revalidar `main`;
- ler owners obrigatórios de Account/Spaces/Profile/Realtime/Mobile/Intelligence/Store;
- mapear services existentes reutilizáveis;
- confirmar que nenhum domínio Food equivalente já apareceu desde este plano;
- definir owner do Food Core;
- definir contrato de IDs/revisões/idempotência;
- definir topologia cloud/edge do piloto;
- definir modelo de autorização por papéis/capabilities;
- definir provider ports;
- definir estratégia de versionamento/migração do `pizzaria-br@1`.

**Gate F0:** arquitetura revisada sem segundo backend, segunda identidade, segunda fila realtime ou authority duplicada.

### Fase 1 — fundação do Food Core

- business/store settings dentro do Space;
- menu/catalog;
- pricing determinístico;
- customers básicos;
- orders;
- audit/idempotency;
- schemas/events versionados;
- APIs/actions tipadas;
- Surface compartilhada mínima;
- testes unitários/contract.

**Gate F1:** pedido completo criado de forma determinística por API/UI, com preço reproduzível e isolamento por Space.

### Fase 2 — vertical Pizza

- tamanhos;
- sabores;
- frações;
- massas;
- bordas;
- modificadores;
- regras de preço;
- combos;
- disponibilidade;
- serialização para produção;
- testes combinatórios do pizza builder.

**Gate F2:** nenhuma combinação válida produz preço/item diferente entre Web/Desktop/Mobile; combinações inválidas falham explicitamente.

### Fase 3 — POS, KDS e operação local

- Caixa/PDV;
- turnos/terminal;
- Production/KDS;
- estações;
- expedição;
- printing adapter via Device Agent/Edge quando autorizado;
- Operational Realtime;
- modo degradado suportado;
- reconciliação/idempotência.

**Gate F3:** pedido de balcão percorre caixa -> produção -> pronto sem duplicação/perda sob retry e reconexão testados.

### Fase 4 — estoque, ficha técnica e compras

- recipes/BOM;
- consumo teórico;
- stock movements;
- contagem;
- perdas;
- alertas;
- suppliers;
- purchase suggestions;
- receiving;
- custos operacionais.

**Gate F4:** baixa teórica é reproduzível por pedido, inclusive pizzas fracionadas e adicionais, sem confundir estoque calculado com contagem física.

### Fase 5 — canais próprios e WhatsApp

- Food Channel Gateway;
- Inbox;
- human handoff;
- storefront/cardápio transacional;
- connector oficial do WhatsApp;
- webhook verification;
- customer/order linking;
- interpretação estruturada por Intelligence;
- status de pedido;
- limites/consentimentos/templates do provider;
- metering de custos.

**Gate F5:** conversa autorizada consegue criar draft -> revisar -> confirmar pedido válido; IA não consegue alterar preço/estoque/pagamento fora das tools tipadas.

### Fase 6 — pagamentos e delivery

- provider ports;
- PIX/cards/link quando autorizados;
- payment receipts;
- zonas/taxas;
- despacho;
- entregador;
- status;
- adapters de mapa/rota;
- marketplace apenas quando houver API oficial/contrato.

**Gate F6:** estados financeiros/delivery não são marcados como concluídos sem receipt/evento do owner correspondente.

### Fase 7 — Analytics, CRM e Intelligence operacional

- dashboards;
- cohort/recorrência;
- produtos/canais;
- tempo de cozinha;
- CMV/margens estimadas;
- risco de ruptura;
- forecast com baseline mensurável;
- sugestões de compra;
- clientes inativos;
- campanhas sugeridas;
- Autopilot consultivo;
- explanation/provenance para recomendações relevantes.

**Gate F7:** toda resposta operacional mostra dados derivados dos owners reais; nenhuma recomendação ganha authority implícita.

### Fase 8 — piloto comercial real

Selecionar uma pizzaria real e executar rollout controlado.

Provar:

- configuração inicial;
- menu real;
- pedidos reais autorizados;
- cozinha;
- estoque;
- atendimento;
- WhatsApp se provider estiver aprovado;
- operação em pico;
- recovery;
- suporte;
- backup/export;
- treinamento mínimo;
- métricas de erro/latência/adoção.

O piloto não deve usar dados fictícios para alegar prontidão comercial.

### Fase 9 — generalização OrdaX Food

Somente depois de Pizza provar o core:

- separar regras realmente Pizza-specific;
- identificar abstrações estáveis;
- criar segundo vertical, preferencialmente simples e diferente o suficiente para testar generalização;
- provar que novo vertical entra por composição/configuração/apps sem copiar backend.

## 18. Recorte recomendado para o primeiro piloto comercial

Não tentar lançar tudo de uma vez.

### Obrigatório no piloto

- setup da pizzaria/unidade;
- cardápio;
- pizza builder;
- pedidos;
- POS básico;
- KDS;
- impressão quando necessária;
- clientes;
- fichas técnicas/estoque;
- dashboard operacional;
- Inbox;
- WhatsApp oficial, se contrato/provider pronto;
- Intelligence para consulta/atendimento estruturado;
- backups/export e auditoria;
- permissões básicas.

### Pode entrar logo depois

- fornecedores/compras avançados;
- delivery próprio completo;
- pagamentos online;
- loyalty;
- campanhas avançadas;
- fiscal;
- marketplaces;
- multi-unidade;
- previsão de demanda avançada;
- otimização de rotas;
- reservas/salão avançado;
- workforce/escala;
- franquias.

## 19. Gates de aceite globais

Antes de declarar "OrdaX Food — Pizza pronto":

1. **SSOT:** não existe segundo owner de pedido/preço/estoque.
2. **Space isolation:** testes negativos provam zero leitura/escrita cross-Space.
3. **Determinismo de preço:** mesmo input/version -> mesmo total em todos os clients.
4. **Idempotência:** retry/webhook/reconnect não duplica pedido/pagamento.
5. **Realtime:** clientes convergem ao estado canônico e detectam gaps.
6. **KDS:** produção não perde tickets sob restart/reconnect suportado.
7. **Offline/degradação:** UI deixa claro o que continua e o que está indisponível.
8. **WhatsApp:** somente API oficial/connector aprovado; webhook autenticado e consentimento respeitado.
9. **IA:** LLM não possui write authority genérica e não inventa dados críticos.
10. **Payments:** provider receipts e segredos isolados; sem PAN/CVV persistido.
11. **Audit:** preço, desconto, cancelamento, reembolso e ações administrativas deixam trilha apropriada.
12. **Recovery:** dados operacionais possuem estratégia de backup/restore/reconciliação testada.
13. **Pilot:** operação real controlada sem depender do notebook do desenvolvedor ficar aberto.
14. **No OS lock-in:** consumidor final e comerciante conseguem usar modos Web/Mobile adequados sem instalar OrdaX OS.
15. **No fork:** Pizza é composição/especialização do Food Core.

## 20. Métricas do piloto

Registrar baseline antes de estabelecer SLO final.

Métricas mínimas:

- pedidos criados/completados/cancelados;
- duplicações evitadas;
- erro por canal;
- tempo pedido -> confirmação;
- tempo confirmação -> pronto;
- atraso;
- taxa de handoff IA -> humano;
- taxa de correção manual de pedido interpretado por IA;
- divergência estoque teórico x físico;
- falhas de impressão/KDS;
- mensagens por pedido;
- custo de mensageria/LLM por pedido/Space;
- retenção de clientes;
- disponibilidade por canal;
- eventos de reconciliação após offline.

Não otimizar apenas para "quantidade de automação". O objetivo é reduzir erro/fricção e aumentar confiabilidade operacional.

## 21. Testes e evidências

### Contrato/domínio

- schemas versionados;
- migrations reversíveis ou claramente forward-only com backup;
- invariantes de preço;
- state machines;
- permissions;
- idempotency;
- revision conflicts.

### Pizza builder

Testes combinatórios de:

- tamanhos;
- número de frações;
- sabores;
- preço;
- adicionais por fração;
- remoções;
- bordas;
- combos;
- disponibilidade;
- arredondamento monetário.

### Realtime/offline

- perda de conexão;
- reconnect;
- replay;
- gap;
- evento duplicado;
- evento fora de ordem;
- restart de client/edge;
- stale action.

### Messaging

- assinatura inválida;
- replay de webhook;
- mensagem duplicada;
- usuário desconhecido;
- opt-out;
- handoff;
- timeout de IA;
- provider indisponível;
- pedido ambíguo;
- preço indisponível;
- item esgotado durante conversa.

### Intelligence

- prompt injection;
- tentativa de alterar preço por texto;
- cross-Space leakage;
- tool call inválida;
- modelo indisponível;
- fallback sem IA;
- resposta com dados stale;
- alteração de Space no meio da inferência.

### Segurança

- RBAC;
- secret scanning;
- webhook auth;
- tenant isolation;
- audit integrity;
- input validation;
- rate limiting;
- abuse controls;
- PII redaction em logs.

## 22. Rollback e degradação

- deploy de serviço deve suportar rollback compatível com migrations;
- feature flags/entitlements podem desligar connector externo sem derrubar Food Core;
- falha do LLM deve degradar para UI/fluxos determinísticos;
- falha do WhatsApp não deve parar POS/KDS;
- falha de marketplace não deve parar canais próprios;
- falha do Edge não deve corromper estado cloud;
- falha cloud deve expor claramente o recorte local ainda válido;
- Profile update/rollback nunca apaga business data/Memory do Space;
- desativar Pizza Profile não destrói pedidos, clientes ou documentos sem fluxo explícito de retenção/exclusão.

## 23. Custos e limites externos

Na abertura de cada integração, registrar com data:

- pricing do WhatsApp Business Platform;
- limites/rate limits/templates;
- custo do provider de IA;
- custo de pagamentos;
- custo de mapas/geocoding;
- custo de fiscal;
- custo de marketplace;
- cloud/storage/realtime;
- hardware Edge quando necessário.

Custos não viram constantes arquiteturais. O sistema deve medir consumo por Space/provider.

## 24. Caminhos/owners afetados

Não criar paths finais antes da Fase 0.

Áreas que provavelmente serão consumidas/estendidas, após revalidação:

- `system/profile-packs/pizzaria-br/`;
- owners de Spaces/Account/Entitlements;
- owner de applications/action contracts;
- `system/services/intelligence/`;
- contracts/owner de Operational Realtime;
- Mobile/Web/Desktop/Native adapters;
- Store/catalog quando módulos/entitlements forem publicados;
- Device Agent/Action Gateway/Edge para impressoras/equipamentos;
- i18n;
- docs/contracts correspondentes.

A criação de `system/services/food/` ou equivalente é **proposta**, não decisão; confirmar na auditoria estrutural antes de criar.

## 25. Relação com o MVP atual

O `pizzaria-br@1` atual tem uma responsabilidade menor e já válida: provar um Profile profissional seguro e demonstrável no MVP.

Este plano **não deve atrasar** essa prova exigindo PDV, WhatsApp, delivery ou ERP antes do fechamento do OS.

Portanto:

```text
MVP atual
 -> manter/fechar pizzaria-br@1 como Profile demonstrável conforme owners existentes

FOOD-001
 -> construir produto comercial completo quando a janela abrir
```

Não misturar os gates.

## 26. Estratégia de internacionalização

Construir global, pilotar local.

- UI localizada por catálogo i18n;
- moeda por configuração;
- fuso por unidade;
- endereço por provider/locale;
- impostos/fiscal por adapter;
- PIX é provider brasileiro, não conceito universal do core;
- WhatsApp é canal/provider, não identidade do cliente;
- CPF/CNPJ são atributos/adapters regionais quando realmente necessários;
- nomes técnicos/contratos permanecem neutros.

## 27. Próxima ação documental

1. registrar FOOD-001 no `REGISTRY.md`;
2. posicionar FOOD-001 no `ROADMAP.md` como P1 estratégico pós-MVP;
3. manter `pizzaria-br@1` atual no owner de Profile/MVP sem ampliar seu escopo por este plano;
4. ao fechar o MVP, revalidar FOOD-001 contra a `main` antes de promover execução.

## 28. Próxima ação de execução

**DEFERRED.**

Quando o roadmap/owner canônico mudar FOOD-001 para `EXECUTION-ELIGIBLE`, iniciar exclusivamente pela **Fase 0 — auditoria e contrato de fronteiras**. Não começar pela UI nem pelo WhatsApp.

## 29. Handoff para outro chat/agente

Você está retomando **FOOD-001 — OrdaX Food e piloto Pizza**.

Antes de alterar source:

1. leia `AGENTS.md`;
2. leia a ordem canônica obrigatória;
3. leia `00-PLANOS-PRIORITARIOS/README.md`, `ROADMAP.md` e `REGISTRY.md`;
4. leia este FOOD-001 por completo;
5. leia `PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md`;
6. leia `docs/OPERATIONAL-REALTIME.md` e seu contrato;
7. leia `docs/MOBILE-COMPANION.md`, `docs/ACCOUNT-SYNC-AND-PLANS.md` e `docs/PRODUCT-MODES.md` antes de backend/realtime/mobile;
8. leia `docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md` e `INTELLIGENCE-HANDOFF.md` antes de IA;
9. audite a `main` atual para evitar recriar serviços existentes;
10. confirme a elegibilidade de execução no roadmap.

### Regras inegociáveis

- não criar segunda conta;
- não criar segundo backend por plataforma;
- não usar sync como fila operacional;
- não criar app isolado que duplique owners;
- não dar authority genérica ao LLM;
- não usar WhatsApp não oficial;
- não hardcodear Brasil no core;
- não transformar Food em dependência de boot;
- não ampliar `pizzaria-br@1` pré-MVP apenas porque FOOD-001 existe;
- não abrir PR/tarefa de implementação enquanto `DEFERRED FOR EXECUTION`.

### Quando FOOD-001 estiver EXECUTION-ELIGIBLE

Comece pela Fase 0. Produza um inventário do source existente e uma proposta de contratos/owners. Só depois implemente Menu/Orders/Pizza Core. WhatsApp, KDS, pagamentos e Intelligence devem consumir esse domínio; nunca defini-lo por fora.
