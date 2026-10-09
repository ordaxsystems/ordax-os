# Reconciliação da medição do rootfs do Development Base

## Sintoma observado
No main@b2a63520342e27b15e0b2397f0b177145b49e211, o workflow
Development Base Channel (run 37871675808) aprovou verify, mas
falhou em publish na etapa Build exact-commit kernel and initramfs:
development rootfs expanded bytes exceed channel limit.

## Causa-raiz
bootstrap/base/alpine_core.py::unique_regular_bytes() mede bytes uma vez
por inode (st_dev, st_ino) e registra isso na proveniência. O canal já
serializava aliases internos em TAR como hardlinks seguros após #1495,
mas tools/dev-base-channel/build.py::validate_rootfs_source() ainda
somava st_size para todo pathname, inclusive os ~750 hardlinks de
symlinks Alpine achatados. O limite de 320 MiB rejeitava uma falsa soma.

## Correção e provas
A validação do produtor passou a usar a mesma identidade de inode e a
conferir o total medido contra provenance.json.unique_regular_bytes.
Symlinks, arquivos especiais e a capacidade real continuam rejeitados;
não houve mudança de limites, formato TAR, permissões ou assinatura.

Os testes incluem construção integral com 390 hardlinks de 1 MiB
(>320 MiB em pathname-sum, ~1 MiB único), rejeição de divergência da
proveniência e regressões pré-existentes do consumidor e materialização.

**Gate ainda exigido**: PR completa verde e, após merge, publish
da main gerar e verificar os quatro assets do pre-release imutável.
Não confundir esse pre-release com Stable Ed25519 ou aprovação física.
