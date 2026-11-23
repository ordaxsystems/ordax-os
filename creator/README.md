# OrdaX Creator — módulo nativo do monorepo

**SSOT:** ordaxsystems/ordax-os/main, diretório creator/.

O aplicativo Win32 existente e o Core Go compartilham este módulo. Criar, reparar e atualizar USB usam contratos do OrdaX OS. O OS produz e verifica entregas; o Creator verifica o candidato e o alvo removível, exige consentimento para gravação destrutiva e executa seu adaptador USB com readback. ordax-pull pertence ao OS em execução e não é duplicado no Windows.

## Código

- cmd/ordax-creator-app/ — UI Windows e botão Atualizar pendrive.
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

The OS-owned Base channel and the Creator's existing Win32 raw-disk
lease/readback are the authorities; do not implement a second updater in MCP.
The `portable_update_windows.go` path is for a different **two-partition**
Portable profile and does not authorize writes to this three-partition USB.
The Win32 raw backend is still gated behind `ordax_raw_backend` for tests;
the actual Owner DEV incremental writer must consume this bundle under the
existing disk/volume lock, verify current device identity and all preimage
hashes, write only proven bounds, flush and read back all postimages. It
must separately stage/activate the inactive ESP slot using the OS Update
Engine; this read-only preflight does not claim to accomplish either step.
