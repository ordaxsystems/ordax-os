# Owner USB Dev — recorrência de falha ext4 (21/10/2026)

Status: **INVESTIGAÇÃO / BOOT FÍSICO BLOQUEADO**. Não promover a mídia a saudável, não divulgar correção definitiva e não regravar ou executar `fsck` físico sem evidência integral preservada.

## Fonte e sequência verificada

- Mídia física de desenvolvimento USB, raiz `ext4` (partição Linux; sem envolvimento do SSD interno).
- Verificação `e2fsck -fn` anterior ao primeiro reparo: lista de inodes órfãos inválida, divergências de bitmap e contadores, saída com erros.
- `e2fsck` físico realizado em etapa anterior e `e2fsck -fn` de confirmação sem erros: **10.243 arquivos / 358.362 blocos**. A verificação de referência foi registrada por volta de **05:35 UTC**.
- Registro do sistema posterior: aplicação de código por volta de **06:36 UTC**, reinicialização solicitada; último estágio de energia persistido `filesystem-sync`. Registro de montagem do kernel com `ext4_orphan_get` / `EFSCORRUPTED` em **07:00:45 UTC**.
- Após essa nova falha física de boot, `e2fsck -fn` exclusivamente leitura retornou **código 4**. Encontrou inodes órfãos **623, 7473, 10422**, inode excluído **10782** com `dtime=0`, divergências de bitmaps/contadores e **12.057 arquivos / 364.552 blocos**. Esses inodes diferem dos da primeira ocorrência.
- Uma segunda imagem forense independente, anterior a novo reparo, foi preservada com **8.053.063.680 bytes**, foi submetida a SHA-256 e promovida de `.partial` para `.img` **após** o cálculo. O recibo de hash está armazenado no host Windows com a imagem; a primeira imagem e a cópia de trabalho anteriores continuam separadas. Não publicar arquivos brutos: podem conter dados de usuário.
- O Windows diverge entre interfaces: `Win32_DiskDrive.Size` indicou **8.052.549.120 bytes**, enquanto `Get-Disk -Number 1` indicou **8.053.063.680 bytes**, coincidente com a imagem, a GPT (LBA de reserva 15.728.639) e a leitura física realizada. Logo **não** classificar a GPT como fora da capacidade real só por `Win32_DiskDrive`. Nenhuma das duas respostas prova saúde da flash.
- Revalidação independente no WSL recuperado: imagem forense aberta por `losetup --read-only --offset 269484032 --sizelimit 6708789248` como loop não montado; UUID `31fae013-727a-4d65-9134-241c34781919` confirmado; `e2fsck -fn` retornou **4**, reproduzindo os inodes 623, 7473, 10422 e 10782 e as divergências de contadores/bitmaps documentadas. Imagem original não alterada.
- Comprovante SHA-256 registrado antes da promoção da cópia forense: `39e5e768f23451d3dd8d1108775214d7bd5142756d7674aa952310aeafdce791`.
- O WSL dedicado à recuperação apresenta chamadas presas; as tentativas de consulta e encerramento isolado não forneceram confirmação de sucesso durante esta sessão. Nenhuma escrita física ou novo `fsck` de reparo foi executado nesta retomada.

## Distinção entre constatação, hipótese e correção

**Constatação:** a corrupção reapareceu **depois** de um `e2fsck` físico verificado como íntegro. Não é evidência de que o reparo inicial foi apenas aparente.

**Hipóteses ainda NÃO comprovadas:** sincronização/encerramento incompleto de montagens ext4 graváveis; falha de write-cache/flush USB; problema físico de flash/controlador; ou interação com o caminho de atualização.

**Código auditado:** `system/entrypoint` (Guardian) realiza quiescência e `sync`, mas o modo Owner USB Dev passa a `/bin/busybox reboot -f` / `poweroff -f` sem testemunha de desmontagem/remontagem somente leitura de **todas** as montagens persistentes; `bootstrap/initramfs/root/init` rejeita ext4 não íntegro e oferece recuperação `ro,noload`, sem reparo automático. É uma proteção importante, porém não uma solução de causa raiz.

## Evidência adicional de 21/10 — ensaio de reparo sobre imagem clonada

- A imagem da recorrência (`8.053.063.680` bytes, SHA-256 `39e5e768f23451d3dd8d1108775214d7bd5142756d7674aa952310aeafdce791`) foi clonada para uma nova **cópia de trabalho**, sem escrever no USB físico. SHA-256 do fluxo de cópia verificado idêntico ao recibo preservado. Imagem forense original permanece intocada.
- Dispositivo loop **somente da cópia de trabalho**, com offset `269484032` e extensão `6708789248` bytes; UUID ext4 validado antes de reparar.
- `e2fsck -fy` na cópia: **código 1** (corrigiu metadados e recuperou journal); corrigiu inodes órfãos 623, 7473 e 10422, e inode 10782 com dtime inválido; regularizou bitmaps e contadores. Arquivos: `12.057 → 12.053`, blocos: `364.552 → 364.538`.
- Verificação completa posterior na mesma cópia com `e2fsck -fn`: **código 0**, `12.053/409.600` arquivos e `364.538/1.637.888` blocos. Sem novas inconsistências detectadas. **Isso valida o método de recuperação, não a durabilidade da mídia ou a causa raiz.**
- Código: removido fallback automático de `/proc/sysrq-trigger` para `b/o` do Guardian em `system/entrypoint`, com atualização do teste de contrato. Commits `7cae1b7f` e `f3af5f2c`. Eliminar esse caminho de reset não demonstra que `reboot -f` com múltiplos bind mounts duráveis esteja seguro.
- **Estado físico neste checkpoint:** USB original ainda sem reparo adicional nesta retomada; não marcar como recuperado. Manutenção do host e validação física continuam gates independentes.

## Gates para liberar novamente o pendrive

1. Não modificar a segunda imagem forense nem a imagem inicial. Registrar hash do arquivo final e confrontar com o recibo original; verificar se geometria/tamanho de Windows e Linux descrevem exatamente o mesmo dispositivo.
2. Recuperar a capacidade de manutenção Linux sem desligar outros projetos/hosts; `e2fsck` em **cópia de trabalho nova** da imagem da recorrência primeiro; classificar perdas, reparos e `lost+found`, comparando com a primeira ocorrência.
3. Com backups e identidade do disco comprovados, validar eletricamente/por leitura a mídia. Planejar teste completo de escrita/leitura **somente em mídia vazia ou substituta**, nunca sobre a instalação sem novo backup.
4. Corrigir na implementação canônica o desligamento/reinicialização e a transação update→power, com prova de quiescência de todas as montagens persistentes, persistência de registros e cenários de falha; não introduzir sequências de `reboot` concorrentes ou um script duplicado no USB.
5. Provar em imagem/QEMU: atualização, reinício, falha de alimentação simulada e comportamento de recuperação. Depois comprovar em hardware real múltiplos ciclos consecutivos e `e2fsck -fn` **fora da montagem** após desligamento completo, incluindo logs do kernel e registro de SHA aplicado.
6. Somente então reabilitar boot normal; erro de mídia não é resolvido por rollback Git. Rollback A/B fica restrito a erro de release/software.

## Política operacional

Sem `fsck -y` automático indiscriminado, sem montagem `rw` de ext4 sinalizado como corrompido, sem uso de `sysrq b` como caminho nominal, sem novo Creator/reflash como substituto de diagnóstico. Não considerar `Win32_DiskDrive.Status=OK` um teste de integridade física.

Este registro serve como checkpoint canônico de continuidade. Revisar após obter as evidências dos gates, mantendo separadas prova e hipótese.

## Recuperação física do USB — segunda-feira? NÃO: quarta-feira, 21/10/2026, 12h BRT

**Resultado de recuperação offline: aprovado. Liberação de boot físico: BLOQUEADA até correção do desligamento.**

- Windows: `Get-Disk -Number 1` confirma Lidermix `6699E36B`, `8.053.063.680` bytes, GPT. `usbipd` identifica somente o USB esperado no barramento `4-2`. No WSL os módulos `usb-storage` e `uas` precisaram ser carregados para apresentar `/dev/sde`; as partições `sde1/sde2/sde3` e a partição ext4 UUID `31fae013-727a-4d65-9134-241c34781919` foram comprovadas.
- Todas as partições estavam desmontadas antes da operação. O backup forense da recorrência e seu recibo SHA-256 foram exigidos como pré-condições; o tamanho e a assinatura dos erros ext4 foram novamente comparados *diretamente no USB físico* antes de qualquer reparo.
- `e2fsck -fn /dev/sde2` pré-reparo: **exit 4**, reproduzindo os inodes 623, 7473, 10422 e 10782, bitmap e contadores da imagem forense.
- `e2fsck -fy /dev/sde2`: **exit 1**, recuperação do journal e conserto de metadados idêntico à cópia de trabalho.
- `e2fsck -fn /dev/sde2` pós-reparo: **exit 0**, `12.053/409.600` arquivos e `364.538/1.637.888` blocos. Arquivo de evidência no host: `C:\Users\TONECOS\OrdaXUSBRecovery\e2fsck-physical-noon-{readonly,repair,postcheck}-20261021.log` (nomes exatos no script local `physical-usb-recovery-gated-20261021.sh`).
- Montagem de inspeção *somente leitura* com `ro,noload,noexec,nodev,nosuid` revelou que o checkout ativo no pendrive ainda é `e390aabdaa25ff8be1ff386e472dcc227e679884` e preserva `reboot -f`, `poweroff -f` e os fallback `/proc/sysrq-trigger`. Portanto os commits de segurança mais recentes da `main` **não** estão no pendrive. Após inspeção, a montagem foi desmontada e a distribuição WSL encerrou, devolvendo o barramento `4-2` ao estado `Shared` no Windows.
- O kernel WSL reportou na controladora USB `Write cache: disabled, read cache: enabled, doesn't support DPO or FUA`; esse diagnóstico descreve capacidades declaradas, **não** prova defeito físico.
- Experimentos exclusivamente em imagem ext4 descartável (128 MiB, com bind-mounts de root/state/home): `mount -o remount,ro <dev> <bind-root>`, inclusive via BusyBox, mudou as opções de montagens associadas para `ro`. Após desmontagem, `e2fsck -fn` retornou **0**. Isso confirma uma *abordagem candidata de vedação do superbloco*, mas **não** comprova a topologia de mounts do OrdaX após `switch_root/pivot_root`. O código de produção não foi alterado com base somente nesse ensaio.
- Próximo gate de engenharia: Guardian deve, depois de encerrados todos os agentes e controles de atualização, provar a identidade do ext4 físico e o fechamento/vedação do **superbloco** e de todas as montagens persistentes (incluindo ESP/DATA quando montadas), com testemunha de `ro` antes da transição do kernel. Falhas devem abortar com restauração comprovada, sem `sysrq`, reinícios de emergência ou segundo controlador. Reproduzir com simulação hermética da topologia real, QEMU e teste físico de ciclos sucessivos antes de autorizar usuário a reiniciar.
- **Não regravar USB, não formatar, não reiniciar notebook com este dispositivo até passar o gate de encerramento**. O ext4 está íntegro somente no checkpoint offline; qualidade da mídia sob escritas futuras permanece não certificada.

## Protótipo isolado de correção estrutural — PR #2088 (ainda não liberada)

- PR draft: https://github.com/ordaxsystems/ordax-os/pull/2088, branch `fix/owner-usb-ext4-power-seal-20261021`, cabeça inicial `0b2e6292`. **Não promover automaticamente a main ou ao USB.**
- Guardian confirma a origem ext4 e `LABEL=ORDAX` antes de tentar `mount -o remount,ro <device> /`; faz prova de todas as montagens da mesma partição por major:minor e recusa encerramento com montagens ORDAX-ESP/ORDAX-DATA ainda graváveis. Falhas de vedação e retorno do kernel exigem tentativa controlada de restauração.
- Testes locais em checkout isolado, com LF preservado, usando WSL: `sh -n system/entrypoint` e **14/14 testes aprovados** (7 transição de energia + 7 verificações ext4, aliases e FAT/ESP). Ensaio real do BusyBox em imagem descartável também aprovou.
- Gates ainda exigidos: CI completo da PR, teste de topologia real do Owner Dev com `switch_root` e `pivot_root`, QEMU com ciclo de energia e `e2fsck -fn` após desligamento, hardware real em vários ciclos. A integridade comprovada do USB físico decorre apenas do reparo offline; não confundir com aprovação da correção do Guardian.

- PR #2088 atualizada para o commit de cabeça `92fce755`: removeu a dependência de `blkid` (não instalada na Base Owner), passando a conferir origem da raiz por `/sys/class/block`, número da partição e major:minor de `/proc/self/mountinfo`. A verificação da ESP/DATA utiliza partições irmãs da raiz USB em vez de pesquisa de labels não suportada no runtime. **Owner Development Preflight e Release Bundle Tooling passaram** nesta revisão; demais CI e ensaio físico não estavam concluídos no último checkpoint.
