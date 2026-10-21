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
- **Estado naquele checkpoint anterior:** USB físico ainda aguardava reparo. O resultado posterior do reparo físico está registrado abaixo; não confundir integridade offline com segurança de reinício.

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

## Recuperação física do USB — quarta-feira, 21/10/2026, 12h BRT

**Resultado de recuperação offline: aprovado. Liberação de boot físico: BLOQUEADA até correção do desligamento.**

- Windows: `Get-Disk -Number 1` confirma Lidermix `6699E36B`, `8.053.063.680` bytes, GPT. `usbipd` identifica somente o USB esperado no barramento `4-2`. No WSL os módulos `usb-storage` e `uas` precisaram ser carregados para apresentar `/dev/sde`; as partições `sde1/sde2/sde3` e a partição ext4 UUID `31fae013-727a-4d65-9134-241c34781919` foram comprovadas.
- Todas as partições estavam desmontadas antes da operação. O backup forense da recorrência e seu recibo SHA-256 foram exigidos como pré-condições; o tamanho e a assinatura dos erros ext4 foram novamente comparados *diretamente no USB físico* antes de qualquer reparo.
- `e2fsck -fn /dev/sde2` pré-reparo: **exit 4**, reproduzindo os inodes 623, 7473, 10422 e 10782, bitmap e contadores da imagem forense.
- `e2fsck -fy /dev/sde2`: **exit 1**, recuperação do journal e conserto de metadados idêntico à cópia de trabalho.
- `e2fsck -fn /dev/sde2` pós-reparo: **exit 0**, `12.053/409.600` arquivos e `364.538/1.637.888` blocos. Arquivo de evidência no host: `C:\Users\TONECOS\OrdaXUSBRecovery\e2fsck-physical-noon-{readonly,repair,postcheck}-20261021.log` (nomes exatos no script local `physical-usb-recovery-gated-20261021.sh`).
- Montagem de inspeção *somente leitura* com `ro,noload,noexec,nodev,nosuid` revelou que o checkout ativo no pendrive ainda é `e390aabdaa25ff8be1ff386e472dcc227e679884` e preserva `reboot -f`, `poweroff -f` e os fallback `/proc/sysrq-trigger`. Portanto os commits de segurança mais recentes da `main` **não** estão no pendrive. Após inspeção, a montagem foi desmontada e a distribuição WSL encerrou, devolvendo o barramento `4-2` ao estado `Shared` no Windows.
- O kernel WSL reportou na controladora USB `Write cache: disabled, read cache: enabled, doesn't support DPO or FUA`; esse diagnóstico descreve capacidades declaradas, **não** prova defeito físico.
- Experimento inicial de ext4 descartável (128 MiB) confirmou remount do superbloco e `e2fsck -fn=0`, mas **o experimento posterior em mount namespace privado reproduziu um problema importante**: superbloco `ro` pode coexistir com VFS `rw` nos bind-mounts de estado, workspace e home. O Guardian foi corrigido na PR #2088 para vedar separadamente cada alias gravável antes de provar todas as montagens em `ro`, com snapshot e restauração das flags originais em caso de abortar.
- Próximo gate de engenharia: Guardian deve, depois de encerrados todos os agentes e controles de atualização, provar a identidade do ext4 físico e o fechamento/vedação do **superbloco** e de todas as montagens persistentes (incluindo ESP/DATA quando montadas), com testemunha de `ro` antes da transição do kernel. Falhas devem abortar com restauração comprovada, sem `sysrq`, reinícios de emergência ou segundo controlador. Reproduzir com simulação hermética da topologia real, QEMU e teste físico de ciclos sucessivos antes de autorizar usuário a reiniciar.
- **Não regravar USB, não formatar, não reiniciar notebook com este dispositivo até passar o gate de encerramento**. O ext4 está íntegro somente no checkpoint offline; qualidade da mídia sob escritas futuras permanece não certificada.

## Protótipo isolado de correção estrutural — PR #2088 (ainda não liberada)

- PR draft: https://github.com/ordaxsystems/ordax-os/pull/2088, branch `fix/owner-usb-ext4-power-seal-20261021`, cabeça inicial `0b2e6292`. **Não promover automaticamente a main ou ao USB.**
- Guardian confirma a origem ext4, partição 2 em mídia removível e major:minor via sysfs/mountinfo, reutilizando a validação das labels realizada pelo initramfs. Recusa ESP/DATA com montagens graváveis, usando major:minor sem exigir applets inexistentes; veda superbloco e **todos os aliases VFS graváveis** da partição raiz. Falhas de vedação e retorno do kernel exigem restauração das flags de montagens originalmente graváveis.
- Testes locais em checkout isolado com LF preservado: `sh -n system/entrypoint` e **18/18 testes aprovados** (7 transição de energia + 11 superbloco/aliases/ESP/DATA, incluindo **1 teste real** com ext4 128 MiB, mount namespace privado, selagem de todos os aliases, restauração de flags e segundo fechamento, seguido de `e2fsck -fn=0`).
- Gates ainda exigidos: CI completo da PR, teste de topologia real do Owner Dev com `switch_root` e `pivot_root`, QEMU com ciclo de energia e `e2fsck -fn` após desligamento, hardware real em vários ciclos. A integridade comprovada do USB físico decorre apenas do reparo offline; não confundir com aprovação da correção do Guardian.

- PR #2088 atualizada para o commit de cabeça `92fce755`: removeu a dependência de `blkid` (não instalada na Base Owner), passando a conferir origem da raiz por `/sys/class/block`, número da partição e major:minor de `/proc/self/mountinfo`. A verificação da ESP/DATA utiliza partições irmãs da raiz USB em vez de pesquisa de labels não suportada no runtime. **Owner Development Preflight e Release Bundle Tooling passaram** nesta revisão; demais CI e ensaio físico não estavam concluídos no último checkpoint.

- **Automação do gate:** os 17 testes herméticos entram no preflight Owner; a suíte de integração com loop real e namespace privado é acionada obrigatoriamente no workflow oficial Creator Owner Development Git USB para alterações no Guardian, além do boot QEMU Owner. A prova de boot Owner pré-existente verifica boots frios e saúde gráfica, **não** prova por si só a transição de desligamento do Guardian; isso continua um gate distinto.

## Gate de integridade de energia no QEMU — PR #2088

- Experimento isolado de montagem Linux: o superbloco ext4 ficou RO, mas as flags VFS de state/workspace/home permaneceram RW. O verificador recusou corretamente esse estado. Implementação corrigida para registrar as montagens originalmente graváveis, vedar o superbloco, vedar cada alias VFS e provar todas as flags; rollback restaura somente as permissões originais.
- Ensaio real em namespace de montagem privado, imagem ext4 descartável de 128 MiB, completou sequência vedar → restaurar → vedar com e2fsck -fn posterior código 0; o Lidermix não foi modificado por este ensaio.
- A prova canônica tools/creator/proof/owner_qemu_offline_boot.py agora pode solicitar desligamento ACPI do convidado já saudável, exigir marcador do kernel Power down, conferir a partição ext4 de cópia RAW temporária com losetup somente leitura e e2fsck -fn, e só então autorizar o segundo boot virtual.
- Código e testes ficam na PR draft #2088; último head local validado fee6a1b1. Total 29/29 testes locais aprovados: 7 Guardian, 11 ext4 incluindo montagem Linux e 11 QEMU/contratos. Prova QEMU real no CI ainda não tinha resultado conclusivo no checkpoint.
- GATE BLOQUEANTE: não promover a correção à main nem ao pendrive físico até confirmar QEMU ACPI + fsck real, topologia pós-switch_root/pivot_root e posterior ensaio de ciclos físicos. A recuperação offline já comprovada não garante futura durabilidade da mídia.

## Gate Owner — continuação da PR #2088, 21/10/2026

- PR #2088 teve execução Owner Development Preflight verde, mas a compilação real do Creator Owner no commit 222f49c6 falhou **antes do QEMU**, na etapa Surface Runtime: `apk add` fixava `c-ares=1.34.8-r0`, indisponível no espelho que passou a oferecer `1.34.9-r0`. Portanto aquela falha não era prova de segurança nem de falha do Guardian.
- A `main` avançou independentemente, com a PR #2087 (commit `26aebdf9`) que atualizou de maneira canônica o lock da Surface e seu contrato, preservando a origem dos pacotes ainda usada pelo builder atual. A branch #2088 foi reconciliada em merge exato de dois pais, commit `c9b4abcb`, árvore baseada na `main` atual e nos 8 arquivos alterados da correção de energia, sem conflitos e sem força no ref.
- Esta reconciliação **não significa remoção do Alpine**. A substituição da base antiga está rastreada no issue #1730 (Buildroot independente, paridade, QEMU, Secure Boot/hardware). Não introduzir pin temporário, download paralelo ou fallback extra para mascarar o gate QEMU.
- Novo workflow `Creator Owner Development Git USB`, run `39634431007`, criado para a árvore reconciliada; prova de desligamento real ACPI + `e2fsck -fn` e segundo boot ainda dependente de conclusão. **Nenhuma escrita nova no USB Lidermix foi autorizada**; integridade offline ext4 do reparo anterior preservada como último checkpoint físico.

## Teste real QEMU ACPI — achado e correção (21/10, 16:33 UTC)

- Run `39634431007` da PR #2088, merge `c9b4abcb`: Base e Surface offline construídas; o QEMU iniciou o Owner USB no mesmo commit com compositor/WebKit saudáveis e evento ACPI de desligamento entregue ao Guardian. Teste QEMU falhou por **timeout de desligamento após 95 s**.
- Artefato GitHub Actions `owner-usb-qemu-framebuffer`, ID `12362490175`, preserva a serial do primeiro boot. O registro mostra `host power owner accepted shutdown` (16:32:06 UTC), término de serviços e `Owner USB ext4 superblock could not be sealed; restoring supervised runtime` (16:32:21 UTC). Surface reiniciou saudável. **Não houve prova de kernel poweroff, fsck pós-desligamento ou segundo boot**; não mascarar o teste como aprovado.
- Inspeção dos contratos: `docs/contracts/physical-media.json` exige **2 partições (ESP 1 + ORDAX ext4 2)** para a imagem seed/cópia QEMU; `docs/contracts/physical-prepared-media.json` exige **3 partições (ESP 1 + ORDAX ext4 2 + ORDAX-DATA 3)** para mídia física Owner preparada. O kernel QEMU enumerou apenas `sda1 sda2`, conforme o contrato. O Guardian exigia `/sys/class/block/sda3/dev` mesmo no seed: verificação incompatível com o contrato.
- PR #2088 alterada para exigir identidade major:minor da ESP 1 e exigir a mesma prova para DATA 3 **apenas quando essa partição existir**, sem criar outro esquema de boot ou compatibilidade. Preserva fail-closed para partições existentes graváveis. Foram acrescentados testes de ambos os layouts a partir dos contratos e estágios diagnósticos enumerados em caso de falha de vedação.
- **Gates ainda bloqueantes:** novo CI completo com QEMU ACPI+fsck e segundo boot; inspeção de eventuais novos erros, promoção somente após prova. Pendrive Lidermix continua sem gravação nem boot, ext4 reparado offline no checkpoint anterior.

## Segunda prova QEMU — remount ext4 e diagnóstico do mtab

- Run `39636768061`, commit `55f3ea9d`: Surface/WebKit e boot Owner saudáveis; ACPI entregue; o kernel registrou `EXT4-fs (sda2): re-mounted`, mas a chamada BusyBox `mount -o remount,ro <device> /` retornou erro, e o Guardian recusou o desligamento com código de estágio `superblock-remount`, restaurando a Surface. QEMU acusou `Owner Guest ACPI poweroff timed out` antes de fsck e segundo boot. Evidência `owner-usb-qemu-framebuffer`, artefato `12364200283`, serial 16:48:09 UTC.
- Não classificar a montagem como íntegra ou aprovada apenas pelo log do kernel: é necessário provar a operação inteira, as flags VFS de cada alias e a saúde do ext4 offline. É possível que o BusyBox tente manutenção de `/etc/mtab` após o remount do filesystem, mas isso ainda é hipótese, não causa definitivamente demonstrada.
- PR #2088 `7cc42eca`: remount Owner passa a usar `busybox mount -n` para não alterar `/etc/mtab`, consultando `/proc/self/mountinfo` como autoridade. Saída de erro agora é preservada apenas no log volátil já existente `/run/ordax-update/guardian.log`; os quatro caminhos (superbloco RO/RW e aliases RO/RW) mantêm a mesma política. Suíte de namespace atualizada para verificar a semântica `-n` e a coleta dos logs.
- Próximo gate: executar real QEMU Owner ACPI + ext4 offline + segundo boot com a nova revisão. USB físico continua sem escrita, sem novo boot e sem instalação do candidato.

### Validação pós-patch de mtab (head 7cc42eca)

- Via OrdaX MCP no host Windows, checkout isolado reconciliado com a branch: sintaxe shell validada e **33 testes aprovados**: 15 de ext4/aliases, com imagem ext4 descartável e mount namespace privado; 7 de transição Guardian; 11 de QEMU/contrato. Mídia Lidermix não utilizada nesses testes.
- O workflow **Owner Development Preflight** do GitHub para `7cc42eca` também passou. `Creator Owner Development Git USB` run `39638754792` ainda estava construindo a Base na última consulta, portanto QEMU ACPI/`e2fsck` **não aprovado neste checkpoint**.
- Nada desta execução foi aplicado na main como código de energia nem escrito no USB físico. PR #2088 permanece draft. A dependência histórica do builder Alpine não foi removida por essa PR; migração independente segue o issue #1730, sem introduzir novo fallback ou código legado para o fechamento do ext4.

## Quarta revisão: EBUSY confirmado e fechamento ordenado dos aliases

- A execução QEMU real `39638754792` (head `7cc42eca`) voltou a falhar no desligamento ACPI, mas preservou no artefato `12364207120` a evidência serial: `EXT4-fs (sda2): re-mounted`, seguido de `mount: mounting /dev/sda2 on / failed: Resource busy` e `Owner USB ext4 sealing failed at superblock-remount; restoring supervised runtime`. **A Surface voltou e o kernel não desligou; portanto NÃO há fsck pós-poweroff nem segundo boot comprovados nesse teste.**
- A branch da PR #2088 mudou a ordem: `08f040e2` fecha primeiro cada alias VFS gravável; depois tenta vedar o superbloco ext4, usando `mount -n` sem escrita no mtab e registrando diagnóstico em `/run`. A regressão `25d596aa` bloqueia a inversão futura de ordem. Não introduz SysRq, controlador paralelo ou montagem forçada.
- Checkout isolado no Windows/WSL, atualizado até `25d596aa`: `sh -n system/entrypoint` aprovado; **33/33 testes** aprovados (`15` ext4/aliases com imagem loop real no namespace privado, `7` Guardian, `11` QEMU/contratos). Isso não substitui o teste ACPI completo do convidado.
- CI canônico desse commit: `Owner Development Preflight`, `Physical USB Backend Safety`, `Foundation Contract`, `Creator Candidate` e `Release Bundle Tooling` concluíram com sucesso na última verificação. Workflow Creator Owner real `39640713631` ainda recompilando Base e **sem recibo final de ACPI + e2fsck + segundo boot**.
- Pendrive Lidermix: nenhum update, reflash, montagem RW ou boot físico autorizados após reparo offline. Gate permanece: prova QEMU completa, revisão final do layout físico de 3 partições, aplicação comprovada ao USB e ciclos físicos monitorados.

## Quinto gate — compilação nativa e diagnóstico de escritores EBUSY

- A PR #2088 usa executável estático ordax-usb-mountattr com mount_setattr(2) para os aliases e mount(2) para o superbloco, sob o Guardian único. A primeira execução CI falhou porque musl-gcc não encontrou linux/mount.h. A compilação foi alterada para consumir o UAPI exportado pelo kernel canônico do builder do initramfs, sem instalar dependência no runtime (ef8a2757).
- A execução Owner Git USB 39645277595 compilou a Base e iniciou a Surface no QEMU, mas o ACPI ainda falhou. O serial do artefato 12367352702 contém ordax-usb-mountattr: alias-ro: Resource busy. O Guardian restaurou a Surface; nenhuma prova de poweroff, fsck pós-desligamento ou segundo boot foi produzida.
- A revisão d95afcfa adicionou diagnóstico limitado, somente leitura, de alvo e possíveis escritores em /proc em caso de EBUSY. O teste ext4 isolado agora abre propositalmente um descritor para escrita, exige a prova de PID/FD de possível escritor, fecha o descritor e verifica a vedação e o fsck. Ainda é necessário o resultado oficial do novo CI.
- Bloqueio obrigatório: não promover à main o controlador de energia nem aplicar ao pendrive Lidermix até haver boot QEMU com ACPI, e2fsck -fn offline e segundo boot, seguido por ensaio físico comprovado. USB permanece reparado offline, mas não atualizado com a nova Base.
