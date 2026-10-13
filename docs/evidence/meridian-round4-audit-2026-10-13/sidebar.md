# Rail e orientação — auditoria independente Round 4

Inventário DOM em 1440×900, Central/Desktop, Argila/Grafite: [sidebar.json](sidebar.json). Todos os alvos data-tooltip gerenciados usam um hint comum em hover/foco e não mantêm title concorrente. Escape dispensa o hint e conserva o foco; saída permite nova orientação. Conta/Space são botões com aria-haspopup=dialog, sem aria-pressed de toggle. O feedback pressed vem do botão nativo/CSS.

| Nome AX / glyph | Central | Desktop | Orientação e estado |
|---|---|---|---|
| Marca / OrdaX | Home route:central | Marca sem ação de apresentação | Texto/alt; não entra no mecanismo comum de hints |
| Trocar Space, atual: <nome> / glyph atual | panel:spaces | Mesmo painel | Hint comum + nome; seleção/revisão existente |
| Início / central | route:central; current=page na home | Ausente | Hint comum; não alterna apresentação |
| Intelligence / aura | Página intelligence | Janela intelligence existente | Hint comum; current por página/foreground |
| Spaces / spaces | Página spaces | Janela section:spaces | Mesmo comportamento de orientação |
| Aplicativos / apps | Página apps | Janela section:apps | Catálogo ilustrativo, não instalação |
| Perfis / profiles | Página profiles | Janela section:profiles | Hint comum; oculto no rail ≤500 px de altura |
| Dispositivos / desktop | Página devices | Janela section:devices | Hint comum; capability real não criada |
| Descobrir / store | Página store | Janela section:store | Store visual; oculto no rail baixo |
| Continuidade / clock | Página activity | Janela section:activity | Utilitário nomeado; current não acrescentado |
| Notificações / bell | panel:notifications | Mesmo dialog | Nome/hint comuns; marcador de não lidas |
| Ajustes / settings | Página settings | Janela section:settings | Utilitário nomeado; foreground no chrome/dock |
| Conta e identidade / avatar | Jornada identity existente | Mesma jornada | Nome/hint comuns, foco, hover e Escape |

O rail baixo mantém Conta visível e reduz destinos utilitários sem removê-los de menu/busca. Em 390/320 a sidebar some visualmente; o alternador/menu/busca/topbar da Central mantêm caminhos existentes. Quatro recortes largos e quatro recortes de rail baixo/largo por material medem clamp do hint. O runner de regressão R3 cobre navegação, retorno de foco e snapshots AX, não só presença de labels.

Menu/taskbar compartilham presentationDestination: Área de trabalho na Central, Voltar à Central no Desktop. Início continua home. Seus projetos usa a rota de trabalho da Central, com nome explícito e glyph do destino; não abre nova jornada.

Dock: Fixado, Aberto, Ativo e Minimizado mantêm nomes e formas (ponto, traço, contorno), mesmo sem cor. Setas/Home/End navegam foco e rolagem sem seleção de app. Durante inércia de toque, o alvo escolhido por tecla permanece visível; pointer/wheel/saída de foco liberam essa preferência. Central e compacta recolhida não anunciam app oculto como ativo.
