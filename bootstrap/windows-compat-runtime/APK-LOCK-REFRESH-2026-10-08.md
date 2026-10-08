# Wine 11.0 — atualização do fechamento APK (8 de outubro de 2026)

## Origem e comprovação

O lock de versões do build Windows foi derivado da execução CI **36895104347**, artefato **11179727536**, commit `3c29aa03a7b26cdcfb95b74694e5ba4954ae9cb0`, com hash do ZIP `c5b381e5439452eb0a460efbc59e3af00f85ca4d92ed8d020f72d1c0180d1670`. O `configure-proof.json` daquele artefato contém o mapa integral dos 342 pacotes e reproduz SHA-256 `99f0881664ee6a089755baa74e71513a671d8073e91a8256d36ef2c4c303243e`.

Os workflows recentes [descoberta APK](https://github.com/ordaxsystems/prototipo-ordax-os/actions/runs/37811046910), [build Wine](https://github.com/ordaxsystems/prototipo-ordax-os/actions/runs/37811047117) e [diagnóstico](https://github.com/ordaxsystems/prototipo-ordax-os/actions/runs/37811047307) observaram o novo hash `e393674aac035f51e0e7b42c85e25850cfb026d9ab79499e0ca444bb0803ecdd`, ainda com 342 pacotes.

Os logs da resolução Alpine registram exclusivamente as mudanças `zlib=1.3.2-r0 → 1.3.2-r1` e `zlib-dev=1.3.2-r0 → 1.3.2-r1`. Atualizar **somente essas duas entradas** no mapa histórico e calcular SHA-256 JSON canônico, ordenado, sem espaços reproduz exatamente o novo hash. O pacote `zlib` já fazia parte da imagem base histórica; `zlib-dev` faz parte do conjunto externo de APKs.

O `bootstrap/windows-compat-runtime/build-version-lock.json` é a única autoridade versionada sobre a resolução de versões. O recibo `lock_refresh` registra **observação de fechamento**, não prova de bytes da nova APK.

## Gates ainda abertos

- [x] Identidade do ZIP histórico conferida com checksum registrado
- [x] Mapa completo histórico de 342 pacotes e hash originais reproduzidos
- [x] Diferenças zlib/zlib-dev confirmadas com a resolução atual
- [x] Novo hash de fechamento calculado a partir do mapa histórico e igual ao atual
- [x] Descoberta do novo APK externo `zlib-dev-1.3.2-r1.apk`, SHA-256, tamanho e manifesto completo
- [x] Replay offline completo com o novo lock e byte-identidade dos APKs externos
- [x] Atualização com prova de `apk-content-lock.json` (não reutilizar o digest antigo)
- [ ] Configure, build completo e diagnóstico numa árvore de dependências efetivamente reproduzida
- [ ] Inventário de dependências de runtime, empacotamento imutável, sandbox e isolamento de perfil

**Nunca** liberar `activation_authorized`, `execution_authorized`, criar artefato promovível, pular gates ou retirar os pins em razão desta atualização. Os três workflows acima falhavam **antes** da prova de build, portanto não é lícito declarar build Wine aprovado.

Rastreamento: [issue #1443](https://github.com/ordaxsystems/prototipo-ordax-os/issues/1443).

## Nova prova de conteúdo (CI)

Workflow `Windows Compatibility APK Content Discovery`, execução **37812741652**, commit **`9ef37e4a0191a655a8d6e957db32063ebf2b9802`**, artefato **11564979845**, ZIP SHA-256 **`134ac687d31a1f3a43aa17a7a123505bd005aa158c1db341343440f7969aa6a8`**.

O `apk-content-discovery.json` do artefato comprova resolução canônica de **342** pacotes, replay offline com o mesmo digest `e393674aac035f51e0e7b42c85e25850cfb026d9ab79499e0ca444bb0803ecdd`, e **327 APKs externos** somando **595.197.429 bytes**, com manifesto SHA-256 **`a3ccadb533a23b3c5362df177740cef4478cd79ea3b361ed03eb04534485d2c9`**. Desses, os dois arquivos atualizados são:

- `zlib-1.3.2-r1.apk`: 55.457 bytes, SHA-256 `af24e502645e2b392cae833856d776691ac21655362e5db69d7b89f147f76216`.
- `zlib-dev-1.3.2-r1.apk`: 34.439 bytes, SHA-256 `606473e68819d075f9d3177aabe6f85459397e9659ee8b69fa7d9e42cf4b8929`.

O `build-version-lock.json` continua sendo o estágio pré-conteúdo e nunca concede instalação ou execução isoladamente; o `apk-content-lock.json` é o recibo da nova prova de bytes. O build completo e inventário de dependências de execução ainda precisam de testes independentes.
