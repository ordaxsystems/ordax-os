# OrdaX Creator — módulo nativo do monorepo

**SSOT:** ordaxsystems/ordax-os/main, diretório creator/.

O aplicativo Win32 e o Core Go compartilham este módulo. **Instalar OrdaX**
usa a mídia oficial assinada para a primeira instalação ou para recriar um USB
que precisa de recuperação. O Creator verifica a entrega e o alvo removível,
exige confirmação para recriar o disco e lê de volta os bytes gravados.
A atualização normal do USB usa o [Supervisor do OrdaX](../docs/RELEASE-CHANNEL.md#atualização-do-usb-portable-v2)
no sistema em execução. **Atualizar ou Reparar USB** preservando dados no
Windows é uma evolução posterior. Os testes do adaptador Windows permanecem
no backend de homologação.

## Código

- cmd/ordax-creator-app/ — UI Windows de instalação e recuperação.
- core/, host/, internal/ — plano, validação, seleção de disco e execução segura.
- appchannel/, componentchannel/, physicalchannel/, update/ — consumidores verificadores existentes.
- tools/ — integração e sincronização Owner Development, sem rebuild do kernel.
- go.mod — módulo github.com/ordaxsystems/ordax-os/creator.

## Ponte offline da Base DEV

O produtor canônico system/services/base-update/dev_stage.py com a opção
--offline-materialize-rootfs materializa rootfs.tar já validado pelo canal
DEV no armazenamento de versões ext4 previamente montado e utiliza o
mesmo stager A/B para o kernel e initramfs no slot EFI inativo.
O canal Git/HTTPS precisa confirmar a revisão solicitada e o manifesto
publicado da Base antes de qualquer materialização. O resultado é
staged-not-activated: não muda a entrada de boot,
não grava EFI NVRAM e não comprova que a mídia física foi atualizada.

O Creator Windows precisa primeiro atestar que ESP e ext4 pertencem ao
mesmo USB autorizado, disponibilizar acesso Linux real à ext4 e exigir
readback após as escritas. Uma pasta NTFS ou exFAT não substitui a montagem
ext4; invocar o produtor diretamente no Windows é bloqueado. Até que esse
adaptador físico seja conectado e validado, o botão Owner DEV continua
sendo transporte Git/Base, não instalação direta.

## Prova Linux descartável no Windows

O módulo creator/tools/owner_dev_qemu_filesystem_proof.py reutiliza os
artefatos Base publicados e o validador OS de dev_channel.py para gerar um
initramfs temporário com BusyBox, iniciar o kernel OrdaX em QEMU e materializar
um rootfs.tar verificado num disco virtual temporário. O segundo boot do
mesmo disco virtual remonta em modo somente leitura e confere SHA-256.
O teste usa ext2 montado pelo driver ext4: não é prova do acesso físico à
partição ext4 do USB, nem valida boot do sistema completo.

O QEMU recebe apenas arquivos temporários. A ferramenta pode ler artefatos
já transportados em ORDAX-DATA para copiá-los, sem escrever nela; não recebe
PhysicalDrive, não modifica USB/EFI, não altera ativação ou boot real e nunca
autoriza escrita física. Não há instalação de distribuição externa, rebuild
do kernel ou segundo Update Engine. A ponte física segura e seu readback
continuam pendentes no adaptador Windows canônico do Creator.

O diagnóstico adicional creator/tools/owner_dev_qemu_partition_readonly.py
aceita somente disco USB com serial autorizado, GPT Owner DEV de três
partições e volume Linux com assinatura ext4. Antes de executar o kernel,
ele valida os bytes da Base contra a publicação compatível com a revisão Git
solicitada. O QEMU recebe exclusivamente a partição Linux com readonly=on,
e o guest monta ext4 com ro,noload, desmonta e retorna uma prova estruturada.
A identidade Windows do dispositivo é conferida antes e depois. O diagnóstico
não instala arquivos, não habilita escrita, não atualiza o boot e não constitui
permissão de gravação física.

O diagnóstico creator/tools/owner_dev_qemu_partition_snapshot.py avança
um passo: sobre o mesmo USB identificado e Base publicada, cria uma camada
QCOW2 temporária cujo backing é a partição Linux física. QEMU só escreve
na camada QCOW2; materializa o rootfs completo nela, reinicia para validar
o commit e SHA-256, depois monta a partição original em modo ro,noload
para confirmar que o marcador exclusivo do ensaio não existe na mídia.
Uma amostra física inicial/final também é comparada por SHA-256. O arquivo
temporário é descartado ao encerrar. Esse resultado não grava o USB e
não implementa um segundo atualizador: é exclusivamente uma prova para
a futura adaptação de gravação física do Update Engine canônico.

## Desenvolvimento e distribuição

O resolvedor em ../.github/actions/resolve-creator-source/ valida a versão de creator/ contida no próprio commit do OS. Workflows e releases pertencem ao ordax-os; os contratos de mídia, assinatura, atualização e publicação ficam em ../docs/contracts/ e produtores em ../tools/creator/.

Testes locais focados: executar go test ./... neste diretório quando houver toolchain Go 1.27, sem disco físico. O Creator não recompila Base/kernel/Surface por mudança de interface. Builds físicos e publicação Stable exigem gates específicos.

A origem histórica ordaxsystems/ordax-creator foi importada de 8a23779346cbe78ea022d3eb00640fa912840689. O histórico da origem registra proveniência, não dependência executável.


### Owner DEV Windows USB update preflight (MCP / Creator, no GUI)

The OS-owned `creator/tools/owner_dev_usb_update_preflight.py` is a
read-only **feasibility gate**, not a second updater. On the authorized
Windows host, pass the explicit physical disk number and USB serial;
the script discovers ORDAX-DATA and the compatible Base cache itself,
verifies the `ordax-os/main` Git source and published manifest, and runs
the already-owned QEMU ext4 COW staging and cold-readback evidence.
It checks the same physical USB identity before and after the proof.

On this Windows TCG host, the verified guest kernel required `noapic` to
avoid an IO-APIC timer panic. The read-only and COW probes share **one**
guest-only kernel command line. This setting is never applied to the OrdaX
installation or firmware boot parameters.

On Windows, QEMU may advertise the **entire physical USB capacity** for the
raw Linux volume even though the authoritative Windows partition 2 is smaller.
The Owner DEV proof shrinks only the fresh disposable QCOW2 to the exact
partition byte length before booting its guest. If the backing identity or
post-resize length differs, it fails closed; it never resizes a physical disk
or changes the GPT.

The proof creates and removes a **temporary local QCOW2**. The canonical
COW delta compiler inspects only depth-0 allocated extents and explicit zero
regions, validates their partition bounds, hashes both the prepared postimage
and the original USB preimage, and reports a bounded plan fingerprint. This
plan is temporary **evidence**, not a reusable physical-write grant; the
existing Creator writer must revalidate every preimage under its physical
volume lock before it may ever apply anything.

The physical ext4/ESP are never written; a positive result must not be called
'updated', 'installed', 'bootable' or 'activated'. Neither MCP nor Creator
may infer the installed source commit from this result. The next owner
gate is the existing physical writer / readback interface with a verified
inactive-slot activation plan, **not** a new GPT updater or a simulated
success marker.

Example invocation for an already authorized DEV USB:
`python creator/tools/owner_dev_usb_update_preflight.py --disk-number 1 --serial <physical-USB-serial>`

No alternate Base path, QEMU path, shell string or `--apply` is accepted.
If any physical identity, publisher, rootfs or QEMU check fails, this
operation exits unsuccessfully without touching the USB.

#### Host-local delta handoff (not installed)

For an authorized, three-partition Owner DEV USB, the same preflight accepts
`--prepare-host-bundle`. It first proves the published Base, cold rootfs
readback and physical USB absence in QEMU, then creates a compact **local host
bundle** under `%LOCALAPPDATA%/OrdaX/updates/creator/dev-delta/`.
It never writes to ORDAX-ESP, ORDAX-LINUX or ORDAX-DATA.

The bundle is immutable by content: `manifest.json` binds the exact
`ordax-os/main` request, published Base commit, USB serial/disk identity,
partition 2 byte geometry, every region's old/new SHA-256 and payload offset.
`delta.bin` contains only changed ext4 sectors. It is built into an isolated
temporary directory, fsynced, verified, and then renamed into the local cache.
A cached candidate is reused only after a fresh readback; corruption is an
error, not a reason to blindly overwrite it. A positive result is strictly
`prepared-not-authorized`: no raw write, no activation and **no proof of an
installed OS**.

**Critical separation:** the current QEMU stage only unpacks a verified
rootfs archive under /versions/<Base SHA> inside a disposable ext4 view
and checks a test marker. It is NOT the OS-owned
`dev_channel.materialize_versioned_rootfs` transaction and does NOT
stage the inactive ESP through `dev_stage.stage_offline_candidate`.
The real physical USB has /bootstrap and /dev-base roots, rather than
the test /versions root. Copying the proof COW blocks to that USB would
be an incorrect installation.

The filesystem bundle is deliberately restricted to purpose
`filesystem-proof-only`, `installable_candidate=false` and
`canonical_inactive_slot_staged=false`. Existing cached proof bundles
without this explicit purpose remain proof-only. The physical writer MUST
reject these files as OS installation input.

Required next gate: OS-owned offline rootfs and inactive ESP staging on
the actual USB layout, with independent boot, integrity, rollback and
device-lock evidence. Never substitute a QEMU marker or a raw block copy.

### Critério obrigatório: transporte não equivale a instalação

O Creator Owner DEV apenas copia Git/Base para `ORDAX-DATA`. Um pacote
com SHA válido, um `owner-git-update-request.txt`, o status `CURRENT`
do antigo transporte, ou um código de saída zero **não provam** mudança
da instalação Linux, da Surface, da EFI, nem boot saudável.

Os recibos canônicos de transporte agora usam
`ordax.owner-usb-git-transport/2`, com estados explícitos
`GIT_BUNDLE_CURRENT_INSTALL_UNVERIFIED` e
`GIT_BUNDLE_STAGED_INSTALL_UNVERIFIED`; trazem sempre
`evidence_type=git-transport-only`, `os_activation_verified=false` e
`installed_source_commit=null`. Recibos que tentem declarar instalação
são rejeitados. `CURRENT` isolado não é um estado de OS instalado.

A leitura física opcional `owner_dev_qemu_partition_readonly.py` mostra
`on_disk_state_commit` do volume ext4 real identificado pelo serial,
além do Git `main` quando disponível. Essa prova é estritamente somente
leitura e **não é prova de boot**: `running_revision_verified=false` e
`physical_boot_verified=false`. Se a revisão no disco divergir da
entrega, atualizar o pacote não resolveu a instalação.

Somente a confirmação da revisão efetivamente ativa após boot, junto
ao teste de saúde e à verificação de integridade/recuperação da entrega
instalada, autoriza dizer "sistema atualizado". Até essa evidência,
apresentar "arquivos preparados / instalação não verificada".

O sincronizador de diagnóstico DEV pode executar a inspeção física
exclusivamente de leitura usando QEMU e
a Base publicada compatível já transferida para o USB. O resultado é
**evidência de disco**, não boot: `DISK_STATE_DIFFERS_FROM_STAGED_GIT`
mostra lado a lado a revisão em `ext4` e o commit Git preparado;
`DISK_STATE_MATCHES_STAGED_GIT_BOOT_UNVERIFIED` continua sem comprovação
do sistema efetivamente ativo. Se o QEMU/Base ou o volume não puderem
ser provados, o Creator mostra `UNVERIFIED`, nunca presume instalação.
Nenhum caso permite `installed_source_commit` ou `os_activation_verified`
positivos no recibo do transportador. A tarefa automática de transporte não executa essa inspeção QEMU.

The OS-owned Base channel and the Creator's existing Win32 raw-disk
lease/readback are the authorities; do not implement a second updater in MCP.
The Portable Windows adapter under `creator/host/windows/` is exercised
through the tagged test backend against the **two-partition** profile.
For later checks of an already prepared package, use the same preflight
with `--reuse-host-bundle` instead of `--prepare-host-bundle`. It verifies
the latest selected OS source against the package's earlier source using the
OS-owned Base impact policy, revalidates disk/serial and partition geometry,
checks local bundle SHA-256, then reads the original physical Linux regions
again and checks every preimage SHA-256. It does **not** boot QEMU, regenerate
the Base, rewrite the cache or write the USB. A changed preimage, an
incompatible revision, a missing cached artifact or a different physical
USB blocks the reuse.

This fast read-only check does not acquire the Creator's exclusive Win32
volume lock. It is therefore advisory and MUST be repeated under that lock
by the native physical writer before any write; neither command stages EFI
or activates a new boot slot.

The Win32 raw backend is still gated behind `ordax_raw_backend` for tests;
the actual Owner DEV incremental writer must consume this bundle under the
existing disk/volume lock, verify current device identity and all preimage
hashes, write only proven bounds, flush and read back all postimages. It
must separately stage/activate the inactive ESP slot using the OS Update
Engine; this read-only preflight does not claim to accomplish either step.

### Separação do Creator do OS no caminho de gravação

O aplicativo Windows é distribuído e atualizado como consumidor do
canal de componentes. A mídia física agora só pode ser fornecida
pelo canal Portable assinado e adquirida na revisão online válida.
O antigo `legacy-owner` com `ordax-bootstrap-seed.raw.gz` incorporado
não é mais uma autoridade da UI para criar/atualizar USB; falha ao
invocar gravação. Um cache de mídia assinado pode servir para
diagnóstico, mas falha na aquisição online não autoriza escrever.
O Creator não deve ser recompilado quando mudar apenas o OS: o
canal de mídia publica os artefatos; o app verifica assinatura,
anti-rollback, identidade e readback antes de gravar. Sem release
Portable assinada, criação/atualização física ficam indisponíveis
em vez de reinstalar versão antiga.

### Proteção contra mídia antiga no publicador Owner DEV

O código da interface Creator e o conteúdo executável da mídia USB são
autoridades distintas. Antes de divulgar um EXE novo, os comandos do
publicador `status`, `stage` e `package` comprovam que o
`source_commit` da mídia publicada é ancestral da `main` exata
e passam todo o intervalo pelo classificador canônico
`tools/ci/creator_owner_impact.py`. Mudanças apenas no consumidor
Windows `creator/` não exigem rebuild da Base; mudanças na Surface,
kernel, boot, Supervisor ou entradas desconhecidas exigem nova mídia.
Se houver diferença material, a publicação falha com
`OBSOLETE_OS_MEDIA`. Verificar SHA de um pacote antigo não basta
para declará-lo atual.

A mídia publicada em 2026-11-16 com `c1484313` é um exemplo
histórico de boot QEMU e não representa o OS atual. Nunca substituir
o sistema real do USB por essa versão para fazer a UI parecer atual.
A correção do Wi-Fi demanda gerar e provar novo runtime Surface com
Python/OpenSSL, publicar a mídia e somente depois liberar a escrita
física com confirmação/readback e prova de boot.
