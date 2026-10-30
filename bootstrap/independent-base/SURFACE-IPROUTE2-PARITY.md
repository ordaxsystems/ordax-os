# Paridade de `/sbin/ip` da Surface — primeiro slice da substituição do Alpine

**Owner:** `bootstrap/independent-base` / issue #1730. **Status:** candidato experimental; não substitui Stable, Creator, PID1, Supervisor, runtimes gráficos assinados nem o USB sob responsabilidade de outro owner.

## Bloqueio observado

A prova anterior da base mínima continha `/sbin/ip -> ../bin/busybox`. O applet BusyBox disponível não comprovava o contrato usado pelo launcher canônico `system/surface/bin/ordax-surface`, que executa `/sbin/ip address replace 127.0.0.1/8 dev lo`. Presença de pacote, applet ou texto de ajuda não é prova de compatibilidade funcional.

## Correção e prova

O perfil Buildroot seleciona `BR2_PACKAGE_IPROUTE2=y` e o fragmento canônico do BusyBox desativa `CONFIG_IP`, mantendo uma única implementação de `ip`. No Buildroot 2026.08 atualmente fixado por `source.json`, esse pacote resolve iproute2 7.1.0.

O pacote upstream instala a suíte completa por padrão, mas este slice tem somente um consumidor identificado. Por isso `BR2_GLOBAL_PATCH_DIR` aplica `patches/iproute2/7.1.0/0001-ordax-minimal-ip-only.patch`: o build fica restrito a `lib + ip` e a instalação contém apenas `/sbin/ip` do iproute2, sem `tc`, `bridge`, `ss`, `rtmon`, `routel`, `genl`, headers, completions ou dados auxiliares não consumidos. O `post-build.sh` apenas verifica fail-closed que esses extras não entraram; ele não os remove depois da instalação.

No build, `bootstrap/independent-base/build.py` autentica o `/sbin/ip` realmente produzido: caminho resolvido dentro do rootfs, SHA-256, versão iproute2, identidade ELF x86-64 e linkagem estática sem dependências dinâmicas. Essa etapa não altera interfaces, endereços ou rotas do host da CI.

A compatibilidade funcional é comprovada separadamente no guest QEMU descartável já usado pela Independent Base. O probe executa exatamente `/sbin/ip address replace 127.0.0.1/8 dev lo`, registra o código de saída e consulta o IPv4 de `lo`; a prova só passa com exit code `0` e `127.0.0.1/8` efetivamente aplicado. O recibo QEMU vincula esse resultado à identidade iproute2 autenticada no provenance do mesmo build.

DHCP continua usando o contrato canônico `bootstrap/network/bring-up` e `udhcpc.script`; esta entrega não cria outro gerenciador de rede.

## Limites e medidas

Este slice comprova somente a compatibilidade específica de `/sbin/ip` exigida pela Surface. Não comprova paridade completa de rede, Wi-Fi funcional, `iw`, `wpa_supplicant`, certificados, firmware, drivers, hardware Surface físico ou promoção da Independent Base para produção.

O delta real de tamanho, RAM, processos e tempo deve vir dos recibos do CI no SHA desta entrega. Não inferir ganhos ou perdas a partir de builds anteriores. Qualquer futuro utilitário do iproute2 precisa de consumidor, justificativa e prova próprios antes de entrar na imagem. A Stable/Alpine do MVP USB permanece intacta até o cutover formalmente aprovado.
