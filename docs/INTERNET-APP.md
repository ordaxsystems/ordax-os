# OrdaX Internet

Status: PROTOTYPE IMPLEMENTATION — NATIVE HARDWARE PROOF PENDING

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

## Native engine

The USB/native-disk runtime uses the WebKitGTK 4.1 engine already appropriate to the Alpine graphical runtime, but the OrdaX host owns the application integration instead of delegating product behavior to a generic browser shell.

`system/surface/runtime/ordax_browser_host.py` owns:

- one privileged Surface WebView with the `ordaxBrowser` message handler;
- a separate persistent website-data manager for external browsing;
- one unprivileged WebView per browser tab;
- tab lifecycle, navigation history and viewport placement;
- durable restoration of public tab URLs, tab order and the active tab across Surface restarts;
- default-deny website permission requests in the first implementation slice;
- fail-closed rejection of localhost, loopback, private/link-local and other non-public literal IP navigation;
- filtering of external WebView resource requests and redirects so literal/local non-public network targets are not intentionally dispatched by the browser plane;
- blocked downloads until a dedicated user-space download contract is connected.

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
system/apps/internet/app.mjs
system/contracts/browser-session.mjs
system/apps/internet/runtime.mjs
system/apps/internet/internet.css
system/apps/internet/ui/browser-controls.mjs
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

The Surface composition no longer loads Internet JavaScript or CSS as a static boot dependency. The version-checked optional component runtime owns the browser UI lifecycle and loads its own stylesheet only after the Surface health boundary. A runtime or stylesheet failure marks Internet unhealthy without converting the Surface into a failed cold boot. Internet is currently **`0.3.0 Beta` with `releaseMode: "git-app"`**: in Owner/Development its app-owned version is delivered through the ordinary Git checkout/reconcile path. This runtime isolation and version identity must not be confused with a production-independent updater, Store or component-local rollback. The production-independent path remains `component-slot`, gated on signed verification, pending health, promotion and rollback.

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
- Consultas textuais usam o provedor inicial DuckDuckGo, declarado uma única vez no contrato; ainda não há seletor persistido de provedor.
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
- downloads;
- website permission UI;
- private-session lifecycle;
- page-to-AI context extraction;
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

The notebook already materializes the Surface from the checked-out OrdaX source. Internet's current `git-app` mode means Owner/Development receives its app/runtime source through that Git-first path; this does not define the Stable/MVP production channel.

Normal Owner/Development delivery remains:

```text
main
 -> ordax-pull / normal update path
 -> affected Surface/native-host materialization
 -> Surface/component restart when required
```

No kernel rebuild or USB reflash is required solely for this application/runtime source change.

Physical hardware validation is still required before this slice can be called proven on the notebook. Until that proof exists, repository tests and CI validate structure and contracts but do not substitute for real keyboard/touchpad/GPU/network/WebKit behavior.

## Hardware proof checklist

On the notebook, validate in this order:

1. Surface starts under Cage with `ordax_browser_host.py` and reaches the normal desktop.
2. Internet app opens without changing another first-party app.
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
