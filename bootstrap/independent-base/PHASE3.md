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

## Teste funcional adversarial (prova da base, não release assinado)

O initramfs descartável incorpora **somente na área experimental de prova** cópias bit-a-bit dos dois executáveis canônicos `system/entrypoint` e `system/supervisor`, conferidas por SHA-256 contra a fonte. Essas cópias são removidas do rootfs de destino **antes da produção da EROFS candidata**, mantendo o sistema real somente na release assinada. O probe QEMU os executa com identidade sintética explicitamente restrita ao experimento e **sem Surface**: o Supervisor deve rejeitar o runtime ausente, o Guardian deve reiniciar o filho até o orçamento oficial de três falhas, encerrar sem arquivos PID residuais e tratar TERM com limpeza. Essa prova **não** declara inicialização bem-sucedida do produto, renderização gráfica ou autenticação do release; a integração assinada continua com o owner portátil oficial.

A mesma prova valida estado ext4 persistido em dois boots com modo 0600, recusa symlink/permissão insegura, observa rota DHCP, o arquivo DNS e uma consulta real via resolver do QEMU. O boot com EROFS corrompido continua fail-closed antes desses serviços.

## Bloqueios de equivalência restantes

- **Serviços fundamentais:** validar em QEMU o lifecycle real de guardian/supervisor/diagnósticos com release `system.erofs` assinada e Surface saudável; presença de applets não é equivalência funcional.
- **Conectividade/hardware:** instalar módulos do kernel canônico com ABI aferida, firmware Wi-Fi selecionado pelo owner existente e testar `iw`/`wpa_supplicant` com interfaces e dispositivos reais. DHCP sobre Ethernet/QEMU não comprova Wi-Fi ou tether USB.
- **Ambiente gráfico:** provar Cage/Wayland, input, GPU/DRM e a montagem efêmera da Surface verificada; manter o runtime gráfico separado da Base.
- **Compatibilidade:** manter Wine/app delivery em artefatos separados, testar dependências/ABI e observabilidade antes de qualquer mudança de canal.
- **Promoção:** testes em pendrive real, chaves/assinaturas de produção, rollback e cold health; **não permitidos nesta PR**. Alpine só pode ser retirado após equivalência demonstrada e gate de promoção explícito.

## Evidência

Pipeline reaproveitado: `.github/workflows/independent-base-experiment.yml` e `.github/workflows/independent-portable-v2-integration.yml`. Resultado esperado: provenance com `phase3_*`, recibo de QEMU e logs seriais, além do pipeline portátil oficial. Conferir os resultados da PR antes de alterar este estado.

## CI por artefato imutável e execução real da Surface

A única compilação pesada experimental (Buildroot + kernel canônico/módulos) é de responsabilidade do workflow `independent-base-experiment.yml`. Os testes rápidos de contratos ficam também no workflow `independent-portable-v2-integration.yml`. Mudança somente de teste ou documentação não dispara a compilação pesada.

O cache é exato, sem `restore-keys`, pela SHA-256 de todas as fontes relevantes, modos de arquivo, configurações e políticas canônicas, toolchain GCC 13, pacotes da compilação e identidade da imagem Ubuntu. `ci_artifacts.py` registra separadamente a origem compilada, todos os SHA-256 dos binários e um recibo novo do checkout corrente, sem reescrever a provenance canônica. Reuso requer nova verificação dos arquivos, `bootstrap/kernel/verify.py`, `bootstrap/independent-base/build.py verify`, ABI e configuração. Mudança de qualquer insumo relevante produz uma chave diferente e exige nova compilação; resultado adulterado encerra em erro.

O QEMU funcional da base roda sempre sobre os arquivos verificados. Após sucesso, um único artifact imutável da mesma execução fornece o kernel e Buildroot para o pipeline de release assinada e rollback, que **revalida** a integridade e as ligações de origem antes de usá-los. O pipeline Stable padrão não usa esse caminho.

O experimento também chama o **executor canônico** `bootstrap/portable-v2/qemu_cold_health_commit.py`, mediante `healthy_services_proof.py`, para exigir a Surface Cage/Wayland/WebKit real, saúde reconhecida pelo Supervisor oficial, confirmação persistente da release assinada e segundo boot. Não há saúde simulada, nem alteração do supervisor ou PID1. Eventual falha gráfica deve bloquear a prova e ser tratada no proprietário da Surface, sem alteração deste projeto. Não converte evidência QEMU em autorização para USB físico, Stable ou Secure Boot.

## Falha real de cold health — QEMU #38332229900

Na execução #38332229900, o produtor, o boot portátil assinado, o fallback e a recuperação passaram. O cold-health canônico falhou no boot da candidata: os SHA-256 da release e do runtime foram observados corretamente, a IA iniciou e Cage chegou a emitir um aviso do kernel (aos 67 segundos). O guest reiniciou aos 129 segundos sem o **marcador de commit após saúde**. A execução não provou Surface saudável nem segundo boot `current`.

O contrato real do Supervisor exige simultaneamente `/run/ordax-update/healthy-sha` e `/run/ordax-update/surface-heartbeat.json` com SHA exato da candidata. `main.mjs` só tenta ambos após montar a composição nativa; `native_host_server.py` autentica as solicitações separadamente. Cage iniciado não demonstra que o WebKit executou a composição, nem que ambas foram aceitas. Portanto o diagnóstico precisa distinguir: (1) servidor HTTP da Surface realmente pronto, (2) Cage/WebKit e carregamento de página, (3) requisições de saúde e heartbeat aceitas, (4) comparação final pelo Supervisor. **Não tratar log Cage como confirmação de Surface.**

Os logs do Guardian, Supervisor, Cage/WebKit e servidor HTTP ficam em `/run/ordax-update` e `/run/ordax-surface`, que são voláteis; não foram preservados na serial anterior. A rotina **somente de falha** do runner QEMU canônico agora observa uma cópia descartável, montada somente para leitura, do estado ext4 e registra exclusivamente os SHA de `current`, `known-good`, `candidate`, `rejected` e flags de transação/rejeição. Não coleta conteúdo de home, perfis, tokens, logs privados ou arquivos gráficos; a cópia é destruída com o disco. Isso diferencia rollback efetivamente persistido de reinício abrupto, **sem** diagnosticar por si só a causa gráfica. Caso Cage/WebKit continue sem saúde, coordenar com o proprietário da Surface a emissão de estágios *sem segredos* antes de qualquer alteração nos arquivos gráficos; não criar heartbeat artificial ou contornar a aprovação física.

Execução experimental corrigida permanece Draft: sem promoção Stable/Alpine/Creator e sem equivalência gráfica declarada até recibo real de `qemu_cold_health_commit.py` com dois boots.

## Observação do framebuffer do boot gráfico experimental

Para diferenciar um WebKit que **não carrega a página** de uma composição que apenas não conclui os POSTs de saúde, a prova real de QEMU recolhe (somente no boot da candidata, após detectar processo Cage em serial) até duas capturas do framebuffer `virtio-vga` via monitor de leitura HMP do **host**. Esta operação não inicia processo no guest, não muda firmware, sistema assinado, critério `healthy-sha`, heartbeat ou lógica de Supervisor. Os arquivos `graphical-evidence/cage-plus-{12,30}s.ppm` são colhidos em máquina QEMU recém-criada sem dados pessoais; não contêm tokens da API e não incluem nenhum dump de memória. Capture ausente não equivale a sucesso. O ambiente QEMU continua desconectado da rede. O owner oficial da Surface permanece responsável pela instrumentação sanitizada dos processos WebKit/HTTP caso o framebuffer revele splash ou falha.

## Falha de captura HMP no run #38342111173 — mecanismo corrigido

O run chegou novamente a Cage (`cage[902]` em ~92 s), depois fez rollback legítimo em ~153 s. O artefato incluiu `proof.json` e serial, mas **nenhum framebuffer**. A função anterior descartava silenciosamente todas as causas retornando `False`, inclusive monitor Unix ausente, HMP sem resposta, ausência de dispositivo gráfico e falha de arquivo. Por isso a causa específica **não pode ser atribuída retroativamente** ao QEMU sem um recibo de monitor.

O novo `capture-status.json` é sempre gravado ao encerrar o boot gráfico e contém apenas status/razões estáticas dos comandos HMP, errno de socket se houver, existência do socket e presença do marcador Cage. Nunca registra conteúdo bruto do monitor, paths privados, tokens, perfis ou comandos guest. Tenta uma amostra assim que Cage aparece, mais duas amostras nos intervalos originais, sem estender o prazo da prova. Capturas visuais válidas continuam exigindo cabeçalho PPM e tamanho limitado. Não muda nenhuma condição de sucesso da Surface, Supervisor, segunda inicialização ou assinatura.

## Checkpoint Fase 3 — Surface Native real (13/10/2026)

- CI autenticada [#38353244123](https://github.com/ordaxsystems/ordax-os/actions/runs/38353244123), head `e98d893`: Buildroot, kernel e base em cache SHA-256, QEMU, boot portátil assinado, fallback, recovery, Foundation, Runtime e Surface Web aprovados. **A prova de saúde fria real falhou**; nenhuma promoção ou segundo boot `current` foi comprovado.
- Serial: `http-surface-index:200`, `webkit-uri-expected`, `js-probe-installed`, `http-surface-bootstrap:200`, `http-surface-main:200`, `webkit-load-finished`, `http-surface-document:200`, `js-resource-load-failed`. Nenhum `composition-started`, `composition-mounted`, POST `health` ou `surface-heartbeat`. Documento servido não equivale a módulos ES avaliados; a causa exata do recurso falho ainda exige prova.
- Correção agrupada do head `4e62887`: `native_host_server.py` fornece MIME canônico `text/javascript` para `.mjs`/`.js`, inclusive sem banco MIME da distribuição; `ordax_browser_host.py` instrumenta falha de recurso WebKit e erro em elemento HTML **somente** com `ordax.qemu_health_diag=1`; `native_cold_health_diagnostic.py` valida estritamente origem e caminho público de módulo/CSS e nunca registra URL completa, query, cookie, token ou arquivos do usuário.
- HMP `capture_disposable_graphics`: leitura por resposta completa até prompt final (inclusive fragmentos/ANSI), fase banner/comando distinguida nos recibos, falha segura diante de desconexão/limites. Só aceita PPM P6 com pixels de tamanho exato; observação não interfere na saúde. Testes direcionados abrangem respostas fragmentadas, desconexão e vazamento de URI.
- Contrato real inalterado: Guardian/Supervisor devem observar **ambos** os POSTs legítimos e validar SHA/boot, ativar estado assinado persistente e confirmar segundo boot `current`. Se falhar, preservar rejeição, recuperação e rollback. Nenhuma evidência de framebuffer ou marcador da instrumentação é sinal de saúde.
- Próximo gate: verificar o caminho estático do recurso concreto e MIME/HTTP com WebKitGTK, corrigir qualquer import/export ou dependência opcional no componente proprietário em coordenação com a PR #1712, repetir testes direcionados e a prova canônica `qemu_cold_health_commit.py` reutilizando kernel/Buildroot autenticados. **Sem merge, promoção, Stable, Creator, Alpine ou disco físico nesta PR Draft.**
