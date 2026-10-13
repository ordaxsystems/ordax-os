# OrdaX Stable v4 — evidência da assinatura offline da candidata 03f88eea

**Data:** 2026-10-11  
**Estado:** manifesto v4 assinado e verificado contra a confiança pública canônica. **Não publicado, não materializado, não ativado e sem prova física Stable desta candidata.**

## Origem exata e cadeia anterior

- Repositório: `ordaxsystems/ordax-os`.
- Commit congelado: `03f88eeaf382a59aaefbcf4943d0639d2730741b`.
- Ref: `release-candidate/03f88eeaf382a59aaefbcf4943d0639d2730741b`.
- Pedido ativo: `docs/contracts/canonical-v4-signing-request-active.json`, atualizado pela PR #1647, que passou nos testes de reconstrução do builder canônico, na prova live e no Foundation.
- Três execuções manuais concluídas `completed/success`, verificadas pela API GitHub:
  - Sistema: run [38126436379](https://github.com/ordaxsystems/ordax-os/actions/runs/38126436379), artifact `11697581939`.
  - Surface: run [38126441063](https://github.com/ordaxsystems/ordax-os/actions/runs/38126441063), artifact `11696773362`.
  - IA local: run [38126446991](https://github.com/ordaxsystems/ordax-os/actions/runs/38126446991), artifact `11697502993`.
- Montagem pública não assinada: [run 38127644552](https://github.com/ordaxsystems/ordax-os/actions/runs/38127644552), `completed/success`, artifact `11697349496` — `canonical-v4-signing-request-03f88eeaf382a59aaefbcf4943d0639d2730741b`.
- SHA-256 do ZIP publicado pelo GitHub Actions: `fd5e83ad9ed6ebf59a0bfc3f218ddd703e771f96c140d845b245a24299102ae3`. Pacote de aproximadamente 1,9 MB, sem imagens EROFS nem chave privada.

## Verificação no computador de assinatura autorizado

O pacote foi baixado para a localização de trabalho controlada
`%USERPROFILE%\OrdaX-Release-Candidates\canonical-v4-03f88eeaf382a59aaefbcf4943d0639d2730741b`.
A conferência local `SHA256SUMS` passou nos **11 arquivos assinados pelo inventário** do pacote. O manifesto tem schema `prototype-ordax.release-manifest/4`, `source_commit` exato e três artefatos: `system.erofs`, `native-surface-runtime.erofs` e `local-ai-runtime.erofs`.

A cerimônia invocou **somente** o procedimento canônico
`4-Sign-Initial-OrdaXRelease.ps1` pertencente ao pacote validado. A chave privada continuou no armazenamento privado do operador; o chat não leu, copiou, alterou, anexou nem publicou sua chave.

O assinador confirmou `RELEASE_ENVELOPE_SIGNED=YES`, `TRUST_MATCH=YES` e `SOURCE_COMMIT` idêntico. Depois, uma nova execução de `ordax-release-signing.exe verify-envelope` confirmou `SIGNATURE_VERIFIED=YES`. Os bytes `payload` (base64 decodificado) do envelope foram comparados via SHA-256 aos bytes do arquivo `release-manifest.json` e coincidiram.

| Arquivo público | SHA-256 |
|---|---|
| `release-manifest.json` | `5dc9213b65eaffa7adf67c0addc7dbe32af1e06ae4b9a4f5a8dea37aa8ee99d6` |
| `release-envelope.json` | `d9ab389cd55c481785491cb1c3881936e47e7347bdc69ccea5c76a7437969a90` |

ID da chave de confiança pública: `ordax-prototype-release-v1`. O envelope é material **público assinado**, mas ainda não é uma release distribuída.

## Gates que continuam fechados

- Não foi executada a etapa canônica 5 `5-Verify-PortableV4-SignedHandoff.ps1`, pois ela exige conferir os **três EROFS reais** e o `ordax-release-agent.exe`. A assinatura do manifesto não substitui essas provas de payload.
- Os três EROFS, o manifesto e o envelope ainda **não foram publicados juntos** por HTTPS sob o tag da candidata. Não houve `release latest` nem promoção de Stable.
- Não foi executada a materialização canônica por release-agent nem gerado recibo atual de prova materializada.
- O contrato `docs/contracts/physical-write-authorization.json` não foi alterado; `physical_write_allowed=false`, sem autorização explícita de gravação e sem destino USB selecionado.
- Boot físico, first-run, cold-health, falha controlada e rollback da **candidata atual** continuam pendentes.
- Assinatura Authenticode do Creator público é gate independente e não é substituída por este envelope Ed25519.

**Não misturar esta assinatura com a evidência histórica de 2026-10-10**, que pertence ao commit `6128e2c365b8cc0aed108af80db1e395292b255d`.

```text
OFFLINE_ED25519_VERIFIED=YES
SIGNED_PAYLOAD_MATCHES_MANIFEST_BYTES=YES
CANONICAL_RELEASE_PUBLISHED=NO
CANONICAL_MATERIALIZATION_PROOF=NO
PHYSICAL_TARGET_SELECTED=NO
PHYSICAL_WRITE_AUTHORIZED=NO
PHYSICAL_WRITE_PERFORMED=NO
```
