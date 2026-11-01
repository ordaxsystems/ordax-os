# REMOVER DEPENDÊNCIA — Desktop e Web independentes de USB/Creator

Status: **P0 EM EXECUÇÃO** · Início: 2026-11-01 · Owner: `ordaxsystems/ordax-os`
Tipo: roadmap operacional de migração; **não** substitui os contratos, a `main` ou `docs/CURRENT-STATE.md`.

## Objetivo / regra de conclusão

OrdaX Desktop Windows e OrdaX Web devem ser compilados, validados, atualizados e entregues **sem** Creator, Buildroot, Alpine/APK, kernel Linux, initramfs, QEMU, reflash USB ou disponibilidade de um pendrive. Falha do produtor USB **não pode representar falha dos artefatos** Desktop/Web. Um mesmo produto continua consumindo contratos, Surface visual, Conta, Platform, Spaces e Aura canônicos: independência de **entrega**, não duplicação de código.

**Não declarar concluído por ausência de job**: é necessário demonstrar, no CI e no produto, que o cliente correto continua passando seus próprios contratos, segurança e assinatura/proveniência. Não alterar ruleset de GitHub nem dispensar gate compartilhado sem substituto verificável e aprovação própria.

## Estado factual inicial (2026-11-01)

- `tools/windows-desktop/` compila instalador NSIS em runner Windows; `.github/workflows/windows-desktop-dev.yml` não executa Creator, QEMU ou Linux USB. `tools/surface-web/` compila Web/Chromium em `.github/workflows/surface-web-candidate.yml`, sem produtor USB.
- O classificador `tools/ci/creator_owner_impact.py` já ignora deltas **exclusivos** de adaptadores Desktop e composição Web. Alteração de `system/composition/native/main.mjs` **é compartilhada** com USB e aciona o gate Creator de forma legítima.
- A PR OS [#1980](https://github.com/ordaxsystems/ordax-os/pull/1980) teve checks Windows/Web/Space/Foundation aprovados em `1957381d`, mas Creator falhou por pin de Python Alpine `3.12.15-r0` contra `3.12.16-r0`; essa falha não é da compilação Windows. PR permanece Draft por falha USB **e por falta de reidratação visual segura do Workspace na Surface**. Commit seguinte `5012ebc8` aguarda fechamento de CI.
- O pacote Windows ainda projeta a árvore ampla `system/` por `tools/windows-desktop/package.json`; isso precisa ser reduzido **por inventário e import-graph**, sem remover bytes consumidos pela instalação. O Linux USB tem sua própria migração Buildroot em [#2243](https://github.com/ordaxsystems/ordax-os/pull/2243).
- Regras de branch/required checks não foram verificáveis pela integração GitHub (403). Portanto **não** afirmar que o check Creator deixou de bloquear merge/release.

## Fase 0 — isolamento comprovável dos clientes (P0, em execução)

1. Usar exclusivamente os workflows `Windows Desktop Dev (SSOT)` e `Surface Web Candidate` para compilar e provar seus respectivos **artefatos**. Proibir chamada ao produtor USB como pré-requisito, job `needs`, ou transporte de atualização dos clientes.
2. Manter testes de contrato de isolamento e impacto `tests/test_creator_owner_impact.py` para impedir regressão no grafo e validar o roteamento real dos workflows; mudanças desconhecidas falham fechado.
3. Retirar do pacote NSIS os executáveis comprovadamente exclusivos do boot Linux (`system/entrypoint`, `system/supervisor`, `system/surface/bin/ordax-surface`) usando a lista **exata** de exclusões existente; garantir em teste que nenhum dos três entra no artefato e que a composição Native/Suface continua incluída.
4. Documentar no contrato `docs/contracts/build-autonomy.json#client_build_independence` os owners, fronteiras e itens ainda não comprovados.
5. **Gate:** construir um NSIS e um Web candidate a partir do mesmo commit com checks próprios verdes; registrar hashes/receipts. Não requerer um build USB para afirmar a saúde dos **clientes**.

## Fase 1 — cortar dependências do empacotamento Windows (P0)

1. Medir `tools/windows-desktop/package-inventory.cjs` sobre o artefato real: lista de arquivos/bytes e diferença entre Surface fonte verificada e Vite compilado. Medição **não** autoriza exclusão indiscriminada.
2. Identificar caminhos Linux que entram no `runtime-template/system` e provar por grafo de importações, smoke do host e atualização Git/rollback quais não são consumidos em Windows. Excluir somente os comprovadamente inertes; não criar cópia paralela de `system/` ou de contrato.
3. Revalidar First Run, Conta, Spaces, Aura, Store, fonte Surface pinada, Native Host, atualização/rollback e assinatura; evidenciar versão realmente executada no Electron e hashes NSIS.
4. **Gate:** artefato NSIS validado fisicamente com login, sessão A→B, reinício, atualização e rollback; instalação Windows não precisa do Creator.

## Fase 2 — isolar construção e entrega Web (P0)

1. Provar que `Surface Web Candidate` só consome fonte visual pinada, serviços e contratos Web/Platform, Node/Vite/Chromium; nenhuma chamada Linux USB, Alpine/APK/Creator.
2. Remover importações cruzadas que tragam host de boot Linux para o bundle Web; encaminhar capacidades indisponíveis por contratos fail-closed, sem inventar backend.
3. **Gate:** build Web, tests Chromium, login/sessão/Spaces reais e publicação pelo próprio canal; ausência/falha USB não interfere.

## Fase 3 — separar gates e produtores nas mudanças compartilhadas (P0)

1. Construir matriz de impacto por **dependência real**: adaptação exclusiva Desktop → Windows; exclusiva Web → Web; contrato compartilhado → testes de contratos e consumidores afetados; kernel/boot/USB → Creator/Buildroot/QEMU.
2. O `system/composition/native/main.mjs` é entrypoint compartilhado; não mascarar alterações como Desktop-only. Evoluir arquitetura para separar a camada do **host** Windows do entrypoint Linux, sem duplicar a Surface ou semântica de sessão. Preservar prova Native para mudanças de runtime realmente compartilhadas.
3. Separar **gate de promoção USB** de **gate de entrega Windows/Web** no CI/rulesets, depois de revisar proteção de branch (403 nesta auditoria), mantendo impedimento de publicação USB sem prova própria. Não renomear um job falho para verde, nem tornar publicável um USB sem boot validado.
4. **Gate:** dois testes de independência: (a) patch Desktop-only com USB quebrado continua gerando instalador válido, (b) alteração real de boot USB ainda exige e falha fechada no gate USB. Verificar uma mudança compartilhada usando ambos os contratos.

## Fase 4 — encerrar legado USB sem contaminar clientes (P1, owner USB)

A [PR #2243](https://github.com/ordaxsystems/ordax-os/pull/2243) mantém a migração canônica Buildroot. Remover Alpine/APK remanescente do **produtor USB**, com revisão de source locks, cache e assinatura, somente após prova Buildroot/QEMU/USB necessária; isso não é pré-condição para Desktop/Web. Não criar um segundo produtor, fork de OS ou PR adicional para um mesmo trabalho.

## Regras de execução

- **SSOT:** `main` (após merge), contratos em `docs/contracts/`, `docs/README.md` → `docs/CURRENT-STATE.md` → `MVP.md` → `docs/DECISIONS.md`. Este arquivo é o **único roadmap de separação**, não um segundo contrato.
- **PRs:** continuar trabalho existente, preferencialmente PR #1980 para a camada Desktop/Workspace. Não reabrir PRs/branches em paralelo nem interferir nos engenheiros Surface/Runtime/Apps.
- **Não fazer:** waiver de Creator sem provar impacto, editar grants/trust, alterar Native compartilhado apenas para passar CI, rebuilds USB sem mudança de causa, testes simulados declarados como instalação física.
- **Registro de avanço:** atualizar este checklist **somente com evidência** por commit/check/artefato; próximos chats devem primeiro ler o arquivo e recuperar o estado real no GitHub.

## Critérios de aceite — estado verificável

- [x] Grafo contratual declara Desktop e Web independentes de Creator/USB (já existente).
- [x] Workflows Desktop/Web possuem compilação própria, sem chamada direta ao Creator (verificado em fonte).
- [x] Remoção dos três executáveis Linux de boot e 21 scripts POSIX do pacote Windows + suíte de inventário **CI Windows verde** (commit `09e96df5`, workflow #41273803078; prova de instalação NSIS isolada no runner).
- [x] Classificação de impacto e filtros exclusivos Desktop/Web testados no mesmo HEAD `09e96df5`: Foundation, Windows e Web aprovados; contratos Native compartilhados preservados.
- [ ] Redução completa da árvore empacotada Windows comprovada no NSIS instalado.
- [ ] Entrega Web validada sem USB/Creator.
- [ ] Required checks/branch rules ajustados com segurança para separar promoção USB de cliente.
- [ ] Surface reidrata Workspace em trocas de contas A/B/guest com E2E visual — owner `ordax-surface`.
- [ ] Windows físico e Web público/privado homologados com proveniência e sem dependência USB.
- [ ] USB Buildroot validado e Alpine legado removido pelo owner USB (não bloqueia clientes).

### Registro de validação de 2026-11-01 (HEAD `478bbd10`)

CI após a primeira alteração: Web, source-consumer, durabilidade, Space Foundation e checks de impacto passaram; **Foundation e Windows falharam em expectativas de testes antigas**, sem falha comprovada do compilador ou do runtime do cliente: o teste Windows ainda exigia exatamente seis exclusões anteriores e não aceitava as três entradas Linux agora contratadas; a suite de classificação esperava que um contrato JSON sobrescrito arbitrariamente com texto `changed` fosse leve, o que a proteção nova rejeita corretamente. Ajustar os testes preservando o contrato, sem remover as exclusões e sem autorizar alteração desconhecida do grafo. O Creator continua falhando no pin Alpine/Python em produtor USB independente. Consultar CI do HEAD seguinte antes de marcar estes itens.

### Isolamento de gatilhos dos clientes — atualização de implementação

O workflow Windows usava o seletor amplo `system/**`, incluindo três executáveis Linux já retirados do pacote NSIS. A correção adiciona exclusões exatas ao mesmo alias `paths` usado por PR e `main`. O workflow Web incluía pelo glob `system/surface/**` tanto o launcher Linux `ordax-surface` quanto o manifesto de pacotes `packages.txt` (Alpine); a correção exclui esses dois caminhos das tabelas PR e push. O glob para código Native compartilhado e o grafo de contratos de cliente permanecem. Testes de regressão inspecionam ambos os workflows reais e evitam retrocesso no roteamento. Aguardam CI e artefatos, portanto **não concluir independência total** com base apenas no filtro.

### Fase 1 — limpeza abrangente do pacote Windows (2026-11-01)

A auditoria de `system/` identificou **21 scripts POSIX** ligados a serviços Linux, resgate, update de base, montagens EROFS, rede/WPA, telemetria, ACPI e provas físicas USB. Cada arquivo foi inspecionado na revisão anterior e possui `#!/bin/sh`; nenhum pertence ao host Electron/Win32. Suas rotas relativas estão relacionadas **uma única vez** no contrato `docs/contracts/build-autonomy.json#client_build_independence.windows_package_forbidden_linux_shell_paths`. O template NSIS de `tools/windows-desktop/package.json` e os gatilhos Windows/Web consomem essa lista por testes de regressão: não podem reintroduzir shells Linux, nem cortar o JavaScript Native compartilhado.

A política `creator_owner_impact.py` admite metadados novos **somente** se os scripts estiverem registrados no commit Git e seu conteúdo começar por `#!/bin/sh`; alterações desconhecidas do grafo/boot permanecem USB-heavy. O workflow Web é reconhecido como owner de entrega do próprio Web, não produtor USB. Esta limpeza não implica autorização para remover os módulos JavaScript/Python que o Desktop utiliza, nem para dispensar o Creator quando uma PR ainda modifica entrypoint Native compartilhado.

**Prova final desta ampliação:** no commit `09e96df5`, Foundation, Web e Windows Desktop aprovaram; o workflow Windows #41273803078 publicou um NSIS de 680.377.335 bytes e passou sua instalação isolada. O Creator USB falhou por Python Alpine, sem bloquear a compilação dos clientes. A homologação física do computador do usuário e a separação dos required checks permanecem pendentes. O bloqueio visual A→B da Surface permanece com seu owner.

### Fase 1 — retirar composição exclusivamente Web do instalador Windows

O pacote NSIS ainda incluía `system/composition/web/` apesar de o builder Windows usar exclusivamente `system/composition/native/index.html` como entrada Vite e `system/composition/web/` já ser owner Web no contrato. A próxima mudança remove a árvore Web **somente da distribuição Windows**, preservando-a no OS Git e na entrega Web, sem bifurcar Surface e sem alterar imports Native.

A verificação é tripla: `package-inventory.cjs` aceita um único padrão de exclusão de diretório `!composition/web/**` (nenhum outro wildcard); testes provam que apenas arquivos da composição Web são omitidos e que Native permanece; e `install-smoke.ps1` exige a **ausência real** de `runtime-template/system/composition/web` após extrair o NSIS.

**Etapa seguinte, mesmo owner:** `tools/surface-web/` era copiado como `runtime-template/tools/surface-web` no NSIS, e a transação `ordax-pull` incluía o mesmo produtor Web no `sparse-checkout`. O builder da atualização usa exclusivamente `tools/windows-desktop/vite-native-build.mjs`, Vite do toolchain verificado e `system/composition/native/index.html`. A correção retira essa cópia do instalador e da materialização do Git, sem remover Vite/React do cache confiável, e valida com E2E offline de atualização/rollback e a ausência **física** dos arquivos após instalação NSIS. A fonte Web permanece apenas no produtor Web. **CI da nova revisão ainda pendente.** Mudanças em `system/composition/web/**` não devem iniciar o produtor Windows; continuarão iniciando o próprio Web. Aguardar CI Windows/Web/Foundation e artefato no HEAD novo antes de marcar esta etapa como homologada. Não dispensa Creator quando houver mudança compartilhada em `system/composition/native/main.mjs`.

## Evidência da revisão 79d2f2cf (2026-11-01)

Os workflows Windows Desktop, Surface Web Candidate e Foundation concluíram com sucesso no mesmo SHA `79d2f2cf`; 13 checks passaram, 2 foram dispensados, e somente Creator USB falhou por sua dependência legada Alpine/Python. A exclusão da composição Web já passou pelo smoke da instalação NSIS, mas não comprova instalação física do computador de uso. A nova etapa remove o produtor `tools/surface-web/` tanto do pacote Windows quanto do sparse checkout da atualização, mantendo o compilador Native único e o toolchain offline canônico. Somente CI deste novo HEAD poderá homologar essas mudanças. Owner Surface #33 e required checks de promoção USB seguem pendentes.

### Fase 2 — Vercel Web não recompila por alterações exclusivas Linux/USB

Auditoria do deploy independente `ordax-web`: o `ignoreCommand` em `tools/vercel/should_skip_build.sh` ainda usava `git diff --quiet … -- system`, portanto mudanças como `system/supervisor` ou `system/rescue/agent.sh` acionavam **compilação/publicação Web desnecessária**, apesar de não entrarem no bundle. A política agora lê as entradas POSIX já comprovadas no **mesmo** `docs/contracts/build-autonomy.json#client_build_independence` por `tools/vercel/web_linux_exclusions.py`, emite pathspecs Git exatas e só as ignora na avaliação do projeto `ordax-web`. O projeto público Site mantém seus próprios owners e regras.

A prova por commits Git reais passou no workflow Foundation e no projeto Web no HEAD `eca2f3d1`, com Windows, Web e Foundation aprovados (15 checks verdes, 2 skips; o Creator USB permanece falhando separadamente). A implementação não foi integrada à `main` e nenhuma publicação Vercel foi disparada por esta PR.

**Manifesto Alpine desvinculado do Web:** `system/surface/runtime/packages.txt` continua sendo seleção de pacotes Linux/USB, mas ainda acionava Vercel Web devido ao seletor `system/`. Agora uma única entrada `linux_only_client_package_manifest` no contrato de build adiciona esse arquivo à mesma projeção de impacto que os scripts POSIX. A projeção valida **caminho exato, arquivo regular não simbólico, tamanho máximo e sintaxe de pacotes** antes de ignorar sua mudança no Web; manifesto ausente, corrupto, alterado para outro caminho ou não autorizado impõe **BUILD (fail-closed)**. A Foundation valida mudanças de metadados contra origem Git para não abrir exceções USB indevidas. Testes de commits reais cobrem manifesto Alpine alterado, corrompido e restaurado, Native compartilhado e contrato. **Aguardando CI deste novo HEAD**, sem deploy manual.

### Fechamento dos demais scripts e sondas físicas Linux (Fases 1–2)

Na mesma árvore `system/surface/runtime/` foram identificados **quatro executáveis Python exclusivamente para provas físicas Linux** (`media_runtime_probe.py`, `physical_ata_probe.py`, `physical_kernel_log_probe.py`, `physical_performance_probe.py`) e o script POSIX `audio-session.sh`. Todos já eram excluídos do NSIS Windows, mas a lista ainda estava duplicada fora do contrato, e as sondas podiam provocar build Web por `system/surface/**`. A mesma classificação canônica agora os cataloga: `linux_only_client_probe_paths` (quatro caminhos) e `windows_package_forbidden_linux_shell_paths` (script áudio, sem novo owner). O NSIS mantém o mesmo conjunto efetivo de arquivos — apenas consolida a lista — e os filtros do Web deixam de reconstruir por essas sondas físicas.

A projeção de publicação Vercel Web rejeita sondas não registradas, caminhos arbitrários, links simbólicos, fontes maiores que 512 KiB e shebang distinto de `#!/usr/bin/env python3`; outros módulos Python **continuam permitidos e não são excluídos por extensão**. O classificador Creator verifica cabeçalho e proveniência Git e continua fail-closed em mudanças desconhecidas. Testes de Foundation, Web (commits Git reais) e inventário NSIS validam os limites. **Nova revisão só será marcada homologada após CI**, sem reinstalação, sem publicação Web e sem alterar produtores USB.

A separação de *required checks* da promoção USB, a integração Surface A/B e a prova Windows físico permanecem gates em aberto; não confundir isolamento de arquivos com autorização de merge.

### Verificação de SSOT do inventário NSIS — 2026-11-01

O inventário Windows agora rejeita exclusões ausentes ou adicionais em relação
à projeção **exata** do contrato `docs/contracts/build-autonomy.json`,
inclusive uma exclusão inesperada de Native, duplicatas, uma segunda cópia
`../../system` e arquivos excluídos que não existam mais na fonte física.
O teste existente `package-inventory.test.cjs` cobre regressões negativas
sem copiar a lista de caminhos. Os bytes distribuídos permanecem iguais;
não há alteração de Creator, Buildroot, USB nem novo produtor. O commit `6f6d7909` passou os próprios gates Windows, Web e Foundation
(15 sucessos, 2 skips, 1 falha Creator/USB); portanto o inventário
contratual está validado pelo CI dessa revisão. A verificação de arquivos
efetivamente extraídos continua independente da prova física do computador
do usuário e da separação dos required checks.

### Prova física dos arquivos NSIS sem duplicar classificação (2026-11-01)

O `install-smoke.ps1` passa o diretório `runtime-template/system` **realmente
extraído** pelo NSIS ao modo `--installed-system` do mesmo
`package-inventory.cjs`. O verificador reutiliza
`canonicalWindowsPackageExclusions` e o contrato de build existente para
recusar qualquer arquivo Linux/USB proibido, a árvore Web inteira e ausência
da entrada Native. As regressões existentes ganham fixtures positivas e
negativas (serviço Linux, manifesto Alpine, sonda física, Web e Native ausente).
Nenhuma lista alternativa de caminhos nem novo produtor foi criada.
Exige CI Windows do novo HEAD para comprovar a instalação no runner;
o equipamento pessoal, os required checks e a promoção USB permanecem
pendentes de suas provas específicas.

### Isolamento da entrada gráfica Linux — 2026-11-01

A auditoria de consumidores encontrou `system/surface/entrypoint` ainda no
pacote NSIS e nos gatilhos de clientes, embora seja um launcher POSIX que aceita
somente `usb|native-disk`, executa `system/surface/bin/ordax-surface` e
não é chamado pelo Electron/Vite. A classificação agora está no mesmo grupo
`windows_package_forbidden_linux_boot_paths` do SSOT, não em lista paralela:
o pacote e o smoke de NSIS proíbem sua cópia, e os filtros Windows, Web e
Vercel ignoram alterações exclusivamente desse arquivo. O Creator e o
classificador QEMU ainda tratam mudanças do launcher como boot real.
Testes do pacote, do classificador e de diffs Git reais são os gates.

Nenhum arquivo de boot foi removido do OS/USB, nenhum runtime duplicado e
nenhum resultado de produção foi presumido. Exigir CI Windows/Web/Foundation
do HEAD exato antes de homologar, e manter prova física e gates USB separados.

**Gatilho USB preservado:** o workflow `Creator Owner Development Git USB`
passa a incluir explicitamente `system/surface/entrypoint` em PRs, e o
classificador mantém o caminho entre os gatilhos obrigatórios. Dessa forma
uma alteração real do launcher não perde a prova de boot ao mesmo tempo em
que deixa de provocar builds dos clientes. O Creator continua sujeito à
correção causal do produtor Alpine/Buildroot, sem dispensa de prova.

### Gates de filtros por projeção exata do SSOT — 2026-11-01

O HEAD `425e5f17` fechou os gates Windows, Web e Foundation no GitHub:
16 aprovações, dois skips por impacto e falha separada do Creator, causada
pelo pedido de `python3=3.12.15-r0` contra o repositório Alpine que oferece
`3.12.16-r0`. Esse defeito USB permanece sem dispensa de prova.

A auditoria encontrou duas exclusões Linux posicionadas no meio dos eventos
Web e todas as exclusões Windows anteriores a padrões positivos. GitHub Actions
interpreta `paths` sequencialmente: incluir futuros globs após `!` pode
reativar builds indevidos. Os filtros negativos existentes foram movidos para
o **final** dos gatilhos Windows e de **ambos** os eventos Web, sem alterar a
seleção permitida. O teste `test_ci_exclusions_exactly_match_ssot_and_are_terminal`
agora compara exclusões exatas e sem duplicação às classificações do
`build-autonomy.json` (32 Windows, 31 Web por evento), recusando filtros
extra, omissões e reintroduções posteriores. Não cria outra lista de autoridade.

Esta nova revisão permanece condicionada aos próprios gates do HEAD exato,
sem publicar Web, reinstalar Desktop ou substituir o gate Creator.

### Dois entrypoints Python Linux retirados do NSIS e da entrega Web — 2026-11-01

A análise de consumidores confirmou que
`system/surface/runtime/native_host_server.py` é o servidor HTTP do
launcher gráfico Linux em chroot, e
`system/surface/runtime/ordax_browser_host.py` usa GTK/WebKit2 Linux.
Ambos são consumidos explicitamente pelo launcher
`system/surface/bin/ordax-surface`; nenhum é invocado pelo host Node
`tools/windows-emulator/desktop-native-server.mjs`, que atende o Desktop
instalado. O bundle Web tampouco executa esses entrypoints Python.

A classificação **exata** e limitada aos dois caminhos está em
`docs/contracts/build-autonomy.json#client_build_independence.linux_only_client_host_entrypoints`.
O pacote NSIS, os filtros de evento Windows e Web, a projeção Vercel e
os testes reutilizam essa única classificação. Os validadores exigem
identidade de script Python, presença no launcher POSIX Linux, assinatura
HTTP/GTK e tamanho limitado; alterações que perdem essa identidade
causam BUILD (fail-closed). O smoke NSIS recusa ambos após extração.
Os demais módulos Python continuam na distribuição até ser provada
sua ausência de consumidores sem bifurcar o runtime Native.

Nenhum arquivo do OS/USB foi apagado; alterações nesses hosts Linux
continuam sujeitas ao classificador USB obrigatório. O trabalho depende
de Windows/Web/Foundation/NSIS no HEAD exato, não de uma versão cosmética
nem da aceitação da falha externa de pin Alpine/Python do produtor USB.


Correção causal do gate Vercel no HEAD posterior: a classificação passou a
incluir `hosts` também na etapa final de validação de caminhos. O primeiro
CI recusou corretamente a lista nova por regra genérica anterior, falhando
`test_web_vercel_skips_proven_linux_usb_only_without_skipping_web_or_native`.
A mudança preserva a conferência exata de dois entrypoints, shebang,
assinatura HTTP/GTK e referência no launcher Linux; qualquer caminho extra
continua proibido. Não habilita publicação nem bypass de segurança.

O gate Windows encontrou em `tools/windows-desktop/runtime.test.cjs`
uma expectativa antiga que projetava somente os grupos anteriores do
contrato. A asserção agora consome também
`linux_only_client_host_entrypoints` do SSOT, sem inserir lista fixa de
caminhos ou aceitar exclusões extras. A regra principal
`canonicalWindowsPackageExclusions` e o smoke NSIS continuam obrigatórios.

### Extração de serviços Linux Base/ESP e diagnóstico físico dos clientes (2026-11-01)

Auditoria da árvore `system/`: 713 arquivos, incluindo 77 módulos Python.
Além dos dois servidores gráficos Linux já isolados, há 11 módulos Python
exclusivos de `system/services/base-update/` (estágio e promoção ESP/EFI,
canal de desenvolvimento e `orchestrator.py` do agente POSIX) e dois
coletores em `system/diagnostics/` usados pelos comandos Linux
`ordax-internet-proof` e `ordax-mvp-smoke`. Esses arquivos não são
carregados pelo host Node do Windows nem pelo bundle Web.

Os 13 caminhos passam a uma única lista explícita no contrato
`build-autonomy.json#client_build_independence.linux_only_client_base_update_diagnostics_paths`,
projetada no NSIS e nos filtros Windows, Web e Vercel. Validação fail-closed:
correspondência exata com o inventário Python registrado nesses dois
diretórios (não permite novos nomes ocultos), arquivo regular sem symlink,
limite de 256 KiB, shebang Python, cabeçalho de fonte canônica e provas dos
consumidores POSIX Linux. O CI de Foundation e os testes com commits Git
reais incluem mutações válidas e perda de identidade que obriga BUILD.
O smoke NSIS testa vazamentos dos dois grupos. Sem modificar o kernel,
o serviço de atualização ou o runtime físico do USB.

Esta revisão exige Windows, Web, Foundation e NSIS verdes no HEAD. Não há
publicação Web automática nova, instalação no PC físico ou dispensa de gate
Creator para alterações reais de código Linux. O defeito anterior de pin
Alpine/Python permanece no produtor USB, fora da entrega independente.


**Gate Foundation revisado (2026-11-01):** o HEAD `adb5d25e` falhou em
10 casos da mesma asserção, que examinava o marcador `from __future__`
apenas em 300 caracteres, embora os produtores canônicos Base/EFI tenham
docstrings superiores a esse limite. O verificador Git/Vercel já exige
shebang e marcador em até **1024 caracteres** com inventário exato e
consumidores POSIX; o teste de regressão passa a usar esse mesmo limite.
Os fontes Linux não foram alterados nem a exigência de prova reduzida.

### Atualização Windows também remove a dependência de fontes USB/Web — 2026-11-01

Os 47 caminhos que o NSIS já excluía continuavam sendo materializados
no checkout Git do `ordax-pull` por `sparse-checkout set system`.
Isso cria downloads e fontes Linux desnecessárias dentro do candidato Windows,
mesmo depois da limpeza do instalador.

O atualizador agora lê `docs/contracts/build-autonomy.json` e
`tools/windows-desktop/package.json` **do mesmo commit Git oficial**,
por uma etapa inicial pequena de materialização. O módulo
`package-inventory.cjs`, distribuído dentro do Electron, valida as
exclusões NSIS do contrato antes da segunda etapa de checkout. A projeção
`canonicalWindowsSparsePatterns` reusa esse exato conjunto em
`git sparse-checkout set --no-cone`, retendo apenas arquivos raiz,
`system/` permitido, contratos, evidências e os dois owners Windows.
Nenhum caminho foi duplicado em outra lista.

Política ausente, vinculada por symlink, fora do limite de tamanho,
corrompida ou divergente impede atualização (fail-closed) sem mexer no
known-good. A revisão preserva SHA, proveniência de Git, build Native
do mesmo commit, transação pendente, tentativa de boot e rollback.
Os testes com Git verdadeiro confirmam o checkout limpo e a ausência
do Web e dos entrypoints Linux na versão candidata.

Esta implementação não declara instalação física no PC do usuário nem
homologação USB. Exige CI Desktop/Web/Foundation + NSIS do HEAD exato.

**Teste de build real corrigido:** o fixture `dev-update-real-build.test.cjs`
passa a registrar `build-autonomy.json` e `package.json` no Git OS de
cada commit sintético, pois o novo updater requer corretamente esses dois
arquivos da revisão candidata. A falha anterior `untrusted` era causada
pela ausência deles no fixture, não pela política em produção. O mesmo teste
agora prova ausência de três arquivos Linux/Web no checkout imutável,
status Git limpo, compilação Vite verdadeira e os recibos de rollback.
