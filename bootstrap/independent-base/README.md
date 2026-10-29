# Base independente OrdaX — experimento isolado

**Estado (16/10/2026):** capacidade independente experimental **não promovível**, agora usada também como única trilha técnica da migração temporária `platform/remove-alpine`. A Fase 2 de boot portátil e a Fase 3 de saúde gráfica real já foram validadas em QEMU, incluindo release assinado, recuperação e segundo boot `current`. Isso não comprova Secure Boot, equivalência em hardware físico nem autorização de migração. Esta pasta não cria outra distribuição, linha de atualização, gerenciador de pacotes ou boot de produção.

A migração não cria um segundo owner: ela reutiliza este diretório e segue `MIGRATION-REMOVE-ALPINE.md`. `main` continua sendo a única source authority; a branch temporária existe apenas para impedir que builds longos da base bloqueiem o desenvolvimento normal.

## Escolha técnica

**Buildroot 2026.08**, fixado por SHA-256 em `source.json`, constrói BusyBox + musl desde fontes upstream, sem Alpine, APK ou minirootfs Alpine. Buildroot é ferramenta de *build* e não é instalado como gerenciador do runtime. Yocto/OpenEmbedded foi avaliado: permite distribuições complexas e feeds, porém amplia desnecessariamente a manutenção deste estágio. Construção manual de libc/BusyBox foi descartada para não manter uma toolchain própria; Linux From Scratch não é um pipeline de release reproduzível.

O perfil Buildroot usa `bootstrap/kernel/source.json` como única versão de cabeçalhos e não constrói outro kernel. A semântica neutra **EROFS somente leitura** é consultada no SSOT já existente `docs/contracts/portable-boot-handoff.json` (`proof.release_mount`). A compatibilidade provisória de compressão LZ4 e rótulo `ORDAX-BASE` é consultada em `bootstrap/stable-base/source.json` **somente como parâmetros de artefato**. Não surge um segundo contrato de formato, de boot ou de atualizações. A rede DHCP reutiliza `bootstrap/network/bring-up` e `udhcpc.script`, com seus hashes validados pelo contrato existente. BusyBox e musl são software independente do Alpine, embora a base Alpine antiga também os distribua.

## Perfis do mesmo owner

A Independent Base possui dois perfis derivados do mesmo defconfig e do mesmo builder:

- `minimal`: prova portátil mínima, sem Git, Wi-Fi de notebook ou firmware Owner;
- `owner-development`: extensão explícita do mesmo owner para a paridade do Dev USB, com CA trust, Git, `iw`, `wpa_supplicant`, `wpa_passphrase`, provider `linux-firmware`, módulos selecionados do kernel canônico e helpers existentes do Dev USB.

O perfil Owner não cria outra distro. `configs/owner-development.fragment` é o único fragmento de capacidades adicionais; `build.py` valida todos os símbolos declarados contra o Kconfig real do Buildroot. As famílias de firmware não são duplicadas em Python.

`kmod` não entra no runtime Owner porque `/sbin/modprobe` já pertence à base BusyBox canônica. `zstd` também não foi adicionado: sua necessidade pertencia ao antigo caminho Alpine de materialização de firmware comprimido e não há consumidor runtime comprovado no perfil Owner atual.

## Hardware Owner sem segundo SSOT

O baseline Wi-Fi continua definido somente por `docs/contracts/hardware-support-matrix.json`. O kernel continua sendo construído exclusivamente por `bootstrap/kernel/` e entrega `kernel-modules-<versão>.tar` como componente verificável separado.

`bootstrap/base/kernel_module_payload.py` consome esse archive, lê os módulos exigidos pela hardware matrix, resolve dependências com kmod/modprobe e `modules.dep` do próprio artefato, materializa somente o payload necessário e gera `kernel-module-payload.json`. Ele não constrói kernel nem baixa módulos.

`bootstrap/base/firmware_policy.py` lê as declarações reais `firmware=` dos módulos materializados e exige cobertura no target. O provider dos bytes é o `linux-firmware` selecionado no fragmento Buildroot; a política não baixa firmware por conta própria.

No perfil Owner, os receipts externos de módulos e firmware são copiados byte a byte para `/etc/ordax/kernel-module-payload.json` e `/etc/ordax/firmware-coverage.json` antes da geração do rootfs. `cmp` exige identidade exata entre evidência externa e cópia embutida. Como a provenance do builder autentica o EROFS final por SHA-256, esses mesmos receipts ficam transitivamente vinculados à candidata imutável.

## Limites importantes

- O builder Alpine Development sem consumidores de produção foi retirado na PR #2243 após a Base Buildroot Owner passar no QEMU. A Base Stable antiga ainda requer migração e validação própria antes da remoção.
- A branch `platform/remove-alpine` pode alterar consumidores e contratos somente para provar a substituição; nenhum desses bytes é automaticamente Stable ou gravável em mídia física.
- O perfil `minimal` permanece sem Git, Wi-Fi de notebook e firmware Owner. O perfil `owner-development` já passou pela compilação e pelo QEMU da Base; o USB completo e a prova física ainda são gates separados e obrigatórios.
- A inicialização `ordax-independent-probe-init` é exclusivamente um programa de **teste QEMU**, não substitui `bootstrap/initramfs/portable_init.sh`, os verificadores de release, seleção de slots ou serviços atuais.
- **Não** se pode distribuir, assinar, instalar, ligar ao Creator, ativar Base Update, substituir `stable-base.erofs` ou modificar USB com este artefato enquanto os gates de promoção permanecerem fechados.
- O teste QEMU usa o kernel **real** `bootstrap/kernel/build.py` e valida seu provenance. Testa montagem EROFS somente-leitura e escrita rejeitada, imagem ext4 descartável persistente, DHCP e falha segura de EROFS inválido. O QEMU usa `snapshot=on` para permitir emulação IDE com backend COW descartável sem modificar os bytes originais de EROFS, cuja integridade é novamente verificada por SHA-256.
- Exige execução de CI Linux; nenhum passo pertence à estação de trabalho do usuário.

## Política de CI da migração

O loop de desenvolvimento e a prova de plataforma são deliberadamente diferentes:

```text
push em platform/remove-alpine
 -> .github/workflows/remove-alpine-fast.yml
 -> contratos + unitários + sintaxe + Kconfig real dos dois perfis
 -> sem compilar rootfs/kernel/full USB

marco estrutural / integração final
 -> .github/workflows/independent-base-experiment.yml
 -> kernel canônico verificado/cacheado
 -> Buildroot real no perfil selecionado
 -> módulos + firmware + receipts vinculados
 -> QEMU + evidência/provenance
```

O workflow pesado aceita seleção manual `minimal|owner-development`. Em PR vindo de `platform/remove-alpine`, a prova usa `owner-development`; PRs comuns preservam `minimal`. O kernel é construído somente em cache miss, verificado antes de o rootfs Owner consumir seu archive de módulos e nunca recompilado pelo post-build.

O gate rápido não substitui o pesado. Ele existe para evitar recompilar a plataforma inteira após mudanças que ainda podem ser rejeitadas por testes baratos. Mudanças normais em `system/`, Surface, apps, contas, Spaces e Web continuam independentes quando seus owners não alteram a base.

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
| `bootstrap/base/alpine_core.py` | Alpine minirootfs, espelho APK, `apk add` | distribuição | remover somente após último consumidor migrado |
| `bootstrap/stable-base/build.py` | `alpine_core.py`/APK e parâmetros Stable | distribuição + build | separar responsabilidades neutras e convergir para base independente |
| `bootstrap/dev-base/build.py` | builder Alpine Dev aposentado na PR #2243 | distribuição | removido sem alterar a política de prova física do USB Owner |
| `bootstrap/base/runtime_policy.py` | `apk del`, chaves APK | distribuição | eliminar após consumidores deixarem de depender de APK |
| `bootstrap/base/firmware_policy.py` | módulos/firmware do kernel | política independente | preservada e reutilizada como política neutra |
| `bootstrap/base/kernel_module_payload.py` | archive do kernel + hardware matrix | política independente | novo owner neutro do payload selecionado de módulos |
| `bootstrap/initramfs/build.py` | BusyBox oficial + `musl-gcc` | independente | preservar |
| `bootstrap/network/build.py` | BusyBox oficial + `musl-gcc` | independente | preservar scripts e contrato |
| `bootstrap/native-initramfs/build.py` | builder Ubuntu pinado | outro perfil/build | fora do corte Alpine da base portátil |
| `bootstrap/surface-runtime` | runtime hoje obtido via pacotes APK | consumidor de distribuição | migrar sem colocar gerenciador de pacotes no runtime base |

A ordem de trabalho e os critérios de corte estão em `MIGRATION-REMOVE-ALPINE.md`. Não criar wrapper permanente para manter duas bases ativas.

## Critério de conclusão

Buildroot, proveniência, boot, rede, firmware, Wi-Fi, Git/CA quando exigidos, Surface/runtime, recovery e rollback devem alcançar paridade suficiente com os contratos canônicos. Depois disso, os consumidores Alpine são removidos, a prova pesada final passa, os contratos/promotions são atualizados e a branch temporária é integrada e apagada.

**Resultado de execução:** não preencher indicadores PASS sem a execução correspondente. Runs CI, provenance e receipts continuam sendo as evidências primárias.
