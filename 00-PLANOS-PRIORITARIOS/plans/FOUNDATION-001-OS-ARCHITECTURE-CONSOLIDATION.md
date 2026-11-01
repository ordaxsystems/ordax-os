# FOUNDATION-001 — Auditoria e consolidação da fundação do OrdaX OS

- **Tipo:** PLAN / MVP FOUNDATION / CROSS-AGENT HANDOFF
- **Status documental:** REFERENCE — roteiro/handoff de auditoria e consolidação, alinhado ao `REGISTRY.md`; não é fila paralela de implementação.
- **Elegibilidade de execução:** EXECUTION-ELIGIBLE **somente** para defeitos reais, limpeza e integração exigidos pelos owners atuais do Desktop Windows/Web. USB/Creator/Buildroot/Native físico ficam DEFERRED até nova janela e autorização explícita; o plano não autoriza publicação ou escrita física.
- **Prioridade:** P0 para integridade/SSOT, remoção de legado comprovado, contratos e Desktop Windows instalado; P1 para eficiência de integração/CI; USB/Native físico conforme janela posterior do `ROADMAP.md`.
- **Criado:** 2026-10-23; **diretriz vigente revisada:** 2026-11-01.
- **Owner de execução:** `ordaxsystems/ordax-os` (consolidação transversal; NÃO se torna dono dos demais repositórios).
- **Autoridades reais:** `AGENTS.md`, `docs/README.md`, `docs/CURRENT-STATE.md`, `MVP.md`, `docs/ARCHITECTURE.md`, `docs/PROMOTION-GATES.md`, `docs/DECISIONS.md`, `docs/contracts/repository-ownership.json`, contratos de boot/storage/atualização e respectivos arquivos-fonte.
- **Planejamento:** `00-PLANOS-PRIORITARIOS/ROADMAP.md` e `REGISTRY.md`; `NATIVE-001` continua proprietário do plano de instalação whole-disk, sem duplicação.
- **Base da fotografia inicial (não pin permanente):** OS `eff13564d93ca729cd39b259bc2e41246e4f7928`; Apps `cba14ff9eb742cc462c2dca66d0edc78d792f5fc` após PR #330; Runtime `9154cb977bbad9f007e7734ebfbeeb4997e7db57`; Platform `3ae5d914df03f8f6a677ddd18cf3337cd0bcb89a`. Revalidar antes de executar.

> **Handoff independente de conversa:** este é o roteiro persistente de execução; NÃO é novo SSOT de arquitetura, versões, bugs, grants, estado físico ou releases. Nunca presumir que o snapshot abaixo permanece atual. Nenhuma tarefa pode ser marcada concluída por edição, teste isolado ou PR aberta; exigir evidência no owner correto.


## Diretriz vigente — 2026-11-01: remoção de pendências, zero legado artificial, Windows-first

**Precedência:** `ROADMAP.md`, `REGISTRY.md`, `docs/CURRENT-STATE.md` e os contratos atuais vencem fotografias históricas abaixo. Este programa atualiza o handoff de consolidação, **não** cria outro SSOT, outro backlog ou uma nova autorização de release. A pesquisa pública comparou AOSP, GNOME, Linux/Buildroot, VS Code, Element, Bitwarden, discussões Reddit/Hacker News, Electron e práticas SLSA: a fronteira útil é ownership + contrato + build + release, não quantidade de repositórios.

**Condição de desenvolvimento:** ainda não há uma base pública de usuários a sustentar retrocompatibilidade artificial de APIs internas. Portanto, **preferir corte limpo**: alterar consumidores, contratos e testes e **remover o caminho antigo na mesma migração validada**, sem aliases, wrappers duplicados, flags eternas, cópias de código, mocks permanentes ou fallback silencioso. Isso **não** dispensa preservar dados de desenvolvimento existentes, proveniência Git, releases assinadas já consumidas, trust, consentimento, known-good, rollback e recovery. Não reescrever a `main` nem modificar um protocolo assinado antigo sem migração explícita; segurança não é legado descartável.

### Regras inegociáveis para o agente que remove pendências

- [ ] **Prova antes de exclusão:** para cada arquivo/caminho candidato, registrar owner, propósito, imports/callers, CLI, instalador, CI, testes, contratos, source locks, release, recovery, docs e consumo cross-repo; classificar `KEEP / MOVE / REPLACE-AND-DELETE / DELETE / GENERATED / HISTORICAL / DEFER`. Ausência em busca textual isolada não é prova suficiente.
- [ ] **Sem coexistência permanente:** uma implementação por responsabilidade. Uma ponte temporária só pode existir durante um cutover delimitado, com owner, teste, condição objetiva e PR de remoção vinculada; não encerrar a migração deixando o shim como solução final. Não deixar diretórios `old`, `legacy`, `v2-final` ou cópias paralelas ativas.
- [ ] **Sem compatibilidade fictícia:** quebrar APIs internas ainda não publicadas é aceitável quando todos os consumidores são migrados atomicamente e os testes passam; manter contratos publicados/assinados ou estados persistidos **apenas** enquanto houver consumidor real e política canônica. Nunca falsificar PASS, remover testes para fazê-los passar, reduzir gates, desligar assinatura, usar `try/catch` para esconder erro ou trocar integração real por mock.
- [ ] **Sem novo produto por organização:** não criar outro OS, Runtime, Identity, Memory, Store, updater, Creator, motor de IA, release publisher, serviço MCP ou base de dados. Não confundir código-fonte duplicado com assets gerados/staged verificados, adapters legítimos, contracts publicados ou artefatos de distribuição.
- [ ] **Remoção completa por change set:** eliminar código, imports, rotas, exports, scripts, dependências, workflows, fixtures obsoletas, documentação ativa e referências ao caminho antigo; incluir feature flags de migração encerrada, ramos mortos, código comentado como reserva e TODOs que apenas prometem restaurar legado. Manter somente evidência histórica em `docs/evidence/`/Git e links necessários à proveniência. Adicionar teste negativo que falhe se o legado voltar.
- [ ] **PRs pequenas e coordenadas:** uma fronteira por owner, sem PRs concorrentes nos mesmos arquivos; comparar SHA da `main` antes de editar, preservar histórico com merge commit, medir regressões e atualizar contrato, CI e `docs/CURRENT-STATE.md` na mesma entrega quando o estado factual mudar.
- [ ] **Segurança e dados continuam fail-closed:** nunca apagar dados de usuário/Owner/Dev ou known-good automaticamente, nem abrir acesso a filesystem/terminal/GUI por conveniência; nada de credenciais em source, ações destrutivas, publicação Stable ou escrita física sem autorização própria. O rollback de uma refatoração deve restaurar commit/artefato íntegro e validado, **não** manter a implementação antiga escondida no binário novo.

### P0-A — inventário real e fronteiras dos oito repositórios (primeiro gate)

- [ ] Revalidar SHA/branch, PRs abertas, jobs obrigatórios, source locks, manifests e entrypoints em **todos os oito** repositórios: `ordax-os`, `ordax-surface`, `ordax-apps`, `ordax-runtime`, `ordax-platform`, `ordax-intelligence`, `ordax-creator` e `ordax-site`.
- [ ] Construir matriz `owner → responsabilidade → consumidores → contrato → artefato → release → testes → status`. Gerar grafo de dependências/imports, detectar ciclos, consumo de `main` flutuante, caminhos relativos entre checkouts, clones/copias versionadas e código morto comprovado. Inventariar também feature flags, endpoints não chamados e workflows abandonados; preferir automação de inventário existente ou relatório simples, sem criar framework de auditoria permanente.
- [ ] Reconciliar `docs/contracts/repository-ownership.json` com os oito owners, `repository-migration-status.json`, `module-boundaries.json` e docs dos repos. Quando houver `CODEOWNERS`, verificar alinhamento como mecanismo de revisão (não como segunda autoridade). **Achado conhecido:** o ownership atual ainda atribui `intelligence` ao OS e não cadastra `ordax-intelligence`; distinguir engine portátil de autorização/Memory/Supervisor/composição retidos no OS.
- [ ] Auditar SSOT visual `ordax-surface` versus `ordax-os/system/surface` (host, não UI); `ordax-apps` versus `system/apps` (apps removíveis versus Store/Settings/Account/System estruturais); `ordax-creator` versus `tools/creator` (app/core versus provas, payload e assinatura do OS); `ordax-site` versus gateways OS. Não apagar adapters legítimos por nomes parecidos.
- [ ] Registrar cada defeito **com caminho, evidência, owner, consumidor, teste que falha, correção mínima, remoção esperada e PR existente**; não marcar hipóteses como bugs nem criar documento paralelo ao owner.

**Aceite P0-A:** inventário verificável sem ownership ambíguo, fila deduplicada por owner e zero tarefa de exclusão sem prova.

**Revalidação parcial de P0-A (2026-11-01, sem promoção):** os oito
repositórios foram consultados por suas branches `main` no GitHub.
O contrato atual descreve sete autoridades operacionais; o oitavo
(`ordax-intelligence`) é proprietário somente da fonte candidata,
identificada pelo lock `docs/contracts/intelligence-source.json`.
A fronteira foi documentada no owner `docs/REPOSITORY-OWNERSHIP.md`
e recebeu regressão em `tests/test_repository_ownership_contract.py`.
Oito repos existentes **não significam** oito runtime owners ativos:
não alterar `cutover_complete`, nem remover motor OS antes do gate P0-B.
Inventário de consumidores, ciclos, flags e artefatos, além das provas
Windows, continua aberto. Nenhuma etapa P0-A é marcada completa
somente por esta correção documental/contratual.


### P0-B — cutover de Intelligence sem código antigo (Windows primeiro)

- [ ] Confirmar o `docs/contracts/intelligence-source.json` vigente, os oito blobs fixados, o `integration-candidate` e `cutover_complete=false`; verificar o estado atual no repo Intelligence antes de assumir que a migração terminou.
- [ ] Separar motor portátil (`intelligence/runtime`, `model-router`, `local-ai/runtime`, streaming, compatibilidade e builder técnico) dos owners OS de `native-service`, `authorized-memory`, `client-actions`, `tool-grants`, Supervisor, modelos/locks, permissões, assinatura e distribuição.
- [ ] Substituir consumidores da implementação OS por portas `ordax.intelligence/1`, `ordax.model-router/1` e `ordax.local-ai/1` e por artefatos/source fixados, sem import privado cross-repo; validar composição e inferência reais na plataforma **Windows prioritária**. Linux/Buildroot/QEMU só na janela autorizada.
- [ ] Cobrir buffered/SSE, timeout, cancelamento, ausência de modelo, rejeição de `tool_calls`/ações não autorizadas, permissões, restart, modelo incompatível, falha do motor e recuperação; registrar limites de CPU/RAM quando testados de fato.
- [ ] **Após gate real de cutover**, apagar as implementações OS substituídas, builder duplicado e referências antigas; bloquear sua reintrodução no CI. Não deixar implementação velha como fallback “temporário” indefinido; não marcar `cutover_complete=true` antes das provas.
- [ ] Atualizar ownership, source lock, docs e receipts **na mesma PR/coordenação**; não copiar contratos OS para Intelligence nem criar segunda autoridade de Memory/Identity.

**Aceite P0-B:** um motor canônico, nenhum import do legado, contratos/testes de consumidor verdes, Desktop real funcional, falha fechada, rollback verificável e status canônico fiel.

### P0-C — identidade, Platform e Runtime: uma autoridade por operação

- [ ] Mapear emissão, renovação, validação, revogação e persistência de sessões; OAuth remoto, grants e filas em `ordax-platform`; gateway, sessão e aplicação de política local no `ordax-os`. Auditar concretamente `services/product-oauth`, `services/public-identity`, `services/product-gateway` e `services/product-mcp` **antes** de mover ou remover qualquer um.
- [ ] Eliminar apenas implementações remotas duplicadas **comprovadas**; não remover gateway/adapters necessários, nem criar outra autoridade de login, política, permissões, sessão ou banco no Desktop, Apps ou Site.
- [ ] Verificar `ordax-runtime` como owner único de host/device agent, computer-control e MCP local Windows; Desktop integra por API/IPC tipada e grants existentes, sem segundo dispatcher, executor, terminal genérico ou agente auxiliar disfarçado.
- [ ] Testar sessão expirada, revogada, offline, reconnect, troca de Space, isolamento de device, privilégio mínimo e negativa de ações não autorizadas; preservar a distinção entre Conta, Space, Device e Profile Pack.
- [ ] Remover rotas, bridges, flags e serviços de transição obsoletos **no mesmo corte validado** e atualizar os contratos/consumidores em cada repo owner.

**Aceite P0-C:** uma autoridade remota, enforcement local claro, zero rota paralela de concessão e regressões de autenticação/permissão verificadas.

### P0-D — composição de versões/release: usar owners existentes, não inventar outro manifest

- [ ] Inventariar `docs/contracts/release-protocol.json`, `release-channel.json`, `component-update-compatibility.json`, `surface-source.json`, `intelligence-source.json`, contratos de Apps/Runtime, `tools/release-manifest` e recibos de build Desktop; **já existe protocolo de release**, logo não criar `ordax-release-manifest` separado automaticamente.
- [ ] Determinar se o registro canônico de **composição do produto** já fixa SHA/tag/versão, hash, API major, provenance e artefatos efetivos de OS, Surface, Apps, Runtime, Intelligence e Desktop, além do contrato Platform API. Se faltar informação, **estender o owner correto** ou propor ADR de um lock de integração pequeno, sem duplicar o manifest assinado ou mudar semântica `release-manifest/1`. **Não usar SHAs, versões, nomes de artefatos ou APIs ilustrativos dos relatórios de pesquisa como valores reais**; qualquer entrada deve ser obtida do source/artefato verificável.
- [ ] Impedir que build/release use HEAD/`main` flutuante de outro repo, checkout vizinho, asset “latest” não verificado ou download sem hash. Resolver um conjunto exato, reproduzir em CI e comparar recibo do instalador com o conjunto consumido.
- [ ] Versionar portas e mudanças incompatíveis, testar produtor/consumidor antes do merge; distinguir versão do produto, versão do componente, versão do contrato e commit Git. Release Windows, Web e USB têm artefatos próprios, sem bifurcar política do produto.
- [ ] Para atualização: `download → verify → stage → health → promote / rollback`, known-good, interrupções e recuperação. Assinatura/trust de Stable continuam gates separados de DEV e não podem ser contornados.

**Aceite P0-D:** uma composição reconstituível por SHAs/hashes, contrato compatível, recibos verificáveis e nenhum segundo publisher/SSOT.

### P0-E — Desktop Windows instalado: produto real antes de repositório novo

- [ ] Auditar `tools/windows-desktop`, Electron/NSIS, bundle Native, pin da Surface, Runtime distribuído, instalador, atualização e evidências reais; **não** inferir que CI verde significa produto instalado pronto.
- [ ] Executar E2E em Windows físico instalado: instalação limpa → primeira abertura → login/Conta → criar/selecionar Space → Store/Apps → Files → Aura/Intelligence → Runtime/MCP permitido → fechar/reabrir/reiniciar → offline/reconnect → update e rollback; registrar SHA OS/Surface/Runtime/Intelligence, hashes, versão, logs e falhas.
- [ ] Segurança Electron: `contextIsolation`, sandbox, `nodeIntegration` desativado no renderer não confiável, preload com allowlist, IPC tipada, validação de origem/parâmetros, CSP/navegação, acesso a arquivos mediado e testes de tentativa de escalada. Não expor token, shell ou APIs Windows genéricas à Surface.
- [ ] Garantir que o Desktop não mantenha segunda UI, segundo catálogo de Apps, segunda sessão, segundo motor IA, segundo updater ou política divergente; diferenciar host Windows de Surface visual e Runtime de dispositivo.
- [ ] Corrigir causas reais e remover caminhos/fallbacks de DEV obsoletos após substituição testada; manter mecanismos de recovery e diagnóstico necessários, sem esconder falhas com retries infinitos.

**Aceite P0-E:** E2E instalado reproduzível com evidência de Windows real, atualização/rollback íntegros e nenhuma implementação concorrente.

### P1-A — CI por impacto, contratos, supply chain e exclusão comprovada

- [ ] Estabelecer grafo de impacto por componente: alteração visual não recompila kernel/Buildroot; alteração de contrato aciona consumidores; jobs essenciais de validação não desaparecem por `paths`. Reutilizar `docs/contracts/build-autonomy.json`, `ci-supply-chain.json` e workflows atuais; um `plan` sempre executável pode controlar o fan-out.
- [ ] Exigir lint/typecheck, testes unitários, contratos cruzados, integração de artefatos fixados, smoke de Desktop instalado quando afetado e testes negativos que detectem imports/paths legados; nunca tornar teste “verde” pulando o caminho relevante.
- [ ] Fixar actions/dependências/ambientes por SHA/digest, gerar hashes e SBOM, attestations/provenance para artefatos de entrega, separar permissões de build, assinatura e publicação, e auditar secrets, licenças e dependências vulneráveis.
- [ ] Eliminar workflows duplicados, scripts não chamados, geradores antigos, dependências e lockfiles sem consumidores, assets rastreados indevidamente e documentação ativa contraditória **com teste de ausência e rollback**. Artefatos gerados intencionalmente e evidências históricas não são source duplicado.
- [ ] Medir p50/p95 de CI, builds por impacto, taxa de PRs cross-repo, regressões de contrato, tempo de recuperação, falhas de instalação/update e taxa de releases reconstruíveis; comparar antes/depois. Metas de encerramento: **zero implementações concorrentes da mesma autoridade, zero imports para caminhos removidos, zero flags de migração concluída, zero dependência de branch/path cross-repo mutável, zero rebuild de kernel causado só por Surface**, e **100% dos artefatos efetivamente promovidos** vinculados ao source SHA, hash e evidência de verificação. Não declarar 100% de E2E físico sem execução real.

**Aceite P1-A:** builds por impacto corretos, provenance verificável, falhas de contrato detectadas antes do merge e resíduos antigos não reaparecem.

### P1-B — decisão fundamentada sobre novos repositórios (não extrair por estética)

| Candidato | Decisão nesta janela | Gate para reconsiderar |
| --- | --- | --- |
| `ordax-desktop` | **NÃO criar ainda**; auditar host Windows no OS | Pelo menos 4 de 6 evidências: release independente, owner distinto, build independente, packaging/assinatura/updater próprios, Surface consumida por contrato/artefato, maioria das mudanças sem PR simultânea na Surface. Registrar ADR e custo da migração. |
| `ordax-kernel` | **NÃO** | Fork/patchset relevante, maintainer e ciclo de CVEs/backports próprio; caso contrário usar upstream pinado + configuração/patches no OS. |
| `ordax-drivers`/`ordax-firmware` | **NÃO** | Hardware/BSP com releases e owner independentes; preferir pacotes/layers/`br2-external` quando apropriado. |
| `ordax-updater` | **NÃO** | Produto reutilizável com protocolo/trust root e release realmente independentes; nunca dois mecanismos de promoção. |
| `ordax-contracts`/`ordax-ci` | **NÃO por padrão** | Múltiplos consumidores independentes ou duplicação de workflows mensurada; preferir contratos do provider e reusable workflows existentes. |
| `ordax-release-manifest` | **NÃO por padrão** | Só ADR após provar que os owners atuais de release/locks não comportam composição verificável; evitar segundo manifest/assinador. |

Se o Desktop for essencialmente um wrapper em lock-step com a Surface, **repo separado pode piorar** coordenação; se for host Windows com release/assinatura independentes, pode valer a pena. Não mover host privilegiado para `ordax-surface` sem revisar `repository-ownership.json`, `module-boundaries.json` e segurança. A extração aprovada exige preservar histórico, migrar CI/packaging, testes de IPC, instalação, upgrade, rollback, source locks e exclusão do caminho antigo **no corte final**.

### P2 — Kernel, Base, USB/Creator e Native físico: preservar arquitetura, adiar execução

- [ ] Manter Kernel Linux, boot, initramfs, Buildroot/Base, Supervisor, recovery e updater estrutural sob owners `ordax-os`, com upstream pinado, patches/configuração versionados, builds por artefato e sem fork/repo novo por estética.
- [ ] Quando a janela física abrir, reconciliar `ordax-creator` (aplicação/Core) com `ordax-os/tools/creator` (provas/payload/assinatura) e contratos de geometria distintos; eliminar duplicação comprovada sem apagar produtores legítimos.
- [ ] Não iniciar agora builds caros de kernel/Buildroot, USB/QEMU, publicação de mídia ou testes físicos para satisfazer um plano documental; usar `NATIVE-001`, owners e gates atuais quando autorizado.
- [ ] Em eventual corte de Base/Alpine, provar ABI, PID1, recovery, health, update e boot real no perfil-alvo antes de apagar a implementação anterior; depois remover todo legado de execução sem compatibilidade eterna.

### Ordem de entrega, critérios de encerramento e handoff

1. **Gate 0 — baseline:** inventário e métricas, PRs existentes, source locks e defeitos comprovados; nenhuma mudança cega.
2. **Gate 1 — ownership:** oito repos reconciliados, imports proibidos bloqueados, contratos e documentação canônica alinhados.
3. **Gate 2 — cutovers:** Intelligence e identidade/Platform sem duas implementações; cada PR termina com exclusão do legado e teste negativo.
4. **Gate 3 — integração:** composição exata de artefatos/contratos e Desktop Windows instalado E2E, incluindo update/recovery.
5. **Gate 4 — qualidade:** CI por impacto, supply chain, métricas e revisão de resíduos; reavaliar `ordax-desktop` com evidência.
6. **Gate 5 — futuro:** só depois da janela Windows-first, retomar USB/Creator/Buildroot/Native com autorização própria.

**Definição de DONE por pendência:** owner correto; mudança na `main` após merge; implementação substituta exercitada por consumidor real; **implementação obsoleta e seus imports/scripts/tests/docs ativos removidos**; nenhum alias/fallback permanente; testes positivos, negativos e cross-repo verdes; release/rollback/segurança preservados; recibo com SHA/CI/evidência; `docs/CURRENT-STATE.md` e contrato atualizados quando cabível. Caso falte qualquer item, marcar `BLOCKED`/`NOT-PROVEN` com causa objetiva, não `DONE`.

**Fontes de comparação (referência, não autoridade OrdaX):** [AOSP source/manifest](https://source.android.com/docs/setup/download/source-control-tools), [GNOME build-meta](https://gnome.pages.gitlab.gnome.org/gnome-build-meta/docs/index.html), [Buildroot br2-external](https://buildroot.org/downloads/manual/manual.html), [VS Code source organization](https://github.com/microsoft/vscode/wiki/source-code-organization), [Element monorepo](https://github.com/element-hq/element-web/blob/develop/docs/monorepo.md), [Bitwarden clients](https://github.com/bitwarden/clients), [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security), [SLSA](https://slsa.dev/) e [Reddit ExperiencedDevs — mono vs multi](https://www.reddit.com/r/ExperiencedDevs/comments/ywbw0a).


## Problema e resultado esperado

Consolidar a fundação do OrdaX OS sem criar subsistemas paralelos, retrocompatibilidade artificial ou reestruturação simultânea incontrolável. **Ordem vigente:** (1) ownership e dependências entre os oito repositórios, (2) limpeza/cutover de Intelligence e autoridade de identidade/Platform, (3) composição de release e contratos versionados, (4) Desktop Windows instalado e testes de integração, (5) CI por impacto, segurança e eliminação de resíduos. **Boot/USB/Creator/Buildroot/Native físico são trabalho posterior**, salvo defeito concreto que bloqueie a janela atual. Auditar antes, corrigir por owner, provar o substituto e remover o antigo no mesmo fechamento; não deixar duas implementações permanentes.

Pronto significa: layout reproduzível, cold boot previsível, Surface e sessão saudáveis, atualização determinística com known-good/rollback, shutdown limitado, recuperação diagnóstica, source/CI/documentação alinhados; evidência física separada de testes de CI.

## Não objetivos e restrições

- Não implementar funcionalidades secundárias, polimento visual, novos apps, novo atualizador, outro supervisor, outro Creator, novos bancos/catálogos de estado nem novos frameworks por conveniência.
- Não substituir fontes de verdade: `docs/contracts/*`, manifests, código e owners permanecem superiores a este plano.
- Não promover Stable, autorizar release, gravar USB, escrever SSD/NVMe/HDD ou desabilitar integridade/consentimento por este plano.
- Não apagar recovery, rollback/known-good, logs, referências históricas necessárias ou artefatos ativos sem comprovar consumidores e substituição; eliminar legado com prova de ausência de referências.
- Não declarar dependência Alpine removida ou portabilidade de Runtime concluída porque PR/CI passaram; exigir provas reais no perfil-alvo.
- Não mudar `main` por force/squash/rebase que rompa a ancestralidade consumida por USB Owner/Dev. Preferir **merge commit**, conforme `AGENTS.md`.

## Fotografia de evidências — 2026-10-23 (revalidar)

| Evidência | Status na fotografia | Fonte/limite |
| --- | --- | --- |
| Quatro repositórios examinados neste snapshot histórico (não é inventário atual) | Confirmados naquela fotografia | A revisão de 2026-11-01 considera oito repositórios; o contrato `repository-ownership.json` ainda precisa ser reconciliado com `ordax-intelligence` |
| Estrutura `ordax-os` | Inspeção inicial, NÃO auditoria exaustiva | Árvore Git com ~3.480 entradas; `boot/`, `bootstrap/`, `system/`, `tools/creator/`, `docs/contracts/` |
| Desenvolvimento Git-first | Implementação existente | `bootstrap/dev-base/ordax-pull`, `system/supervisor`, `docs/contracts/distribution-profiles.json`; não comprovado neste snapshot no USB físico |
| Stable/MVP signed | Contrato e componentes existentes, promoção física não provada aqui | `bootstrap/release-acquisition/`, `docs/PROMOTION-GATES.md` |
| USB Dev preparado | Layout **transitório** de 3 partições | `docs/contracts/physical-prepared-media.json`: ESP FAT32, ORDAX ext4, DATA exFAT |
| Portable MVP final | Alvo de 2 partições; escrita física ainda gated | `docs/contracts/portable-usb-v2.json`: ESP FAT32 + DATA exFAT; EROFS e imagem ext4 interna |
| Base independente | Migração incompleta | PR #1860 (draft na fotografia), checar CI, ABI, inicialização e consumidores antes de remover Alpine |
| Desenvolvimento transacional | **Código integrado na main@85ac5fe8** | PR #2161 mesclada por merge commit, 11 workflows da PR aprovados (Creator offline QEMU + Portable QEMU + Foundation + Preflight). `ordax-pull`, helper Native `RENAME_EXCHANGE`, ABI e Supervisor no mesmo SSOT; **Base do notebook ainda NOT-PROVEN** |
| Diagnóstico de boot/power | **Código integrado** | PR #2169 (`8bdea25a`) e #2168 (`cf38cfa2`) mescladas após QEMU/Creator; confirmação física de ext4/UEFI/boot continua separada |
| Superfícies estruturais | PR concorrente | PR #2177; na fotografia `web-client` falhou, rever checks atuais |
| Creator / geometria QEMU | PRs concorrentes | PRs #2167 e #2000; não duplicar inventário de artefatos |
| Testes locais de atualização | 28 testes Node passaram na fotografia | Testes de contrato, status e UX; NÃO são boot/rollback físico |
| Apps ownership documental | PR #330 integrada na `ordax-apps/main` | Correção de fonte documental, não do boot |
| USB físico | NÃO inspecionado/atualizado | Desktop Commander viu apenas SATA interno no desktop; mídia OrdaX ausente durante a verificação |

**Dívida/risco em investigação, não remoção já autorizada:** antigos entrypoints da Base/ESP, política de transição `legacy-tree`, fontes `system/apps` removíveis, documentação histórica, projeções geradas do SDK, scripts e gates de CI possivelmente sobrepostos. Antes de eliminar qualquer arquivo, produzir grafo de referências (code search, build, installer, runtime, docs, CI, recovery, PRs) e teste negativo. Cópias byte-idênticas de assets distribuídos separadamente **não** implicam automaticamente segundo SSOT.

## Arquitetura de referência (validar com implementações e contratos)

```text
ordax-os/
  boot/                    UEFI/systemd-boot e entradas de recuperação
  bootstrap/
    kernel/                source/build de kernel
    initramfs/             early boot/descoberta de volumes
    independent-base/      alvo de base independente
    dev-base/              aquisição Git Owner/Development
    base-update/           stage/arm/promotion de kernel/Base
    release-acquisition/   aquisição/verificação assinada
    recovery/              recuperação controlada
  system/
    entrypoint             início da composição do sistema
    supervisor             autoridade de ciclo de vida e health
    contracts/             contratos do produto
    services/              serviços estruturais (account, power, state, update, apps, etc.)
    surface/               host/composição Native; UI visual canônica é ordax-surface
    composition/           composição por ambiente
    adapters/              portas e adaptadores de plataforma
  tools/creator/           único produtor/provisionador de mídia física
  docs/contracts/          fonte estruturada para comportamento e distribuição
  tests/                   regressões e contratos
```

Esta é uma **organização lógica**, não uma autorização para mover diretórios de modo massivo. Se os contratos atuais exigirem localização diferente, prevalecem; alterações efetivas exigem ADR/contrato, refatoração de consumidores e provas.

**USB Owner/Development corrente:** GPT com ESP FAT32 + ORDAX ext4 + DATA exFAT; contrato `physical-prepared-media.json`, **somente transitório**. **USB Portable/MVP alvo:** GPT com ESP FAT32 e DATA exFAT, subárvore `ORDAX-DATA/.ordax/` contendo releases EROFS verificadas, runtimes endereçados por hash, estado persistente em imagem ext4 e ativação current/candidate/known-good dentro do estado Linux; contrato `portable-usb-v2.json`. Não colocar OverlayFS writable diretamente no exFAT, nem armazenar ponteiro de commit atômico no exFAT. Preservar arquivos do usuário na troca de release. Não alterar a geometria sem prova de Creator, PID1, QEMU e consentimento físico específico.

## Owners — não duplicar

| Capacidade | Source/execução proprietário |
| --- | --- |
| Boot, Base, early mount, recovery | `ordax-os/boot`, `bootstrap/*`; referência `docs/ARCHITECTURE.md` |
| Transição do sistema, supervisão, health, update routing | `ordax-os/system/supervisor` e owners de update definidos por `docs/contracts/distribution-profiles.json` |
| Git Dev (`ordax-pull`) | `bootstrap/dev-base/ordax-pull`, acionado pelo Supervisor; somente aquisição de código Dev |
| Kernel/Base A/B, ativação e promoção | `bootstrap/base-update` e `system/services/base-update` conforme `docs/contracts/base-update.json` |
| Stable signed release/Portable activation | `bootstrap/release-acquisition`, `bootstrap/initramfs`, `ordax-portable-state`, Supervisor e contratos `portable-*` |
| Provas, payload, assinatura e autorização física do OS | `ordax-os/tools/creator` e `docs/contracts/physical-*.json`; NÃO é segunda implementação do Creator standalone |
| Conta/sessão local, política nativa, Settings/Store estruturais e lifecycle | `ordax-os/system/*`; apresentação visual canônica em `ordax-surface` |
| Aplicativos removíveis | `ordax-apps`; o OS fornece contracts/ports, não source duplicado |
| Agente de ações e adaptadores nativos do computador | `ordax-runtime`; OS hospeda lifecycle/permissão local |
| OAuth remoto, grants, sessões atestadas, MCP/queue | `ordax-platform`; OS mantém somente gateways/adapters e enforcement local legítimos, sem segunda autoridade remota |

`ordax-pull` e release-agent são **aquisições distintas por política**, não dois sistemas independentes de autoridade de estado/health; consolidar contratos de estado, detecção, ativação, promoção/rollback com seus owners reais sem forçar um único binário para tarefas fisicamente diferentes.

## Fases de execução, dependências e evidência exigida

**Nota de precedência (2026-11-01):** as fases 4–7 abaixo preservam obrigações históricas de boot/USB/Creator e suas provas, mas **não são tarefas imediatas** durante a janela Windows-first. O programa atual de limpeza e integração está na seção anterior. Nenhuma menção histórica a P0 ou a uma PR USB reabre essa frente automaticamente.

### Fase 1 — auditoria real do source e concorrência (P0)

- [ ] Revalidar heads dos **oito** repos (`ordax-os`, `ordax-surface`, `ordax-apps`, `ordax-runtime`, `ordax-platform`, `ordax-intelligence`, `ordax-creator`, `ordax-site`), PRs/workflows ativos, alterações concorrentes por arquivo e owners.
- [ ] Construir inventário de diretórios/entrypoints, imports, runtime call graph, serviços, scripts, build/test/CI, arquivos gerados, dependencies e source duplicated/unused.
- [ ] Distinguir **código morto comprovado**, projeções deliberadas, compatibilidade temporária necessária e caminho de recovery essencial.
- [ ] Mapear boot firmware→ESP→initramfs→Base→Supervisor→Surface→sessão, incluindo gates de maintenance e shutdown.
- [ ] Mapear Creator→partições→boot→updater Dev/Stable, estados persistidos, failure/rollback.
- [ ] Registrar achados reproduzíveis com path, consumidores, causa raiz, risco, teste e PR/owner; não chamar suspeita de evidência.

**Aceite:** mapa de dependências e conflitos revisável; nenhuma remoção física ou de código às cegas; resultados registrados nos owners (`docs/CURRENT-STATE.md`, auditoria datada em `docs/evidence/` se necessária).

### Fase 2 — definição/reconciliação canônica (P0)

- [ ] Conferir e corrigir **contratos e docs existentes**, não criar segundo contrato, e documentar ADR apenas quando houver decisão nova.
- [ ] Formalizar separação lógica kernel/boot/Base/estado/Surface/apps/Runtime e diretórios gerados vs versionados.
- [ ] Alinhar source Creator, target Portable e preparações de update/boot sob contratos correntes; explicitar o caminho transitório para Dev e gates de substituição.
- [ ] Comprovar que arquitetura proposta remove acoplamento sem redesenhar funções saudáveis ou expandir dependências.

**Aceite:** owner único por capacidade; contratos e consumidores alinhados; nenhum estado paralelo introduzido.

### Fase 3 — limpeza com prova de ausência (P0 nos defeitos comprovados)

- [ ] Para cada candidato legado, enumerar consumidores em todas branches/CI/Creator/runtime/recovery e registrar dependências.
- [ ] Remover implementações substituídas, adaptadores obsoletos, scripts sem consumidores e artefatos versionados indevidamente **apenas** após prova de remoção segura.
- [ ] Revisar `system/apps`/superfícies estruturais em conjunto com PR #2177, sem mover Ajustes, Conta, Sistema e Store estrutural para Apps.
- [ ] Rodar testes positivos/negativos e atualizar owner documental no mesmo change set.

**Aceite:** nenhum consumidor quebrado; não há segunda autoridade; recuperação crítica não perde cobertura.

### Fase 4 — boot, Supervisor e desligamento (P0)

- [x] Reconciliar PRs #2168, #2169 e checkout #2161 nos owners existentes; commits de merge `8bdea25a`, `cf38cfa2`, `85ac5fe8`. **Somente integração de código, sem homologação física**.
- [x] Validar e integrar o readiness real do desbloqueio LUKS no QEMU Native (#2148; merge `abfcea93`; 10/10 workflows no HEAD da PR, inclusive Native ESP UEFI/PID1). **Não é prova de notebook ou USB físico**.
- [ ] Eliminar loops sem diagnóstico; distinguir falha de display, Surface, networking, Base e estado de update.
- [ ] Provar ordem, readiness, boot offline known-good, timeout bounded, manutenção só por erro real e logs estruturados.
- [ ] Validar reinício/desligamento sem esperar indefinidamente, sem mascarar falha de flush/remount.

**Aceite:** QEMU/OVMF com falhas injetadas e cold boot físico quando aplicável; nenhuma tecla Enter repetida necessária; recuperação previsível.

### Fase 5 — atualizações/rollback (P0)

- [x] Reconciliar #2155 (retry no Supervisor) e #2161 (checkout atômico no `ordax-pull`), sem segundo owner, por merges `2a661988` e `85ac5fe8`. A causa do read race observada na `main@caa309a7` (`git rev-parse HEAD` erro 128 no watcher) foi coberta por prova concorrente; **funcionamento da Base instalada fisicamente continua pendente**.
- [ ] Provar state machine download→verify→stage→ready→activate→cold-health→promote / reject→rollback com SHAs exatos.
- [ ] Manter Dev Git-first e Stable assinado como transports; validar Base separadamente de Surface/app sem controles conflitantes.
- [ ] Testar interrupção em cada commit point, energia/reboot, transação persistente, no-op, failed same SHA e retry limitado.

**Aceite:** instalada/ativa/Surface/versão técnica diferenciadas, sem atualização parcial anunciada como sucesso; last-known-good permanece íntegro.

### Fase 6 — Creator, layout e imagem USB (P0)

- [x] Reconciliar e integrar #2167: Portable assinado na geometria transitória Dev com RAW QEMU descartável e ESP FAT32 + ORDAX ext4 vazia + DATA exFAT (`cbd0239a`, 3/3 workflows). Não comprova Owner Git-first, EFI mixed-profile nem recovery cruzado.
- [ ] Concluir #2000: substituir o inventário duplicado de 17 fontes somente pelo Creator Core. A PR permanece draft; testes sintéticos não destrutivos devem ser provados no workflow antes do rebuild da release, mas o gate de publicação física continua obrigatório.
- [ ] Reconciliar Creator e boot com o layout final Portable de duas partições segundo `docs/contracts/portable-usb-v2.json`, sem modificar o contrato transitório Owner/Dev nem inventar geometria adicional.
- [ ] Validar payload preseeded de release e runtime/IA quando exigidos pelo release atual, sob hashes, assinatura e política de remoção independente.
- [ ] Provar Creator e boot consumindo exatamente a mesma topologia, hashes, capacidades e políticas; sem terceira geometria ad hoc.
- [ ] Gerar mídia descartável, validar GPT primária/secundária, FAT32/exFAT/EROFS/ext4, labels, acesso e readback.
- [ ] Antes de qualquer operação destrutiva, conferir disco selecionado, tamanho, serial, bus, partições e autorização física válida; não inferir consentimento deste plano.

**Aceite:** imagem reproduzível no CI e execução física **apenas** quando gates aplicáveis autorizarem; update e recovery na mesma geometria.

### Fase 7 — validação ponta a ponta (P0)

- [ ] Executar testes estáticos e integração no source das PRs, depois na `main` exata.
- [ ] Provar primeiro boot, boot offline, login/sessão persistida, shutdown, restart, atualização/rollback e interrupção por QEMU/dispositivo real.
- [ ] Coletar hashes, comandos, saídas, run IDs, modelo e identificação do USB, active SHA e Surface SHA antes/depois.
- [ ] Diferenciar PASS-CI, PASS-QEMU, PASS-PHYSICAL; em falha ou ausência de dispositivo, manter **NOT-PROVEN**, jamais converter em PASS.

**Aceite:** matriz por ambiente, commit, versão da Base e mídia, com falhas e recuperação rastreáveis; nenhum sucesso inferido de código alterado.

### Fase 8 — consolidação na `main` e handoff (P0)

- [ ] Integrar PRs concluídas validadas por **merge commit**, fechá-las, sem acumular forks de implementação.
- [ ] Atualizar `docs/CURRENT-STATE.md`, contratos/owners afetados, `docs/PROMOTION-GATES.md` e evidências na mesma entrega quando houver mudança de fato.
- [ ] Remover resíduos da refatoração somente após inventário de consumidores e prova.
- [ ] Revalidar `main` e notebook/USB **separadamente**; publicar pendências reais e próximo owner/tarefa.

**Aceite:** source, CI, documentação e status de mídia conciliados; PRs abertas justificadas, sem herança de conversa.

## Política de coordenação entre agentes

1. Ler `AGENTS.md`, `docs/README.md`, o plano, `ROADMAP.md`, `REGISTRY.md` e os owners antes de editar.
2. Revalidar imediatamente `main` e PRs que alteram os mesmos paths; uma PR existente é a unidade de coordenação preferida. Não criar segunda PR da mesma área sem demonstrar que a primeira não cobre o defeito.
3. Uma refatoração por owner, preservando boot/update operáveis. Não mesclar changesets simultâneos e desconectados de Base, EFI, Supervisor e Creator sem contrato/teste de integração.
4. Antes de cada write: confirmar SHA de base, paths afetados, consentimento físico se aplicável e lock de concorrência por owner. Nenhum force push em `main`.
5. Após cada merge: registrar no owner factual o commit, prova CI/QEMU/física, limitações, falhas e fase seguinte; usar este plano só como ordem/handoff.
6. Se outro agente já concluiu um item, validar a evidência e avançar; não reimplementar a partir de um snapshot antigo.

## Segurança, custos, regressão e falha

A autorização física/trust/EFI é controlada exclusivamente por seus contratos e cerimônias; status de desenvolvimento não remove essas condições. Provas em arquivos RAW descartáveis não autorizam escrita em disco real. Mudanças de filesystem e estado exigem preservação de user-data e known-good. Para PC fraco, medir tempo de boot, CPU/RAM, I/O USB e latência da Surface **antes e depois**, fixando regressões por perfil; não introduzir serviços extras em background. Não aumentar superfície de ataque, serviços remotos ou dependências por conforto.

## Próxima ação de execução (handoff imediato — 2026-11-01)

**P0 agora, somente software e Windows Desktop:** revalidar a `main` atual e os PRs/CI dos oito repos; montar o inventário verificável de owners, imports, locks, artefatos, workflows e consumidores; abrir **uma única unidade de correção por owner** para cada defeito comprovado. Começar pelo conflito `docs/contracts/repository-ownership.json` × `ordax-intelligence` e pelo cutover ainda não concluído em `docs/contracts/intelligence-source.json`; em paralelo, auditar as responsabilidades reais de `services/product-oauth`/`services/public-identity` frente a `ordax-platform`, sem mover código funcional por suposição.

**Depois, ainda na janela atual:** confirmar se a composição versionada já existente (release protocol + source locks + contratos de componentes) consegue reconstruir o **mesmo** Desktop instalado; preencher apenas os campos/gates faltantes no owner existente; validar login/Conta, Spaces, Store/Apps, Aura, Files, Runtime/MCP, restart, atualização/rollback e segurança Electron no Windows real. Fazer limpeza definitiva de caminhos antigos **na PR que fecha cada cutover**, com testes de ausência e sem shims permanentes. Avaliar `ordax-desktop` apenas pelo gate objetivo deste plano; não criar o repositório antes da decisão.

**Fora desta janela:** a PR histórica Creator #2000, USB/QEMU, Buildroot, Kernel/Native físico e gates de gravação continuam sob seus owners e o `ROADMAP.md`, sem builds ou investigações físicas por impulso deste documento. Os checkpoints abaixo são **históricos de 2026-10-23**, não comandos atuais de execução; seus status devem ser revalidados antes de qualquer retomada.

**Handoff para o chat/agente “remover pendências”:** "Leia `AGENTS.md`, `00-PLANOS-PRIORITARIOS/README.md`, `ROADMAP.md`, `REGISTRY.md` e este `FOUNDATION-001`. Siga primeiro a diretriz de 2026-11-01. Faça inventário real dos oito repos, reconcilie owners e locks, conclua cutovers sem código legado, teste o Desktop Windows instalado e atualize cada owner canônico com evidência. Não crie repos/SSOT/bridges/updaters paralelos, não mantenha implementações obsoletas e não reabra USB/Creator/Native sem nova janela. Nunca confunda CI, instalação Windows e prova física USB." 

## Checkpoint de execução da Fase 1 — 2026-10-23

Mapa inicial de entrypoints, contratos de USB e colisões de PR: [evidência datada](../../docs/evidence/foundation-001-source-map-2026-10-23.md). Revalidado sobre `main@ec6cb268cbcfe`: #2177 e #2176 **já integradas**. Esta é evidência **PARCIAL**, não fase concluída: faltam grafo exaustivo de consumidores, prova QEMU/CI do HEAD e dados físicos. Evitar novo updater/Creator/Base e não refazer trabalho das PRs existentes.

## Checkpoint source/CI/QEMU — 2026-10-23 (não é contrato canônico)

- `main`: as PRs #2148 (Native QEMU readiness; `abfcea93`) e #2167 (Portable assinado em geometria Dev transitória; `cbd0239a`) foram integradas por **merge commits**, com provas QEMU/CI no HEAD final de cada PR. Os workflows disparados *após* o merge são verificados separadamente; não presumir aprovação até a conclusão efetiva.
- **Creator 17 fontes:** #2000 permanece draft. O owner `tools/creator/core/portable_sources.go` produz hashes/tamanhos a partir do inventário único `portableMediaTargets`; `VerifyPortableSources` faz a leitura independente. A falha histórica `First Physical USB Payload` é anterior à execução do binder, no `apk add` da Base pinada à release antiga; nenhum botão de bypass é permitido.
- **Geometrias distintas:** `docs/contracts/physical-prepared-media.json` (Dev/Owner transitório: FAT32 + ext4 + exFAT) e `docs/contracts/portable-usb-v2.json` (Stable final: FAT32 + exFAT, com imagens internas) não podem ser colapsados nem misturados como fonte de geometria genérica.
- **Próximos gates exclusivamente de software:** fonte do Creator; publicação reproduzível e verificável dos 17 assets; prova mista Owner Git + Portable no mesmo QEMU com transação/known-good; matriz objetiva PASS-CI / PASS-QEMU / NOT-PROVEN físico. Sem reaproveitar artefatos não assinados nem cadastrar novo SSOT.
- **Execução física:** propositalmente fora do escopo de trabalho até a fundação de source estar finalizada. O fato de um dispositivo estar indisponível não bloqueia esta fase, nem autoriza relatá-lo como validado.
- **QEMU/Creator SSOT fechado:** #2190, merge `269c39ff`, 3/3 workflows PASS no HEAD `737bf56c` (Foundation, mount handoff, boot Portable real não-skipped em geometrias final e Dev). O executor QEMU agora lê GUIDs/labels/offsets dos contratos de dois e três partitions, sem valores paralelos. Não prova Git-first misto, firmware físico ou rescue Ed25519 inválida (step separado skipped).
- **Higiene de branches:** após #2190, run `40027556781` falhou em `gh compare` por HTTP 502; #2191, merge `0203f890`, implementou retry curto e limitado de leituras idempotentes, mantendo erros permanentes fail-closed e proibindo retry de DELETE. Foundation Contract do HEAD `e2325347` PASS; workflow operacional pós-merge deve ser verificado separadamente, não presumido.
- **Creator bloqueado com prova distinta:** #2000, HEAD `a8c11fb`, 12/13 workflows success e `First Physical USB Payload` FAILURE (run `40023236896`). O teste Core sintético de 17 fontes passou antes da construção; o Stable Base histórico `03f88eea` exige `ca-certificates=20260909-r0` indisponível. A composição **local** de 17 fontes aproveita os cinco assets v4 assinados mais artefatos locais, mas falha antes dela; o **publisher físico v3**, separadamente, exige 17 assets **remotos publicados e conferidos**, ainda inexistentes nessa release. Não confundir gates nem regravar tag.
- **Base independente sem corte Alpine:** #1860 contém 21 workflows success no HEAD histórico `46551591`, mas está 281 commits atrás da main na auditoria de `269c39ff`. Dos 47 paths, 45 não sofreram alteração concorrente; os dois conflitantes são `system/services/base-update/dev_channel.py` e `tests/test_hot_update_supervisor.py`. O Buildroot Owner ainda não inclui o helper nativo `ordax-checkout-exchange`/ABI exigido hoje pela `main`. Reconciliar com o produtor/toolchain canônicos antes de qualquer promoção; não reviver a troca com dois `mv`. Evidência/handoff registrado na PR #1860.

