# OrdaX Internet

Status: **produto com fonte portátil canônica em `ordax-apps`; distribuição Native assinada ainda não habilitada**

**Owners:** A UI e a lógica do produto Internet pertencem a `ordaxsystems/ordax-apps/apps/internet`; o repositório do OS mantém o motor WebKit, o host Native, o isolamento do conteúdo, os controles de rede/downloads e o lifecycle de componentes. A fonte foi transferida e o OS não mantém uma cópia executável em `system/apps/internet/`. O manifesto de migração permite o corte de fonte, mas mantém instalação/distribuição bloqueadas: o pacote é unsigned, o Native não autoriza leitura de módulo para Internet e bootstrap/rollback não foram comprovados. A ausência de fonte no OS não deve ser confundida com instalação do app.

## Goal

`Internet` is the OrdaX first-party browser application. Its product flow is:

```text
browse
 -> organize tabs inside the current workspace
 -> save an explicit page reference to a project
 -> add project-owned notes
 -> optionally ask for assistance with user-selected context
 -> continue the work later
```

The visual direction follows the OrdaX browser concept: conventional navigation at the top, workspace/tab organization at the left, the web page as the primary center surface, and a collapsible project-context panel at the right.

This application is being implemented in the clean-room prototype. It does not import the legacy `ordax.browser` implementation or any old browser directory wholesale.

## Non-negotiable security boundary

Arbitrary websites are untrusted content. They must never execute inside the privileged OrdaX Surface WebView and must never receive Surface/native capability bridges.

Therefore the native implementation has two planes:

```text
privileged plane
  OrdaX Surface WebView
  -> shared browser chrome
  -> workspace/project UI
  -> narrow browser-session bridge

unprivileged web-content plane
  separate WebKit WebContext
  -> separate WebViews per tab
  -> normal external HTTP/HTTPS content
  -> no OrdaX privileged message handler
```

The shared Surface only owns browser chrome and orchestration. The native adapter owns the engine boundary. This keeps the product aligned with the repository rule that platform differences are capability adapters rather than copied applications.

## Ownership do produto e da plataforma (SSOT)

**Estado atual:** `ordaxsystems/ordax-apps/apps/internet` é a fonte canônica.
O manifesto do Apps registra `source_cutover_allowed=true`,
`distribution_activation_allowed=false`, fonte materializada sem assinatura e
instalação Native, rollback e bootstrap ainda não verificados. O SSOT da
migração é
[`migrations/internet.externalization.json`](https://github.com/ordaxsystems/ordax-apps/blob/main/migrations/internet.externalization.json)
no repositório de aplicativos. Não recriar `system/apps/internet/`, nem manter
um segundo manifesto/runtime no OS. O snapshot histórico da fonte pré-corte é
evidência de migração e auditoria, não uma fonte ativa.

Com a fonte já externalizada, a separação de responsabilidades é:

- **ordax-apps:** UI, tema, favoritos, histórico e preferências do
  produto; lógica de navegação/busca no nível do app; i18n; manifesto de
  inteligência e ações declarativas; empacotamento e testes do app.
- **ordax-os:** WebKitGTK, WebContext/WebViews isolados e ponte segura;
  segurança de rede e de site, navegação no host, permissões nativas,
  armazenamento e ciclo de downloads, política de instalação/atualização,
  catálogo verificado, assinatura, ativação e rollback.
- **Integração:** contratos públicos do App SDK com compatibilidade
  pinada; nenhuma cópia do motor, gerenciador de permissões, updater ou
  serviços da plataforma dentro de `ordax-apps`.

### Auditoria executável do snapshot pré-corte do App SDK

`python3 tools/verify/internet_sdk_readiness.py --check` é um auditor
histórico do snapshot pré-corte do Internet. Na CI do Apps, o snapshot exato
é materializado em `.ordax-internet-source/` antes da execução; o verificador
lê seus `system/apps/internet/**/*.mjs`, resolve imports e assets, percorre
recursivamente as dependências dos contratos, lê o
`sdk/app-sdk-v1/bundle.json` **publicado** e reporta os contratos
necessários que ainda não aparecem no SDK. Imports de módulos internos
do OS aparecem em `privatePlatformImports` e não podem virar dependências
externas do app. Imports remotos, caminhos inexistentes ou dinâmicos sem
literal falham fechados.

Esse snapshot não é restaurado no checkout atual do OS. A CI do Surface Web
no OS também executa um teste negativo que exige que a fonte ativa esteja
ausente. O inventário JSON `ordax.internet-sdk-readiness/1` é derivado; não há
uma segunda lista editável de contratos. A CI do Apps e o OS executam testes
do auditor e da ausência da fonte ativa, respectivamente. A opção
`--require-public` serve para auditar o snapshot e seus contratos; não altera
o manifesto de migração nem autoriza instalação.

**Importante:** `sdkBoundaryClean` não é autorização de instalação.
O relatório continua com `sourceCutoverAuthorized=false` porque audita um
snapshot congelado e não governa o manifesto corrente; `distributionActivated`
também permanece `false`. O Apps registra o corte concluído em sua migração,
mas pacote assinado, instalação, rollback e bootstrap continuam gates
independentes. O manifesto fixa a versão do bundle SDK usado pelo auditor;
contratos públicos são necessários para empacotar, mas não autorizam mutação.
A plataforma deve entregar ports autorizados e restritos ao usuário, Space e
projeto. Não copiar serviços nativos nem criar uma segunda implementação.

A versão de produto `0.3.0 Beta` identifica o Internet em Apps; não descreve
um `git-app` ativo no OS. O modo de entrega independente continua sendo
`component-slot`, mas a leitura Native, a ativação, a assinatura, o bootstrap
e o rollback de Internet não estão habilitados/provados. Não abrir esses gates
alterando apenas uma flag: cada um exige prova do respectivo owner.

## Native engine

The current USB/native-disk host uses WebKitGTK 4.1 as an OS-owned engine. The portable app consumes the `browser-session` contract and does not own or depend on the Linux distribution; keeping the engine in the host lets the base distribution evolve independently.

`system/surface/runtime/ordax_browser_host.py` owns:

- one privileged Surface WebView with the `ordaxBrowser` message handler;
- a separate persistent website-data manager for external browsing;
- one unprivileged WebView per browser tab;
- tab lifecycle, navigation history and viewport placement;
- durable restoration of public tab URLs, tab order and the active tab across Surface restarts;
- default-deny website permission requests in the first implementation slice;
- fail-closed rejection of localhost, loopback, private/link-local and other non-public literal IP navigation;
- filtering of external WebView resource requests and redirects so literal/local non-public network targets are not intentionally dispatched by the browser plane;
- downloads initiated by the unprivileged engine require a separate, explicit Surface approval before the Native host may persist them into the user's bounded `/Downloads` directory.

The external browsing profile separates durable website data from disposable cache:

```text
/var/lib/ordax-user/browser/
├─ session.json
└─ default/
   └─ data/

/run/ordax/browser-cache/
└─ default/
```

`session.json` is a small OrdaX-owned state file. It stores only the filtered public URL list and active-tab index, is written atomically with private permissions, is bounded to 16 tabs, and fails closed on missing, corrupt, oversized, symlinked or unsupported state. The host deduplicates canonical session snapshots so unchanged state is not fsync'd repeatedly. It does not serialize page HTML, privileged Surface state or website storage.

Persistent website data remains owned by the isolated WebKit profile under the existing OrdaX user-state mount. WebKit cache is intentionally rooted under `/run/ordax` so portable USB does not spend flash endurance on rebuildable browser cache.

### Loopback and DNS-rebinding status

The browser host rejects direct local/non-public network destinations both for top-level navigation and for WebKit resource requests. That closes the straightforward path where an Internet page tries to load `127.0.0.1`, RFC1918/private addresses, link-local addresses, single-label local hosts, `.local`, or `.home.arpa` targets as subresources.

The native loopback HTTP host now also owns the server-side request boundary. Every request must carry the exact bound `127.0.0.1:<port>` Host authority; privileged `/__ordax/native/` requests additionally reject explicit foreign Origin, Referer or Sec-Fetch-Site provenance. The live handler integration tests exercise canonical same-origin access, foreign-origin rejection and a DNS-rebinding-style public Host alias resolving to loopback. The server also refuses startup on a non-loopback bind.

This closes the previously documented source-level Host/origin gap. Hardware validation is still required before the browser slice is considered proven on the notebook, and the external WebKit plane remains independently constrained by its public-network policy.

## Shared application shell

The product shell lives in shared source:

```text
ordax-apps/apps/internet/src/app.mjs
system/contracts/browser-session.mjs
ordax-apps/apps/internet/src/runtime.mjs
ordax-apps/apps/internet/assets/internet.css
ordax-apps/apps/internet/src/ui/browser-controls.mjs
```

Adapters:

```text
system/adapters/native/browser-session.mjs
system/adapters/web/browser-session.mjs
```

Native tab-session persistence is isolated from GTK/WebKit in:

```text
system/surface/runtime/browser_session_store.py
```

The shared app does not import native/Web adapters, call loopback control endpoints directly, or create an iframe for arbitrary sites.

The OS composition does not import the Internet product UI or CSS as a boot dependency. Its optional verified component loader consumes a package only through the Native broker when the component is independently authorized. The canonical package owner map includes Internet for provenance and discovery metadata, but `native_loopback_broker_supported_components`, probation, health mutation and activation remain narrower, independent gates. Internet is not currently enabled for Native module reads or package activation. The Web Surface exposes an unavailable browser-session port rather than implying that the browser product is installed there. Do not infer runtime availability from the source manifest or repository checkout.

## Capability

The engine boundary is represented by:

```text
browser.web-content
```

Security boundary:

```text
isolated-unprivileged-web-content
```

It is currently a baseline capability of `usb` and `native-disk`. The Web mode intentionally exposes an unavailable browser-session port instead of pretending that arbitrary websites can be embedded safely and reliably inside the Web Surface.

Desktop and mobile remain unclaimed until their adapters provide an equivalent isolation contract.

## Navegação e busca na barra de endereço

A barra única do OrdaX Internet agora distingue endereços HTTP(S) explícitos,
domínios públicos digitados sem protocolo e consultas de pesquisa. A política
tipada é `system/contracts/browser-navigation.mjs` e é reutilizada pelos
controles compartilhados; não existe parser de endereços paralelo na UI.

- Domínios digitados sem protocolo usam HTTPS; endereços HTTP(S) mantêm o protocolo informado.
- Pesquisas textuais usam o provedor escolhido em `BROWSER_SEARCH_PROVIDERS`, com preferência persistida no perfil Native; DuckDuckGo é o padrão.
- Links internos de outros aplicativos devem solicitar navegação explícita e **não** se transformam silenciosamente em consultas de pesquisa.
- Esquemas não web, URLs com credenciais, entradas malformadas, caracteres de controle e campos excessivos falham antes de chegar ao host.
- O host Native/WebKit continua sendo a autoridade de rede; a resolução no chrome não concede acesso a localhost, IPs privados ou aos recursos privilegiados do sistema.
- O host recusa credenciais em URLs externas, barras invertidas e controles; rejeita autoridades com percent-encoding e normaliza IDNA antes de verificar endereços locais (inclusive variantes Unicode de pontos). A verificação também se aplica às requisições de recursos.

**Provas:** `node --test tests/test_internet_navigation.mjs` e
`python3 -m unittest tests.test_internet_browser_contract`, além da verificação
física já documentada abaixo. A presença dos testes não significa que foram
executados em hardware neste PR.

## Links que solicitam nova janela

No host Native/WebKit, uma navegação `NEW_WINDOW_ACTION` deixa de ser
descartada incondicionalmente. Quando originada de uma ação explícita do
usuário e de uma aba ainda válida, um destino HTTP(S) público é aberto como
outra aba isolada no mesmo `WebContext` externo, **sem** receber a ponte
privilegiada da Surface.

- A decisão original é consumida com `decision.ignore()`; não abre uma janela GTK genérica.
- `NavigationAction.is_user_gesture()` precisa ser verdadeiro; tentativas programáticas não ganham criação irrestrita de abas.
- O destino passa pela mesma `allowed_external_uri` do host, inclusive limites de credenciais e acesso à rede local.
- O limite de 16 abas continua autoritativo no host; abas de páginas usam o namespace `popup-*` sem colidir com `tab-*` da Surface.
- O modo Web continua sem incorporar páginas externas e não simula a funcionalidade.
- `tests/test_internet_popup_policy.py` executa a função de política extraída da implementação real em ambiente sem GTK. Prova física de comportamento, foco e compatibilidade no WebKit permanece pendente.

## Seleção de texto para consulta à IA — fluxo opt-in

O painel **Assistência opcional** permite selecionar texto dentro da aba WebKit
externa e capturar **somente o texto destacado pelo usuário**, em uma única
solicitação. Não existe observação automática do DOM, extração de cookies,
acesso a campos escondidos ou entrega de página integral.

O fluxo tem dois comandos distintos:
1. **Capturar texto selecionado** envia `page-selection.capture` com identidade
   de aba e identificador de pedido ao host privilegiado.
2. O usuário visualiza o trecho em uma prévia somente leitura, pode descartá-lo,
   incluir uma pergunta e então pressiona **Enviar seleção à IA**.

A segunda ação cria um item `scope=document` e
`source=untrusted-web-content`, usando o SSOT
`ordax.intelligence/1`. A consulta é consultiva (`authority=none`) e utiliza
o provedor de inteligência autorizado pela composição do Space atual; se ele
estiver indisponível, o botão de envio permanece inativo. Texto de sites nunca
é tratado como instruções de sistema ou capability.

Limites e proteções:
- até 4.096 caracteres de texto selecionado (truncamento declarado);
- limite de 800 caracteres para a pergunta;
- até uma captura pendente, com request ID e timeout no adaptador Native;
- recusa de aba inativa, URL não pública, navegação em andamento ou página
  alterada durante a captura;
- trecho e resposta ficam apenas em memória, sem histórico, sincronização ou
  persistência de página;
- trocas de aba, URL, Conta OrdaX, Space ou Profile invalidam a prévia e descartam respostas atrasadas para impedir contexto cruzado;
- prévia avisa quando o recorte de 4.096 caracteres exclui parte do texto;
- modo Web mantém a captura indisponível sem fabricar um `iframe`.

Provas de contrato:
`tests/test_browser_page_selection.mjs`,
`tests/test_native_browser_page_selection.mjs` e
`tests/test_internet_native_page_selection.py`.

A prova física WebKit/GTK e avaliação de segurança do caminho completo até
o modelo continuam pendentes. A proteção contra prompt injection é uma
fronteira de confiança explícita, mas não significa que modelos generativos
sejam imunes a texto malicioso.

## Localizar texto na página (Find in page)

A Surface do Internet ganhou uma barra de busca nativa, ativada por botão
ou `Ctrl+F`/`Cmd+F`, com consulta, próximo/anterior, Escape e resultado de
ocorrências. O owner da operação é o `WebKit2.FindController` da aba externa,
não o DOM do site nem um script com acesso a dados privados.
Referência: https://webkitgtk.org/reference/webkit2gtk/stable/class.FindController.html

Arquitetura:
- contrato `ordax.browser-page-find-port/1` separado da sessão `ordax.browser-session/1`;
- adaptador Native `system/adapters/native/browser-page-find.mjs`;
- ações tipadas `page-find.search|next|previous|finish`, sem tokens de login ou texto do documento;
- até 256 caracteres na consulta e 1.000 correspondências reportadas;
- respostas trazem somente `tabId`, `query`, `state` e `count` — nenhum conteúdo da página;
- host recusa busca em aba inativa/carregando/URL não permitida; descarta resultados
  de aba ou consulta alterada; fecha a busca ao trocar de aba ou navegar;
- modo Web não oferece busca nativa inexistente; mantém controle desabilitado;
- strings do componente localizadas em pt-BR/en-US.

Validação: `node --test tests/test_browser_page_find.mjs` e
`python -m unittest tests.test_internet_native_page_find` estão no
`Surface Web Candidate`. A prova física WebKitGTK/USB, inclusive
foco do atalho, continua necessária antes de promover lançamento.

## Preferências do provedor de pesquisa

A barra única de navegação aceita pesquisa por texto e agora permite escolher o
mecanismo de pesquisa no próprio Internet: **DuckDuckGo (padrão), Brave Search,
Google ou Bing**. Não há provedores arbitrários nem execução de consultas
na composição. As origens HTTPS e parâmetros ficam na lista SSOT
`BROWSER_SEARCH_PROVIDERS` em `system/contracts/browser-navigation.mjs`.

A preferência é armazenada somente no perfil privilegiado Native,
via `ordax.native.browser-search-preferences.v1`; salva apenas `providerId`
e não armazena consultas nem tokens. Os contratos ficam em
`system/contracts/browser-search-preferences.mjs` e a lógica em
`ordax-apps/apps/internet/src/services/search-preferences.mjs`. Quando o storage
nativo não está disponível, a preferência vale para a sessão e é sinalizada
como tal. O modo Web não simula um motor de navegação: a seleção fica
desabilitada quando o Browser Session não está disponível.

O provedor participa exclusivamente de pesquisas textuais. URLs explícitas e
ativação de URLs enviadas por outros apps não são reescritas ou encaminhadas a
buscadores, preservando a fronteira de segurança entre pesquisa e navegação.
`tests/test_browser_search_preferences.mjs` cobre validação dos quatro
provedores, codificação da consulta, descarte de configuração corrompida,
persistência, fallback e rejeição de IDs desconhecidos.

O mecanismo de pesquisa é uma preferência do navegador, não um provider
de IA, nem uma permissão para o Studio ou agentes.

## Downloads seguros, com aprovação explícita

O host WebKitGTK liga `WebContext::download-started` ao adaptador de downloads
do OrdaX. A página não escolhe o caminho final e nunca recebe a ponte nativa.
A transferência aguarda `Download::decide-destination` (WebKitGTK 4.1) e não
avança antes da decisão manual do usuário na Surface.

Contrato: `ordax.browser-download-port/1`. O host emite somente um
identificador opaco, nome saneado e estado. A Surface apresenta **Salvar em
Downloads** ou **Cancelar**; apenas a confirmação envia `download.approve`.
A ação é limitada a um download pendente existente; não há API de escrita
arbitrária nem confirmação implícita por clique no site.

A política `browser_download_policy.py` grava exclusivamente em
`/var/lib/ordax-user/Downloads` na configuração Native padrão, que corresponde
à pasta `/Downloads` em Arquivos. Os nomes reais têm prefixo aleatório
`download-<id>` para não colidir. O WebKit recebe uma URI de destino apenas
após aprovação; `allow-overwrite=false` impede substituição de arquivos.
O diretório não pode ser um link simbólico, o resultado deve ser arquivo
regular, permissões finais são `0600` e **não há limite fixo por tamanho de arquivo**.

O host também impõe:
- origem pública HTTP(S), WebView externa pertencente a uma aba ativa;
- máximo de quatro transferências simultâneas e 60 segundos para aprovação;
- verificação do espaço disponível no volume persistente do usuário antes de
  iniciar e durante a transferência (inclusive sem `Content-Length`);
- reserva proporcional de 1% do volume, limitada entre 32 MiB e 1 GiB,
  para não esgotar o filesystem durante downloads grandes;
- transferência feita pelo WebKitGTK diretamente ao disco, sem pré-carregar o
  arquivo na RAM;
- limpeza do arquivo parcial criado pelo WebKit em falha/cancelamento;
- eventos de download sem caminho absoluto, conteúdo, cookies ou tokens;
- nenhum download no modo Web enquanto não existir motor isolado compatível.

O painel retém apenas os oito eventos mais recentes em memória. **Um arquivo
salvo nunca é executado automaticamente.** A prova de comportamento com
WebKitGTK físico continua pendente; testes Node/Python e CI não substituem
verificações em hardware, permissões efetivas do usuário, tratamento de falta
de espaço e UX sob falha de rede.

## First implementation slice

Implemented in source:

- first-party `Internet` app registration;
- visual browser shell based on the approved concept direction;
- address navigation;
- up to 16 native tabs;
- activate/close tabs;
- back/forward/reload;
- persistent per-profile WebKit website data;
- safe tab URL/order/active-tab restoration across Surface restarts;
- external-content isolation from Surface capabilities;
- direct local/non-public literal network target filtering for external navigation, subresources and redirects;
- explicit native capability advertisement;
- native runtime package ownership without a `barkery-browser` dependency;
- fail-closed Web-mode behavior;
- architecture regression tests;
- explicit project-owned web-reference persistence on Native/USB;
- bounded per-reference user notes stored with the saved page;
- automatic cleanup of saved web references when their project is removed;
- device-local browser favorites with canonical URL identity, explicit add/remove controls and session fallback when privileged profile storage is unavailable;
- bounded device-local browser history recorded only after completed public HTTP/HTTPS navigation transitions;
- explicit history reopen/remove/clear controls with session fallback when privileged profile storage is unavailable;
- restored startup tabs are baseline state rather than falsely recorded as fresh visits.

Intentionally not faked yet:

- collections/read-later;
- retomada de download interrompido, verificação antivírus e revisão de destinos alternativos;
- website permission UI;
- private-session lifecycle;
- extração automática de páginas inteiras para IA (somente seleção explícita e consultiva foi implementada);
- desktop/mobile browser engines.

The concept surfaces these future controls, but disabled controls must remain honest until their domain owners and persistence/security contracts exist.

## Project/reference integration

`Salvar no projeto` now stores an explicit bounded reference owned by the project domain. It does not download the page and does not grant website JavaScript access to project storage.

The persisted record contains a stable reference id, project id, canonical HTTP/HTTPS URL, captured title, optional user note and created/updated timestamps. The same project/URL pair is updated in place rather than duplicated. Removing a project prunes its saved web references through the project-reference runtime. Persistence is device-scoped in the Native privileged profile and degrades honestly to session scope if durable storage is unavailable.

The shared Internet UI receives only neutral project/reference, browser-favorites and browser-history ports. It does not use `localStorage`, Native endpoints or adapters directly.

Favorites are browser-owned rather than project-owned. The Native/USB composition persists them in the privileged Surface profile through `ordax.browser-favorites/1`; arbitrary website WebViews never receive that storage capability. A favorite stores only a stable local id, canonical HTTP/HTTPS URL, captured title and timestamps. Persistence degrades explicitly to session scope if privileged profile storage is unavailable.

History is independently browser-owned through `ordax.browser-history/1`. A neutral history bridge observes the browser-session port and records a visit only when a tab reaches a completed public HTTP/HTTPS URL different from that tab's previous completed URL. Existing tabs restored at Surface startup seed the bridge baseline and are not counted as new visits. History is rolling and bounded to 512 entries; clearing or pruning it never mutates WebKit's own back/forward list. Its Native store is also owned by the privileged Surface profile, not by external website WebViews.

Download and offline-copy semantics remain separate operations and still need separate storage, size, provenance and permission rules.

## Optional assistance direction

`Perguntar sobre esta página` is not an automatic website privilege. A future implementation must make the selected context explicit and mediate extraction through a bounded page-context contract. External page JavaScript never receives AI, file, project or system capabilities merely because a page is visible.

## Native delivery to the notebook

The notebook materializes the OrdaX OS Surface from the OS source. `ordax-pull`
updates that OS checkout; it does not currently install or reconcile the
separate Internet source from Apps. The Native broker does not permit Internet
module reads and no signed bootstrap package or rollback proof exists. Until
those gates pass, a newer Apps source does not become an installed notebook app.

Normal Owner/Development delivery remains:

```text
ordax-apps main
 -> verified signed component/bootstrap release (not available for Internet yet)
 -> OS Native lifecycle and slot verification
 -> component restart after a healthy activation
```

The OS `main`/`ordax-pull` path separately updates the browser host and public
contracts. Do not imply that source checkout alone makes Internet available.

Physical hardware validation is still required before this slice can be called proven on the notebook. Until that proof exists, repository tests and CI validate structure and contracts but do not substitute for real keyboard/touchpad/GPU/network/WebKit behavior.

## Hardware proof checklist

On the notebook, validate in this order:

1. Surface starts under Cage with `ordax_browser_host.py` and reaches the normal desktop.
2. After signed package, module-read and lifecycle gates are enabled, Internet
   opens without changing another first-party app. Until then, runtime
   unavailability is the expected fail-closed state.
3. Address entry retains keyboard focus while a page is already visible.
4. External HTTPS page loads and scrolls in the center viewport only.
5. Top/left/right OrdaX browser chrome remains interactive around the page.
6. New tab, activate, close, back, forward and reload behave correctly.
7. Restarting the Surface restores the filtered public tab URL list, order and active tab, while normal WebKit profile data also persists.
8. Corrupt or invalid `session.json` state fails closed to a clean browser session.
9. `http://127.0.0.1`, `localhost`, private/link-local literal IPs and local-name navigation are rejected in the external content plane.
10. A remote page attempting local/non-public subresource loads or redirects does not dispatch those literal targets from the external WebView.
11. Native loopback Host/provenance pinning rejects a DNS-rebinding-style alias and foreign browser provenance on the real notebook runtime.
12. Website permission prompts fail closed in this slice.
13. Download attempts do not write files until the download contract exists.
14. Existing Files, Ajustes, Conta, Sistema, network, power and update paths remain healthy.
15. Update/health rollback still recovers if the new graphical host cannot remain healthy.

## Carregamento de componente instalado

O serviço genérico `system/services/components/current-slot-loader.mjs` agora consome o slot `current` verificado pelo host Native. Obtém metadata pela origem local, confirma ID, versão, commit, estado e revisão, exige módulo sob namespace imutável, revalida antes/depois do mount e destrói uma montagem que perdeu a ativação. Ausência retorna `null`; fontes bundled, metadata inconsistente e URLs externas falham fechados. O serviço não assina, instala, altera grants, publica nem promove componentes.

O executor Native desse loader é `system/adapters/native/isolated-component-executor.mjs`: ele monta o módulo verificado em um iframe `sandbox="allow-scripts"` de origem opaca, limita CSP ao diretório imutável do pacote e não dá acesso de rede, File Space ou APIs Native diretas. Uma `MessagePort` privada encaminha somente App Data do próprio app e o ciclo de vida Surface permitido. A revogação fecha chamadas novas, aguarda operações em curso e solicita o encerramento do runtime isolado. A probation de slots `pending` não pode usar esse importer de `current`; permanece fechada até ter um probe isolado próprio.

Esse carregador não reintroduz o runtime do Internet no OS. Ele só poderá montar o componente quando o broker Native liberar leitura do pacote `current` verificado e o lifecycle autorizar sua instalação; esses gates continuam fechados para Internet.

## Catálogo Native de aplicativos externos instalados

Na composição Native, `discoverVerifiedExternalApplications` usa exclusivamente o broker do slot `current` para ler o manifesto do componente e o manifesto de apresentação; o catálogo único é derivado dessas leituras por `createNativeVerifiedInstalledAppCatalog` e injetado na Surface. A montagem usa `loadVerifiedCurrentComponentRuntime` e o mesmo contexto protegido por App Data, com rechecagem de revisão, versão, commit e origem antes e depois do mount. Remoção ou falha no slot não permite fallback para fonte de produto embutida. Internet permanece indisponível por esse caminho enquanto não tiver module-read, pacote assinado e lifecycle habilitados. Os componentes externos montados são destruídos com a Surface.

Esta conexão consome slots que o host **já** tenha validado e ativado; não cria slots, não autoriza assinatura, publicação ou promoção, nem transforma o catálogo da Store em origem de execução.

## Prazo máximo de descoberta Native

A descoberta de aplicativos instalados é opcional na inicialização Native e possui prazo global limitado a 5 segundos, com `AbortSignal` passado aos pedidos do broker e parada fail-closed caso a leitura trave. Uma consulta de slot inacessível não pode manter indefinidamente o boot aguardando um aplicativo opcional. O host continua sendo a autoridade exclusiva da verificação de slots; o timeout não habilita publicação nem um fallback para implementação embutida.
