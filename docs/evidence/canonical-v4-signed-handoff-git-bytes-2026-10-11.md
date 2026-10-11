# Stable v4 ? correção da verificação de bytes do envelope

**Data:** 2026-10-11
**Escopo:** verificação de handoff assinado; não é publicação, boot ou gravação.

## Defeito reproduzido

A tentativa 38128719016 (https://github.com/ordaxsystems/ordax-os/actions/runs/38128719016) completou a checagem de procedência do pedido ativo e os downloads, mas falhou ao comparar o envelope assinado. O SHA-256 esperado do objeto Git era d9ab389cd55c481785491cb1c3881936e47e7347bdc69ccea5c76a7437969a90 (3.140 bytes); uma cópia Windows com core.autocrlf=true tinha seis CRLF e 3.146 bytes, produzindo outro digest. O parâmetro anterior do workflow estava correto.

## Correção

O workflow canonical-v4-signed-handoff-proof.yml agora usa tools/release-operator/export_exact_signed_envelope.py para extrair bytes brutos de um blob regular rastreado em HEAD, usando o ID de objeto do Git. A ferramenta verifica o caminho exato da candidata congelada, SHA-256 e existência do destino antes de gravar em binário, recusando sobrescritas. Não lê chave privada, não reinterpreta JSON como texto, não recalcula ou substitui a assinatura. O release-agent continua obrigado a verificar a assinatura e os três hashes EROFS.

O teste tests/test_exact_signed_envelope_git_blob.py cobre a candidata aprovada, hash divergente, commit inválido, arquivo inexistente, destino preexistente e core.autocrlf=true, no runner Windows oficial.

## Limites

A prova completa de handoff ainda precisa passar para a candidata 03f88eeaf382a59aaefbcf4943d0639d2730741b. Publicação HTTPS, materialização canônica e vínculo da nova prova v4 seguem como gates independentes. physical_write_allowed=false permanece inalterado; nenhum pendrive foi escolhido ou gravado.
