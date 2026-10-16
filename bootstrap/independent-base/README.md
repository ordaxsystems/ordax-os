# Base independente OrdaX — experimento isolado

**Estado (16/10/2026):** capacidade independente experimental **não promovível**, agora usada também como única trilha técnica da migração temporária `platform/remove-alpine`. A Fase 2 de boot portátil e a Fase 3 de saúde gráfica real já foram validadas em QEMU, incluindo release assinado, recuperação e segundo boot `current`. Isso não comprova Secure Boot, equivalência em hardware físico, firmware/Wi-Fi ou autorização de migração. Esta pasta não cria outra distribuição, linha de atualização, gerenciador de pacotes ou boot de produção.

A migração não cria um segundo owner: ela reutiliza este diretório e segue `MIGRATION-REMOVE-ALPINE.md`. `main` continua sendo a única source authority; a branch temporária existe apenas para impedir que builds longos da base bloqueiem o desenvolvimento normal.

## Escolha técnica

**Buildroot 2026.08**, fixado por SHA-256 em `source.json`, constrói BusyBox + musl desde fontes upstream, sem Alpine, APK ou minirootfs Alpine. Buildroot é ferramenta de *build* e não é instalado como gerenciador do runtime. Yocto/OpenEmbedded foi avaliado: permite distribuições complexas e feeds, porém amplia desnecessariamente a manutenção deste primeiro estágio mínimo. Construção manual de libc/BusyBox foi descartada para não manter uma toolchain própria; Linux From Scratch não é um pipeline de release reproduzível.

O perfil Buildroot usa `bootstrap/kernel/source.json` como única versão de cabeçalhos, não constrói outro kernel. A semântica neutra **EROFS somente leitura** é consultada no SSOT já existente `docs/contracts/portable-boot-handoff.json` (`proof.release_mount`). A compatibilidade provisória de compressão LZ4 e rótulo `ORDAX-BASE` é consultada em `bootstrap/stable-base/source.json` **somente como parâmetros de artefato**. Não surge um segundo contrato de formato, de boot ou de atualizações. A rede DHCP reutiliza `bootstrap/network/bring-up` e `udhcpc.script`, com seus hashes validados pelo contrato existente. BusyBox e musl são software independente do Alpine, embora a base Alpine antiga também os distribua.

## Limites importantes

- A base Alpine dos perfis Development e Stable continua ativa em `main` até o corte final comprovado; não será removida prematuramente.
- A branch `platform/remove-alpine` pode alterar consumidores e contratos somente para provar a substituição; nenhum desses bytes é automaticamente Stable ou gravável em mídia física.
- Não há SSH, Git, Wi-Fi, firmware de notebooks, gerenciamento de pacotes ou serviços de produto nesta base mínima; DHCP com Ethernet/QEMU user NAT é o escopo atualmente comprovado.
- A inicialização `ordax-independent-probe-init` é exclusivamente um programa de **teste QEMU**, não substitui `bootstrap/initramfs/portable_init.sh`, os verificadores de release, seleção de slots ou serviços atuais.
- **Não** se pode distribuir, assinar, instalar, ligar ao Creator, ativar Base Update, substituir `stable-base.erofs` ou modificar USB com este artefato enquanto os gates de promoção permanecerem fechados.
- O teste QEMU usa o kernel **real** `bootstrap/kernel/build.py` e valida seu provenance. Testa montagem EROFS somente-leitura e escrita rejeitada, imagem ext4 descartável persistente, DHCP e falha segura de EROFS inválido. O QEMU usa `snapshot=on` para permitir emulação IDE com backend COW descartável sem modificar os bytes originais de EROFS, cuja integridade é novamente verificada por SHA-256.
- Exige execução de CI Linux; nenhum passo pertence à estação de trabalho do usuário.

## Política de CI da migração

O loop de desenvolvimento e a prova de plataforma são deliberadamente diferentes:

```text
push em platform/remove-alpine
 -> .github/workflows/remove-alpine-fast.yml
 -> contratos + unitários + sintaxe + invariantes estáticos
 -> sem Buildroot/kernel/full USB

marco estrutural / integração final
 -> .github/workflows/independent-base-experiment.yml
 -> Buildroot real + kernel canônico verificado + QEMU
 -> evidência/provenance
```

O gate rápido não substitui o pesado. Ele existe para evitar recompilar a plataforma inteira após mudanças que ainda podem ser rejeitadas por testes baratos. Mudanças normais em `system/`, Surface, apps, contas, Spaces e Web continuam independentes quando seus owners não alteram a base.

## Uso de recursos no builder

A compilação `make -j` do Buildroot usa **captura limitada de stdout/stderr** no builder oficial: o processo pai conserva só os últimos 10 KiB de saída para diagnosticar falhas, evitando que logs extensos consumam RAM proporcional à duração do build. Comandos menores que precisam de sua saída completa mantêm a captura tradicional.

Cache permitido deve ser verificável e derivado de inputs versionados. O kernel já pode ser reutilizado por fingerprint no workflow pesado. Diretórios mutáveis de compilação não são evidência e não podem atravessar commits como substituto de build/verificação.

## Métricas mínimas observáveis (sem promoção)

O recibo do QEMU mínimo inclui bytes reais de EROFS, initramfs e kernel; tempo total de processo QEMU no host; e medições do guest via `/proc`: memória em uso aproximada, percentual de ticks CPU ocupados desde o início do kernel, quantidade de processos e uptime até o marcador de conclusão. Não confundir essas medidas pontuais com pico de RAM, consumo médio de CPU, tempo de boot de firmware/UEFI, Surface gráfica ou tamanho da imagem USB completa.

## Entrypoints reproduzíveis

```sh
python3 bootstrap/independent-base/build.py check
python3 -m unittest tests.test_independent_base_experiment -v

# Build pesado apenas quando o gate de plataforma exigir:
python3 bootstrap/independent-base/build.py build \
  --out /tmp/ordax-independent-base --cache /tmp/ordax-buildroot-cache --jobs 4
python3 bootstrap/independent-base/build.py verify --out /tmp/ordax-independent-base

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
| `bootstrap/dev-base/build.py` | importa `alpine_core.py` | distribuição | migrar depois que Git/rede/CA do perfil Development tiverem paridade comprovada |
| `bootstrap/base/runtime_policy.py` | `apk del`, chaves APK | distribuição | eliminar após consumidores deixarem de depender de APK |
| `bootstrap/base/firmware_policy.py` | módulos/firmware ELF/kernel | política independente, entrada ainda via Alpine | preservar e reutilizar como política neutra |
| `bootstrap/initramfs/build.py` | BusyBox oficial + `musl-gcc` | independente | preservar |
| `bootstrap/network/build.py` | BusyBox oficial + `musl-gcc` | independente | preservar scripts e contrato |
| `bootstrap/native-initramfs/build.py` | builder Ubuntu pinado | outro perfil/build | fora do corte Alpine da base portátil |
| `bootstrap/surface-runtime` | runtime hoje obtido via pacotes APK | consumidor de distribuição | migrar sem colocar gerenciador de pacotes no runtime base |

A ordem de trabalho e os critérios de corte estão em `MIGRATION-REMOVE-ALPINE.md`. Não criar wrapper permanente para manter duas bases ativas.

## Critério de conclusão

Buildroot, proveniência, boot, rede, firmware, Wi-Fi, Git/CA quando exigidos, Surface/runtime, recovery e rollback devem alcançar paridade suficiente com os contratos canônicos. Depois disso, os consumers Alpine são removidos, a prova pesada final passa, os contratos/promotions são atualizados e a branch temporária é integrada e apagada.

**Resultado de execução:** não preencher indicadores PASS sem a execução correspondente. Runs CI, provenance e receipts continuam sendo as evidências primárias.
