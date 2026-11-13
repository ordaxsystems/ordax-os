# OrdaX Intelligence — HANDOFF TRANSVERSAL

> **REFERENCE/HISTORICAL — checkpoints principalmente de 04/11/2026, não fila operacional atual.** Este arquivo preserva contexto para que outros chats/agents entendam decisões e provas sem reiniciar ou duplicar sistemas. Afirmações datadas sobre PRs, devices, gates e “próxima missão” devem ser lidas como estado daquele momento. Em particular, a OS #2400 foi integrada em 04/11/2026 e qualquer trecho abaixo que a descreva como aberta/conflitante está superado. Trabalho atual começa em `AGENTS.md` → `docs/README.md` → topo de `docs/CURRENT-STATE.md` → documento canônico/owner → PRs e artefatos vivos. Em divergência prevalecem código + contratos públicos, `docs/CURRENT-STATE.md`, `docs/README.md`, `MVP.md` e os documentos canônicos de domínio.

## Checkpoint histórico de Produto e bloqueio causal — 2026-11-04

**Observação read-only em `DESKTOP-4UFL03B`:** a instalação
`%LOCALAPPDATA%/Programs/OrdaX OS Desktop Dev` está aberta,
mas o `resources/runtime-template` instalado **não inclui**
`surface-runtime-bridge.mjs`,
`desktop-product-runtime-status.mjs` nem
`desktop-surface-state-report.mjs`, ainda exclusivos da
[OS #2400](https://github.com/ordaxsystems/ordax-os/pull/2400).
O Supervisor anterior existe, porém não há
`native-state/product-runtime` ou `agent-settings.json`
na instalação observada. O MCP auxiliar Windows está online
com grant próprio; a identidade **OrdaX Desktop Product** está
offline e só possui `mcp-discovery`. Este diagnóstico não é
uma queda do MCP auxiliar e **não** é resolvido com novas matrículas
da Platform, copiar módulos soltos ou executar agentes não atestados.

**Gate registrado naquele checkpoint:** a PR #2400 continuava aberta, HEAD
`29330e6b901c311680cc468c93e8e6556cfb03ec`. Seu diff
edita `system/composition/native/main.mjs`, que também é
consumido no Owner USB; o classificador
`tools/ci/creator_owner_impact.py` corretamente exige o
`build-and-publish`. O produtor legado da `main` usa
`bootstrap/surface-runtime/source.json` (324 APKs pinados)
e falha ao solicitar `libexpat=2.9.0-r0` enquanto o index
oferece `2.10.0-r0`. A migração Buildroot/Alpine-free
trabalha na **mesma [OS #2243](https://github.com/ordaxsystems/ordax-os/pull/2243)**,
que ainda está aberta/conflitante; o diagnóstico de origem
já foi registrado no comentário #6633701970 dessa PR.
**Não** alterar o pin isoladamente, dispensar Creator, editar
a branch #2243 em paralelo, abrir outro workflow, refazer USB
ou promover o artefato antes do gate físico cabível.

**Ordem registrada naquele checkpoint (histórica; não executar como fila atual):** 1) confirmar o avanço
da #2243 com o owner sem invadir a branch; 2) quando o produtor
estiver resolvido, atualizar **somente a PR #2400** com a `main`
contemporânea, preservar 105 testes Node já aprovados e aguardar
checks exigidos; 3) após merge, instalar **o artefato canônico**
no Windows e provar o boot do Device Product, grants próprios,
recibo e revogação; 4) só então conectar consulta autenticada
à Store `CURRENT` no owner OS/Runtime, e depois uma ação
compartilhada pela Aura. A Web [#2413](https://github.com/ordaxsystems/ordax-os/pull/2413)
já foi integrada; não repetir essa missão. Não assumir que
qualquer etapa está concluída só por constar neste handoff.

## Checkpoint operacional e regra de retomada — 2026-11-04

**Este era o ponto de entrada vigente em 04/11/2026; hoje é histórico.**
Para trabalho atual, seguir `AGENTS.md` → `docs/README.md` →
`docs/CURRENT-STATE.md` → owner/código/contrato vigente. Reconsultar
`main`, PRs e Devices antes de agir; conteúdo datado abaixo é
histórico quando divergir do código/contrato atual.
**“Continue” significa avançar a pendência comprovada, não executar
novamente missões antigas nem elaborar outro plano.**

| Frente | Situação comprovada | Ação correta do próximo executor |
| --- | --- | --- |
| Windows físico MCP DEV | [Platform #291](https://github.com/ordaxsystems/ordax-platform/issues/291) **CLOSED** (04/11); ChatGPT → Runtime Windows físico com comandos e recibos de execução; cinco devices DEV obsoletos/credenciais revogados; dois devices atuais preservados. Platform #336 integrada. | **Não** repetir matrícula, limpeza, revogação, instalação ou grants por rotina. Só investigar regressão atual demonstrada |
| Fabric v1 | [OS #2406](https://github.com/ordaxsystems/ordax-os/pull/2406) **merged**; descobre estado Native/ações de app/Aura-Context sem autoridade de execução | Não reconstruir Fabric v1, segundo registry ou duplicar testes/planos |
| Apps first-party | `ordax-apps/main` usa manifests, App SDK, `compatibility` e Actions declarativas; guias das PRs #450/#451/#452 integrados | Evoluir um provider real somente se solicitado, sem exigir 93 tools por app |
| Product Runtime | `ordax-runtime/product_gateway.py` é owner de Product Actions; `capability_snapshot.py` filtra suporte real e limita snapshot a 64; registro `app_intelligence_registry.json` é empacotado/estático, não Store atual | Medir Device real; nunca anunciar 93 tools só pela contagem de código |
| OrdaX Desktop Native | [OS #2400](https://github.com/ordaxsystems/ordax-os/pull/2400) **OPEN**, HEAD `29330e6`: conflitos de merge resolvidos, **105/105 testes Node locais PASS**; PR #2413 Web **merged** na main (`ba701464`), porém o gate legado `build-and-publish` ainda reprova por `apk`/`libexpat` | Preservar a PR #2400; não iniciar segunda ponte nem alegar Device Product pronto. Resolver gate de empacotamento com seu owner antes de integrar; após avançar main, atualizar a mesma PR uma vez com gates apropriados |
| Gateway Conta/Owner | [OS #2405](https://github.com/ordaxsystems/ordax-os/pull/2405) **OPEN**, release público Supabase/Vercel/Worker intencionalmente bloqueado | **Não** integrar para destravar MCP DEV nem ativar flags/deploys sem gates de release |
| Aura ↔ Product MCP | Aura usa `live-verified-app-semantics.mjs` + Store `CURRENT`; Runtime `intelligence.app_catalog/detail` lê registro empacotado uma vez no boot, sem prova de instalação viva | **Próxima implementação útil:** na integração Native Product existente, disponibilizar leitura autenticada de apps/ações atuais **atestadas pelo OS/Store**; Runtime deve consumir sem copiar inventário. Provar instalação → troca/remoção → retirada da capacidade sem restart. Só depois vincular uma Action real ao mesmo executor com autorização/recibos distintos |

**Propagação desta orientação nos demais repositórios (04/11/2026):**
`ordax-platform/AGENTS.md` + `README.md` integrados em
[`8a8eea2`](https://github.com/ordaxsystems/ordax-platform/commit/8a8eea2971492147b28f8c94c247e4d05fb5f282);
`ordax-surface` via
[PR #82](https://github.com/ordaxsystems/ordax-surface/pull/82) integrada.
A [`ordax-apps#455`](https://github.com/ordaxsystems/ordax-apps/pull/455)
foi **integrada** após checks verdes (merge `b9e729a1f734af78da8496aa0737b069f05357ea`).
A [`ordax-runtime#317`](https://github.com/ordaxsystems/ordax-runtime/pull/317)
também foi **integrada** após checks obrigatórios verdes
(merge `85c848130a32c722ee6c3a6f6fec596e7646952c`),
preservando a correção de prontidão MCP
[`#319`](https://github.com/ordaxsystems/ordax-runtime/pull/319).
**Propagação dos handoffs concluída nos cinco repos envolvidos**:
OS, Apps, Runtime, Platform e Surface. **Não abrir nova PR para
propagar essas mesmas instruções, nem reiniciar Windows MCP DEV**.
Naquele checkpoint, a próxima missão registrada era concluir a ponte
Native Product da OS #2400 e depois provar observação autenticada Store
`CURRENT`/Aura/Runtime. A OS #2400 foi posteriormente integrada em
04/11/2026; portanto este trecho **não** autoriza reabrir a ponte nem
define a pendência atual. Owner/Conta OS #2405 permanece uma frente
separada cujo estado deve ser verificado ao vivo antes de qualquer ação.

**Owners imutáveis:** `ordax-os`: Store `CURRENT`, verificador Go,
Native Host, Fabric/Personal/Aura; `ordax-apps`: provider e
manifests de apps removíveis; `ordax-runtime`: Product gateway,
Device agent/adapters e recibo local; `ordax-platform`: OAuth,
Owner, grants/leases e dispatch remoto; `ordax-surface`: somente UI
e apresentações. **Não** implantar API, ferramenta ou arquivo
`fabric.json` de SSOT paralelo.

**Aceite proporcional:** resposta de app instalado depende de
Device/slot/verificação atual; remoção ou falha da Store revoga imediatamente
a visão Product e Aura. Provar token inválido, Device incorreto,
revision/sourceCommit diferente, host indisponível e nenhum
`installed=true` derivado de `activeAppId` visual. Execução
Aura/MCP só pode ser chamada de compartilhada depois de **uma
operação real com um executor**, consentimento local e grant OAuth
separados e recibos/revogação. Nem código de documentação nem CI
isolado demonstram isso.

**Ordem de leitura mínima:** `AGENTS.md` → este checkpoint →
[`docs/CAPABILITY-FABRIC.md`](docs/CAPABILITY-FABRIC.md)
(seção “Ponte Native Product” e “Atestação entre processos”) →
os **arquivos source afetados**, conferindo a `main` e PR
correntes. Se a tarefa for fora de Fabric/MCP/Aura, ignorar este
handoff e seguir somente o owner daquela tarefa.



O Capability Fabric v1 foi integrado à `ordax-os/main` pela
[PR #2406](https://github.com/ordaxsystems/ordax-os/pull/2406). A referência
para **o que já existe, como funciona, o que falta, owners e testes que
realmente estão no remoto** é [`docs/CAPABILITY-FABRIC.md`](docs/CAPABILITY-FABRIC.md),
com status datado em `docs/CURRENT-STATE.md`. O extenso
`docs/plans/CAPABILITY-FABRIC-V1.md` é **histórico**, não uma nova fila.

**Não reiniciar a fase A/B/C:** Native Surface Host, Store `CURRENT`,
Application Actions, Aura e Personal compartilham a projeção de leitura
`ordax.capability-discovery/1` e os guards de revisão/revogação.
`authority=none` e `toolExecution=false` não dão execução MCP.
O proprietário de tools, Device Agent e política local é `ordax-runtime`;
OAuth, grants, leases, Owner e atestação pertencem a `ordax-platform`.
O OS #2400 (ponte Native Product) e OS #2405 (gateway Conta/Owner)
permaneciam abertos na consulta de 04/11. UI real pertence a
`ordax-surface`; não criar outro Fabric, daemon ou registry.

**Prioridade de leitura atual:** `AGENTS.md` → `docs/README.md` →
`docs/CURRENT-STATE.md` → documento canônico do domínio →
código/contratos pertinentes → este handoff somente quando histórico for
necessário. A seguir permanece um **handoff de 13/10** de outras etapas de
Intelligence; suas instruções sobre PRs antigas não são tarefas vigentes por si só.

## Resultado da reconciliação Native/Web — 2026-11-04

**Não repetir estas tarefas já concluídas:** [OS #2413](https://github.com/ordaxsystems/ordax-os/pull/2413)
integrada à `main` (`ba701464a354f7736b5743a6ec8b446e39ab7bb8`),
corrigindo a verificação da Surface externa e atualizando o smoke do
Chromium à UI Web atual. `foundation` e `web-client` aprovaram.
Não restaurar `#meridian-prompt`, janela Aura simulada nem hashes de
Central da época da UI vendorizada. O código de interface continua
pertencendo ao `ordax-surface`.

A [OS #2400](https://github.com/ordaxsystems/ordax-os/pull/2400)
foi reconciliada na **mesma branch**, commit `29330e6b901c311680cc468c93e8e6556cfb03ec`.
Os arquivos MCP foram preservados; **105/105 testes Node
direcionados aprovados** no checkout isolado Windows, que foi removido.
O CI da cabeça anterior à PR #2413 tem `foundation` e
`desktop-dev` verdes, mas **`build-and-publish` falha**
no produtor legado Surface/Linux ao fixar `libexpat=2.9.0-r0`
contra pacote `2.10.0-r0` disponível. Este é outro owner;
não resolver ajustando o hash, alterando Kernel/USB,
duplicando workflows ou escondendo check obrigatório.

**Identidades Device verificadas via OrdaX Product:**
`DESKTOP-4UFL03B` (agente MCP Windows auxiliar) **online**
com grant `full-computer-control`;
`OrdaX Desktop (DESKTOP-4UFL03B)` **offline**, apenas
`mcp-discovery` — sem grant de ação Product.
Não confundir o sucesso do primeiro com homologação do segundo,
nem liberar implicitamente Aura ou Software da Surface.

**Única sequência de retomada:** verificar se o owner do
empacotamento já fechou o gate legado, reconciliar **a mesma
OS #2400** com a `main` quando a dependência estiver resolvida,
aguardar checks pertinentes, integrar sem force; depois validar
bootstrap/sessão/grant do **Device Product** e sua ação real,
antes de oferecer Store `CURRENT` read-only ao Runtime.
PR #2405 de Conta continua release-gated e fora desse caminho.
A evidência causal e os testes estão documentados no
[comentário de continuidade da #2400](https://github.com/ordaxsystems/ordax-os/pull/2400#issuecomment-6639859338).
Nem essa nota nem uma PR Web verde encerram o E2E Aura/MCP.

## SSOT Aura / MCP — retomada pós-Fabric (2026-11-04)

**Não equiparar descoberta a execução.** O Product gateway do
`ordax-runtime` possui **93 Product Actions declaradas no código**,
mas o snapshot `ordax.device-agent-capabilities/1` filtra por
suporte real do Device e impõe limite de 64. Não interpretar os 93 IDs
como tools remotamente atestadas. A Aura local consome metadados
do Capability Fabric e Application Actions; seu motor ainda tem
`toolExecution=false` e **não executa as mesmas tools Product**.

O desenho correto é **SSOT por owner e uma visão comum derivada**,
com uma implementação canônica por ação de domínio, binding tipado
e autorizado para cada cliente (Aura local ou MCP remoto). Consultar a
seção **“SSOT entre Aura, apps e MCP”** em
[`docs/CAPABILITY-FABRIC.md`](docs/CAPABILITY-FABRIC.md)
antes de mudar ações, ferramentas, permissões ou API. A ponte
semântica ↔ executável e E2E autenticado são pendências reais,
não defeitos de catálogo a contornar com outro registry, 93 cópias
de ferramenta ou execução de texto livre.

## Fila única de integração vertical pós-Fabric — 2026-11-04

A próxima IA deve seguir **somente** a seção
[`docs/CAPABILITY-FABRIC.md`](docs/CAPABILITY-FABRIC.md), seção **“Integração vertical Aura ⇄ Product MCP — matriz operacional de implementação”**
para fechar uma ação ponta a ponta, em vez de gerar outro plano,
catálogo Product ou test suite. A matriz identifica os 93 IDs globais
do Runtime versus o limite de 64 no snapshot Device, o significado de
`toolExecution=false` na Aura, os owners, PRs já existentes e as
provas obrigatórias de grant/recibo/revogação. **Não interpretar essa
matriz como execução já implantada.** As notas de 13/10 abaixo são
históricas e só se aplicam quando o owner/contrato atual as confirmar.

## Correção de dependências reais — 2026-11-04

**Verificado no source:**
`ordax-runtime/ordax_dev_agent/application_intelligence_actions.py`
lê um registro de apps **empacotado na inicialização**.
`intelligence.app_catalog`/`intelligence.app_detail` não fornecem
atualmente a mesma observação de instalação/remoção que o OS obtém
de `live-verified-app-semantics.mjs` + Store `CURRENT`.
Para uso como estado vivo Product, a próxima integração deve consumir
o port atestado do OS, read-only, sem criar outro catálogo nem
converter manifests em tools. Ver seção **“Lacuna de SSOT comprovada”**
em [`docs/CAPABILITY-FABRIC.md`](docs/CAPABILITY-FABRIC.md).

**Ordem corrigida:** a [OS #2400](https://github.com/ordaxsystems/ordax-os/pull/2400)
é a ponte Native Product existente; a [OS #2405](https://github.com/ordaxsystems/ordax-os/pull/2405)
é uma PR de Conta/Owner com risco de deploy e **não deve ser integrada
para desbloquear MCP DEV**. A seleção/limpeza DEV de Device está
coordenada na [Platform #291](https://github.com/ordaxsystems/ordax-platform/issues/291).
Evitar nova PR de ponte antes de reconciliar essas entregas.

## Ponte Surface não é catálogo de apps — auditoria 2026-11-04

O código da candidata [OS #2400](https://github.com/ordaxsystems/ordax-os/pull/2400)
só expõe `activeAppId` e `surfaceReady` no relato da Surface,
com ativação limitada a `account/settings/system/store` e recibo de
renderização. **Não** fornece inventário de apps instalados ou a
geração de Application Actions do Native Store `CURRENT`.
O relato tem limite de **512 bytes** e não deve receber manifests
nem ser reaproveitado como registry. A PR ainda não estava integrada
e apresentou conflito de merge com a `main` na revisão.

Para reconciliar Aura e MCP, utilizar a fonte Native existente
`storeCatalogComposition.getCurrentObservations()` +
`liveAppSemantics.withCurrentSnapshot()`, validando identidade,
versão, revisão de Store e `sourceCommit` pelo gate
`current-verified-action-gate.mjs`. O futuro **port de leitura**
precisa de implementação e teste autenticado próprio no mesmo Host,
sem inventar segunda Store, grant ou executor. **Não assumir que
o endpoint já existe.** Especificação/aceite no
[`docs/CAPABILITY-FABRIC.md`](docs/CAPABILITY-FABRIC.md),
subseção **“Ponte Native Product existente”**.

## Limite de confiança do Product — 2026-11-04

Além do estado da PR #2400, a fonte `CURRENT` é conferida
pelo Host Windows via
`verified-component-slot-host.mjs`/`resolve-current` do
verificador Go. A Surface mantém uma projeção transitória
(`verified-store-projection.mjs`); o Runtime não deve aceitar
o `activeAppId` do renderer nem seu token de apresentação
como prova de instalação ou autorização. O futuro port Product
read-only precisa revalidar a identidade do Device, a Store
`CURRENT` e o provider semântico no owner do Host, sem base
duplicada, mesmo quando o app é removido durante um refresh.
Ver **“Atestação entre processos”** no
[`docs/CAPABILITY-FABRIC.md`](docs/CAPABILITY-FABRIC.md).
Esta é **especificação de integração futura**, não endpoint ativo.

## Atualização operacional — 2026-10-13

A integração Native de Intelligence já ultrapassou o antigo estado de “runtime isolado”: `ordax.intelligence/1`, Local AI, model router, Memory autorizada, Assistant/Canvas e consumidores first-party possuem composição real em source. O gap transversal prioritário agora é **transporte/composição Web e integrações externas**, sem transformar a Surface em owner de provider.

A execução corrente está em:

- **#1757 — Intelligence integration closure**: tracking de Web transport, provider adapters, voz/arquivos e prova de release;
- **PR #1756 — canonical Web Intelligence boundary**: primeira fatia, ainda sem provider remoto. A composição Web atual (`Central`/Aura) recebe um client de `ordax.intelligence/1`; a ausência de transporte é representada por adapter Web fail-closed. O contrato público permanece inalterado.
- `docs/plans/INTELLIGENCE-INTEGRATION-CLOSURE-2026-10-13.md`: registro histórico da sequência de integração e invariantes propostas em 13/10; não é plano executável vigente.

**Não interpretar #1756 como IA Web já conectada a um backend.** A fatia cria a boundary correta para que um transporte suportado possa ser composto depois. ChatGPT/OpenAI/xAI, voz, arquivos, egress, credenciais remotas e prova física continuam gates separados.

O antigo caminho WebShell/demo de Intelligence não é a composição Web atual e não deve ser ressuscitado para “fazer a IA funcionar”. Ele só pode ser removido depois que busca de dependências + cobertura de replacement comprovarem que nenhum consumidor ativo depende dele.

## Histórico de 13/10 — não executar como tarefa ativa sem reconciliação

1. Fechar **Phase 1 da #1756** com Intelligence Foundation, App SDK, Surface Web e demais CI canônicos verdes, sem relaxar gates.
2. Só depois iniciar **Phase 2 de #1757**: um adapter de transporte Web/remoto suportado, same-origin/owner-bound, fora da Surface, com contexto explícito e fail-closed.
3. Providers externos permanecem atrás de `ordax.model-router/1` e exigem adapter + egress + consentimento + isolamento de segredo + E2E antes de serem habilitados.
4. Voz/arquivo só entram quando os respectivos owners de mídia/arquivo e grants reais existirem; placeholders visuais não contam como integração.
5. Limpeza de demo/duplicação é posterior à prova de substituição; não apagar por nome ou idade.

A experiência adaptativa/Jarvis de #1572 continua relevante como UX/resultado, mas não deve voltar a ser tratada como ausência total de fundação: Work/Activity/Result, Canvas e fluxo foreground já tiveram implementação posterior. Revalidar a issue e a `main` em vez de reexecutar suas fases antigas mecanicamente.

## Leitura obrigatória

1. `AGENTS.md`, `docs/README.md`, `docs/contracts/repository-ownership.json` e `docs/CURRENT-STATE.md` — autoridade e estado atual.
2. `docs/INTELLIGENCE.md`, `docs/contracts/intelligence.json`, `system/services/intelligence/` — Intelligence, model router e limites de inferência.
3. `docs/APPLICATION-INTELLIGENCE.md`, `docs/APP-INTELLIGENCE-MANIFEST.md`, `docs/APPLICATION-ACTIONS.md` — catálogo semântico, intents, provedores de ações.
4. `PERSONAL-ORDAX.md` e `docs/PERSONAL-ORDAX.md` — Work, Activity, Result, approvals, grants e receipts.
5. `docs/plans/INTELLIGENCE-INTEGRATION-CLOSURE-2026-10-13.md` e issue #1757 — fechamento da integração corrente.
6. [Apps: Studio + ChatGPT em três superfícies](https://github.com/ordaxsystems/ordax-apps/blob/main/docs/STUDIO-CHATGPT-THREE-SURFACES.md), [Studio Web](https://github.com/ordaxsystems/ordax-apps/blob/main/docs/STUDIO-WEB-INTEGRATION.md).
7. [Platform: providers](https://github.com/ordaxsystems/ordax-platform/blob/main/docs/ORDAX_PROVIDER_CONNECTORS.md), [Product MCP](https://github.com/ordaxsystems/ordax-platform/blob/main/docs/PRODUCT_MCP_CONNECT.md), [Runtime: bridge experimental](https://github.com/ordaxsystems/ordax-runtime/pull/63).

## Decisão do produto

**OrdaX Intelligence pertence ao sistema, não ao Studio.** O OS/Web, Studio e os demais aplicativos são CLIENTES da mesma camada `ordax.intelligence/1`. O painel do OrdaX Web deve oferecer conversa contextual, seleção/estado de provedor e ações autorizadas sem uma segunda implementação de IA. Identidade visual e componentes podem ser adaptados por ambiente, mas não autoridade, Memory ou router.

**Modelo híbrido e neutro a provedores:** IA local (baseline offline); APIs remotas autorizadas com egress consentido; ChatGPT externo com plugin MCP; ChatGPT Web como possível fonte da UI nativa **somente quando existir um canal autorizado e comprovado**. A preferência do usuário por conectar ChatGPT/plugin não prova uma API de inferência para a Surface nem autoriza automação de chatgpt.com.

**Aplicativos como capacidades nativas:** a IA compreende apps pelo registro verificado e `ai/manifest.json`, resolve intenção/parameters de maneira limitada, consulta capabilities reais e solicita o binding apropriado. Leitura de tela/mouse é fallback para integrações sem contrato apropriado, sujeito às mesmas políticas; nunca é autoridade irrestrita.

## Dois fluxos diferentes — não confundir

**A. Chat OrdaX → modelo:** usuário digita no OrdaX Web/OS/Studio → UI/client tipado → `ordax.intelligence/1` e router → modelo local ou provider explicitamente disponível/autorizado → eventos/resultado na UI. Plugin MCP instalado no ChatGPT **não fornece automaticamente uma API para que o painel OrdaX envie mensagens ao chatgpt.com**. Bridge ChatGPT Web via browser, cookies, DOM ou infraestrutura não oficial continua experimental; não ativar em produção sem canal permitido e E2E.

**B. ChatGPT externo → ações OrdaX:** usuário no cliente ChatGPT compatível conecta e autoriza `ordax-chatgpt` → Platform Product MCP/OAuth/grants → destino Runtime/OS selecionado e autorizado → ação canônica → receipt/status. Pode funcionar sem Studio aberto; depende de plugin, credenciais OrdaX, device real, target e grants. Conta ChatGPT ≠ Conta OrdaX. O fluxo B é independente da inferência do fluxo A.

```text
OS Web / OS Native / Studio / apps (clientes)
     -> OrdaX Intelligence + Model Router (OS)
         -> modelo local / adapter remoto autorizado
         -> catálogo semântico / ação proposta (authority=none)
              -> Action Catalog + approval/grants + Action Gateway
              -> Runtime/adapter autorizado -> receipt + Activity

ChatGPT externo -> plugin MCP Platform -> grants + target -> Runtime/OS
        (fluxo B independente; catálogo/autoridade existentes, sem duplicação)
```

## Ownership (SSOT)

| Responsabilidade | Repositório |
| --- | --- |
| OrdaX Intelligence, model router, Memory/autorização de contexto, app semantics/action contracts, Surface Web/OS | `ordaxsystems/ordax-os` |
| Studio e demais UIs first-party e seus manifests | `ordaxsystems/ordax-apps` |
| Host/dispositivo Windows, política local, execução, bridge experimental de provider | `ordaxsystems/ordax-runtime` |
| `ordax-chatgpt`, MCP, OAuth, grants remotos, fila/audit e provider connectors | `ordaxsystems/ordax-platform` |
| Experiência visual Lovable (não backend) | `washingtonmsdj/account-hub-pro` |

“Plugin conectado à raiz do OrdaX” significa **serviço e autoridade disponíveis ao ecossistema**, não transferir a fonte do plugin para `ordax-os`. Não renomear ID, URLs, OAuth scopes ou migrations sem plano de compatibilidade e testes.

## Estado observado — 2026-10-13

- Intelligence consultativo mantém `authority=none` e `toolExecution=false`; modelo não recebe autoridade por prompt, Memory, manifest ou escolha de provedor.
- Local model router existe e a rota local é a única rota de inferência habilitada no OS; providers externos continuam fail-closed.
- Memory autorizada e consumidores Native reais existem; source/CI não equivalem a prova física Stable.
- A Web atual monta `Central`, não o WebShell antigo. Antes da #1756, Aura só apresentava indisponibilidade; #1756 introduz o client/adapter boundary canônico sem ligar provider remoto.
- Surface Web não deve armazenar credenciais, escolher endpoint de provider, possuir Memory policy ou importar adapter Native.
- Product MCP/plugin e provider connectors têm owners fora da Surface; source, testes, implantação, consentimento, plugin instalado, target online, execução real e publicação são gates distintos.

## Sequência de implementação segura

1. Revalidar `main`, PRs abertas e owners antes de cada fatia; não reutilizar branch antiga por conveniência.
2. Manter `ordax.intelligence/1` como API sistêmica estável; comportamento específico de Web fica em adapter/composition, não no contrato público.
3. Compor transporte real fora da UI: endpoint/host/auth/contexto/egress pertencem ao owner confiável; Surface recebe port/client já autorizado.
4. Manter providers atrás do router. Credenciais nunca entram em bundle Web, prompt, Memory ou logs.
5. Para apps first-party: manifesto verificado → roteamento semântico → binding real → proposta `authority=none` → approval/grant → executor → receipt/Activity.
6. Validar mudanças de owner/Space/projeto, logout, offline, revogação, resposta tardia, cancelamento, streaming e ACK incerto sem retarget ou replay silencioso.
7. Remover código legado somente quando a substituição está coberta; não manter dois caminhos ativos nem apagar evidência histórica tratada como documentação.
8. Separar explicitamente provas de source/CI, deploy, E2E credentialled e físico Stable/MVP.

## Lovable / UI

A interface do OrdaX Intelligence é um cliente global reutilizável, com conversa, status de modelo/provider quando factual, contexto autorizado, Activity e resultados. No `washingtonmsdj/account-hub-pro` isso é **prototipação visual** até os adapters públicos existirem. Não usar iframe automático de ChatGPT, login espelhado, ferramentas falsas que retornam sucesso, backend paralelo ou dados reais fabricados.

## Critérios de aceite

- Um só owner de Intelligence e um só model router; apps/OS/Web/Studio reutilizam contratos existentes.
- Surface não possui provider, credencial, Memory ou autoridade.
- Fluxos A e B testados independentemente, sem prometer assinatura Web do ChatGPT como backend sem canal autorizado.
- Actions só após autorização real, escopo explícito, resultado rastreável e revogação.
- Ausência de transporte/provider permanece indisponibilidade honesta, não mock de sucesso.
- Provas separadas para código, CI, release, deploy, conta/plugin/device conectados e E2E.
- Cleanup deixa um caminho corrente, sem duplicação ativa e sem remover owners ainda necessários.

Este arquivo é ponto de retomada; **não** é permissão para reimplementar o stack.
