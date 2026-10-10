# Boot pré-Surface OrdaX — vídeo e áudio originais

**Status: candidato de código, não homologado em pendrive real. NÃO promover até fornecer os dois assets binários e validar a CI/boot físico.** A PR pós-Surface #1586 foi encerrada sem merge. Esta implementação ocupa apenas a **Base Developer**, iniciando na transição do kernel para a Base, antes do Git e antes do compositor/Surface; não altera a marca UEFI/BIOS.

## Fonte e mídia travadas por hash

- Original do proprietário: `ordax-os-boot.mp4` (1280×720, 24 fps, 8,833 s, H.264 + áudio AAC original), SHA-256 `bcab385c001833529cd40b9bb8685e5eb33b7fec12b308d4a3a047965f500769`.
- Quadros já pré-decodificados: `media/frames.rgb565.zst` (RGB565 little endian, 1280×720, 24 fps, 212 quadros, ~20 MiB), SHA-256 `691247dc90a44ffcbeb6c3ae953f756b74f2fff5f0cd3e84f98de36c5747f2ab`.
- Áudio original extraído e preservado em PCM estéreo 48 kHz: `media/boot-audio.wav` (~1,7 MiB), SHA-256 `78c35e843facdf25033d207acd82f6ba4354cdd75763bca48494a86c36e9b1f0`.
- Fonte canônica dos hashes: `asset-lock.json`, verificada pelo builder; cópias com bytes divergentes **fazem falhar o build**.

Os binários não foram anexados ao repositório nesta PR, por limitação do transporte disponível. O pacote de mídia produzido já existe como arquivo no chat; extraia somente `frames.rgb565.zst` e `boot-audio.wav` para `bootstrap/boot-splash/media/` da própria branch e deixe a CI verificar SHA-256. **Não codificar binário em scripts base64, não fazer runtime download, não commitar o MP4 em `system/surface/`.**

## Execução e handoff

`bootstrap/dev-base/ordax-dev-init` inicia o controlador opcional em segundo plano durante o boot normal. O renderizador C `fb_splash.c`, compilado estaticamente pelo builder musl do Developer, recebe os quadros via `zstd -dc` e desenha diretamente em `/dev/fb0`. Não há FFmpeg, navegador, HTTP, JavaScript ou decodificador de vídeo nessa fase. O PCM reproduz pela saída ALSA padrão com `aplay` somente quando o dispositivo de áudio existe.

A Base já dispõe do componente `zstd`; o candidato acrescenta `alsa-utils` e `alsa-ucm-conf` e habilita núcleo ALSA/HDA no kernel. Outros codecs, DSPs modernos e firmware ainda dependem de comprovação no hardware alvo.

Ao assumir o dispositivo DRM, `system/surface/bin/ordax-surface` chama `ordax-boot-splash-stop` via FIFO local com timeout de 1 s para encerrar a animação e o áudio; isso impede dois renderizadores concorrentes e **não repete o vídeo na Surface**. Se a Surface iniciar antes dos 8,8 s, interrompe ambos; caso contrário, o último quadro permanece na tela até a próxima fase. A sequência não fica aguardando a animação terminar.

Em manutenção/erro/recovery, o init interrompe o splash e devolve o console. Sem framebuffer, DAC/ALSA, codec/firmware ou arquivo validado, o boot segue pelo console sem travar. O som está no **escopo obrigatório do produto**, mas não é alegado como funcional em todos os notebooks antes de prova física.

## Gates

1. Adicionar assets binários com hashes exatos, sem incluir a fonte MP4 no runtime.
2. Validar compilação estática, tamanho do rootfs e Kconfig efetivo no CI do Creator Developer.
3. Validar início do splash antes do Git, erros/recovery e interrupção ao iniciar Cage/DRM. Teste automático de parser não substitui prova com /dev/fb0 real.
4. Validar som nos alto-falantes físicos do notebook, nível de volume aceitável, disponibilidade de ALSA e sincronização.
5. Exigir evidência do USB real, HDMI/eDP framebuffer e rollback da Base sem regressão antes de afirmar prontidão.
6. Isolar canal Developer; nenhum asset deste candidato libera assinatura ou instalação do Stable.
