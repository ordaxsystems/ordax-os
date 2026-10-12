# Independent Base — Fase 3: serviços essenciais (experimento)

**Estado:** implementação inicial submetida a prova; Buildroot permanece `experimental-not-promotable`.
Esta etapa reutiliza `bootstrap/stable-base/ordax-stable-init`, `system/entrypoint` / `system/supervisor` por meio do sistema de releases verificado, `bootstrap/network/bring-up` e `bootstrap/network/udhcpc.script`. Não introduz PID1, gerenciador de rede, atualizador ou fonte de autoridade paralela.

## Inventário auditado no código

| Owner real | Dependência Alpine atual | Fronteira da migração |
| --- | --- | --- |
| `bootstrap/base/alpine_core.py` e `bootstrap/dev-base/build.py` | download minirootfs, APK, instalação Git | desenvolvimento existente preservado; não ingressar no perfil independente |
| `bootstrap/stable-base/build.py` e `source.json` | APK pinado, firmware, kmod, iw, wpa_supplicant, iproute2, ca-certificates | Stable intacta; equivalência gradativa na Buildroot |
| `bootstrap/base/runtime_policy.py` | APK e limpeza por base Alpine | apenas builder legado, sem importar para candidato |
| `bootstrap/surface-runtime/build.py` | runtime gráfico APK em imagem assinada própria | não duplicar libc/pacotes na Base; testar handoff verificado antes de migrar runtime |
| `bootstrap/windows-compat-runtime/` | Wine em runtime separado | manter isolado e inalterado |
| `system/entrypoint` e `system/supervisor` | applets e OS primitives `/bin/busybox`, release/estado confiáveis | produto canônico, não copiar supervisor para initramfs nem criar serviço substituto |
| `bootstrap/network/*` | BusyBox/udhcpc (não requer Alpine) | mesmos scripts e hashes canônicos; iproute2 só diagnóstico |
| `bootstrap/kernel/*` e `bootstrap/base/firmware_policy.py` | módulos reais + firmware selecionado | exigir ABI, árvore de módulos, firmware e coldplug observados em QEMU/hardware antes de alegar Wi-Fi |

## Marco inicial entregue neste candidato

1. Buildroot recebe `iproute2` e bundle de CAs (independentes de APK). Os scripts DHCP oficiais continuam sendo o único mecanismo de configuração desta etapa.
2. O fragmento BusyBox requer operações usadas pelo guardian existente; o builder **executa** `date +%s`, `stat -c`, `timeout -k` e `ip -V` e verifica CAs. Os hashes e os flags não-promovíveis permanecem obrigatórios.
3. O PID1 de **prova QEMU descartável**, não o PID1 portátil oficial, verifica dentro do guest relógio/timeout, confiança CA e iproute2 com endereço realmente entregue pelo DHCP. O gate QEMU exige os marcadores correspondentes em dois boots; a imagem EROFS corrompida continua fail-closed.
4. Testes de contrato impedem adicionar gerenciadores concorrentes ou religar o caminho físico. Os workflows de QEMU existentes devem executar o build e a prova real; **nenhum PASS é declarado antes de CI verde**.

## Bloqueios de equivalência restantes

- **Serviços fundamentais:** validar em QEMU o lifecycle real de guardian/supervisor/diagnósticos com release `system.erofs` assinada e Surface saudável; presença de applets não é equivalência funcional.
- **Conectividade/hardware:** instalar módulos do kernel canônico com ABI aferida, firmware Wi-Fi selecionado pelo owner existente e testar `iw`/`wpa_supplicant` com interfaces e dispositivos reais. DHCP sobre Ethernet/QEMU não comprova Wi-Fi ou tether USB.
- **Ambiente gráfico:** provar Cage/Wayland, input, GPU/DRM e a montagem efêmera da Surface verificada; manter o runtime gráfico separado da Base.
- **Compatibilidade:** manter Wine/app delivery em artefatos separados, testar dependências/ABI e observabilidade antes de qualquer mudança de canal.
- **Promoção:** testes em pendrive real, chaves/assinaturas de produção, rollback e cold health; **não permitidos nesta PR**. Alpine só pode ser retirado após equivalência demonstrada e gate de promoção explícito.

## Evidência

Pipeline reaproveitado: `.github/workflows/independent-base-experiment.yml` e `.github/workflows/independent-portable-v2-integration.yml`. Resultado esperado: provenance com `phase3_*`, recibo de QEMU e logs seriais, além do pipeline portátil oficial. Conferir os resultados da PR antes de alterar este estado.
