# Reprodutibilidade do EFI após a renomeação final para ordax-os

**Registro:** 8 de outubro de 2026 (execuções CI em UTC em 9 de outubro).
**Escopo:** artefato candidato, sem assinatura; não constitui autorização para gravação física, promoção Stable ou alteração de chaves de confiança.

O builder canônico boot/esp/build.py compila o systemd-boot com fonte upstream pinada por boot/esp/source.json. A URL de identificação SBAT foi repontada de ordaxsystems/prototipo-ordax-os para ordaxsystems/ordax-os. Como essa URL faz parte dos bytes PE/EFI, a renomeação altera legitimamente o SHA-256 do binário.

Duas compilações independentes do **mesmo head 4b9d77f88bbb50f0928be1a9d2cbcc57e36716ce** produziram o hash exato abaixo:

| Prova Linux/GitHub Actions | Resultado | SHA-256 do EFI |
| --- | --- | --- |
| [ESP Bootloader Candidate #37864494629](https://github.com/ordaxsystems/ordax-os/actions/runs/37864494629), job 113607871667 | Build e verificação do EFI aprovados | 17041f6bcdae189a11880c5926d052f60b289dc2ed16b0c9e7aa681bdb592d03 |
| [Creator Payload Candidate #37864494734](https://github.com/ordaxsystems/ordax-os/actions/runs/37864494734), job 113607954587 | Build/verify do EFI aprovados; assemblagem corretamente bloqueada pelo digest anterior no manifesto | 17041f6bcdae189a11880c5926d052f60b289dc2ed16b0c9e7aa681bdb592d03 |

O antigo digest do manifesto candidato, fed636dedec875e4b4b8b1b19d04df1eb919532da87bbbdde78d192d1ab5cb1f, corresponde à identidade SBAT intermediária. A evidência anterior está preservada em docs/evidence/namespace-cutover-efi-reproducibility-2026-10-08.md; seus bytes e hashes não foram reescritos.

**Mudança estritamente versionada:** atualizar apenas o SHA-256 do artefato uefi-boot em docs/contracts/minimal-bootstrap.json, acrescentar regressão testando o vínculo ao build canônico e manter inalterados os demais hashes do manifesto. O contrato permanece com physical_write_allowed=false. Não foram alteradas chaves Ed25519, assinaturas, comprovantes de autorização física nem artefatos históricos.

**Condições ainda obrigatórias:** rebuild de Creator Payload e Full Bootstrap no novo head, comprovação dos demais artefatos do manifesto, CI/QEMU aplicável e validação de assinatura/release independente. Preservar o repository ID 1371063347 não substitui a verificação criptográfica de publicação.
