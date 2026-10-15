# Surface Buildroot cutover — checklist atômico

Este checklist prepara a remoção da dependência Alpine/APK **da Surface** depois que o candidato Buildroot tiver build real, handoff do mesmo EROFS e health gráfico/QEMU verdes. Nada aqui autoriza remover a Stable Base Alpine antes da sua própria substituição.

## Gate de entrada

O cutover só pode começar quando todos os itens abaixo forem verdadeiros para o mesmo source commit:

- `native-surface-runtime-buildroot.erofs` construído e verificado;
- provenance Buildroot ligada ao source commit exato;
- ausência de `apk`, `/etc/apk`, `/lib/apk` e identidade Alpine no runtime;
- mesmo SHA-256 do EROFS consumido pelo Portable/QEMU canônico;
- QEMU direto e UEFI canônicos verdes para o candidato;
- Surface cold-health em QEMU com virtio-GPU verde, incluindo segundo boot;
- recovery/rollback preservados;
- `physical_artifact_authorized=false` e `stable_promotion_authorized=false` até o gate físico correspondente.

## Substituição do owner canônico da Surface

A migração não deve manter dois builders permanentes. O owner final continua sendo `bootstrap/surface-runtime`, mas seu conteúdo passa a ser Buildroot/musl.

1. mover/adaptar para `bootstrap/surface-runtime` os owners comprovados de:
   - `bootstrap/independent-surface-runtime/build.py`;
   - `bootstrap/independent-surface-runtime/prepare_config.py`;
   - `bootstrap/independent-surface-runtime/source.json`;
   - `bootstrap/independent-surface-runtime/configs/ordax_surface_defconfig`;
2. preservar o nome de artefato canônico consumido pelo sistema: `native-surface-runtime.erofs`;
3. preservar EROFS/LZ4, label `ORDAX-SURFACE`, runtime ABI e caminhos de compatibilidade verificados;
4. atualizar o cache canônico da Surface para fingerprint apenas dos inputs Buildroot reais;
5. remover a ponte `bootstrap/independent-surface-runtime` depois que o owner canônico passar os mesmos testes.

## Itens Alpine/APK da Surface a remover no mesmo cutover

Remover ou substituir atomicamente:

- `bootstrap/surface-runtime/discover_lock.py`;
- `apk_package_lock`, `apk_package_lock_count`, `apk_package_versions_pinned` e bloco `alpine` de `bootstrap/surface-runtime/source.json`;
- lógica `apk add`, `/etc/apk/repositories`, banco `/lib/apk/db/installed` e dependência de `proot` do builder Surface antigo;
- `.github/workflows/surface-runtime-lock-discovery.yml` como workflow de descoberta/revalidação APK; substituir por build/reprodutibilidade Buildroot;
- asserts Alpine/APK de `tests/test_surface_runtime_source_contract.py`; substituir por contrato Buildroot/musl + ausência de gerenciador de pacotes;
- `bootstrap/surface-runtime/APK-LOCK-DRIFT-2026-10-08.md` depois que deixar de descrever um owner ativo;
- fingerprint Surface antigo em `tools/ci/portable_component_cache.py` (`bootstrap/base/alpine_core.py` não pode continuar sendo input da Surface após o cutover).

## Item que NÃO deve ser apagado ainda

`bootstrap/base/alpine_core.py` continua existindo temporariamente **somente enquanto a Stable Base oficial ainda depender dele**. O cutover da Surface deve remover qualquer dependência da Surface nesse módulo, mas a exclusão física do arquivo pertence ao gate posterior da Independent/Stable Base.

Da mesma forma, `bootstrap/stable-base/build.py` e `bootstrap/stable-base/source.json` não devem ser convertidos incidentalmente dentro do cutover da Surface. A Stable Base é a etapa seguinte e terá sua própria prova de boot/recovery antes da remoção final.

## CI depois do cutover

Mudanças que não alteram bytes da Surface não podem recompilar WebKit/GTK/Mesa.

Build gráfico é obrigatório somente para mudanças causais em:

- builder/config/source da Surface Buildroot;
- Buildroot source SSOT;
- kernel-header SSOT consumido pela toolchain;
- outras entradas explicitamente adicionadas ao fingerprint do runtime.

README, testes de política, documentação e verificadores que apenas revalidam bytes existentes devem executar contratos rápidos e reutilizar artefatos verificados.

Para um release final/reprodutibilidade, um clean build completo continua obrigatório; isso não deve ser repetido em cada commit intermediário.

## Grep final da Surface

Antes de declarar a Surface livre de Alpine/APK, a árvore canônica da Surface deve falhar se ainda houver dependência operacional de qualquer um destes marcadores:

- `apk add`;
- `/etc/apk`;
- `/lib/apk`;
- `dl-cdn.alpinelinux.org`;
- `alpine-minirootfs`;
- `apk_package_lock`;
- import/uso de `bootstrap/base/alpine_core.py` pelo owner Surface.

Referências históricas em documentação fora do owner ativo podem existir somente quando explicitamente marcadas como história/migração e não forem consumidas por build, boot ou CI de release.

## Próxima etapa depois da Surface

Com a Surface Buildroot promovida e o caminho Alpine da Surface removido, avançar para a Stable Base:

1. substituir `bootstrap/stable-base/build.py` por Independent Base comprovada;
2. remover dependência de `bootstrap/base/alpine_core.py`;
3. remover minirootfs/APK/repositórios Alpine da base oficial;
4. repetir boot, recovery, rollback e reprodutibilidade;
5. executar grep global final por `apk`, `/etc/apk`, `dl-cdn.alpinelinux.org`, `alpine-minirootfs` e demais dependências operacionais Alpine.
