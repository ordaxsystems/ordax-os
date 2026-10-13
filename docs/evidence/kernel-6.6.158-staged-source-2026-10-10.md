# Kernel LTS 6.6.158 — evidência de integração em staging (10/10/2026)

## Autoridades e escopo

- O único source ativo do OS é `bootstrap/kernel/source.json`.
- A origem assinada e revisada do patch foi `bootstrap/kernel/candidates/6.6.158.json`, verificada pelo owner OpenPGP (fingerprint `647F28654894E3BD457199BE38DBBDC86092693E`).
- A PR [#1616](https://github.com/ordaxsystems/ordax-os/pull/1616) compila e testa essa fonte em um **head de PR**; não constitui promoção à main, aprovação de release pública ou escrita em disco físico.
- `bootstrap/kernel/build.py`, `bootstrap/initramfs/build.py`, `tools/creator/assemble.py` e o updater A/B continuam como produtores/consumidores oficiais. Não foi criado segundo builder ou nova fonte de versão.

## Bytes conferidos no build exato de staging

A execução [Kernel Candidate 38092513701](https://github.com/ordaxsystems/ordax-os/actions/runs/38092513701), compilando o head inicial `db7830955ef47584d2ec58d01ec09fa749274ea4`, validou hashes e proveniência. Esses digests repetem os observados anteriormente no build autenticado 38089003597:

| Artefato | SHA-256 |
| --- | --- |
| `kernel-6.6.158.config` | `b43c817ebdfd703266670461759252cbf4efb3de6b746f3eed720feb83f5d855` |
| `kernel-modules-6.6.158.tar` | `b8c23a0c04672191a7855249956e0a12f8989ac9b2a5bc9c68f6ccc873f5c81d` |
| `vmlinuz-6.6.158` | `16d1b7a190d7a11f748aa65fa7f6e940a0e7f5c79641f38bb2c98354918ec87f` |

A execução [Full Bootstrap Media Proof 38092513643](https://github.com/ordaxsystems/ordax-os/actions/runs/38092513643), sobre o mesmo head de staging, validou integralmente os 15 artefatos do bootstrap e os hashes embutidos; entre eles:

- `bootstrap/kernel/vmlinuz-6.6.158`: `16d1b7a190d7a11f748aa65fa7f6e940a0e7f5c79641f38bb2c98354918ec87f`.
- `bootstrap/initramfs/initramfs.cpio.gz`: `774a6f659eb217503cc44e65cc98e36edb22d93cbfede8a719c3eede7d8c2a3f`. O mesmo SHA do bootstrap anterior foi **efetivamente reconstruído e conferido**, e não reutilizado por suposição.
- `BYTE_COMPLETE_PAYLOAD=PASS`, `REAL_BOOTSTRAP_MEDIA_COMPOSITION=PASS` e prova descartável de mídia/expansão ext4 aprovadas.

O contrato `system/base-update/candidate.json` precisa usar exatamente esses dois digests. O teste `tests/test_base_update_signed_candidate.py` exige a igualdade com os artefatos do manifesto para impedir desvio silencioso.

## Prova atual da fonte assinada 6.6.158

A execução imutável [38094493855](https://github.com/ordaxsystems/ordax-os/actions/runs/38094493855) executada no head `1f0ee7efaa5eb60f786221a1053ce91464759993` terminou com:

- `KERNEL_BUILD_ENVIRONMENT=PASS`, `PACKAGE_COUNT=19` (inclui `gpg` e `gpg-agent` com versões exatas do snapshot de 2026-09-10).
- Autenticação `upstream_signature.status=verified` e fingerprint `647F28654894E3BD457199BE38DBBDC86092693E`.
- `KERNEL_REPRODUCIBILITY=PASS`; `REPEAT_BUILD_DIGEST_MATCH=YES`.
- Kernel, módulos e configuração com SHA-256 idênticos aos três digests já documentados acima.
- No mesmo head, os checks Native ESP, QEMU Portable, initramfs, Stable Base, Creator e full bootstrap media proof passaram em CI; as etapas `publish` e `build-authorized-candidate` foram corretamente ignoradas.

A evidência é vinculada ao commit testado e preserva o histórico anterior de 6.6.52. `pinned_environment_resolved=true` indica **somente** ambiente reproduzível; `physical_artifact_authorized=false` e `physical_write_allowed=false` continuam vigentes. A reconciliação documental e de contratos gera novo commit, que precisa de nova validação do GitHub antes do merge.

## Gates que não podem ser inferidos

1. Repetir a compilação no ambiente imutável contra o **head final** da PR e comparar config, módulos e kernel.
2. Obter Native ESP e Portable v2 QEMU/OVMF/rollback no head final, sem declarar boot físico.
3. Todas as regressões devem passar após o rebind do descritor A/B e a correção já integrada em #1617.
4. Só então considerar merge da alteração de source; o contrato de atualização de kernel ativo não é uma autorização de gravação.
5. A instalação física exige decisão separada do owner, prova do dispositivo e confirmação destrutiva específica; nenhuma delas consta aqui.

Esta evidência é uma observação imutável do staging e **não** substitui o SSOT de source, os relatórios do runner nem as provas do commit final. A condição `physical_artifact_authorized=false` permanece.
