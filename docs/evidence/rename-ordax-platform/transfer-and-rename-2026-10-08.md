# OrdaX Platform — prova histórica da transferência e renomeação

**Registro de reconciliação:** 8 de outubro de 2026. **Natureza:** proveniência documental, não um contrato operacional, segunda fonte de verdade, licença de publicação ou autorização para gravação física.

## Cadeia histórica

| Etapa | Nome do repositório | Identificador imutável |
| --- | --- | --- |
| Origem na conta pessoal | `washingtonmsdj/ordax-control-plane` | `1406415892` |
| Transferência para a organização (nome intermediário) | `ordaxsystems/ordax-control-plane` | `1406415892` |
| Renomeação física dentro da organização (nome definitivo) | `ordaxsystems/ordax-platform` | `1406415892` |

O repositório consultado no GitHub após a consolidação responde pelo nome final `ordaxsystems/ordax-platform`, mantém o ID `1406415892` e utiliza `main` como branch padrão. A sequência transferência/rename é documentada na [PR histórica #1362 do ordax-os](https://github.com/ordaxsystems/ordax-os/pull/1362), originalmente preparada para só ser aplicada depois do rename físico.

A PR #1362 propunha registrar o evento de renomeação em `docs/contracts/repository-migration-status.json` com o campo `ordax_platform_repository_rename`. O evento é preservado **aqui**, em evidência somente-leitura, porque o contrato corrente já contém o destino final em `ordax_control_plane_namespace_transfer.canonical_repository`. Não criar uma segunda entrada operacional com os nomes antigos nem reclassificar um redirect como autoridade.

## SSOT atual e limites

- **Owner canônico:** `docs/contracts/repository-ownership.json` aponta para `ordaxsystems/ordax-platform`.
- **Estado de migração canônico:** `docs/contracts/repository-migration-status.json` registra a transferência com o ID `1406415892` e o mesmo destino definitivo.
- **Corte consolidado:** [ordax-os#1493](https://github.com/ordaxsystems/ordax-os/pull/1493), incorporada em `main` no commit `c4805bcbdca7f93c2fda112c711a8ff57f8e8054` com 49/49 verificações da PR aprovadas.
- **Proveniência preservada:** os nomes anteriores explicam o histórico; não autorizam dependências de runtime, novos deploys, build via slug antigo, espelhos ou gravação duplicada.
- **Sem promoção automática:** a renomeação e a preservação do repository ID não equivalem a release Stable Ed25519 assinada, bootstrap físico comprovado ou habilitação de instalação em SSD/HD.

Nenhum arquivo de assinatura, envelope, chave ou prova emitida anteriormente foi reescrito para fabricar origem nova. Se o GitHub repository ID ou o owner final deixarem de coincidir com o SSOT canônico, interromper qualquer operação de publicação e investigar a divergência.
