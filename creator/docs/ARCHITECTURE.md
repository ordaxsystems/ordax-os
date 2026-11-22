# Arquitetura canônica do Creator

A autoridade de source, construção e distribuição é ordax-os/main com módulo único creator/. O módulo contém aplicativo Windows, Core Go, descoberta de dispositivos, validação de mídia, seleção segura de alvo, adaptadores e consumidores de envelopes verificados.

O OS mantém contratos de artefatos, atualização, confiança e promoção em docs/contracts/, bootstrap/kernel/update_engine.py e tools/creator/. O Creator utiliza o transportador Owner Dev existente para preparar entrega incremental no USB autorizado; não executa outro ordax-pull nem atualiza o boot diretamente por interface Windows.

A interface Win32 e o executor físico compartilham o mesmo Core. Capacidade de gravação não decorre da UI ou da disponibilidade de atualização: exige assinatura aplicável, escolha explícita de disco, validação de geometria/serial, elevação apropriada e readback.

CI e Publisher pertencem à raiz .github/workflows/ do ordax-os. Não existe source pin, workflow ou checkout executável dependente da antiga origem Git.
