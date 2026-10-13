# Base independente OrdaX — experimento isolado

**Estado (13/10/2026):** capacidade independente experimental **não promovível**. A Fase 2 de boot portátil e a Fase 3 de saúde gráfica real foram validadas em QEMU, incluindo release assinado, recuperação e segundo boot `current` (prova [#38422187862](https://github.com/ordaxsystems/ordax-os/actions/runs/38422187862) e integração [PR #1746](https://github.com/ordaxsystems/ordax-os/pull/1746)). Isso não comprova Secure Boot, equivalência em hardware físico, firmware/Wi-Fi ou autorização de migração. A autoridade e o acompanhamento desses gates continuam no [issue #1730](https://github.com/ordaxsystems/ordax-os/issues/1730). Esta pasta não cria outra distribuição, linha de atualização, gerenciador de pacotes ou boot de produção.

## Escolha técnica

**Buildroot 2026.08**, fixado por SHA-256 em `source.json`, constrói BusyBox + musl desde fontes upstream, sem Alpine, APK ou minirootfs Alpine. Buildroot é ferramenta de *build* e não é instalado como gerenciador do runtime. Yocto/OpenEmbedded foi avaliado: permite distribuições complexas e feeds, porém amplia desnecessariamente a manutenção deste primeiro estágio mínimo. Construção manual de libc/BusyBox foi descartada para não manter uma toolchain própria; Linux From Scratch não é um pipeline de release reproduzível.

O perfil Buildroot usa `bootstrap/kernel/source.json` como única versão de cabeçalhos, não constrói outro kernel. A semântica neutra **EROFS somente leitura** é consultada no SSOT já existente `docs/contracts/portable-boot-handoff.json` (`proof.release_mount`). A compatibilidade provisória de compressão LZ4 e rótulo `ORDAX-BASE` é consultada em `bootstrap/stable-base/source.json` **somente como parâmetros de artefato**. Não surge um segundo contrato de formato, de boot ou de atualizações. A rede DHCP reutiliza `bootstrap/network/bring-up` e `udhcpc.script`, com seus hashes validados pelo contrato existente. BusyBox e musl são software independente do Alpine, embora a base Alpine antiga também os distribua.

## Limites importantes

- A base atual Alpine dos perfis Development e Stable permanece intacta.
- Não há SSH, Git, Wi-Fi, firmware de notebooks, gerenciamento de pacotes ou serviços de produto nesta base mínima; DHCP com Ethernet/QEMU user NAT é o escopo.
- A inicialização `ordax-independent-probe-init` é exclusivamente um programa de **teste QEMU**, não substitui `bootstrap/initramfs/portable_init.sh`, os verificadores de release, seleção de slots ou serviços atuais.
- **Não** se pode distribuir, assinar, instalar, ligar ao Creator, ativar Base Update, substituir `stable-base.erofs` ou modificar USB com este artefato.
- O teste QEMU usa o kernel **real** `bootstrap/kernel/build.py` e valida seu provenance. Testa montagem EROFS somente-leitura e escrita rejeitada, imagem ext4 descartável persistente, DHCP e falha segura de EROFS inválido. O QEMU usa `snapshot=on` para permitir emulação IDE com backend COW descartável sem modificar os bytes originais de EROFS, cuja integridade é novamente verificada por SHA-256. Não prova UEFI, mídia física, EROFS/OverlayFS do fluxo portátil completo nem equivalência de recuperação assinada.
- Exige execução de CI Linux; nenhum passo pertence à estação de trabalho do usuário.

## Uso de recursos no builder

A compilação `make -j` do Buildroot usa **captura limitada de stdout/stderr** no builder oficial: o processo pai conserva só os últimos 10 KiB de saída para diagnosticar falhas, evitando que logs extensos consumam RAM proporcional à duração do build. Comandos menores que precisam de sua saída completa (como `stat` ou `blkid`) mantêm a captura tradicional. O teste `test_large_build_output_stays_bounded_without_losing_failure_tail` mede o pico de memória Python em uma carga sintética de 16 MiB e valida a retenção do diagnóstico. Isso otimiza **o processo de compilação no host**, não é uma medida de RAM, CPU ou boot do sistema operacional no QEMU ou no hardware físico.

## Métricas mínimas observáveis (sem promoção)\n\nO recibo do QEMU mínimo inclui bytes reais de EROFS, initramfs e kernel; tempo total de processo QEMU no host; e medições do guest via `/proc`: `MemTotal - MemAvailable` (memória em uso aproximada), percentual de ticks CPU ocupados **desde o início do kernel**, quantidade de processos na hora da prova e uptime do kernel até o marcador de conclusão. A prova recusa medidas ausentes, duplicadas ou inválidas. Não confundir essas medidas pontuais com pico de RAM, consumo médio de CPU, tempo de boot de firmware/UEFI, Surface gráfica ou tamanho da imagem USB completa. O cenário é QEMU mínimo com 384 MiB/1 vCPU, não equipamento físico. Não se inicia serviço extra, não há alterações no PID1 portátil oficial, no estado dos slots ou no canal Stable.\n\n## Entrypoints reproduzíveis\n
```sh
python3 bootstrap/independent-base/build.py check
python3 -m unittest tests.test_independent_base_experiment -v

# Linux isolado com as dependências de CI e saídas FORA do repositório:
python3 bootstrap/independent-base/build.py build \
  --out /tmp/ordax-independent-base --cache /tmp/ordax-buildroot-cache --jobs 4
python3 bootstrap/independent-base/build.py verify --out /tmp/ordax-independent-base

# Compilar o kernel com o builder canônico, sem segundo kernel:
python3 bootstrap/kernel/build.py build --jobs 4
python3 bootstrap/independent-base/qemu_proof.py \
  --out /tmp/ordax-independent-base \
  --kernel-dir out/kernel \
  --result /tmp/ordax-independent-qemu-result.json
```

**Critério de conclusão:** Buildroot executado, proveniência/artefatos verificados, QEMU com duas inicializações e uma falha de EROFS inválido, logs seriais e receipts com SHA-256 anexados à PR, reconciliação da main mais recente e revisão dos owners. **NÃO** substituir a base Stable sem testes equivalentes do initramfs/portable-v2, segurança, módulos, firmware, Wi-Fi, assinatura e rollback.

## Mapeamento de dependências atuais

| Componente | Dependência atual | Classificação | Estratégia |
|---|---|---|---|
| `bootstrap/base/alpine_core.py` | Alpine minirootfs, espelho APK, `apk add` | distribuição | manter atual até substituição integral |
| `bootstrap/stable-base/build.py` | `apk`, `proot`, lock de pacotes `-rN` | distribuição + build | não alterar |
| `bootstrap/dev-base/build.py` | importa `alpine_core.py` | distribuição | não alterar |
| `bootstrap/base/runtime_policy.py` | `apk del`, chaves APK | distribuição | substituir só depois de demonstrar paridade |
| `bootstrap/base/firmware_policy.py` | módulos/firmware ELF/kernel | política independente, entrada ainda via Alpine | reutilizar em etapa de hardware |
| `bootstrap/initramfs/build.py` | BusyBox oficial + `musl-gcc` | projetos independentes / ferramenta de build | preservar |
| `bootstrap/network/build.py` | BusyBox oficial + `musl-gcc` | independente / ferramenta de build | preservar scripts e contrato |
| `bootstrap/native-initramfs/build.py` | builder Ubuntu pinado | outro perfil/build | fora do escopo |
| `bootstrap/surface-runtime`, Wine | pacotes APK de runtime | perfil de aplicativos | fora do escopo |

O teste mantém os logs seriais de cada inicialização em `<resultado>-serial/` e inclui SHA-256 no recibo. O fluxo atual só prova **direct-kernel boot descartável**; não substitui a verificação criptográfica dos artefatos portáteis oficiais.

**Resultado de execução:** não preencher indicadores PASS sem a execução correspondente. Os resultados são produzidos por `provenance.json` e `qemu-result.json`; runs CI e seus logs são as evidências primárias.
