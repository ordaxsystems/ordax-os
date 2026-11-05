# MODE-001 — OrdaX Web, Cloud & Device Runtime

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY — NOT IMPLEMENTED
- **Elegibilidade de execução:** **DEFERRED FOR EXECUTION**
- **Prioridade:** **P1 — alta prioridade estratégica pós-MVP**
- **Criado:** 2026-10-14
- **Atualizado:** 2026-10-14
- **Owner canônico:** `docs/PRODUCT-MODES.md` + owners de capabilities/serviços correspondentes; este plano não substitui esses owners
- **Base factual:** `main` revalidada em 2026-10-14, `docs/PRODUCT-MODES.md`, `docs/CURRENT-STATE.md`, `docs/DEVICE-AGENT-PROJECTS-WEB-MCP.md`, `docs/STORE-WEB-CATALOG-PRESENTATION.md`
- **Relatórios de apoio:** pesquisa externa de 2026-10-14 sobre Puter, Kasm, Windows 365, WebVM, Cloudflare, secure mesh/VPN moderna e VPS/cloud nodes; revalidar antes de decisões de provider
- **Dependências:** Identity/Account, Sync, Spaces/Profile owners, Store/App lifecycle, Files, Action Gateway, Device Agent, product capabilities e infraestrutura remota corrente
- **Não boot-critical:** SIM

`READY` descreve maturidade documental. Não autoriza implementação. A janela atual continua sendo o fechamento do MVP pelos owners canônicos; este plano permanece `DEFERRED FOR EXECUTION` até revalidação explícita pós-MVP ou até um owner canônico corrente exigir uma fatia específica.

## Problema

A `main` já possui uma apresentação canônica do **OrdaX Web** baseada na mesma Surface e no mesmo modelo de aplicações dos demais modos, mas possuir o serviço no source não significa que o navegador já tenha transporte, autorização e runtime capazes de consumi-lo.

O estado atual preserva corretamente funções sem fabricar disponibilidade:

- a Loja Web apresenta o catálogo oficial, porém ainda não possui transporte público para catálogo por conta/dispositivo nem lifecycle real;
- Arquivos possui domínio/capabilities no sistema, porém o Web não pode presumir acesso ao filesystem do dispositivo;
- identidade, Spaces e partes de sync já possuem fundação/incrementos, mas a continuidade completa Web/Device ainda depende de transporte autenticado e capabilities reais;
- Device Agent e Action Gateway já definem a direção para ações remotas tipadas, mas não existe runtime público de dispositivo a ser tratado como pronto;
- perfis/Spaces continuam subordinados aos respectivos owners e não devem ganhar implementação paralela dentro do Web;
- infraestrutura remota e provider backend não podem virar contrato do produto.

Sem um plano único, há risco de surgir um segundo backend Web, mocks permanentes, árvores de apps separadas, filesystem fictício, lifecycle de Loja reduzido ou uma VM cloud usada como substituto indiscriminado para o produto.

## Objetivo

Completar a arquitetura de **um OrdaX, vários modos**, tornando OrdaX Web uma porta de entrada real para a mesma conta, Surface, apps e estado sincronizável, com capacidades resolvidas por ambiente em vez de forks de produto.

O modelo alvo é:

```text
                         OrdaX Identity / Space
                                  |
                            Shared Surface
                                  |
                +-----------------+-----------------+
                |                 |                 |
              Web               Cloud             Device
           browser/PWA      compute/runtime      Desktop/OS/Edge
                |                 |                 |
                +-----------------+-----------------+
                                  |
                         capability contracts
                                  |
                  Sync / Action Gateway / Services
```

O usuário deve poder abrir OrdaX Web e usar imediatamente tudo que for realmente Web/cloud-capable. Quando uma capability exigir hardware/local state, o Web deve identificar dispositivos autorizados e rotear a ação pelo gateway, sem fingir acesso local. Quando uma tarefa puder executar em compute cloud autorizado, o runtime cloud deve ser uma opção de capacidade, não um segundo sistema operacional permanente.

## Não objetivos

- criar outro OrdaX ou outra árvore de Surface/apps para Web;
- transformar navegador em host privilegiado;
- dar acesso implícito a `C:\`, `/home`, USB, câmera, microfone ou outros recursos sem grant/plataforma;
- criar backend paralelo para Loja, Arquivos, Perfis, Intelligence ou Projetos;
- substituir Device Agent por automação Web própria;
- criar uma VM/desktop cloud permanente por usuário como requisito do produto;
- tornar Cloudflare, Hostinger, Supabase, Tailscale, NetBird ou outro fornecedor parte do contrato de domínio;
- criar uma VPN comercial/anônima como requisito desta frente;
- contratar VPS antes de existir workload persistente que justifique a despesa;
- reimplementar funções ausentes como versões reduzidas apenas para a UI deixar de mostrar indisponibilidade;
- promover Web, Mobile ou runtime remoto a release pública apenas porque o source existe;
- alterar gates de boot, kernel, Independent Base, Creator ou mídia física.

## Estado atual verificado

### Já implementado

- família oficial de modos: Web, Mobile, Desktop, USB e Native, como um produto sem forks;
- uma Surface compartilhada e adapters de capability por ambiente;
- composição/build canônico do OrdaX Web;
- apresentação da Loja Web ligada ao port oficial de catálogo, com estado indisponível fail-closed quando o transporte real não existe;
- direção canônica Action Gateway -> Device Agent para ações remotas tipadas;
- fundações reais de identidade/sync já presentes na `main`, subordinadas aos owners correspondentes;
- separação explícita entre portal público e OrdaX Web.

### Parcialmente implementado

- transporte Web de Identity/Spaces/sync;
- catálogo e biblioteca da Loja no Web;
- continuidade cross-device;
- presença/capabilities de dispositivo;
- integração de Projetos/Device Agent com Web;
- experiência Web de apps que dependem de serviços locais.

### Ausente

- contrato completo de resolução de runtime por app/capability (`web`, `cloud`, `device`, `hybrid`) com motivo verificável de disponibilidade;
- lifecycle real da Loja pelo Web;
- namespace de Arquivos que diferencie Cloud, navegador autorizado e dispositivos remotos;
- sessão pública de device bridge com autorização por conta/Space/dispositivo/capability;
- política explícita para conectividade privada/secure mesh quando conexão direta ou rede privada for necessária;
- compute cloud de produto como capability opcional e isolada;
- política para nodes persistentes/VPS quando jobs efêmeros não forem suficientes;
- política unificada de quotas/custos para storage/compute/realtime;
- rollout público comprovado do runtime remoto.

### Desconhecido / não provado

- provider remoto final e sua topologia de produção;
- necessidade real de uma secure mesh própria ou uso de infraestrutura/provider existente;
- necessidade real de VPS persistente, quantidade, localização e sizing;
- se toda persistência atual deve permanecer no backend existente ou migrar por capability;
- SLAs, custos e quotas reais em escala;
- compatibilidade final de cada app com Web/cloud/device;
- disponibilidade pública de Cloud runtime ou Device runtime.

Esses itens devem ser revalidados na `main` quando a execução abrir. Não converter hipótese de provider em estado factual.

## Decisões arquiteturais propostas

### 1. Um domínio, múltiplos transports

Serviços permanecem donos da semântica. Ambientes fornecem transports/adapters.

```text
Domain Service
   -> Web transport/adapter
   -> Cloud transport/adapter
   -> Device/native transport/adapter
```

Nenhum transport pode redefinir regras de negócio, autorização, lifecycle ou persistência do serviço.

### 2. Capability e runtime explícitos

Apps/capabilities precisam declarar ou derivar, por contrato versionado, onde podem executar.

Modelo conceitual, não schema congelado:

```text
runtime: web | cloud | device | hybrid
capabilities: [...]
permissions: [...]
availability: available | degraded | unavailable
reason: typed reason
```

A UI não deve inferir disponibilidade pela existência de um botão, bundle ou serviço no source.

### 3. Web-first quando seguro, device quando necessário

Prioridade de execução por operação:

```text
Web nativo, quando suficiente
 -> Cloud, quando compute/storage remoto for apropriado e autorizado
 -> Device, quando hardware/estado local for necessário
```

`hybrid` seleciona somente runtimes autorizados e reportados, sem fallback silencioso que aumente privilégios.

### 4. Arquivos como namespace federado

A UI de Arquivos deve poder representar fontes distintas sem fingir um filesystem único:

```text
Arquivos
  -> Nuvem            # conteúdo explicitamente sincronizado/cloud-owned
  -> Este navegador   # handles/arquivos concedidos pela plataforma/usuário
  -> Dispositivos     # conteúdo remoto via capability autorizada
```

Cloud content não implica upload automático de HOME. Device-local secrets e estado bruto continuam locais.

### 5. Device bridge pelo Action Gateway

O Web não abre portas no notebook e não chama Device Agent diretamente com autoridade de produto.

```text
OrdaX Web
 -> authenticated product transport
 -> Action Gateway
 -> authorized device session
 -> Device Agent
 -> typed capability
```

Começar read-only. Mutações exigem grants explícitos, escopo, expiração, auditoria e confirmação quando a ação for sensível.

### 6. Cloud runtime é capability, não fundação obrigatória

Compute cloud pode executar jobs isolados, agentes, build/conversão e serviços que realmente se beneficiem de compute remoto. Deve ser efêmero/recuperável e persistir somente estado autorizado em storage externo.

Não presumir um desktop Linux permanente por usuário como arquitetura base. Streaming de desktop/app remoto pode existir futuramente para casos específicos, mas não substitui Web nativo nem Device Agent.

### 7. Infraestrutura provider-neutral

O produto deve depender de contratos OrdaX, não de APIs de fornecedor.

Cloudflare é um candidato forte para uma implementação integrada de gateway/edge/realtime/storage/queues/compute. Se escolhido após revalidação, o mapeamento conceitual pode ser:

```text
Web/API edge       -> Workers
realtime/session   -> Durable Objects/WebSockets ou equivalente
object storage     -> R2 ou equivalente
async work         -> Queues ou equivalente
isolated compute   -> Containers/Sandbox ou equivalente
SQL/state          -> backend compatível com os contratos e migração aprovados
```

Não migrar schema/persistência apenas para encaixar um produto do provider. A Fase 0 deve reconciliar o SSOT real antes de qualquer mudança.

### 8. Perfis/Spaces não pertencem a este plano

`MODE-001` consome os owners canônicos de Profile/Space. Ele não cria manifests concorrentes nem finaliza perfis rascunho por conta própria. Seu papel é garantir que, quando um Space/Profile estiver válido, o mesmo objeto possa ser apresentado e autorizado nos runtimes compatíveis.

### 9. Loja continua uma Loja

A Loja não terá `Loja Web` reduzida e `Loja Native` real. O catálogo/lifecycle continua com owners únicos; o Web apenas ganha transporte e resolução de runtime/capability.

Exemplo conceitual:

```text
App
 -> catálogo/versionamento único
 -> runtime/capability envelope
 -> lifecycle por owner
 -> apresentação coerente em cada modo
```

### 10. Secure Mesh/VPN é transporte privado, não authority

Uma secure mesh pode ser útil para Device Agent, Edge Runtime, redes privadas e conexões device-to-device, principalmente quando NAT, firewall ou recursos LAN tornam uma rota privada necessária.

A arquitetura deve preservar:

```text
Secure Mesh = conectividade privada e criptografada
Action Gateway = autorização da ação
```

Entrar na malha não concede automaticamente acesso a arquivos, shell, apps ou rede inteira. Conta, Space, device, capability e grant continuam determinando authority.

Quando implementada, preferir tecnologia/protocolo consolidado e auditado, com WireGuard ou equivalente como possível data plane. Não criar criptografia própria. Tailscale, NetBird, Cloudflare e outros podem ser referência/provider, mas não contrato do produto.

O navegador público não deve receber acesso amplo à mesh. O fluxo padrão continua Web -> Control Plane/Action Gateway -> device session autorizada.

Secure Mesh é **subcapacidade de Device Bridge**, não um plano separado e não uma prioridade antes de existir necessidade concreta de conectividade privada.

### 11. VPS/Cloud Node é compute persistente opcional

Uma VPS é útil quando existir workload que realmente precise de processo persistente, IP/rede estável, cache local grande, relay/coordenação, runner duradouro ou outro comportamento inadequado a compute efêmero/serverless.

Ela não substitui Cloudflare/edge/control plane por padrão e não deve ser criada por usuário automaticamente.

Modelo conceitual:

```text
Control Plane / Edge
        |
Capability Resolver
   /        |        \
Web     Cloud Job   Persistent Node
         |              |
    sandbox/container  VPS/cloud node
```

Hostinger, Hetzner, DigitalOcean ou outro fornecedor são opções de infraestrutura, não dependências arquiteturais. A contratação só deve ocorrer após medição demonstrar que um workload persistente existe e que Workers/Containers/Sandbox/Device/Edge não resolvem de modo melhor ou mais econômico.

**Não contratar VPS agora apenas para “preparar o OrdaX”.** Preparar contratos e runtime resolution é suficiente até existir demanda comprovada.

## Caminhos/owners afetados

Revalidar antes de execução. Áreas hoje relacionadas:

- `docs/PRODUCT-MODES.md`;
- `docs/ACCOUNT-SYNC-AND-PLANS.md`;
- `docs/DEVICE-AGENT-PROJECTS-WEB-MCP.md`;
- `docs/STORE-WEB-CATALOG-PRESENTATION.md`;
- `system/contracts/product-capabilities.json`;
- `system/contracts/product-family.mjs`;
- `system/composition/web/`;
- `system/surface/`;
- `system/apps/`;
- `system/services/`;
- `system/adapters/web/`;
- owners de Action Gateway/Device Agent e infraestrutura remota.

Não criar paths novos apenas para corresponder a este documento. Encaixar no owner existente ou registrar ADR quando uma responsabilidade realmente nova for aprovada.

## Fases

### Fase 0 — auditoria e reconciliação de owners/providers

**Estado:** DEFERRED.

- revalidar `main`, `CURRENT-STATE`, `PRODUCT-MODES`, ownership e contratos;
- inventariar ports/capabilities reais já usados pelo Web;
- mapear identidade, Spaces, sync, Store, Files, Projects, Intelligence, Action Gateway e Device Agent;
- reconciliar o backend/control-plane factual corrente e qualquer migração em andamento;
- identificar duplicações ou transports experimentais;
- decidir se runtime resolution exige ADR/contrato próprio.

**Gate G0:** mapa de owners fechado, sem backend/serviço paralelo e sem provider tratado como domínio.

### Fase 1 — contrato de runtime/capability resolution

- definir envelope versionado para disponibilidade por modo;
- distinguir `web`, `cloud`, `device` e `hybrid` sem codificar plataforma na UI;
- motivos de indisponibilidade tipados;
- grants/permissions/effects ligados ao owner real;
- testes de fail-closed e backward compatibility.

**Gate G1:** a Surface consegue determinar disponibilidade real sem mocks e sem conhecer APIs de provider.

### Fase 2 — transporte autenticado Web base

- sessão/account real;
- Space selecionado;
- capability snapshot autorizado;
- device presence somente quando verificada;
- cancelamento/timeout/retry definidos;
- offline/degraded state explícito;
- nenhuma credencial de desenvolvimento ou operador chega ao Web.

**Gate G2:** Web usa identidade/Space reais e falha fechado sem sessão ou authority válida.

### Fase 3 — Loja Web real

- catálogo oficial por contexto autorizado;
- biblioteca/account entitlements quando o owner fornecer;
- resolução de runtime do app;
- install/update/enable/disable somente via lifecycle owner;
- requests e receipts distintos de conclusão;
- sem fallback para catálogo demonstrativo em modo oficial.

**Gate G3:** nenhum estado de UI pode apresentar instalação/conclusão sem receipt autoritativo.

### Fase 4 — Arquivos federados

Implementar por fontes separadas:

1. **Cloud:** objetos explicitamente sincronizados/armazenados;
2. **Browser:** acesso concedido pela plataforma/usuário;
3. **Device:** list/read/download primeiro via capability remota.

Depois, mutações tipadas: create/rename/move/upload/download/delete conforme owner/policy.

**Gate G4:** nenhuma origem é confundida; revogar grant remove acesso; operações não escapam do escopo.

### Fase 5 — Device bridge de produto

- registro/presença de dispositivo;
- capability advertisement autenticado;
- sessões curtas vinculadas a account/Space/device;
- read-only primeiro;
- mutações tipadas com grants, auditoria e revogação;
- Device Agent permanece executor local; Web não ganha shell genérico.

#### Fase 5B — Secure Mesh, somente se necessária

Adicionar conectividade privada apenas quando a Fase 5 demonstrar necessidade que HTTPS/WebSocket/gateway normal não resolva adequadamente.

- conexão device-to-device/Edge-to-device criptografada;
- NAT traversal quando aplicável;
- relay criptografado como fallback quando conexão direta não for possível;
- subnet routing somente para equipamentos/rede explicitamente autorizados;
- policy por account/Space/device;
- nenhuma porta local publicada diretamente ao navegador;
- a mesh não substitui grants do Action Gateway;
- provider/data plane substituível.

**Gate G5B:** estar conectado à mesh não concede nenhuma capability por si só; remover/revogar device ou grant encerra o acesso correspondente.

**Gate G5:** dispositivo offline/degradado não derruba o Web; ação sem grant nunca alcança o Device Agent.

### Fase 6 — continuidade de Apps/Spaces/Intelligence

- consumir Profile/Space validado pelo owner correspondente;
- sincronizar somente estado portátil autorizado;
- app state respeita runtime/capability envelope;
- Intelligence usa os mesmos owners de memória/model routing;
- nenhum contexto privado de outro Space é exposto ao Web/device bridge.

**Gate G6:** alternar modo/dispositivo preserva identidade e estado sincronizável sem transferir segredo local.

### Fase 7 — Cloud runtime opcional

Somente após Web e Device boundaries estarem fechados:

- job API tipada;
- sandbox/container efêmero;
- quotas de CPU/RAM/tempo/storage;
- egress policy;
- persistência externa autorizada;
- receipts de uso/custo;
- cancelamento e recuperação após restart;
- streaming de app/desktop apenas se um caso real justificar.

#### Fase 7B — Persistent Cloud Node / VPS, somente com workload comprovado

Avaliar VPS/cloud node apenas quando existir uma necessidade objetiva de processo persistente que compute efêmero, Device Agent ou Edge Runtime não atendam melhor.

Casos candidatos:

- relay/coordenação persistente de Secure Mesh, se realmente necessário;
- runner/build worker com cache/estado operacional duradouro;
- serviço especializado incompatível com serverless/containers efêmeros;
- ambiente profissional dedicado quando houver entitlement e modelo econômico comprovados.

Regras:

- não criar uma VPS por usuário por padrão;
- preferir pool compartilhado e isolamento forte quando apropriado;
- firewall, patching, backup, observabilidade e recovery são custo operacional explícito;
- manter a VPS atrás do control plane/gateway sempre que possível;
- provider substituível; Hostinger é apenas um candidato possível;
- começar pelo menor sizing que benchmarks justificarem;
- só contratar após estimativa de custo total e plano de saída/migração.

**Gate G7B:** workload persistente e vantagem técnica/econômica estão documentados; node pode falhar sem transformar estado efêmero em perda de estado autoritativo.

**Gate G7:** compute pode desaparecer/reiniciar sem perder estado que deveria ser persistente; nenhuma job recebe authority maior que o grant.

### Fase 8 — hardening e rollout

- observabilidade sem segredos;
- rate limits e abuse controls;
- quotas/entitlements server-authoritative;
- CSRF/XSS/session hardening;
- WebSocket/realtime reconnect e replay bounds;
- storage integrity/versioning;
- load/cost tests;
- accessibility/mobile layout;
- degraded/offline UX;
- release/promotion independente por capability.

**Gate G8:** rollout pode ser habilitado capability por capability sem promover funcionalidades ausentes.

## Gates de aceite globais

1. uma única Surface/app source continua válida;
2. nenhum serviço ganha backend Web paralelo;
3. Web não possui authority nativa implícita;
4. Store não simula lifecycle real;
5. Files diferencia cloud/browser/device;
6. device actions passam por gateway/grants/audit;
7. cloud compute é opcional e isolado;
8. provider pode ser trocado sem alterar consumer/domain contracts;
9. offline/degraded mode é funcional e explícito;
10. nenhuma mudança deste plano bloqueia boot/recovery/local use do OS;
11. Secure Mesh, quando existir, transporta mas não autoriza;
12. VPS/cloud node, quando existir, é implementação de compute persistente e nunca requisito universal do produto.

## Segurança/privacidade

- tokens de browser com escopo mínimo e expiração curta quando aplicável;
- device credentials privadas nunca sincronizam;
- ações sensíveis exigem consentimento/grant adequado;
- Web content, app metadata e device telemetry nunca viram authority por si só;
- namespaces de Files evitam exfiltração acidental de diretórios locais;
- logs/audit minimizam PII e conteúdo;
- cloud jobs não recebem HOME, secrets ou rede lateral por padrão;
- separação rígida entre authority de desenvolvimento e authority de produto;
- secure mesh não concede acesso de rede amplo por simples membership;
- chaves/identidades de mesh devem ter rotação/revogação e escopo por device;
- node/VPS não recebe release signing keys ou credenciais administrativas desnecessárias.

## Custos/limites

Não fixar pricing nem limites de provider neste plano.

Antes de rollout cloud:

- medir storage por account/Space;
- medir egress/realtime requests;
- medir compute por job;
- definir hard budget e degraded mode;
- registrar receipt de consumo onde houver custo variável;
- medir se Secure Mesh exige relay pago/egress próprio;
- comparar custo de compute efêmero versus node persistente;
- para VPS, considerar não só mensalidade, mas backup, tráfego, operação, patching, observabilidade e failover;
- revalidar preços/limites de Cloudflare, Hostinger ou qualquer provider na data da implementação.

Cloud runtime não deve ser iniciado automaticamente para toda sessão Web. Secure Mesh não deve ser ativada para todo dispositivo sem necessidade. **VPS não deve ser contratada enquanto não existir workload persistente comprovado.**

## Ordem interna de prioridade do MODE-001

Esta ordem orienta a futura revalidação e não autoriza execução enquanto `MODE-001` estiver `DEFERRED FOR EXECUTION`:

```text
1. runtime/capability contracts
2. transporte autenticado Web
3. Loja Web real
4. Arquivos federados
5. Device Bridge / Action Gateway
6. continuidade Apps/Spaces/Intelligence
7. Secure Mesh somente se Device Bridge demonstrar necessidade
8. Cloud Runtime efêmero
9. VPS/Persistent Cloud Node somente se workload persistente demonstrar necessidade
10. hardening/escala/rollout
```

Interpretação:

- **Secure Mesh/VPN:** P1 técnico dentro do Device Bridge quando necessária, não um produto separado;
- **VPS/Cloud Node:** capacidade posterior dentro do Cloud Runtime; não é prioridade de contratação agora;
- **VPN comercial/anônima/exit-node para navegação:** fora do objetivo principal e, se algum dia avaliada, deve ser uma frente opcional separada de segurança/produto, sem contaminar Device Bridge.

## Testes/evidências

Mínimos futuros:

- contract/runtime resolution matrix;
- Web sem sessão / sessão expirada / Space revogado;
- device offline/revogado/capability removida;
- Store request != completion;
- Files cloud/browser/device isolation;
- browser grant revoke;
- cross-Space negative tests;
- replay/idempotency de mutações;
- WebSocket/reconnect/reordering;
- quota/rate-limit exhaustion;
- cloud sandbox e egress negative tests;
- provider outage/degraded mode;
- secure mesh membership sem grant não permite ação;
- revogação de device/mesh encerra sessões correspondentes;
- relay/direct-path não muda authority;
- VPS/node restart e perda controlada sem corrupção do estado autoritativo;
- failover/degraded mode sem abrir acesso administrativo;
- app capability matrix Web/Cloud/Device;
- regression de Native/Desktop para cada transport alterado.

## Rollback/degradação

A ordem de degradação deve preservar segurança e utilidade:

```text
cloud/provider indisponível
 -> manter Web local/presentation possível
 -> manter cache/estado autorizado marcado
 -> manter device local independente
 -> esconder/desabilitar somente capability afetada
 -> nunca ampliar authority para compensar falha
```

Device offline não invalida cloud state. Cloud offline não invalida arquivos locais. Falha da Loja não impede Surface. Falha de cloud compute não impede apps Web/device que não dependam dele. Falha da Secure Mesh deve degradar somente rotas que dependem dela; quando houver rota normal autorizada, ela pode continuar. Falha de uma VPS não pode derrubar o control plane inteiro nem tornar um node persistente a fonte única de estado crítico sem recovery explícito.

## Prioridade e posição no roadmap

**P1 — alta prioridade estratégica pós-MVP.**

Razões:

- fecha uma frente de produto já iniciada em vez de adicionar apenas uma feature;
- desbloqueia integração real de Conta, Loja, Arquivos, Projetos, Spaces e dispositivos no Web;
- reduz risco de mocks virarem arquitetura;
- estabelece o boundary necessário para futuras capacidades cloud e remote-device;
- preserva a estratégia de um produto/uma Surface;
- não é requisito de boot/release físico, portanto não ultrapassa P0 atuais.

Quando a janela pós-MVP abrir, `MODE-001` deve estar entre os primeiros P1 a serem revalidados. A recomendação é revalidá-lo antes de capacidades aditivas que dependam de uma experiência Web/plataforma mais madura. Isso **não é autorização automática de execução** e não cria ordem irrevogável; `ROADMAP.md` deve ser revalidado contra a `main` naquele momento.

Secure Mesh e VPS **não elevam a prioridade do MODE-001 nem criam novos P0/P1 independentes**. São opções internas acionadas por necessidade comprovada. A prioridade do plano continua sendo fechar contratos, transports e boundaries reais antes de contratar infraestrutura.

## Relação com outros planos

- `SURFACE-001`: referência funcional; `MODE-001` não recria UI, apenas fecha capability/transport/runtime boundaries.
- `docs/SPACES-AND-PROFILES.md`: é o owner canônico da experiência unificada Space/composição; `MODE-001` consome apenas Space e Profile autorizados, sem owner paralelo.
- `PERSONAL-001`: pode consumir continuidade cross-device quando seu owner liberar.
- `NETWORK-001`: realtime social continua com seu owner e contratos.
- `WEB-001`: Web Research é capability distinta de pesquisa externa; não deve ser confundida com OrdaX Web. Pode usar a infraestrutura de identidade/budget/transport quando aplicável, mas continua plano separado.

## Próxima ação documental

Manter este plano coerente com `REGISTRY.md` e `ROADMAP.md`. Se a arquitetura de produto, backend/control plane, owner de Product Modes ou necessidade de Secure Mesh/VPS mudar antes do pós-MVP, atualizar este documento sem iniciar implementação.

Não criar plano separado de VPN ou VPS enquanto essas capacidades permanecerem subordinadas a Device Bridge/Cloud Runtime neste owner.

## Próxima ação de execução

**DEFERRED.**

Após fechamento do MVP, revalidar a `main`, confirmar owners/providers atuais e executar somente a Fase 0 após promoção explícita para `EXECUTION-ELIGIBLE`.

Não contratar VPS nem implantar Secure Mesh apenas para antecipar fases futuras.

## Handoff para outro chat/agente

Ao retomar `MODE-001`:

1. ler `AGENTS.md`, `00-PLANOS-PRIORITARIOS/README.md`, `ROADMAP.md` e `REGISTRY.md`;
2. ler `docs/PRODUCT-MODES.md`, `docs/CURRENT-STATE.md`, `docs/ACCOUNT-SYNC-AND-PLANS.md`, `docs/DEVICE-AGENT-PROJECTS-WEB-MCP.md` e `docs/STORE-WEB-CATALOG-PRESENTATION.md`;
3. verificar owners machine-readable de repository/product capabilities;
4. não assumir que o provider remoto, VPN/mesh ou VPS documentado hoje continua sendo a melhor opção;
5. se continuar `DEFERRED FOR EXECUTION`, limitar-se a documentação/reconciliação;
6. quando elegível, começar por owner/capability/transport contracts, não por UI nem provider SDK;
7. Secure Mesh só entra se a necessidade de conectividade privada for demonstrada; ela não substitui grants;
8. VPS/cloud node só entra se workload persistente provar necessidade e vantagem técnica/econômica;
9. nunca substituir funções preservadas por mocks reduzidos para “fazer o Web funcionar”;
10. atualizar owner canônico + registry/roadmap após qualquer decisão real.