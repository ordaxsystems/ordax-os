# Paridade de /sbin/ip da Surface — primeira entrega de substituição Alpine

**Owner**: `bootstrap/independent-base` / issue #1730. **Status**: candidato experimental; não substitui o Stable, o Creator, o PID1, o Supervisor, os runtimes gráficos assinados ou o USB do outro responsável.

## Bloqueio observado

O artefato autenticado da execução [#38449110078](https://github.com/ordaxsystems/ordax-os/actions/runs/38449110078) incluía `/sbin/ip -> ../bin/busybox` na base mínima. O binário BusyBox 1.38.0 expõe `ip addr add|del`, `show|flush`, mas não `ip address replace`. O launcher oficial `system/surface/bin/ordax-surface` invoca `/sbin/ip address replace 127.0.0.1/8 dev lo`. A compatibilidade não é demonstrada pela mera presença do applet.

## Correção

A fonte Buildroot fixa o pacote mínimo `iproute2` e verifica a seleção efetiva em `.config`. Após a compilação, o verificador único `bootstrap/independent-base/build.py` executa **somente comandos de identificação/ajuda** no binário real de `/sbin/ip` do rootfs: `-V` deve identificar iproute2 e `address help` deve anunciar `replace`. Nenhuma mudança de interface, endereço, route ou configuração de rede é executada no host. Recibo de proveniência passa a registrar a prova; `verify` rejeita a ausência do campo.

O pacote `iproute2` não acrescenta daemon residente. BusyBox segue como fonte única dos outros applets necessários; DHCP reutiliza `bootstrap/network/bring-up` e `udhcpc.script`.

## Limites e medidas

Antes do acréscimo, o EROFS mínimo tinha **839.680 bytes** e o initramfs gzip **559.808 bytes** (fonte de mesmo run, SHA da prova em artefato; somente probe QEMU). O delta real de bytes, RAM, processos e tempo deve ser extraído dos recibos CI do novo SHA; não inferir ganhos nem perdas sem execução. Este slice elimina **o bloqueio de sintaxe do comando ip**; não comprova interface Wi-Fi funcional, módulos, firmware, TLS, Surface no notebook, nem substituição do runtime gráfico. O próximo corte exigirá os binários `iw`/`wpa_supplicant` usados pelo broker e provas específicas do hardware suportado. A base Alpine do MVP USB fica intocada até o cutover aprovado.
