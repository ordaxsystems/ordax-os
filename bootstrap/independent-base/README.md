# Base independente OrdaX — Buildroot e fronteira de adoção

> **Estado de fonte em 13/11/2026, após o merge:** a [PR #2243](https://github.com/ordaxsystems/ordax-os/pull/2243) foi integrada à `main` em 13/11/2026 às 20:27:49 UTC (merge `d885f365ab9d9d630d1a200b391197e04848b655`). Os produtores Alpine de Dev/Stable foram retirados e Buildroot/musl é o caminho implementado nesses perfis. **Isso não comprova promoção Stable, assinatura pública, gravação USB, boot físico nem conclusão do canal**; usar contratos, recibos e gates atuais para essas decisões. Não reabrir a branch anterior nem restaurar produtores Alpine como paliativo.

A migração de código já foi integrada neste owner. O [diário de execução de outubro/novembro](https://github.com/ordaxsystems/ordax-os/blob/446e03c686aca91edeaf75fa4a45271ce945dd05/bootstrap/independent-base/MIGRATION-REMOVE-ALPINE.md) é somente histórico, preservado em commit fixo; não é roteiro atual. O kernel continua sendo produzido apenas por `bootstrap/kernel/`; módulos são selecionados por `bootstrap/kernel/module_archive.py`, firmware permanece sob `bootstrap/base/firmware_policy.py`, e a Surface candidata usa o produtor Buildroot/musl de `bootstrap/surface-runtime`.


## Escolha técnica

**Buildroot 2026.08**, fixado por SHA-256 em `source.json`, constrói BusyBox + musl desde fontes upstream, sem Alpine, APK ou minirootfs Alpine. Buildroot é ferramenta de *build* e não é instalado como gerenciador do runtime. Yocto/OpenEmbedded foi avaliado: permite distribuições complexas e feeds, porém amplia desnecessariamente a manutenção deste estágio. Construção manual de libc/BusyBox foi descartada para não manter uma toolchain própria; Linux From Scratch não é um pipeline de release reproduzível.

O perfil Buildroot usa `bootstrap/kernel/source.json` como única versão de cabeçalhos e não constrói outro kernel. A semântica neutra **EROFS somente leitura** é consultada no SSOT já existente `docs/contracts/portable-boot-handoff.json` (`proof.release_mount`). A compatibilidade provisória de compressão LZ4 e rótulo `ORDAX-BASE` é consultada em `bootstrap/stable-base/source.json` **somente como parâmetros de artefato**. Não surge um segundo contrato de formato, de boot ou de atualizações. A rede DHCP reutiliza `bootstrap/network/bring-up` e `udhcpc.script`, com seus hashes validados pelo contrato existente. BusyBox e musl são software independente do Alpine, embora a base Alpine antiga também os distribua.

## Perfis do mesmo owner

A Independent Base possui três perfis derivados do mesmo defconfig e do mesmo builder; o perfil Stable é uma candidata não promovível:

- `minimal`: prova portátil mínima, sem Git, Wi-Fi de notebook ou firmware Owner;
- `owner-development`: extensão explícita do mesmo owner para a paridade do Dev USB, com CA trust, Git, `iw`, `wpa_supplicant`, `wpa_passphrase`, provider `linux-firmware`, módulos selecionados do kernel canônico e helpers existentes do Dev USB.
- `stable-mvp`: perfil Buildroot sem Git ou helpers Dev, com o mesmo SSOT de firmware, CA e Wi-Fi, módulos canônicos e receipts vinculados; integração de source não autoriza promoção Stable ou instalação física.

Nenhum perfil cria outra distro. `configs/wifi-hardware.fragment` é a única declaração das capacidades Wi-Fi/firmware compartilháveis; `configs/owner-development.fragment` acrescenta somente Git e applets Dev; `build.py` valida todos os símbolos declarados contra o Kconfig real do Buildroot. As famílias de firmware não são duplicadas em Python.

`kmod` não entra no runtime Owner porque `/sbin/modprobe` já pertence à base BusyBox canônica. `zstd` também não foi adicionado: sua necessidade pertencia ao antigo caminho Alpine de materialização de firmware comprimido e não há consumidor runtime comprovado no perfil Owner atual.

## Hardware Owner sem segundo SSOT

O baseline Wi-Fi continua definido somente por `docs/contracts/hardware-support-matrix.json`. O kernel continua sendo construído exclusivamente por `bootstrap/kernel/` e entrega `kernel-modules-<versão>.tar` como componente verificável separado.

`bootstrap/kernel/module_archive.py` consome esse archive, lê os módulos exigidos pela hardware matrix, resolve dependências com kmod/modprobe e `modules.dep` do próprio artefato, materializa somente o payload necessário e gera `kernel-module-selection.json`. Ele não constrói kernel nem baixa módulos.

`bootstrap/base/firmware_policy.py` lê as declarações reais `firmware=` dos módulos materializados e exige cobertura no target. O provider dos bytes é o `linux-firmware` selecionado no fragmento Buildroot; a política não baixa firmware por conta própria.

No perfil Owner, os receipts externos de módulos e firmware são copiados byte a byte para `/etc/ordax/kernel-module-selection.json` e `/etc/ordax/firmware-coverage.json` antes da geração do rootfs. `cmp` exige identidade exata entre evidência externa e cópia embutida. Como a provenance do builder autentica o EROFS final por SHA-256, esses mesmos receipts ficam transitivamente vinculados à candidata imutável.

## Limites importantes

- Os builders Alpine Development e Stable anteriores foram retirados da `main` pela PR #2243. A homologação dos artefatos e o uso físico continuam sujeitos às provas e autorizações dos canais.
- A branch `integration/dev-usb-buildroot-surface-20261024` pode alterar consumidores e contratos somente para provar a substituição; nenhum desses bytes é automaticamente Stable ou gravável em mídia física.
- O perfil `minimal` permanece sem Git, Wi-Fi de notebook e firmware Owner. O perfil `owner-development` já passou pela compilação e pelo QEMU da Base; o USB completo e a prova física ainda são gates separados e obrigatórios.
- A inicialização `ordax-independent-probe-init` é exclusivamente um programa de **teste QEMU**, não substitui `bootstrap/initramfs/portable_init.sh`, os verificadores de release, seleção de slots ou serviços atuais.
- **Não** se pode distribuir, assinar, instalar, ligar ao Creator, ativar Base Update, substituir `stable-base.erofs` ou modificar USB com este artefato enquanto os gates de promoção permanecerem fechados.
- O teste QEMU usa o kernel **real** `bootstrap/kernel/build.py` e valida seu provenance. Testa montagem EROFS somente-leitura e escrita rejeitada, imagem ext4 descartável persistente, DHCP e falha segura de EROFS inválido. O QEMU usa `snapshot=on` para permitir emulação IDE com backend COW descartável sem modificar os bytes originais de EROFS, cuja integridade é novamente verificada por SHA-256.
- Exige execução de CI Linux; nenhum passo pertence à estação de trabalho do usuário.

## Política de CI vigente (após o merge da migração)

A migração Alpine → Buildroot já foi integrada à `main`; a antiga branch
`integration/dev-usb-buildroot-surface-20261024` não é mais a autoridade
operacional. O workflow isolado `remove-alpine-fast.yml` foi incorporado
aos **owners existentes**, sem criar novo produtor:

- **`.github/workflows/independent-base-experiment.yml`**: o job
  `independent-base-contract` testa os três perfis `minimal`,
  `owner-development` e `stable-mvp` antes da prova pesada. Em PR
  `draft`, o contrato rápido permanece disponível e Buildroot/QEMU
  aguardam candidatura ou despacho explícito; a seleção de um único perfil
  continua válida para o artefato/prova pesada.
- **`.github/workflows/independent-surface-runtime.yml`**: o job
  `contract` observa somente a **presença booleana** das quatro variáveis
  do produtor Surface, sem revelar valores ou segredos, e confirma o contexto
  de runner hospedado. Isso não atesta runner persistente nem autoriza
  compilação em máquina privada para PRs públicos.
- **`.github/workflows/foundation.yml`**: preserva
  `tools/verify/github_actions_supply_chain.py` e, no fluxo completo de
  regressão, `tests/test_github_actions_supply_chain.py`. Nenhuma
  dispensa de assinatura, proveniência ou supply-chain decorre dessa
  consolidação.

Os jobs pesados continuam selecionados por impacto, revisão exata,
provenance, caches verificáveis e gates de saúde/boot/QEMU aplicáveis.
Evidência CI **não** equivale a mídia física, atualização ativada ou
promoção Stable/MVP. Para conferir a antiga sequência da migração,
consultar o [snapshot imutável anterior à consolidação](https://github.com/ordaxsystems/ordax-os/blob/55e512b227c3ec666746615cb784d5fe0d01e10b/bootstrap/independent-base/README.md).

## Uso de recursos no builder

A compilação `make -j` do Buildroot usa **captura limitada de stdout/stderr** no builder oficial: o processo pai conserva só os últimos 10 KiB de saída para diagnosticar falhas, evitando que logs extensos consumam RAM proporcional à duração do build. Comandos menores que precisam de sua saída completa mantêm a captura tradicional.

Cache permitido deve ser verificável e derivado de inputs versionados. O kernel já pode ser reutilizado por fingerprint no workflow pesado. Diretórios mutáveis de compilação não são evidência e não podem atravessar commits como substituto de build/verificação.

## Métricas mínimas observáveis (sem promoção)

O recibo do QEMU mínimo inclui bytes reais de EROFS, initramfs e kernel; tempo total de processo QEMU no host; e medições do guest via `/proc`: memória em uso aproximada, percentual de ticks CPU ocupados desde o início do kernel, quantidade de processos e uptime até o marcador de conclusão. Não confundir essas medidas pontuais com pico de RAM, consumo médio de CPU, tempo de boot de firmware/UEFI, Surface gráfica ou tamanho da imagem USB completa.

## Entrypoints reproduzíveis

```sh
python3 bootstrap/independent-base/build.py check --profile minimal
python3 bootstrap/independent-base/build.py check --profile owner-development
python3 -m unittest tests.test_independent_base_experiment tests.test_independent_owner_profile -v

# Resolver Kconfig sem compilar rootfs/kernel:
python3 bootstrap/independent-base/build.py resolve \
  --profile owner-development --cache /tmp/ordax-buildroot-cache

# Build pesado apenas quando o gate de plataforma exigir. Para owner-development,
# ORDAX_HOST_PYTHON / ORDAX_KERNEL_MODULES_ARCHIVE / receipts devem vir do
# componente de kernel previamente verificado, como faz o workflow pesado.
python3 bootstrap/independent-base/build.py build \
  --profile minimal \
  --out /tmp/ordax-independent-base --cache /tmp/ordax-buildroot-cache --jobs 4
python3 bootstrap/independent-base/build.py verify \
  --profile minimal --out /tmp/ordax-independent-base

python3 bootstrap/kernel/build.py build --jobs 4
python3 bootstrap/independent-base/qemu_proof.py \
  --out /tmp/ordax-independent-base \
  --kernel-dir out/kernel \
  --result /tmp/ordax-independent-qemu-result.json
```

## Mapeamento de dependências atuais

| Componente | Dependência atual | Classificação | Estratégia na migração |
|---|---|---|---|
| Alpine rootfs producer | removed | Buildroot is sole Base producer |
| Stable Alpine builder | removed | Stable uses the independent-base stable-mvp profile |
| `bootstrap/dev-base/build.py` | builder Alpine Dev aposentado na PR #2243 | distribuição | removido sem alterar a política de prova física do USB Owner |
| Alpine APK runtime policy | removed | No APK removal or installation commands |
| `bootstrap/base/firmware_policy.py` | módulos/firmware do kernel | política independente | preservada e reutilizada como política neutra |
| `bootstrap/kernel/module_archive.py` | archive do kernel + hardware matrix | política independente | owner canônico do archive/seleção de módulos do kernel |
| `bootstrap/initramfs/build.py` | BusyBox oficial + `musl-gcc` | independente | preservar |
| `bootstrap/network/build.py` | BusyBox oficial + `musl-gcc` | independente | preservar scripts e contrato |
| `bootstrap/native-initramfs/build.py` | builder Ubuntu pinado | outro perfil/build | fora do corte Alpine da base portátil |
| `bootstrap/surface-runtime` | produtor Buildroot/musl candidato | runtime gráfico separado da Base | preservar sem APK/Alpine e promover somente após EROFS/boot/health aplicáveis |

A sequência de implementação anterior está preservada no [diário histórico da migração](https://github.com/ordaxsystems/ordax-os/blob/446e03c686aca91edeaf75fa4a45271ce945dd05/bootstrap/independent-base/MIGRATION-REMOVE-ALPINE.md). Trabalho novo parte de `main`, source/contratos atuais e gates causais, sem wrapper permanente para duas bases.

## Critério de conclusão

A remoção dos consumidores Alpine e a integração da branch de migração já foram concluídas na `main`. Os critérios ainda abertos são exclusivamente as provas/receipts aplicáveis de Buildroot, boot, rede, firmware, Wi-Fi, Git/CA quando exigidos, Surface/runtime, recovery, rollback e as promoções explicitamente autorizadas. Não reintroduzir produtor Alpine/APK para fechar um gate físico ou de release.

**Resultado de execução:** não preencher indicadores PASS sem a execução correspondente. Runs CI, provenance e receipts continuam sendo as evidências primárias.
