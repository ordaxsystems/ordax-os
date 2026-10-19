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

## Composição desktop de USB/Native — validação de produto

- Após a reconciliação de `main@7a5933d9`, foi confirmado o contrato em `docs/PRODUCT-MODES.md`: o OS USB e Native **não mudam para navegação de celular/tablet** em viewports pequenos. Ambos preservam o desktop, inclusive a hierarquia da rail/sidebar e o gerenciamento de janelas.
- Por essa razão, os breakpoints legados de apresentação telefônica **não foram promovidos**. `first-run.css`, `files.css` e `surface.css` são exatamente os blobs da `main` atual, sem segunda folha de estilos.
- Primeiro Uso: o rail vertical mantém todos os passos; conteúdo central pode rolar e o footer permanece fora da área rolável. Arquivos mantém quatro colunas com lista rolável em vez de ocultar a coluna de modificação.
- Configurações usa `@container settings-viewport` para compactar segundo a janela real do aplicativo; Conta mantém navegação horizontal rolável com ações que não encolhem. Os testes de ambas as responsabilidades conferem os seletores existentes.
- A PR de testes [#2028](https://github.com/ordaxsystems/ordax-os/pull/2028) guarda as quatro verificações desktop de Arquivos/Primeiro Uso/Configurações; os mesmos blobs são utilizados nesta integração. A PR #2027 guarda a verificação da Conta.
- A interface Web/Mobile tem capacidades e layouts próprios por modo, mas não criamos um segundo OS, novos providers nem uma alteração de runtime. Qualquer regressão de layout deve ser comprovada nos gates de navegador e boot QEMU antes de promover este candidato.

## Validação / rollback
- Testes dedicados de timeout, erros CLI, ausência de preview ativo após falha, fronteira Native sem `subprocess` e typecheck Web.
- Os artefatos públicos devem ser gerados pelo workflow `Public Surface SSOT Refresh` e passar pela CI.
- Rollback: revert dos commits deste candidato via Git/PR antes da release; nenhuma migração de estado ou mídia física.
- Este é **um candidato em PR**; não publicar enquanto provas gerais estiverem falhando.
