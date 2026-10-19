# OrdaX OS — registro do protótipo 0.1.1-alpha.1

**Produto:** OrdaX OS (mesma identidade para USB e Native). **Canal de desenvolvimento:** `alpha.1`. **Não é release Stable nem atualização autorizada para pendrive.**

## Origem
- Protótipo anterior `0.1.0`.
- Arquivo canônico: `system/contracts/product-version.mjs`.
- A sequência de releases assinadas, os manifestos de componentes e os gates de gravação USB permanecem independentes. O aumento da versão semanticamente identificada **não ativa nenhuma publicação, boot ou instalação**.

## Correções
- `display_outputs.py` converte as falhas de processo/timeout do compositor em `DisplayOutputError` de forma segura; o Native HTTP Host não importa nem executa processos.
- O contrato de callback opcional `onExamples` do controle compartilhado de vídeo é explícito e verificável pelo typecheck do Web.
- O gerador oficial de snapshots públicos passa a observar `system/contracts/product-version.mjs`; snapshots não são editados manualmente.

## Validação / rollback
- Testes dedicados de timeout, erros CLI, ausência de preview ativo após falha, fronteira Native sem `subprocess` e typecheck Web.
- Os artefatos públicos devem ser gerados pelo workflow `Public Surface SSOT Refresh` e passar pela CI.
- Rollback: revert dos commits deste candidato via Git/PR antes da release; nenhuma migração de estado ou mídia física.
- Este é **um candidato em PR**; não publicar enquanto provas gerais estiverem falhando.
