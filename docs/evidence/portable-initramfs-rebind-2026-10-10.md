# Portable PID1 — reconciliação do digest do initramfs (10/10/2026)

Owner: `bootstrap/initramfs` e `tools/creator/assemble.py`.
Contexto: PR #1594, commit testado `6a1988dde46b4eb5f292cbec7c892c77288d51c5`.

## Causa e evidência

A descoberta USB do candidato mudou o conteúdo de `bootstrap/initramfs/portable_init.sh`. Dois workflows independentes construíram a imagem de initramfs para o **mesmo SHA do source** e obtiveram o mesmo hash do arquivo `out/initramfs/initramfs.cpio.gz`:

- [Creator Payload Candidate 38065821609](https://github.com/ordaxsystems/ordax-os/actions/runs/38065821609), job 114253163610, etapa de montagem.
- [Full Bootstrap Media Proof 38065821636](https://github.com/ordaxsystems/ordax-os/actions/runs/38065821636), job 114253166113, etapa de montagem.

Ambos rejeitaram corretamente o payload porque o contrato de bootstrap exigia o digest anterior:
- Esperado anteriormente: `63a504c4349aebc43d9ed642ff14384191fd9804e8a657691ffe997441a9edf0`.
- Medido em ambos os builders: `774a6f659eb217503cc44e65cc98e36edb22d93cbfede8a719c3eede7d8c2a3f`.

A verificação **não** foi ignorada, removida, tolerada ou transformada em warning. O novo valor foi reconciliado nos owners já existentes:
`docs/contracts/minimal-bootstrap.json`,
`system/base-update/candidate.json` e
`tests/test_mvp_seed_artifact_bindings.py`.

## Limites e revalidação

Esta observação é de dois builders CI com o mesmo source congelado; **não** prova por si só o boot físico, a assinatura do payload, o hash de um EROFS v4, nem a reprodutibilidade independente do kernel em outra versão. A PR deve repetir os gates do Creator, Base e boot QEMU com o novo pin, sem alegar aprovação até os workflows terminarem.

`docs/contracts/physical-write-authorization.json` permanece **sem alteração**, com `physical_write_allowed=false`, `explicit_owner_authorization=false` e `canonical_v4_release_proof_bound=false`. Seu binding histórico a `minimal-bootstrap.json` não foi silenciosamente renovado ou reutilizado: a autorização requer contexto/hashes e evidência do release exato em cerimônia separada.

Nenhum dispositivo foi gravado, nenhuma chave privada foi acessada e nenhuma release foi promovida.
