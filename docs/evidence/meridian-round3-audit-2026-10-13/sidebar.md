# Sidebar e acessos — Meridian Round 3 auditada

Inventário extraído do DOM final em 1440×900: [sidebar.json](sidebar.json). Não é registro de apps/serviços. Na Central, aria-current=page identifica a página nos itens principais; no Desktop, aria-current=true identifica o destino de janela corrente. Utilitários mantêm nome/title; a localização da Central também identifica a página aberta. Destinos sem item na sidebar permanecem no menu/busca.

| Nome AX / ícone | Tooltip nativo | Central: ação | Desktop: ação / estado |
|---|---|---|---|
| OrdaX Central / marca | Ausente; marca com texto | route:central → home | Marca não é botão; não altera apresentação |
| Trocar Space, atual: <nome> / glyph do Space | Ausente | panel:spaces → seleção/revisão explícita | Mesmo painel; não troca apresentação |
| Início / central | Início | route:central → home; current=page quando ativa | Ausente na sidebar, launcher e busca Desktop |
| Intelligence / aura | Intelligence | route:intelligence → página | Janela intelligence; reutilizada; current=true quando corrente |
| Spaces / spaces | Spaces | route:spaces → página | Janela section:spaces |
| Aplicativos / apps | Aplicativos | route:apps → catálogo visual | Janela section:apps |
| Perfis / profiles | Perfis | route:profiles → catálogo visual | Janela section:profiles |
| Dispositivos / desktop | Dispositivos | route:devices → página | Janela section:devices |
| Descobrir / store | Descobrir | route:store → Store visual | Janela section:store |
| Continuidade / clock | Continuidade | route:activity → página | Janela section:activity |
| Notificações / bell | Notificações | panel:notifications → dialog | Mesmo dialog, sem mudar apresentação |
| Ajustes / settings | Ajustes | route:settings → página | Janela section:settings |
| Conta e identidade / avatar | Ausente | Jornada identity/overview | Mesma jornada, sem alterar apresentação |

A árvore AX expõe os nomes mesmo quando o rail é icon-only. Os itens principais têm title e tooltip CSS no Desktop; Conta/Space têm nome AX e carecem de tooltip nativo. A marca Desktop tem alt OrdaX OS e não recebe ação/foco de botão.

Arquivos, Conversas e Automações são destinos do menu/busca; no Desktop abrem files, section:messages e section:automations. Não se adicionaram três ícones à sidebar. Files/Intelligence usam IDs de apps existentes; section:<id> só resolve metadados das sections existentes.

O rodapé tem um alternador explícito: Área de trabalho na Central, Voltar à Central no Desktop. O menu modal também oferece Central / Área de trabalho enquanto a barra de fundo está inerte. Início é home da Central, não esse alternador. Até 600 px a sidebar não é renderizada visualmente; menu/busca e rodapé conservam os destinos. Ctrl/Meta+K permite abrir busca sem depender da topbar escondida no mobile.

Estados do dock: Fixado, Aberto, Ativo, Minimizado entram no nome AX/title e nos marcadores de forma. Somente o app visível corrente é Ativo; Central e uma compacta recolhida não anunciam janela guardada como foreground. Estes estados são de demonstração, não instalação ou lifecycle canônico.
