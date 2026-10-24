# Migração OrdaX Surface — rastreamento da separação

**Estado no `ordax-os/main`:** cutover de fonte visual integrado pela [PR #2198](https://github.com/ordaxsystems/ordax-os/pull/2198), merge commit `54ef2086338ed53f5dfccaebf77905a24a044b3d`. O contrato é `canonical`; os arquivos visuais antigos não são rastreados no Git do OS. Não houve promoção física ou Stable.
**SSOT da revisão externa:** [`docs/contracts/surface-source.json`](contracts/surface-source.json). Não repetir a revisão da Surface neste documento ou criar uma segunda resolução de versão.

## Decisão de ownership

- `ordaxsystems/ordax-surface`: fonte de componentes e recursos visuais `system/surface/ui/` e `system/surface/workspace/`; mantenha layout e import paths durante a transição.
- `ordaxsystems/ordax-os`: `system/surface/runtime/`, `system/surface/bin/`, `system/surface/entrypoint`, `system/composition/`, `system/adapters/`, `system/services/`, `system/contracts/`, Guardian, Supervisor, boot e distribuição.
- `ordaxsystems/ordax-apps`: aplicativos first-party removíveis; nenhuma cópia da Surface.
- **Ownership vigente:** `docs/contracts/repository-ownership.json` atribui a visual ao `ordax-surface` e o host Native ao OS.

## Evidências obtidas

1. `ordax-surface#1` importou o Git history de `ui/` e `workspace/` a partir de commit OS imutável. 157 Git blobs e modos foram conferidos contra a revisão original; merge commit com histórico preservado.
2. O gate de integração Web + Native no repositório Surface validou import source/OS no runner isolado.
3. `ordax-surface#2` corrigiu o CI de evolução: a proveniência histórica continua fixa, mas cada alteração visual nova é conferida contra o **commit Surface HEAD** e executa testes cruzados.
4. `ordax-os#2192` introduz lock de source, materialização de checkout exato, teste de recusa de mutações/symlinks/revisão incorreta e prova de build Web+Native com a fonte externa.
5. O consumer em CI remove as árvores antigas **somente em checkout descartável**, materializa a versão externa e monta as mesmas interfaces esperadas por `system/composition`. A saída do empacotador canônico `tools/release-bundle` é gate desta PR.

## Montagem canônica de release integrada (PR #2194)

O novo `tools/surface-source/assemble.py` prepara uma árvore **descartável**
`system/` com uma única cópia dos arquivos visuais, cuja fonte e revisão
são identificadas no contrato `docs/contracts/surface-source.json`.
Os arquivos visuais historicamente rastreados em `ordax-os` são excluídos
somente da saída do staging; os serviços Native são mantidos.

A receita reutilizável `.github/actions/assemble-surface` alimenta os
workflows de release bundle, portable EROFS e a montagem Native. O
`tools/native-release-assembly/build.py` aceita a árvore pré-montada por
`--system-source` e verifica novamente a proveniência e fingerprint antes
de acrescentar os **mesmos dois helpers Native já existentes**. Não existe
um segundo empacotador, segundo host, segundo canal de atualização ou
checkout de UI na inicialização do dispositivo.

A PR #2194 **isoladamente** não alterou o Supervisor Owner/Development.
A PR #2195 integrou o staging transacional, e a PR #2198 concluiu o corte dos arquivos rastreados após aprovação de CI, incluindo QEMU Owner offline. O pipeline Native continua verificando o source pinado.

## Supervisor Owner/Development — preparação fail-closed (PR #2195)

A receita `system/services/surface-source/owner-stage.sh` é um **adapter**
BusyBox + Git do Supervisor já existente, não um daemon/updater autônomo.
Ela resolve `docs/contracts/surface-source.json` a partir do **commit exato
do OS candidato**, verifica repositório e SHA pinados, recusa paths/modos
Git não regulares, obtém a revisão imutável de `ordax-surface` e materializa
`ui/` e `workspace/` somente na árvore de release staged, **antes** do
checkout OS passar para o novo commit. Falha de rede ou árvore inválida
rejeita a tentativa sem alterar a Surface ativa. A confirmação de commit
continua pertencendo a `ordax-pull` e à saúde do Supervisor existente.

O Supervisor, quando o lock estiver em `canonical`, exige um slot
preparado para o SHA exato do OS com receipt do commit visual antes de
iniciar/reiniciar a Surface, sem fallback para a UI antiga. O lock `canonical` está vigente na `main` após o cutover. O comportamento anterior com `integration-candidate` é histórico e não constitui fallback permanente.

Os testes Git isolados não substituem a prova do dispositivo: o QEMU Owner offline, heartbeat Native e segundo boot foram aprovados no cutover, mas a homologação em hardware físico permanece separada.

## Cutover integrado — SSOT visual e primeiro boot offline (#2198)

A PR #2198 removeu os **157 arquivos visuais rastreados**
em `system/surface/ui` e `system/surface/workspace`, mantendo os executáveis
Native, host, composições e contratos do OS. Um único commit imutável da Surface
é a fonte de apresentação. O mesmo assembler validado alimenta builds
Web/Native, release assinada e verificadores CI, sem Git espelhado no OS.

A primeira inicialização Owner/Development **não pode depender de GitHub**,
inclusive antes do fim do First Run. Por isso o Creator, ao preparar a imagem
descartável, executa `tools/surface-source/preseed_owner.py` sobre a árvore
já verificada do assembler. Essa etapa pré-semeia o slot canônico do
Supervisor em `/state/ordax/releases/<os-commit>`, com o OS SHA, a revisão
visual, uma lista completa de SHA-256 e marcador de ativação. O checkout
`/workspace/ordax` segue limpo e sem UI rastreada; os arquivos visuais
são bytes de release, **não** uma segunda fonte Git.

Os gates comprovados na candidata foram QEMU Owner/Development realmente offline
com primeiro boot, framebuffer/WebKit e saúde; QEMU Stable/Portable com
fallback da release anterior; regressões Foundation/Web/Native; integridade
do cache; e revisão de concorrência com Creator e Site. Nada disso
substitui a prova de hardware físico. O status `canonical` na candidata
**não** autoriza promoção Stable, gravação física ou atualizações no USB
existente. Nenhum desses gates pode ser ignorado no merge.

## Reconciliação pós-cutover — PRs históricas abertas (auditoria de 24/10/2026)

Este inventário documenta **PRs ainda abertas no momento da inspeção**, não representa backlog canônico, aprovação de produto nem uma segunda autoridade de código. Fonte de verdade: lista de PRs e caminhos alterados no próprio GitHub; contrato operacional de source: `docs/contracts/surface-source.json`. Revalidar HEAD/estado de cada PR antes de qualquer ação, pois outros agentes continuam avançando a `main`.

**Reconciliação concluída com evidência reproduzível.** A [Surface #4](https://github.com/ordaxsystems/ordax-surface/pull/4) passou e integrou o CI contra o OS atual, preservando a comparação histórica de 157 blobs; [Surface #5](https://github.com/ordaxsystems/ordax-surface/pull/5) protege sincronização Native e dimensão visual compensada por zoom; [Surface #6](https://github.com/ordaxsystems/ordax-surface/pull/6) protege escala, wallpaper e painel de notificações. O [Chromium Native da #6](https://github.com/ordaxsystems/ordax-surface/actions/runs/40066103180) aprovou **1280×800, 390×844, 320×568 e 844×390**, inclusive `notificationsFitViewport`/`notificationsNoHorizontalOverflow`; a [CI pós-merge da Surface #6](https://github.com/ordaxsystems/ordax-surface/actions/runs/40066212669) também passou. Foram encerradas **sem merge no OS** as PRs antigas [#2017](https://github.com/ordaxsystems/ordax-os/pull/2017), [#2023](https://github.com/ordaxsystems/ordax-os/pull/2023), [#2024](https://github.com/ordaxsystems/ordax-os/pull/2024), [#2026](https://github.com/ordaxsystems/ordax-os/pull/2026) e [#2030](https://github.com/ordaxsystems/ordax-os/pull/2030), cada uma com justificativa no histórico.

**PRs mistas abertas que ainda alteram `system/surface/ui/` ou `system/surface/workspace/`:**

| PRs do OS | Domínio a conciliar | Decisão de ownership; não constitui aprovação |
| --- | --- | --- |
| [#2135](https://github.com/ordaxsystems/ordax-os/pull/2135) | Recuperação de Conta após reconexão | Network tray visual → Surface; status, sessão, políticas e composição Native → OS. Não reintroduzir poll paralelo. |
| [#2040](https://github.com/ordaxsystems/ordax-os/pull/2040) | Runtime Desktop/atualização | Apresentação do progresso → Surface; atualização, integridade e autoridade do host → OS/Runtime conforme seus contratos. |
| [#2035](https://github.com/ordaxsystems/ordax-os/pull/2035) | Permissões MCP do dispositivo | UI de Configurações → Surface; grants, consentimento, validação e enforcement → OS/Platform. Jamais transportar a tela sem autoridade real. |
| [#2016](https://github.com/ordaxsystems/ordax-os/pull/2016) | Display Native/Web | Tipagem visual já equivalente no owner; host Display, fail-closed e versão devem ser analisados no OS antes de qualquer encerramento. |
| [#1983](https://github.com/ordaxsystems/ordax-os/pull/1983) | Playground público e Meridian | Site owner e Surface owner separados; não versionar snapshot gerado como source visual no OS. |
| [#1980](https://github.com/ordaxsystems/ordax-os/pull/1980) | Conta e First Run | Estado visual → Surface; identidade, persistência e auth/recovery → OS/Platform. |
| [#1979](https://github.com/ordaxsystems/ordax-os/pull/1979) | Estado de Store por Space | Workspace visual → Surface; catálogo, grants e estado autorizado → serviços/contratos do OS. |
| [#1971](https://github.com/ordaxsystems/ordax-os/pull/1971) | Referências de apps por Profile/Space | UI Workspace → Surface; seleção, associações, contratos e dados → OS. |
| [#1927](https://github.com/ordaxsystems/ordax-os/pull/1927) | First Run retomável | Etapas/UI → Surface; checkpoint durável, identidade e integridade do recovery → OS. |
| [#1907](https://github.com/ordaxsystems/ordax-os/pull/1907) | Administração de membros de Space | Componentes de gestão → Surface; capability/ação autorizada e idempotência → OS/Platform. |
| [#1858](https://github.com/ordaxsystems/ordax-os/pull/1858) | Jornada inicial Meridian | UI/estilos → Surface; auth, host Native e serviços First Run → OS. |
| [#1852](https://github.com/ordaxsystems/ordax-os/pull/1852) | Visibilidade de senha e erro de login | Apresentação/feedback → Surface; sem alterar segurança e políticas de auth no OS/Platform. |

**PRs sem arquivos visuais que ainda citam Surface:** [#2028](https://github.com/ordaxsystems/ordax-os/pull/2028), [#2018](https://github.com/ordaxsystems/ordax-os/pull/2018), [#2014](https://github.com/ordaxsystems/ordax-os/pull/2014) e [#1850](https://github.com/ordaxsystems/ordax-os/pull/1850) permanecem sob avaliação dos respectivos owners. Não encerrar ou transplantar apenas por menção à Surface.

**Regra de integração:** PR antiga que volte a rastrear visual source no OS não deve ser mesclada; preservar seu conteúdo para revisão e dividi-lo por responsabilidades em PRs novas apenas quando houver dependências e gates satisfeitos. O stage verificado pode conter esses bytes **somente como saída descartável/release**. Se a funcionalidade envolver permissão, identidade, persistência ou recuperação, a Surface isolada não pode atestar sua implementação; o OS deve validar as capabilities sem simular autoridade. Não fechar unilateralmente PRs com correções de domínio ainda não avaliadas.

**Site:** [Surface issue #3](https://github.com/ordaxsystems/ordax-surface/issues/3) solicita publicação oficial de brand/preview; o [Site #1](https://github.com/ordaxsystems/ordax-site/pull/1) consome um snapshot **de migração não oficial**. A geração histórica em `tools/public-site/surface_snapshot.mjs` depende de composição SSR e catálogos do OS e escreve em `sites/public`; copiá-la diretamente para o owner Surface, declarar a saída `official` ou publicar bytes históricos sem proveniência não resolve a dependência. Primeiro estabelecer um artefato determinístico, com contrato de apresentação read-only, dependências explicitadas, hashes e cadeia de publicação verificável. Nada disso autoriza deploy do Site, firmware ou Stable.

**Lock:** a revisão visual no contrato do OS permanece no SHA de source validado para distribuição, não na ponta móvel da `ordax-surface/main`. PRs #4/#5/#6 acrescentaram CI, documentação e regressões, sem alterar o conteúdo visual distribuído; não modificar o lock para “sincronizar números” sem uma atualização real do source.

## Critérios de aceite do cutover

Os itens abaixo documentam os **gates exigidos na migração** e não são autorizações de pular testes futuros, publicar Stable ou gravar mídia.

1. Integrar ao **pipeline canônico de materialização do OS** a fonte Surface verificada, sem segundo updater, sem publicar um source Git espelhado no OS. `tools/surface-source/materialize.py` é a ferramenta de stage de build; o release final continua sob `tools/release-bundle` e canais assinados do OS.
2. Corrigir dependências internas da UI que atravessarem a fronteira entre repositórios: consumir capabilities/ports públicos existentes, sem conceder autoridade de serviços à interface e sem criar bridges permanentes. Checar source graph no Web build e browser host no Native.
3. Para `owner-development`, preservar a transação do **Supervisor**: provisionar o source imutável como parte do mesmo candidato e validá-lo antes do checkout/health; em falha de rede, continuar com a release conhecida como boa. O Supervisor não deve buscar `main` da Surface independentemente da versão travada no OS.
4. Para `stable-mvp`, inserir bytes da interface no bundle oficial verificado e assinado; não exigir Git ou rede na inicialização do dispositivo. O source SHA da Surface deve ficar na evidência/proveniência da release, mas não substituir a identidade do OS.
5. Provar em CI o uso de uma árvore `ordax-os` **sem `system/surface/ui` nem `system/surface/workspace` versionados**: typecheck/build Web, execução Native, inicialização real QEMU com heartbeat da Surface e falha/rollback para a última release saudável.
6. Reconciliar PRs concorrentes de UI **no owner Surface**, sem fundir o histórico visual de volta ao OS. As propostas `ordax-os#2017`, `#2023`, `#2024`, `#2026` e `#2030` foram posteriormente comprovadas como atendidas ou substituídas por contratos atuais; o Chromium real validou notificações em quatro resoluções. PRs mistas de produto/serviços continuam exigindo avaliação separada de cada owner; a validação da Surface não equivale a aprovar suas alterações de domínio.
7. Excluir os dois diretórios visuais *tracked* do OS **somente depois** das provas anteriores, atualizar `docs/contracts/repository-ownership.json`, `docs/REPOSITORY-OWNERSHIP.md`, `docs/contracts/module-boundaries.json`, os builders, todos os checks e caminhos de deploy. Rejeitar artefatos que mantenham dois sources visuais concorrentes.
8. Integrar PRs necessárias apenas com CI aprovada e evidência QEMU/rollback, preferindo merge commit, sem force-push e sem tocar USB/discos físicos.

## Evidências de validação do cutover

- Revisão exata validada antes do merge: `de7fffcdda530673f3460abf069e51773627c136`; 25 workflows concluídos com sucesso (27 check-runs `success`, 2 `skipped` condicionais).
- [Creator Owner/Development QEMU offline](https://github.com/ordaxsystems/ordax-os/actions/runs/40054518523): heartbeat Native, WebKit funcional, primeiro e segundo boot, framebuffer observado e desligamento/fsck confirmados.
- [QEMU portátil](https://github.com/ordaxsystems/ordax-os/actions/runs/40054518613): boot assinado, UEFI e fallback one-shot. O teste específico de assinatura Ed25519 inválida foi `skipped`; a homologação física Stable não foi executada.
- [Foundation](https://github.com/ordaxsystems/ordax-os/actions/runs/40054518560), [Supervisor](https://github.com/ordaxsystems/ordax-os/actions/runs/40054518549), [consumidor externo](https://github.com/ordaxsystems/ordax-os/actions/runs/40054518602) e Web aprovaram a mesma revisão.
- A árvore Git do merge da `main` foi inspecionada recursivamente: `system/surface/ui/` = 0 arquivos e `system/surface/workspace/` = 0 arquivos rastreados. O host Native e os contratos do OS permanecem.
- **Gates ainda independentes:** prova física, publicação Stable assinada e validação do canal em hardware. O workflow Owner/Development de `push main` pode produzir apenas seu próprio prerelease de desenvolvimento após nova CI; ele não constitui promoção Stable.

## Fronteira de segurança

Nenhuma etapa permite alteração de kernel, Buildroot, partições, disco físico, assinatura/release trust, grants ou bypass de checks. Um bundle que compile **não equivale** a heartbeat Native nem prova de rollback. O corte da fonte visual está completo em Git; somente os gates de release/ativação e prova física mantêm seus próprios status. Não confundir `canonical` da fonte com lançamento aprovado.

## Controles de revisão

- [Surface source e histórico](https://github.com/ordaxsystems/ordax-surface/pull/1)
- [Source owner CI e evolução](https://github.com/ordaxsystems/ordax-surface/pull/2)
- [Consumidor no OS — integração concluída](https://github.com/ordaxsystems/ordax-os/pull/2192)
- [Cutover visual na main do OS](https://github.com/ordaxsystems/ordax-os/pull/2198)
- [Workflow CI pós-cutover](https://github.com/ordaxsystems/ordax-os/pull/2209)
