# Paridade de `/sbin/ip` da Surface ? primeiro slice da substitui??o do Alpine

**Owner:** `bootstrap/independent-base` / issue #1730. **Status:** candidato experimental; n?o substitui Stable, Creator, PID1, Supervisor, runtimes gr?ficos assinados nem o USB sob responsabilidade de outro owner.

## Bloqueio observado

A prova anterior da base m?nima continha `/sbin/ip -> ../bin/busybox`. O applet BusyBox dispon?vel n?o comprovava o contrato usado pelo launcher can?nico `system/surface/bin/ordax-surface`, que executa `/sbin/ip address replace 127.0.0.1/8 dev lo`. Presen?a de pacote, applet ou texto de ajuda n?o ? prova de compatibilidade funcional.

## Corre??o e prova

O perfil Buildroot seleciona `BR2_PACKAGE_IPROUTE2=y` e o fragmento can?nico do BusyBox desativa `CONFIG_IP`, mantendo uma ?nica implementa??o de `ip`. O pacote n?o introduz daemon residente.

No build, `bootstrap/independent-base/build.py` autentica o `/sbin/ip` realmente produzido: caminho resolvido dentro do rootfs, SHA-256, vers?o iproute2, identidade ELF x86-64 e linkagem est?tica sem depend?ncias din?micas. Essa etapa n?o altera interfaces, endere?os ou rotas do host da CI.

A compatibilidade funcional ? comprovada separadamente no guest QEMU descart?vel j? usado pela Independent Base. O probe executa exatamente `/sbin/ip address replace 127.0.0.1/8 dev lo`, registra o c?digo de sa?da e consulta o IPv4 de `lo`; a prova s? passa com exit code `0` e `127.0.0.1/8` efetivamente aplicado. O recibo QEMU vincula esse resultado ? identidade iproute2 autenticada no provenance do mesmo build.

DHCP continua usando o contrato can?nico `bootstrap/network/bring-up` e `udhcpc.script`; esta entrega n?o cria outro gerenciador de rede.

## Limites e medidas

Este slice comprova somente a compatibilidade espec?fica de `/sbin/ip` exigida pela Surface. N?o comprova paridade completa de rede, Wi-Fi funcional, `iw`, `wpa_supplicant`, certificados, firmware, drivers, hardware Surface f?sico ou promo??o da Independent Base para produ??o.

O delta real de tamanho, RAM, processos e tempo deve vir dos recibos do CI no SHA desta entrega. N?o inferir ganhos ou perdas a partir de builds anteriores. A Stable/Alpine do MVP USB permanece intacta at? o cutover formalmente aprovado.
