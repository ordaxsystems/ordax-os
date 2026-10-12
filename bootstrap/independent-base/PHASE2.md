# Fase 2 — ligação experimental da Independent Base ao boot portátil oficial

**Status: código do adaptador implementado, prova QEMU portátil ainda pendente.**
Não ativar em Stable, Creator, Surface, Wine, apps ou mídia física.

## Autoridade única reutilizada

- Base mínima produzida por `bootstrap/independent-base/build.py` em `independent-base.erofs`.
- Kernel e módulos: `bootstrap/kernel/source.json` e `bootstrap/kernel/build.py`.
- Código do primeiro handoff pós-`switch_root`: `bootstrap/stable-base/ordax-stable-init`, copiado **sem alterações** para `/sbin/ordax-stable-init` dentro da nova imagem; hash SHA-256 de origem/cópia validado no build e registrado na proveniência. Isso não instala Alpine nem seu APK; o módulo `modprobe` e applets da BusyBox são obrigatórios e verificados. A política atual de módulos Wi-Fi ainda não tem equivalência comprovada na base mínima.
- PID1 oficial: `bootstrap/initramfs/portable_init.sh`; não é embutido um segundo PID1 permanente.
- Pin da imagem: builder/verifier oficial `bootstrap/initramfs/build.py` + `portable_base_verify.sh`.
- Montagem e estado: `bootstrap/initramfs/portable_mount.c` + `portable_state.c` (EROFS ro, ext4 rw, OverlayFS e `candidate/current/known-good`), sem fork.
- Assinatura e release: cápsula existente `bootstrap/portable-v2/capsule/build.py`, `bootstrap/release-acquisition`, `tools/release-signing` e o harness **oficial** `bootstrap/portable-v2/qemu_boot.py`.

O arquivo `bootstrap/independent-base/portable_boot_proof.py` **não implementa** boot, assinatura ou rollback: ele checa artefatos/proveniências, invoca o builder oficial do initramfs com o SHA-256 da candidata, inspeciona o pin gerado e chama a prova QEMU oficial. É um adaptador isolado para testar candidatos; o ext4 externo é copiado com SHA-256 para um arquivo descartável, nunca montado/alterado como entrada.

## Execução com artefatos reais já preparados

O adaptador exige kernel canônico, cápsula assinada/verificada, release exato assinado com `surface-runtime` e possível `local-ai`, estado ext4 e trust produzidos pelos **builders oficiais**. Não aceita substituir tais evidências por manifests simulados. Execute somente num runner Linux descartável com QEMU, utilitários de loop/partição e privilégios necessários.

```sh
python3 bootstrap/independent-base/portable_boot_proof.py \
  --base-out /tmp/independent-buildroot \
  --kernel /tmp/portable-v2/kernel/vmlinuz-6.6.158 \
  --capsule /tmp/portable-v2/capsule/bootstrap.erofs \
  --state-image /tmp/portable-v2/persistent-state.img \
  --portable-root /tmp/portable-v2/portable/.ordax \
  --trust /tmp/portable-v2/release-trust.json \
  --source-commit <SHA40_DO_COMMIT_CANDIDATO> \
  --output-dir /tmp/independent-portable-proof
```

Para exigir prova do **rollback one-shot real**, fornecer também `--previous-commit <SHA40_ANTERIOR>` e uma imagem de estado explicitamente armada com o helper `ordax-portable-state prepare` oficial. A prova é abortada quando o receipt não comprova `armed_candidate_one_shot_proven=true`.

## Gates ainda abertos — não inventar PASS

- Compilar a nova imagem com `/sbin/ordax-stable-init` idêntico ao canônico e verificar dependências do runtime.
- Produzir todos os artefatos de release assinado por builders oficiais, sem alterar release/Surface/Wine.
- Executar `qemu_boot.py` via adaptador, em QEMU com `rdinit=/sbin/ordax-portable-init`, e obter recibo normal + one-shot rollback.
- Injetar falhas de assinatura/release corrupto e demonstrar fallback/recuperação, incluindo evidências seriais, imagens e hashes.
- Provar paridade de comandos, módulos/firmware, serviços e estado antes de qualquer promoção; nenhum desses gates é substituído pela prova de PID1 mínimo da Fase 1.
- QEMU não prova UEFI, Secure Boot, hardware, firmware Wi-Fi nem uso físico.

**Isolamento:** todas as mudanças desta fase permanecem em `feat/independent-base-portable-v2-integration-20261012`; base Alpine corrente, Creator, Stable e os caminhos de boot publicados não foram alterados. A branch foi inicialmente criada a partir de `7d21fb470895fe5328d4cd6cc6d2ef683ff671d1` (candidata reconciliada da PR #1685). Após o merge da #1685, reconciliar e reexecutar checks, sem reescrever históricos alheios.
