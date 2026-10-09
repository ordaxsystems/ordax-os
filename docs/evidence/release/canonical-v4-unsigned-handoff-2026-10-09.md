# Auditoria da solicitação pública de assinatura Stable v4 — 2026-10-09

## Objetivo e autoridade

Registrar uma verificação **independente do pacote NÃO ASSINADO** produzido para um
commit exato de `ordaxsystems/ordax-os`. Esta nota documenta a etapa de
preparação, e **não constitui** assinatura, autorização de publicação Stable,
aceite de hardware nem permissão para gravar USB, HD, SSD ou NVMe.

- Owner: `ordaxsystems/ordax-os`.
- Fonte congelada na solicitação: `eaac763a607bb697d8c7a0f76d44f37a399674c7`.
- Contrato ativo: `docs/contracts/canonical-v4-signing-request-active.json`.
- O contrato antigo `canonical-v4-signing-request.json` permanece histórico
  e imutável; não é autoridade de execução.

## Montagem real e proveniência GitHub

O [workflow Canonical v4 Public Signing Request #37880051615](https://github.com/ordaxsystems/ordax-os/actions/runs/37880051615)
executou na `main@a4ae9980a391d4da1b301af53c33fd81363843dc` e concluiu
os **três jobs com sucesso**, incluindo `assemble-public-signing-request`.
O source commit incorporado na solicitação **não é** o commit mais novo da
`main`; a montagem intencionalmente usa os bytes e a referência congelados.

O pacote público *não assinado* está no GitHub Actions:
- Artefato `11593738962`:
  `canonical-v4-signing-request-eaac763a607bb697d8c7a0f76d44f37a399674c7`.
- Digest ZIP informado pela API: `sha256:306fca0bfabf11192ef54fe24e4570ff57e6e8c57f60198c256909dd5123ab15`.
- Expiração informada: `2026-10-23T03:38:05Z`.
- O recibo interno `canonical-v4-signing-request-receipt.json` possui SHA-256
  `771e1e911a872c5145212accedcfde3b3f85eb5b67284e3615f033a847e21c0f`.
- Manifest v4 **ainda não assinado**:
  `release-manifest.json`, SHA-256
  `9a051bf6d5d4c55544c3048be2351bc8fafca960f28218acdd2a98981d452157`.
- Request copiada no pacote: SHA-256
  `84104e88b7f3ad671bf2829efe5f6f2a2d8a4f8796ec41833756b9bfdd3fe693`.

Baixamos o pacote pelo GitHub CLI em um diretório de auditoria isolado
do computador conectado. Foram encontrados **12 arquivos**; as **11 entradas
do `SHA256SUMS` conferiram** com os bytes de seus arquivos. O conteúdo
não apresenta chave privada, `*.pem`, `*.pfx` nem `release-envelope.json`.
O recibo atesta explicitamente `private_key_included=false`,
`signing_performed=false`, `publication_performed=false` e
`physical_write_performed=false`. A inspeção não executou o assinador.

### Entradas binárias referenciadas por recibos imutáveis

| Classe | Run / Artifact ID | SHA-256 da imagem | Bytes | Expira UTC |
| --- | --- | --- | ---: | --- |
| system | `37877844919 / 11592913482` | `99760b731843646867857cde76a25d592151bd0b4e4bb65ba46983275c101510` | 2.842.624 | `2026-10-10T03:08:48Z` |
| surface | `37877847998 / 11592679610` | `04dd5cb80a453cc583c2729820fcbe0ce1e85d31ce49c4f062afe6272601623b` | 1.052.020.736 | `2026-10-10T03:09:48Z` |
| local-ai | `37877851229 / 11593168889` | `b244056dad3609357e8a70433f53f41becacd8f3bd93da3d8b23f9e99d86e11a` | 568.061.952 | `2026-10-10T03:17:47Z` |

Esses três artefatos **não estavam expirados na auditoria**, e o workflow
de montagem os havia baixado e validado por digest ZIP, recibo e commit.
O pacote pequeno **não contém** as três imagens EROFS grandes. As
referências e hashes acima foram confrontados com os recibos do pacote;
as imagens grandes não foram baixadas novamente pelo operador desta
auditoria. Portanto, não afirmar verificação local independente dos seus
bytes a partir desta nota.

O tempo de retenção desses artefatos temporários é menor que o do pacote
público; depois da expiração, uma nova exportação autenticada e com
metadados/versionamento correto pode ser necessária. Não aceitar cópias
sem proveniência para substituir IDs expirados.

## Diferença entre preparar e assinar

- A `main` consultada na auditoria já era
  `2e0e93ffa48235942ba4fc27aca79366c2f54b6b`, **posterior** ao source
  `eaac763a...` do candidate. Alterações de Conta, políticas legais e site
  posteriores não estão implicitamente incorporadas ao candidato anterior.
- É necessária decisão explícita de *release freeze* sobre o commit exato.
  Não redirecionar a assinatura para HEAD ou alterar tag, artefato/ID/URL
  depois da validação. Se o commit final mudar, emitir nova solicitação
  com três conjuntos de receipts/artefatos correspondentes.
- A chave Ed25519 canônica **não** deve entrar em Git, workflow, chat,
  artifact, pasta de auditoria ou automação do desenvolvedor; a assinatura
  pertence ao operador responsável pela custódia, conforme
  `docs/RELEASE-SIGNING.md`.
- Após cerimônia legítima: validação do envelope contra
  `bootstrap/trust/release-ed25519.json` e os bytes exatos; publicação
  deliberada de manifest/envelope/imagens no host HTTPS autorizado;
  materialização/verify-only; receipt agregado; só então avaliar gates
  do canal Stable. `Repository Namespace Transfer Preflight` permanece
  *fail-closed* enquanto `releases/latest/release-envelope.json` não
  existir legitimamente.
- A publicação assinada **não** autoriza gravação física e não substitui
  cold-health, rollback real, readback e aceite de hardware.
- Authenticode para o Creator público é uma responsabilidade adicional:
  `docs/contracts/creator-code-signing.json` continua `unconfigured`.

## Resultado desta auditoria

**PASS:** montagem pública não assinada, download do pacote pequeno,
11/11 checksums locais, proveniência de source/receipts, confirmação de
ausência de envelope/chave na distribuição, IDs/expiração dos inputs.

**NÃO EXECUTADO/NÃO PROVADO:** transferência local das três EROFS,
custódia/uso da chave privada, assinatura canônica, release Stable pública,
materialização assinada definitiva, boot/ativação/gravador físico e
certificação do Creator.

A evidência não deve ser confundida com o selo de MVP lançável.
