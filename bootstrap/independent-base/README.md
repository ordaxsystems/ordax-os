# Base independente OrdaX — experimento isolado

**Estado:** candidato experimental **não promovível**. Esta pasta é um laboratório de fonte/compilação dentro de `bootstrap/`, não uma nova distribuição, linha de atualização, gerenciador de pacotes ou caminho alternativo de boot em produção.

## Escolha técnica

**Buildroot 2026.08**, fixado por SHA-256 em `source.json`, constrói BusyBox + musl desde fontes upstream, sem Alpine, APK ou minirootfs Alpine. Buildroot é ferramenta de *build* e não é instalado como gerenciador do runtime. Yocto/OpenEmbedded foi avaliado: permite distribuições complexas e feeds, porém amplia desnecessariamente a manutenção deste primeiro estágio mínimo. Construção manual de libc/BusyBox foi descartada para não manter uma toolchain própria; Linux From Scratch não é um pipeline de release reproduzível.

O perfil Buildroot usa `bootstrap/kernel/source.json` como única versão de cabeçalhos, não constrói outro kernel. O EROFS LZ4 e volume `ORDAX-BASE` são consultados em `bootstrap/stable-base/source.json`. A rede DHCP reutiliza `bootstrap/network/bring-up` e `udhcpc.script`, com seus hashes validados pelo contrato existente. BusyBox e musl são software independente do Alpine, embora a base Alpine antiga também os distribua.

## Limites importantes

- A base atual Alpine dos perfis Development e Stable permanece intacta.
- Não há SSH, Git, Wi-Fi, firmware de notebooks, gerenciamento de pacotes ou serviços de produto nesta base mínima; DHCP com Ethernet/QEMU user NAT é o escopo.
- A inicialização `ordax-independent-probe-init` é exclusivamente um programa de **teste QEMU**, não substitui `bootstrap/initramfs/portable_init.sh`, os verificadores de release, seleção de slots ou serviços atuais.
- **Não** se pode distribuir, assinar, instalar, ligar ao Creator, ativar Base Update, substituir `stable-base.erofs` ou modificar USB com este artefato.
- O teste QEMU usa o kernel **real** `bootstrap/kernel/build.py` e valida seu provenance. Testa montagem EROFS somente-leitura, imagem ext4 descartável persistente, DHCP e falha segura de EROFS inválido. Não prova UEFI, mídia física, EROFS/OverlayFS do fluxo portátil completo nem equivalência de recuperação assinada.
- Exige execução de CI Linux; nenhum passo pertence à estação de trabalho do usuário.

## Entrypoints reproduzíveis

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

**Critério de conclusão:** Buildroot executado, proveniência/artefatos verificados, QEMU com duas inicializações e uma falha de EROFS inválido, logs/receipts anexados à PR, rebase na main mais recente e revisão dos owners. **NÃO** substituir a base Stable sem testes equivalentes do initramfs/portable-v2, segurança, módulos, firmware, Wi-Fi, assinatura e rollback.

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

**Resultado de execução:** não preencher indicadores PASS sem a execução correspondente. Os resultados são produzidos por `provenance.json` e `qemu-result.json`; runs CI e seus logs são as evidências primárias.
