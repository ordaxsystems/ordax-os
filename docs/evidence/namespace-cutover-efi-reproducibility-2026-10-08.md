# Candidato de EFI — evidência de reprodução no cutover do namespace

**Somente candidato pré-transferência, não é release assinada, nem autorização para gravação física.**

A alteração da URL SBAT do systemd-boot, embutida durante a montagem
de `boot/esp/build.py`, passa de
`https://github.com/washingtonmsdj/prototipo-ordax-os` para
`https://github.com/ordaxsystems/prototipo-ordax-os`. Isso muda os bytes
do `systemd-bootx64.efi` mesmo quando o upstream de systemd está
fixado no mesmo commit.

No **mesmo source revision**
`e07af9979bf9deaabaf3e37b8284d8961dea1085`, duas execuções
independentes produziram o mesmo SHA-256:

| Execução GitHub Actions | Resultado do build EFI | Hash |
| --- | --- | --- |
| [Native ESP Candidate #37724415219](https://github.com/washingtonmsdj/prototipo-ordax-os/actions/runs/37724415219) | Candidato EFI validado pela etapa nativa; workflow aprovado | `fed636dedec875e4b4b8b1b19d04df1eb919532da87bbbdde78d192d1ab5cb1f` |
| [Full Bootstrap Media Proof #37724610394](https://github.com/washingtonmsdj/prototipo-ordax-os/actions/runs/37724610394) | O arquivo EFI foi montado e validado; o workflow completo **falhou depois**, por manifesto Creator com hash antigo | `fed636dedec875e4b4b8b1b19d04df1eb919532da87bbbdde78d192d1ab5cb1f` |

Hash do EFI histórico no `docs/contracts/minimal-bootstrap.json` anterior
ao cutover:
`9ac1ca03fc52ed2d8c40cea76b84192d718909d561a7bc6cf36d84784b71ada5`.

**Alcance da revalidação:** a PR draft fixa somente o valor reproduzido no
manifesto de candidato `minimal-bootstrap.json`. Ela **não modifica** a
assinatura histórica, o artefato publicado, `canonical-v4-signing-request.json`
nem `physical-write-authorization.json`. O manifesto candidato permanece
`physical_write_allowed=false`. Os builds Creator e Full Bootstrap precisam
passar novamente no **novo commit** antes de qualquer promoção. A nova cadeia
de release verificável e assinada, incluindo a disponibilidade do canal
stable, continua obrigatória. A preservação do GitHub repository ID
`1371063347` não autentica por si só um novo manifesto de release.

A PR #1367 permanece em **draft**, não mesclar na conta original.
