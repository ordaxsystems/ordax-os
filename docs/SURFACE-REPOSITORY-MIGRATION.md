# Migração OrdaX Surface — rastreamento da separação

**Estado:** `integration-candidate`. O cutover **não foi promovido**.
**SSOT da revisão externa:** [`docs/contracts/surface-source.json`](contracts/surface-source.json). Não repetir a revisão da Surface neste documento ou criar uma segunda resolução de versão.

## Decisão de ownership

- `ordaxsystems/ordax-surface`: fonte de componentes e recursos visuais `system/surface/ui/` e `system/surface/workspace/`; mantenha layout e import paths durante a transição.
- `ordaxsystems/ordax-os`: `system/surface/runtime/`, `system/surface/bin/`, `system/surface/entrypoint`, `system/composition/`, `system/adapters/`, `system/services/`, `system/contracts/`, Guardian, Supervisor, boot e distribuição.
- `ordaxsystems/ordax-apps`: aplicativos first-party removíveis; nenhuma cópia da Surface.
- **Contrato de ownership oficial ainda não alterado:** `docs/contracts/repository-ownership.json`. Atualizá-lo apenas junto à remoção do último source visual versionado no OS, após a validação da entrega de release e rollback.

## Evidências obtidas

1. `ordax-surface#1` importou o Git history de `ui/` e `workspace/` a partir de commit OS imutável. 157 Git blobs e modos foram conferidos contra a revisão original; merge commit com histórico preservado.
2. O gate de integração Web + Native no repositório Surface validou import source/OS no runner isolado.
3. `ordax-surface#2` corrigiu o CI de evolução: a proveniência histórica continua fixa, mas cada alteração visual nova é conferida contra o **commit Surface HEAD** e executa testes cruzados.
4. `ordax-os#2192` introduz lock de source, materialização de checkout exato, teste de recusa de mutações/symlinks/revisão incorreta e prova de build Web+Native com a fonte externa.
5. O consumer em CI remove as árvores antigas **somente em checkout descartável**, materializa a versão externa e monta as mesmas interfaces esperadas por `system/composition`. A saída do empacotador canônico `tools/release-bundle` é gate desta PR.

## Montagem canônica de release em validação (PR #2194)

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

Essa evolução **ainda não altera** o Supervisor Owner/Development, nem
comprova cold-health, QEMU ou rollback. O source visual antigo continua
rastreado no OS até a prova de boot sem essa cópia e a reconciliação
do ownership formal no cutover. O pipeline Native oficial exige validação
CI antes de integração dessa etapa.

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
iniciar/reiniciar a Surface, sem fallback para a UI antiga. Com o lock
`integration-candidate` atual, o comportamento antigo permanece;
portanto, é possível distribuir esta capacidade de staging **antes**
do cutover e remover as cópias do OS numa etapa posterior.

Limite desta PR: a prova integrada de Owner update/rollback com checkout
efetivamente sem árvores visuais, boot a frio e hooks de Guardian ainda
é gate obrigatório; testes Git isolados não substituem a prova do dispositivo.

## Falta para remover a implementação antiga

Os itens abaixo são **gates**, não autorizações de pular testes.

1. Integrar ao **pipeline canônico de materialização do OS** a fonte Surface verificada, sem segundo updater, sem publicar um source Git espelhado no OS. `tools/surface-source/materialize.py` é a ferramenta de stage de build; o release final continua sob `tools/release-bundle` e canais assinados do OS.
2. Corrigir dependências internas da UI que atravessarem a fronteira entre repositórios: consumir capabilities/ports públicos existentes, sem conceder autoridade de serviços à interface e sem criar bridges permanentes. Checar source graph no Web build e browser host no Native.
3. Para `owner-development`, preservar a transação do **Supervisor**: provisionar o source imutável como parte do mesmo candidato e validá-lo antes do checkout/health; em falha de rede, continuar com a release conhecida como boa. O Supervisor não deve buscar `main` da Surface independentemente da versão travada no OS.
4. Para `stable-mvp`, inserir bytes da interface no bundle oficial verificado e assinado; não exigir Git ou rede na inicialização do dispositivo. O source SHA da Surface deve ficar na evidência/proveniência da release, mas não substituir a identidade do OS.
5. Provar em CI o uso de uma árvore `ordax-os` **sem `system/surface/ui` nem `system/surface/workspace` versionados**: typecheck/build Web, execução Native, inicialização real QEMU com heartbeat da Surface e falha/rollback para a última release saudável.
6. Reconciliar as PRs concorrentes de UI sobre a **Surface owner**. `ordax-os#2026` e tipagem de `#2016` já têm equivalentes no source; `#2030` colide com contrato atual de CSS Native e demanda tratamento no Web composition; `#2024` mudou de token de tamanho e não se aplica cegamente; primeiras execuções de CI de `ordax-surface#2` demonstraram a incompatibilidade.
7. Excluir os dois diretórios visuais *tracked* do OS **somente depois** das provas anteriores, atualizar `docs/contracts/repository-ownership.json`, `docs/REPOSITORY-OWNERSHIP.md`, `docs/contracts/module-boundaries.json`, os builders, todos os checks e caminhos de deploy. Rejeitar artefatos que mantenham dois sources visuais concorrentes.
8. Integrar PRs necessárias apenas com CI aprovada e evidência QEMU/rollback, preferindo merge commit, sem force-push e sem tocar USB/discos físicos.

## Fronteira de segurança

Nenhuma etapa permite alteração de kernel, Buildroot, partições, disco físico, assinatura/release trust, grants ou bypass de checks. Um bundle que compile **não equivale** a heartbeat Native nem prova de rollback. Não atualizar o status para `cutover-complete` até que o código visual antigo desapareça do OS e as provas acima estejam anexadas ao PR de integração.

## Controles de revisão

- [Surface source e histórico](https://github.com/ordaxsystems/ordax-surface/pull/1)
- [Source owner CI e evolução](https://github.com/ordaxsystems/ordax-surface/pull/2)
- [Consumidor no OS — integração ainda candidata](https://github.com/ordaxsystems/ordax-os/pull/2192)
