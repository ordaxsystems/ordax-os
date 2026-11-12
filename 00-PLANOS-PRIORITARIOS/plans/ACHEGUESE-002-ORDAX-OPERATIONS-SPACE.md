# ACHEGUESE-002 — Space operacional do produto Achegue-se no OrdaX

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION
- **Prioridade:** P1
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** Spaces/Identity/Policy do OrdaX para o workspace operacional; owners próprios do Achegue-se para usuários, empresas, territórios, pedidos, assinaturas e moderação; ACHEGUESE-001 para integração first-party
- **Base factual:** repositório `washingtonmsdj/acheguese`, `ACHEGUESE-001-FIRST-PARTY-PRODUCT-INTEGRATION.md`, `DEV-001-GENERAL-DEVELOPMENT-SPACE.md`, IDENTITY-001 e arquitetura atual de Spaces
- **Relatórios de apoio:** análise dos módulos Business/Gastronomy e direção de produto/operacional do Achegue-se
- **Dependências:** fechamento do MVP; ACHEGUESE-001 para linking/API real; IDENTITY-001 para equipe; owners financeiros/comerciais aplicáveis para billing/payments

`READY` descreve maturidade documental. Não autoriza implementação nem ativa módulos pausados do Achegue-se.

## Problema

O Achegue-se é um produto/plataforma com operação própria: usuários, empresas cadastradas, solicitações, territórios, assinaturas, pagamentos, moderação, pedidos, ofertas, vagas, mensagens e suporte. Tratar o seu Space principal como um workspace de código reduz o conceito e mistura operação do negócio com desenvolvimento técnico.

O desenvolvimento do Achegue-se deve ocorrer no **DEV-001 — Space Desenvolvimento**, como projeto técnico. O **Space Achegue-se** deve representar a operação real do produto, assim como um Space Pizzaria representa a operação da pizzaria e um Space de Impressão 3D representa a operação da fábrica/loja.

## Objetivo

Criar um Space privado de operação/administração do produto:

```text
Space Achegue-se
├── Visão geral
├── Usuários
├── Empresas
├── Solicitações
├── Territórios
├── Pedidos
├── Ofertas
├── Vagas
├── Mensagens / Suporte
├── Moderação
├── Assinaturas
├── Pagamentos
├── Relatórios
├── Equipe
├── Aura / Intelligence
└── Configurações
```

O Space é privado para owner/equipe autorizada. O site/app público do Achegue-se continua separado.

## Separação obrigatória

```text
Achegue-se público
= experiência de moradores, empresas e visitantes

Space Achegue-se
= operação/administração privada do produto

Space Desenvolvimento
= ambiente técnico geral para construir Achegue-se e outros projetos

Studio
= ferramenta usada dentro do contexto de um projeto técnico
```

Portanto:

```text
Space Achegue-se
 != site público
 != repositório
 != Studio
 != Space Desenvolvimento
```

## Relação com DEV-001

O Achegue-se existe como projeto dentro do Space Desenvolvimento:

```text
Space Desenvolvimento
 -> Projeto Achegue-se
 -> Abrir no Studio
```

E como produto operacional em outro Space:

```text
Space Achegue-se
 -> usuários / empresas / receita / moderação / operação
```

Os dois podem possuir deep links recíprocos:

- `Desenvolver produto` → abre Projeto Achegue-se no DEV-001;
- `Abrir operação` → abre Space Achegue-se.

Isso é vínculo lógico e de navegação, não compartilhamento de banco ou SSOT.

## Dashboard operacional proposto

A visão geral deve responder rapidamente à saúde do produto.

### KPIs principais

- usuários cadastrados;
- usuários ativos;
- empresas cadastradas;
- empresas ativas;
- empresas/claims aguardando revisão;
- solicitações pendentes;
- territórios ativos;
- assinaturas ativas;
- MRR/receita quando houver owner financeiro real;
- pagamentos pendentes/falhos quando autorizados;
- pedidos do canal Achegue-se quando módulos correspondentes estiverem ativos;
- ofertas/vagas ativas quando promovidas;
- denúncias/moderação pendente;
- tickets/mensagens de suporte;
- conversão visitante → cadastro;
- conversão empresa → plano pago;
- churn quando billing permitir medir corretamente.

Nenhuma métrica pode ser inventada no frontend. Cada card deve vir do owner canônico ou read model explícito.

## Navegação proposta

### Visão geral

Dashboard executivo/operacional.

### Usuários

- cadastros;
- status de conta conforme owner real;
- atividade agregada autorizada;
- suporte e segurança quando permitido;
- sem exposição indevida de dados privados.

### Empresas

- cadastradas;
- publicadas;
- pendentes;
- reivindicações/claims;
- verificações;
- status territorial;
- plano/capabilities quando aplicável.

### Solicitações

Fila transversal de ações humanas, por exemplo:

- cadastro pendente;
- claim de empresa;
- alteração sensível;
- denúncia;
- suporte;
- recurso/moderação.

O tipo final vem dos owners reais do Achegue-se; não criar uma tabela universal apenas para encaixar tudo.

### Territórios

- estados/cidades/bairros ativos;
- cobertura;
- empresas por território;
- atividade/crescimento;
- gaps de dados;
- saúde de ingestão/publicação.

### Assinaturas

- planos ativos;
- upgrades/downgrades;
- renovações;
- churn;
- trials quando existirem;
- entitlement resultante.

Billing/Entitlements continua owner; o Space é superfície operacional.

### Pagamentos

- pagamentos confirmados;
- pendentes;
- falhos;
- reembolsos quando suportados;
- conciliação/receipts do owner financeiro.

Nunca reconstruir confirmação de pagamento por inferência de UI.

### Pedidos

Quando Gastronomia/Commerce for formalmente reativada:

- pedidos iniciados no Achegue-se;
- provider/owner canônico;
- status autorizado;
- falhas de integração;
- volume por território/empresa.

ACHEGUESE-001 continua governando provider boundaries com OrdaX Food/outros POS.

### Ofertas e vagas

Só aparecem quando os módulos/owners correspondentes estiverem promovidos. O Space operacional pode moderar, analisar e publicar conforme authority real, sem reativar esses módulos por simples presença no menu.

### Moderação

- denúncias;
- conteúdo sinalizado;
- empresas contestadas;
- decisões humanas;
- audit trail;
- recurso quando aplicável.

### Relatórios

- aquisição;
- ativação;
- retenção;
- receita;
- território;
- empresas;
- commerce;
- qualidade/moderação.

## Aura / Intelligence

Aura é parte visível do Space, não apenas item secundário da navegação.

A home deve possuir um card/bloco do tipo:

```text
Aura — O que exige atenção

- 23 empresas aguardam revisão há mais de 48h.
- Nordeste de Amaralina cresceu 14% em novos cadastros esta semana.
- A conversão visitante → cadastro caiu 8% desde segunda.
- 5 pagamentos falharam e exigem revisão do provider.
```

E um painel expandível com perguntas contextuais:

- O que exige atenção hoje?
- Quais territórios cresceram mais?
- Quais empresas estão aguardando aprovação?
- Como estão assinaturas e churn?
- Existem anomalias em pedidos?
- Resuma suporte/moderação das últimas 24h.

### Limites da Aura

Aura pode:

- resumir;
- priorizar;
- cruzar métricas autorizadas;
- apontar anomalias;
- sugerir ações;
- preparar relatórios.

Aura não pode, sem authority/gate correspondente:

- banir usuário autonomamente;
- aprovar empresa de forma irreversível;
- emitir reembolso;
- alterar assinatura;
- publicar campanha;
- acessar dados privados fora do escopo;
- inferir estado financeiro inexistente.

## SSOT e integração

O Space não cria novos masters.

Exemplos:

```text
User/Account fact           -> owner de identidade do Achegue-se/integração aplicável
Business                    -> Achegue-se Business
Territory                   -> Achegue-se Territory
Subscription/Entitlement    -> billing owner
Payment receipt             -> payments/provider owner
Order                       -> owner definido pelo Order Gateway
Moderation decision         -> moderation owner
Space membership            -> OrdaX Spaces/Identity
```

O Space consome APIs/read models e envia commands autorizados. Ele não acessa banco do Achegue-se diretamente por conveniência se a boundary de integração exigir API.

## Site público versus Space

O usuário final continua vendo o produto público:

```text
achegue-se.com
 -> Mapa
 -> Empresas
 -> Perto de mim
 -> Busca
 -> futuras verticais ativas
```

A equipe vê:

```text
OrdaX
 -> Space Achegue-se
 -> operação privada
```

O site público pode continuar funcionando mesmo se o Space operacional/OrdaX estiver indisponível, conforme ACHEGUESE-001 e os owners do próprio Achegue-se.

## Equipe e permissões

O Space começa owner-only se necessário e evolui com IDENTITY-001.

Exemplos futuros:

```text
Owner
Admin
Operações
Moderação
Suporte
Financeiro
Viewer
```

Esses nomes não devem virar novos roles globais se o modelo correto for `member/admin` + capabilities. O source/Policy owner decide a forma final.

Acesso ao Space também não concede automaticamente acesso a GitHub, Cloudflare, banco ou produção.

## Não objetivos

- usar o Space Achegue-se como IDE;
- duplicar o DEV-001;
- mover o repo Achegue-se para `ordax-os`;
- substituir o dashboard público por Surface OrdaX;
- fundir bancos;
- compartilhar `service_role`;
- reativar Gastronomia/Vagas/Community/Offers automaticamente;
- criar números fictícios para preencher dashboard;
- misturar dados privados de usuários com targeting de anúncios;
- usar Aura como autoridade autônoma de moderação ou finanças.

## Estado atual verificado

### Já existe

- Achegue-se independente, territory-first;
- Business/Map/Nearby/Search no recorte atual;
- módulos pausados preservados;
- administração e owners próprios no repositório Achegue-se;
- Product OAuth/Gateway first-party em source do OrdaX;
- Spaces/Identity base no OrdaX;
- ACHEGUESE-001 documentando a boundary entre produtos.

### Parcial

- métricas/admin do Achegue-se existem em vários owners/superfícies, mas ainda não há uma Surface OrdaX operacional consolidada;
- linking OAuth real permanece fail-closed;
- billing/payments precisam respeitar owners existentes e promoção real;
- Pedidos depende do lifecycle futuro de Gastronomia/Commerce.

### Ausente/não provado

- Space real Achegue-se operacional;
- read model consolidado para dashboard;
- commands administrativos via boundary first-party;
- RBAC/capabilities finos para equipe operacional;
- Aura operacional conectada aos owners reais;
- deep link operacional ↔ Projeto Achegue-se no DEV-001.

## Fases

### Fase 0 — mapear owners

- inventariar dashboards/admin atuais do Achegue-se;
- definir métricas realmente disponíveis;
- mapear commands sensíveis;
- separar read models de actions;
- confirmar quais dados podem cruzar ACHEGUESE-001.

### Fase 1 — owner-only read dashboard

- criar Space privado;
- usuários/empresas/territórios/solicitações em read-only;
- health/metrics reais;
- card Aura somente analítico;
- link para produto público e DEV-001.

### Fase 2 — operações seguras

- actions específicas server-authoritative;
- moderation/support queues;
- audit receipts;
- capability checks;
- nenhuma ação sensível em generic mutation endpoint.

### Fase 3 — billing/commerce

Somente quando owners correspondentes estiverem promovidos:

- assinaturas;
- pagamentos;
- commerce/orders;
- offers/jobs;
- reports de receita/conversão.

### Fase 4 — equipe

- invite;
- roles/capabilities;
- revoke;
- audit;
- separação de funções.

## Gates de aceite

- Space representa operação, não desenvolvimento;
- site público continua separado;
- DEV-001 contém o projeto técnico Achegue-se;
- métricas derivam de owners reais;
- nenhum dual-write cross-product;
- actions sensíveis são server-authoritative e auditadas;
- Aura não ultrapassa permissions;
- módulos pausados não são reativados implicitamente;
- indisponibilidade do OrdaX não derruba a descoberta pública do Achegue-se.

## Segurança/privacidade

- least privilege;
- dados privados minimizados;
- logs sem secrets/tokens;
- dados escolares/saúde/menores não entram em targeting;
- moderação e financeiro com audit forte;
- read model sem credenciais privilegiadas no browser;
- cross-product somente por boundary autorizada.

## Próxima ação documental

Reconciliar no hub de planos a antiga proposta `ACHEGUESE-002-ORDAX-DEVELOPER-SPACE.md`, marcando-a como superseded por este plano para a operação e por `DEV-001` para desenvolvimento geral.

## Próxima ação de execução

`DEFERRED`.
