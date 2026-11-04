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
