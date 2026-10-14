# Base independente OrdaX — experimento isolado

**Estado (14/10/2026):** capacidade independente experimental **não promovível**. A Fase 2 de boot portátil e a Fase 3 de saúde gráfica real foram validadas em QEMU, incluindo release assinado, recuperação e segundo boot `current` (prova [#38422187862](https://github.com/ordaxsystems/ordax-os/actions/runs/38422187862) e integração [PR #1746](https://github.com/ordaxsystems/ordax-os/pull/1746)). A paridade `/sbin/ip` está sendo reconciliada na [PR #1751](https://github.com/ordaxsystems/ordax-os/pull/1751), e o slice seguinte provisiona `iw`, `wpa_supplicant`/nl80211 e certificados CA para os consumidores reais do broker. Isso ainda não comprova Secure Boot, rádio Wi-Fi, associação em hardware, firmware de notebook ou autorização de migração. A autoridade e o acompanhamento desses gates continuam no [issue #1730](https://github.com/ordaxsystems/ordax-os/issues/1730). Esta pasta não cria outra distribuição, linha de atualização, gerenciador de pacotes ou boot de produção.

## Escolha técnica

**Buildroot 2026.08**, fixado por SHA-256 em `source.json`, constrói BusyBox + musl desde fontes upstream, sem Alpine, APK ou minirootfs Alpine. Buildroot é ferramenta de *build* e não é instalado como gerenciador do runtime. Yocto/OpenEmbedded foi avaliado: permite distribuições complexas e feeds, porém amplia desnecessariamente a manutenção deste primeiro estágio mínimo. Construção manual de libc/BusyBox foi descartada para não manter uma toolchain própria; Linux From Scratch não é um pipeline de release reproduzível.

O perfil Buildroot usa `bootstrap/kernel/source.json` como única versão de cabeçalhos, não constrói outro kernel. A semântica neutra **EROFS somente leitura** é consultada no SSOT já existente `docs/contracts/portable-boot-handoff.json` (`proof.release_mount`). A compatibilidade provisória de compressão LZ4 e rótulo `ORDAX-BASE` é consultada em `bootstrap/stable-base/source.json` **somente como parâmetros de artefato**. Não surge um segundo contrato de formato, de boot ou de atualizações. A rede DHCP reutiliza `bootstrap/network/bring-up` e `udhcpc.script`, com seus hashes validados pelo contrato existente. O broker canônico de Surface continua proprietário de scan/associação/persistência de credenciais; a base apenas fornece `ip`, `iw`, `wpa_supplicant` e CA quando esses bytes forem comprovados. BusyBox e musl são software independente do Alpine, embora a base Alpine antiga também os distribua.

## Limites importantes

- As bases Alpine atuais dos perfis Development e Stable permanecem intactas até o cutover controlado; elas não serão mantidas como segunda distribuição permanente depois da nova base comprovada.
- Não há SSH, Git, firmware genérico de notebooks ou gerenciamento de pacotes nesta base mínima. O userspace de Wi-Fi (`iw` + `wpa_supplicant`/nl80211) e o CA bundle não equivalem a prova de rádio, firmware, driver ou associação física.
- A inicialização `ordax-independent-probe-init` é exclusivamente um programa de **teste QEMU**, não substitui `bootstrap/initramfs/portable_init.sh`, os verificadores de release, seleção de slots ou serviços atuais.
- **Não** se pode distribuir, assinar, instalar, ligar ao Creator, ativar Base Update, substituir `stable-base.erofs` ou modificar USB com este artefato.
- O teste QEMU usa o kernel **real** autenticado pelo builder canônico e valida seu provenance. Testa montagem EROFS somente-leitura e escrita rejeitada, imagem ext4 descartável persistente, DHCP, execução dos userspaces selecionados e falha segura de EROFS inválido. O QEMU usa `snapshot=on` para permitir emulação IDE com backend COW descartável sem modificar os bytes originais de EROFS, cuja integridade é novamente verificada por SHA-256. Não prova UEFI, mídia física, Wi-Fi físico, EROFS/OverlayFS do fluxo portátil completo nem equivalência de recuperação assinada.
- Exige execução de CI Linux; nenhum passo pertence à estação de trabalho do usuário.

## Uso de recursos no builder

A compilação `make -j` do Buildroot usa **captura limitada de stdout/stderr** no builder oficial: o processo pai conserva só os últimos 10 KiB de saída para diagnosticar falhas, evitando que logs extensos consumam RAM proporcional à duração do build. Comandos menores que precisam de sua saída completa (como `stat` ou `blkid`) mantêm a captura tradicional. O teste `test_large_build_output_stays_bounded_without_losing_failure_tail` mede o pico de memória Python em uma carga sintética de 16 MiB e valida a retenção do diagnóstico. Isso otimiza **o processo de compilação no host**, não é uma medida de RAM, CPU ou boot do sistema operacional no QEMU ou no hardware físico.

## Métricas mínimas observáveis (sem promoção)

O recibo do QEMU mínimo inclui bytes reais de EROFS, initramfs e kernel; tempo total de processo QEMU no host; e medições do guest via `/proc`: `MemTotal - MemAvailable` (memória em uso aproximada), percentual de ticks CPU ocupados **desde o início do kernel**, quantidade de processos na hora da prova e uptime do kernel até o marcador de conclusão. A prova recusa medidas ausentes, duplicadas ou inválidas. Não confundir essas medidas pontuais com pico de RAM, consumo médio de CPU, tempo de boot de firmware/UEFI, Surface gráfica ou tamanho da imagem USB completa. O cenário é QEMU mínimo com 384 MiB/1 vCPU, não equipamento físico. Não se inicia serviço extra, não há alterações no PID1 portátil oficial, no estado dos slots ou no canal Stable.

## Entrypoints reproduzíveis

```sh
python3 bootstrap/independent-base/build.py check
python3 -m unittest tests.test_independent_base_experiment -v

# Linux isolado com as dependências de CI e saídas FORA do repositório:
python3 bootstrap/independent-base/build.py build \
  --out /tmp/ordax-independent-base --cache /tmp/ordax-buildroot-cache --jobs 4
python3 bootstrap/independent-base/build.py verify --out /tmp/ordax-independent-base

# Obter/verificar o kernel canônico. CI deve reutilizar o componente autenticado
# quando o fingerprint dos inputs for idêntico; recompilar só em cache miss real.
python3 bootstrap/kernel/build.py build --jobs 4
python3 bootstrap/independent-base/qemu_proof.py \
  --out /tmp/ordax-independent-base \
  --kernel-dir out/kernel \
  --result /tmp/ordax-independent-qemu-result.json
```

**Critério de conclusão:** Buildroot executado, proveniência/artefatos verificados, QEMU com duas inicializações e uma falha de EROFS inválido, logs seriais e receipts com SHA-256 anexados à PR, reconciliação da main mais recente e revisão dos owners. **NÃO** substituir a base Stable sem testes equivalentes do initramfs/portable-v2, segurança, módulos, firmware, Wi-Fi físico, assinatura, known-good, rollback, recovery e cold-health.

## Mapeamento de dependências atuais

| Componente | Dependência atual | Classificação | Estratégia |
|---|---|---|---|
| `bootstrap/base/alpine_core.py` | Alpine minirootfs, espelho APK, `apk add` | distribuição | remover depois do cutover integral |
| `bootstrap/stable-base/build.py` | `apk`, `proot`, lock de pacotes `-rN` | distribuição + build | substituir pela Independent Base comprovada, depois remover |
| `bootstrap/dev-base/build.py` | importa `alpine_core.py` | distribuição | integrar à base única sem assumir o teste físico do Dev USB nesta frente |
| `bootstrap/base/runtime_policy.py` | `apk del`, chaves APK | distribuição | remover/refatorar depois da paridade comprovada |
| `bootstrap/base/firmware_policy.py` | módulos/firmware ELF/kernel | política independente, entrada ainda via Alpine | generalizar/reutilizar em etapa de hardware |
| `bootstrap/initramfs/build.py` | BusyBox oficial + `musl-gcc` | projetos independentes / ferramenta de build | preservar |
| `bootstrap/network/build.py` | BusyBox oficial + `musl-gcc` | independente / ferramenta de build | preservar scripts e contrato |
| `bootstrap/native-initramfs/build.py` | builder Ubuntu pinado | outro perfil/build | preservar enquanto não houver dependência Alpine runtime |
| `bootstrap/surface-runtime` e upgrade dinâmico da Surface | Alpine/APK e lock de runtime gráfico | dependência operacional Alpine | migração obrigatória antes de declarar o cutover final concluído |
| Wine/compatibilidade Windows | pipeline de compatibilidade separado | ferramenta/runtime opcional | classificar e migrar apenas qualquer dependência Alpine operacional restante antes do fechamento |

O teste mantém os logs seriais de cada inicialização em `<resultado>-serial/` e inclui SHA-256 no recibo. O fluxo atual só prova **direct-kernel boot descartável**; não substitui a verificação criptográfica dos artefatos portáteis oficiais.

**Resultado de execução:** não preencher indicadores PASS sem a execução correspondente. Os resultados são produzidos por `provenance.json` e `qemu-result.json`; runs CI e seus logs são as evidências primárias.
