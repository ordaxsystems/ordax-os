# Independent Base — Fase 2, boot portátil oficial (experimental)

**Status: Fase 2 concluída e integrada à `main` em 12/10/2026 como capacidade experimental; não habilitada como padrão e não promovível à produção.**
A PR #1685 (fase mínima Buildroot) foi integrada. A PR #1693 adiciona a integração opcional ao boot portátil, mantendo Alpine, Stable oficial, Creator, Surface, Wine, aplicativos e dispositivos físicos inalterados.

## Autoridades únicas reutilizadas

- **Base Buildroot 2026.08:** `bootstrap/independent-base/build.py`; kernel e ABI definidos em `bootstrap/kernel/source.json`. Configuração nativa e reproduzível de BusyBox em `configs/ordax_minimal_defconfig` + `configs/portable-handoff.busybox.fragment`, com `stat -c` e `timeout -k` realmente executados durante o build e SHA-256 do fragmento na proveniência.
- **PID1:** `bootstrap/initramfs/portable_init.sh`, criado/pinado/verificado por `bootstrap/initramfs/build.py`; mantém verificação da cápsula e SHA-256 fixo da imagem EROFS. Não existe PID1 paralelo para uso portátil.
- **Handoff:** `bootstrap/stable-base/ordax-stable-init` copiado sem alterações para a imagem independente, com comparação de SHA-256; `/system/entrypoint` continua sendo do release assinado oficial.
- **Boot/montagem/estado:** `bootstrap/initramfs/portable_mount.c` e `portable_state.c` (EROFS read-only, ext4 persistente, OverlayFS, `candidate/current/known-good/rejected`), sem fork de seletor ou atualizador.
- **Verificação de releases:** agentes oficiais `bootstrap/release-acquisition`, assinaturas Ed25519 e trust anchor do build de testes; as chaves efêmeras do CI não são credenciais de publicação.
- **Harness:** `bootstrap/portable-v2/qemu_boot.py`, `uefi_boot.py` e seu workflow reutilizável `.github/workflows/portable-v2-qemu-boot-proof.yml`. O parâmetro `base_source: independent` é usado somente pelo workflow experimental; **o padrão permanece `stable`**.
- **Adaptadores experimentais:** `portable_boot_proof.py` valida a proveniência/pin da imagem Buildroot e chama o QEMU oficial usando somente discos descartáveis. `signed_release_failure_qemu.py` injeta assinatura Ed25519 inválida apenas na cópia do release no disco virtual e reutiliza montagem do disco, seleção, verificação e inspeção de estado oficiais.

## Provas reais auditadas — commit `a68f5f644b02545178b24cbf2b71fb65e1fcf751`

As provas abaixo foram concluídas **neste SHA final**, auditadas antes do merge normal da PR #1693.

| Verificação | GitHub Actions / evidência | Resultado |
| --- | --- | --- |
| Foundation e contratos | [#38289772729](https://github.com/ordaxsystems/ordax-os/actions/runs/38289772729) | PASS |
| Buildroot 2026.08, BusyBox, EROFS e 3 boots QEMU mínimos | [#38289772708](https://github.com/ordaxsystems/ordax-os/actions/runs/38289772708) | PASS |
| Stable original, boot direto, one-shot e UEFI/OVMF | [#38289772724](https://github.com/ordaxsystems/ordax-os/actions/runs/38289772724) | PASS |
| Base independente com PID1 canônico, release v4 assinado, EROFS/ext4/OverlayFS, persistência e UEFI/OVMF | [#38289773282](https://github.com/ordaxsystems/ordax-os/actions/runs/38289773282), artifact `11768272288` | PASS |
| Rollback de candidata v4 não confirmada para current v3, 2 inicializações, rejected persistido | [#38289773282](https://github.com/ordaxsystems/ordax-os/actions/runs/38289773282), `qemu-one-shot-proof/proof.json` | PASS |
| Assinatura Ed25519 da candidata corrompida, seleção do release anterior por 2 boots, persistência no ext4 | mesmo artifact, `qemu-signed-fault-proof/proof.json` | PASS |
| Ambas assinaturas inválidas: sem handoff, resgate local; `ordax.mode=recovery` read-only e disco sem alterações | mesmo artifact, quatro logs seriais com SHA-256 no receipt | PASS |

**Identidades confirmadas pelos recibos:** Buildroot EROFS `111234f137457932db8bd9aa7341eef2a6b8503f49e900b9d4c49ecc37141a6f`; initramfs com pin SHA-256 do EROFS verificado no receipt canônico; handoff oficial `5b848b4cd0d3ca8bfb0a90a1544fb13be059e62c474abdb052bac70ff48a4ae6`; fragmento BusyBox `d197f42ba877c69e5cb67b65a83b6380c89da798973edfbdf7404b92492bda07`.

**Integridade dos artifacts GitHub:** independente `11768272288`, ZIP SHA-256 `27f56bfda284678a737a8fad1a20dffe5c6280f4aae97a016338e56f2eb8f1aa`; Stable `11767077168`, ZIP `a7a57d9c8c39c8585c0c575e268a645b04fd553e2a797a79bb4a7dd5da427294`; prova mínima Buildroot `11766871884`. Os quatro hashes das séries foram conferidos contra os bytes dos logs.

## Limites técnicos, de segurança e promoção

**Confirmado:** compatibilidade do caminho portátil oficial na arquitetura QEMU x86_64; boot direto e UEFI com OVMF; SHA-256 fixo do EROFS; releases de teste assinados; selection/fallback `candidate/current/known-good`; ext4/OverlayFS; resgate em caso de falha de assinatura; recuperação explícita sem escrita na imagem e sem rede.

**Não confirmado:** Secure Boot, assinatura de produção/cerimônia de chaves reais, USB e hardware físico, saúde fria do Stable pós-reboot para promoção, carregamento real de drivers/firmware Wi-Fi, paridade de serviços de sistema, persistência de sessões reais de apps, integração gráfica/Wayland/Wine e migração completa das dependências Alpine. O relatório Buildroot continua deliberadamente com `qemu_boot_proven=false` e `signed_release_equivalence_proven=false`, porque essa proveniência descreve **somente o build**, enquanto os recibos QEMU independentes comprovam a integração posterior. **Não falsificar ou ativar flags de promoção.**

A integração é uma capacidade de teste isolada. O Stable continua padrão; a migração do produto/serviços e a eventual retirada de Alpine exigem projeto e provas separados. Nenhuma gravação de pendrive físico, mudança na Surface, nas aplicações, no Creator ou no Vercel é autorizada por esta Fase 2.

**Encerramento / commit de integração:** a [PR #1693](https://github.com/ordaxsystems/ordax-os/pull/1693) foi mesclada normalmente na `main` no commit `74f643daf43ec30a9889744b21b2508318004f38`. Os cinco checks GitHub Actions do head `a68f5f6` e o status Vercel estavam `success` antes do merge; o Vercel registrou `Canceled by Ignored Build Step` (sem afirmar novo deploy). Os quatro commits paralelos da `main` foram preservados, sem rebase/force e sem arquivos de conflito. A base continua **experimental e desabilitada como padrão**; não houve migração para Alpine nem início da Fase 3.