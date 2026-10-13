# Meridian Round 4 — orientação, toque e chrome

Entrega de refinamento visual em 13/10/2026, para nova auditoria independente. Não constitui integração, release, autorização de adapter ou declaração de prontidão para merge.

Base lida integralmente: [relatório final Round 3](../meridian-round3-audit-2026-10-13/relatorio.md) e [inventário da sidebar](../meridian-round3-audit-2026-10-13/sidebar.md). As evidências históricas permanecem sem alterações. O inventário de 196 itens não foi reclassificado nem ampliado nesta rodada.

## Rastreabilidade e escopo

| Item | Registro |
| --- | --- |
| Owner | Surface, apresentação experimental Meridian |
| Repositório / branch | ordaxsystems/ordax-os / codex/meridian-design-lab |
| Checkout neste computador | C:/Users/TONECOS/Documents/github/ordax-apps/tools/assistant-host/.data/os-meridian-lab |
| HEAD inicial real, árvore limpa | `771cb98c3de077dac0b63197ff9198ca0220ee8b` |
| Commit de código | `11bee9e7ba9a3c496e9b5f607dfea2d795e1fca0` |
| Correção independente preservada | `2b609edae1fca0db56b4de05f76d1bb822245ebe`, ancestral confirmado |
| Commit documental anterior preservado | `771cb98`, ancestral confirmado |
| main local inicial / final | `fafed4a8916587ad35bc07c2f3baa1a60d561b1e` |
| Dependências | Snapshot/fixtures já injetados, catálogo único existente, foregroundWindow auditado, destino de apresentação do owner Workspace |
| Critérios de aceite | Orientação coerente; dock acessível/rolável; maximização/foco/contexto preservados; capturas nos recortes solicitados; isolamento do experimento |

Os hashes dos inputs finais estão em [source-snapshot.json](source-snapshot.json). O commit que contém este relatório e as capturas é documental e posterior ao commit de código. Nenhum push, merge, reset, deploy, instalação ou operação física foi realizado. Os entrypoints, tokens e contratos canônicos, fixtures/storyboards e runners anteriores não têm delta.

## Entrega pelos 26 pontos solicitados

| Nº | Item | Refinamento / prova / limite |
| --- | --- | --- |
| 1 | Branch | codex/meridian-design-lab, mantida. |
| 2 | HEAD inicial | 771cb98c3de077dac0b63197ff9198ca0220ee8b. Não houve retorno a snapshots anteriores. |
| 3 | Commits | 11bee9e7ba9a3c496e9b5f607dfea2d795e1fca0: código + smoke focado. Um commit documental posterior registra esta entrega. |
| 4 | Sidebar | Nomes do catálogo alimentam labels, tooltip e nome acessível. Início continua página exclusiva da Central; Desktop conserva destinos em janela. Marca Desktop continua sem ação. |
| 5 | Conta / Space | Orientação imediata por ponteiro e foco, usando o mesmo nome acessível. Realce discreto de hover/pressed. Sem acrescentar texto persistente ao rail. |
| 6 | Seus projetos | Texto visível inclui “na Central” e glyph da apresentação. Nome acessível explicita o destino; mantém tab:work e a perspectiva existente, sem jornada nova. Menu/busca distinguem Página e Janela. |
| 7 | Dock por toque | Cada app tem alvo de 44×44 px. Espaçamento consistente, ativação existente, gesto horizontal nativo e rolagem ao app corrente. Prova usa toque emulado, não hardware. |
| 8 | Overflow / scroll | Uma superfície interna rolável; chevrons e fades nas extremidades indicam continuação. Estado de scroll é só feedback efêmero. Setas, Home e End percorrem controles sem ativar apps por foco. Nenhum overflow de documento nos recortes. |
| 9 | Compacto em paisagem | 844×390 recebe divisão explícita de aproximadamente 156 px, seleção de um compacto por vez, cabeçalho enxuto e scroll de conteúdo. Notas prioriza o editor; guardar/caption permanecem abaixo, alcançáveis por scroll. Recolher devolve espaço à principal. |
| 10 | Window chrome | Título de 12 px, faixa discreta no foreground, glyph/controles legíveis, borda e profundidade por tokens. Conteúdo de janela inativa conserva legibilidade. Controles mais espaçosos em recortes de toque. |
| 11 | Maximize / restore | As quatro bordas coincidem com md-desktop-primary; sidebar, taskbar e compacto aberto permanecem reservados. Flutuar, minimizar e restaurar conservam modo e rascunho nos checks. Nenhuma API fullscreen. |
| 12 | Foreground / foco | foregroundWindow auditado continua SSOT de dock/contexto e agora também de chrome. Focusin continua conservando o subtree do app. Editar Notes compactas atualiza dock e app/documento contextual; recolher não anuncia conteúdo oculto. |
| 13 | Central | Mesma home/perspectivas/cards. Início ativo ganha marcador de forma; faixa operacional tem espaçamento e peso refinados. Header e navegação de páginas preservados. |
| 14 | Central ↔ Desktop | Texto/glyph do alternador vêm de um helper comum sobre presentationDestination, compartilhado com menu. Mesma posição de rodapé. Fade breve mantém continuidade; Space, janelas e rascunho continuam na sessão existente. |
| 15 | System tray | Rede, bateria, horário, notificações e quick settings preservados. Espaçamento e metadados refinados, expansão anunciada; “exemplo”/Estudo permanecem visíveis. Detalhes em painel/menu nas larguras estreitas. |
| 16 | Intelligence contextual | Mantida sob demanda. Presença visual nativa e lista de Space/app/documento mais clara; proposta/revisão usam jornada existente. Nenhum modelo, leitura de arquivo ou grant. |
| 17 | Motion | Hover/pressed discretos; tooltip imediato com entrada curta; abertura/restauração e mudança de tamanho recebem feedback somente quando a aparência muda. Fade de apresentação preservado. Não se atrasou minimizar/fechar para animar a saída; seu feedback está no dock/estado. prefers-reduced-motion e opção da prévia suprimem animações. |
| 18 | Tipografia | Estudo e tooltips em 12 px; legenda de horário em 11 px; título de janela em 12 px; Conta/Space e metadados específicos revisados. Sem aumento global de todas as fontes. |
| 19 | Argila / Grafite | Mesmos renderers, feedback e geometria. Novos tokens de chrome/borda/sombra derivam dos tokens do material. Nenhuma lógica de comportamento por material. |
| 20 | Responsividade | 1440×900, 390×844, 320×568 e 844×390 cobertos no recorte. Rail baixo mantém conta dentro da viewport; Perfis/Descobrir e utilitários continuam no menu/busca/tray quando não cabem na sidebar. |
| 21 | Acessibilidade | Nome acessível e destino coerentes, indicação de estado por forma/AX, foco visível preservado, keyboard traversal do dock e reduced motion. Uma árvore AX focada passou sem controles sem nome. Sem certificação completa WCAG/zoom/leitor de tela. |
| 22 | Checks rápidos | node --check: 21 módulos; git diff --check: PASS; smoke Round 4: 81 PASS; 24 capturas; zero exceções de página e zero requests externos no recorte. Não executados Foundation, matrizes independentes, CI, kernel/build/USB/hardware. |
| 23 | URLs | Central: http://127.0.0.1:4203/ ; Desktop: http://127.0.0.1:4203/?surface=desktop ; Grafite: http://127.0.0.1:4203/?surface=desktop&material=ink . Host já existente preservado. |
| 24 | Capturas | 24 PNGs listados abaixo e em captures.json. Ambos os materiais nos cenários principais; dock cheio nos três recortes estreitos. |
| 25 | Riscos | Controller ainda de repaint; texto e telemetria são fixtures; scroll do conteúdo de todas as janelas não é runtime final; toque real/zoom/leitor de tela/combinações integrais não homologados. Um timeout de ready no preparo foi indeterminado; execução final completa passou. |
| 26 | main intacta | Ref local fafed4a8916587ad35bc07c2f3baa1a60d561b1e, idêntica ao início. Nenhum arquivo de produção ou evidência anterior alterado. |

## Implementação e preservação de autoridade

`interactions.mjs` controla apenas tooltip, observação de largura/posição do dock e feedback de aparência. Não lê o source, não altera a seleção/foreground, não acessa backend e não cria registry. O controller apenas chama capture/apply/refresh nos pontos existentes de render e atualização de chrome. O cleanup usa o AbortSignal existente. O estado de dock é efêmero e recomeça por sujeito/Space/apresentação, sem persistência.

O CSS antigo de tooltip duplicado entre breakpoints foi substituído pela orientação comum. Overrides conflitantes de tamanho/overflow do dock foram removidos; a geometria base atende ambos os materiais. O rail compacto de baixa altura usa disclosure para preservar Conta e acesso pelo menu; não elimina destinos do catálogo.

Arquitetura e serviços continuam com os owners existentes: Identity/Account, Spaces, Workspace, Files/Apps, Intelligence/Memory/router, Action Gateway, Device Host, Store e Supervisor. Nenhum manifest, lock, contrato, workflow, página pública, adapter, serviço, fixture ou narrativa de capabilities foi promovido/modificado.

## Verificação reproduzível e ocorrências do roteiro

Com o host loopback 4203 em execução:

```sh
node tools/meridian-preview/round4-smoke.mjs
```

O runner usa Chromium descartável e deixa o host e a aba pessoal intactos. [checks.json](checks.json) contém as 81 assertivas e medidas de maximização. [focused-run.log](focused-run.log) registra a execução final. Scope e outputs não equivalem a auditoria independente.

As primeiras tentativas do roteiro foram interrompidas: calendar não é fixado e deve ser aberto via busca; abaixo de 400 px o botão de busca fica no menu. Corrigiu-se o caminho do roteiro sem retirar as assertivas. [attempt-2.log](attempt-2.log) preserva o segundo erro de roteiro. [attempt-3.log](attempt-3.log) preserva um timeout de ready ao navegar, sem diagnóstico de causa; não se atribui esse resultado a uma capability do produto. A tentativa final passou integralmente, inclusive gesto touch via Input.dispatchTouchEvent e focus emulado para eventos nativos. Nenhum teste anterior foi enfraquecido.

## Capturas

| Cenário | Argila | Grafite |
| --- | --- | --- |
| Desktop 1440×900 | [Desktop](desktop-paper-1440.png) | [Desktop](desktop-ink-1440.png) |
| Space / tooltip | [Space](sidebar-space-paper.png) | [Space](sidebar-space-ink.png) |
| Conta / tooltip | [Conta](sidebar-conta-paper.png) | [Conta](sidebar-conta-ink.png) |
| Maximizada | [Maximizada](maximizada-paper.png) | [Maximizada](maximizada-ink.png) |
| Várias janelas | [Janelas](desktop-varias-janelas-paper.png) | [Janelas](desktop-varias-janelas-ink.png) |
| Intelligence contextual | [Contexto](intelligence-contextual-paper.png) | [Contexto](intelligence-contextual-ink.png) |
| Central home | [Central](central-home-paper.png) | [Central](central-home-ink.png) |
| Outra página Central | [Dispositivos](central-dispositivos-paper.png) | [Dispositivos](central-dispositivos-ink.png) |
| Tray aberto | [Tray](tray-aberto-paper.png) | [Tray](tray-aberto-ink.png) |
| Compacto + maximizada 844×390 | [Paisagem](compacto-maximizada-paisagem-paper.png) | [Paisagem](compacto-maximizada-paisagem-ink.png) |

Outros recortes: [dock 390×844](dock-cheio-390.png), [dock 320×568](dock-cheio-320.png), [dock 844×390](dock-cheio-844.png), [Central mobile 390×844](central-mobile-390.png).

O próximo passo é a auditoria independente desta base. Este relatório não altera a classificação anterior nem declara Meridian pronto para merge.
