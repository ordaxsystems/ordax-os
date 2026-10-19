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
- A identidade visual preserva os proprietários corretos: tanto o token quanto a camada de pintura do wallpaper ficam em `meridian.css`, sem repetição em `identity.css`; o estado ativo dos aplicativos pertence ao CSS Surface.
- A proveniência de adaptações históricas da Central e do Window Layer preserva os digests anteriores e o upstream em `docs/evidence/web-central-reference-2026-10-11.json`; verificadores continuam comparando os bytes atuais, sem registrar falso sucesso em caso de drift.
- Estes ajustes ainda são **código candidato em PR**, não versão publicada. O teste de navegador real e todos os required checks da HEAD definitiva são obrigatórios para integração; boot físico, gravação USB e distribuição permanecem fora do escopo.

## Composição visual reconciliada com a main — 19/10/2026

- Merge Git de **dois pais** `4ba9c579` integra a fonte `main@48b1e0a5` na branch experimental sem modificar a `main`. A atualização inclui os owners de interface `account`, `files`, `first-run`, `journeys`, `settings`, `surface`, `system`, `tokens` e a folha Meridian Web.
- A regra compartilhada de acessibilidade preserva o **piso real de 44 CSS pixels** na sidebar recolhida, mantendo o token `--md-dock-control-size`; os novos testes de layout da `main` e as regressões Native continuam no mesmo arquivo, sem duplicar o seletor proprietário.
- A política SemVer canônica avalia caminhos NUL-delimitados de `git diff --no-renames --name-only -z`. Renomear código executável, inclusive nomes Unicode ou launchers sem extensão, para documentação não pode contornar o incremento obrigatório. O verificador e seus testes provêm do mesmo owner de OS #2009, não de implementação paralela.
- O workflow `Public Surface SSOT Refresh` regenerou os quatro artefatos derivados no commit `e9d3c92c`, sem hashes ou snapshots feitos à mão. Essa geração não constitui aprovação dos checks do **HEAD atual**, que precisa de CI própria; o histórico de `action_required` de commits do bot continua bloqueio administrativo registrado em #2022.
- Esta composição permanece **exclusivamente para CI**. Não foi gravada em USB, instalada no Windows, publicada como Stable ou integrada ao OrdaX Grátis.

## Restauração dos contratos móveis após a evolução de Meridian

- A fonte atual da `main` havia removido regras móveis de `first-run.css`, `files.css` e `surface.css` sem substituir seus contratos. No commit `ab6f660c`, as regras de composição responsiva foram recuperadas da última revisão anterior `0669d27d` e reaplicadas **nos próprios CSS canônicos**; não foi criado componente alternativo.
- Primeiro Uso: a partir de 820 CSS px, a grade passa a uma coluna, os oito passos tornam-se uma linha horizontal compacta e o rodapé continua visível fora do conteúdo rolável. A adaptação até 600 px também foi recuperada.
- Arquivos: abaixo de 760 CSS px, o layout das localizações e a toolbar passam a modo compacto e a coluna de tipo pode ser omitida, preservando a coluna de modificação no modo de lista; ações compactas até 560 px continuam acessíveis.
- Surface: os layouts responsivos de 980 e 760 CSS px restauram o posicionamento de janelas, statusbar, rail e painéis dentro de uma tela estreita. Os contratos de movimentação reduzida e maximização permanecem em seus owners existentes.
- Configurações mantém `@container settings-viewport` para responder **à janela do aplicativo**, não só ao tamanho do monitor; sua verificação foi atualizada sem reintroduzir o antigo breakpoint de viewport.
- Conta: o teste canônico da PR #2027 comprova a navegação rolável com itens `flex: 0 0 auto`, sem adicionar uma segunda implementação CSS. Foi incluído na branch experimental como blob Git idêntico.
- A recuperação não é uma release nem implica testes físicos aprovados. Manter Foundation, Surface Web, QEMU e Public Site obrigatórios na HEAD após esses ajustes.

## Validação / rollback
- Testes dedicados de timeout, erros CLI, ausência de preview ativo após falha, fronteira Native sem `subprocess` e typecheck Web.
- Os artefatos públicos devem ser gerados pelo workflow `Public Surface SSOT Refresh` e passar pela CI.
- Rollback: revert dos commits deste candidato via Git/PR antes da release; nenhuma migração de estado ou mídia física.
- Este é **um candidato em PR**; não publicar enquanto provas gerais estiverem falhando.
