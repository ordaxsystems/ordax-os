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


## Recuperação USB Dev pelo computador — 19/10/2026

### Observação do boot físico após o reparo (foto do notebook — 19/10/2026)

Uma foto da Surface do notebook após o reparo mostra a página **Sistema →
Atualizações**, com o commit técnico **`32919734`**, correspondente ao checkout
recuperado. A interface gráfica abriu; a tela apresenta **Entrega 1188**,
**Sem conexão para atualizar**, **Falha** no estado da última verificação,
**`remote-check-failed`** no diagnóstico e nenhuma ação/base pendente.
O horário registrado na tela está em **31/12/2015, 21:15** — incompatível
com a data do ensaio em 2026. A foto por si só não demonstra IP, DNS,
Wi-Fi funcional, TLS válido, a versão efetivamente ativada de todos os
componentes, nem sucesso de um reinício físico subsequente.

A consulta remota nesse perfil Owner/Development é realizada pelo
**Supervisor existente** via `git ls-remote --heads origin`, com timeout
limitado; na falha, ele registra `remote-check-failed` e mantém a Surface
funcionando. É incorreto tratar esse código como falha de checkout ou
diagnosticá-lo automaticamente como queda de Wi-Fi. A diferença de data
também torna relógio/NTP e validação TLS hipóteses relevantes **não
confirmadas**. Existe sincronização NTP tanto no helper de rede quanto no
runtime gráfico; observar seu início não comprova sincronização.

**Próximo diagnóstico, somente leitura e no próprio dispositivo**: confirmar
`date -u`, o estado publicado em `/run/ordax-network-status`, os registros
de `/run/ordax-surface/time-sync.log` e
`/run/ordax-surface/network-broker.log`, e o erro específico em
`/run/ordax-update/update.log`. Diferenciar link/IP, DNS, NTP,
TLS/certificados e Git remoto nessa ordem. Esses caminhos em `/run`
podem desaparecer no reboot; capturar apenas trechos **sem dados
sensíveis**, não publicar configurações WPA, cookies, tokens ou logs
brutos de usuário. Não executar `ordax-network` como suposta leitura,
pois esse helper pode modificar o estado de rede.

A correção do ciclo de vida Wi-Fi está isolada na PR **#2001**, ainda não
integrada; a recuperação de checkout é a PR **#2003**. A observação
física **aprova somente Surface visível e SHA exibido**, não saúde da
rede, pull remoto, ativação integral do runtime, reboot nem Stable/MVP.



Este é um **procedimento Owner/Development de recuperação offline**, usando o
mesmo contrato e o mesmo binário canônico `ordax-pull` da mídia. **Não** é
outro gestor de atualização, gravador físico nem um fluxo Stable/MVP.

### Ocorrência física e resultado verificado

- Uma imagem Owner USB do commit `52b7d73dc4e3bd9f3cd5626efa6d48863b66254f`
  inicializou no notebook. A interface exibia `atomic-checkout-failed`.
- O diário diagnóstico persistente confirmou tentativas repetidas de
  `fetching → validating → pull-error` para commits válidos da `main`.
  O journal não contém a causa interna da falha do processo `ordax-pull`.
  **Não atribuir essa falha a rede, Git, ext4 ou falta de espaço sem o log
  específico do processo.**
- Com a mídia desligada e transferida ao host Windows, o USB correto foi
  identificado por modelo, serial, barramento e layout de três partições.
  O disco interno foi excluído do escopo. O ext4 pôde ser inspecionado em
  WSL 2 usando `usbipd` e montagem `ro,noload`; a tentativa de
  `wsl --mount` direto não funcionou nesse host.
- Foi feito backup completo **antes de qualquer montagem RW** em
  `tar.gz`, com verificação posterior de integridade `gzip -t = 0`.
  A cópia contém dados locais/credenciais: **não publicar nem anexar
  como artefato GitHub/CI**.
- No Linux de recuperação, o `ordax-pull` existente foi executado com os
  paths canônicos apontando para a partição ext4 **desmontada do notebook**:
  `ORDAX_WORKTREE=<montagem>/dev-base/workspace/ordax`,
  `ORDAX_STATE_DIR=<montagem>/dev-base/state/ordax` e
  `ORDAX_UPDATE_RUN_DIR=<diretório temporário no host>`.
  O script produziu `checkout atomico ativado` em
  `329197346239ec673cf49ec83fa93c3298b64d00`.
  O estado `current-commit` coincidiu com `HEAD`;
  `previous-commit` preservou `52b7d73d`; o checkout ficou limpo.
  Os helpers instalados `ordax-pull` e `ordax-run` foram comparados
  byte a byte com suas fontes no checkout novo. O `git fsck
  --connectivity-only` terminou com saída zero (objetos dangling não
  significam corrupção).
- Ao finalizar, houve `sync`, `umount` bem-sucedido e
  `usbipd detach`. O Windows voltou a identificar o mesmo USB; nenhuma
  regravação RAW/Creator ou formatação foi executada.

### Gates antes de executar novamente em outra mídia

1. USB **fisicamente fora do notebook**. Identificação positiva por
   barramento USB, serial e GPT; abortar se o disco estiver em boot,
   for interno, ou não houver correspondência exata.
2. Montagem inicial **somente leitura e sem replay de journal**
   (`ext4 -o ro,noload`), com cópia do estado e dos dados de usuário
   para um destino privado no host. Verificar **a conclusão** do backup.
3. Ler `current-commit`, `previous-commit`, `first-run.json`, o
   diário diagnóstico e `.git/HEAD` sem imprimir credenciais em logs
   públicos. Confirmar que o source `main` é descendente do checkout
   anterior e que o Git local não possui alterações não preservadas.
4. Somente depois de backup íntegro e origem confirmada, executar o
   **`ordax-pull` canônico** no Linux de recuperação, fornecendo
   paths explícitos. Não fazer `git reset --hard`, sobrescrever
   `.git`, trocar `current-commit` manualmente, desativar validações
   de origem nem copiar rootfs de outra mídia.
5. Confirmar `HEAD == current-commit == dev-helpers-sha`, worktree
   limpo, helpers idênticos, `previous-commit` preservado, integridade
   Git e limpeza dos diretórios de transação; `sync` e `umount`.
   O método de attach do WSL deve ser revertido antes de remover o USB.
6. **Gate físico pendente:** iniciar o USB no notebook, confirmar SHA
   exibido, Surface, Wi-Fi, atualização e reinício verdadeiro. O
   `runtime-surface-sha` e o `staged-release-sha` do último boot podem
   continuar referindo a versão anterior até o runtime novo passar no
   health gate. **Não forçar esses marcadores.**

A recuperação acima comprova a troca **do checkout Git**, não a causa
original de `atomic-checkout-failed` no hardware, nem promoção
de Base A/B, nem aprovação do USB Stable/MVP. A análise durável da causa
deve obter o log específico do processo `ordax-pull`; o código genérico
do Supervisor é insuficiente.

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

Activation remains deliberately split by layer. The development owner now consumes the exact `dev-base-ready-sha`, revalidates `ORDAX-ESP`, and stages kernel/initramfs into the inactive A/B slot while preserving the known-good current and recovery entries. It then publishes an activation-readiness proof for the same SHA. **Runtime one-shot arming is still intentionally disabled**: `LoaderEntryOneShot` and the reboot handoff remain behind the systemd-boot counting/fallback gates, so staging alone never changes which entry boots next.

The development rootfs is materialized under `/ordax/dev-base/versions/<commit>` and is selected only when an authorized candidate boot supplies matching `ordax.base_candidate=<commit>` and `ordax.base_slot=a|b`. The seed `/ordax/dev-base` starts first; `ordax-dev-init` then pivots into the exact versioned root while preserving `/state`, `/workspace`, `/home`, `/proc`, `/sys` and `/dev`. After a real candidate boot, the persistent owner is already wired to the existing fail-closed promotion gate: cmdline identity, Base heartbeat, checkout SHA, Surface health, Surface heartbeat and boot ID must all agree before the candidate can become current. Promotion preserves the previous slot as recovery, removes the candidate marker and does not request another reboot.

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
