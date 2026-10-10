# Evidência de assinatura offline do candidato v4 — 2026-10-10

**Estado:** envelope Ed25519 assinado e verificado, **sem publicação** e **sem
prova física do candidato atual**. Este registro não substitui a release
assinada/materializada, o contrato `physical-write-authorization.json`, nem
a prova de boot USB.

## Origem única e artefatos

- Repositório: `ordaxsystems/ordax-os`, branch operacional `main`.
- Commit congelado da release: `6128e2c365b8cc0aed108af80db1e395292b255d`,
  comprovado como ancestral da `main`.
- Correção na `main`: `6128e2c` aumenta a retenção dos três EROFS
  de operador de 1 para 14 dias; `9cee9f6` impõe prova de metadados
  vivos antes da montagem; `4a2618c` troca somente o pedido ativo.
- Os três builds manuais do exato mesmo commit concluíram com sucesso
  e foram comprovados pela API oficial do GitHub:

| Payload | Run GitHub Actions | Artefato de operador |
| --- | --- | --- |
| `system.erofs` | `38030816100` | `11661998268` |
| `native-surface-runtime.erofs` | `38030818214` | `11662225152` |
| `local-ai-runtime.erofs` | `38030820593` | `11661999204` |

A montagem canônica **não assinada** [run 38031520848](https://github.com/ordaxsystems/ordax-os/actions/runs/38031520848)
passou, incluindo fontes/receipts, verificação dos metadados do GitHub,
reprodutibilidade, assinatura *não* executada no runner e pacote sem PEM ou
imagens EROFS. Artefato público de CI:
`canonical-v4-signing-request-6128e2c365b8cc0aed108af80db1e395292b255d`
(id `11661504726`).

## Cerimônia local efetuada, sem expor a chave

O pacote foi baixado para o computador autorizado em
`%USERPROFILE%\OrdaX-Release-Candidates\canonical-v4-6128e2c365b8cc0aed108af80db1e395292b255d`.
A lista `SHA256SUMS` foi verificada; o script de assinatura e a confiança
pública foram comparados aos objetos **do commit Git congelado**. A cópia de
trabalho do Windows diferia nos finais de linha, não no objeto Git fonte.

O procedimento canônico `4-Sign-Initial-OrdaXRelease.ps1` gerou o
`release-envelope.json` fora do repositório, usando a chave privada local.
A chave não foi lida pelo chat, copiada para o pacote nem publicada.
As duas verificações executaram com sucesso:

- `ordax-release-signing.exe verify-envelope`: `SIGNATURE_VERIFIED=YES`.
- `ordax-release-agent.exe verify-envelope`: `status=verified`,
  `artifact_count=3`, origem exata conferida.
- Os bytes decodificados do payload assinado correspondem **byte a byte** ao
  `release-manifest.json`.

| Material público local | SHA-256 |
| --- | --- |
| `release-manifest.json` | `3cd0a106055a61c42d961f20a73b5cdf9d8647cd27f74b46d3934090e3b69257` |
| `release-envelope.json` | `149b0ea27dc449ccac7454b50714e3356fa039ee3faa36b16a63bf5ad1c4b4af` |
| `release-ed25519.json` | `d2836df77a3d5a54ccf64cc5643cfd5c19052efc83f2e3e2666c6d3197fce250` |

## O que ainda não foi afirmado

Não houve publicação de uma release/pré-release assinada em HTTPS, nem
materialização dos três EROFS no alvo, nem execução completa do runbook
`5-Verify-PortableV4-SignedHandoff.ps1`, que exige os três artefatos físicos
locais. A máquina Windows tinha aproximadamente **5,2 GB livres** no volume
`C:`; baixar/descompactar imagens grandes nesse volume foi evitado.

Próxima dependência técnica: publicar os **exatos** três EROFS e os dois
materiais assinados via fluxo controlado, verificar no destino a assinatura,
SHA-256 e tamanhos, materializar pelo release agent sem ativação, emitir a
nova prova v4 canônica e apenas então avaliar autorização para um alvo USB
removível selecionado. Esta etapa nunca deve escrever no disco interno.

**Gates observados:** `release_published=false`;
`release_activated=false`; `physical_target_selected=false`;
`physical_write_performed=false`. A verificação da assinatura isolada
não altera nenhum desses estados.
