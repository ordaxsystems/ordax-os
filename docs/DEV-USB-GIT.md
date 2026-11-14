# OrdaX Development USB — Git-first

Status: **CANONICAL FOR THE CURRENT DEVELOPMENT USB**

## Fronteira entre o Creator USB e o ordax-pull

O Creator independente prepara uma **nova mídia USB**; durante a produção
`creator-owner-dev-git.yml` instala o `ordax-pull` e inicia o checkout Git
via `--seed-from-local`. **Depois da instalação, o Pull não depende do
Creator, de QEMU ou de recompilar kernel/Buildroot**. O Supervisor coordena
a atualização Git no Linux, com preflight, saúde e rollback; no Windows, a
materialização do canal Dev pertence a
`ordaxsystems/ordax-desktop/dev-update.cjs`, não ao script Linux nem a uma cópia de Desktop dentro do OS.

Mudanças restritas ao script `bootstrap/dev-base/ordax-pull` em uma PR são
validadas pelo workflow já existente **Owner Development Preflight**,
com testes de transação/recuperação. O classificador causal evita montar
uma segunda imagem USB nessa PR. Alterações mistas em Base, boot,
Supervisor, helper nativo ou entrada desconhecida exigem o gate USB.
Quando o Pull modificado entra na `main`, a publicação normal do USB
continua ativa até uma decisão explícita sobre o canal de distribuição.
O contrato normativo está em
`docs/contracts/build-autonomy.json#owner_dev_pull_ci`; o owner operacional
está em `docs/contracts/distribution-profiles.json`.

### Publicação de USB Dev sem sobrescrever revisões novas

O canal mutável `creator-owner-prototype` continua exclusivo da produção
física do Creator. O job serializado confere a `main` **antes do trabalho
pesado e antes do upload**: se houver commit posterior com alterações
reais no kernel, Base, Supervisor, auxiliares ou mídia USB, a publicação
antiga é descartada e a revisão mais nova mantém a autoridade. Se o
avanço for apenas documentação ou outra entrada não produtora, o ZIP
já verificado pode ser publicado com seu SHA de origem explícito.

A decisão é centralizada em `tools/ci/creator_owner_publish_freshness.py`
e registrada em `docs/contracts/build-autonomy.json`. Falha de rede,
origem diferente ou falta de ancestralidade Git interrompe o job em vez
de anunciar atualização. Isso não executa Creator nos computadores
instalados, não modifica o Pull e não substitui os testes offline/USB.

## Repetição inteligente após falhas de checkout

Depois de uma falha **posterior ao fetch**, o Supervisor guarda um recibo
atômico `native-state/git-checkout-retry` por identidade de checkout atual,
SHA candidato e motivo controlado do erro. Repetições da **mesma**
combinação seguem 15, 30, 60, 120, 240 e no máximo 300 segundos entre
tentativas; o usuário continua na última Surface saudável. A checagem da
`main` permanece ativa, e uma versão ou estado novo não herda o atraso
de outro candidato.

O botão **Atualizar agora** autoriza uma checagem manual do mesmo Supervisor
sem esperar o atraso de checkout; não força troca de versão, não contorna
preflight, saúde, confiança no Git ou rollback. Problemas no fetch conservam
o mecanismo separado de classificação/backoff de rede, e divergências
sem proveniência continuam bloqueadas pelo guard de `non-fast-forward`.
O recibo é diagnóstico local e **nunca** uma permissão de atualização.

## Recuperação automática de divergência da main (Owner/Dev)

O Supervisor continua sendo o **único owner** da transação Git-first. Uma
reescrita legítima de histórico, squash ou integração paralela pode deixar o
checkout físico limpo em um SHA que não é ancestral da `main` atual. Nesse
caso, um `git reset --hard origin/main` manual **não** é a solução: ele
descarta a prova de proveniência e rompe o rollback.

O Supervisor só permite reconciliação automática com **todos** os critérios
comprovados: perfil Owner/Development; repositório oficial e branch `main`;
HEAD igual ao recibo persistido `current-commit`; checkout limpo e metadados
Git válidos; Surface anterior saudável; nenhum pin de rollback nem commit
rejeitado; candidato exato obtido da `main` pelo fetch já validado; ancestral
comum e ausência de downgrade. A transação passa pelo mesmo preflight,
classificação de impacto, staging isolado, `ordax-pull`, health e rollback.
O Pull fixa o objeto antigo em `refs/ordax/known-good` antes de avançar:
assim o commit anterior continua recuperável mesmo fora da ancestralidade
do novo `main`. Não há segundo download remoto, merge local, novo updater
nem escrita direta de Base/ESP.

Qualquer gate não comprovado permanece bloqueado com diagnóstico
`non-fast-forward`; uma reconciliação não é permissão para substituir
um checkout com alterações locais, release Stable, outra origem, histórico
inteiramente desconectado ou candidato de downgrade. O marcador histórico
de divergência não impede a reavaliação quando o Supervisor comprova que
as condições de recuperação mudaram.

**Recuperação de transação interrompida (05/11/2026):** o contrato de motivos
do recibo `/state/ordax/pull-transaction.tsv` pertence exclusivamente a
`bootstrap/dev-base/ordax-pull:transaction_reason_valid` e é usado tanto na
gravação quanto na leitura. Uma reconciliação autenticada pode registrar
`reconciled`; esse motivo não deve ser confundido com um erro nem rejeitado
durante a recuperação offline após a troca atômica. Motivos desconhecidos
continuam bloqueados, preservando o checkout para diagnóstico. O `current-commit`
não é regravado quando já coincide com o HEAD confirmado; o refresh de helpers
e os controles de saúde/rollback do Supervisor continuam obrigatórios. Teste
direcionado: `tests/test_dev_pull_expected_sha.py`.

**Prevenção na origem:** agentes e mantenedores devem preservar a
ancestralidade de commits da `main` que podem ter alcançado dispositivos
Owner/Development. Prefira merge commits em PRs e não reescreva `main`.
Squash/rebase de uma linha já consumida por dispositivos deve ser tratado
como mudança de histórico e revisado, não como atualização trivial.

**Interface:** Sistema → Atualizações mostra motivo compreensível além do
código técnico e distingue `sourceSha` (checkout instalado) de
`runtimeSurfaceSha` (última Surface que confirmou saúde). SHAs diferentes
podem ser normais para entregas neutras; apenas sucesso transacional e health
confirmado autorizam declarar a interface atualizada. O USB físico ainda
exige observação separada; CI não equivale a atualização aplicada.

This is an owner/development profile. It does not replace the canonical product path based on signed immutable releases under `/ordax/releases/<commit>`.

## Windows Creator channel — historical packaging notes, independent source owner

The application/Core source owner is now `ordaxsystems/ordax-creator`. The OS-owned channel/workflow described below may assemble an authorized development-media candidate from an **exact pinned Creator revision**, but it is not a second Creator source and must not be used to restore Creator code under `ordax-os` or Desktop.

The Owner/Development Creator is packaged separately from the public Stable/MVP
Creator. Its GitHub prerelease is
`https://github.com/ordaxsystems/ordax-os/releases/tag/creator-owner-prototype`.
The exact asset is `OrdaX-Creator-Owner-Prototype.zip`. The complete
folder (GUI, privileged RAW writer, seed, provenance and README) must be
extracted before running `OrdaX-Creator.exe`.

### Identidade da release de desenvolvimento (SSOT)

A tag fixa `creator-owner-prototype` serve **apenas como endereço do canal**.
A referência `target_commitish` da release pode preservar o commit de sua
criação; ela **não identifica** os bytes atualmente publicados e não deve ser
usada como versão do Creator. A fonte de verdade por publicação é
`creator-owner-update.json` (`source_commit`, `version`, `sha256`, `size`).
A proveniência dentro do ZIP deve corresponder ao manifesto e ao SHA-256 dos
assets publicados. O publicador agora faz *readback* do endpoint GitHub da
release para validar os quatro assets e seus digests **após** o upload; nunca
depende de `gh release edit` ou da movimentação da tag histórica.

Em 11/10/2026, o GitHub permitiu publicar/repor assets, porém recusou
`gh release edit` com HTTP 403. Esse resultado **não autoriza ignorar um
upload não confirmado**: a validação remota de hashes, tamanhos, canal e
commit continua obrigatória para CI passar. O canal continua exclusivamente
de desenvolvimento, sem alterar autorização Stable/MVP nem gravações físicas.


Before this bundle is published, `tools/creator/verify_owner_dev_bundle.py`
checks its exact source commit, ZIP/hash manifest, member allowlist and seed
digest. This is a **developer-only** test channel; it uses ephemeral prototype
trust, not public release signing, and the Windows Creator is not
Authenticode-signed. Never publish this asset as Stable or link it as the public
`/download/` offer.

Writing a target USB is destructive: use only a disposable, positively
identified removable USB and the Creator's exact-device confirmation/UAC
workflow. Neither a GitHub merge nor an artifact build grants permission to
select or overwrite a connected device. The notebook's internal disk must
remain untouched. A newly generated Owner/Development USB already contains the exact
clean sparse runtime checkout recorded by the bundle `source_commit`; first boot does not
need a Git pull when that commit is still current. Ordinary later OS changes track `ordax-os/main` through the same Git updater; a new external Surface revision enters the product only after the OS composition explicitly adopts its exact verified lock.

No candidato de separação da Surface (#2198), a UI não é mais um arquivo
tracked desse checkout. O Creator pré-semeia no build host, antes de criar
o USB, um único slot de release com os bytes visuais da revisão Git da
Surface fixada por `docs/contracts/surface-source.json`, com hashes e
identidades de OS/Surface. O Supervisor inicia esse slot **sem rede** no
primeiro boot. Atualizações posteriores permanecem transações de `ordax-pull`
mais o staging do Supervisor; falha de rede não autoriza mutar a UI ativa.
O QEMU offline Owner do mesmo artefato é gate obrigatório antes de
integrar a mudança à `main`, sem gravar um USB real.


The development Base's kernel/rootfs A/B and bootloader upgrades have
additional promotion/fallback gates. This bundle does **not** imply that every
Base update has been physically proven, that a fresh notebook boot passed, or
that a public signed Stable release is available.

## Intelligence externa no slot Owner/Development

Quando o source lock de Intelligence participa da transação Owner/Dev, o detalhamento do staging/preseed fail-closed está em [`docs/OWNER-INTELLIGENCE-TRANSACTION.md`](OWNER-INTELLIGENCE-TRANSACTION.md). O Supervisor continua único owner da transação; enquanto `docs/contracts/intelligence-source.json` estiver `integration-candidate`, o adapter não promove a fonte externa nem cria segundo updater/canal.

## Aura local — aquisição assinada pelo Owner Dev

**Estado de entrega versus política de produto (2026-10-23).** O download
assinado após First Run descrito abaixo continua sendo o caminho de aquisição
implementado para o USB Owner/Development, **não** a meta definitiva para
instalação nova. O Creator deve pré-semeiar os mesmos bytes v4 assinados e
verificados, com Aura disponível no primeiro boot offline; reparo,
reinstalação e atualização poderão reutilizar a aquisição governada existente.
Não adicionar modelo ao checkout Git nem iniciar uma segunda instalação por
script da Surface. O pré-semeio físico Dev e a inferência no notebook seguem
sem prova conclusiva na issue #2071. O contrato pós-instalação para remoção
explícita e reinstalação está em
`docs/contracts/local-ai.json#post_install_lifecycle`; a remoção do EROFS
atual **não pode ser habilitada** antes da correção versionada da verificação
v4 de boot, que hoje exige esse arquivo.


O mesmo `system/services/base-update/orchestrator.py` que valida/enrola
`ordax-release-agent` e a trust anchor canônica solicita
`materialize-owner-dev-local-ai` depois do primeiro uso concluído e apenas
quando não existe atualização Base pendente. A operação ocorre no **mesmo
owner Base Update**, mas em processo filho supervisionado por
`system/services/base-update/agent.sh`: o ciclo crítico de Base/ESP/rollback
é executado **antes** de qualquer novo download de ~568 MiB. Se o
marcador canônico `boot-refresh-required` aparecer, o mesmo owner suspende
o worker opcional e prioriza staging e recuperação da Base. O filho é
cancelado junto com o processo de aquisição assinado, no encerramento do
owner, em atualização pendente ou no timeout, com espera de parada limitada. Seu status
fica separado em `/state/ordax/base-update/aura-status.json`.
O build/release continua CI-owned; o modelo não vem de Git, Alpine ou de
um gerenciador paralelo.

O owner vincula release imutável, trust SHA-256 e payload da prova
`docs/evidence/canonical-v4-release-proof.json` ao
`system/services/local-ai/source-lock.json` e ao pin do launcher Native.
Antes de baixar ~568 MiB, verifica capacidade disponível e preserva uma
reserva para o sistema. A aquisição é verificada pelo binário estático
publicado por hash; falhas não mudam a autorização de Base/boot/rollback.

O receipt privado `/state/ordax/base-update/aura-acquisition.json` permite
reuso sem rehash de toda a imagem a cada polling quando tamanho, inode e
timestamps do EROFS seguem invariáveis. O runtime Native continua
verificando o SHA-256 integral antes de executar. Apenas após aquisição
aceita o owner publica `/state/ordax/base-update/aura-ready.sha256`;
o observador opcional em `ordax-run` observa este sinal a cada
10 segundos, delegando a inicialização ao launcher Native, sem reiniciar
a Surface nem criar um novo atualizador. O próprio `system/supervisor`
é o **único owner do provisionamento/health da Surface**: `ordax-run`
não consulta nem anuncia novamente seu marcador. O observador de Aura
não roda verificações a cada segundo, preserva o retry de 60 segundos
e encerra seu processo de sleep no desligamento, sem deixar filho órfão.
Ausência inicial de modelo não desabilita a observação de uma entrega
assinada posterior durante a mesma sessão; o boot continua independente.

A prova de CI cobre o contrato e simulações de aquisição; não é evidência
de inferência física bem-sucedida no notebook. O gate USB Dev real da
issue #2071 continua exigido, incluindo reboot, health e prompt real.

## Aura local: lifecycle verificado no Owner/Development (source, 2026-10-21)

O `ordax-run` agora possui um adaptador estrito para iniciar e encerrar a
inferência local **somente se um EROFS exato já estiver materializado** pelo
owner autorizado de artefatos. O candidato deve estar em
`/state/ordax/local-ai/sha256/b244056dad3609357e8a70433f53f41becacd8f3bd93da3d8b23f9e99d86e11a/local-ai-runtime.erofs`,
em diretório root `0700` e arquivo root `0600`. Antes de montar, o
adaptador confere o SHA-256 e tamanho da imagem contra a prova canônica
assinada, valida arquitetura e compara o `source-lock.json` interno com
o contrato do checkout. Monta EROFS somente leitura e reutiliza
`/run/ordax/local-ai-auth/key` para o bridge de inferência já existente,
com segredo efêmero fora da Surface. O processo é iniciado/parado junto ao
`ordax-run`; nenhum prompt é reproduzido. Health/readiness continuam
com a Intelligence/Local AI Native já existente.

**Limite:** isto fecha apenas o lifecycle do payload **já instalado**.
`ordax-pull` continua Git-first e **não** busca o EROFS assinado; o fluxo
governado de publicação, aquisição, staging content-addressed e rollback do
artefato para um USB Dev que já está em uso permanece pendente em #2071.
Sem payload, com bytes divergentes ou ABI incompatível, a Aura fica degradada,
mas o boot, a Surface, recovery e a atualização permanecem utilizáveis.
Merge do source ou CI não é prova de inferência real no notebook.

## Goal

The development USB exists only to cross the boundary that Git cannot cross by itself:

```text
UEFI
 -> kernel + initramfs
 -> drivers/storage
 -> development network
 -> Git client
 -> /workspace/ordax (partial clone of main; runtime checkout = system/)
```

A **complete source checkout is not** preseeded on the USB. The Owner/Development Creator
preloads only the same bounded sparse runtime/control checkout that `ordax-pull` owns, at
the bundle's exact `source_commit`. `main` remains the sole source authority; the preload
is a disposable local cache, not a second authority.

## Recuperação do primeiro runtime gráfico — referência histórica (11/10/2026)

A ocorrência antiga de instalação incompleta do Cage/WebKit e o PATH de
recuperação estão preservados no [snapshot Git de 14/11/2026](https://github.com/ordaxsystems/ordax-os/blob/5b3ba101ac7fc347b514f0e42212c8ff96f30329/docs/DEV-USB-GIT.md).
Não usar instruções desse checkpoint como reparo vigente: verificar o
Supervisor, os helpers instalados e a saúde reais antes de qualquer ação.
Progresso de instalação não equivale a boot gráfico saudável nem a autorização
de regravação USB.

## Dimensionamento do Creator Development — 11/10/2026

O teste físico histórico de 11/10 identificou `/dev/sdb2` com **1,9 GiB usados de 1,9 GiB (100%)**. Naquele caminho Alpine/APK já aposentado, a tentativa de materializar a Surface terminou em `No space left on device`. A conclusão de capacidade permanece válida — falta de espaço não se resolve aumentando timeout/heartbeat —, mas **APK não faz parte do fluxo atual**.

O Creator Owner/Development reserva **no mínimo 5 GiB para a partição ext4**
em um dispositivo capaz de suportá-los, usando o máximo disponível até
16 GiB e preservando pelo menos 1 GiB para `ORDAX-DATA`.
Um USB de aproximadamente 8 GB recebe uma raiz ext4 de mais de 6 GiB.
Dispositivos menores que o limite explícito são recusados antes de gravar.
O perfil público/Stable continua usando `PlanPhysicalStorage` e sua própria
política de distribuição sem modificação.

O gerador da imagem, a validação da geometria GPT, o hash/readback do plano
de escrita, o backend elevado do Creator e a formatação da `ORDAX-DATA`
consomem **a mesma política Owner/Development**. Não basta mostrar uma
capacidade maior na UI; os bytes e os limites de partição devem corresponder
antes e depois da escrita.

**Mídia já preparada não cresce pelo Git**: a tabela GPT antiga mantém a
`ORDAX-DATA` imediatamente após `ORDAX`. Não tente alterar a tabela em uma
partição montada nem mover dados com comandos ad hoc. Recriar a mídia com
o Creator atualizado apaga o pendrive de destino e exige confirmação explícita
do dispositivo correto e cópia externa de qualquer dado importante.
Após regravar com o Creator atual, o checkout sparse correspondente ao `source_commit` do
bundle já estará presente; só haverá download posterior se `main` realmente avançar.
Não mexe no SSD interno. CI de imagem descartável não prova boot físico.

Para diagnóstico sem mudança de estado:

```sh
df -h / /state /run /tmp
lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINTS
```

O futuro agente de diagnóstico remoto deve iniciar no substrato Development,
antes de Cage/WebKit, e reutilizar os contratos da Platform/Runtime; **não**
deve ser instalado como dependência do runtime gráfico nem como um segundo
executor ou autoridade de permissão.

## Diagnóstico sem Surface e sem conexão remota

O Developer USB inclui `/usr/local/bin/ordax-diagnose`, um leitor local
somente de consulta executável no shell de manutenção **antes do Cage/WebKit**:

```sh
/usr/local/bin/ordax-diagnose
```

Retorna `ordax.dev-boot-diagnostics/1`: commit Git local (quando disponível),
versão do kernel, capacidade/uso/livre dos pontos fixos `/`, `/state`,
`/run` e `/tmp`, existência dos marcadores de saúde e classificações
binárias de erros conhecidos no Guardian/Surface. Não imprime logs brutos,
credenciais, senhas Wi-Fi nem comandos arbitrários. Não instala pacotes,
altera discos, busca código, abre rede ou envia nada para outro computador.
Argumentos são recusados. Falta de dados é reportada como indisponível,
não como sucesso.

Este é o produtor **local** de observações, não um agente remoto completo.
O plugin e o Runtime oficiais só poderão receber esse diagnóstico de um
notebook depois de a Platform autorizar um dispositivo real e um grant
específico; a mera observação por `ordax_targets` não autentica o Linux.
Não criar um segundo transportador remoto nem ativar uma sessão de shell
arbitrário para contornar o Product PostgreSQL. O Starter deve permanecer
independente da Surface gráfica.

## Recuperação Windows/WSL — evidência histórica (19/10/2026)

A intervenção física, SHAs e observações do notebook em 19/10 estão no
[snapshot Git imutável](https://github.com/ordaxsystems/ordax-os/blob/5b3ba101ac7fc347b514f0e42212c8ff96f30329/docs/DEV-USB-GIT.md).
Aquela execução não comprova a prontidão atual de rede, boot, Surface ou release.
Não repetir o procedimento em outro dispositivo sem identificação e autorização
explícitas; ele não é um segundo updater nem fluxo Stable/MVP.

**Limites de segurança ainda aplicáveis:** identificar positivamente o USB
removível e excluir o disco interno; inspecionar inicialmente em leitura apenas
e preservar dados confidenciais fora de artefatos públicos; conferir origem,
ancestralidade, checkout limpo e recibos; executar somente a transação
`ordax-pull` canônica, **nunca** `git reset --hard` como atalho;
confirmar `HEAD == current-commit`, integridade dos helpers, desmontagem segura
e somente então observar cold boot/Surface/rede no notebook físico. Sem essa
observação, o gate físico permanece pendente. Diagnóstico de rede/tempo não
deve expor segredos nem executar comandos que alterem estado involuntariamente.

## Atualização manual dentro do OrdaX — somente USB Owner/Dev

**Sistema → Atualizações → Atualizar agora** solicita um check imediato da `main` ao mesmo Supervisor canônico que já realiza os checks automáticos. Nenhum segundo updater ou shell de comando é ativado pela UI. O Native host expõe o pedido local `POST /__ordax/native/update-check` somente no perfil `owner-development` com `product_mode=usb`, vinculado ao token efêmero da sessão HTTP local; a solicitação aceita registra apenas `check-main` em `/run/ordax-update/manual-check-request` para acordar o polling do Supervisor em cerca de 1 segundo. A própria Surface acompanha o estado existente `/run/ordax-update/state.json`.

O botão **não desliga as atualizações automáticas**, não exige aprovação administrativa extra por check e não executa `git reset --hard`, flash, mutação direta da Base/ESP ou instalação de helpers paralela. O mecanismo único `ordax-pull` conserva origem, fast-forward, staging, verificação de SHA, health gate e rollback. Se First Run ainda não terminou ou a tentativa apresenta falha, o Supervisor publica a fase/erro em vez de alegar sucesso. HTTP 202 confirma somente **pedido aceito**, nunca commit aplicado ou Surface saudável.

A atualização do código da UI em `main` chegará ao USB pelo próprio Pull existente; um build/merge isolado não atualiza automaticamente o dispositivo físico enquanto estiver desligado no Windows. Prova funcional pendente: inicializar o notebook pelo USB, selecionar `Atualizar agora`, observar a consulta remota, o recibo e uma entrega realmente alterada.

## Daily loop

After the development base has been flashed once and the notebook can boot it:

```text
edit/commit on remote main
 -> notebook: ordax-pull
 -> notebook: ordax-run
```

`ordax-pull` tracks:

```text
https://github.com/ordaxsystems/ordax-os.git
branch: main
checkout: /workspace/ordax
materialized runtime/control paths:
- system/
- bootstrap/base-update/ (control logic only)
- bootstrap/dev-base/{ordax-dev-init,ordax-diagnose,ordax-network,ordax-pull,ordax-rollback,ordax-run}
- bootstrap/recovery/entrypoint
- selected trust/update contracts
```

A new checkout uses Git partial clone (`blob:none`) plus sparse checkout. Git commit/history metadata remains available for update/rollback. The live product tree `system/` is materialized together with the small repository-owned base-update control plane, the fixed development/recovery helper sources, and the trust/contracts they need. Kernel/initramfs binaries and build toolchains are not copied into the runtime checkout; base bytes are built separately and staged for the next boot.

After the Git-controlled supervisor is running, those fixed helper sources refresh the physical development copies of `ordax-dev-init`, `ordax-diagnose`, network, pull, rollback, run and recovery. The refresh is bounded to that allowlist and does not turn the checkout into an arbitrary root-filesystem copier. This provides the bridge needed for later Git commits to repair the pre-runtime development helpers without rewriting the USB.

Before updating an existing checkout, `ordax-pull` fails closed when:

- `origin` no longer matches the configured repository;
- the local branch is not the configured branch;
- the checkout contains local tracked or untracked changes;
- the fast-forward pull fails.

Only a successful explicit `ordax-pull` clears a rollback pin.

## Atomic Pull: reuse verified fetched Git objects

The development Supervisor owns remote discovery and fetch for one exact
`main` candidate. When it invokes `ordax-pull` with
`ORDAX_EXPECTED_SHA`, that value must equal the existing
`refs/remotes/origin/main` tracking ref in a valid local checkout and resolve
to a Git commit object. In that case, the updater must **not** re-query moving
`main` or perform a second HTTPS clone of the same repository. It prepares
its isolated candidate from the already fetched local Git objects, cloning
with `--no-hardlinks` and checking ancestry, sparse sources, remote identity,
cleanliness and the exact expected SHA before any atomic switch. The stage
remains an independently owned object directory, not a shared `.git` pointer.

A cold first checkout or an invalid/dirty checkout still uses the existing
bounded remote-clone recovery. Running `ordax-pull` explicitly without a
Supervisor-provided SHA continues to discover `main` normally. No source
validation, fast-forward restriction, transaction journal, backup or rollback
gate is bypassed.

This specifically removes an avoidable **second** network acquisition from
the healthy update path. The notebook still requires enough network access to
fetch missing objects on the **first** acquisition; not all immutable Base,
graphics, kernel and initramfs bytes are Git source-tree material. The
Stable/MVP signed release channel is separate and unchanged.

When the canonical Pull owner fails, it writes a bounded phase token into
`/run/ordax-update/pull-result` (the **existing** Supervisor run directory).
The Supervisor deletes any stale token before invoking the owner, accepts only
the known phase vocabulary and incorporates it into the existing
`state.json.lastError` response. This avoids misdiagnosing network-object
acquisition, isolated staging, atomic swap and helper activation as one
`atomic-checkout-failed` condition. An abruptly killed owner with no receipt
remains a generic failure; untrusted shell stderr is never interpreted as a
status code.

**Git checkout and installed helper activation are distinct, mandatory
conditions.** The current Git SHA is durably recorded before invoking the
existing `dev-helpers.sh` owner. If helpers cannot be activated, the Pull exits
nonzero; the Supervisor reports the *actual* post-swap Git SHA with
`pull-helper-refresh-failed`, preserves the running Surface and retries the
canonical helper refresh on later polls. It does not mark the version
`running` until `dev-helpers-sha` agrees with the active Git commit. There is
no second updater or bypass of the helper receipt, and the previous SHA remains
available for recovery. A host-side successful Pull and an actual QEMU/physical
Surface activation remain separate validation gates.

**Versioned Native exchange prerequisite (Owner/Development only):** the
canonical Dev Base builder installs the static `ordax-checkout-exchange` helper
into its rootfs. Before replacing `ordax-pull`, the existing helper installer
verifies the executable and exact `--abi` declared in the **same** manifest
(`system/services/base-update/dev-helper-manifest.tsv`). A missing or
incompatible binary is a failed helper activation, **not** permission to use
two `mv` operations or copy another executable into the running rootfs.
The existing Base Update owner acquires and verifies a Base candidate while
the healthy Surface and known-good stay in place.

If the Git checkout was committed but helpers are still pending for its
**current SHA**, the Supervisor reuses `native-state/git-checkout-retry` from
its existing post-fetch retry policy, with source=target=current SHA and
reason=`helper-refresh-failed`. The same 15–300s bounded delay applies to
repeated installations; it does **not** defer the request for a compatible
Base candidate. `Atualizar agora` bypasses only the delay, not the ABI
or health checks. The existing UI reason `checkout-retry-wait` is reused;
success is acknowledged only after `dev-helpers-sha` matches the active
checkout. No additional retry state file, polling owner or updater exists.

Before any physical rollout, verify that the Base **actually booted on the
target notebook**, that its native helper responds with the declared ABI,
and that rollback/known-good recovery remains available. CI/QEMU and a
successful Creator ZIP are not proof of that physical prerequisite.

A physical boot must confirm the repaired USB no longer cycles through
`fetching → validating → atomic-checkout-failed`. A successful host-side pull
proves only checkout semantics, not live runtime health, NTP, Wi-Fi, power or
remote MCP pairing.

## Rollback semantics

Before a pull that actually advances `HEAD`, the old commit is remembered as `previous-commit`.

`ordax-rollback`:

1. validates that the previous value is a full hexadecimal commit SHA;
2. verifies that the commit exists locally;
3. records `pinned-commit` before changing `HEAD`;
4. resets the runtime checkout to that commit;
5. records it as `current-commit`.

The pin is intentionally **sticky across reboot**. While it is present and matches the current checkout, `ordax-dev-init` skips automatic network/pull and runs the pinned runtime directly. This prevents a reboot from silently undoing a rollback.

To leave rollback mode and follow `main` again:

```text
ordax-pull
```

If the pin and actual checkout disagree, automatic pull and automatic execution are blocked and the development base falls into maintenance instead of silently choosing a version.

## Persistent state

Development Git state is stored outside the checkout:

```text
/state/ordax/current-commit
/state/ordax/previous-commit
/state/ordax/pinned-commit   # only while rollback is fixed
```

The worktree remains:

```text
/workspace/ordax
```

Both live on the persistent development root filesystem on the `ORDAX` bootstrap/proof partition used by the current owner-development USB.

## What is on the USB base

Only the development substrate is preseeded:

- UEFI boot files;
- Linux kernel and initramfs;
- storage/USB/console drivers;
- kernel modules required by the current development hardware policy;
- Ethernet and USB-tether networking;
- Wi-Fi userspace plus the firmware for the currently selected kernel modules;
- CA certificates and HTTPS support;
- Git;
- seed copies of `ordax-dev-init`, `ordax-diagnose`, `ordax-network`, `ordax-pull`, `ordax-run` and `ordax-rollback`;
- seed copy of the local recovery entrypoint.

These helper copies are bootstrap seeds, not long-term source authority: once the Git-controlled runtime bridge is available they can be refreshed from the matching repository commit. Normal OrdaX Surface/apps/services/source are not preseeded. The runtime `system/` tree arrives through Git.

## Reflash rule

A normal source change under `system/` does **not** require:

- rebuilding the whole USB image;
- reflashing the USB;
- rebuilding the kernel;
- rebooting the notebook unless that component genuinely requires it.

A base-level change is different. The small shell helper layer used by the development base is now Git-refreshable after the runtime bridge is available, so fixing `ordax-pull`, network, rollback, init or recovery does not by itself require a USB rewrite. Changes to the bootloader, kernel, initramfs, package/rootfs substrate, Git binary itself, or a driver/firmware needed before Git is reachable use the Base path rather than replacing bytes that are currently executing. The repository checkout carries the base-update control logic; the running kernel/rootfs are never overwritten in place.

For kernel, initramfs **and the development rootfs substrate**, main publishes an immutable candidate bound to the exact Git commit. The candidate contains `vmlinuz`, `initrd.gz` and a deterministic `rootfs.tar` built from the same commit. When the running supervisor observes the matching low-level commit, it keeps the current Surface running and records an exact-SHA Base request. The persistent base-update owner consumes that request through the replaceable native runtime, where Python already exists, then acquires the candidate under `/state/ordax/base-update/dev-candidates/<commit>` and atomically materializes its rootfs in the seed Base version store. Python is therefore **not** added to the minimal development Base just for update acquisition. A temporarily unavailable candidate does not block runtime/app updates; the request remains armed while `boot-refresh-required` remains present.

**UEFI efivarfs mount authority (Owner/Development):** The minimal Dev Base does not run systemd's automatic firmware-variable mount. `bootstrap/dev-base/ordax-dev-init` is the single boot owner that mounts the standard `/sys/firmware/efi/efivars` filesystem when booted with UEFI, before handing off `/sys` and the Git-owned runtime. It never mounts over an occupied target, rejects symlinks, skips non-UEFI boots, and keeps boot usable if the mount is unavailable. The persistent `system/services/base-update/agent.sh` does **not** perform another mount: its independent evidence-only `efivarfs_preflight.py` must still prove a direct, writable mount before any firmware-related activation is eligible. This mount does not write EFI variables, arm a one-shot entry, or establish a physical boot proof. An earlier physical USB log had repeatedly reported `efivarfs target is not a direct mountpoint`; the boot-owner fix is covered by isolated shell tests but still requires a fresh notebook boot and real preflight evidence.

Activation remains deliberately split by layer. The development owner now consumes the exact `dev-base-ready-sha`, revalidates `ORDAX-ESP`, and stages kernel/initramfs into the inactive A/B slot while preserving the known-good current and recovery entries. It then publishes an activation-readiness proof for the same SHA. **Runtime one-shot arming is still intentionally disabled**: `LoaderEntryOneShot` and the reboot handoff remain behind the systemd-boot counting/fallback gates, so staging alone never changes which entry boots next.

The development rootfs is materialized under `/ordax/dev-base/versions/<commit>` and is selected only when an authorized candidate boot supplies matching `ordax.base_candidate=<commit>` and `ordax.base_slot=a|b`. The seed `/ordax/dev-base` starts first; `ordax-dev-init` then pivots into the exact versioned root while preserving `/state`, `/workspace`, `/home`, `/proc`, `/sys`, `/dev` and `/run`. The handoff uses **recursive bind** for `/proc`, `/sys`, `/dev` and `/run`, otherwise nested mounts disappear: the EFI variables mount under `/sys`, devpts under `/dev`, and EROFS/overlay graphical mounts under `/run`. Ordinary state/workspace/home directories retain nonrecursive binds; failure to preserve a required subtree prevents the pivot, and existing Base activation/health gates remain mandatory. The implementation has a hermetic shell regression for the exact commands; real candidate-boot evidence remains a separate gate. After a real candidate boot, the persistent owner is already wired to the existing fail-closed promotion gate: cmdline identity, Base heartbeat, checkout SHA, Surface health, Surface heartbeat and boot ID must all agree before the candidate can become current. Promotion preserves the previous slot as recovery, removes the candidate marker and does not request another reboot.

A candidate that cannot select its exact rootfs or cannot satisfy health never becomes the known-good current entry. Disposable CI now proves physical inactive-slot staging and healthy post-boot promotion; exact one-try systemd-boot fallback and real-notebook activation remain separate gates. The UEFI fallback loader remains the final explicitly physical self-update gap.

Early boot branding follows the same rule. Anything displayed only after the development base hands control to `system/` may update with the normal Git loop. A logo/splash shown before Git exists is part of the base/initramfs path and therefore changes on the next base boot. The current prototype still uses text-mode early boot; a branded graphical splash renderer has not yet been implemented.

## Verified graphical runtime handoff

Owner/Development and Stable/MVP now start the graphical stack only from the boot owner's exact, offline **verified EROFS + ephemeral OverlayFS** handoff at `/run/ordax/runtime/native-surface/rootfs`. The Surface launcher does not install Cage/WebKit packages on first boot and does not own an Alpine/APK acquisition timeout.

The boot owner supplies `ORDAX_SURFACE_RUNTIME_MODE=verified-erofs-overlay`, the exact runtime root and SHA-256. The Surface publishes those values in its private runtime-proof context; physical proof harnesses reject missing/mismatched digests and never infer a runtime from historical filesystem layout. Owner/Development proof remains development-scoped even though its runtime bytes are verified; Stable promotion still requires the independent canonical physical gates.

A developer USB may still update Git-owned system code through `ordax-pull` when that owner path is applicable, but a missing/corrupt graphical runtime is a release/component failure, not permission to download packages at boot. Inspect `/run/ordax-surface/host.log` and the canonical boot/runtime receipts; do not restore the retired APK path as recovery.

## Network behavior

Normal unpinned boot prefers Ethernet/USB tether because no credentials are required. If neither is available and a supported Wi-Fi interface is detected, the development base asks for SSID/password and stores its WPA configuration under `/state/network/`.

On subsequent boots, the single Native network broker restores a previously saved WPA profile automatically, reusing its existing WPA association, DHCP and runtime DNS synchronization steps. Failure preserves `wpa.conf` for explicit reconnect instead of creating a second network owner or requiring the password again.

Pinned rollback boot deliberately does not require network access: if the pin is internally consistent, the known local runtime is started without an automatic pull.

The current kernel already carries the wireless stack and selected module families. Hardware outside those selected drivers may still need a future base/kernel update. Until then, Ethernet or USB tether remains the deterministic fallback.

## CI regression

`tests/test_dev_git_flow.py` exercises a real temporary Git remote and proves:

```text
partial+sparse clone
 -> system/ runtime present
 -> non-runtime tree absent
 -> fast-forward pull
 -> previous/current state
 -> rollback
 -> sticky boot pin without network/pull
 -> explicit pull releases pin
 -> dirty checkout rejected
 -> unexpected origin rejected
```

This is repository/CI evidence only. Real notebook boot/network behavior remains a separate physical gate.

## Owner/Development: first-boot Git polling sem depender do render (20/10/2026)

No USB Dev, `main` e a fonte de verdade do checkout **sparse** em
`/workspace/ordax`. O `system/supervisor` e o unico proprietario da
verificacao automatica e da ativacao em runtime; o `bootstrap/dev-base/ordax-pull`
e o proprietario da transacao Git atomica e da instalacao dos helpers de Base.
O `ordax-main-watch` e um fallback de recuperacao quando o Supervisor esta
realmente inativo, nao um segundo mecanismo de aplicacao simultanea.

A tela do primeiro uso precisa iniciar **offline**. Antes do recibo duravel
`/state/ordax/native-state/first-run.json` com `completed=true`, o Supervisor
nao consulta Git. Depois desse recibo, a descoberta de `origin/main` e
independente da conclusao do primeiro render grafico: o laço de polling continua
publicando seu estado, mesmo durante provisionamento ou espera de saude.
Porem **descoberta nao e ativacao**: nenhum candidato e aplicado enquanto a
Surface inicial nao comprovar o SHA local saudavel. O watchdog do Guardian
continua recebendo heartbeat; as janelas de provisionamento e de saude sao
limitadas por relogio monotônico, sem dependencia de NTP. Em caso de falha
inicial, mantemos a politica canonica de uma tentativa de reinicio da Surface,
rollback do candidato de boot quando possivel e recuperacao local.

### Contrato de entrega

**Transacao supervisionada:** o Supervisor valida a main por `ls-remote`, faz
`fetch` da ref exata e valida o candidato antes de entregar `ORDAX_EXPECTED_SHA`
ao unico executante atomico `ordax-pull`. Com esse SHA, o Pull **nao**
repete `ls-remote` nem baixa outra main: confere a identidade do checkout,
`refs/remotes/origin/main == ORDAX_EXPECTED_SHA` e a existencia local do
objeto commit. Falha nessa passagem e `pull-handoff-validation-failed`, nao
`network-error`. Somente o Pull manual independente, sem SHA previamente
verificado, faz sua propria descoberta remota. Nunca se usa fallback de rede
para encobrir uma entrega local invalida.

**Teste de regressao:** `tests/test_dev_pull_expected_sha.py` fecha o
remoto descartavel apos o fetch e exige aplicacao atomica offline; verifica
tambem referencia divergente e ausencia de fetch. `test_dev_git_flow.py`
exercita o fluxo completo, falhas, rollback e a convivencia com o watcher.
Logs de `/run` sao volateis: diagnósticos persistentes devem conservar a
fase de falha sem guardar credenciais e sem promover sucesso por clique.

- `git push` para `main` nao altera instantaneamente o pendrive: o Supervisor
  precisa estar rodando e online, conferir o commit, buscar os objetos e validar
  a Surface. O intervalo padrao de descoberta do perfil Dev e cinco segundos;
  transferencias, validacoes e reinicios da interface levam tempo adicional.
- Alteracoes no codigo da Surface, Native Host, modulos e configuracoes versionadas
  chegam pelo checkout Git e recarga/reinicio seletivo do runtime; um USB
  previamente instalado **nao** e modificado apenas porque a PR foi integrada.
- Kernel, initramfs, particao de boot, drivers e bootloader nao podem ser
  substituidos por `git pull` direto: pertencem a Base e aos seus gates A/B,
  de integridade e rollback, inclusive no perfil Dev.
- Em `apply_remote_checkout`, o Supervisor nao reinstala os helpers apos o
  `ordax-pull`. Este ultimo e a unica autoridade de materializacao e de recibo
  de helpers por SHA; o Supervisor pode reconciliar um recibo pendente em outro
  ciclo, sem instalacao duplicada na mesma transacao.

### Prova e limite

A imagem QEMU observada anteriormente continha primeiro uso completo, mas
`supervisor-boot-witness.json` parado em `initialized`: nao havia prova de
entrada em `poll-loop-entered`. Este reparo corrige a dependencia estrutural
que impedia o primeiro polling durante a validacao inicial.
**Testes de contrato isolados e verificacoes de shell nao equivalem a prova de
Pull no pendrive fisico**: ainda exigimos artefato Creator exato, QEMU UEFI/NAT,
recibo `git-remote-completed`, aplicacao de commit controlado, teste de
rejeicao/rollback e novo boot antes de promover a correcao.
