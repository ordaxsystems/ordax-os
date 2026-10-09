# Reconciliação da medição do rootfs do Development Base

## Sintoma observado

No `main@b2a63520342e27b15e0b2397f0b177145b49e211`, o workflow
`Development Base Channel` ([run 37871675808](https://github.com/ordaxsystems/ordax-os/actions/runs/37871675808))
aprovou `verify`, mas falhou em `publish` na etapa de build com
`development rootfs expanded bytes exceed channel limit`.

## Causa-raiz

`bootstrap/base/alpine_core.py::unique_regular_bytes()` mede bytes uma vez
por inode (`st_dev`, `st_ino`) e registra isso na proveniência. O canal já
serializava aliases internos em TAR como hardlinks seguros após a PR #1495,
mas `tools/dev-base-channel/build.py::validate_rootfs_source()` ainda
somava `st_size` por pathname, inclusive para centenas de hardlinks
gerados pelo achatamento de symlinks Alpine. O limite de 320 MiB rejeitava
uma soma fictícia que não correspondia aos bytes únicos presentes.

## Correção integrada

A [PR #1496](https://github.com/ordaxsystems/ordax-os/pull/1496) integrou em
`main@19eb1bd91ca4137edb7319532984d50bf3af3e0f` a medição por
`(st_dev, st_ino)` único e a conferência exata com
`provenance.json.unique_regular_bytes`. Foram preservadas as rejeições de
symlinks, objetos especiais e referências TAR inseguras. Não houve aumento
de limites, afrouxamento de validação, mudança na política de ativação ou
substituição da assinatura Stable.

A execução Linux da PR, `Development Base Channel`
([run 37873453659](https://github.com/ordaxsystems/ordax-os/actions/runs/37873453659)),
passou **14/14 testes**, incluindo construção integral com 390 hardlinks
de 1 MiB (>320 MiB na soma ingênua, ~1 MiB único), divergência de tamanho
na proveniência, materialização de hardlinks seguros e rejeição de links
inseguros. `Foundation Contract` ([run 37873453652](https://github.com/ordaxsystems/ordax-os/actions/runs/37873453652))
também passou.

## Prova pós-merge: publicação e auditoria independente

O workflow de push da `main`, `Development Base Channel`
([run 37873601758](https://github.com/ordaxsystems/ordax-os/actions/runs/37873601758)),
concluiu **verify = success** e **publish = success**, incluindo a
reconstrução do kernel, `initramfs`, rootfs e upload dos quatro assets.

Identidade imutável auditada:

- Repositório: `ordaxsystems/ordax-os`
- Commit-fonte: `19eb1bd91ca4137edb7319532984d50bf3af3e0f`
- Release *prerelease* (não Stable):
  [`ordax-dev-base-19eb1bd91ca4137edb7319532984d50bf3af3e0f`](https://github.com/ordaxsystems/ordax-os/releases/tag/ordax-dev-base-19eb1bd91ca4137edb7319532984d50bf3af3e0f)
- `isPrerelease = true`, `isDraft = false`; manifesto vinculado ao
  repositório, commit e às URLs canônicas exatas.
- Ativação declarada: `inactive-slot-next-boot`, rootfs
  `slot-coupled-one-shot-health-gated`, `manual_usb_rewrite_required=false`.

Após download independente dos quatro assets pelo GitHub CLI no computador
autorizado, conferimos o tamanho e SHA-256 localmente (e, para os três
binários, contra os vínculos no manifesto):

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `dev-base.json` | 1.273 | `a5b0d2ff0c0f500aaf09181cd53f377056672bb3b417a74e4a031a6aa93980e0` |
| `vmlinuz` | 10.482.688 | `cbe9b7421d6d4ece48b6025866c371557e6301fef981336a52a949544e925205` |
| `initrd.gz` | 185.975 | `63a504c4349aebc43d9ed642ff14384191fd9804e8a657691ffe997441a9edf0` |
| `rootfs.tar` | 68.300.800 | `39a6e2e757908b31348ba3e76e90ffcb909985a09e4dc3e8c4702c9e10d53148` |

O comando `py tools/dev-base-channel/build.py verify --out-dir <diretorio>`
sobre o material baixado passou (`PRODUCER_VERIFY_EXIT=0`). A função real
`system/services/base-update/dev_channel.py::_validate_rootfs_archive()`
também aceitou o TAR (`CONSUMER_VERIFY_EXIT=0`), encontrando exatamente:

- 408 arquivos regulares;
- 744 hardlinks internos seguros;
- 141 diretórios;
- **67.532.212 bytes de payload regular único**.

Essa é a evidência de ponta a ponta de que o defeito de contagem e
serialização não impede mais a publicação do Development Base neste commit.
O arquivo TAR contém metadados de cabeçalho e entradas de hardlink;
por isso seu tamanho de 68.300.800 bytes difere do payload único.

## Limites do resultado e gates separados

**Concluído:** testes Linux, build real do commit da `main`, publicação
imutável e verificação independente do manifesto, dos hashes e dos dois
validadores do rootfs.

**Não comprovado por esta auditoria:** boot físico, instalação em HD/SSD,
promoção por cold-health, operação final de atualização A/B em dispositivo
real e publicação de **Stable Ed25519**. A publicação é de desenvolvimento
e não autoriza substituir os gates físicos e de assinatura. O preflight de
namespace que exige uma Stable assinada continua *fail-closed* até existir
a respectiva evidência autêntica.
