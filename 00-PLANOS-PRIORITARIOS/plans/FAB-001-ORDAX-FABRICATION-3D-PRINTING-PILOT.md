# FAB-001 — OrdaX Fabrication e piloto Impressão 3D

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION, exceto o recorte `impressao-3d-br@1` que já for exigido pelos owners canônicos do MVP
- **Prioridade:** P1 estratégico pós-MVP; primeiro vertical comercial recomendado após a fundação Web/Cloud/Device
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** `system/profile-packs/`, `docs/OPERATIONAL-REALTIME.md`, `docs/contracts/operational-realtime.json`, `docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md`, owners canônicos de Account/Spaces/Entitlements/Applications/Intelligence/Device Agent
- **Base factual:** `main` verificada em 2026-10-15; `impressao-3d-br@1` já existe como Profile Pack first-party ativo e demonstrável
- **Relatórios/planos de apoio:** `docs/SPACES-AND-PROFILES.md`, `INTELLIGENCE-HANDOFF.md`, `plans/MODE-001-WEB-CLOUD-DEVICE-RUNTIME.md`
- **Dependências:** `docs/SPACES-AND-PROFILES.md`, MODE-001, Account/Spaces, Entitlements, Operational Realtime, Action Gateway/Device Agent, Intelligence/Model Router, Store/Billing quando monetização for promovida

`READY` descreve maturidade documental. Este plano **não autoriza** iniciar o produto comercial completo durante a janela atual de fechamento do MVP. O recorte pré-MVP elegível continua sendo somente aquilo que `MVP.md`, contratos e owners canônicos já exigirem do `impressao-3d-br@1`.

## 1. Problema

O OrdaX já possui o Profile profissional `impressao-3d-br@1`, mas o recorte atual é deliberadamente pequeno e seguro: Arquivos, Notas, Internet, Projetos, templates operacionais, Memory limitada ao Space/projeto e nenhuma automação privilegiada ou integração física obrigatória.

Esse recorte **não é** ainda um sistema completo para gerir uma operação de impressão 3D.

Ao mesmo tempo, Impressão 3D é um candidato especialmente forte para primeiro vertical comercial do OrdaX porque permite validar em uma operação real, diariamente, toda a cadeia:

```text
cliente
 -> orçamento
 -> pedido
 -> arquivo/modelo
 -> preparação
 -> produção
 -> impressora
 -> material
 -> qualidade
 -> acabamento
 -> embalagem
 -> entrega
 -> custo/lucro
```

O valor do produto não deve ser apenas "controlar impressoras". O objetivo é unir **negócio + produção + arquivos + dispositivos + inteligência** no mesmo Space.

Sem um plano único, existe risco de futuros chats criarem separadamente:

- um gerenciador de farm;
- um app de orçamento;
- outro banco de pedidos;
- outro inventário de filamentos;
- integrações de impressora fora do Device Agent;
- uma segunda identidade/conta;
- outro backend de realtime;
- uma IA com autoridade indevida;
- regras específicas da loja piloto incorporadas ao produto genérico.

FAB-001 existe para impedir essa fragmentação.

## 2. Decisão de produto

A direção proposta é:

```text
OrdaX Fabrication
  -> domínio/plataforma compartilhada de fabricação digital
  -> usa a mesma Conta, Spaces, Entitlements, Intelligence e Operational Realtime
  -> funciona nos modos Web / Mobile / Desktop / USB / Native

OrdaX Fabrication — 3D Printing
  -> primeiro vertical comercial
  -> no OrdaX aparece como experiência do Space Impressão 3D
  -> usa `impressao-3d-br@1` como composição/versionamento do ambiente
  -> não cria outro runtime

Piloto real
  -> operação/loja de impressão 3D do owner
  -> dogfooding diário
  -> separar necessidades universais de customizações da empresa piloto

Evolução futura
  -> laser/CNC
  -> corte e gravação
  -> fabricação digital híbrida
  -> outras operações de produção sob demanda
```

### Regra central

```text
Fabrication é domínio compartilhado.
3D Printing é especialização.
Space é contexto e autorização.
Profile é composição.
Dados operacionais pertencem ao domínio dentro do Space.
Device Adapter não vira regra de negócio.
IA interpreta, recomenda e orquestra intents; não vira source of truth.
```

## 3. Nomenclatura

Nomes de trabalho deste plano:

- **OrdaX Fabrication**: família de produto/domínio para fabricação digital;
- **3D Printing**: primeiro vertical da família;
- **Space Impressão 3D**: nome localizado da experiência do usuário PT-BR;
- **`impressao-3d-br@1`**: identidade versionada do Profile Pack atual.

A marca externa final pode ser reavaliada antes do lançamento comercial. O ID técnico do Profile não deve ser renomeado apenas por marketing.

## 4. Estado atual verificado

### Já implementado/fundado

- Profile Pack `impressao-3d-br@1` ativo;
- `space_kind=professional`;
- apps first-party `files`, `notes`, `internet`, `projects`;
- templates já declarados para:
  - fila de produção;
  - pedidos e orçamentos;
  - materiais e filamentos;
  - perfis de impressão;
  - controle de qualidade e falhas;
  - manutenção de impressoras;
  - clientes e entregas;
  - custos e preços;
- source classes de conhecimento para arquivos de projeto, manuais de impressora, datasheets de material e perfis de impressão;
- Memory limitada a Space/projeto;
- nenhuma concessão automática de privilégios;
- fundação de Operational Realtime já prevê `fabrication.jobs`, conectividade, progresso, falha e conclusão;
- Device Agent/Action Gateway já definem a direção de autoridade tipada para hardware;
- OrdaX Edge Runtime já possui papel arquitetural previsto para equipamento local quando necessário.

### Parcialmente implementado

- distribuição e ativação de Profiles;
- Intelligence contextual por Profile/Space;
- realtime e boundaries de dispositivos possuem fundação/contratos, mas não representam ainda uma solução comercial completa de print farm;
- Web/Mobile/Device runtime precisa ser revalidado via MODE-001 antes de transformar este plano em execução ampla.

### Ausente/não comprovado como produto comercial

- domínio Fabrication persistente completo;
- orders/quotes production-grade;
- scheduler de produção;
- printer/farm inventory operacional;
- jobs conectados a máquinas reais;
- spool/material accounting real;
- costing engine;
- integração com slicers;
- adapters reais para famílias de impressoras;
- storefront comercial;
- pagamentos/fiscal/frete;
- analytics comerciais e industriais;
- piloto prolongado em operação real.

## 5. Não objetivos iniciais

FAB-001 não deve começar tentando:

- suportar todas as marcas/modelos de impressoras;
- escrever um slicer novo;
- substituir Blender/CAD;
- criar firmware de impressora;
- operar hardware por shell genérico;
- incorporar credenciais de fabricante ao Profile;
- controlar impressoras sem autorização explícita e capability tipada;
- prometer detecção de falha autônoma sem métricas/prova;
- criar marketplace STL novo apenas para justificar o Space;
- misturar arquivos particulares de clientes com catálogo público;
- transformar particularidades da loja piloto em contratos globais;
- colocar o produto comercial completo no gate do MVP atual.

## 6. Experiência principal do Space

### 6.1 Visão Geral

A home do Space deve responder rapidamente:

- o que está imprimindo agora;
- o que está aguardando;
- quais pedidos estão atrasados/em risco;
- quais máquinas estão livres, ocupadas, offline ou com falha;
- jobs concluídos hoje;
- taxa de falha;
- material crítico/baixo;
- manutenção próxima/vencida;
- faturamento/custo/lucro estimado do período;
- entregas próximas;
- alertas que precisam de decisão humana.

Não misturar alertas acionáveis com métricas decorativas.

### 6.2 Pedidos

Estados iniciais sugeridos:

```text
draft
 -> quoted
 -> awaiting-approval
 -> approved
 -> queued
 -> producing
 -> post-processing
 -> ready
 -> shipped/picked-up
 -> completed
```

Com estados de exceção explícitos como `on-hold`, `cancelled`, `failed` e `needs-review`.

Pedido pode conter múltiplos itens, e cada item pode gerar um ou mais jobs de produção.

### 6.3 Orçamentos

O orçamento deve ser calculado por engine determinística, não pelo LLM.

Entradas possíveis:

- quantidade;
- material;
- massa estimada/real;
- tempo estimado;
- impressora/classe de máquina;
- energia configurável;
- custo do material;
- custo-hora da máquina;
- mão de obra;
- acabamento;
- embalagem;
- frete;
- taxa esperada de perda/retrabalho;
- margem alvo;
- descontos/regras comerciais.

Saída deve separar:

- custo estimado;
- preço sugerido;
- margem absoluta e percentual;
- premissas;
- origem da estimativa;
- diferença entre estimate e actual após produção.

### 6.4 Clientes / CRM operacional

Cada cliente pode possuir:

- contatos;
- endereços;
- histórico de pedidos;
- arquivos/projetos vinculados com ACL adequada;
- preferências autorizadas;
- orçamentos pendentes;
- notas comerciais;
- entregas;
- saldo/status de pagamento quando aplicável.

Dados de cliente são privados do Space e nunca entram em Knowledge Pack público.

### 6.5 Catálogo de produtos

Catálogo comercial separado da biblioteca técnica de arquivos.

Produto pode apontar para:

- modelo/revisão aprovada;
- variantes;
- escala/tamanho;
- material permitido;
- acabamento;
- imagens;
- custo base;
- preço;
- lead time;
- estoque pronto opcional;
- política de produção sob demanda.

### 6.6 Biblioteca 3D

A biblioteca deve ser first-class:

- STL;
- 3MF;
- OBJ e outros formatos somente quando owner de Files/preview suportar;
- preview quando disponível;
- hash/identidade de conteúdo;
- versões/revisões;
- tags/coleções;
- origem/licença quando conhecida;
- projeto/cliente relacionado;
- variante aprovada para produção;
- slicer/profile compatível;
- histórico de jobs derivados.

Nunca sobrescrever silenciosamente o modelo usado por um job histórico.

### 6.7 Projetos personalizados

Fluxo para encomendas customizadas:

```text
briefing
 -> arquivos/referências
 -> design/revisão
 -> aprovação
 -> versão congelada
 -> orçamento final
 -> produção
```

Revisão de arquivo precisa ser explícita para evitar produzir uma versão diferente da aprovada.

### 6.8 Fila de produção

A fila deve representar demanda real, não apenas lista manual.

Cada item precisa conhecer:

- ordem/prioridade;
- prazo;
- quantidade;
- compatibilidade de máquina;
- material/cor;
- profile requerido;
- tempo estimado;
- dependências;
- estado;
- motivos de bloqueio.

### 6.9 Scheduler

Primeira versão: recomenda alocação; humano aprova.

Fatores:

- capacidade/volume da impressora;
- material carregado;
- bico/nozzle;
- perfil compatível;
- tempo disponível;
- prazo do pedido;
- prioridade;
- manutenção;
- histórico de falhas;
- quantidade;
- necessidade de troca de material;
- custo operacional configurado.

O scheduler não deve mentir sobre precisão se o tempo vier apenas de estimativa do slicer.

### 6.10 Print Farm

Visão agregada das máquinas:

- livre;
- preparando;
- imprimindo;
- pausada;
- concluída;
- erro;
- offline;
- manutenção.

A UI deve distinguir claramente:

```text
estado canônico do job
!=
telemetria observada da máquina
!=
comando solicitado
!=
comando confirmado por receipt
```

### 6.11 Impressoras

Registro por máquina:

- ID estável;
- fabricante/modelo;
- volume de construção;
- tecnologia;
- nozzle/bico atual;
- materiais suportados;
- localização;
- horas/ciclos quando observáveis;
- firmware/version info quando permitido;
- capability adapter disponível;
- conectividade;
- histórico de manutenção;
- histórico de jobs/falhas;
- status de suporte: manual / telemetry / control.

### 6.12 Jobs

Job é unidade operacional de produção e deve ligar:

```text
order item
 + model revision
 + slicer/profile revision
 + printer
 + material/spool
 + estimated metrics
 + actual metrics
 + lifecycle
 + telemetry/receipts
 + quality outcome
```

Reimpressão cria job novo; não reescreve o histórico do job falho.

### 6.13 Slicer e perfis

O OrdaX não precisa criar slicer próprio na primeira etapa.

Criar provider/adapter para:

- importar estimates;
- armazenar referência ao arquivo preparado;
- versionar profile/config relevante;
- abrir/exportar workflow para slicer suportado;
- futuramente chamar APIs/CLI oficiais quando seguro e licenciado.

Integrações futuras podem contemplar OrcaSlicer, PrusaSlicer, Bambu Studio, Cura e outros sem tornar qualquer um requisito do domínio.

### 6.14 Materiais

Tipos gerais:

- filamento;
- resina;
- consumíveis auxiliares;
- componentes incorporados ao produto (ímãs, LEDs, parafusos etc.).

Material possui propriedades comerciais/técnicas separadas de uma unidade física específica.

### 6.15 Bobinas / lotes

Cada spool pode possuir:

- material;
- fabricante;
- cor;
- lote;
- peso nominal;
- peso restante estimado/medido;
- custo total;
- custo/g;
- data de abertura;
- localização;
- condição/secagem quando relevante;
- impressora/AMS slot associado quando observado;
- histórico de consumo.

Consumo deve registrar estimate e actual quando possível.

### 6.16 Estoque

Além de material de impressão:

- embalagens;
- cola;
- álcool/limpeza;
- peças de reposição;
- bicos;
- chapas;
- etiquetas;
- componentes usados no produto final.

Alertas de estoque são derivados de thresholds/predição; não inventam quantidade existente.

### 6.17 Qualidade e falhas

Registro estruturado de defeitos/falhas:

- spaghetti;
- warping;
- layer shift;
- under/over extrusion;
- entupimento;
- adesão;
- stringing;
- dimensional;
- acabamento;
- falha elétrica/mecânica;
- categoria customizada.

Registrar:

- material perdido;
- tempo perdido;
- máquina;
- profile;
- modelo;
- causa presumida vs causa confirmada;
- ação corretiva;
- retrabalho/reimpressão.

### 6.18 Manutenção

Manutenção por:

- calendário;
- horas/ciclos quando disponíveis;
- eventos;
- condição manualmente registrada;
- recomendação do fabricante.

Exemplos:

- lubrificação;
- limpeza;
- troca de bico;
- correia;
- extrusor;
- mesa/chapa;
- filtros;
- AMS/alimentação;
- calibrações.

Recomendação da Intelligence não deve substituir manual/fabricante como fonte técnica autoritativa.

### 6.19 Pós-processamento

Pipeline configurável:

- remoção de suportes;
- cura/lavagem;
- lixa;
- pintura;
- colagem;
- montagem;
- eletrônica;
- inspeção final;
- embalagem.

Permitir operações diferentes por item/produto.

### 6.20 Embalagem e entrega

Estados e dados para:

- pronto para embalar;
- embalado;
- retirada;
- motoboy;
- transportadora;
- Correios/provider de frete;
- código de rastreio quando houver.

Integrações regionais devem ficar em adapters, não no core de Fabrication.

### 6.21 Custos e preços

Separar:

- material consumido;
- material perdido;
- tempo de máquina;
- energia configurável;
- mão de obra;
- acabamento;
- embalagem;
- frete subsidiado;
- taxas de pagamento/marketplace;
- outros custos parametrizáveis.

O sistema precisa comparar **estimado vs realizado**.

### 6.22 Financeiro operacional

Primeiro recorte:

- vendas;
- pagamentos vinculados;
- custos por pedido/job;
- lucro bruto/operacional estimado;
- contas a receber simples;
- reembolso/cancelamento vinculado.

Não criar contabilidade completa, banco ou ERP fiscal paralelo antes de existir owner claro.

### 6.23 Equipe e permissões

Papéis iniciais configuráveis:

- owner/admin;
- atendimento/comercial;
- designer;
- operador;
- acabamento/qualidade;
- expedição.

Permissões devem usar os owners de identidade/Space/policy existentes.

## 7. Intelligence para Impressão 3D

A Intelligence deve funcionar sobre fatos autorizados do Space e ferramentas tipadas.

Exemplos de consultas válidas:

- "Quais pedidos correm risco de atraso?"
- "Quanto lucrei esta semana?"
- "Qual impressora apresenta mais falhas?"
- "Tenho PLA preto suficiente para os pedidos aprovados?"
- "Quais bobinas estão próximas de acabar?"
- "Qual produto possui maior margem?"
- "Mostre o desperdício por máquina."
- "Sugira uma distribuição dos jobs de amanhã."
- "Quais manutenções estão vencidas?"

### Regras de autoridade

LLM **não** pode ser source of truth de:

- preço;
- saldo de estoque;
- consumo;
- estado de job;
- estado de máquina;
- pagamento;
- prazo confirmado;
- permissão;
- comando físico.

A arquitetura correta é:

```text
intenção do usuário
 -> Intelligence
 -> typed query/tool
 -> owner do domínio
 -> resultado estruturado
 -> resposta
```

Para mutações:

```text
intenção
 -> proposta estruturada
 -> policy/permission
 -> revisão/consentimento quando exigido
 -> action owner
 -> receipt/audit
```

### Autopilot

Autopilot inicia **consultivo**:

- prever atrasos;
- sugerir prioridade;
- sugerir alocação;
- apontar estoque crítico;
- apontar manutenção;
- identificar variação de falhas;
- sugerir revisão de preço/margem;
- preparar resumo diário.

Não pausar/cancelar impressora, aceitar orçamento, cobrar cliente ou alterar preço automaticamente no primeiro estágio.

## 8. Integração física e Device Layer

A estratégia deve ser adapter-based.

Possíveis famílias futuras:

- Bambu Lab;
- Creality;
- Klipper/Moonraker;
- OctoPrint;
- Prusa;
- outros fabricantes/protocolos com integração permitida.

Não colocar protocolo de fabricante dentro do domínio `fabrication`.

```text
Fabrication domain
 -> Action Gateway / Device Agent capability
 -> printer provider adapter
 -> API/protocolo suportado
```

Capacidades separadas:

- discovery;
- telemetry;
- job submission;
- pause;
- resume;
- cancel;
- camera/media;
- material/AMS state;
- maintenance telemetry.

Uma integração pode suportar somente telemetry sem suportar controle.

## 9. Edge e continuidade

Operação profissional não deve depender do notebook principal permanecer ligado.

Topologias:

### Cloud-authoritative

Pedidos, clientes e estado comercial persistem no serviço compartilhado do OrdaX quando cloud estiver habilitado.

### Device-native

Quando a própria impressora mantém o job em armazenamento/controlador interno, preferir execução autônoma na máquina.

### Dedicated Edge

Quando protocolo/local hardware exigir host permanente:

```text
OrdaX Cloud
 -> Action Gateway
 -> OrdaX Edge Runtime
 -> printer/LAN/USB
```

O Edge não vira nova conta nem source authority de billing/Space membership.

### Falha de internet

O produto deve distinguir:

- trabalho já enviado e durável na impressora;
- fila local conhecida;
- comandos que exigem reconciliação;
- novos pedidos cloud ainda não recebidos pela loja;
- telemetria indisponível.

Ações stale/perigosas nunca devem ser reproduzidas cegamente após reconexão.

## 10. Realtime

Domínios iniciais:

```text
fabrication.orders
fabrication.production
fabrication.jobs
fabrication.inventory
fabrication.quality
device.telemetry
```

Eventos exemplos:

```text
order.created
order.approved
production.queue-changed
job.queued
job.started
job.progress
job.paused
job.failed
job.completed
spool.low
printer.offline
maintenance.due
```

Evento distribui mudança; não substitui estado canônico.

## 11. Web, Mobile, Desktop e OrdaX OS

Não criar cinco produtos.

```text
Fabrication Core
     +-> Web adapter
     +-> Mobile adapter
     +-> Desktop adapter
     +-> USB/Native Surface adapter
     +-> Edge/Device adapters
```

### Web

Deve permitir gerir operação sem exigir OrdaX OS instalado.

### Mobile

Útil para:

- alerts;
- acompanhar jobs;
- câmera quando suportada;
- aprovação/revisão;
- atendimento;
- expedição;
- inventário rápido.

### Native/Desktop

Maior integração com arquivos locais, slicer, impressoras e Edge quando autorizado.

## 12. Storefront e catálogo público

Fase comercial posterior pode oferecer catálogo próprio da loja:

- produtos;
- variantes;
- personalização;
- orçamento/pedido;
- pagamento;
- prazo;
- rastreio.

Storefront não deve virar outro backend: cria pedido no mesmo domínio Fabrication.

Integrações com marketplaces também devem entrar por providers/adapters.

## 13. Relação com catálogos/modelos externos

Biblioteca técnica do Space pode referenciar arquivos obtidos legalmente de fontes externas.

Regras:

- preservar origem/licença quando conhecida;
- nunca assumir que arquivo baixado pode ser revendido;
- catálogo público só deve publicar o que o negócio tiver direito de vender/exibir;
- integração futura com catálogos como STLForge deve ocorrer por contrato/provider, não acoplamento direto de banco.

## 14. Segurança e privacidade

Obrigatório:

- isolamento estrito por Account/Space;
- ACL de arquivos de clientes;
- secrets fora de Memory/Profile;
- tokens de fabricantes em secret storage apropriado;
- egress explícito;
- capability tipada para dispositivo;
- idempotência/expiry/stale-state checks em comandos;
- audit/receipts para ações físicas relevantes;
- nenhum shell genérico como "integração de impressora";
- nenhum Profile auto-concede privilégio;
- câmera só quando explicitamente configurada/permitida;
- dados de clientes não alimentam Knowledge público.

## 15. Modelo de dados conceitual

Objetos principais esperados:

```text
Customer
Quote
Order
OrderItem
Product
ProductVariant
Project
ModelAsset
ModelRevision
ProductionTask
PrintJob
Printer
PrinterCapability
SlicerProfile
Material
Spool
InventoryItem
QualityInspection
FailureRecord
MaintenanceTask
PostProcessTask
Shipment
PaymentRef
CostRecord
```

IDs devem ser estáveis; revisões técnicas devem ser imutáveis quando já referenciadas por produção histórica.

## 16. Fluxos canônicos iniciais

### Pedido simples

```text
cliente
 -> orçamento
 -> aprovação
 -> order
 -> production task
 -> job
 -> material/spool
 -> impressão
 -> qualidade
 -> embalagem
 -> entrega
 -> actual cost/margin
```

### Falha

```text
job running
 -> failure observed
 -> job failed
 -> material/time loss registrado
 -> quality/failure record
 -> reprint decision
 -> novo job
```

### Personalizado

```text
briefing
 -> project
 -> model revisions
 -> customer approval
 -> frozen revision
 -> quote
 -> production
```

## 17. Métricas do produto

A operação piloto deve conseguir medir:

- tempo quote → approval;
- tempo approval → production;
- lead time total;
- utilização por máquina;
- taxa de sucesso/falha;
- retrabalho;
- gramas desperdiçados;
- custo perdido por falhas;
- precisão estimate vs actual;
- margem por produto/pedido;
- jobs por dia/máquina;
- downtime;
- cumprimento de prazo;
- inventário parado;
- frequência de manutenção;
- ações recomendadas pela Intelligence aceitas/rejeitadas.

Métrica não deve exigir telemetria inexistente; distinguir medido de estimado.

## 18. Piloto comercial real — dogfooding

A primeira implantação comercial deve ocorrer em operação real do owner do projeto.

Objetivo: usar o sistema diariamente para descobrir diferenças entre especificação e trabalho real.

### Regra de generalização

Toda demanda observada no piloto passa por classificação:

```text
universal ao segmento
 -> candidato ao produto

comum a subset de operações
 -> configuração/module/provider

específico da loja piloto
 -> configuração privada/automação do Space
```

Nunca hard-codear nome da loja, produtos, máquinas ou workflow particular no core.

### Critério de piloto útil

Não basta demo com seed data. O piloto precisa registrar pedidos, jobs, materiais, falhas e conclusão reais por período suficiente para validar fluxo e consistência.

## 19. Fases

### Fase 0 — auditoria e boundary map

Antes de qualquer UI nova:

- revalidar main pós-MVP;
- mapear owners de Account/Spaces/Files/Projects/Realtime/Device/Intelligence;
- inventariar código reaproveitável;
- decidir storage e domain boundaries sem segundo backend;
- formalizar schemas de Fabrication somente onde lacuna for real;
- validar que MODE-001 fornece os runtime boundaries necessários.

### Fase 1 — Fabrication Core comercial

Entregar sem hardware real obrigatório:

- Customers;
- Quotes;
- Orders;
- Products;
- Projects/Model revisions;
- Production queue;
- Printer registry manual;
- Materials/Spools;
- costing básico;
- dashboards operacionais mínimos.

Gate: operação completa simulável com dados estruturados, sem mocks de autoridade.

### Fase 2 — Jobs e produção real

- PrintJob lifecycle;
- relação job ↔ order/model/printer/material;
- estimate vs actual;
- falha/reprint;
- qualidade;
- pós-processamento;
- entrega.

Gate: pedido real percorre do orçamento à conclusão sem perder rastreabilidade.

### Fase 3 — piloto da loja

- importar somente dados necessários;
- usar diariamente;
- registrar gaps;
- corrigir fricções;
- separar particularidade da loja de requisito do produto;
- medir indicadores.

Gate: operação real sustentada sem planilha paralela para os fluxos que o piloto declarar cobertos.

### Fase 4 — primeiro adapter de impressora

Escolher **uma** família/protocolo realmente usada no piloto.

- discovery/configuração;
- telemetry;
- status;
- progresso;
- receipts;
- opcionalmente ação segura específica.

Gate: capability real, documentada, sem shell genérico e com degradação clara offline.

### Fase 5 — slicer/provider integration

- importar estimates;
- vincular profile/revision;
- prepared file identity;
- handoff/open/export;
- avaliar automação somente via APIs/CLI suportadas.

Gate: job referencia exatamente o artefato/profile utilizado.

### Fase 6 — Intelligence operacional

- queries reais;
- risco de atraso;
- análise de custos/falhas;
- sugestão de alocação;
- material crítico;
- manutenção;
- resumo diário;
- typed tools somente após policy.

Gate: zero valor inventado para estoque/preço/job state; avaliações com dataset do piloto.

### Fase 7 — Web/Mobile/realtime endurecido

- views remotas;
- notifications;
- reconnect/reconciliation;
- autorização por Space;
- multi-device sem duplicar domínio.

Gate: dois clientes autorizados convergem para o mesmo estado canônico.

### Fase 8 — farm e adapters adicionais

Expandir somente guiado por demanda real:

- Bambu/Creality/Klipper/OctoPrint/Prusa etc.;
- capability matrix;
- health/support claims;
- Edge dedicado quando necessário.

Gate: cada adapter declara precisamente o que suporta.

### Fase 9 — storefront/comercialização

- catálogo público;
- pedidos externos;
- pagamentos via provider;
- shipping providers;
- entitlements/billing OrdaX;
- métricas comerciais.

Gate: storefront cria pedido no mesmo domínio e respeita policy/tenant isolation.

### Fase 10 — Fabrication além de impressão 3D

Somente depois de provar o core:

- CNC;
- laser;
- corte;
- workflows híbridos;
- produção com múltiplas tecnologias.

Não generalizar prematuramente schemas baseados apenas em hipótese.

## 20. Gates de aceite

Antes de declarar OrdaX Fabrication/3D Printing pronto comercialmente:

1. tenant/Space isolation provado;
2. pedido real mantém rastreabilidade até jobs e custos;
3. model revision utilizada em produção é imutável/auditável;
4. spool/material accounting não fica negativo silenciosamente;
5. falha/reprint não altera histórico;
6. estimate vs actual funciona;
7. offline/reconnect não duplica job/comando;
8. adapter físico possui capability matrix e receipts;
9. Intelligence não inventa valores autoritativos;
10. cancel/pause remoto respeita permission, expiry e stale state;
11. pilot store usa o fluxo coberto sem planilha paralela por período definido;
12. backup/recovery/migration do domínio foram testados;
13. Web/Mobile/Desktop/Native observam o mesmo domínio, não cópias divergentes;
14. custos externos e integrações têm owner/provider e política de revalidação.

## 21. Testes e evidências

Cobrir no mínimo:

- unit tests de costing/scheduler/rules;
- property tests onde quantidades/custos forem críticos;
- lifecycle tests de order/job;
- concurrency/idempotency;
- multi-tenant/cross-Space denial;
- adapter contract tests;
- reconnect/replay;
- inventory/spool reconciliation;
- model revision integrity;
- permission/action receipt;
- Intelligence tool-boundary tests;
- pilot evidence com dados sanitizados quando necessário.

Não usar hardware real como única forma de provar regra de negócio; adapters precisam de fixtures/simulators controlados, além de prova real separada.

## 22. Rollback e degradação

- falha de adapter não pode bloquear gestão de pedidos;
- falha de câmera não pode bloquear job;
- falha de cloud deve degradar explicitamente capacidades locais;
- falha de Intelligence não pode impedir operação básica;
- erro de scheduler não altera fila sem commit explícito;
- integração de slicer indisponível permite workflow manual/documentado;
- Profile update/rollback nunca apaga business data;
- Device adapter update deve possuir health/rollback compatível com owner correspondente.

## 23. Monetização futura

Não travar a arquitetura em preços atuais.

Possíveis eixos:

- plano gratuito para operação pequena/validação;
- assinatura Pro por Space/operação;
- tiers por recursos, equipe, histórico ou número de máquinas;
- Intelligence cloud por franquia/consumo;
- conectores premium específicos;
- implantação/suporte empresarial;
- Store de apps/Skills/Connectors futuramente.

Nunca cobrar por "desbloquear o arquivo do usuário" ou criar lock-in que impeça exportação razoável de dados.

## 24. Relação com FOOD-001

FAB-001 e FOOD-001 são verticais separados, mas devem provar a mesma arquitetura horizontal:

```text
Account
Spaces
Entitlements
Realtime
Intelligence
Files/Projects
Provider adapters
Web/Mobile/Desktop/Native
```

Não copiar esses componentes para cada vertical.

Prioridade proposta pós-MVP:

```text
MODE-001
 -> FAB-001 (primeiro piloto comercial real)
 -> FOOD-001 (segundo vertical comercial)
```

A razão é operacional: existe uma loja/atividade real de impressão 3D disponível para dogfooding imediato, permitindo validação contínua do produto antes de escalar para outro setor.

## 25. Próxima ação documental

Enquanto `DEFERRED FOR EXECUTION`:

- manter este plano alinhado aos owners canônicos;
- corrigir apenas divergências documentais verificadas;
- não abrir implementação comercial do Fabrication por causa deste plano;
- continuar fechando somente o recorte `impressao-3d-br@1` que o MVP já exigir.

## 26. Próxima ação de execução

**DEFERRED.**

Quando a janela pós-MVP abrir e este plano for promovido explicitamente:

1. auditar a `main` e MODE-001;
2. mapear owners/source existentes;
3. escolher boundaries mínimos do Fabrication Core;
4. começar pelo fluxo negócio → produção, não pelo suporte massivo a impressoras;
5. usar a operação real de impressão 3D como piloto desde a primeira versão útil.

## 27. Handoff para outro chat/agente

Ao assumir FAB-001:

1. leia `AGENTS.md` e a ordem canônica obrigatória;
2. leia `00-PLANOS-PRIORITARIOS/README.md`, `ROADMAP.md` e `REGISTRY.md`;
3. leia este arquivo inteiro;
4. leia `MVP.md` e confirme se o fechamento atual terminou;
5. leia `docs/SPACES-AND-PROFILES.md`;
6. leia `docs/OPERATIONAL-REALTIME.md` e seu contrato;
7. leia `docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md`;
8. leia os owners de Account/Spaces/Device Agent/Files/Projects/Entitlements vigentes;
9. leia `MODE-001` e revalide o estado real do Web/Cloud/Device runtime;
10. inspecione `system/profile-packs/impressao-3d-br/v1/manifest.json`;
11. não crie outro backend, conta, Memory, realtime ou device authority;
12. não altere o Profile v1 para carregar todo o produto comercial; componentes e contratos devem evoluir de forma versionada;
13. não comece por UI bonita nem por suporte a dezenas de impressoras;
14. primeiro feche o domínio mínimo de pedidos/orçamentos/produção/jobs/material/custos;
15. use a loja piloto real para validar cada fase;
16. registre explicitamente quando uma necessidade é universal, configurável ou específica da loja piloto;
17. preserve fail-closed e receipts para comandos físicos;
18. atualize o owner canônico real quando a implementação concluir; este plano não é changelog.

**Elegibilidade ao escrever este plano:** `DEFERRED FOR EXECUTION`, salvo o recorte de Profile já exigido pelos owners canônicos do MVP.
