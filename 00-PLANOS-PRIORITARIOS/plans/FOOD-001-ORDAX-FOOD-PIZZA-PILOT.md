# FOOD-001 — OrdaX Food e piloto Pizza

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION, exceto o recorte `pizzaria-br@1` que já for exigido pelos owners canônicos do MVP
- **Prioridade:** P1 estratégico pós-MVP; segundo vertical comercial recomendado depois de FAB-001, sendo Pizza o primeiro vertical da família OrdaX Food
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** `system/profile-packs/`, `docs/OPERATIONAL-REALTIME.md`, `docs/contracts/operational-realtime.json`, `docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md`, owners canônicos de Account/Spaces/Entitlements/Applications/Intelligence; owners horizontais de People/Workforce, Payments e Finance devem ser definidos/reutilizados na Fase 0 antes de implementação
- **Base factual:** `main` verificada em 2026-10-15; `pizzaria-br@1` já existe como Profile Pack first-party ativo e demonstrável; Profile Packs são composição, não owners de Finanças/Vendas/Estoque/CRM
- **Relatórios de apoio:** `PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md`, `INTELLIGENCE-HANDOFF.md`, `system/profile-packs/README.md`
- **Dependências:** PROFILE-001, MODE-001, Account/Spaces, Entitlements, Operational Realtime, Action Gateway/Device Agent quando houver equipamento local, Intelligence/Model Router, Store/Billing quando monetização for promovida, owners horizontais de People/Workforce, Payments e Finance quando existirem/promovidos

`READY` descreve maturidade documental. Este plano **não autoriza** iniciar o OrdaX Food completo durante a janela atual de fechamento do MVP. O único recorte pré-MVP elegível continua sendo aquilo que `MVP.md`, contratos e owners canônicos já exigirem do `pizzaria-br@1`.

## 1. Problema

O OrdaX já possui o Profile profissional `pizzaria-br@1`, mas o recorte atual foi deliberadamente construído como prova segura de composição de Space: Arquivos, Notas, Internet, Projetos, templates operacionais, Memory limitada ao Space/projeto e zero dependência externa obrigatória.

Esse recorte **não é** um produto completo de gestão de pizzaria e não pretende substituir PDV, ERP, delivery, KDS, estoque operacional, pagamentos, financeiro, CRM, gestão de salão ou gestão de pessoas no MVP atual.

Ao mesmo tempo, Pizzaria é um excelente vertical comercial porque força a plataforma a resolver, de forma real e reutilizável:

- catálogo altamente configurável;
- pedidos multicanal;
- delivery, retirada, balcão e salão/mesas;
- comandas/contas e múltiplos pagadores;
- produção em cozinha/bar/forno;
- baixa de insumos por ficha técnica;
- caixa e pagamentos;
- atendimento e relacionamento com clientes;
- equipe, turnos e permissões;
- integração local com impressoras/telas;
- realtime entre vários dispositivos;
- operação degradada quando a conectividade falha;
- automação por IA com autoridade limitada;
- integrações externas como WhatsApp, pagamentos e marketplaces;
- dados privados estritamente isolados por Space;
- monetização por entitlements sem transformar o sistema operacional em licença obrigatória.

Sem um plano único, existe risco de diferentes chats criarem isoladamente um app de pizzaria, um app de mesas, outro caixa, outro backend de funcionários, outro fluxo de pagamento, outra identidade, outro realtime ou uma automação de WhatsApp desconectada da arquitetura do OrdaX.

## 2. Decisão de produto

A direção é:

```text
OrdaX Food
  -> domínio/plataforma vertical compartilhada de alimentação
  -> funciona nos modos OrdaX Web / Mobile / Desktop / USB / Native
  -> usa a mesma Conta, Space, Entitlements, Intelligence e Operational Realtime

OrdaX Food — Pizza
  -> primeiro vertical da família Food
  -> no OrdaX aparece como experiência do Space Pizzaria
  -> especializa o Food Core sem criar outro runtime

Capacidades horizontais reutilizáveis
  -> Account / Spaces / Identity
  -> People / Workforce
  -> Payments
  -> Finance
  -> Files / Projects
  -> Intelligence
  -> Realtime / Device

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
People/Payments/Finance são capacidades horizontais, não Profiles de pizzaria.
Business data pertence ao owner correto dentro do Space.
IA interpreta e orienta; não vira source of truth.
```

### 2.1 Profile não é aplicativo monolítico

`pizzaria-br@1` deve dizer, de forma versionada, quais apps/capacidades/templates compõem a experiência Pizzaria. Ele não deve possuir por conta própria todos os bancos e regras de negócio do ecossistema.

Exemplo conceitual futuro:

```text
Space Pizzaria
  + Food
    + Menu / Pizza
    + Orders
    + Dine-in / Mesas / Comandas
    + Production / KDS
    + Delivery
  + People / Workforce
  + Payments
  + Finance
  + CRM/Customers
  + Inventory/Purchasing
  + Files / Notes / Projects
  + Intelligence
```

A composição exata só pode apontar para capacidades realmente publicadas/autorizadas. Não criar app fictício só para satisfazer este desenho.

## 3. Nomenclatura

### Marca/produto

- **OrdaX Food**: família/plataforma comercial para alimentação.
- **OrdaX Food — Pizza**: primeiro vertical da família Food.
- **Space Pizzaria**: experiência localizada do usuário dentro do OrdaX.

### Identidade técnica existente

`pizzaria-br@1` continua válido como Profile Pack atual e não deve ser renomeado destrutivamente apenas por este plano.

Qualquer evolução de identidade técnica deve ser versionada e reconciliada com manifests existentes, catálogo, receipts/provisioning, migração de Spaces, compatibilidade de dados e documentação.

Não criar `pizzaria-v2-final`, `food-pizza-new`, outro Profile paralelo ou alias permanente sem decisão explícita.

## 4. Objetivo

Construir, depois da abertura da janela de execução, um vertical comercial capaz de operar uma pizzaria real em delivery, retirada, balcão e salão, e provar que Spaces profissionais podem compor produtos sustentáveis sem duplicar capacidades horizontais.

O piloto/produto deve provar:

1. operação diária real;
2. dados compartilhados entre dispositivos sem fork de backend;
3. produção de cozinha em realtime;
4. catálogo de pizza sem hacks;
5. salão/mesas/comandas usando o mesmo Order Core;
6. estoque derivado de fichas técnicas;
7. atendimento por WhatsApp via integração oficial/provider-neutral;
8. pagamentos via owner/provider apropriado, não lógica improvisada no Food;
9. equipe e permissões com owner horizontal, sem duplicar identidade;
10. IA útil sem controlar preços/pedidos/pagamentos por texto livre;
11. continuidade local para funções permitidas quando a internet falhar;
12. isolamento total por Space;
13. capacidade de generalizar o mesmo Food Core para outros segmentos.

## 5. Não objetivos

Não fazer nesta frente:

- criar uma segunda conta "OrdaX Food";
- criar backend separado por plataforma;
- criar Profile separado chamado "Funcionários" só para possuir pessoas da pizzaria;
- transformar cadastro de funcionário em autenticação/permissão automática;
- implementar folha trabalhista brasileira completa dentro do Food Core;
- acoplar eSocial, INSS, FGTS, férias, 13º ou regras trabalhistas de um país ao core global;
- criar adquirência, carteira ou processador de cartões próprio sem owner/decisão apropriados;
- usar Account Sync como fila de pedidos;
- usar push/notification como source of truth;
- transformar Profile Pack em banco de dados do negócio;
- permitir que LLM invente preço, promoção, estoque, endereço, pagamento, gorjeta, comissão ou estado de pedido;
- automatizar WhatsApp por scraping, WhatsApp Web não oficial ou automação de interface;
- armazenar PAN/CVV quando tokenização/provider puder ser usado;
- implementar engine fiscal própria antes de existir decisão/owner apropriado;
- acoplar regras brasileiras ao core global quando puderem ser adapters (`PIX`, fiscal, CPF/CNPJ, folha etc.);
- exigir OrdaX OS para vender/usar OrdaX Food;
- duplicar KDS, delivery, CRM, estoque, People, Payments, Finance ou analytics em apps que não compartilham owners;
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
- catálogo/taxonomia de Profiles;
- Intelligence compartilhada com contexto de Profile/Space;
- fundação de Operational Realtime com domínios de pedidos/produção previstos;
- mesma família de produto entre Web/Mobile/Desktop/USB/Native;
- Action Gateway/Device Agent como boundary obrigatório para ações locais privilegiadas;
- regra arquitetural explícita em `system/profile-packs/README.md`: apps de Finanças, Vendas, Estoque e CRM pertencem a owners reutilizáveis próprios; Profiles apenas os referenciam quando disponíveis/autorizados.

### Parcialmente implementado / fundação existente

- realtime operacional: contrato/fundação existe; runtime amplo é pós-MVP;
- Intelligence profissional: leitura/contexto e fundações existem; RAG vetorial completo não está entregue;
- Mobile/Web: compartilham contratos, mas não constituem ainda um produto Food completo;
- Store/entitlements: fundação existe, mas billing do Food não deve ser presumido pronto;
- edge/device integration: arquitetura existe, mas adapters de impressora/cozinha devem ser implementados somente quando promovidos;
- Account/Space membership e permissões existem como fundação, mas **People/Workforce não foi provado como owner completo de RH**;
- referências a pagamento/financeiro existem em várias áreas, mas **não há prova neste plano de um owner horizontal completo de Payments/Finance pronto para Food**.

### Ausente para OrdaX Food comercial

- Food domain model;
- menu/catalog service;
- pizza builder completo;
- order service operacional;
- dine-in/salão/mesas/comandas;
- POS/caixa;
- KDS/cozinha;
- receitas/fichas técnicas e estoque transacional;
- compras/fornecedores operacionais;
- CRM de clientes;
- delivery/dispatch;
- integration ports para Payments;
- integration ports para People/Workforce;
- integração Finance operacional reutilizável;
- messaging/channel gateway;
- WhatsApp connector oficial;
- storefront/cardápio web transacional;
- analytics comercial;
- loyalty/promotions engine;
- human handoff/inbox de atendimento;
- intelligence tools tipadas do Food;
- piloto real com comerciante.

### Desconhecido / precisa ser provado quando a execução abrir

- owner/contratos finais de People/Workforce, Payments e Finance;
- provider fiscal escolhido;
- disponibilidade/contratos de marketplaces por país;
- custo real de WhatsApp/API/LLM na data de implementação;
- hardware local do primeiro piloto;
- topologia cloud/edge exata do estabelecimento;
- volumes reais de pedidos, mensagens e impressão;
- requisitos fiscais/operacionais/trabalhistas da jurisdição do piloto.

## 7. Arquitetura alvo

```text
CANAIS
  WhatsApp | Web | Mobile | Balcão | Caixa | Salão | Telefone | Marketplace
                                  |
                                  v
                        Food Channel Gateway
                                  |
                                  v
+-------------------------------------------------------------------+
|                         ORDaX FOOD CORE                            |
| Menu | Orders | Dine-in | Production | Delivery | Purchasing      |
| Pizza rules | Availability | Customer refs | Promotions | Audit    |
+-------------------------------------------------------------------+
          |                    |                    |
          v                    v                    v
   Shared capabilities   Intelligence Tools   Provider/Device Ports
          |                    |                    |
  People/Workforce          Model Router       WhatsApp/Maps/etc.
  Payments                                   Edge/Printer/Terminal
  Finance
  Inventory/CRM owners
          |
          v
  Operational Realtime / Web / Mobile / Desktop / Native
```

### 7.1 SSOT

Cada agregado possui um único owner de estado.

Exemplos:

- preço vem de Menu/Pricing;
- pedido vem de Orders;
- mesa/sessão de salão vem do domínio Dine-in/Food;
- disponibilidade vem da policy de Catalog/Inventory;
- produção vem de Production;
- pagamento confirmado vem de Payments/provider receipt;
- alocação do pagamento à conta/pedido é ligada pelo Food, mas o Food não falsifica autorização financeira;
- entrega vem de Delivery;
- cliente vem do owner de Customer/CRM;
- funcionário/escala/ponto vêm de People/Workforce quando esse owner existir;
- contabilidade/financeiro amplo vem do owner Finance; Food fornece eventos/lançamentos operacionais tipados;
- conversa vem de Messaging/Channel;
- Memory não substitui nenhum desses dados.

Operational Realtime distribui mudanças; não vira owner alternativo.

### 7.2 Um backend lógico, vários modos

Web, Mobile, Desktop, USB e Native usam os mesmos contratos de negócio.

Adapters de UI/capability podem variar, mas regras de preço, pedido, mesa, estoque, pagamento e autorização não podem divergir por plataforma.

### 7.3 Cloud, local e edge

Pedidos recebidos por canais online precisam de autoridade cloud/reconciliável. Operação local não deve parar desnecessariamente por perda de rede.

Separar:

- **cloud-authoritative** para canais públicos/online e sincronização multi-device;
- **local/edge durable state** para recortes suportados, como KDS, impressão, PDV e pedidos locais em degradação;
- **reconciliação idempotente** ao reconectar;
- nenhuma promessa de receber pedidos externos sem link de dados;
- telefone em rede celular pode continuar como cliente independente quando autorizado.

Não implementar dual-master improvisado.

### 7.4 Capacidades horizontais

#### People / Workforce

Capacidade reutilizável por Pizzaria, Impressão 3D e outros Spaces.

Deve poder representar, quando promovida:

- vínculo operacional da pessoa com empresa/unidade/Space;
- cargo/função;
- escalas e turnos;
- disponibilidade/ausência;
- ponto/horas quando aplicável;
- gorjetas/comissões operacionais;
- dados necessários para integração futura de payroll;
- documentos/atributos sujeitos a privacy policy.

**People não concede acesso ao sistema por existir um cadastro de funcionário.** Login, Space membership e capabilities continuam nos owners de Identity/Account/Spaces/Policy.

#### Payments

Capacidade horizontal reutilizável para:

- dinheiro como registro operacional;
- PIX/provider;
- cartão/terminal/provider;
- links;
- intents;
- autorização/captura/estorno;
- receipts;
- idempotência;
- conciliação operacional.

Food consome Payments e liga receipts aos pedidos/contas. Não implementa adquirência duplicada.

#### Finance

Capacidade horizontal futura/reutilizável para:

- receitas/recebimentos;
- despesas;
- contas/categorias;
- fluxo operacional;
- exportação/integrações contábeis;
- centros/unidades quando aplicável.

Food publica fatos operacionais e apresenta indicadores específicos da operação; não vira contabilidade geral.

#### Payroll

Folha não é parte do Food Core.

Futuro `People/Payroll` ou provider correspondente pode usar dados autorizados de pessoas/turnos/comissões para calcular/processar regras de cada jurisdição. Brasil (`eSocial`, INSS, FGTS, férias, 13º etc.) deve entrar por owner/adapters especializados, com revisão legal/contábil apropriada.

## 8. Ferramentas do Space Food / Pizzaria

A navegação final pode variar, mas o produto deve cobrir estes domínios sem duplicar owners.

### 8.1 Visão geral

Dashboard operacional com:

- vendas do turno/dia;
- pedidos em aberto;
- mesas/comandas em aberto quando salão estiver habilitado;
- fila da cozinha;
- tempo médio atual;
- atrasos;
- pedidos por canal;
- ticket médio;
- alertas de estoque;
- entregas ativas;
- caixa/turno;
- equipe em turno quando People estiver disponível;
- principais desvios que exigem ação humana.

IA pode resumir; números vêm dos owners reais.

### 8.2 Cardápio

- categorias;
- produtos;
- tamanhos;
- preços;
- disponibilidade por dia/horário/canal/unidade;
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

Requisito de primeira classe.

Suportar por configuração:

- inteira;
- meia/meia;
- terços;
- quartos quando permitido;
- tamanhos;
- massas;
- bordas;
- sabores por fração;
- adicionais na pizza toda ou em frações;
- remoções por fração quando suportadas;
- observações;
- limites de sabores por tamanho;
- incompatibilidades;
- disponibilidade;
- regras de preço configuráveis (maior sabor, média ponderada ou política própria);
- cálculo determinístico e explicável;
- serialização completa para cozinha, recibo e repetição.

Preço nunca é calculado pelo LLM.

### 8.4 Pedidos

Um único Order Core deve suportar:

- balcão;
- retirada;
- delivery;
- salão/mesa;
- comanda individual quando configurada;
- pedido agendado;
- origem/canal;
- draft/carrinho;
- confirmação;
- pagamento pendente/pago conforme owner;
- cancelamento;
- reembolso via capability/provider permitido;
- observações;
- status;
- histórico/auditoria;
- idempotência;
- deduplicação de retries/webhooks;
- repetição de pedido;
- alterações somente dentro da policy temporal/estado permitido.

Não criar um segundo motor de pedidos só para mesas.

### 8.5 Salão, mesas e comandas

Capacidade configurável: pizzarias somente delivery podem desativá-la, mas o vertical Pizza completo deve suportá-la.

#### Mapa de salão

- áreas/ambientes;
- mesas com ID estável e nome/número exibível;
- capacidade sugerida;
- layout/posição visual sem tornar coordenada UI o SSOT;
- estados como livre, ocupada, reservada quando Reservation existir, aguardando limpeza, bloqueada;
- combinação temporária de mesas;
- histórico/auditoria de mudanças sensíveis.

#### Sessão de mesa

Abrir uma mesa cria uma sessão operacional vinculada a:

- unidade/Space;
- mesa(s);
- horário;
- quantidade de pessoas opcional;
- responsável/garçom quando aplicável;
- pedidos/comandas vinculados;
- estado da conta;
- auditoria.

Fechar a conta encerra a sessão; não apaga pedidos.

#### Comandas/contas

Suportar:

- uma conta por mesa;
- comandas individuais por pessoa quando configurado;
- lançar pedido na mesa;
- anexar novos itens à mesma sessão;
- transferir item/comanda/mesa com permissão e auditoria;
- mover mesa;
- juntar/separar mesas;
- juntar/separar contas;
- dividir por item;
- dividir por pessoa;
- dividir por valor/percentual;
- múltiplos pagadores e múltiplas formas de pagamento;
- taxa de serviço/gorjeta conforme configuração/jurisdição;
- desconto/cortesia/cancelamento com permission gate;
- impressão/visualização de pré-conta;
- fechamento parcial quando o modelo permitir.

#### Fluxo operacional

```text
Mesa 12 abre
 -> garçom registra pedido
 -> itens roteiam para Cozinha/Bar
 -> KDS atualiza
 -> novos consumos entram na mesma sessão
 -> conta pode ser revisada/dividida
 -> Payments processa uma ou várias parcelas
 -> sessão fecha quando saldo válido = 0 ou policy permitir outro fechamento
```

Uma mesa não deve ficar "paga" apenas porque a UI recebeu sucesso local; fechamento financeiro depende do owner Payments/receipts aplicáveis.

### 8.6 Caixa / PDV

- abertura/fechamento de turno;
- usuário/terminal;
- venda rápida;
- fechamento de mesa/comanda;
- formas de pagamento via Payments;
- troco;
- sangria/suprimento quando modelados por owner apropriado;
- recibos;
- cancelamentos com permissão;
- conciliação operacional;
- fechamento resumido;
- modo degradado explicitamente sinalizado.

PDV não deve virar contabilidade geral.

### 8.7 Cozinha / KDS

- estações configuráveis (cozinha, pizzaiolo, forno, bar, expedição etc.);
- roteamento de itens por estação;
- tickets;
- origem incluindo mesa/comanda/delivery/balcão;
- prioridade;
- cronômetros;
- preparação/montagem;
- forno;
- finalização;
- embalagem;
- expedição;
- pronto/retirado/servido;
- atraso;
- reimpressão controlada;
- tela grande/tablet;
- histórico operacional;
- capacidade/ocupação quando modelada.

A UI de cada função mostra somente o necessário.

### 8.8 Produção e preparo

- preparação de massa;
- lotes;
- fermentação/validade quando informadas pelo operador;
- pré-preparo de ingredientes;
- necessidade prevista para o turno;
- desperdício/perda;
- disponibilidade operacional;
- capacidade de forno/produção configurável.

### 8.9 Estoque e ficha técnica

- ingredientes/insumos;
- unidades/conversões controladas;
- ficha técnica/receita;
- consumo teórico por item/fração/modificador;
- baixa automática conforme policy de pedido;
- entradas;
- ajustes com motivo/permissão;
- contagem física;
- perdas/desperdício;
- estoque mínimo;
- custo médio/metodologia definida pelo owner;
- alertas;
- lotes/validade quando necessários;
- inventário por localização futuramente.

Distinguir consumo teórico de contagem física real.

### 8.10 Compras e fornecedores

- fornecedores;
- contatos;
- itens fornecidos;
- preços históricos;
- lista sugerida de compra;
- cotação;
- pedido de compra;
- recebimento;
- divergência pedido/recebido;
- atualização de custo sob confirmação;
- documentos/notas anexas;
- sugestão por IA sem compra automática por padrão.

### 8.11 Clientes / CRM

- cadastro mínimo;
- telefones;
- endereços;
- consentimentos;
- pedidos anteriores;
- preferências autorizadas/derivadas sob policy;
- ticket/histórico;
- frequência;
- tags operacionais;
- atendimento pendente;
- opt-out de marketing;
- merge seguro de duplicados;
- exportação/exclusão conforme privacidade.

Memory não substitui cadastro transacional.

### 8.12 Inbox / Atendimento

- WhatsApp;
- futuro Instagram/DM somente por integração oficial;
- chat do site/cardápio;
- solicitações internas;
- handoff IA -> humano;
- fila por atendente;
- status da conversa;
- vínculo com cliente/pedido quando autorizado;
- notas internas separadas das mensagens ao cliente.

### 8.13 WhatsApp

Implementar somente via connector oficial provider-neutral.

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
- informar preço calculado pelo core;
- informar status;
- solicitar humano;
- campanhas somente com consentimento/policy.

O LLM pode extrair `intent` e mudanças estruturadas. Depois o Food Core valida produto, modificador, disponibilidade, preço, endereço, canal e estado. O LLM não grava pedido nem inventa preço.

Assinatura pessoal do ChatGPT/Studio não é dependência de produção. Atendimento real usa Model Router/provider configurado para o tenant e metering por Space/provider. Tarefas determinísticas evitam LLM quando consulta direta resolve.

### 8.14 Delivery

- endereço validado por provider/adapters;
- zona;
- taxa;
- distância/tempo estimado quando houver provider;
- motoboy/entregador;
- despacho;
- saída;
- entregue/não entregue;
- prova/status conforme capability;
- agrupamento de rotas futuro;
- plataformas externas somente por APIs/contratos autorizados.

Entregador é uma função operacional. Cadastro/turno da pessoa pode vir de People; Delivery possui a atribuição/estado da entrega.

### 8.15 Payments e fechamento de conta

Food não implementa adquirência; consome owner horizontal de Payments.

Suportar conceitualmente:

- dinheiro;
- PIX por provider;
- cartão por terminal/provider;
- link de pagamento;
- múltiplos pagamentos para o mesmo pedido/conta;
- pagamento parcial;
- divisão por pessoa/item/valor;
- autorização/captura/estorno conforme provider;
- receipts;
- idempotência;
- conciliação operacional;
- vínculo determinístico entre pagamento e saldo da conta.

Não armazenar PAN/CVV e não marcar conta como quitada sem evidência do owner apropriado.

### 8.16 Fiscal

Adapter/região, não core Food.

Futuro:

- NFC-e/NF-e/SAT ou equivalentes via owner/connector apropriado;
- configuração tributária validada por profissional/fornecedor competente;
- nenhum cálculo fiscal crítico baseado apenas em IA;
- regras versionadas por jurisdição/provider.

### 8.17 Financeiro operacional / integração Finance

Food pode apresentar operação específica:

- vendas;
- recebimentos confirmados;
- custos de insumos;
- despesas operacionais quando fornecidas pelo owner Finance;
- CMV teórico;
- margem/contribuição estimada;
- resultado por período/canal/produto;
- diferenças entre venda e recebimento quando aplicável.

O owner Finance amplo permanece separado. Food publica/consome eventos tipados; não cria livro contábil paralelo.

### 8.18 Relatórios e Analytics

- faturamento/vendas;
- ticket médio;
- produtos/sabores;
- salão x delivery x retirada x balcão;
- mesas/ocupação/tempo de atendimento quando habilitado;
- horários/dias;
- canais;
- cancelamentos/descontos;
- tempo de produção;
- atrasos;
- delivery;
- estoque/perdas;
- CMV/margens estimadas;
- retenção/recorrência;
- clientes inativos;
- desempenho por unidade;
- métricas de equipe somente com finalidade operacional legítima e policy de privacidade;
- exportação.

### 8.19 Marketing, promoções e fidelidade

- cupons;
- regras de promoção;
- combos;
- pontos/crédito quando houver owner;
- aniversários/segmentos com consentimento;
- campanhas;
- atribuição básica;
- canais permitidos;
- frequência/limites anti-spam;
- opt-out obrigatório.

IA pode sugerir; publicação/envio continua gated.

### 8.20 People / Equipe

Não é Profile separado. O Space Pizzaria consome capacidade horizontal de People/Workforce quando publicada.

#### Cadastro operacional

- funcionário/colaborador;
- função/cargo;
- unidade/Space;
- contatos necessários;
- status ativo/inativo;
- datas relevantes sob privacy policy;
- documentos somente quando houver finalidade, segurança e owner apropriados.

#### Funções iniciais sugeridas

- proprietário/admin;
- gerente;
- caixa;
- atendente;
- garçom;
- cozinha/pizzaiolo;
- bar;
- expedição;
- entrega;
- leitura/relatórios.

#### Permissões

A função de People pode sugerir/mapear responsabilidades, mas authority real vem de Account/Space/Policy/capabilities:

- least privilege;
- ações sensíveis auditadas;
- nenhum papel implícito criado por prompt;
- PIN/reauth local quando fizer sentido;
- permissões versionadas;
- pessoa cadastrada sem conta não recebe acesso automaticamente;
- remover vínculo de trabalho não pode deixar acesso órfão; processo de offboarding deve reconciliar grants.

#### Escalas e turnos

- escala planejada;
- turno;
- entrada/saída/ponto quando habilitado;
- troca/ausência;
- função no turno;
- quem está disponível/agora;
- cobertura operacional;
- integração com abertura de caixa/KDS/mesas sem transformar presença em permissão implícita.

#### Gorjetas e comissões

- gorjetas registradas por conta/turno/provider quando aplicável;
- critérios de rateio configuráveis e auditáveis;
- comissões operacionais quando configuradas;
- valores calculados de forma determinística;
- nenhuma IA altera regra de remuneração sem ação autorizada.

#### Payroll futuro

Pode incluir, por owner especializado:

- salário-base;
- horas;
- adicionais;
- comissões;
- gorjetas;
- bônus;
- adiantamentos;
- descontos legalmente configurados;
- integração contábil/bancária;
- adapters jurídicos/fiscais por país.

**Não implementar folha brasileira dentro do Food Core.**

### 8.21 Arquivos, Notas, Internet e Projetos

Os apps first-party existentes continuam úteis e não devem ser duplicados.

Exemplos:

- contratos de fornecedores em Arquivos;
- procedimentos em Notas;
- pesquisa no Internet;
- campanhas/reformas/lançamentos em Projetos;
- documentos de equipe acessíveis somente por ACL/owner apropriado, nunca porque o Food conhece o funcionário.

## 9. OrdaX Intelligence para Food

### 9.1 Papéis permitidos

- responder perguntas sobre dados autorizados;
- resumir turno/dia/período;
- explicar variações;
- identificar gargalos;
- gerar lista de atenção;
- sugerir compra;
- prever risco de ruptura quando houver dados/modelo adequados;
- sugerir preparação;
- sugerir cobertura de turno, sem alterar escala/ponto/remuneração sozinho;
- ajudar a montar campanha;
- interpretar pedido por linguagem natural;
- resumir atendimento;
- pesquisar procedimentos/Knowledge verificado;
- explicar cardápio/disponibilidade real;
- responder situação de mesas/filas usando estado real;
- explicar divergências de caixa/pagamento sem inventar receipt.

### 9.2 Autopilot

Começa como **gerente consultivo**, não executor autônomo irrestrito.

Exemplo:

```text
17:00
- previsão de demanda: alta
- risco de ruptura: mussarela
- salão previsto acima da média
- dois pedidos agendados grandes
- cobertura do turno abaixo do planejado
- tempo de forno de ontem acima da linha-base
- sugestão: preparar X e revisar estoque Y
```

Alterar preço, publicar promoção, cancelar pedido, trocar mesa/conta com impacto financeiro, alterar escala, registrar ponto, modificar comissão, enviar campanha, comprar insumo ou reembolsar pagamento exige capability/consentimento/policy próprios.

### 9.3 Router de modelos

```text
regra/consulta determinística
 -> sem LLM

classificação/extração simples
 -> modelo local/barato quando apropriado

linguagem complexa/raciocínio
 -> Model Router / provider autorizado
```

Não acoplar Food a um único provedor.

## 10. Storefront / Cardápio público

O consumidor não precisa usar OrdaX.

Canal próprio futuro:

- página/cardápio responsivo;
- localização/unidade;
- disponibilidade;
- pizza builder;
- carrinho;
- retirada/delivery;
- identificação do cliente;
- pagamento quando provider integrado;
- acompanhamento;
- acessibilidade;
- experiência mobile leve.

Storefront é adapter do Food Core, não outro sistema de pedidos.

## 11. Integrações provider-neutral

Criar ports antes de providers concretos quando a frente for promovida.

Famílias:

- Messaging/WhatsApp;
- Payments/PIX/cards;
- Finance/accounting export;
- People/Payroll providers;
- Fiscal;
- Maps/geocoding/routes;
- Delivery marketplaces;
- POS/payment terminals;
- printers;
- identity/contact verification quando necessário;
- analytics/export.

```text
domain owner
 -> stable port
 -> provider adapter
```

Não espalhar SDK de terceiro pela regra de negócio.

## 12. Modelo de dados conceitual

Nomes finais dependem da Fase 0. Conceitos necessários incluem:

### Food-owned

- Store/Location;
- Menu/MenuVersion;
- Product;
- PizzaSize/Dough/Crust/Flavor;
- ModifierGroup/Modifier;
- Order/OrderItem/OrderPartition;
- DiningArea/Table/TableSession;
- Tab/Check/CheckAllocation ou conceito equivalente;
- ProductionTicket/Station;
- Delivery/Dispatch;
- Promotion/Coupon;
- OperationalEvent/AuditEvent.

### Referências a owners horizontais

- Account/Space/Member/Grant;
- Staff/Workforce identity reference;
- Shift/TimeEntry reference;
- Customer/CRM reference;
- Recipe/Ingredient/Inventory reference;
- PaymentIntent/Payment/ProviderReceipt reference;
- Finance entry/reference;
- Conversation/Message/Handoff.

Essas entidades são conceitos; não criam automaticamente tabelas, apps ou paths finais. Na Fase 0, reutilizar owner existente sempre que houver.

## 13. Eventos realtime iniciais

Reutilizar `Operational Realtime` e versionar eventos tipados.

Conjunto provável:

```text
food.orders
  order.created
  order.confirmed
  order.updated
  order.cancelled
  order.state-changed

food.dining
  table-session.opened
  table-session.changed
  check.changed
  table-session.closed

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

People, Payments e Finance publicam eventos em seus próprios domínios quando existirem. Food não deve roubar esses namespaces.

## 14. Offline e degradação

Quando suportado pela topologia:

- abrir dados locais necessários já sincronizados;
- operar KDS local;
- manter mapa/estado local de salão dentro do contrato permitido;
- imprimir localmente via Edge/Device Agent autorizado;
- registrar pedidos locais em modo degradado quando permitido;
- manter fila durável bounded;
- informar claramente canais externos indisponíveis;
- reconciliar por idempotência/revisão ao reconectar.

Não prometer:

- receber WhatsApp/marketplace sem conectividade;
- confirmar pagamento cloud sem conectividade;
- sincronizar dispositivos sem canal de rede;
- executar ação stale automaticamente após longo offline;
- fechar conta como paga sem prova válida do owner Payments.

## 15. Segurança e privacidade

Obrigatório:

- isolamento por Account/Space;
- autenticação/reauth adequada;
- RBAC/capabilities explícitas;
- staff record separado de access grant;
- offboarding revoga/revisa grants apropriados;
- verificação de webhook;
- replay/idempotency protection;
- audit trail para mudanças sensíveis;
- segregação de secrets;
- minimização/retention por finalidade;
- consentimento/opt-out de marketing;
- exportação/exclusão conforme policy/legal;
- pagamentos tokenizados/provider-owned;
- PII fora de logs quando possível;
- dados trabalhistas com acesso mínimo e owner próprio;
- nenhum cross-Space por Intelligence/Memory;
- prompt injection nunca concede authority;
- ações externas por tools tipadas/policy;
- nenhuma automação de WhatsApp não oficial.

Brasil pode ser primeiro mercado, não hardcode arquitetural. Dados/consentimentos/regras brasileiras entram por adapters/policies.

## 16. Modelo comercial — fundação

Não fixar preço neste plano.

Entitlements futuros podem incluir:

- Food básico por Space/unidade;
- Food Pro;
- salão/mesas e recursos avançados;
- People/Workforce conforme plano horizontal;
- Intelligence/cota avançada;
- WhatsApp/mensageria com franquia/pass-through;
- multi-unidade;
- módulos avançados;
- marketplace/add-ons;
- suporte/implantação.

Não cobrar duas vezes pela mesma capacidade horizontal apenas porque dois Profiles a utilizam sem decisão comercial explícita.

Billing real pertence ao owner de planos/entitlements.

## 17. Roadmap de implementação

Enquanto `DEFERRED FOR EXECUTION`, estas fases são documentação, não autorização.

### Fase 0 — auditoria e contrato de fronteiras

- revalidar `main`;
- ler owners de Account/Spaces/Profile/Realtime/Mobile/Intelligence/Store;
- auditar owners/requisitos existentes de Finanças, Vendas, Estoque, CRM;
- definir/reutilizar owner de People/Workforce;
- definir/reutilizar owner de Payments;
- definir/reutilizar owner de Finance;
- mapear services reutilizáveis;
- definir owner do Food Core;
- definir IDs/revisões/idempotência;
- definir topologia cloud/edge do piloto;
- definir autorização por roles/capabilities;
- definir provider ports;
- definir migração/versionamento do `pizzaria-br@1`.

**Gate F0:** arquitetura revisada sem segunda identidade, backend, realtime, People, Payments, Finance ou authority paralela.

### Fase 1 — fundação do Food Core

- settings de unidade dentro do Space;
- menu/catalog;
- pricing determinístico;
- customer refs básicos;
- Orders;
- audit/idempotency;
- schemas/events versionados;
- actions tipadas;
- Surface compartilhada mínima;
- testes unitários/contract.

**Gate F1:** pedido completo reproduzível, preço determinístico e isolamento por Space.

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
- testes combinatórios.

**Gate F2:** mesma combinação -> mesmo item/preço em todos os clients; inválidos falham explicitamente.

### Fase 3 — salão, mesas, comandas, POS e KDS

- DiningArea/Table/TableSession;
- mapa de salão;
- abertura/transferência/junção/separação de mesa;
- comandas/contas;
- divisão de conta;
- atribuição de garçom por referência;
- Caixa/PDV;
- turnos/terminal;
- Production/KDS;
- estações/cozinha/bar/forno;
- expedição/serviço;
- printing adapter via Device Agent/Edge quando autorizado;
- Operational Realtime;
- modo degradado suportado;
- reconciliação/idempotência.

**Gate F3:** fluxo mesa -> pedido -> KDS -> conta -> múltiplos pagamentos -> fechamento e fluxo balcão -> produção -> pronto sobrevivem a retry/reconnect sem duplicação/perda.

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

**Gate F4:** baixa reproduzível inclusive pizza fracionada/adicionais, sem confundir teórico com físico.

### Fase 5 — canais próprios e WhatsApp

- Food Channel Gateway;
- Inbox;
- human handoff;
- storefront/cardápio transacional;
- connector oficial WhatsApp;
- webhook verification;
- customer/order linking;
- interpretação estruturada;
- status;
- consentimentos/templates;
- metering.

**Gate F5:** conversa cria draft -> revisão -> confirmação válida; IA não altera dados críticos fora de tools tipadas.

### Fase 6 — Payments, Delivery, People e Finance integration

- Payments port/owner;
- PIX/cards/link quando autorizados;
- split/multi-payment e receipts;
- zonas/taxas/dispatch;
- People/Workforce refs;
- funções/turnos/escala/ponto básico somente se owner horizontal estiver pronto;
- tips/commissions operacionais;
- Finance event/export integration;
- marketplace somente por API oficial.

**Gate F6:** pagamento/entrega/presença de funcionário/financeiro não são inventados pelo Food; cada estado sensível deriva do owner correto.

### Fase 7 — Analytics, CRM e Intelligence operacional

- dashboards;
- salão/ocupação;
- cohort/recorrência;
- produtos/canais;
- tempo de cozinha;
- CMV/margens estimadas;
- risco de ruptura;
- forecast mensurável;
- sugestões de compra;
- clientes inativos;
- campanhas sugeridas;
- Autopilot consultivo;
- provenance para recomendações.

**Gate F7:** toda resposta operacional deriva de owners reais; nenhuma recomendação ganha authority implícita.

### Fase 8 — piloto comercial real

Selecionar pizzaria real e provar:

- setup/unidade;
- menu real;
- pedidos reais autorizados;
- salão/mesas se o estabelecimento operar salão;
- caixa;
- cozinha;
- estoque;
- equipe;
- atendimento;
- WhatsApp se provider aprovado;
- pagamentos se provider aprovado;
- operação em pico;
- recovery;
- suporte;
- backup/export;
- treinamento;
- métricas de erro/latência/adoção.

Dados fictícios não provam prontidão comercial.

### Fase 9 — generalização OrdaX Food

Depois de Pizza provar o core:

- separar regras Pizza-specific;
- estabilizar abstrações;
- criar segundo vertical diferente o suficiente;
- provar entrada por composição/configuração/apps sem copiar backend;
- reutilizar People/Payments/Finance/CRM/Inventory horizontais.

## 18. Recorte recomendado para o primeiro piloto comercial

### Obrigatório

- setup da pizzaria/unidade;
- cardápio;
- pizza builder;
- pedidos;
- POS básico;
- KDS;
- salão/mesas/comandas **quando a operação piloto possuir salão**;
- impressão quando necessária;
- clientes;
- fichas técnicas/estoque;
- dashboard;
- Inbox;
- WhatsApp oficial se provider pronto;
- equipe/permissões básicas usando owners corretos;
- Payments básico se provider pronto;
- Intelligence para consulta/atendimento estruturado;
- backup/export/auditoria.

### Deve existir no produto completo mesmo que o primeiro piloto não use

- salão/mesas/comandas;
- divisão e múltiplos pagamentos;
- integração People/Workforce;
- integração Payments;
- integração Finance operacional.

### Depois

- fornecedores/compras avançados;
- delivery completo;
- pagamentos online avançados;
- loyalty;
- campanhas avançadas;
- fiscal;
- marketplaces;
- multi-unidade;
- previsão avançada;
- otimização de rotas;
- reservas;
- payroll;
- franquias.

## 19. Gates de aceite globais

Antes de declarar `OrdaX Food — Pizza` pronto:

1. **SSOT:** nenhum segundo owner de pedido/preço/estoque/pagamento/pessoa.
2. **Space isolation:** zero cross-Space em testes negativos.
3. **Preço:** mesmo input/version -> mesmo total em todos os clients.
4. **Pedido único:** balcão, delivery e mesa usam invariantes comuns, sem motores paralelos.
5. **Dine-in:** transferir/juntar/dividir mesa/conta preserva auditabilidade e saldo.
6. **Idempotência:** retry/webhook/reconnect não duplica pedido/pagamento.
7. **Realtime:** clients convergem e detectam gaps.
8. **KDS:** tickets não somem sob restart/reconnect suportado.
9. **Offline:** UI deixa claro o que continua/para.
10. **WhatsApp:** somente API oficial/connector aprovado.
11. **IA:** sem write authority genérica ou dados críticos inventados.
12. **Payments:** receipt/provider é autoridade; sem PAN/CVV persistido.
13. **People:** funcionário cadastrado não recebe acesso automaticamente; grants são owner separado.
14. **Payroll:** nenhuma regra trabalhista hardcoded no Food Core.
15. **Finance:** Food não mantém contabilidade paralela.
16. **Audit:** preço, desconto, cortesia, cancelamento, transferência de mesa, reembolso, ponto/comissão e ações administrativas deixam trilha conforme owner.
17. **Recovery:** backup/restore/reconciliação testados.
18. **Pilot:** operação real sem notebook do desenvolvedor obrigatório.
19. **No OS lock-in:** Web/Mobile adequados funcionam sem instalar OrdaX OS.
20. **No fork:** Pizza é especialização/composição do Food Core.

## 20. Métricas do piloto

- pedidos criados/completados/cancelados;
- duplicações evitadas;
- erro por canal;
- tempo pedido -> confirmação;
- tempo confirmação -> pronto;
- tempo mesa aberta -> fechamento quando aplicável;
- ocupação/turnover de mesa quando aplicável;
- atraso;
- handoff IA -> humano;
- correção manual de pedido interpretado;
- divergência estoque teórico x físico;
- falhas de impressão/KDS;
- mensagens por pedido;
- custo mensageria/LLM por pedido/Space;
- divergências de conciliação de pagamento;
- tempo de atendimento por canal;
- disponibilidade por canal;
- eventos de reconciliação offline.

Métricas de pessoas devem ter finalidade legítima e evitar vigilância desnecessária. Não otimizar para "quantidade de automação".

## 21. Testes e evidências

### Domínio

- schemas/versionamento;
- migrations/backup;
- invariantes de preço;
- state machines;
- permissions;
- idempotency;
- revision conflicts.

### Pizza builder

- tamanhos;
- frações;
- sabores;
- preço;
- adicionais;
- remoções;
- bordas;
- combos;
- disponibilidade;
- arredondamento.

### Salão/mesas

- abrir/fechar sessão;
- mesa já ocupada;
- troca de garçom;
- mover mesa;
- juntar/separar mesas;
- transferir item/comanda;
- dividir conta por item/pessoa/valor;
- pagamentos parciais/múltiplos;
- desconto/cortesia/cancelamento com permission gate;
- reconnect durante fechamento;
- receipt duplicado;
- saldo inconsistente falha fechado.

### People/Workforce

- colaborador sem conta;
- conta sem vínculo de trabalho;
- offboarding;
- role change;
- turno/ponto duplicado;
- comissão/gorjeta determinística;
- acesso indevido a dados de RH;
- troca de Space.

### Realtime/offline

- perda/reconnect/replay/gap;
- evento duplicado/fora de ordem;
- restart client/edge;
- stale action.

### Messaging

- assinatura inválida;
- replay;
- duplicata;
- opt-out;
- handoff;
- timeout IA;
- provider indisponível;
- pedido ambíguo;
- item esgotado durante conversa.

### Intelligence

- prompt injection;
- tentativa de alterar preço/pagamento/escala por texto;
- cross-Space leakage;
- tool call inválida;
- modelo indisponível;
- fallback;
- dado stale;
- troca de Space durante inferência.

### Segurança

- RBAC;
- secret scanning;
- webhook auth;
- tenant isolation;
- audit integrity;
- validation;
- rate limiting/abuse;
- PII redaction;
- payment data boundaries;
- workforce data boundaries.

## 22. Rollback e degradação

- deploy de serviço com rollback compatível com migrations;
- connector externo desligável sem derrubar Food Core;
- falha do LLM degrada para fluxos determinísticos;
- falha WhatsApp não para POS/KDS/salão;
- falha marketplace não para canais próprios;
- falha Payments impede confirmação financeira, mas não deve corromper pedidos;
- falha People não deve apagar equipe nem conceder acesso;
- falha Finance não deve parar produção/pedidos quando separável;
- falha Edge não corrompe cloud;
- falha cloud expõe recorte local válido;
- Profile update/rollback nunca apaga business data/Memory;
- desativar Pizza Profile não destrói pedidos, clientes, pessoas ou documentos sem fluxo explícito.

## 23. Custos e limites externos

Na abertura de cada integração registrar data de:

- WhatsApp Business Platform;
- provider de IA;
- pagamentos/adquirência;
- mapas/geocoding;
- fiscal;
- marketplace;
- payroll/HR provider se houver;
- cloud/storage/realtime;
- hardware Edge.

Custos não viram constantes arquiteturais. Medir por Space/provider quando aplicável.

## 24. Caminhos/owners afetados

Não criar paths finais antes da Fase 0.

Áreas prováveis de consumo/extensão:

- `system/profile-packs/pizzaria-br/`;
- owners de Spaces/Account/Entitlements;
- owners de Applications/Action contracts;
- `system/services/intelligence/`;
- Operational Realtime;
- Mobile/Web/Desktop/Native adapters;
- owners horizontais de Finanças/Vendas/Estoque/CRM já determinados pela arquitetura de Profiles;
- futuros/reutilizados owners de People/Workforce, Payments e Finance;
- Store/catalog quando módulos/entitlements forem publicados;
- Device Agent/Action Gateway/Edge;
- i18n;
- docs/contracts correspondentes.

A criação de `system/services/food/`, `system/services/people/`, `system/services/payments/` ou equivalente é **proposta**, não decisão. Auditar antes de criar.

## 25. Relação com o MVP atual

`pizzaria-br@1` atual possui responsabilidade menor: provar um Profile profissional seguro e demonstrável no MVP.

Este plano não deve atrasar essa prova exigindo PDV, mesas, funcionários, WhatsApp, delivery, Payments ou ERP antes do fechamento do OS.

```text
MVP atual
 -> manter/fechar pizzaria-br@1 conforme owners existentes

FOOD-001
 -> construir produto comercial completo quando a janela abrir
```

Não misturar gates.

## 26. Internacionalização

Construir global, pilotar local.

- UI por i18n;
- moeda por configuração;
- fuso por unidade;
- endereço por provider/locale;
- impostos/fiscal por adapter;
- PIX é provider brasileiro;
- WhatsApp é canal/provider, não identidade;
- CPF/CNPJ são atributos regionais quando necessários;
- regras trabalhistas/payroll são adapters/owners por jurisdição;
- nomes técnicos/contratos neutros.

## 27. Próxima ação documental

- manter FOOD-001 registrado no `REGISTRY.md` e no `ROADMAP.md`;
- manter `pizzaria-br@1` atual no owner Profile/MVP sem ampliar seu escopo por este plano;
- ao fechar o MVP, revalidar FOOD-001 contra `main`;
- na Fase 0, inventariar People/Payments/Finance existentes antes de criar qualquer owner novo.

## 28. Próxima ação de execução

**DEFERRED.**

Quando FOOD-001 virar `EXECUTION-ELIGIBLE`, começar exclusivamente pela **Fase 0 — auditoria e contrato de fronteiras**. Não começar por UI, WhatsApp, folha, pagamentos ou mesas isoladamente.

## 29. Handoff para outro chat/agente

Você está retomando **FOOD-001 — OrdaX Food e piloto Pizza**.

Antes de alterar source:

1. leia `AGENTS.md` e a ordem canônica obrigatória;
2. leia `00-PLANOS-PRIORITARIOS/README.md`, `ROADMAP.md` e `REGISTRY.md`;
3. leia este FOOD-001 por completo;
4. leia `PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md`;
5. leia `system/profile-packs/README.md`, especialmente a separação de owners de Finanças/Vendas/Estoque/CRM;
6. leia `docs/OPERATIONAL-REALTIME.md` e contrato;
7. leia `docs/MOBILE-COMPANION.md`, `docs/ACCOUNT-SYNC-AND-PLANS.md` e `docs/PRODUCT-MODES.md` antes de backend/realtime/mobile;
8. leia `docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md` e `INTELLIGENCE-HANDOFF.md` antes de IA;
9. audite `main` para evitar recriar serviços, sobretudo People/Payments/Finance;
10. confirme a elegibilidade no roadmap.

### Regras inegociáveis

- não criar segunda conta;
- não criar segundo backend por plataforma;
- não usar sync como fila operacional;
- não criar motor de pedidos separado para salão;
- não criar Profile separado de "Funcionários" como substituto de People/Workforce;
- cadastro de funcionário não concede acesso;
- não criar Payments ou Finance duplicados dentro do Food;
- não implementar folha brasileira dentro do Food Core;
- não dar authority genérica ao LLM;
- não usar WhatsApp não oficial;
- não hardcodear Brasil no core;
- não transformar Food em dependência de boot;
- não ampliar `pizzaria-br@1` pré-MVP apenas porque FOOD-001 existe;
- não abrir PR/tarefa de implementação enquanto `DEFERRED FOR EXECUTION`.

### Quando FOOD-001 estiver EXECUTION-ELIGIBLE

Comece pela Fase 0. Produza inventário do source existente e proposta de contracts/owners. Só depois implemente Food Core. Pizza, salão/mesas, KDS, WhatsApp, People, Payments, Finance e Intelligence devem consumir owners corretos; nunca defini-los por fora.
