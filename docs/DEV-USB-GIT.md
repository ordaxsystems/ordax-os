# OrdaX Development USB — Git-first

Status: **CANONICAL FOR THE CURRENT DEVELOPMENT USB**

This is an owner/development profile. It does not replace the canonical product path based on signed immutable releases under `/ordax/releases/<commit>`.

## Windows Creator: developer installation and channel isolation (2026-10-10)

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
need a Git pull when that commit is still current. Ordinary later system/Surface changes
track `main` through the same Git owner.

The development Base's kernel/rootfs A/B and bootloader upgrades have
additional promotion/fallback gates. This bundle does **not** imply that every
Base update has been physically proven, that a fresh notebook boot passed, or
that a public signed Stable release is available.

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

## Recuperação do primeiro runtime gráfico (11/10/2026)

Em um notebook Owner/Development, a instalação inicial do Cage/WebKit pode
registrar `Installing (218/247)` e ser interrompida antes da confirmação de
saúde da Surface. Esse progresso **não é conclusão** da instalação.
A fase de aquisição do runtime e a verificação posterior da Surface possuem
orçamentos/heartbeats separados na `main`.

Uma base de desenvolvimento anterior à correção do PATH de recuperação pode
mostrar `sh: ordax-pull: not found`, apesar de ter o helper em
`/usr/local/bin/ordax-pull`. Isso decorre do PATH mínimo compartilhado da
recuperação, não prova falta de checkout nem requer novo flash. Para mídia
já inicializada, no shell local de recuperação:

```sh
ls -l /usr/local/bin/ordax-pull /usr/local/bin/ordax-run
/usr/local/bin/ordax-pull
/usr/local/bin/ordax-run
```

Execute `ordax-run` apenas depois de o pull ter sido concluído com sucesso.
Caso os arquivos não existam, registre o resultado e não tente copiar
arquivos de terceiros nem reformatar o USB. A recuperação agora expõe os
comandos no PATH **somente** no perfil `owner-development` USB e somente quando
ambos os helpers já estão presentes e executáveis. No Stable/MVP o PATH mínimo
permanece intocado; nenhum desses fluxos inicia rede, Git ou mutação automática
ao entrar no shell de recuperação. O sistema Development atualiza a cópia
pré-instalada do helper de recuperação por meio do bridge de helpers após
o supervisor se tornar operacional; a imagem física antiga não se altera
automaticamente apenas porque o repositório recebeu a correção.

## Dimensionamento do Creator Development — 11/10/2026

O teste físico identificou `/dev/sdb2` com **1,9 GiB usados de 1,9 GiB
(100%)**. `/`, `/state`, `/run` e `/tmp` compartilham essa partição
ext4. Ao instalar a Surface (Cage/WebKit), o APK mostrou
`No space left on device`, e a instalação parou antes de finalizar.
Isso não é um problema resolvido aumentando o timeout ou o heartbeat.

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

## First-boot graphical runtime provisioning (2026-10-11)

The Owner/Development notebook may need to install the replaceable native
Cage/WebKit graphical runtime after its first Git checkout. Alpine APK can
report hundreds of packages; `Installing (218/247)` is **progress**, not a
Surface health acknowledgement or proof of a finished installation.

The native launcher writes a current-boot, exact-source-SHA provisioning marker
only while its development graphical runtime is being provisioned. The system
supervisor distinguishes this bounded acquisition phase (default maximum 660s)
from the normal 30s graphical health deadline; once provisioning completes,
actual Cage/WebKit/Surface heartbeat verification must still pass independently.
The package acquisition itself is bounded (default 600s). Stable/MVP never
uses this development APK acquisition path and keeps its separately governed
health budget. The Guardian verifies a process-owned supervisor liveness marker
independently of `state.json` updates, so an active first-run install cannot be
misinterpreted as an idle/crashed supervisor.

These are source/CI changes, **not yet a new physical boot proof**. A developer
USB that has a working checkout can receive the fix via `ordax-pull` and try
`ordax-run` without reflashing the USB. If it still enters recovery, inspect
`/run/ordax-surface/host.log`, `/run/ordax-update/guardian.log` and the
runtime's `http.log` for the actual failed phase; do not remove the physical
USB safety gates or treat the historical partial APK output as proof of success.

## Network behavior

Normal unpinned boot prefers Ethernet/USB tether because no credentials are required. If neither is available and a supported Wi-Fi interface is detected, the development base asks for SSID/password and stores its WPA configuration under `/state/network/`.

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
