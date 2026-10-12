# Independent Base — Fase 2, boot portátil oficial (experimental)

**Status: integração de boot comprovada em QEMU; candidata não promovível a produção.**
A PR #1685 (fase mínima Buildroot) foi integrada. A PR #1693 adiciona a integração opcional ao boot portátil, mantendo Alpine, Stable oficial, Creator, Surface, Wine, aplicativos e dispositivos físicos inalterados.

## Autoridades únicas reutilizadas

- **Base Buildroot 2026.08:** `bootstrap/independent-base/build.py`; kernel e ABI definidos em `bootstrap/kernel/source.json`. Configuração nativa e reproduzível de BusyBox em `configs/ordax_minimal_defconfig` + `configs/portable-handoff.busybox.fragment`, com `stat -c` e `timeout -k` realmente executados durante o build e SHA-256 do fragmento na proveniência.
- **PID1:** `bootstrap/initramfs/portable_init.sh`, criado/pinado/verificado por `bootstrap/initramfs/build.py`; mantém verificação da cápsula e SHA-256 fixo da imagem EROFS. Não existe PID1 paralelo para uso portátil.
- **Handoff:** `bootstrap/stable-base/ordax-stable-init` copiado sem alterações para a imagem independente, com comparação de SHA-256; `/system/entrypoint` continua sendo do release assinado oficial.
- **Boot/montagem/estado:** `bootstrap/initramfs/portable_mount.c` e `portable_state.c` (EROFS read-only, ext4 persistente, OverlayFS, `candidate/current/known-good/rejected`), sem fork de seletor ou atualizador.
- **Verificação de releases:** agentes oficiais `bootstrap/release-acquisition`, assinaturas Ed25519 e trust anchor do build de testes; as chaves efêmeras do CI não são credenciais de publicação.
- **Harness:** `bootstrap/portable-v2/qemu_boot.py`, `uefi_boot.py` e seu workflow reutilizável `.github/workflows/portable-v2-qemu-boot-proof.yml`. O parâmetro `base_source: independent` é usado somente pelo workflow experimental; **o padrão permanece `stable`**.
- **Adaptadores experimentais:** `portable_boot_proof.py` valida a proveniência/pin da imagem Buildroot e chama o QEMU oficial usando somente discos descartáveis. `signed_release_failure_qemu.py` injeta assinatura Ed25519 inválida apenas na cópia do release no disco virtual e reutiliza montagem do disco, seleção, verificação e inspeção de estado oficiais.

## Provas reais auditadas — commit `13dc3b4edef565938e684b862e61a21bde192e54`

As provas abaixo foram concluídas **neste SHA**. Qualquer reconciliação posterior exige checks próprios antes do merge.

| Verificação | GitHub Actions / evidência | Resultado |
| --- | --- | --- |
| Foundation e contratos | [#38282272694](https://github.com/ordaxsystems/ordax-os/actions/runs/38282272694) | PASS |
| Buildroot 2026.08, BusyBox, EROFS e 3 boots QEMU mínimos | [#38282273033](https://github.com/ordaxsystems/ordax-os/actions/runs/38282273033) | PASS |
| Stable original, boot direto, one-shot e UEFI/OVMF | [#38282272873](https://github.com/ordaxsystems/ordax-os/actions/runs/38282272873) | PASS |
| Base independente com PID1 canônico, release v4 assinado, EROFS/ext4/OverlayFS, persistência e UEFI/OVMF | [#38282273164](https://github.com/ordaxsystems/ordax-os/actions/runs/38282273164), artifact `11764274216` | PASS |
| Rollback de candidata v4 não confirmada para current v3, 2 inicializações, rejected persistido | [#38282273164](https://github.com/ordaxsystems/ordax-os/actions/runs/38282273164), `qemu-one-shot-proof/proof.json` | PASS |
| Assinatura Ed25519 da candidata corrompida, seleção do release anterior por 2 boots, persistência no ext4 | mesmo artifact, `qemu-signed-fault-proof/proof.json` | PASS |
| Ambas assinaturas inválidas: sem handoff, resgate local; `ordax.mode=recovery` read-only e disco sem alterações | mesmo artifact, quatro logs seriais com SHA-256 no receipt | PASS |

**Identidades confirmadas pelos recibos:** Buildroot EROFS `39cfd04708d5a42b3a34db8891d6b4b22e3f0d32c7e8923e204f5ef947d3cbc8`; initramfs `bb600aa7f765fe63cab5a7384eef95c5a2b4445fef37a0e1c1951042c595a32e`; handoff oficial `5b848b4cd0d3ca8bfb0a90a1544fb13be059e62c474abdb052bac70ff48a4ae6`; fragmento BusyBox `d197f42ba877c69e5cb67b65a83b6380c89da798973edfbdf7404b92492bda07`.

**Integridade dos artifacts GitHub:** independente `11764274216`, ZIP SHA-256 `307565bee9352e02dd790c951ec1b5d1be5a9414929c9d13777f040175961993`; Stable `11762742948`, ZIP `a98579f8902776fc74ef0e4767e4d1bd1d19e2c6f8b563344a5a6218415e437e`; prova mínima Buildroot `11762154806`. Os quatro hashes das séries foram conferidos contra os bytes dos logs.

## Limites técnicos, de segurança e promoção

**Confirmado:** compatibilidade do caminho portátil oficial na arquitetura QEMU x86_64; boot direto e UEFI com OVMF; SHA-256 fixo do EROFS; releases de teste assinados; selection/fallback `candidate/current/known-good`; ext4/OverlayFS; resgate em caso de falha de assinatura; recuperação explícita sem escrita na imagem e sem rede.

**Não confirmado:** Secure Boot, assinatura de produção/cerimônia de chaves reais, USB e hardware físico, saúde fria do Stable pós-reboot para promoção, carregamento real de drivers/firmware Wi-Fi, paridade de serviços de sistema, persistência de sessões reais de apps, integração gráfica/Wayland/Wine e migração completa das dependências Alpine. O relatório Buildroot continua deliberadamente com `qemu_boot_proven=false` e `signed_release_equivalence_proven=false`, porque essa proveniência descreve **somente o build**, enquanto os recibos QEMU independentes comprovam a integração posterior. **Não falsificar ou ativar flags de promoção.**

A integração é uma capacidade de teste isolada. O Stable continua padrão; a migração do produto/serviços e a eventual retirada de Alpine exigem projeto e provas separados. Nenhuma gravação de pendrive físico, mudança na Surface, nas aplicações, no Creator ou no Vercel é autorizada por esta Fase 2.

**Gate de merge:** checks obrigatórios e de regressão verdes **no SHA final reconciliado**, revisão de isolamento e compatibilidade com `main`; não forçar merge e não contornar falhas de publicação externa.