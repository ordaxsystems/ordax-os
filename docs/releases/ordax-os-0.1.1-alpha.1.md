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

## Integração de Surface/Native para o candidato alpha

- A Surface Native usa `state.presentation` como **única autoridade** da troca Central/Desktop. O mesmo valor é projetado no root e no `data-ordax-shell`, para que a geometria CSS Meridian receba o modo realmente selecionado; sem controlador paralelo.
- O CSS compartilhado da sidebar Meridian mantém as três ações Continuidade, Notificações e Ajustes com área mínima de **44 x 44 CSS px**, mesmo quando `2.75rem` equivale a 38,5 px na fonte-base de 14 px. O token continua sendo utilizado se exigir tamanho maior.
- A identidade visual preserva os proprietários corretos: o token de wallpaper em `meridian.css`, seu consumo em `identity.css` e o estado ativo de aplicativo no CSS Surface.
- A proveniência de adaptações históricas da Central e do Window Layer preserva os digests anteriores e o upstream em `docs/evidence/web-central-reference-2026-10-11.json`; verificadores continuam comparando os bytes atuais, sem registrar falso sucesso em caso de drift.
- Estes ajustes ainda são **código candidato em PR**, não versão publicada. O teste de navegador real e todos os required checks da HEAD definitiva são obrigatórios para integração; boot físico, gravação USB e distribuição permanecem fora do escopo.

## Validação / rollback
- Testes dedicados de timeout, erros CLI, ausência de preview ativo após falha, fronteira Native sem `subprocess` e typecheck Web.
- Os artefatos públicos devem ser gerados pelo workflow `Public Surface SSOT Refresh` e passar pela CI.
- Rollback: revert dos commits deste candidato via Git/PR antes da release; nenhuma migração de estado ou mídia física.
- Este é **um candidato em PR**; não publicar enquanto provas gerais estiverem falhando.
