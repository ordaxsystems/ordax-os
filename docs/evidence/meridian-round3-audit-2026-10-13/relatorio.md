# Auditoria independente — Meridian Round 3 e correções posteriores

**Classificação final: C — aprovada para próximo refinamento visual.** Auditoria de apresentação experimental, incluindo os três ajustes posteriores à entrega inicial. Nenhum resultado desta evidência autoriza integração, merge, release, adapter ou operação física.

Data: 13/10/2026. Owner: Surface/apresentação experimental. Escopo autorizado: auditar o HEAD real, corrigir bugs objetivos de navegação, foco, contexto e semântica; preservar a direção visual e os owners canônicos. A auditoria complementa a [Round 1](../meridian-audit-2026-10-13/relatorio.md), a [Round 2](../meridian-round2/coverage.md), a [auditoria independente Round 2](../meridian-round2-audit-2026-10-13/relatorio.md) e a [entrega inicial Round 3](../meridian-round3/coverage.md).

## Snapshot e rastreabilidade

| Item | Estado comprovado |
|---|---|
| Repositório / branch | ordaxsystems/ordax-os / codex/meridian-design-lab |
| Checkout | C:/Users/TONECOS/Documents/github/ordax-apps/tools/assistant-host/.data/os-meridian-lab |
| HEAD inicial efetivamente auditado | db7b4a1d90be01c5332705c8b443b703de02ad6e |
| Base Round 3 | 43cf7ba95d0bc6de924ba43ac05c3baee84c2cd2 |
| Árvore inicial | Limpa |
| Delta completo inicial | 43 arquivos; 631 inserções, 40 exclusões, incluindo evidências/capturas |
| Correção desta auditoria | 2b609edae1fca0db56b4de05f76d1bb822245ebe |
| main local inicial/final | fafed4a8916587ad35bc07c2f3baa1a60d561b1e |

Cadeia linear confirmada, sem reset: 43cf7ba → bf15f90 → 0f4f067 → 6b0ca07 → a251578 → db7b4a1. SHAs completos e parents estão em [validacoes.json](validacoes.json). bf15f90 introduziu composição/contexto; 0f4f067 registrou a entrega inicial; 6b0ca07 adaptou navegação à apresentação; a251578 removeu margens da maximização; db7b4a1 restaurou Início na Central. Todos foram preservados.

Os relatórios, 196 itens e 14 fluxos das rodadas anteriores já haviam sido lidos integralmente nesta conversa. Confirmou-se zero diff nos três diretórios de evidência anterior; suas leituras e critérios foram retomados. A entrega Round 3, seus checks/capturas, o delta de código e todos os follow-ups foram lidos separadamente. As instruções AGENTS, o plano funcional, o handoff Intelligence e as fontes dos owners continuam aplicáveis. Nenhuma alteração foi feita no repositório pai ordax-apps.

**Documentação desatualizada encontrada:** coverage.md descreve o snapshot da entrega inicial, não os três follow-ups. meridian-navigation/README.md e quick-check.json registram 20 checks e a ausência de Central na sidebar; db7b4a1 acrescenta Início na Central e o runner atual executa 21 checks. O texto histórico de maximização cobre 1440/820/390, não a matriz final solicitada de seis tamanhos. Esses registros não foram reescritos nem apresentados como prova do HEAD final.

## Central, Desktop e inventário de destinos

O [inventário da sidebar](sidebar.md) registra nome acessível, tooltip, estado e ação por apresentação. O catálogo sections continua sendo único; navigationSections somente filtra a apresentação. windowTarget resolve metadados do catálogo existente, sem outro app registry ou aplicativo instalado.

Na Central, os destinos navegam entre páginas, com título de localização, foco em main e aria-current=page nos itens de navegação selecionados. Início retorna à home; não alterna a apresentação. Arquivos, Conversas, Automações, Continuidade e Ajustes também foram percorridos, usando busca/menu quando não têm item principal. Conta abre a jornada de identidade existente. Marca e Início são entradas de home da Central; não existe marca acionável nem Início de página na sidebar Desktop.

No Desktop, os mesmos destinos abrem/reutilizam janelas de demonstração: Intelligence/Arquivos usam seus IDs existentes; outras seções usam section:<id> e o renderer de página já existente. A sidebar não altera o route guardado da Central. Repetir destino não duplica janela; restaurar pelo dock conserva conteúdo. O estado corrente de janela usa aria-current=true, sem chamar essa janela de página Central.

O launcher e a busca ainda incluíam route:central no HEAD inicial, apesar de a sidebar tê-lo removido. A correção usa a mesma projeção de destinos nesses acessos e bloqueia navegação de página Central enquanto Desktop estiver ativo. A alternância explícita continua no rodapé e dentro do menu modal; o fundo fica inerte quando o menu está aberto. No mobile, Início existe no menu/busca da Central e o alternador permanece acessível no Desktop.

Back/forward de páginas não é implementado: a navegação local não faz pushState nem oferece histórico de rotas. O parâmetro surface escolhe apenas a entrada; não é sincronizado após cada alternância. Trocar apresentação é estado da prévia, não uma alteração do modo de produto. O botão preexistente Seus projetos no wallpaper ainda conduz à perspectiva de trabalho da Central; é uma affordance fora da sidebar cuja clareza de destino deve ser refinada. Não foi criada uma jornada de projetos nesta auditoria.

## Topbar, taskbar, dock e system tray

Desktop efetivamente não renderiza header/topbar: main começa em y=0 e a grade tem duas linhas, conteúdo e taskbar. Central renderiza header e mantém três linhas. Não existe elemento escondido reservando a faixa antiga, margem negativa compensatória ou offset de topo.

Um renderer taskbar atende ambas as apresentações. União de atalhos editoriais do Space e janelas abertas não duplica IDs. Fixado não tem marcador de execução; aberto tem ponto; ativo tem contorno/traço e estado corrente; minimizado tem marcador vazado. Nome AX/title incluem o estado. Com muitas janelas, a barra e o dock foram medidos nos seis tamanhos. O dock estreito usa rolagem interna; sua operação por toque real permanece não homologada.

Launcher e busca estão no rodapé Desktop; Central mantém busca no header e Ctrl/Meta+K em todas as larguras. Escape e retorno ao foco de origem foram verificados, com 12 Tabs por atalho/material de apresentação no recorte. O menu mobile preserva acesso às áreas e à conta.

A bandeja oferece rede, bateria, horário ilustrativo, notificações e ajustes rápidos; em telas pequenas, detalhes/áudio/Intelligence ficam no menu/painel Sistema. Contagem de não lidas deriva do mesmo estado isolado de notificações. Battery/time/volume/devices permanecem fixtures; nomes acessíveis e o marcador Estudo deixam essa natureza explícita. Nenhuma telemetria foi adicionada.

## Janelas: maximização, restauração e foco

Maximizar ocupa exatamente a região md-desktop-primary, sem inset, borda, raio ou sombra externa. Sidebar e taskbar ficam fora dela. O painel compacto conserva sua divisão explícita; maximizar não o sobrepõe. Com esse painel aberto, por exemplo, 1440×900 tem região principal de 1368×492 a partir de x=72,y=0. Na paisagem 844×390 ela fica em 772×152,41: é uma região pequena, porém com conteúdo rolável e sem sobreposição. Isso não representa suporte a múltiplos monitores ou gerenciador de janelas de produção.

A matriz mede as quatro bordas, clipping horizontal, ausência de gap/topbar e exclusão de compact/taskbar em 1440×900, 1024×768, 768×600, 844×390, 390×844 e 320×568, nos dois materiais. Até 600 px a sidebar some; a janela flutuante usa a política adaptativa de inset do layout estreito, e compactas usam seleção de um app por vez. Não se impuseram coordenadas desktop ao layout mobile.

Floating → maximizar → restaurar → minimizar → restaurar → maximizar preservou rascunho e geometria no recorte. Lock/unlock, Central/Desktop e A/B/A preservaram as janelas do contexto. O botão maximizado agora se chama Restaurar e usa glyph de restauração distinto; Maximizar continua sendo uma ação de janela. Nenhuma API requestFullscreen é chamada e nenhuma capability fullscreen de app foi inventada. Os stage/fullscreen editoriais de OOBE/Recovery são outra representação, não fullscreen de mídia ou do navegador.

A abertura/restauração agora focaliza o título da janela; minimizar/fechar transfere foco para outra janela, o dock ou main. Selecionar uma compacta atualiza foco e app ativo. Focar conteúdo de um app atualiza sua projeção ativa sem substituir o DOM do app durante focusin: sidebar e taskbar são reconstruídas com os renderers existentes, e a classe do frame é atualizada. Isso evita destruir o alvo antes de click/input. Não foi substituído o lifecycle canônico nem reescrito o controller.

Capturas finais: [Desktop Argila 1440](captures/desktop-many-paper-1440.png), [Desktop Grafite 320](captures/desktop-many-ink-320.png) e [paisagem 844](captures/desktop-many-paper-844.png). A [matriz independente](independent-checks.json) preserva geometria, inventário e nomes AX; a [matriz de jornadas](journey-checks.json) preserva seus 392 resultados.

## Intelligence, identidade, Space e combinações

foregroundWindow é um seletor transitório de apresentação usado por sidebar, dock e contexto. Ele exclui janelas minimizadas, compactas recolhidas e qualquer janela guardada enquanto Central é a apresentação atual. A seleção de compacta e o foco de edição deixam de anunciar Arquivos quando Notas/Briefing é o trabalho corrente. O documento é procurado apenas na projeção de arquivos do Space atual.

Abrir uma proposta usa a jornada existente e suas confirmações; contexto selecionado não concede leitura, grant ou aprovação permanente. Nenhum arquivo real é lido, nenhum modelo é chamado e não há ingestão em Memory. Trocar Space invalida aprovações e contexto conforme as correções Round 2 preservadas.

A matriz anterior foi repetida no HEAD real: Lia/visitante/expiração/reentrada; rascunhos, projetos, preferências/notificações e mensagens; A/B/A e Space revogado/ausente com retorno explícito; fonte revogada, recibo removido, nova pergunta e revisão de aceite. A mudança de apresentação conserva Space, janela e rascunho; não constitui troca de identidade.

Estados combinados da Round 3 foram repetidos pelo smoke: offline+visitante, offline+update, update+texto pendente, Space indisponível+trabalho, conta expirada+trabalho local, armazenamento cheio+gravação e dispositivo offline+janela. A prova independente acrescenta janela maximizada+device offline+navegação Desktop+Space A/B/A, além de duas compactas/seleção/recolhimento. Nenhum sucesso real de gravação/comando é inferido.

Todos os fixtures continuam disponíveis no JavaScript enviado ao navegador. Separar projeções, sessões e texto digitado é coerência da demonstração, não proteção de dados reais. Exemplos de Studio/Editor/Internet e recibos fixos continuam editoriais; isso impede integração direta.

## Regressões, origem e correções

| ID / prioridade | Problema comprovado | Origem e correção objetiva |
|---|---|---|
| R3-01 P2 | Onze destinos Desktop abriam janela, mas foco ficava no controle de navegação/body; restaurar/minimizar também falhava. | Lacuna preexistente em openApp, exposta pelos novos destinos em janela. Foco explícito no destino e fallback após minimizar/fechar. |
| R3-02 P2 | Launcher/busca mantinham Central como página e podiam mudar apresentação implicitamente. | Follow-up 6b0ca07 havia corrigido a sidebar, não todos os acessos. Projeção única de destinos e guard Desktop; Início rotulado na Central. |
| R3-03 P2 | Sidebar Desktop marcava janela como aria-current=page. | navItem foi reutilizado com semântica Central. Agora distingue página da Central e janela corrente. |
| R3-04 P2 | Maximizada anunciava Janela flutuante com o mesmo ícone de maximizar. | Semântica antiga ficou incompatível com a decisão explícita de restore. Nome Restaurar e glyph correspondente, sem fullscreen. |
| R3-05 P1 de coerência | Intelligence anunciava app/documento oculto após recolher compacta ou alternar à Central; selecionar compacta não mudava activeWindow. | Presença contextual nova consumia estado de janela guardada. Seletor de foreground compartilhado e seleção/foco da compacta corrigidos. Não é vazamento de arquivo real. |
| R3-06 P2 | Editar Notas compactas ao lado de Arquivos deixava barra/contexto indicando Arquivos. | Modelo antigo só ativava app por comando/título. focusin atualiza estado e chrome conservando o subtree de edição. Prova instrumentada registra o evento e o estado correto. |

Não foi encontrada regressão geométrica em a251578: a nova matriz confirmou sua política, sem alterar CSS. Também não houve regressão nas confirmações/receipts da Round 2. Riscos preexistentes não foram ocultados para justificar C.

## Gates, snapshots e limites

Os comandos, exits, snapshots, hashes e resultados por fase estão em [validacoes.json](validacoes.json), com logs compactos versionados em logs/. Saída integral/host e arquivos intermediários permanecem em out/meridian-round3-audit no checkout. Contagens se sobrepõem e não devem ser somadas como testes únicos.

| Gate | Resultado | Snapshot / limite |
|---|---|---|
| Sintaxe ESM | PASS | 25 módulos no HEAD inicial; 26 com runner independente no código final |
| Whitespace | PASS | Delta inicial, final e staged checks; avisos de normalização LF/CRLF preservados |
| Module boundaries | PASS | Baseline e código final |
| Source graph Web | PASS | 128 arquivos; experimento não entra na composição canônica |
| Testes determinísticos Meridian | PASS | 4/4 em db7b4a1; seus inputs não mudaram depois |
| Smoke Round 1/Meridian | PASS | 155/155 no HEAD inicial e final |
| Smoke Round 2 | PASS | 23/23 no HEAD inicial e final |
| Smoke Round 3 | PASS | 27/27 no HEAD inicial e final |
| Smoke follow-up navegação | PASS | 21/21 no HEAD inicial e final; evidencia a diferença da documentação histórica |
| Matriz de jornadas Round 2 | PASS | 392/392 no HEAD inicial e final; 180 telas, 29 confirmações, 64 geometrias |
| Matriz independente Round 3 | PASS final; FAILs anteriores preservados | 287/287 no código 2b609ed; 12 geometrias Desktop, Central nas mesmas dimensões/materiais, navegação, foco, AX e combinações |
| Recorte de foreground | PASS após diagnóstico de foco | 5/5; evento focusin real, app ativo/documento e ausência de erros/request externo |
| Build/typecheck/verify/repetibilidade | NOT RUN | Inputs canônicos/locks/import graph inalterados; não se atribui PASS novo ao build anterior |
| Foundation completa | NOT RUN; FAIL histórico | Incompatibilidades POSIX/Windows fora do delta; exige ambiente adequado |
| Chromium Web canônico | NOT RUN; FAIL histórico indeterminado | Timeout ready anterior permanece aberto; matriz Meridian não o resolve |
| Contracts JSON / Node canônico tema/localização/workspace | NOT RUN | Inputs inalterados; PASS da Round 2 permanece somente histórico |
| Supply chain/workflow | N/A | Nenhuma alteração de dependency/lock/workflow |
| Lint dedicado | N/A | Sem script aplicável dedicado |
| Browser integrado / leitor de tela / zoom completo / hardware / CI remoto | NOT RUN | Não homologados; nenhuma afirmação de release/boot USB |


A primeira prova independente teve erros de escaping de expressões e caminho mobile no harness: 120 PASS/16 FAIL, sem classificação de produto para esses erros. A segunda teve 235 PASS/32 FAIL: 20 assertivas objetivas e 12 acessos inadequados do roteiro em breakpoints. Eles foram corrigidos sem remover assertivas. As fases permanecem nos JSON/logs.

O recorte de foco posterior inicialmente mudou activeElement sem emitir focusin na página headless inativa, inclusive após a correção do handler. O diagnóstico preserva zero eventos; habilitar Emulation.setFocusEmulationEnabled no perfil descartável passou a produzir o evento real e o recorte passou 5/5. Não foram sintetizados eventos para forçar estado de produto. A matriz final afirma document.hasFocus para medir esse comportamento. As assertivas de app/documento continuam as mesmas.

Não houve subagentes. Gates de browser foram sequenciais, com logs/exits, enquanto leitura estática/documentação avançavam. Correções de produto ocorreram depois dos resultados de cada fase; os gates finais usam hashes fixados e nenhum input foi alterado durante sua execução. A aba pessoal e o servidor 4203 foram preservados; runners que iniciam host próprio usam porta aleatória e encerram apenas seus processos. Processos de Chromium descartáveis exigiram execução fora do sandbox de processos, que historicamente impede GPU/DevTools neste host. A automação do browser integrado não foi usada nesta rodada.

## Acessibilidade, materiais e riscos restantes

Controles examinados têm nomes AX; Início e alternador possuem nomes/destinos distintos. Diálogos contêm Tab; busca focaliza campo e devolve foco; maximizar/restaurar têm nome distinto; app ativo/minimizado não depende apenas de cor. O token de focus-visible e reduced motion permanecem e o smoke anterior confirma movimento reduzido. O inventário registra a ausência de title nativo nos controles Space/Conta preexistentes; ambos têm nome AX, mas a orientação por ponteiro pode melhorar no próximo refinamento.

Argila/Grafite compartilham renderers, navegação, callbacks e geometria. A diferença permanece nos tokens. Não há lógica de janela/contexto por material; Claro, Escuro e OrdaX USB canônicos não têm diff. Esta auditoria não mudou paletas, fontes, wallpaper, escala tipográfica ou direção artística. Texto secundário de bandeja/Estudo permanece em 10–12 px e merece avaliação com zoom/toque. Não foi feita certificação de contraste/WCAG de toda a interface, teste com leitor de tela real, zoom 200%/400%, forced-colors ou hardware físico.

Owners/contratos preservados: workspace/presentation e lifecycle de Workspace; identity-session/account-lifecycle/local-session; spaces/space-selection; Files e catálogo/manifests do owner Apps; notifications; device capabilities/Device Host; Intelligence/router/Memory/Action Gateway; app-store/app-activation; Supervisor/update/recovery. O delta não modifica essas fontes, locks, manifests, CI ou composição de produção. Module boundaries e grafo Web confirmam isolamento do experimento.

Busca estática e prova de rede não encontraram fetch/WebSocket/EventSource/storage persistente/IPC/filesystem/auth/serviço/device access nos renderers. CSP connect-src none e form-action none, loopback e allowlist permanecem. Host/runners usam filesystem/subprocessos/HTTP como infraestrutura conhecida; isso não é execução pelo produto. Não há novo router, workspace, autoridade de instalação, registro de apps ou backend.

O controller continua reconstruindo DOM em muitos eventos, com branches de route/journey/window/session. A correção focal conserva o subtree durante focusin, porém não o torna runtime final. Histórico de rotas, scroll/seleção de todo par de janelas, todos os estados combinados e todas as entradas de teclado continuam sem homologação completa. Também permanecem copy editorial fixo, ausência de contratos projetados/fixtures validadas, grants reais e gates canônicos pendentes. Antes de integrar, reutilizar lifecycle/reconciliação dos owners e provar projeções fail-closed; não substituir a fonte de demonstração por API diretamente.

## Inventário, fluxos e próximo critério

O [inventário anterior de 196 itens](../meridian-round2-audit-2026-10-13/inventario.md) e os [14 fluxos](../meridian-round2-audit-2026-10-13/fluxos.md) continuam referências; esta rodada não os converte em itens de MVP concluídos. M-023/contexto, M-039/dock, M-040/janelas, M-046/busca e M-052/contexto de IA ganham provas de apresentação; janelas/contexto ainda têm lacunas de integração. Nenhum item fica pronto para adapter. A navegação por apresentação aprofunda fluxos existentes, sem acrescentar um domínio ou fluxo artificial.

**Próxima etapa recomendada:** o outro chat pode continuar refinamento visual sobre esta base corrigida, usando esta evidência final e o inventário/fluxos existentes. Priorizar clareza de destinos fora da sidebar, orientação de Conta/Space no rail, densidade/scroll do painel compacto em paisagem e operação do dock por toque. Preservar os smokes, o seletor de foreground, Início da Central e o guard da navegação Desktop. Nenhuma dessas recomendações aprova integração ou concede autoridade aos mocks. Para integração continuam obrigatórios os contratos/projeções canônicos, lifecycle real, autorização e gates pendentes.

**Integridade final:** main local no SHA inicial, commits legítimos e evidências anteriores preservados; sem merge, push, reset, publicação ou operação real sobre serviços, arquivos do usuário, dispositivos ou USB.
