# Stable v4 — correção da verificação de bytes do envelope

**Data:** 2026-10-11
**Escopo:** verificação de handoff assinado; não é publicação, boot ou gravação.

## Defeito reproduzido

A tentativa 38128719016 (https://github.com/ordaxsystems/ordax-os/actions/runs/38128719016) completou a checagem de procedência do pedido ativo e os downloads, mas falhou ao comparar o envelope assinado. O SHA-256 esperado do objeto Git era d9ab389cd55c481785491cb1c3881936e47e7347bdc69ccea5c76a7437969a90 (3.140 bytes); uma cópia Windows com core.autocrlf=true tinha seis CRLF e 3.146 bytes, produzindo outro digest. O parâmetro anterior do workflow estava correto.

## Correção

O workflow canonical-v4-signed-handoff-proof.yml agora usa tools/release-operator/export_exact_signed_envelope.py para extrair bytes brutos de um blob regular rastreado em HEAD, usando o ID de objeto do Git. A ferramenta verifica o caminho exato da candidata congelada, SHA-256 e existência do destino antes de gravar em binário, recusando sobrescritas. Não lê chave privada, não reinterpreta JSON como texto, não recalcula ou substitui a assinatura. O release-agent continua obrigado a verificar a assinatura e os três hashes EROFS.

O teste tests/test_exact_signed_envelope_git_blob.py cobre a candidata aprovada, hash divergente, commit inválido, arquivo inexistente, destino preexistente e core.autocrlf=true, no runner Windows oficial.

## Limites

Na primeira tentativa, a prova completa de handoff ainda precisava passar para a candidata 03f88eeaf382a59aaefbcf4943d0639d2730741b. Publicação HTTPS, materialização canônica e vínculo da nova prova v4 seguem como gates independentes. physical_write_allowed=false permanece inalterado; nenhum pendrive foi escolhido ou gravado.


## Prova seguinte e responsabilidade de plataforma

Na execução [38155966069](https://github.com/ordaxsystems/ordax-os/actions/runs/38155966069), a exportação binária foi aprovada no Windows, junto com os testes de regressão e os downloads de artefatos assinados. A próxima etapa falhou **antes do Step 5**, quando a suíte Go de **materialização Linux** foi executada em Windows: a chamada os.Open(diretório).Sync() retorna Access is denied nesse host, inclusive em diretórios temporários dos testes.

A correção de fluxo separa as duas provas sem abrir exceções à integridade: uma etapa Ubuntu 24.04 faz checkout no SHA congelado e executa a suíte Go completa (gravação, fsync, falhas e imutabilidade); somente após esse sucesso, a etapa Windows compila o mesmo release-agent na revisão congelada e executa o Step 5 de **verificação de assinatura e SHA dos três EROFS**. O workflow permanece sem capacidade de publicação ou gravação física.

Isto não habilita a utilização das rotas de materialização Linux no Windows; eventuais chamadas mutáveis continuam falhando fechado nesse sistema. Não foram modificados os bytes do commit assinado 03f88eea, o manifesto, a assinatura ou a custódia de chaves.

## Handoff assinado verificado — 2026-10-11

A prova não publicadora [run 38156353913](https://github.com/ordaxsystems/ordax-os/actions/runs/38156353913), executada a partir do código corrigido da PR #1657, concluiu com **ambos os jobs aprovados**. No Ubuntu 24.04, `go test -count=1 ./...` passou para a revisão congelada `03f88eeaf382a59aaefbcf4943d0639d2730741b`; no Windows, Step 5 verificou a assinatura e todos os EROFS. O recibo oficial baixado do artifact apresentou:

| Arquivo | Tamanho | SHA-256 |
| --- | ---: | --- |
| system.erofs | 7.520.256 bytes | `c17a19d68f02b1f00228707fa991af32e2d63ff6f40dc3ea798a675c6a261145` |
| native-surface-runtime.erofs | 1.052.020.736 bytes | `9f1dfc339a69ac95b2c3f56e4d103e550dca8e4cb2b8b35cc2dcb9a581af69ef` |
| local-ai-runtime.erofs | 568.061.952 bytes | `b244056dad3609357e8a70433f53f41becacd8f3bd93da3d8b23f9e99d86e11a` |

Recibo: `schema=prototype-ordax.portable-v4-signed-handoff-verification/1`, `signature_verified_by_release_agent=true`, `signed_payload_matches_manifest_bytes=true`, `local_artifacts_match_signed_manifest=true`. A publicação, a ativação e a gravação física continuam explicitamente falsas. **O recibo de handoff não é o recibo de materialização canônica.**

O próximo passo é a publicação controlada por HTTPS dos bytes exatos da candidata assinada, seguida da materialização verificada e do vínculo oficial pelo binder existente. Somente depois é possível abrir o gate separado de autorização explícita do proprietário do dispositivo, ainda sem autorização nesta etapa.

