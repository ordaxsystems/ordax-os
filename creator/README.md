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

The OS-owned \`creator/tools/owner_dev_usb_update_preflight.py\` is a
read-only **feasibility gate**, not a second updater. On the authorized
Windows host, pass the explicit physical disk number and USB serial;
the script discovers ORDAX-DATA and the compatible Base cache itself,
verifies the \`ordax-os/main\` Git source and published manifest, and runs
the already-owned QEMU ext4 COW staging and cold-readback evidence.
It checks the same physical USB identity before and after the proof.

The proof creates and removes a **temporary local QCOW2**. The physical
ext4/ESP are never written; a positive result must not be called
'updated', 'installed', 'bootable' or 'activated'. Neither MCP nor Creator
may infer the installed source commit from this result. The next owner
gate is the existing physical writer / readback interface with a verified
inactive-slot activation plan, **not** a new GPT updater or a simulated
success marker.

Example invocation for an already authorized DEV USB:
\`python creator/tools/owner_dev_usb_update_preflight.py --disk-number 1 --serial <physical-USB-serial>\`

No alternate Base path, QEMU path, shell string or \`--apply\` is accepted.
If any physical identity, publisher, rootfs or QEMU check fails, this
operation exits unsuccessfully without touching the USB.
