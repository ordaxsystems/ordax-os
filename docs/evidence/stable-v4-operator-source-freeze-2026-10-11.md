# Stable/MVP v4 — origem congelada para os artefatos de operador

**Data:** 2026-10-11  
**Estado desta evidência:** três execuções manuais aceitas e identidade confirmada; artefatos ainda não concluídos/verificados neste registro.  
**Autoridade:** este documento é um registro operacional. A autorização física continua exclusivamente em `docs/contracts/physical-write-authorization.json`; a solicitação canônica ativa continua exclusivamente em `docs/contracts/canonical-v4-signing-request-active.json`. **Nenhum gate é alterado aqui.**

## Origem exata

- Repositório canônico: `ordaxsystems/ordax-os`.
- Commit congelado: `03f88eeaf382a59aaefbcf4943d0639d2730741b`.
- Ref imutável da candidata: `release-candidate/03f88eeaf382a59aaefbcf4943d0639d2730741b`.
- O ref foi criado apontando exatamente para o SHA acima e verificado pelo GitHub CLI antes dos disparos.
- A `main` pode avançar; **nenhum build ou request desta candidata pode trocar de origem silenciosamente**.

## Execuções reais do GitHub Actions

Em 2026-10-11, os três workflows foram disparados com `workflow_dispatch` apontando para o ref acima. A API GitHub confirmou em cada execução `event=workflow_dispatch`, `head_sha` exato e `head_branch` idêntico.

| Payload esperado | Workflow oficial | Run ID | Situação observada no disparo |
|---|---|---:|---|
| `system.erofs` | `portable-release-image.yml` | [38126436379](https://github.com/ordaxsystems/ordax-os/actions/runs/38126436379) | em execução |
| `native-surface-runtime.erofs` | `surface-runtime-lock-discovery.yml` | [38126441063](https://github.com/ordaxsystems/ordax-os/actions/runs/38126441063) | em execução |
| `local-ai-runtime.erofs` | `local-ai-runtime-candidate.yml` | [38126446991](https://github.com/ordaxsystems/ordax-os/actions/runs/38126446991) | em execução |

### Primeira conclusão observada (somente metadados)

A execução **system** `38126436379` concluiu com `status=completed`,
`conclusion=success`. O inventário do GitHub registrou o artefato
`canonical-v4-operator-system-03f88eeaf382a59aaefbcf4943d0639d2730741b`,
ID `11697581939`, digest ZIP
`sha256:2bbf4dbc06a10a391b78d3d2fb72ce53d6760b69e2335239f351da7d39fb4b40`,
`expired=false` e expiração `2026-10-25T08:55:05Z`.
Essa inspeção confirma apenas o **registro e a identidade do pacote no
GitHub**, não os bytes internos EROFS ou a verificação integral exigida
pela montagem canônica. Surface e IA local continuam pendentes nesta
observação.

**Run ID não é artifact ID.** Só após três `completed/success`, e depois da comprovação do inventário, SHA-256, prazo, recibos e bytes dos arquivos reais, o builder canônico poderá criar um pedido de assinatura correspondente:

`tools/release-operator/build_canonical_v4_request.py`

O builder exige os três IDs de execução, verifica o ref `release-candidate/<SHA40>` e deve rejeitar troca de SHA, runs falhos, artefatos ausentes/expirados ou identidade de repositório incorreta. Não capturar resultado por “último workflow verde”, não reaproveitar o pedido ativo histórico do commit `6128e2c365b8cc0aed108af80db1e395292b255d`.

## Separação obrigatória das próximas provas

1. **Build:** três execuções concluídas com sucesso e artefatos de operador verificados, vinculados a este SHA. Ainda pendente neste registro.
2. **Assinatura:** montagem de pedido não assinado com os três artefatos, validação canônica, cerimônia do proprietário com chave fora do GitHub e verificação pública Ed25519. Ainda pendente.
3. **Publicação e materialização:** publicar exatamente os bytes aprovados; baixar/verificar as três imagens do destino real. Ainda pendente.
4. **Autorização de gravação física:** somente depois da nova prova canônica, contexto atual e autorização explícita para mídia removível selecionada. Não autorizada.
5. **Homologação Stable:** boot UEFI em mídia real, primeira utilização, Surface, aplicativos essenciais, cold-health, reboot offline, fallback/rollback e recuperação. Ainda pendente.
6. **Creator público:** assinatura Authenticode do publicador, independente do Developer Creator e da autorização do primeiro USB controlado. Ainda pendente.

Até o fechamento dos gates: `release_signed=false`, `release_published=false`, `physical_target_selected=false`, `physical_write_authorized=false`, `physical_write_performed=false`, `stable_channel_promoted=false`.

Nenhuma etapa acima lê a chave privada, grava mídia USB, acessa discos internos ou usa o Development como prova do Stable. A evidência de boot QEMU, se concluída, permanece **virtual e não física**.
