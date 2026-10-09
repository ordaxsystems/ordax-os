# Base de desenvolvimento — TAR seguro com hardlinks internos

**Origem da auditoria:** push pós-cutover `ordax-os@c4805bcbdca7f93c2fda112c711a8ff57f8e8054`, [Development Base Channel run #37868364327](https://github.com/ordaxsystems/ordax-os/actions/runs/37868364327), etapa `Build exact-commit kernel and initramfs`.

## Falha e causa comprovada

O rootfs preparado pelo `bootstrap/base/alpine_core.py` apresentou `ORDAX_DEV_BASE_MEASURED_BYTES=67532212` e `ORDAX_DEV_BASE_SYMLINKS_FLATTENED=750`. O mecanismo de flatten converte symlinks de arquivos em hardlinks POSIX dentro do rootfs — portanto o número mede corretamente os **inodes únicos**, não todas as entradas de nome.

O empacotador anterior `tools/dev-base-channel/build.py` serializava **cada nome de hardlink como membro TAR regular completo**. Com isso, o tamanho lógico expandido crescia artificialmente além do limite `MAX_ROOTFS_EXPANDED_BYTES = 320 MiB`, apesar de apenas ~67,5 MB de bytes de arquivo únicos. A CI bloqueou corretamente a publicação com `development rootfs expanded bytes exceed channel limit`.

## Correção arquitetural

- **Não aumentar o limite** de 320 MiB, não eliminar pacotes necessários, não alterar o rootfs, não permitir symlinks no TAR.
- Para o primeiro nome de cada `(st_dev, st_ino)`, gravar um membro regular; para os nomes seguintes, gravar `tarfile.LNKTYPE` com caminho canônico relativo ao arquivo regular **já presente** na sequência determinística. Isso preserva a identidade de inode.
- Tanto produtor quanto consumidor recusam referências absolutas, `..`, caminhos não normalizados, hardlink para alvo não regular/ausente/futuro, cadeia de links, tamanho de payload inconsistente, permissão divergente, objetos especiais e duplicidades.
- O orçamento de bytes passa a corresponder aos **bytes únicos gravados no TAR**; o consumidor continua com máximo de membros, limite do download, SHA-256 do pacote, commit exato e extração apenas para staging com `filter="data"`. A estrutura materializada mantém hardlinks reais e validadores de executáveis/arquivos obrigatórios.
- A correção vale somente para o canal de desenvolvimento; **não** substitui assinatura Ed25519 do `stable-mvp`, nem autoriza publicação física, SSD/HD, USB ou saltos no gate de release.

## Provas de regressão

Os testes de produtor/consumidor simulam 390 links para 1 MiB de conteúdo único (mais de 320 MiB se expandido como cópias), verificam arquivo compacto, rejeição de hardlinks com escape/forward-reference/permissões divergentes e, no Linux, materialização real preservando os mesmos inodes. Validadores de namespace, hash e release permanecem independentes.

**Importante:** testes locais Windows não substituem a CI Linux; a execução do workflow de desenvolvimento na PR e o processo de publish pós-merge são gates separados. Falhas de produção não devem ser ignoradas ou convertidas em aprovação.
