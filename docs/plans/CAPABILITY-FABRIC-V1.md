# OrdaX Capability Fabric v1 — plano canônico de integração local

**Estado em 2026-11-03:** candidato A/B/C implementado sobre a `main`
remota em worktree exclusivo, com descoberta somente leitura, Store
CURRENT, Aura/Personal e recibos Native testados no Windows. A fase D
continua sem tool MCP publicada e sem autorização remota presumida.
Esta integração **não** cria fonte de autoridade, registro de apps
ou executor adicional; os gates externos de confiança e Runtime
continuam independentes.

## Decisão arquitetural

O MCP é uma fachada externa padronizada para capacidades internas nativas;
não é o dono da semântica dos aplicativos. Apps e serviços descrevem ações,
entidades, estados e eventos; o OS valida sua identidade e disponibilidade;
a Platform controla sessão remota, consentimento e grants. O Runtime apenas
descobre e encaminha capacidades autorizadas. Aura e UI devem consumir
os **mesmos serviços de domínio**, com autorizações próprias.

Autoridades existentes a preservar:

| Responsabilidade | Fonte canônica |
| --- | --- |
| Estado dos serviços, eventos e ciclo de vida | `system/services/system-foundation/runtime.mjs` |
| Actions verificadas por app e proposta tipada | `system/services/intelligence/application-action-capabilities.mjs` |
| Provedor instalado, identidade e artefato | Resolvers de first-party descritos em `docs/APPLICATION-ACTIONS.md` |
| Aprovação, grants, efeito e recibos | Personal OrdaX → Action Gateway → Action Executor |
| Produto, dispositivo e consentimento remotos | `ordax-platform` |
| Tradução para ferramentas MCP | `ordax-runtime` (outra frente; não duplicar no OS) |
| UI de Conta, Ajustes, Sistema e Loja | `ordax-surface` |

## Entregas sequenciais e gates

### A. Catálogo descritivo derivado — implementado localmente

- `system/contracts/capability-discovery.mjs`: contrato
  `ordax.capability-discovery/1`, livre de transporte e sem autoridade.
- `system/services/system-foundation/capability-discovery.mjs`: projeção
  exclusivamente **leitura**, unificando o estado do System Foundation com
  as ações já registradas e verificadas. Não armazena catálogo paralelo.
- Cada leitura consulta novamente suas fontes; remoção e mudança de provedor
  alteram a revisão de sessão. Erros rejeitam a leitura; nenhuma projeção
  antiga substitui uma fonte inválida.
- Capacidade `reported-available` prova apenas estado informado pelo serviço.
  Ação `declared-only` **não é** ferramenta executável.
- Saída: `authority=none`, `toolExecution=false`,
  `execution=unavailable` por entrada. Sem método `execute`, `grant`
  ou publicação MCP `tools/list`.
- Gate: testes de alterações dinâmicas, schema, fraude de autoridade,
  duplicações, recursos não autorizados, reversões e limites.

### B. Composição com fontes reais — Native parcialmente implementada

- A composição Native monta a projeção **após** `mountSurface`, usando
  `createNativeSurfaceHost(...).getSnapshot().capabilityIds` — o SSOT
  existente de observações reais — e o mesmo
  `appActionCapabilities` já verificado por `ordax-apps`.
- `createNativePersonalOrdaxComposition` consome uma referência de leitura
  diferida; não cria outro Foundation, mapa de disponibilidade, storage ou
  grant. `discoverCapabilities()` valida o contrato a cada leitura e
  rejeita fontes ausentes, adulteradas ou descartadas.
- O Surface Host pode mudar a lista de capacidades **durante** a sessão;
  a revisão de descoberta reflete a mudança. O método `subscribe()`
  aproveita o evento original do Host, notifica somente quando a revisão
  muda e permite cancelar a assinatura sem criar polling/eventos paralelos.
  Falha do Host é comunicada, nunca substituída por dados em cache.
- A descoberta Native também consulta **a observação de slot atual**
  já verificada pela projeção da Loja. Para cada ação declarada no
  bootstrap, exige identidade exata de app, versão, revisão e
  `sourceCommit` antes de mostrá-la. Essa comparação pertence a
  `current-verified-action-gate.mjs`; não contém outra lista de apps,
  tokens ou grants.
- Eventos da projeção da Loja chamam `CapabilityDiscovery.refresh()`
  após a fonte atualizar suas observações. Durante uma verificação
  pendente/indisponível, as ações aparecem ausentes; remoção, atualização
  ou divergência de provedor retiram imediatamente as ações anteriores.
  O serviço não faz polling adicional.
- O registro canônico de Application Actions recebe um verificador
  opcional de **slot atual**. O mesmo port, e não um adaptador concorrente,
  filtra `list/get/listForApp/propose/contextItem/contextItemForApps`.
  Ações removidas desaparecem do contexto da Aura antes da próxima
  inferência. Metadados inválidos falham fechado, sem restaurar cache.
- A camada de awareness reaproveita os descritores declarativos para
  validar os manifestos, mas projeta no contexto da Aura somente os
  aplicativos externos verificados como atuais. O semantic router também
  filtra os detalhes/intenções dos externos removidos; Sistema, Conta e
  Ajustes nativos permanecem disponíveis.
- O Personal OrdaX usa a mesma descoberta para listar ações, bloquear
  propostas obsoletas e revogar preparações ainda pendentes. O fluxo
  existente do Gateway continua obrigatório, com revogação fail-closed.
- **Limite desta etapa:** a resposta `accepted` do lifecycle delegate
  significa solicitação aceita, NÃO ativação concluída. Para carregar
  manifesto de versão nova, aguardar current slot promovido e saudável,
  reler fonte e identidade antes/depois, reconstruir em conjunto
  awareness/router/Action Registry e preservar revisão/epoch.
  Não reiniciar Surface por mera aceitação, nem aceitar revalidação
  parcial com consumidores antigos.
- **Limite desta etapa:** a nova versão só pode publicar novas ações
  após revalidar seu manifesto e reconstituir os consumidores canônicos;
  não há hot swap de adaptadores nem autorização implícita. O teste
  cobre retirada e eventual retorno de uma *mesma* identidade já
  verificada, não comprova instalação física de um novo app.
- Entradas `reported-available` não são tools MCP. Ações
  `declared-only` permanecem `execution=unavailable`.
- **Pendente:** validar uso de ações reais por UI/Aura e consumo remoto,
  sem criar uma segunda rota para emissão de grants. A execução segue
  bloqueada até resolver os providers verificados e o Action Gateway.
- Gate intermediário: Host Native real em teste de contrato, Personal
  OrdaX e bootstrap físico do Desktop Windows concluídos no HMR local;
  o `main.mjs` atualizado foi servido via Vite, a Surface montou e não
  houve diagnóstico de erro do Fabric. Ainda **não há endpoint público
  de consulta** nem recibo de execução MCP; portanto esse boot não
  homologa descoberta remota de ferramentas.
- Gate completo: app instalado/removido com revisão revalidada durante a
  sessão, identidade equivalente em UI/Aura/Runtime e execução autorizada
  verificável, sem segunda fonte de verdade.

### C. Roteamento semântico e execução autorizada — primeiro gate local

- **Implementado localmente:** o Fabric projeta também as ações Native do
  `PersonalActionCatalog` existente, usando `getNativeActions`, como
  `native-action` descritivas (`execution=unavailable`,
  `authority=none`, `confirmation=always`). A projeção preserva
  privadamente o hash do artefato na revisão e compara a identidade atual
  antes de encaminhar uma solicitação, sem publicar tools MCP.
- A composição Native consome exatamente esse catálogo e oferece
  `requestDiscoveredNativeAction(workId, capabilityId, {resourceValue,
  expectedRevision})` como **solicitação de aprovação**, nunca como
  execução. O destino final continua sendo `PersonalActionCatalog.request`
  → aprovação/consentimento → Action Gateway → Action Executor → recibo.
- Aprovações iniciadas por descoberta Native ficam vinculadas à revisão,
  identidade do artefato, Work e geração de contexto. Remoção ou mudança
  do catálogo antes do consentimento impede o grant; após consentimento,
  impede despacho e revoga a aprovação aprovada. A ligação é transitória,
  não um registro de grants nem outro executor.
- **Prova local:** `tests/test_capability_fabric_native_action_bridge.mjs`
  cobre a ação `native-file.ensure-directory` com consentimento explícito,
  recibo real em File Space simulado, bloqueio de mutação duplicada,
  revogação antes/depois do consentimento e divergência de hash.
  O conjunto dirigido (Fabric + Personal + Current Gate) terminou em
  **44/44** testes; a regressão adicional de Aura/semântica/Personal
  terminou em **51/51**. No Windows em desenvolvimento, Electron e
  `local-dev.cjs` permaneceram ativos e o Vite local serviu os três
  módulos Native/Fabric por HTTP 200, com `getNativeActions` no módulo
  de composição. Isso comprova entrega do código ao dev server, não
  execução física completa pela UI nem MCP remoto.
- **Segundo gate implementado localmente:** o mesmo
  `createPersonalActionProposalPlanner` usado pelo Personal/Aura filtra
  sua lista de ações pelo Fabric no início e no fim da inferência; o Work
  registra a revisão esperada. `proposeAvailableAction`,
  `proposeActionForWork`, `requestProposedAction`,
  `requestAvailableAction` e `requestDiscoveredNativeAction` convergem
  a `requestCurrentNativeApproval` apenas quando há Fabric montado.
  Nunca há outro planner, catálogo, grant issuer ou executor.
- O wrapper **existente** `createApplicationContextIntelligence` consulta
  o mesmo Fabric a cada inferência e injeta apenas `native-action` como
  contexto `ordax-native-capabilities` de leitura: sem tool, hash,
  credencial, aprovações ou autoridade. Ações de apps continuam sendo
  projetadas unicamente pelo registry de Application Actions; JSON que
  excede o limite de contexto é omitido inteiro.
- **Segurança do ciclo de vida:** mudança de revisão, atualização do hash,
  ausência de provedor ou troca de Owner antes do consentimento ou despacho
  bloqueia autorização e efeitos. IDs de aprovação são owner-local,
  portanto os vínculos transitórios usam chave composta por Owner + ID;
  eventos do próprio runtime liberam apenas vínculos terminados na
  partição correta. Após restart, uma aprovação pendente sem vínculo vivo
  deve ser solicitada de novo, não pode receber grant.
- **Terceiro gate — fechamento de autoridade e eventos:** a composição
  agora protege os métodos herdados de baixo nível `requestApproval`,
  `resolveApproval`, `prepareActionExecution` e `startActionExecution`
  para ações Native geridas pelo Fabric. Aprovações Native emitidas
  diretamente sem vínculo à revisão são rejeitadas; negar uma solicitação
  obsoleta continua permitido. Ações não Native mantêm o fluxo existente.
  O `reconcileApprovedAuthority()` já canônico retira imediatamente
  grants aprovados que perderam a revisão do Fabric; a assinatura já
  existente do Host/Store chama o reconciliador após alterações, sem
  polling, broker extra ou fonte de permissões paralela. Aprovações ainda
  pendentes permanecem não autorizáveis e precisam de cancelamento ou
  negativa explícita; não são rotuladas falsamente como decisão humana.
- **Validação adicional (2026-11-03):**
  `tests/test_capability_fabric_aura_context.mjs` prova contexto read-only,
  ausência de duplicação e retirada imediata na Aura.
  `tests/test_capability_fabric_native_action_bridge.mjs` cobre
  planejamento nativo, mudança durante inferência, bloqueio de aprovação
  por remoção, concorrência, A→B→A com ID repetido, pendência pós-restart,
  acesso direto aos métodos de baixo nível e revogação proativa por eventos
  de Host/Store ou mudança de hash do provedor.
  Regressão ampliada anterior da etapa: **294/294 testes passando em 38
  arquivos**, sem falhas nem skips; `node --check` em oito módulos/tests e `git diff --check`
  também passaram. Desktop dev/Electron permaneceram ativos e o Vite
  serviu a composição Native, contexto da Aura e Personal por HTTP 200.
  Checkout local ainda em `main@a8b80e9cd`, sem commit/push/PR.
  Esse gate comprova código local e contratos, não automação física
  da UI, consentimento humano real ou exposição de tools MCP.
- **Pendente:** expor a seleção semântica ao fluxo visual proprietário
  em `ordax-surface` (outra frente), homologar execução efetiva na UI
  física Windows e no USB, e integrar ferramentas autorizadas ao Runtime MCP
  em `ordax-runtime` sob sua autoridade própria. A revisão é validada antes
  do despacho; efeitos já iniciados continuam sujeitos à semântica
  existente de recibo incerto.
- Reutilizar o fluxo existente: preparação vinculada ao Work → resolver de
  provedor atual → aprovação/grant exato → Action Gateway → Action Executor
  → recibo. Não ligar callbacks de apps diretamente ao modelo ou ao MCP.
- Idempotência, revisão esperada, recibo e operação durável são requisitos
  para mutações/ações longas, não para a descoberta read-only.
- Gate: duas solicitações com mesma chave não duplicam mutação; revogação,
  troca de owner, app atualizado e provider offline falham fechado.

### C.1. Validação física Windows — File Space e recibos reais

- **Implementado e comprovado no DESKTOP-4UFL03B em 2026-11-03:**
  `tests/test_capability_fabric_windows_file_space_e2e.mjs` usa o
  `createDesktopFileSpaceMiddleware` de produção, servidor HTTP local
  protegido por token e Origin, `createNativeFileSpace`, a inscrição
  `createNativePersonalOrdaxFileActions`, o Fabric e a composição
  canônica Personal/Action Gateway/Action Executor. Os testes gravam
  diretórios físicos em pasta temporária isolada, validam o resultado
  com `node:fs` e apagam o diretório ao concluir.
- **8/8 testes reais aprovados:** aprovação explícita → grant exato →
  execução Native → pasta física → recibo; repetição idempotente;
  revogação em evento de retirada do provedor antes do despacho;
  bloqueio de traversal e chamadas HTTP não autenticadas; interrupção
  da resposta de rede **após** o Windows persistir a pasta → tentativa
  `uncertain`, grant revogado, sem repetição após reconstrução da
  composição; negativa humana sem mutação; e duas chamadas simultâneas
  sobre a mesma aprovação produzindo uma única execução;
  restauração após reinício com registro Native removido, mas resolvedor
  antigo ainda presente, impedindo novo consentimento e escrita física.
- **Regressão ampliada anterior:** **309/309 testes aprovados, 41 arquivos**,
  sem skips nem falhas, incluindo adaptadores File Space existentes e
  testes de segurança/continuidade do Personal. Não foi necessário
  criar novo executor, endpoint, armazenamento ou build USB.
- **Limite explícito:** trata-se de Node.js executado no Windows físico
  com HTTP/arquivos reais; o consentimento foi exercitado pela API
  oficial `approvalConsent` no teste. Não é prova de clique humano
  na UI Electron/Surface nem operação MCP remota. A UI precisa consumir
  os métodos que já existem em Personal; a Surface continua sob o owner
  do seu próprio repositório, sem implementar interface duplicada no OS.

### C.2. Falhas de observação e renovação de revisão

- **Implementado localmente:** qualquer falha de leitura, validação ou
  enumeração em `createCapabilityDiscovery.snapshot()` invalida somente
  o fingerprint transitório de comparação, sem publicar um catálogo
  fictício nem avançar a revisão em leitura inválida. A próxima leitura
  **válida** cria uma nova revisão mesmo que os descritores públicos não
  mudem. Falha ou ausência durante a segunda consulta à identidade da
  ação Native (`isNativeActionRegistered`) recebe o mesmo tratamento.
  Dessa forma uma aprovação `pending` emitida antes de um intervalo
  não observável não volta a ser autorizável apenas porque os metadados
  do provedor reapareceram idênticos.
- **Falha proativa:** a composição Native chama
  `reconcileApprovedAuthority()` também no callback de erro do Host,
  nos erros de `refresh()` disparado pela Store e na falha de montagem.
  O reconciliador usa o revogador de grants e o journal existentes; não
  há timer, segundo registry, concessão implícita nem repetição de ação.
  Falha da própria revogação é diagnosticada separadamente.
- **Provas:** falha de leitura na notificação Host; erro no refresh da
  Store; recuperação da mesma identidade após falha; tentativa pendente
  anterior impedida; falha/ausência na segunda verificação de provedor
  forçando nova revisão, sempre sem efeitos Native.
  **Regressão total selecionada: 315/315 testes aprovados em 41 arquivos**
  na máquina Windows. Testes reais de disco agora são 8/8.
  O resultado não comprova clique na UI nem tool MCP remoto.
- **Escopo inalterado:** checkout local `main@a8b80e9cd`, sem commit,
  push, PR, reinstalação ou modificação do repositório `ordax-surface`.

### C.3. Aprovações órfãs e preparações após troca de slot

- **Proteção de aprovação Native órfã:** o ID oficial do tool
  `NATIVE_FILE_ACTION_TOOL_ID` é reutilizado da definição existente
  do adaptador Native. Mesmo que o catálogo esteja vazio depois de
  um reinício, uma aprovação persistida dessa ferramenta não recupera
  consentimento por existir um resolvedor antigo. Também ficam bloqueadas
  solicitações de baixo nível `requestApproval` para essa identidade,
  sem impedir aprovações legítimas de ferramentas não Native.
- **Ações de aplicativos verificadas:** a registry existente já retira
  declarações quando o slot assinado atual deixa de corresponder à
  identidade verificada; nenhuma fonte de inventário foi duplicada.
  Complementamos o uso da mesma revisão do Fabric nas sugestões
  `suggestApplicationActionForWork` e `prepareSuggestedApplicationAction`
  e na vinculação transitória das preparações de Work. A→B→A durante
  inferência ou entre sugestão e preparação não pode ressuscitar ações.
- **Eventos da Loja e Host:** o reconciliador já usado pelo Desktop
  revoga também preparações de Application Actions vinculadas a revisão
  anterior ou observação inválida. Não concede grants de aplicativos
  nem oferece execução direta ao modelo ou ao MCP.
- **Provas reais e regressão local:** cenários de aprovação órfã após
  reinício, solicitação Native crua, gravação física Windows negada,
  inferência durante A→B→A, preparação após A→B→A, revogação imediata
  por evento Host/Store e recuperação de observação inválida.
  **Regressão da etapa C.3: 323/323 testes aprovados em 41 arquivos;
  8/8 com File Space HTTP e sistema de arquivos reais no Windows.**
- **Limites:** ainda faltam cliques reais na UI da Surface e integração
  efetiva de tools MCP no Runtime, sob os owners correspondentes.

### C.4. Concorrência durante a preparação e o pedido de aprovação

- **Falha reproduzida e corrigida:** callbacks síncronos na emissão de
  um ID de preparação podiam provocar A→B→A no Store ou troca de Owner
  enquanto uma Application Action ainda estava sendo preparada.
  Agora a composição captura Owner, geração de contexto, revisão de
  Work e revisão do Fabric **antes** de chamar o registro canônico de
  preparações. Após o retorno, compara os mesmos vínculos com as fontes
  vivas e revoga a referência recém-criada se qualquer condição mudou.
  Não cria registro, autoridade ou executor adicional.
- **Pedido Native:** durante a conversão do recurso pelo catálogo
  existente, um callback pode remover o provedor. A composição fornece
  ao catálogo somente uma porta de `requestApproval` guardada, que
  verifica a revisão, identidade do artefato, Work e Owner imediatamente
  antes de solicitar a aprovação ao runtime canônico. Após a emissão,
  verifica novamente o Owner e a revisão antes de criar o vínculo
  transitório de consentimento. Se a conta mudar durante a notificação
  do runtime, uma pendência já persistida fica **sem vínculo de
  autorização** e não pode receber grant; ela não é convertida
  artificialmente em recusa humana.
- **Novos testes causais:** mudança A→B→A síncrona no gerador de ID de
  preparação; troca de Owner no mesmo callback; retirada da inscrição
  Native durante a validação do recurso; troca de Owner durante o
  evento de aprovação. Todos falhavam antes das correções e passaram
  depois.
- **Regressão dirigida concluída:** **327/327 testes aprovados,
  41 arquivos**, sem falhas nem skips, incluindo os **8/8 testes com
  File Space real no Windows**. Permanecem pendentes a UI física da
  Surface e a integração MCP remota.

### C.5. Eventos reentrantes sem duplicar revisões

- **Problema reproduzido (2026-11-03):** o listener da descoberta
  chamava `refresh()` sincronicamente ao receber a mudança do Host.
  Como o cursor do assinante era atualizado somente após retornar do
  callback, uma revisão podia ser entregue repetidamente, e outro
  assinante podia receber uma revisão antiga depois de uma mais nova.
  Isso é relevante para revogação de grants e preparações da Loja.
- **Correção na fonte única:** `createCapabilityDiscovery.subscribe()`
  atualiza o cursor monotônico antes de invocar o assinante e nunca
  notifica revisões menores ou idênticas à última recebida. O callback
  `onError` existente continua sendo usado para falhas na reconciliação;
  não foi criada fila, timer, polling, journal ou segunda fonte de estados.
- **Provas:** quatro cenários de reentrância testam chamada repetida
  `refresh()`, A→B da fonte dentro do callback, múltiplos assinantes
  com entrega aninhada e tratamento de exceção pelo callback de erro.
  Regressão ampliada: **337/337 testes aprovados em 43 arquivos**,
  incluindo os oito cenários HTTP com File Space físico no Windows.
- **Runtime Native:** `system/services/device-agent/native-product-lifecycle.sh`
  já controla o agente oficial por plano de componente verificado,
  estado de identidade e política local, sem depender da Surface como
  executor. Esse ciclo não exporta, por si, um canal autenticado de
  capacidades da Surface ao processo Runtime. Não usar o Host Bridge
  de mensagens da página como substituto dessa fronteira.

### C.6. Assinatura Native sem janela cega no arranque

- **Defeito reproduzido e corrigido (2026-11-03):** uma atualização
  de slot ou provedor podia acontecer entre o `snapshot()` inicial e
  a chamada a `NativeSurfaceHost.subscribe()`. Sem novo evento, a
  composição perdia a mudança e podia deixar grant previamente aprovado
  aguardando reconciliação.
- **Correção sem duplicação:** o mesmo `createCapabilityDiscovery.subscribe()`
  executa um único `check()` imediatamente após vincular o listener
  ao Host, usando os mesmos resolvers e cursor monotônico de sessão.
  Mudança no intervalo gera o evento correto; leitura sem mudança não
  gera notificação redundante. Erro durante essa leitura desfaz a
  assinatura Native e remove o check registrado, em vez de deixar um
  callback órfão. Nenhum timer, polling, ledger ou transporte foi criado.
- **Prova da autoridade:** teste injeta remoção do registro Native
  exatamente durante o registro do listener e confirma que o callback
  de reconciliação revoga a aprovação já concedida, sem executar
  mutação. Outros dois testes reproduzem a perda de evento e vazamento
  de assinatura durante inicialização, antes da correção.
- **Regressão atual selecionada:** **340/340 testes aprovados em
  43 arquivos**, sem falhas ou skips, incluindo os **8/8 testes de
  File Space com HTTP e disco reais no Windows**. O resultado não
  equivale a homologação física de Surface GUI ou sessão MCP remota.

### C.7. Desmontagem sem callbacks residuais e reinício sem replay

- **Erro reproduzido:** a iteração de `refresh()` usa uma cópia
  estável dos assinantes; quando um assinante anterior removia o
  seguinte, este ainda recebia uma notificação enfileirada. A
  desinscrição dentro do próprio resolver da fonte também podia
  liberar um callback ou diagnóstico após o encerramento.
- **Correção no mesmo catálogo:** cada `subscribe()` mantém apenas
  um indicador transitório de atividade, desativado imediatamente
  quando a assinatura termina ou falha durante a instalação.
  `check()` verifica o indicador antes e depois da leitura das
  fontes; nenhuma notificação ou diagnóstico é entregue à assinatura
  encerrada. A liberação é idempotente; o Host continua sendo a única
  fonte de eventos, sem fila, polling ou segundo registro.
- **Prova física de reinício Windows:** com Host HTTP real e uma pasta
  temporária isolada no NTFS, uma ação Native foi explicitamente
  aprovada e ficou sem despacho. Ao reconstruir o Personal com o
  mesmo journal e provedor ainda instalado, a autorização antiga
  foi revogada, uma execução posterior foi negada e nenhuma pasta
  foi criada. Isso não representa reboot completo do Electron, mas
  exercita a reconstrução da composição e do estado persistido.
- **Regressão ampliada:** **344/344 testes em 43 arquivos**,
  sem falhas nem skips; **9/9 cenários Windows com File Space real**.
  Não houve commit, push, nova ponte MCP nem alteração de outros repos.

### C.8. Encerramento definitivo da composição Personal e remontagem

- **Falha reproduzida (2026-11-03):** depois de `dispose()`, métodos
  próprios da composição ainda listavam o antigo catálogo de
  Application Actions e aceitavam propostas/novas preparações,
  apesar do runtime interno já ter encerrado. Um resolvedor antigo
  podia continuar sendo consultado por referências residuais.
- **Correção no owner existente:** uma guarda comum
  `requireActivePersonal()` fecha os pontos públicos de propostas,
  preparações, pedidos Native, aprovações, execução e resoluções
  de provedores assim que a composição encerra. Listagens de
  capacidades/preparações de uma composição encerrada retornam vazio;
  `canApprove` e `canExecuteApprovedAction` retornam falso.
  Os registries e o journal canônicos continuam únicos; nenhuma
  autorização anterior é reaproveitada no próximo mount.
- **Prova Windows real:** o File Space com HTTP e diretório físico
  confirmou que o Personal antigo não cria a pasta mesmo que a
  aprovação existisse antes de remontar. A nova composição consegue
  criar outra pasta somente depois de NOVO consentimento explícito.
  O caso valida reconstrução do Personal sobre persistência real,
  não um reboot físico completo do Electron/OS.
- **Regressão atual selecionada:** **348/348 testes aprovados em
  43 arquivos**, sem skips ou falhas, incluindo **10/10 cenários
  HTTP + filesystem real no Windows**. Sem commit, push, builds USB
  ou alterações em outros repositórios.

### C.9. Autoridade vigente na confirmação do recibo físico

- **Falha reproduzida e corrigida (2026-11-03):** o executor Native
  verificava a autoridade ao iniciar a ação, mas o retorno de uma
  mutação HTTP podia ser confirmado como `succeeded` mesmo quando
  o provedor já havia sido retirado **sem emitir evento do Host**
  enquanto o adaptador estava em execução.
- **Fence no fechamento, sem novo executor:** depois que o adaptador
  canônico devolve um recibo de sucesso e antes de consumi-lo com
  `runtime.finishActionExecution()`, a composição revalida a
  revisão do Fabric, a identidade do provedor e o vínculo Owner.
  Se não estiverem atuais, reconcilia/revoga a aprovação pelo
  runtime existente e registra a tentativa como `uncertain` pelo
  journal canônico. Não confirma `succeeded` sob autoridade
  obsoleta nem tenta repetir a mutação. Após o adaptador ter
  entrado, o estado físico pode já ter mudado: `uncertain`
  é distinto de `failed` antes de qualquer efeito.
- **Prova E2E sobre middleware e disco Windows reais:** o teste
  retém exclusivamente a resposta HTTP após o middleware criar
  a pasta no diretório NTFS isolado. Retira o provedor sem
  `Host.refresh()`, libera a resposta e comprova: recusa do
  recibo antigo, attempt `uncertain`, grant revogado e
  nenhuma repetição após remontagem. Outras provas validam
  desmontagem enquanto a resposta está em voo e troca de conta
  A→B→A após o efeito físico, mas antes do recibo.
- **Regressão local:** **351/351 testes aprovados em 43
  arquivos**, sem falhas nem skips; **13/13 testes físicos
  Windows**. Nenhuma credencial, grant ou executor MCP foi
  criado ou ativado.
- **Limite explícito:** mudanças A→B→A que ocorram inteiramente
  entre duas observações **sem qualquer evento, revisão ou
  verificador observável** não podem ser inferidas pelo Fabric;
  a fonte assinada e o Runtime devem preservar essa identidade
  e seus eventos na integração futura. O teste Windows não prova
  conexão MCP autenticada, UI visual ou boot físico do OrdaX OS.

### C.10. Não executar após revogação durante publicação do attempt ou resolução do adaptador

- **Causa raiz reproduzida no Windows físico (2026-11-03):**
  `runtime.startActionExecution()` grava o attempt `started` e
  notifica assinantes síncronos. A remoção silenciosa do provedor
  durante essa publicação ainda permitia a entrada no adaptador
  File Space e a criação efetiva da pasta. Uma segunda brecha
  acontecia se o adaptador fosse resolvido após o gateway validar
  o grant: uma troca de provedor durante o resolvedor também
  permitia entrar no adaptador sob metadados obsoletos.
- **Correção sem duplicação:** `createNativePersonalOrdaxComposition`
  reconfirma a revisão/owner do Fabric **depois do start durável e
  antes de entrar no executor**. O `createPersonalOrdaxActionExecutor`
  canônico oferece uma guarda opcional, síncrona e exclusivamente
  negativa `verifyBeforeAdapter(request)`; a composição Native
  fornece o mesmo verificador de aprovação vigente. A guarda roda
  **após resolver o adaptador tipado e antes de `adapter.execute`**,
  para detectar efeitos colaterais síncronos do próprio resolvedor.
  Não cria grants, servidor MCP, adaptador alternativo ou segunda
  fonte de capacidades.
- **Contabilidade causal:** quando a capacidade deixa de ser
  válida **antes** da entrada no adaptador, o journal grava
  `failed` (tentativa sem efeito) e a reconciliação revoga o
  grant canônico. Se o adaptador **já entrou** e a resposta não
  pode ser atestada, preserva `uncertain` e proíbe retry
  automático. Não substituir um pelo outro para forçar sucesso.
- **Provas causais:** os dois novos testes retêm a sessão real
  do Windows File Space e removem o provedor (a) durante a
  publicação de `started` e (b) dentro da resolução do
  adaptador, sem eventos do Host. Ambos falharam antes da
  correção, criando diretórios físicos indevidos, e passaram
  depois sem efeitos no disco. Um teste unitário adicional
  verifica a ordem da guarda no executor e sua validação de tipo.
  **Regressão selecionada: 354/354 em 43 arquivos**; provas
  físicas Windows **15/15**. A sessão MCP autenticada e a UI
  Electron completa continuam pendentes de homologação.

### C.11. Revogação de grant mesmo sem evento do catálogo

- **Falha reproduzida em 2026-11-03:** uma remoção do grant diretamente
  no registro canônico podia acontecer dentro de
  `adapterResolver()`, depois da primeira decisão do Gateway.
  Como o Fabric não mudava de revisão e o Personal não recebia
  evento, o verificador pré-adaptador aceitava a aprovação obsoleta.
  O File Space chegava a criar uma pasta no Windows, mesmo com
  a autorização individual revogada.
- **Correção sem novo SSOT:** a guarda opcional
  `verifyBeforeAdapter(request)` no executor canônico permanece
  exclusivamente negativa. A composição Native verifica a revisão
  atual do Fabric, a existência e o status da aprovação no runtime
  original e chama de novo **o mesmo Action Gateway** com o
  `grantRef` vigente, depois da resolução do adaptador e antes
  de `adapter.execute()`. Assim, expiração ou revogação silenciosa
  falham fechadas sem adicionar grants, listas, executores ou transporte.
- **TDD físico:** um primeiro cenário remove a aprovação via
  `runtime.revokeApprovedAction()` durante a resolução; foi
  bloqueado pelas verificações existentes. O segundo injeta uma
  autoridade de grants real e revoga apenas no seu próprio issuer,
  **sem sinal de Host ou Personal**. Antes da correção o teste
  falhava porque a execução era aceita. Depois, o adaptador
  não é chamado, nenhum diretório aparece no NTFS, o attempt
  é `failed` pré-efeito e a aprovação é revogada.
- **Regressão:** **356/356 testes em 43 arquivos**, sem falhas
  nem skips, incluindo **17/17 provas com middleware HTTP e
  filesystem real no Windows**. Isso não homologa sessão MCP
  autenticada nem a GUI da Surface, e continua sem publicação
  remota ou alteração de outros repositórios.

### C.12. Aura Native pronta somente após montar o Fabric e sem respostas órfãs

- **Defeito de inicialização corrigido (2026-11-03):** a composição
  anunciava `intelligence.host.ready` ao host Native antes de tentar
  montar a descoberta do Capability Fabric. Uma solicitação logo após
  o anúncio podia receber um contexto de Aura sem as ações Native
  atuais. A única instalação de
  `installNativeIntelligenceHostBridge()` ocorre agora **depois**
  da tentativa de montar `createCapabilityDiscovery()`. Se a
  descoberta falhar, Aura continua consultiva e sem projetar
  capacidades não verificadas; não declara execução nem MCP pronto.
- **Desmontagem real do port:** a composição libera a ponte no evento
  `pagehide`. A mesma ponte agora também invalida sua assinatura
  antes de remover o listener, descartando sucesso ou erro que
  terminem após `dispose()`. Nunca reexecuta a requisição pendente
  e não fabrica recibo, sessão central ou grant.
- **Integração comprovada:** uma requisição pelo verdadeiro
  `installNativeIntelligenceHostBridge()` + serviço Native de
  Intelligence + Aura contextual derivou uma ação do mesmo Fabric;
  após retirada do provedor, a próxima requisição não recebeu ação.
  O teste de resposta em voo falhava antes da correção (publicava
  texto tardio após desinscrição) e passa para sucessos e falhas.
  `tests/test_native_intelligence_host_bridge.mjs` também verifica
  a ordem de montagem e a liberação da única ponte.
- **Desktop Windows observado:** o Electron Dev está aberto e
  `/__ordax/native/product-runtime-status` negou uma chamada
  sem token com HTTP 401. O painel de Sistema já mapeia a
  observação read-only do Supervisor, mas isso **não prova**
  readiness MCP autenticada. A leitura dos controles do Chromium
  via acessibilidade foi insuficiente para homologar a UI.
- **Regressão ampliada:** **366/366 testes aprovados em
  45 arquivos**, sem falhas ou skips, incluindo os
  **17/17 casos físicos de File Space Windows** já compostos.
  As ações MCP Product continuam dependentes de grants Platform,
  transportes Runtime oficiais e atestação real.

### C.13. Contexto da Aura revogado em trocas A-B-A e sem listeners órfãos

- **Falha reproduzida (2026-11-03):** o serviço Native de
  Intelligence comparava identidade/Space no início e após
  `await intelligence.respond()`, mas uma troca A→B→A terminada
  antes da resposta deixava os valores iguais. A resposta antiga
  podia atravessar a ponte e ser entregue sob a sessão restaurada.
- **Correção sem segunda fonte de verdade:** o mesmo serviço
  `createNativeIntelligenceService()` escuta os ports canônicos de
  Identity e Space e incrementa somente um contador **efêmero de
  invalidação de inferências em voo**. Qualquer evento observado
  durante a inferência, inclusive A→B→A, torna o resultado
  obsoleto mesmo se o contexto final for visualmente idêntico.
  A verificação original de contexto antes/depois permanece;
  nenhuma identidade, grant, sessão ou Space é replicado.
- **Encerramento real:** `dispose()` do serviço invalida pedidos
  em voo e solta ambas as assinaturas, de modo idempotente.
  `installNativeIntelligenceHostBridge()` reutiliza esse
  encerramento quando a Surface desmonta ou quando o anúncio
  `intelligence.host.ready` falha; respostas tardias continuam
  suprimidas sem retry. A ponte permanece apenas transporte.
- **Prova causal:** os testes novos de serviço falhavam antes
  da correção e agora rejeitam A→B→A de identidade, A→B→A
  de Space e encerramento durante inferência. Uma prova pelo
  host Native confirma `outcome: unknown` sem expor o texto
  antigo e verifica que os observers existentes foram liberados.
- **Regressão dirigida ampliada:** **378/378 testes aprovados
  em 46 arquivos**, sem falhas ou skips, incluindo os 17 cenários
  de File Space físico Windows existentes. Ainda não constitui
  autorização MCP Product nem validação visual da Surface.
- **Limite de observabilidade:** uma mudança não comunicada pelos
  ports e integralmente revertida entre observações não pode
  ser inferida; a entrega real depende de eventos canônicos.

### C.14. Instalação/remoção de App sem reiniciar a Surface — geração verificada única

- **Limitação funcional removida (2026-11-03):** as Actions, a Awareness e
  os manifests semânticos eram compilados uma única vez com os pacotes
  verificados no boot. O gate do slot CURRENT conseguia **retirar**
  ações antigas na desinstalação/atualização, mas uma instalação nova
  não alcançava Aura/Personal/Fabric sem reiniciar a Surface.
- **Correção no owner canônico:** `live-verified-app-semantics.mjs`
  compõe uma única geração a partir dos mesmos carregadores e contratos
  existentes (`verified-app-semantics`, Awareness, Actions, Router,
  `current-verified-action-gate`). Três ports estáveis apontam para
  a geração publicada **atomicamente**. Não há segundo inventário,
  registry paralelo, executores, grants ou ferramentas para a IA.
  O `main.mjs` conecta a publicação aos eventos já existentes da
  Store e ao mesmo `nativeCapabilityDiscovery.refresh()`.
- **Source e controle de concorrência:** o refresh lê apenas as
  observações CURRENT existentes da Store e só busca manifests para
  apps externos de primeira parte explicitamente autorizados na
  política canônica. Um app novo exige metadata de slot, versão,
  revisão e `sourceCommit` exatamente iguais aos do pacote
  revalidado. A Store retira a observação durante sua atualização,
  ocultando imediatamente as ações antigas. Gerações sobrepostas
  ou obsoletas são descartadas; falhas não publicam nenhum app novo.
  Uma nova atualização explícita da Store pode repetir a verificação
  que falhou, sem loop automático. O pacote já verificado no boot é
  reutilizado quando a observação CURRENT coincide, sem refetch.
- **Compatibilidade corrigida:** o carregador de providers normaliza
  `sha256` para `artifactSha256`. O overlay converte somente esse
  campo de volta ao formato de validação bruto **antes de aplicar o
  mesmo validador estrito**; campos extras continuam rejeitados. Isso
  corrige a rejeição indevida de manifests legítimos normalizados.
- **Prova de integração:** com fonte de pacotes assinados simulada
  pela fixture do carregador canônico, o mesmo Personal e o mesmo
  contexto da Aura passaram a conhecer `notes.create-note` após
  instalar; o Fabric projetou a ação read-only. A remoção retirou
  a capacidade dos três sem remontagem. Atualização obsoleta,
  versão divergente, duplicação, concorrência de cargas e falha
  com retry explícito foram bloqueadas adequadamente. As propostas
  continuam sem autoridade de execução.
- **Limites:** estes testes usam o carregador real com respostas
  verificadas em fixture, **não** uma instalação física nova de
  aplicativo no Electron; o primeiro teste físico de instalação
  continua pendente. A integração MCP autenticada e a interface
  visual da Surface também permanecem pendentes.

### C.15. Gate físico Windows da Store e escopo do broker Native

- **Consulta física no Desktop Dev (2026-11-03):** a rota
  `/__ordax/native/store-catalog` respondeu HTTP 200 com
  `state: unavailable`, `reason: catalog-trust-unavailable` e
  nenhuma entrada. Os endpoints CURRENT de `notes`, `files`
  e `assistant` responderam HTTP 404. Nenhuma instalação,
  atualização ou assinatura foi forçada; o Desktop não possui
  candidato verificado disponível para prova física de instalação.
- **Causa de política confirmada:** o contrato canônico
  `docs/contracts/runtime-component-package.json` declara
  `canonical_component_trust_anchor_pinned: false`.
  `readDesktopPinnedComponentTrust()` exige âncora pública
  fixada, política, identidade do verificador Go e arquivos
  idênticos sob os roots oficiais. O código não pode substituir
  essa cerimônia por trust local, pacote artificial ou flag dev.
- **Inconsistência adicional corrigida:** o bootstrap da Aura
  tentava consultar `EXTERNAL_FIRST_PARTY_COMPONENT_IDS`
  integralmente, mas o broker
  `verified-component-slot-host.mjs` só atende
  `EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS`. Um app sem
  suporte de leitura retornaria HTTP 404 e poderia impedir o
  carregamento das semânticas dos apps válidos. Tanto o bootstrap
  como o refresh do Fabric agora usam
  `hasNativeExternalFirstPartyModuleRead` derivado da política
  gerada, sem expandir nenhuma autorização.
- **Testes causais:** slot CURRENT de `notes` ao lado de
  `clock` (fora do escopo de module-read) carrega somente
  os manifests autorizados de Notes, mantém seu catálogo e
  não refaz leituras quando apenas Clock muda. Ao remover Notes,
  a Action desaparece. O bootstrap possui regressão explícita
  para o filtro canônico. **22/22 testes dirigidos aprovados.**
- **Regressão ampliada em Windows:** 409/409 testes selecionados
  aprovados em 49 arquivos. Na suíte adicional do broker/Store Windows,
  23/23 casos elegíveis passaram, cobrindo leitura do slot, confiança,
  anti-replay, staging em `pending-health`, uninstall e recusa de
  recibos falsificados. Dois casos adicionais de segurança baseados em
  symlink não puderam executar a fixture neste Windows: a criação
  de links simbólicos falhou com `EPERM` antes de atingir o host.
  Não foram marcados como aprovados, nem houve alteração de ACL/UAC
  para contornar a restrição.
- **Gate aberto:** a homologação física de instalação dependerá de
  fixação legítima da âncora, catálogo assinado e artefatos
  verificados, seguidos de instalação/promoção pelos ciclos do
  Runtime/Store oficiais. O código continua local, sem commit,
  push ou alteração de outros repositórios.

### C.16. CURRENT inválido cancela geração em voo e revoga a semântica antiga

- **Falha reproduzida (2026-11-03):** uma publicação do Store CURRENT
  com observações duplicadas podia interromper a leitura do catálogo
  sem invalidar uma carga assinada que já estava em voo. Depois de um
  retorno silencioso ao mesmo slot A, a tentativa antiga não podia
  ser distinguida da geração corrente e o coordenador suprimia uma
  nova verificação do mesmo fingerprint. Esse comportamento
  contrariava a invalidação A → inválido → A exigida pelo Fabric.
- **Correção fail-closed no owner existente:** qualquer erro na
  leitura/validação do CURRENT incrementa a geração, apaga a
  assinatura de reuso e publica uma geração vazia pelos mesmos
  ports estáveis de Awareness, Action Registry e Semantic Router.
  Não há reexecução automática do carregador e a carga anterior,
  se terminar, não pode repovoar as capacidades. A recuperação
  exige novo evento explícito da Store e leitura verificada.
- **Reconciliação independente:** `main.mjs` agora tenta a
  reconciliação de autoridade do Personal separadamente de
  `nativeCapabilityDiscovery.refresh()`; um erro na projeção
  descritiva não interrompe a revogação de grants.
- **Provas dirigidas:** um teste mantém uma carga assinada
  pendente, injeta CURRENT duplicado, restaura silenciosamente
  o mesmo slot e confirma que a resposta antiga não publica.
  Outro parte de Notes já publicado, injeta observação inválida,
  confirma a retirada e exige nova leitura explícita para
  restaurar. **24/24 testes dirigidos** e **411/411 na regressão
  ampliada de 49 arquivos**, sem falhas ou skips.
- **Fronteiras inalteradas:** o Desktop Windows continua sem
  confiança pública fixada para instalar componentes, e o
  conector OrdaX MCP do dispositivo `DESKTOP-4UFL03B` possui
  apenas o grant de descoberta `product.target.read`. A
  sessão do conector foi verificada autenticada, mas isso
  não habilita execução remota nem atesta a sessão Product
  do dispositivo. Nenhuma permissão, assinatura ou pacote
  foi fabricado.

### C.17. Evento de retirada para assinantes do Fabric em falha CURRENT

- **Falha causal reproduzida (2026-11-03):** uma observação
  CURRENT inválida fazia o coordenador de semântica retirar a
  geração de Actions, Awareness e Semantic Router, mas não
  emitia o aviso de publicação pelo `onPublished()` existente.
  Uma leitura nova já falhava fechada, porém assinantes do Fabric
  podiam ficar com uma apresentação anterior, sem receber
  evento de revogação.
- **Correção sem outro canal:** a retirada de geração no mesmo
  `createVerifiedSemanticsRefresh()` chama `onPublished()`
  após publicar a geração vazia. O assinante do Fabric recebe
  uma única mudança de revisão pelo mecanismo canônico; o
  Personal recebe a mesma reconciliação de aprovação. Sem
  ferramenta nova, sem permissões novas e sem polling.
- **Reconciliador único:** `main.mjs` consolidou em
  `reconcileCurrentStoreActionAuthority()` os dois pontos de
  publicação de eventos da Store. Uma falha no refresh
  descritivo não cancela a tentativa independente de
  reconciliação de aprovação pelo Personal.
- **Prova TDD:** com o Surface Host Native real em teste, uma
  ação verificada de Notes ficou observável no Fabric. A
  observação CURRENT inválida fez `fabric.refresh()` falhar
  antes da retirada. Antes da correção, `subscribe()` não
  recebia evento; depois, recebeu a revisão sem a ação
  revogada. Os testes de invalidação A→inválido→A foram
  ajustados para distinguir evento de retirada do posterior
  evento de restauração. **25/25 testes dirigidos** e
  **412/412 na regressão de 49 arquivos**, sem falhas/skips.
- **Limites preservados:** a Store física segue com
  `catalog-trust-unavailable` até confiança canônica
  instalada. Nenhum app real foi instalado e a conexão MCP
  Product não recebeu grants adicionais; a UI visual
  Electron completa segue sem homologação.

### C.18. Store HTTP real → ciclo de vida → CURRENT → Aura/Personal/Fabric

- **Contrato de eventos validado em 2026-11-03:** a prova
  `tests/test_verified_app_semantics_source.mjs` compôs
  `createNativeStoreCatalogComposition()`, os leitores signed
  HTTP originais, a descoberta Native, Aura e Personal. Com
  respostas de publicação verificadas em fixture, uma alteração
  de CURRENT da Store fez Notes aparecer como ação de
  **proposta sem execução autorizada** nos três consumidores,
  sem remontar o shell. A remoção retirou a ação de todos
  e notificou o mesmo subscriber do Fabric. O caso inicial
  de catálogo `ready` vazio foi corretamente rejeitado pelo
  contrato e a fixture foi corrigida, não o validador.
- **Lacuna operacional corrigida:** `main.mjs` não acionava
  `storeCatalogComposition.refresh()` após uma solicitação
  de instalar, atualizar ou remover aceita pelo executor Go.
  O adaptador Native canônico
  `createNativeAppLifecycleDelegate()` agora admite
  `onAccepted` opcional, disparado **somente** após validar
  a identidade do recibo `accepted`. O callback do único
  `main.mjs` apenas relê o catálogo assinado/observação
  CURRENT. Não cria novo executor, watcher, inventário nem
  autorização. Rejeições, respostas forjadas e IDs divergentes
  não acionam o callback; erro de observação não reescreve
  um resultado Go já durável.
- **Bug de remoção corrigido causalmente:** o serviço
  `createAppLifecycleRequestService()` antes passava
  o candidato remoto para um plano de remoção quando o
  catálogo ainda anunciava o aplicativo, contrariando a
  independência da remoção sobre a ativação instalada.
  Agora passa `candidate: null` tanto no plano inicial
  quanto na revalidação antes da delegação. A remoção
  permanece vinculada ao CURRENT observado, sua revisão
  e seu sourceCommit. Os candidatos de install/update
  continuam assinados e obrigatórios.
- **Prova integrada após recibo:** o serviço Native gerou o
  plano de remoção, encaminhou ao adaptador, recebeu
  um recibo Go **simulado pela fixture HTTP**, disparou a
  única releitura Store, retirou o slot e publicou a
  observação `removed`. O mesmo `requestId` retornou o
  recibo memorizado sem nova mutação ou nova leitura.
  Não foi executada remoção física nem alterada confiança
  de produção.
- **Testes e limites:** **490/490 testes aprovados em 55
  arquivos**, sem falhas ou skips, contemplando as provas
  anteriores e os novos testes da Store e do delegado Native.
  Instalações aceitas seguem `pending-health` até a
  promoção pelo Supervisor; a releitura imediata não
  inventa um slot CURRENT e o evento definitivo de
  promoção ainda precisa ser homologado. O Desktop físico
  continua com `catalog-trust-unavailable` e o Product MCP
  não ganhou grants. Código permanece local, sem push ou PR.

### C.19. Promoção de pending-health — gate de evento nativo ainda aberto

- **Auditoria física Windows em 2026-11-03:** o host
  `system/adapters/desktop/store-lifecycle-host.mjs` grava
  install/update apenas como `pending-health` durável pelo
  verificador Go; não ativa o slot. O leitor
  `verified-component-slot-host.mjs` consulta somente
  `current` e valida a identidade com Go. Não foi encontrado
  no host Windows um evento público de **promoção já
  concluída** que a composição Native possa consumir.
- **Por que o callback do recibo não basta:** o novo
  `onAccepted` da Store relê corretamente CURRENT após a
  operação, mas um recibo `accepted` de staging não é
  um recibo de promoção. Se o Supervisor promover
  posteriormente sem evento para a composição, a Store
  não tem como saber que deve executar outra leitura;
  nenhuma capacidade pode ser presumida disponível.
- **Prova fail-closed:** o teste integrado
  `Native Store HTTP refresh propagates CURRENT install
  and removal` agora inclui uma releitura da Store com
  Notes ainda ausente (candidato representando
  `pending-health`). Verifica que não houve leitura do
  pacote de Actions nem publicação no Fabric. Uma
  mudança silenciosa no estado de teste também não
  muda os ports. Só uma nova leitura explícita de
  CURRENT, já promovido, permite carregar os manifests,
  notificar o Fabric e atualizar Aura/Personal.
  **44/44 testes dirigidos aprovados**.
- **Fronteira de implementação:** a futura entrega deve
  conectar um aviso gerado pelo **owner canônico de
  ativação/saúde Windows**, somente após processamento
  de promoção/reversão, à função já existente
  `storeCatalogComposition.refresh()`. O aviso é
  apenas um *hint* de releitura: identidade, revisão,
  sourceCommit, pacote e disponibilidade continuam
  atestados no readback Go. Não usar `accepted`,
  relógio, evento da página, polling ou inventário
  replicado como substituto da promoção.
- **Bloqueio físico inalterado:** catálogo continua sem
  âncora pública canônica fixada no Windows; não foi
  executada instalação real, alteração de trust ou
  emissão de grant MCP.

### C.20. Aura: cerca de revisão do Fabric em respostas pendentes

- **Falha reproduzida em 2026-11-03:** `createApplicationContextIntelligence()`
  lia as capacidades Native imediatamente antes de iniciar a inferência,
  mas publicava a resposta final sem conferir novamente o catálogo.
  Uma Store removendo a capacidade enquanto o modelo elaborava uma
  resposta permitia entregar aconselhamento baseado em ação obsoleta.
  O teste dirigido falhou antes da correção.
- **Correção no serviço existente:** para inferências compostas com o
  Fabric Native, a Aura captura a **identidade do port, revision e
  revisionScope** do mesmo `createCapabilityDiscovery()`. Uma resposta
  só é entregue se essas informações continuarem válidas na leitura
  final. Revogação e restauração A→B→A também rejeitam o resultado,
  pois o Fabric registra revisões monotônicas dos eventos da Store.
  Se a fonte de descoberta for substituída, a resposta também
  falha fechada. Atualização sem mudança real de revisão não
  cancela inferências válidas.
- **Streaming sem leitura repetida:** quando o Fabric oferece
  `subscribe()` pelo host existente, cada inferência reutiliza esse
  mecanismo para observar revogações e bloquear **novos** trechos
  da resposta após o evento, sem refazer a projeção completa a
  cada token. Uma leitura final continua obrigatória para fechar
  eventos não entregues. Se a assinatura não estiver disponível,
  o serviço executa a leitura por trecho, de modo conservador.
  O listener temporário é liberado no sucesso, erro, cancelamento
  ou falha síncrona do port. Nenhum registro, permissão ou
  executor foi criado.
- **Limite temporal real:** texto transmitido **antes** da
  revogação não pode ser retirado retroativamente. Novos deltas
  após o evento são bloqueados e a resposta final é rejeitada;
  essa prova não promete desfazer texto já exibido ou cancelar
  efeitos externos, que continuam sem autoridade de execução
  da Aura.
- **Provas:** retirada durante inferência, A→B→A, refresh sem
  mudança, bloqueio de delta pós-revogação, cinquenta deltas
  com custo de readback limitado e liberação de observadores
  na falha/sucesso. **38/38 testes dirigidos** e **495/495
  testes na regressão ampliada de 55 arquivos**, sem falhas.
- **Gates independentes:** o Desktop Windows ainda não publica
  evento de promoção Go→CURRENT após o Supervisor; não foi
  implementado watcher/polling alternativo. Confiança pública
  de componentes e grants MCP continuam bloqueados.

### C.21. Aura: geração do manifest semântico sem alterar as Actions públicas

- **Falha causal reproduzida (2026-11-03):** a revisão pública do
  Capability Fabric cobre a identidade das Actions verificadas,
  mas uma substituição apenas dos manifests semânticos pode manter
  exatamente as mesmas ações, parâmetros e assinatura pública.
  Uma inferência iniciada antes dessa troca não deve entregar
  resposta com instruções antigas. O teste A→B→A manteve a
  revisão pública inalterada e reproduziu a resposta obsoleta
  **antes** da correção.
- **Correção no proprietário existente:** o mesmo
  `createLiveVerifiedApplicationSemantics()` agora expõe
  `getGeneration()` read-only. Sua geração monotônica avança
  **somente após** a compilação, validação e publicação
  atômica de uma nova geração de Awareness, Action Registry e
  Semantic Router. O getter é indisponível após `dispose()`,
  invalidando qualquer inferência pendente. Não há segundo
  catálogo, armazenamento, grant, evento de runtime ou
  executor de aplicativos.
- **Consumidor único:** a composição Native injeta
  `getApplicationSemanticsGeneration: () => liveAppSemantics.getGeneration()`
  no `createApplicationContextIntelligence()`. A Aura captura
  essa geração **antes** de ler o catálogo ou compor o prompt.
  Verifica novamente antes de enviar ao modelo, em cada delta
  do streaming e antes de entregar a resposta final, além
  da cerca já existente por identidade/revisão do Fabric.
  Caso a geração varie, a resposta é rejeitada com
  *fail-closed*, inclusive após A→B→A; mudanças meramente
  descritivas sem alteração de ações não escapam do gate.
- **Testes RED→GREEN:** resposta pendente com uma geração
  verificada substituída A→B→A e revisão pública intacta
  foi inicialmente aceita e passou a ser rejeitada;
  retirada/streaming de trecho após troca de geração,
  getter monotônico, descarte de owner e resposta estável
  também foram validados. **51/51 testes dirigidos** e
  **499/499 regressões selecionadas em 55 arquivos**,
  zero falhas/skips.
- **Gates físicos inalterados:** a Store Windows ainda
  depende da âncora pública canônica e o evento de
  promoção pós-Supervisor segue aberto. Esta correção
  protege as respostas, mas não promove componentes nem
  habilita execução remota MCP.

### C.22. CURRENT integralmente validado e retirada imediata sob concorrência

- **Falha reproduzida em Windows (2026-11-03):**
  `createVerifiedSemanticsRefresh()` filtrava os IDs não
  autorizados para leitura de módulos **antes** de validar
  seus registros CURRENT. Uma observação inválida de Clock,
  aplicativo sem Native module-read, era ignorada e podia
  manter Actions e contexto de Notes previamente publicados.
  O teste dirigido falhou antes da correção.
- **Correção sem ampliar permissões:** validar todos os
  metadados CURRENT recebidos do mesmo Store projection,
  rejeitar IDs duplicados em todo o lote e, **só depois**,
  filtrar por `hasNativeExternalFirstPartyModuleRead`.
  Um aplicativo válido fora do escopo não provoca leitura
  de pacote, nova semântica ou revisão desnecessária.
  Qualquer registro malformado ou duplicado invalida a
  publicação completa e retira a geração do Fabric, Aura
  e Personal, com nova atestação somente após um evento
  posterior da Store.
- **Concorrência A→B→A:** quando CURRENT muda enquanto
  uma geração assinada anterior A está publicada, o
  coordenador publica imediatamente a retirada antes
  de iniciar o carregamento assíncrono de B. Assim,
  reverter silenciosamente o slot para A durante
  o download de B não ressuscita Actions antigas, e a
  cerca de geração da Aura invalida respostas pendentes.
  O retorno requer uma nova leitura assinada; cargas
  atrasadas perdem pelo fence já existente.
- **Eventos sem duplicação:** somente uma geração
  verificada efetivamente publicada demanda retirada
  antes do próximo carregamento. Na instalação inicial,
  em uma tentativa já revogada ou após falha de carga,
  não há uma publicação artificial de sucesso: o callback
  de Store/Fabric acompanha retirada real ou promoção
  verificada. A flag booleana está dentro do coordenador
  atual; não constitui inventário ou registrador paralelo.
- **Provas:** metadados Clock inválidos, duplicatas de
  Clock, recuperação após evento explícito, broker
  restrito, ausência de leituras não autorizadas e
  atualização concorrente A→B→A. **32/32 testes dirigidos**
  e **501/501 na regressão de 55 arquivos**, sem
  falhas ou skips. Testes usam observações simuladas,
  não instalação física ou confiança sintética.
- **Fronteiras preservadas:** sem edição da política
  canônica, sem instalação, alteração de âncora, grants
  MCP, commit, push ou PR.

### C.23. Gate de ação verifica o lote CURRENT inteiro sem depender do próximo evento

- **Falha reproduzida (2026-11-03):** o gate read-through de uma Action
  validava apenas o slot do aplicativo solicitado. Se um outro item CURRENT
  estivesse malformado, o registro de Actions e o Fabric ainda poderiam
  mostrar a ação antiga até que o coordenador recebesse o próximo evento
  da Store. Um teste RED comprovou esse intervalo.
- **Correção causal:** `current-verified-action-gate.mjs` agora valida, em
  cada leitura, todos os metadados do lote CURRENT, rejeita duplicatas e
  somente depois compara a identidade exata do aplicativo requerido.
  Não persiste cópia do catálogo, não executa ações e não altera a fonte
  de autoridade, o fluxo de grants nem a política de módulos.
- **Comportamento:** item desconhecido mas válido não bloqueia o app
  verificado; item inválido falha fechado; duplicata retira a visibilidade;
  uma publicação inteira válida recupera a Action no mesmo port.
  A alteração também alcança o contexto Aura e as propostas Personal
  porque todos usam o verificador existente.
- **Provas:** teste RED-GREEN em
  `tests/test_current_verified_action_gate.mjs`, 39/39 nos dois arquivos
  focados e 206/206 na regressão cruzada de 15 arquivos. `git diff --check`
  sem erro (avisos do Git sobre LF/CRLF não alteram os resultados).
  Sem commit, push, PR, alteração no Runtime/Platform ou grants artificiais.

### C.23. Notificações Store protegidas contra falhas e reentrância

- **Falha reproduzida em 2026-11-03:** os portos de
  `verified-app-store-projection.mjs` e
  `verified-app-store-catalog.mjs` notificavam assinantes
  sequencialmente sem isolamento. Se um leitor descritivo
  lançasse exceção, a chamada de refresh podia rejeitar e
  leitores seguintes (inclusive a reconciliação do Fabric)
  não recebiam a retirada ou a restauração CURRENT. Quando
  um callback iniciava uma segunda atualização de maneira
  síncrona, a emissão antiga continuava e podia transmitir
  estado superado para os leitores seguintes. Quatro testes
  dirigidos reproduziram os dois problemas nos dois portos
  antes da correção.
- **Owner único de entrega:** `store-observer-delivery.mjs`
  é um auxiliar pequeno e sem autoridade compartilhado
  pelas duas camadas existentes da Store. Não mantém
  aplicativos, identidades verificadas, permissões,
  catálogo, banco, journal nem estados CURRENT. A
  entrega isola erros síncronos de um assinante com
  diagnóstico fixo (sem dados do app/usuário), prossegue
  com os consumidores saudáveis e interrompe a emissão
  anterior se uma nova notificação reentrante ocorrer.
  Também protege o aviso final de `destroy()`, para
  que um consumidor com erro não impeça os demais de
  retirar o catálogo.
- **SSOT e fail-closed preservados:** as publicações
  continuam contendo exclusivamente o snapshot
  validado pelo port existente. O despacho não revalida
  assinaturas, não autoriza instalação, não altera a
  ordem do estado verificado nem restaura conteúdo
  desatualizado. A revogação anterior à consulta assinada
  permanece síncrona. O leitor Go e o Supervisor seguem
  os únicos responsáveis por CURRENT e promoção.
- **Provas RED→GREEN:** falha de callback na Store
  assinada e na projeção, recuperação das notificações
  por outro assinante, eventos reentrantes que substituem
  publicação anterior e revogação durante o descarte.
  **36/36 testes dirigidos** nas três suítes Store
  e **506/506 testes na regressão de 55 arquivos**,
  sem falhas ou skips. Não foi necessária instalação
  física nem atualização de confiança.
- **Fronteiras mantidas:** atualização local sem
  commit/push/PR; o Desktop continua exigindo a
  âncora pública canônica de componentes e uma
  notificação independente de promoção pós-Supervisor.

### C.24. Publicação atômica após a leitura final de CURRENT

- **Falha reproduzida (2026-11-03):** `createLiveVerifiedApplicationSemantics.replaceVerifiedSemantics()`
  compilava uma geração e confirmava sua identidade contra CURRENT;
  em seguida trocava `active` e incrementava a geração da Aura
  **antes** de chamar `actionRegistryPort.list()` para retornar as
  ações. Essa última chamada revalidava CURRENT e podia falhar
  após o commit, expondo erro ao coordenador embora a geração
  ativa de Awareness/Actions/Router já tivesse mudado.
- **Correção no mesmo owner:** a projeção final
  `candidate.actions.list()` acontece antes do swap atômico
  e do incremento de geração. Todas as operações falíveis do
  readback ocorrem antes do commit; o retorno usa a mesma
  projeção previamente validada, sem leitura adicional após
  publicar. Caso CURRENT fique ilegível durante essa
  validação, o proprietário preserva a geração anterior.
  Uma leitura nova após o commit ainda depende do gate
  CURRENT existente; nenhum estado assinado é presumido.
- **Prova RED→GREEN:** fixture faz CURRENT responder à primeira
  atestação e falhar na leitura final. O teste original
  detectou avanço indevido da geração (2 em vez de 1).
  Depois da correção, a falha mantém geração, Awareness,
  Action Registry e Router anteriores; uma leitura posterior
  válida publica a geração uma única vez.
- **Prova pelo coordenador real:** em erro na projeção final,
  `createVerifiedSemanticsRefresh()` emite `onError`, não
  chama `onPublished` nem expõe Actions; somente uma
  **nova atualização explícita da Store** permite tentar
  novamente, sem loop automático.
- **Validação:** **508/508 testes aprovados em 55 arquivos**,
  zero falhas/skips, incluindo as duas provas novas.
  Nenhuma permissão, política de assinaturas, gate físico
  ou repositório externo foi modificado. Alterações locais
  não foram submetidas como commit, push ou PR.

### C.25. Preparações de Application Actions revogadas durante leitura assinada

- **Falha reproduzida em 2026-11-03:** `createApplicationActionProviderResolver()`
  consultava a preparação retida e a capacidade atual antes de
  aguardar `resolveVerifiedSemantics()`. Após o `await`,
  devolvia um vínculo com a leitura anterior mesmo que outra
  ação tivesse revogado ou substituído a preparação durante
  a espera. O teste dirigido demonstrou o vínculo antigo
  aceito depois da revogação.
- **Correção no proprietário existente:** após validar os
  manifests e antes de criar o binding, o resolvedor exige
  que a **mesma instância canônica da preparação** continue
  registrada sob a referência opaca; confere novamente
  a capacidade live, seu provedor, o efeito e a proposta.
  Remoção de capacidade ou revogação produzem rejeição.
  Reutilizar o mesmo identificador para uma preparação
  posterior (A→B→A) não ressuscita a anterior. Todos esses
  checks são síncronos, imediatamente após a leitura
  assíncrona; não criam outro executor, inventário, grant
  ou autoridade.
- **Fronteira de escopo:** os arquivos modificados por outra
  frente do Personal (`action-executor.mjs`,
  `proposal-planner.mjs` e seus testes) não foram alterados.
  Os contratos existentes de vinculação e o executor
  permanecem proprietários da autorização e dos efeitos.
- **Provas RED→GREEN:** (1) revogação durante `await`;
  (2) revogação e criação de nova preparação com o mesmo
  opaque ref; (3) desaparecimento da capacidade após
  começar a verificação. **10/10 testes dirigidos**
  e **511/511 na regressão ampliada de 55 arquivos**,
  zero falhas ou skips. O diagnóstico foi compatibilizado
  com a expectativa da composição existente sem enfraquecer
  a rejeição. Nenhuma ação física foi executada.
- **Estado físico inalterado:** catálogo Store ainda não
  possui confiança canônica disponível no Desktop Windows,
  promoção posterior pelo Supervisor carece de evento
  Native homologado e grants MCP de execução permanecem
  indisponíveis.

### C.26. Resolução de artefato: última leitura não pode reabrir vínculo revogado

- **Falha reproduzida no Desktop Windows (2026-11-03):**
  `createApplicationActionProviderArtifactResolver()`
  revalidava o provider binding e, **depois**, esperava
  `currentEntry()` para ler novamente o manifest verificado.
  Se a preparação fosse revogada durante essa última espera,
  o serviço devolvia um artefato aparentemente válido
  baseado em um vínculo que já não existia. A prova dirigida
  reproduziu o retorno indevido antes da alteração.
- **Correção mínima no mesmo resolvedor:** a leitura final
  dos manifests e comparação de identidade do provedor
  acontecem **antes** da terceira e última resolução
  assíncrona do provider binding. A saída continua sendo
  apenas um `ApplicationActionProviderResolution` de
  autoridade `none` e execução indisponível; não existe
  segundo catálogo, executor ou concessão de permissão.
  A leitura mais recente da preparação continua proprietária
  do vínculo, incluindo revogação durante leitura de pacote.
- **Custo/diagnóstico:** o caminho válido mantém três
  conferências do binding, sem inserir uma quarta chamada.
  Se a semântica verificada já mudou, a rejeição ocorre
  com duas conferências, evitando a última consulta inútil;
  a expectativa de contagem do teste antigo foi ajustada
  sem reduzir o gate de segurança.
- **Prova RED→GREEN:** fixture bloqueia a segunda leitura
  do manifest e revoga o vínculo antes de liberar a
  resposta, mantendo os hashes válidos; antes da correção
  retornava artefato e depois rejeita. **15/15 testes
  dirigidos** e **512/512 na regressão de 55 arquivos**,
  sem falhas/skips. A resolução não executou ações reais.
- **Escopo:** não foram alterados `action-executor.mjs`,
  `proposal-planner.mjs` nem os testes de composição
  mantidos por outra frente. Trabalho local sem commit,
  push ou PR. Trust de Store, promoção por Supervisor
  e grants MCP permanecem gates independentes.

### C.27. Handoff de integração: main remota, Store trust e Supervisor Windows

- **Reconciliação real de 2026-11-03 (somente leitura):** o checkout
  físico Windows está em `main@a8b80e9cd`, enquanto a referência
  `origin/main` local aponta para `4bd2cda79` (merge #2402
  já presente na main remota). O checkout divergiu em milhares
  de commits, além de conter dezenas de arquivos alterados e
  vários arquivos ainda não rastreados por frentes diferentes.
  Os módulos novos `system/services/system-foundation/capability-discovery.mjs`
  e `system/services/intelligence/live-verified-app-semantics.mjs`
  **não estão presentes na main remota**. Não aplicar merge,
  reset, push ou commit geral desse worktree.
- **Handoff seguro:** usar uma cópia de integração **limpa**
  baseada no SHA remoto contemporâneo e portar seletivamente
  contratos, fontes, composição e testes **apenas do Capability
  Fabric**. Revisar especialmente `system/composition/native/main.mjs`
  e os arquivos de Personal/Supervisor, pois estão compartilhados
  com outras frentes; reconciliar os diffs por dono, sem copiar
  o conjunto inteiro de mudanças locais. Submeter um único
  conjunto coeso somente depois de testes de impacto e checks
  de CI. Não foi aberta nova PR nem alterado o checkout original.
- **Trust físico confirmado, sem bypass:** a `main` publicada
  mantém `docs/contracts/runtime-component-trust-policy.json`
  com `status=operator-ceremony-pending`,
  `public_anchor.pinned=false`,
  `current_gates.canonical_component_trust_anchor_pinned=false`
  e `component_publish_allowed=false`. A âncora pública
  `system/trust/runtime-components-ed25519.json` não existe
  no checkout nem foi encontrada na main. O host Windows
  compartilha o verificador `readDesktopPinnedComponentTrust()`
  e, corretamente, devolve `catalog-trust-unavailable`.
  A cerimônia do owner precisa fornecer a **chave pública
  verdadeira**, seu SHA-256, o trust policy e package policy
  coerentes e o executável Go fixado no instalador. Nunca
  gerar uma chave aleatória para aparentar aprovação,
  alterar gates para sucesso ou colocar chave privada no repo.
- **Promoção ainda independente:** `store-lifecycle-host.mjs`
  só admite o estágio assinado `pending-health`; a ativação
  posterior exige `record-health` e `promote-state`
  sob gates próprios do verificador/host. Não há na composição
  Native um evento homologado de promoção posterior.
  O proprietário do Supervisor Windows já possui alterações
  concorrentes no worktree; não inserir watcher/polling ou
  criar outra fonte autoritativa. Integrar o aviso a
  `storeCatalogComposition.refresh()` somente depois
  de comprovar readback CURRENT e rollback, sem atribuir
  autoridade à notificação.
- **Verificação adicional:** 15/15 testes de contexto
  Trusted Component/Aura/Files passaram no Windows.
  O ciclo físico de instalação e MCP permanece bloqueado,
  sem alegação de homologação. Este handoff registra o
  estado observado e a ordem dos gates; não substitui
  a consolidação de código sobre a main remota.

### C.28. Candidato isolado de integracao sobre a main atual (2026-11-03)

- Base fisica em detached worktree: origin/main@4bd2cda7941fef0b2ca9d4a4cf7ee74067cc3887, no caminho %TEMP%\ordax-fabric-integration-20261103; checkout compartilhado preservado.
- Contratos, servicos e testes do Capability Fabric reconciliados sobre a base remota. A composicao Native recebeu Aura, Personal, Store e CURRENT do mesmo owner; mudancas independentes de Wi-Fi, status Product Runtime, relatorio Surface e productMode foram retiradas do candidato.
- Regressao ampliada na base remota: 506/506 testes aprovados em 53 arquivos, sintaxe de 44 arquivos verificada e git diff --check aprovado.
- O teste especifico de fronteira MCP depende de desktop-product-runtime-status.mjs, modulo de outro engenheiro ainda ausente na main remota. Excluido apenas do candidato isolado, mantido no checkout de origem; nao foi substituido por mock nem assumida prontidao MCP.
- Bloqueios para publicar: revisar ownership das mudancas compartilhadas do Personal; integrar Product Runtime Windows pela frente responsavel; provar CI do candidato; concluir legitimamente trust publica e evento pos-Supervisor. Nao houve commit, push, merge nem PR.
### C.29. Checkpoints verificaveis da unica branch local (2026-11-03)

- Branch local unica, ainda nao publicada: integration/capability-fabric-v1-20261103, baseada em origin/main@4bd2cda79. O checkout compartilhado em main@a8b80e9cd nao foi editado, resetado nem reconciliado a forca.
- Checkpoint cf2f606c1: descoberta verificada read-only, gate CURRENT e cerca de revisao da Aura; 14 arquivos, 75/75 testes em checkout limpo.
- Checkpoint 1b1b95fc8: uma unica entrega de notificacoes assinadas para dois portos existentes da Store, isolando callbacks com falha e eventos reentrantes; 5 arquivos, 35/35 testes em checkout limpo.
- Checkpoint b790cff8d: revalidacao apos leitura assinada de vinculos e artefatos de provedores do Personal, sem adicionar executor; 4 arquivos, 35/35 testes em checkout limpo.
- Checkpoint 278f6db05: re-leitura da Store apos recibo Go aceito, sem promover pending-health para CURRENT; 3 arquivos, 45/45 testes em checkout limpo.
- Prova conjunta final do HEAD 278f6db05: 190/190 testes em 16 arquivos, zero falhas ou skips, no checkout limpo contendo SOMENTE os quatro commits. O ensaio anterior de 506/506 usou o candidato ampliado com arquivos ainda NAO integrados; nao atribuir essa cobertura ao HEAD commitado.
- O proprietario semantico dinamico live-verified-app-semantics.mjs e seus testes NAO entraram nos commits. O teste de fonte verifica a integracao Native de boot, que ainda esta sob revisao de ownership com o Personal; a tentativa independente falhou como esperado por ausencia daquela composicao. Nao desabilitar essa assercao ou publicar um servico desconectado do owner.
- Nao houve push, PR, merge em main nem alteracao da ancora canonica. Gates externos continuam: trust publico de componentes, evento autorizado de promocao pos-Supervisor, integracao Product MCP e grants. Publicacao do pacote integrado somente apos reconciliar a composicao Native e validar CI remoto.
### C.30. Regressão Windows removida na composição consolidada (2026-11-03)

- O diff de integração reintroduzia duas consultas de serviços Linux
  exclusivos (teclado XKB e recuperação de boot USB) no Desktop Windows.
  A proteção `windowsDesktopHost ? Promise.resolve(null)` da `main`
  foi preservada nos dois portos; não foi criado adaptador alternativo.
- O contrato existente `tests/test_desktop_browser_transport.mjs`
  detecta esse desvio. Após correção, 59/59 testes dirigidos e 457/457
  testes em 45 arquivos da regressão ampliada passaram no Windows,
  sem skips ou falhas; `git diff --check` passou.
- A fonte permanece separada dos worktrees Desktop/Runtime. Publicar o
  candidato não ativa ferramentas MCP, não cria grants e não substitui
  a cerimônia de confiança dos componentes assinados. Exigir CI remoto
  e revisão de ownership antes de integrar em `main`.
- **Compatibilidade com a PR #2400:** o único conflito entre Fabric
  `5c8ba0a43` e MCP Native `2e2758da` era causado por duas linhas
  em branco no bloco de imports de `system/composition/native/main.mjs`.
  Corrigido no Fabric `5ce496361`; `git merge-tree` e merge real sem commit
  em worktree descartável passaram sem conflitos. Na árvore combinada,
  **477/477 testes em 48 arquivos** do Fabric/Surface e **41/41 em
  quatro suítes MCP/Windows** passaram: **518/518** no total, sem skips.
  Sintaxe de 18 módulos MCP e `git diff --cached --check` aprovados.
  A PR #2400 ainda estava aberta; essa prova não autoriza merge em `main`
  nem atesta prontidão ou execução remota MCP.

### C.31. Gate de CI do Fabric sem workflow duplicado (2026-11-03)

- O workflow `application-action-capability-foundation.yml` existente
  passa a monitorar os contratos, os provedores Native e cinco suítes
  específicas do Capability Fabric em PR e `main`.
- Os filtros de arquivos passam a compartilhar uma única lista YAML
  por anchor/alias, sem duplicar os caminhos; o job usa Node 24 fixado
  por SHA oficial já presente em outros workflows do projeto.
- No Windows, os nove módulos/testes adicionais passaram em `node --check`
  e as cinco suítes novas aprovaram **85/85 testes**. Este resultado é
  local; o gate remoto GitHub Actions segue pendente até haver PR válida.
- O workflow é leve (Node/testes) e não cria build USB/Buildroot.
  A integração na `main` ainda respeita o owner MCP Native, CI e trust.

### C.32. Invalidação de provedor Native sem evento de Host (2026-11-03)

- **Defeito reproduzido:** se `isNativeActionRegistered()` detectasse
  um catálogo cujo hash de artefato já não correspondia à aprovação
  Native, o método negava a identidade mas não invalidava o fingerprint
  da última projeção. Um retorno silencioso A → B → A antes da próxima
  leitura de `snapshot()` podia reutilizar a revisão antiga.
- **Correção na fonte única:** uma verificação de identidade que não
  encontra correspondência invalida o fingerprint transitório, assim
  como já ocorria na ausência ou falha de leitura da fonte. A próxima
  projeção válida recebe nova revisão; não há segundo catálogo, timer,
  novo grant ou executor.
- **Prova causal:** o teste `tests/test_capability_discovery.mjs`
  falhava antes da correção e passou depois. Verifica substituição
  silenciosa de `toolArtifactSha256` seguida de retorno ao mesmo
  provedor, sem reiniciar Host; confirmação de provedor idêntico não
  avança a revisão desnecessariamente. Regressão dirigida após correção:
  **69/69 testes**, incluindo HTTP e arquivos físicos Windows.
- Ainda não atesta uma sessão MCP externa nem dispensa os gates da
  Platform e do Product Runtime.

### C.33. Consultas Native desconhecidas não revogam outras ações (2026-11-03)

- **Regressão reproduzida:** a correção C.32 invalidava a revisão da
  descoberta em toda consulta de identidade Native rejeitada, inclusive
  uma identidade nunca registrada. Um consumidor com ação desconhecida
  podia provocar alterações repetidas de revisão sem mudança real da
  instalação, perturbando aprovações legítimas.
- **Correção na fonte canônica:** `isNativeActionRegistered()` continua
  a validar uma única enumeração atual. Se rejeitar a identidade, só
  invalida o fingerprint transitório quando aquela identidade constava
  do último snapshot já validado. Reutiliza a projeção privada mantida
  para revisão, sem segundo registry, cache de autorização ou leitura
  duplicada do catálogo.
- **Prova causal:** teste de consultas repetidas a hashes desconhecidos
  e IDs estrangeiros falhava antes e passou depois. Teste adicional
  comprova que remoção Native silenciosa seguida do retorno do mesmo
  provedor invalida a aprovação antiga; o cenário de substituição
  A→B→A da C.32 também permanece protegido.
- **Regressão selecionada Windows:** **460/460 testes em 45 arquivos**,
  sem falhas nem skips. Verificações Node de sintaxe e
  `git diff --check` aprovadas. Nenhuma habilitação de tools MCP.

### C.34. Troca silenciosa de um segundo provedor Native (2026-11-03)

- **Falha reproduzida:** a verificação de identidade de uma ação Native
  ainda registrada retornava `true` mesmo quando outro provedor do mesmo
  catálogo havia sido removido sem evento. Se esse segundo provedor
  retornasse antes do próximo `snapshot()`, a revisão compartilhada
  poderia permanecer igual à anterior, apesar de um A→B→A observado.
- **Correção de uma única fonte:** `isNativeActionRegistered()` compara
  toda a enumeração Native já validada à parte Native do fingerprint
  privado usado pela descoberta. Diferença observada invalida a revisão
  transitória; uma nova leitura válida avança a revisão. Não há nova
  enumeração, registry, timer, executor ou autorização.
- **Prova causal:** teste com dois provedores demonstrou a falha antes
  da correção e passou depois. Reordenação da lista sem alteração de
  conteúdo permanece estável; retirada e retorno silenciosos do
  segundo provedor invalidam a revisão anterior. As proteções de
  identidade desconhecida e troca do primeiro provedor permanecem.
- **Regressão dirigida:** 72/72 testes no Windows, incluindo o middleware
  File Space real. Regressão ampliada sobre 45 arquivos: **461/461 testes**,
  zero falhas e skips. Sintaxe e `git diff --check` aprovados. Não equivale
  a homologação MCP remota.

### C.35. Consulta CURRENT atômica por lista de ações (2026-11-03)

- **Falha reproduzida:** com dois aplicativos e CURRENT mudando entre
  consultas síncronas, o Registry podia incluir na mesma lista uma ação
  de cada geração, embora nenhuma publicação Store contivesse ambas.
- **Correção no verificador existente:** `isCurrentBatch()` avalia uma
  lista limitada a 512 ações contra **uma única** observação CURRENT
  completa, valida inclusive os peers não solicitados e nega toda a
  seleção se houver identidades CURRENT duplicadas. Nenhum registro,
  catálogo persistido, grant, executor ou mecanismo de confiança novo.
- O Registry usa essa checagem para `list()`, `listForApp()`,
  contexto Aura e seleção de apps. Propostas individuais continuam
  verificadas em tempo real por `isCurrent()`; a substituição de
  semântica verificada atesta a geração como conjunto antes do commit.
- **Prova causal:** o teste com CURRENT alternando a cada leitura falhou
  antes, passou após correção e confirma uma leitura por catálogo e por
  seleção de contexto. Decisões em lote malformadas falham fechadas.
  Regressão Windows: **463/463 em 45 arquivos**, zero falhas/skips;
  cinco módulos/testes alterados passaram em sintaxe; `git diff --check`
  aprovado. A projeção continua descritiva e sem execução MCP.
- **Proteção do ciclo de vida:** `replaceVerifiedSemantics()` não
  aceita publicar entradas não vazias com `attestCurrent: false`.
  Esse modo fica restrito à revogação vazia quando a Store falha.
  O teste causal falhou antes da correção e passou depois; a regressão
  ampliada atual aprovou **464/464 testes em 45 arquivos** no Windows.

### C.36. Publicação fail-closed após perda silenciosa do CURRENT (2026-11-03)

- A compilação de semânticas verificadas já impedia commit quando a
  observação final da Store lançava erro. Mas uma retirada silenciosa entre
  o primeiro atestado e a última projeção podia devolver uma lista menor,
  sem erro, e avançar a geração Aura/Personal mesmo sem ações CURRENT.
- A rotina canônica `replaceVerifiedSemantics()` agora exige que todas
  as ações declaradas pelo pacote assinado sobrevivam à última projeção
  CURRENT antes do commit da geração. Sem ações declaradas, ela verifica
  também a identidade dos aplicativos sem ação pelo mesmo gate existente.
- **Prova causal:** os cenários de ação retirada silenciosamente e app
  somente semântico falharam antes da correção e passaram depois. Uma
  tentativa rejeitada não altera a geração do proprietário semântico.
  Sucesso subsequente exige atestado atual válido; revogação vazia mantém
  o modo fail-closed.
- Regressão local Windows: **466/466 testes em 45 arquivos**, zero
  falhas/skips, `node --check` e `git diff --check` aprovados.
  A publicação MCP remota, as grants e o CI remoto permanecem pendentes.

### D. Integração futura com o Runtime MCP canônico — fronteira auditada

- **Contrato efetivo verificado (2026-11-03):**
  `ordaxsystems/ordax-runtime/main` já define
  `ordax_dev_agent.main.run(config, device_credential_provider=...)`
  para composição Native pelo processo proprietário da identidade OS.
  A fonte `ordax_dev_agent/capability_snapshot.py` publica
  `ordax.device-agent-capabilities/1` somente para ações já conhecidas
  em `PRODUCT_ACTIONS` e presentes no executor do próprio Runtime,
  com limite de 64. Não transformar IDs `system:action.*` ou
  `app:*` do Fabric em capacidades Product sem implementação, registro
  Product oficial, política local e grants da Platform.
- **SSOT separado por responsabilidade:** Fabric
  `ordax.capability-discovery/1` é projeção semântica de leitura,
  `revisionScope=session`, `authority=none` e `toolExecution=false`.
  Runtime possui execução/registro de ações Device Agent e política local;
  Platform continua owner de OAuth, seleção de ator/dispositivo, grants,
  leases e revogação remota. A revisão transitória da Surface **não**
  pode substituir `capability_digest` atestado ou autorizar ferramentas.
- **Inventário existente que não deve ser duplicado:** o Runtime já
  publica `intelligence.app_catalog` como ação Product própria, enquanto
  `ordax_dev_agent/application_intelligence_actions.py` pode ler o
  inventário de Intelligence de `ordax_studio/app_intelligence_registry.json`.
  Essa representação independente não é um grant nem o SSOT vivo do
  Fabric. Qualquer futura unificação precisa ocorrer no owner do Runtime,
  consumindo proveniência atual verificada, sem importar a base estática
  como autoridade para apps instalados, e sem sobrepor
  `computer.directory_create` (caminho host) à ação
  `native-file.ensure-directory` (recurso File Space) por mera
  semelhança de nomes.
- **Transporte real:** o Host Bridge JS/Python da Surface atende serviços
  específicos como Intelligence. Ele não constitui uma sessão MCP e
  mensagens da página não são provas de grants. Usar o Runtime MCP
  existente e sua atestação; não criar servidor MCP duplicado, segunda
  lista autoritativa, transporte de credenciais por DOM ou execução direta
  pelo modelo. Uma integração de apps deverá receber proveniência
  verificada, despacho tipado e recibos do executor canônico.
- **Provas locais:** `tests/test_capability_fabric_mcp_authority_boundary.mjs`
  confirma que ação semântica nativa declarada não implica prontidão
  MCP, que catálogo Fabric e Product Device Agent possuem contratos
  diferentes, que alteração de revisão não gera atestação e que
  observação HTTP indisponível não se converte em readiness.
  Regressão ampliada: **333/333 testes aprovados em 43 arquivos**,
  sem falhas ou skips, incluindo status Product e 8 testes físicos
  de arquivos com middleware real Windows.
- **Gate de integração ainda pendente com o owner `ordax-runtime`:**
  inventariar somente ações executáveis suportadas pelo agente Native,
  conectar o SSOT do OS por transporte autenticado local, verificar
  Product tool projection/grants/lease antes do despacho e provar
  `tools/list`, execução e revogação numa sessão MCP realmente
  autenticada. Não habilitar tools pela mera presença do Desktop.
  A observação `/__ordax/native/product-runtime-status` no servidor
  Vite de desenvolvimento consultado não estava acessível; portanto
  não serve como prova de MCP conectado.
- **Escopo:** apenas testes/documentação no `ordax-os` nesta etapa.
  Nenhum arquivo foi alterado no `ordax-runtime` nem na Platform.

### E. Windows, OrdaX OS USB e publicação

- Contrato comum; no Windows usar IPC por identidade do processo/ACLs;
  no OrdaX Native preferir UDS/credenciais locais (D-Bus apenas se houver
  benefício real). O Runtime canônico continua único.
- Verificar offline, queda da Surface, Runtime, reboot no meio de operação,
  contador de eventos, concorrência e replays. No USB, exigir execução
  física; passar testes Windows não homologa Buildroot.
- Publicar após gates, preservando as mudanças locais já presentes, em uma
  linha coerente de integração e somente depois de revisar diffs/CI.
  **Pode-se versionar o candidato de código na branch de integração para
  revisão e CI; não realizar build USB, ativação MCP, implantação ou merge
  antes dos gates correspondentes.**

## Critério de aceitação do sistema

Uma ação com suporte OrdaX nativo precisa funcionar pela UI e pelo MCP
sem screenshots, cliques por coordenadas ou heurísticas. Os dois caminhos
devem convergir ao mesmo serviço de domínio e produzir a mesma revisão e
recibo, com decisões de autorização específicas para cada ator.
