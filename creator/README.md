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
O resultado é staged-not-activated: não muda a entrada de boot,
não grava EFI NVRAM e não comprova que a mídia física foi atualizada.

O Creator Windows precisa primeiro atestar que ESP e ext4 pertencem ao
mesmo USB autorizado, disponibilizar acesso Linux real à ext4 e exigir
readback após as escritas. Uma pasta NTFS ou exFAT não substitui a montagem
ext4; invocar o produtor diretamente no Windows é bloqueado. Até que esse
adaptador físico seja conectado e validado, o botão Owner DEV continua
sendo transporte Git/Base, não instalação direta.

## Desenvolvimento e distribuição

O resolvedor em ../.github/actions/resolve-creator-source/ valida a versão de creator/ contida no próprio commit do OS. Workflows e releases pertencem ao ordax-os; os contratos de mídia, assinatura, atualização e publicação ficam em ../docs/contracts/ e produtores em ../tools/creator/.

Testes locais focados: executar go test ./... neste diretório quando houver toolchain Go 1.27, sem disco físico. O Creator não recompila Base/kernel/Surface por mudança de interface. Builds físicos e publicação Stable exigem gates específicos.

A origem histórica ordaxsystems/ordax-creator foi importada de 8a23779346cbe78ea022d3eb00640fa912840689. O histórico da origem registra proveniência, não dependência executável.
