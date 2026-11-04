# OrdaX Capability Fabric — visão canônica, estado e continuidade

**Estado verificado em 2026-11-04:** **Capability Fabric v1 implementado e integrado ao `ordax-os/main`** pela [PR #2406](https://github.com/ordaxsystems/ordax-os/pull/2406), merge `b44659ec8caad2fff8820bcee83201174dc71702`. A documentação de fechamento entrou na `main` por `354d6d1462a14d0f6e708f9262353762588b1f01`. **Não equivale** a liberação de ferramentas MCP, execução remota, produção, nem E2E de interface humana.

**Natureza deste arquivo:** guia de arquitetura e retomada. Não é outro contrato, catálogo, permission store ou registro de execução. Em conflito, prevalecem o código/contratos e `docs/CURRENT-STATE.md`, segundo `docs/README.md`. O diário detalhado de desenvolvimento está em `docs/plans/CAPABILITY-FABRIC-V1.md` e é **histórico**, não fila de tarefas.

## Resposta em 30 segundos: o que é e para que serve

O Fabric permite que OrdaX OS, Aura e Personal OrdaX **descubram, de uma única projeção derivada**, o que o sistema e os aplicativos realmente declaram, sem duplicar seus inventários. Os consumidores recebem metadados tipados e uma revisão de sessão; a projeção reage à mudança/revogação do provedor. **Descobrir não é ter permissão para executar.**

As fontes de autoridade continuam existentes e distintas:

```text
System Foundation / Native Surface Host (estado observado)
                    |
Native Store: slot CURRENT verificado + proveniência do app
                    | -> semântica viva / Awareness / roteador / Action Registry
Personal Action Catalog (ações Native já registradas)
                    |
                    v
createCapabilityDiscovery (projeção derivada, leitura, revisão de sessão)
                    | -> Aura: contexto descritivo, seleção, sugestão
                    | -> Personal: descoberta e solicitação de approval vinculada
                    | -> UI Native (consumidor a homologar fisicamente)
                    |
             [NÃO cria tools, grants ou execução]
```

O caminho de **efeito local autorizado** é outro, já pertencente ao Personal: proposta/solicitação → consentimento humano e validação vigente → Action Gateway → Action Executor tipado → recibo/Activity. A projeção pode iniciar **pedido de aprovação**, nunca executar diretamente.

O caminho do **ChatGPT/MCP remoto** é independente: cliente OAuth → **ordax-platform** (sessão, Owner, seleção do Device, grants, leases, revogação) → **ordax-runtime** (Product gateway, lista de tools suportadas, política local, agente e recibos) → adaptador/serviço OS existente quando houver integração autenticada e comprovada. O Fabric **não** deve ser publicado diretamente como `tools/list` e seu `revision` **não** é `capability_digest` atestado.

## Padrão mínimo universal dos aplicativos oficiais — decisão de integração (2026-11-04)

**Regra:** todo aplicativo first-party criado/distribuído para OrdaX deve usar os mesmos **contratos públicos mínimos**, mesmo que não exponha nenhuma automação. O **formato e a identidade** são uniformes; a **quantidade e o significado** das funções são particulares de cada app. **Não criar** `fabric.json`, segundo registry, lista manual por app, API MCP exclusiva ou um novo catálogo de capabilities.

| Responsabilidade | SSOT de origem no app | Obrigação do app oficial |
| --- | --- | --- |
| Identidade e lifecycle | `app.json` → `ordax.component-manifest/1` | ID estável, nome, versão, owner, dependências, modo de release, health/lifecycle; fonte validada e slot instalado `CURRENT` verificado pelo OS |
| Compreensão pela Aura | `ai/manifest.json` → `ordax.app-intelligence-manifest/1` | Mesmos `appId`/`appVersion`, instruções não vazias, `intents[]` tipados por namespace do app e `authority=none`, `execution=declarative-only`. **Zero intents é válido** quando não há intenção verdadeira a anunciar |
| Ações semânticas | `actions/manifest.json` → `ordax.application-action-manifest/1` | Mesma identidade/versão, `authority=none`, `execution=proposal-only`, `capabilities[]` somente para intents existentes, com parâmetros, risco e confirmação; **zero capabilities é válido**. Provider manifest/artefatos seguem o pacote canônico, sem presumir execução |
| Compatibilidade e runtime | `compatibility.json` (ou descriptor único de migration), App SDK pinado e `componentRuntime` | `requires` compatíveis com o host; ports públicos, montagem, health, desmontagem e empacotamento verificáveis; não importar serviços privados nem criar transportes alternativos |
| Distribuição e instalação | pacote assinado/verificado, Store e Native Store `CURRENT` | O OS só anuncia o pacote atual efetivamente instalado e verificado; manifesto solto, build não assinado ou catálogo remoto não equivale a aplicativo ativo |

**O cumprimento já é verificado no owner `ordax-apps`** por `tools/app-package/build.py`, `tools/verify_app_intelligence.py`, `tools/verify_app_actions.py`, compatibilidade e gates de catalogação existentes; esses validadores percorrem os diretórios oficiais com `app.json`. O OS continua owner dos contratos e da validação da fonte realmente instalada, sem segunda cópia de schema. O padrão é obrigatório para **first-party OrdaX**; programas externos não precisam produzir manifestos OrdaX e só ganham semântica por adaptadores verificados; Conta, Sistema, Ajustes e Loja são estruturas Native com owners próprios, não apps removíveis obrigados a copiar manifestos.

### Capacidade nova `az`: como evoluir sem atualizar o OS a cada app

Se o app oficial `exemplo` publicar uma intenção `exemplo.az` com descrição, parâmetros tipados, efeito e confirmação dentro do contrato **atual**, e uma Action `exemplo.az` correspondente (quando houver provider verificado), o pacote pode evoluir em `ordax-apps`. Depois da verificação, instalação e promoção do slot `CURRENT`, o Fabric reconsulta a fonte viva e descobre a capacidade derivada `app:exemplo:exemplo.az`, **sem hardcode de `az`**, sem alteração de código no OS/Fabric e sem regenerar listas por app. Mudanças/remoções do provedor invalidam a revisão e as propostas antigas.

**Limites:** descobrir/intentar não significa poder executar. Uma capacidade declarada fica `declared-only`/`execution=unavailable` no Fabric, mesmo quando a Aura a entende. Para executar localmente, precisa de provider/binding tipado realmente suportado e aprovação/grant/Action Gateway/Executor/recibo; para aparecer como **tool executável no MCP**, o Runtime Product deve oferecer a operação explicitamente suportada, e a Platform deve atestar Device, sessão, grants e autorização. **Não gerar `tools/list` a partir do manifesto** nem traduzir nomes semelhantes em comandos. Uma função nova *apenas descritiva* não exige atualização do OS; um **novo tipo de parâmetro, contrato, privilégio ou primitiva de execução** pode exigir nova versão do App SDK e implementação no owner apropriado, com migração/compatibilidade explícitas. Campos desconhecidos ou requisitos não suportados falham fechados.

## Catálogo comum de capacidades — contratos existentes, não uma segunda lista de ferramentas

**Decisão de produto (2026-11-04):** a ideia inspirada no Android é correta: todos os apps oficiais têm um *padrão mínimo de reconhecimento* e o sistema apresenta o mesmo conjunto de **categorias de integração** para qualquer app, com suporte, disponibilidade e permissão determinados por fatos reais. **O mínimo não é “ter todas as ferramentas MCP”.** MCP é um canal de execução/remoto; apps podem ser reconhecidos e usados pela UI/Aura sem publicar uma única tool.

**SSOT de cada informação, sem `fabric.json` ou lista paralela:**

| Pergunta sobre o app | Fonte canônica já existente | Quem decide |
| --- | --- | --- |
| Quem é? Qual versão? Está instalado/saudável? | `app.json`/`ordax.component-manifest/1`, Native Store slot `CURRENT` e health | Pacote + OS/Store com provenance/trust |
| Quais serviços do OS precisa ou oferece? | `compatibility.json` ou `migrations/<id>.compatibility.json`, `ordax.component-compatibility/1`, `provides[]`/`requires[]` e App SDK pinado | App declara; OS valida os ports existentes e versões |
| O dispositivo/modo tem a função? | `docs/contracts/product-capabilities.json`, adaptadores e status vivo do Host | OS/adapter; declaração não prova implementação |
| O que a Aura compreende? | `ai/manifest.json` e `ordax.app-intelligence-manifest/1` | Manifesto first-party verificado e Awareness |
| Quais ações do app são declaradas? | `actions/manifest.json`, provider manifests, registry e Native Store `CURRENT` | App + verificadores canônicos; Fabric projeta leitura |
| Quais botões/campos podem ser descritos? | `presentation/semantic-ui.json` + accessibility/DOM atual, quando implementado | App declara; host observa/verifica; Studio é piloto |
| Quais tools **realmente** existem no MCP? | `ordax-runtime/ordax_dev_agent/product_gateway.py` (`PRODUCT_ACTIONS`) e `capability_snapshot.py` (`ordax.device-agent-capabilities/1`) | Runtime anuncia apenas ações locais suportadas pelo Product gateway |
| Quem pode executar agora, em qual conta, janela e recurso? | Platform OAuth/grants/leases/Device atestado + Runtime local policy/receipts | Platform e Runtime; nunca `ai/manifest.json` ou Fabric |

### O menu comum de opções não é uma cópia de 100 flags dentro de cada app

As **famílias de integração** podem aparecer na Loja, Ajustes ou ferramentas de desenvolvimento em todo app, mas devem ser **derivadas** dos contratos acima. Exemplos de famílias e suas fontes: arquivos/galeria (`ordax.file-space` e serviços de mídia específicos quando existirem), captura de mídia (`media.capture` no contrato de modos — *definição não prova suporte de câmera/microfone*), áudio/reprodução (somente se houver port publicado), rede (`network.https`/port de rede pertinente), notificações (`notifications.native` quando o adapter for real), fundo (`background.tasks`), interface mouse/teclado/acessibilidade (Surface/UI semântica), navegação (`browser.*` onde suportado), janelas/processos/clipboard (`computer.*` no Runtime), espaços/Conta e Actions do próprio app.

**IDs ilustrativos de tool** como `computer.click`, `computer.type`, `browser.snapshot` ou `intelligence.app_catalog` vêm do catálogo Product do Runtime; a presença desses nomes em source **não** significa que todo dispositivo os executa, que estão autorizados, nem que são requisitos de cada aplicativo. As capacidades de modos do OS, portas do SDK, intents semânticas e ferramentas Product são **tipos de contrato diferentes**; não atribuir a todos o mesmo namespace ou habilitação.

**Estados para uma futura apresentação unificada, calculados no momento da consulta (não gravados como outro SSOT):**

1. **Não declarado / não aplicável** — o app não requer/oferece aquela integração; ela aparece como não suportada ou é omitida da UI; isso **não é erro de pacote**.
2. **Declarado, mas indisponível** — port/versão/host/provedor não está disponível; se requisito obrigatório, o app é bloqueado conforme compatibilidade. Se opcional, o app funciona sem essa função.
3. **Disponível, sem autorização** — existe implementação e contexto atuais, mas falta grant, consentimento ou target; execução permanece bloqueada.
4. **Autorizado para o escopo atual** — apenas o executor de domínio/Runtime e a Platform podem atestar essa condição, vinculada a identidade, app, Device, sessão, recurso e prazo. Revogação altera imediatamente o estado; não reutilizar cache ou approval antigo.

A apresentação pode usar símbolos “ativo”, “indisponível” e “permissão necessária”, **mas nenhum campo `enabled=true` declarado pelo app equivale a execução permitida**. O Fabric v1 continua com seu contrato exato `authority=none`, `toolExecution=false`, `execution=unavailable`; **não adicionar esses quatro estados ao schema v1**. Um painel de permissões real deve obtê-los dos owners corretos, sem inventar status.

### Padrão dos novos aplicativos e evolução

- Todo first-party passa pelos manifests e compatibility/health já exigidos em `ordax-apps`. Em `requires[]`, um port realmente utilizado pode ser **obrigatório** (`optional=false`) ou **opcional** (`optional=true`). **Não listar como dependência 20 portas que o app não utiliza**, nem copiar um arquivo de flags `false` que fique obsoleto.
- O app `exemplo` pode acrescentar `exemplo.az` aos intents/Actions se utilizar parâmetros e efeitos **já compreendidos pelo schema atual**. A validação do novo pacote e o slot `CURRENT` permitem sua descoberta pelo Fabric **sem edição do OS**. Sem adapter/binding/grant, a ação continua somente descritiva.
- Se `az` introduzir uma **nova primitiva do host** — por exemplo, acesso ainda não contratado a determinado hardware/áudio — o owner do OS precisa publicar um port de App SDK ou adaptador apropriado, com versionamento, compatibilidade, isolamento, permissão e testes. O MCP não vira automaticamente um espelho disso: o owner Runtime/Platform decide separadamente se expõe uma tool real e como autoriza.
- Todos os apps compartilham o **mesmo contrato estrutural**, não o mesmo conjunto de capacidades. Programas estrangeiros só adquirem semântica via adaptador OrdaX verificado. O aplicativo nunca recebe permissões por mera instalação ou declaração de intenção.

**O que existe e o que falta:** identidade, SDK/compatibility, manifestos, verificação e Fabric v1 **já existem**. Uma tela universal de opções calculada por app, conectores de mídia/áudio quando ausentes e a exposição segura de todas as interfaces de UI via Runtime/MCP **ainda não foram implementados como produto universal**. Este documento especifica sua composição a partir dos SSOTs atuais; não os declara prontos nem cria um catálogo executável.

## SSOT entre Aura, apps e MCP — regra de compartilhamento da mesma ação

**Resultado de leitura de source em 04/11/2026:** no `ordax-runtime/main`,
`ordax_dev_agent/product_gateway.py` reúne **93 IDs de Product Actions**
no dicionário único `PRODUCT_ACTIONS`, com nome, ação local, efeito,
escopo e campos aceitos. Essa é a **fonte das ferramentas Product que o
Runtime pode reconhecer**, **não** uma lista de 93 ferramentas publicadas
ou autorizadas em cada dispositivo. O arquivo
`ordax_dev_agent/capability_snapshot.py` deriva
`ordax.device-agent-capabilities/1` somente das ações realmente
suportadas pelo agente local, com limite **64 por snapshot**; exceder
esse limite falha fechado, não corta ou declara capacidade inexistente.
Um cliente MCP ainda depende da Platform, Device atestado, grants, sessão,
política local e recibo. Nomes como `computer.type` ou
`browser.snapshot` são Product Actions do Runtime, **não** permissões
que todos os aplicativos possuem.

**Estado da Aura local:** o `ordax-os` usa
`system/services/intelligence/application-context.mjs` para entregar
à Aura metadados **somente leitura** do Fabric e das Application Actions,
atrelados ao pacote `CURRENT`. O motor
`system/services/intelligence/runtime.mjs` e o contrato
`system/contracts/intelligence.mjs` mantêm
`authority=none`/`toolExecution=false`. O Personal pode solicitar
aprovação de ações Native já registradas por uma via **separada**.
Portanto, **não é verdade** que a Aura local já consuma ou execute as
mesmas 93 Product Actions do MCP. O catálogo
`docs/contracts/intelligence-tools.json` é uma fundação desabilitada;
não tratá-lo como outro catálogo Product ativo.

### O que significa um SSOT funcional, sem criar outro registro

```text
Fontes dos donos (mantidas em seus repos e contratos)
  |-- OS/System + App SDK: disponibilidade de host, serviços e tipos
  |-- Apps: identidade verificada, intents, Action e provider do app
  |-- Runtime: PRODUCT_ACTIONS + adapters realmente suportados
  |-- Platform: sessão, Device, permissions/grants/attestation
                         |
                         v
          Descoberta derivada, por ator/contexto atual
             Fabric + visão autorizável do Runtime
                |                            |
          Aura / Personal              Cliente MCP
                |                            |
           solicita ação              solicita tool
                \                            /
                 \  mesmo owner de domínio /
                  v
          Gate de aprovação / dispatch tipado
          ao executor REAL que possui o efeito
                         |
                  recibo verificável
```

**SSOT não é “tudo num JSON” nem “cada app cadastrar 93 ferramentas”.**
Existe **uma fonte de verdade por responsabilidade**, e a apresentação
compõe uma visão derivada. Uma ação de negócio, por exemplo
`notes.create-note`, deve possuir **um único provider executável
canônico** e contratos de entrada/saída, resultado e risco inequívocos.
Aura e MCP podem ser **dois clientes** dessa mesma operação, mas cada
um passa por sua identidade, autorização, escopo e camada de transporte.
Não duplicar o executor no OS, Runtime e aplicativo.

**Regras obrigatórias da futura ligação Aura ↔ MCP:**

1. **Identidade**: resolver app/ação por IDs canônicos, versão/slot
   `CURRENT` e provider verificado. Mapear explicitamente
   `intent/actionId` semântico ↔ `Product Action` **somente** se
   existir um adapter de domínio verificado; nomes semelhantes ou
   descrições textuais nunca formam um binding executável.
2. **Mesmo contrato de efeito**: tipo e limites de argumentos, saída,
   classe de risco, owner, recurso, idempotência, cancellation/uncertain
   e recibos pertencem ao **serviço executor de domínio**. Uma mudança
   de schema exige negociação de compatibilidade/versionamento do
   App SDK/Runtime, não um hardcode para Aura nem 93 wrappers independentes.
3. **Descoberta por contexto**: app instalado e saudável, modo/host
   suportado, dispositivo correto, grant vigente e autorização do
   ator. A Aura pode compreender a ação sem ter permissão para
   executá-la; o MCP expõe apenas ferramentas realmente implementadas,
   atestadas e selecionáveis no dispositivo, nunca o catálogo global
   inteiro por default.
4. **Fluxos de permissão independentes**: aprovação local do
   Personal/OS não é grant OAuth para cliente MCP; e grant de MCP não
   autoriza chamada direta do modelo local. Ambos devem terminar em
   um executor tipado existente após os controles pertinentes.
5. **Evolução automática e revogação**: nova Action de app dentro de
   contrato suportado aparece na descoberta após promoção de
   `CURRENT`; ação removida/trocada invalida a revisão e a seleção
   antiga. Habilitar tool remota nova exige implementação real no
   Runtime Product e autorização da Platform — não converter
   `declared-only` em tool.
6. **Evidência**: só marcar a ação como “disponível para Aura e MCP”
   quando houver duas provas no mesmo alvo/revisão de provider:
   proposta/aprovação/efeito/recibo pela UI/Aura **e**
   chamada MCP autenticada/grant/efeito/recibo, com revogação
   demonstrada. Catálogo, teste de schema ou sucesso de CI isolados
   não satisfazem esse critério.

**Limite de escopo atual:** esta seção define o **contrato de
interoperabilidade a concluir**, não cria um dispatcher, não ativa
execução da Aura nem transforma o Fabric em Product MCP. A ligação
física semântica ↔ executor Product, o painel consolidado por
ator/Device e os E2E reais **ainda não estão concluídos**.
Owners: `ordax-os` (Fabric/Personal/Action Gateway local),
`ordax-apps` (providers first-party), `ordax-runtime`
(Product gateway/adapters e recibo local), `ordax-platform`
(OAuth/Device/grants) e `ordax-surface` (UI). O vínculo deverá usar
contratos públicos do App SDK/Runtime e o **mesmo serviço de domínio**
quando disponível; não transformar um app em MCP server próprio.

## Integração vertical Aura ⇄ Product MCP — matriz operacional de implementação

**Esta seção é a fila única para a próxima integração de ação, não outro catálogo de tools, plano genérico ou permissão.** O contrato `ordax.capability-discovery/1` do Fabric v1 está concluído; o objetivo pendente é tornar uma operação de domínio **realmente reutilizável** por Aura/Personal e cliente MCP, sem que ambos usem a mesma credencial ou confundam catálogo com execução.

### Estado por fronteira (fonte, realidade e próximo gate)

| Fronteira | SSOT/owner real | Verificado em source em 04/11/2026 | Gate operacional pendente |
| --- | --- | --- | --- |
| Identidade, instalação e compatibilidade | Apps: manifests, App SDK; OS: Store `CURRENT` | Manifestos e gates de pacote existem; descoberta Native exige fonte vigente | Provar instalação/revogação física de app e sua repercussão na Aura |
| Descoberta semântica da Aura | OS: `system/services/intelligence/application-context.mjs` + Fabric + Application Action Registry | Contexto descritivo validado, `toolExecution=false` | Provar UI humana real consumindo a revisão atual sem publicar tool executável |
| Aprovação/efeito Native | OS: `system/composition/native/personal-ordax.mjs` + Action Gateway/Executor | `requestDiscoveredNativeAction()` solicita aprovação; existe prova física Node/HTTP de File Space | Provar clique/consentimento/recibo na Surface, com identidade e revogação |
| Product action remota | Runtime: `ordax_dev_agent/product_gateway.py` | `PRODUCT_ACTIONS` contém 93 IDs no source; `intelligence.app_catalog`/`intelligence.app_detail` são **leituras**, não um broker de `app.action` | Atestar tool efetivamente publicada em um Device, grant e execução autenticada |
| Catálogo semântico no Product Runtime | Runtime: `ordax_dev_agent/application_intelligence_actions.py`; OS: `live-verified-app-semantics.mjs` | O Runtime lê `ordax_studio/app_intelligence_registry.json` **na inicialização**; o OS consulta a geração viva validada por Store `CURRENT`. **Não são hoje a mesma observação.** | Preservar a lista estática como metadado consultivo quando aplicável; para representar apps instalados no OS, consumir exclusivamente a fonte OS atestada via port autenticado, com revisão/identidade/revogação. Não promover arquivo empacotado a inventário vivo |
| Snapshot do Device | Runtime: `ordax_dev_agent/capability_snapshot.py` | Deriva apenas actions locais suportadas; **`MAX_DEVICE_CAPABILITIES=64`** e excedente lança erro | Verificar total efetivamente suportado em Device real e resolver paginação/escopo/capacidade no **owner Runtime** caso exceda 64; nunca truncar silenciosamente |
| Permissão MCP e dispositivo | Platform: OAuth, Owner, session, Device, grants, leases | Há contratos separados para sessão e atestação; estes não derivam do Fabric | Testar readiness, expiração, revogação, dispositivo errado e ausência de grant |
| Ação semântica ↔ executor de domínio | App + OS Gateway + Runtime adapter, cada owner em sua camada | **Não existe prova de vínculo universal** entre IDs `app:<id>:<action>` e Product tool de mesmo efeito | Implementar **um vínculo tipado explícito**, no owner correto, só para uma operação real e já implementada, sem nomes aproximados |
| UI agentic mouse/teclado | Apps: semantic-ui; Runtime: computer/browser control | Studio é piloto do mapa de controles; não é cobertura universal | Provar target/window atual, input autorizado e receipt sem alterar foco global indevidamente |

### Lacuna de SSOT comprovada: catálogo informativo do Runtime ≠ instalação viva do OS

`ordax_dev_agent/application_intelligence_actions.py` carrega
`ordax_studio/app_intelligence_registry.json` uma vez por
`_initialize_application_intelligence()`. As Product Actions
`intelligence.app_catalog` e `intelligence.app_detail` consultam
esse objeto local para devolver manifests/intents/UI semântica
**somente leitura** (`tool_execution=false`). O arquivo **não está versionado na árvore source atual de `ordax-runtime`**; ele pode ser fornecido no artefato instalado, o que precisa ser comprovado no pacote real. O teste `tests/test_application_intelligence_actions.py` garante `available=false` quando o arquivo está ausente. Quando presente, possui
proveniência de repositório e commit, mas **não demonstra**, por si,
que o app está instalado, assinado, atualizado ou disponível no
dispositivo OrdaX selecionado. O formato `ordax.app-intelligence-registry/2`
é uma representação própria do Runtime; não substitui o
`ordax.capability-discovery/1` do OS nem o snapshot Product do Device.

Já o OS `system/services/intelligence/live-verified-app-semantics.mjs`
fornece a Aura/Personal/Fabric a geração semântica viva, conferida
contra o Native Store `CURRENT`, com retirada de providers antigos.
São **duas visões atuais diferentes**: a estática, útil para informação
de catálogo Runtime/Studio, e a viva, útil para capacidades do OS
instalado. Não copiar o arquivo empacotado para o OS e não manter
um watcher duplicado para fazê-las coincidir.

**Contrato de reconciliação a implementar no owner apropriado:**
se uma ferramenta Product afirmar “app instalado” ou “ação disponível
no dispositivo”, deve receber uma **observação autenticada do OS**
que vincule Device, app ID/versão, artefato/slot `CURRENT`, geração
e disponibilidade, com invalidação após remoção ou troca de sessão.
Sem essa observação, reportar apenas *catálogo informativo empacotado*
ou `unavailable`, não `ready`. O Runtime ainda decide quais tools
suporta; a Platform ainda decide quais clientes/grants estão autorizados.
A ligação é **somente leitura** primeiro: nenhuma mutação ou permissão
MCP nasce da sincronização de metadados.

**Prova proporcional exigida:** com um app oficial realmente instalado,
compare Aura/Fabric e `intelligence.app_catalog/detail` no **mesmo
Device**; atualize/remova o app, consulte novamente sem reinstalar
Runtime nem reabrir sessão, e comprove que ambos deixam de anunciar
o provider antigo. Device errado, snapshot sem `CURRENT`, token
inválido e perda de conexão devem negar a conclusão de disponibilidade.
A fonte informativa empacotada pode permanecer para clientes que
não usam o OS Native, desde que não se apresente como estado vivo.

**Limite 93/64:** `93` é a contagem **do dicionário global de ações Product em código**, não das capacidades de um dispositivo nem das ferramentas visíveis ao usuário. `64` é limite do snapshot atual, não limite comprovado do protocolo MCP inteiro. Se o Runtime receber 65 ou mais ações locais suportadas que mapeiam para Product Actions, o snapshot atual falha fechado. Medir isso em dispositivo real **antes** de decidir se precisa de evolução de contrato; não ampliar limite, filtrar ou mudar esquema só por causa da contagem de source.

### Um exemplo de integração sem criar duas ações

Para o app **Notas** a ação semântica declarada `notes.create-note` é um bom **exemplo de ID**, **não** uma ferramenta executável Product já atestada. A implementação só pode afirmar que Aura e MCP “fazem a mesma coisa” depois de provar:

1. **Fonte única:** versão instalada de Notas, `app.json`, `ai/manifest.json`, `actions/manifest.json`, provider e `CURRENT` coincidentes; input `title/body` tipado, owner, Space/recurso e política de confirmação vigentes.
2. **Um executor de domínio:** existe e funciona o serviço legítimo que cria a nota. Aura/Personal produz proposta e pede aprovação; Runtime mapeia Product Action para o **mesmo serviço**, sem copiar a implementação em Python, JS e no app.
3. **Duas bordas autorizadas:** cliente local passa pela aprovação/identidade local; cliente remoto passa por OAuth/Device/grant/lease/Runtime policy. Nenhum consome o consentimento do outro.
4. **Um efeito rastreável:** ambas as rotas recebem resultado e recibo verificáveis do serviço. Duplicação, retry após resposta incerta, mudança de versão, logout, troca de janela/Space e revogação devem bloquear ou reconciliar corretamente, sem repetir efeito.
5. **Evolução limpa:** app anuncia `notes.nova-funcao` com schema atual → Fabric descobre a função declarada, mas não a executa. Só vira executável após provider real e binding autorizado; Product tool remota exige aprovação e atestação próprias.

**Não mapear `notes.create-note` automaticamente para `computer.type` ou `computer.click`.** Automação gráfica pode ser fallback com target/window e grant específicos, mas não é a semântica de domínio nem substitui provider. O Runtime pode oferecer recursos genéricos de computador independentemente do app; essas permissões são **do dispositivo/ator**, não opções habilitadas em todos os apps.

### Próxima sequência de implementação, sem repetir o Fabric

| Prioridade | Owner | Mudança mínima útil | Prova de aceite |
| --- | --- | --- | --- |
| P0 | OS + Runtime + Platform, nos owners atuais | Concluir a ponte Native Product já existente na [OS #2400](https://github.com/ordaxsystems/ordax-os/pull/2400), alinhada à [Platform #291](https://github.com/ordaxsystems/ordax-platform/issues/291), **sem depender da PR #2405** para DEV. Começar com `ordax.surface.status` (leitura) e depois `ordax.surface.open` (efeito/confirmação), apenas quando atestados | Device selecionado, tool realmente suportada, grant, resultado/recibo real, falha fechada e revogação; `mcpReady` não inferido |
| P0-release, separado | OS/Platform/Conta/Site | [OS #2405](https://github.com/ordaxsystems/ordax-os/pull/2405) é gateway de Conta/Owner e **não** pré-requisito do MCP DEV. Sua PR foi explicitamente mantida sem merge até autorização coordenada de Supabase/Vercel/Worker e E2E Owner | Sem ativação pública, deploy ou merge prematuro para desbloquear laboratório |
| P1-discovery | Runtime + OS, sem catálogo novo | Distinguir registro informativo `app_intelligence_registry.json` de inventário de apps **instalados** na Store `CURRENT`; onde o Product oferecer disponibilidade, ligar ao port Native autenticado existente, read-only | Mesmo app, versão e revogação observados pelos dois clientes, com Device/slot/revisão verificáveis |
| P1 | OS/Apps, com owner único do serviço | Selecionar **uma operação de domínio já executável** e conectar identidade, schema e provider à proposta da Aura e ao adaptador Runtime, com contratos públicos | Mesmo efeito e recibos comparáveis pelas duas rotas, sem segundo executor |
| P2 | Runtime + Platform | Confrontar `PRODUCT_ACTIONS` com a lista local realmente suportada no Device, limite de snapshot e grants expostos | Capacidade não suportada não aparece; exceder limite não vira falso sucesso |
| P3 | Surface + Apps | Expor estados derivados de suporte/autorizações em UI e observar semantic controls reais | UI exibe por app e ator o estado atual; não pede autorização inexistente |

**Gates negativos obrigatórios, proporcionais à operação modificada:** app não instalado, hash/revisão de provider divergente, grant vencido, Owner/Device incorreto, escopo de Space errado, usuário negando aprovação, payload inválido, cancelamento/resultado incerto, revogação durante execução e capability desconhecida. Cada falha deve produzir `blocked`, `unavailable`, `denied` ou recibo/erro equivalente **real**, nunca `succeeded` inferido da presença em um catálogo. Testes OS existentes: `tests/test_capability_discovery.mjs`, `tests/test_capability_fabric_aura_context.mjs`, `tests/test_capability_fabric_native_action_bridge.mjs` e `tests/test_capability_fabric_windows_file_space_e2e.mjs`. Só executar suites do Runtime/Platform que afetem o contrato modificado, nos respectivos owners; provas de source não substituem E2E físico.

**Critério intermediário honesto:** uma consulta Product de catálogo empacotado pode ser `success` como **leitura informativa**, mas nunca atesta app instalado ou ação executável. Uma consulta Native `CURRENT` pode provar disponibilidade local sem conceder grants remotos. Não misturar os dois recibos.

**Definition of done:** a documentação deixa de chamar o vínculo “pendente” somente com duas execuções reais e auditáveis da mesma operação: 1 pela Aura/Personal local e 1 pelo MCP remoto autorizado no mesmo target compatível, seguidas de prova de revogação; nenhuma função auxiliar, manifest ou teste de snapshot sozinho satisfaz.

## Contrato público v1 — fonte exata no código

- **Definição/validação:** `system/contracts/capability-discovery.mjs`, esquema `ordax.capability-discovery/1`.
- **Implementação:** `system/services/system-foundation/capability-discovery.mjs`, `createCapabilityDiscovery()`; lê a fonte viva, sem persistir inventário paralelo.
- **Envelope:** `schema`, `revision` (inteiro, monotônico **na sessão**, não ID global), `revisionScope="session"`, `authority="none"`, `toolExecution=false`, `entries` (máximo 1024).
- **Entradas possíveis:** `system-state` (`reported-available`/`unavailable`), `application-action` (`declared-only`, ID `app:<appId>:<actionId>`) e `native-action` (`declared-only`, namespace `system:action.*`). **Todas** têm `execution="unavailable"` e `authority="none"`. Parâmetros de ações são schema fechado, não autorização; as Native exigem `confirmation="always"`.
- **Port de leitura:** `snapshot()`, `get(id)`, `refresh()`, `subscribe(listener,onError)` quando houver Host Native vivo; `isNativeActionRegistered()` revalida a identidade privada do provedor, incluindo o hash do artefato. Uma leitura inválida falha fechada e invalida o fingerprint transitório; não devolve snapshot obsoleto nem promove revisão inválida. Host/Store acionam os **eventos existentes**, sem polling adicional.
- **Não confundir com:** `docs/contracts/product-capabilities.json` (compatibilidade dos modos do produto), `ordax.device-agent-capabilities/1` do Runtime (somente ações Product realmente suportadas), `application-action-manifest/1`, `personal-action-catalog/1` nem `capability_digest` da Platform. Esses contratos têm finalidades e autoridades diferentes.

## Integração já implementada — onde procurar

| Responsabilidade | Código canônico existente | Estado verificado |
| --- | --- | --- |
| Composição da descoberta Native | `system/composition/native/main.mjs`, `createCapabilityDiscovery` | Integrada à `main`; montagem após Surface Host e reconciliação de grants pelas assinaturas já existentes |
| Filtro de aplicativo instalado atual | `system/services/system-foundation/current-verified-action-gate.mjs` | Compara app, versão, revisão e `sourceCommit` com a observação assinada `CURRENT`; rejeita divergências/duplicações |
| Semântica dinâmica dos aplicativos | `system/services/intelligence/live-verified-app-semantics.mjs`, `application-awareness.mjs`, `application-semantic-router.mjs`, `application-action-capabilities.mjs` | Consulta Store atual, retira apps obsoletos e impede propostas sem provedor vigente |
| Contexto e streaming da Aura | `system/services/intelligence/application-context.mjs` e composição Native | Envia descrições somente leitura; valida a geração antes/depois da inferência e antes de entregar trechos quando houver Store `CURRENT` |
| Ações Native e aprovações | `system/composition/native/personal-ordax.mjs` + `system/contracts/personal-action-catalog.mjs` | `discoverCapabilities()` e `requestDiscoveredNativeAction(workItemId,capabilityId,{resourceValue,expectedRevision})` convergem à aprovação existente, sem atalho de execução |
| Fonte de efeitos e recibos | Personal Action Gateway/Executor + Native File Space | Apenas ação registrada, recurso/grant atual e consentimento exato podem produzir efeito; recibo/erro incerto seguem fluxo existente |
| Runtime MCP externo | `ordaxsystems/ordax-runtime`, `ordax_dev_agent/capability_snapshot.py`, Product gateway | Contrato separado `ordax.device-agent-capabilities/1` limitado às ações suportadas; Fabric não adiciona automaticamente nenhuma tool |
| Plataforma OAuth/Owner/grants | `ordaxsystems/ordax-platform` | Única autoridade de sessão, Device e grants remotos; presença não equivale a prontidão ou permissão |
| UX visual | `ordaxsystems/ordax-surface` | Owner da experiência gráfica; teste real de uso visual e aprovação ainda não homologado pelo Fabric v1 |

**Exemplo nativo já exercitado em teste:** `system:action.native-file.ensure-directory` é mostrado declarativamente. Personal pede aprovação vinculada ao `Work`, `resourceValue`, identidade do artefato e `expectedRevision`. Somente depois de consentimento, gateway e grant válidos o executor já existente pode criar diretório no File Space e registrar o resultado. Repetição idempotente, retirada do provedor, travessia de caminho, concorrência e resposta incerta são cenários cobertos. A **entrada Fabric continua `execution=unavailable`**: o efeito, quando autorizado, acontece por outra fronteira canônica.

## Evidências comprovadas e limites

| Evidência | O que demonstra | O que **não** demonstra |
| --- | --- | --- |
| [OS PR #2406](https://github.com/ordaxsystems/ordax-os/pull/2406), merge `b44659ec8` | Código Fabric integrado. PR registra **587/587** testes Node locais na reconciliação final | E2E remoto com grants ou UI física |
| [Application Action Capability Foundation #41778749552](https://github.com/ordaxsystems/ordax-os/actions/runs/41778749552) | CI do HEAD da PR, **487/487** testes, incluindo guards de Aura/streaming | Sessão Product MCP, tool real autorizada |
| `tests/test_capability_discovery.mjs`, `tests/test_capability_fabric_aura_context.mjs`, `tests/test_capability_fabric_native_action_bridge.mjs`, `tests/test_current_verified_action_gate.mjs` | Contratos, fontes vivas, revogação, consentimento, falha fechada e concorrência | Homologação por clique na Surface |
| `tests/test_capability_fabric_windows_file_space_e2e.mjs` | **8/8** cenários executados em Windows físico, via Node/HTTP/disco, com diretórios e recibos reais | Clique humano real na janela Electron ou despacho remoto |
| Windows `DESKTOP-4UFL03B` em 04/11 | Instalador único, Desktop Native e Surface prontos, revisão `9f3a7f0abc45` ativada com health receipt; `GET /__ordax/native/session` anônimo retorna **401** | Product Runtime atestado, App real instalado/removido na UI ou autorização MCP |

**Correção de trilha histórica:** o arquivo `tests/test_capability_fabric_mcp_authority_boundary.mjs` citado na seção D do plano **não existe no `ordax-os/main` verificado em 04/11**. Seu registro é de experimento/teste local do plano, **não** um teste versionado a ser executado no remoto. Não reabrir a implementação do Fabric só para reproduzir esse arquivo ou sua contagem histórica.

## O que falta — gates separados, não defeitos do Fabric v1

1. **UI/Aura (Owner: `ordax-surface` + composição OS):** provar na Surface real Windows a descoberta de capacidades atuais, instalação/remoção ou alteração verificável de app durante a sessão, proposta, solicitação de aprovação, consentimento real, efeito/recibo e revogação sem ação antiga reaparecer. O teste Node/HTTP não substitui esta prova.
2. **Provedor executável de Application Actions (owners OS/Apps conforme contrato):** resolver artifact/provedor verificado e executar pela aprovação/grant/gateway existentes. Ações de apps anunciadas como `declared-only` não são hoje executáveis só porque aparecem na Aura. Não inventar tool por semelhança de nome.
3. **Runtime/Product MCP (owners `ordax-runtime` e `ordax-platform`; integração OS na [PR #2400](https://github.com/ordaxsystems/ordax-os/pull/2400)):** concluir a integração existente, atestar Product Device e `capability_digest` verdadeiro, apresentar apenas ferramentas suportadas pelo Runtime, selecionar Device/Owner/grant exatos, executar e revogar em sessão autenticada com recibo `succeeded`/erro verificável. Não usar `mcpReady=true` por inferência. [Runtime #306](https://github.com/ordaxsystems/ordax-runtime/pull/306) e [Platform #333](https://github.com/ordaxsystems/ordax-platform/pull/333) **já foram integradas**; a PR OS #2400 **segue aberta** na data de verificação. Isso **não significa** que todas as ações semânticas Fabric estejam disponíveis como tools MCP.
4. **Conta/gerência Owner remota:** [OS #2405](https://github.com/ordaxsystems/ordax-os/pull/2405) ainda aberta, sujeita a gates de release/Supabase/Vercel e confirmação de autoridade. [Platform #334](https://github.com/ordaxsystems/ordax-platform/pull/334) já integrada. Não ativar Conta pública ou flags apenas para acelerar o DEV MCP.
5. **Ambientes adicionais:** prova física no USB/Linux somente quando aquela entrega for retomada; CI Windows não a substitui, e não é pré-requisito para reabrir o v1.

Os passos de Product MCP e UX são **frentes próprias**, não extensões automáticas do catálogo v1. Estado de dispositivo online/offline, check de PR e publicação de Worker são voláteis: consultar fontes atuais antes de declarar conclusões.

## Próxima IA: roteiro de retomada em 5 minutos

1. Ler `docs/README.md` → topo de `docs/CURRENT-STATE.md` → **este arquivo**. Consultar `docs/plans/CAPABILITY-FABRIC-V1.md` somente para histórico ou testes causais específicos.
2. Verificar `ordax-os/main`, PR #2406 (já merged), PRs #2400 e #2405 e estados atuais dos repos `ordax-runtime`, `ordax-platform`, `ordax-surface`. **Não tratar versões antigas do checkout Windows com mudanças não commitadas como fonte remota canônica; não executar reset/pull destrutivo ali.**
3. Começar pelo bloqueio vertical existente no owner correto; **não** criar segundo Fabric, inventário, Store, gateway, daemon, plataforma OAuth, grant ledger, instalação Desktop, PR ou workflow só porque os passos de UI/MCP continuam pendentes.
4. Preservar `authority=none` e `toolExecution=false`, fail-closed e revalidação de `CURRENT`, provedor/artefato/owner/Space/Work/revisão antes de aprovação, despacho, streaming e recibo.
5. Executar primeiro a correção em escopo, então os testes **existentes** proporcionais ao risco (`tests/test_capability_*.mjs`, suíte de Application Actions/Personal e, para efeito físico, o E2E File Space já existente). Não repetir build USB/QEMU/Creator/CI sem gate causal. Só marcar concluído o que tiver recibo real no ambiente-alvo.

**Critério de conclusão funcional futuro:** a mesma ação de domínio suportada pode ser compreendida e solicitada pela UI/Aura e, quando uma tool Product específica tiver sido explicitamente implementada e autorizada, pelo cliente MCP. As duas rotas chegam a **serviço/recibo canônicos**, com autorização própria de cada ator. Nenhuma descrição semântica concede acesso ao computador.
