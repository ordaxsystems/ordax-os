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
