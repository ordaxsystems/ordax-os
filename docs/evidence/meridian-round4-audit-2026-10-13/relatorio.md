# Auditoria independente Meridian Round 4 — 13/10/2026

**Parecer final: C — aprovada para congelamento/refinamento final.** Escopo: auditoria do HEAD real, correções de bugs reproduzidos e prova independente. A Round 4 melhora orientação, dock e chrome sem ampliar domínio. Cinco defeitos objetivos foram encontrados e corrigidos; a prova final passou com 368 checks, mais o diagnóstico nativo de 37 checks. Não houve Round 5.

A linguagem pode ter sua direção visual congelada depois desses reparos: materiais Argila/Grafite, composição Central/Desktop, hierarquia, rail, dock e linguagem de foreground. Congelar a direção não substitui validação de acessibilidade, toque físico, lifecycle ou integração.

## Identidade e rastreabilidade

- Checkout: C:/Users/TONECOS/Documents/github/ordax-apps/tools/assistant-host/.data/os-meridian-lab; repositório ordaxsystems/ordax-os, branch codex/meridian-design-lab.
- HEAD efetivamente recebido: **ebd58cdb83278d194313c5f215dea2788b5fde05**; árvore inicialmente limpa. [Snapshot com hashes](snapshot-before.json).
- Base Round 4: **771cb98c3de077dac0b63197ff9198ca0220ee8b**.
- Cadeia linear: 771cb98 → **11bee9e7ba9a3c496e9b5f607dfea2d795e1fca0** (implementação) → **8d48d019c3c0d6eeac1876c8d1e0f85d14b84eec** (documentação/capturas) → **ebd58cdb83278d194313c5f215dea2788b5fde05** (preservação de logs). [Cadeia](round4-chain.txt).
- **2b609edae1fca0db56b4de05f76d1bb822245ebe** continua ancestral. Evidências R1/R2/R3 e do autor R4 preservadas, sem reescrita.
- Delta recebido: **44 arquivos, 1.376 inserções, 210 remoções**; 11 arquivos do experimento, runner R4/README e documentação com 24 capturas. [Lista](round4-delta-paths.txt), [estatística](round4-delta-stat.txt).
- Main permaneceu **fafed4a8916587ad35bc07c2f3baa1a60d561b1e**. Não houve checkout/reset/rebase/push/merge ou alteração de main.
- Alterações da auditoria: somente interactions.mjs, duas chamadas de cleanup no controller, novo runner independente e documentação/evidência. Commit de código: 44d2ef0cc6ae8d0c0573e754d300e316c46dff84. O commit documental que contém este relatório aparece no histórico final da branch.
- Modificações alheias em ordax-apps foram preservadas: web-bridge.mjs, web-bridge.test.mjs e docs/evidence/. Nenhum produto Apps foi polido nesta auditoria; o escopo autorizado é o estudo isolado do OS.

## Achados e correções

| Defeito comprovado | Reprodução | Menor correção aplicada |
|---|---|---|
| Dois mecanismos de tooltip | Title nativo coexistia com o hint comum de rail/taskbar; 16 verificações falharam no baseline. | O helper retira title somente dos alvos que gerencia; nomes AX/data-tooltip e títulos fora desse escopo permanecem. |
| Escape não dispensava orientação | Hover e foco em Conta/Space/Intelligence/Dispositivos, Central/Desktop, dois materiais. | Listener com signal no document permite dispensar também quando o foco ainda é body; não move foco e mantém a dispensa dentro do mesmo alvo até saída. |
| Observer retinha dock removido | Lock e recovery em tela dedicada deixavam um alvo desconectado; quatro apresentações/materiais. | Refresh após as duas substituições de stage, cancelando frame e desconectando observer; destroy aborta listeners e libera referências. |
| App ativo desaparecia após resize | 1440→320: dock x=100..224,875; app ativo x=512..556. | Resize revela o app focado no dock ou o app ativo, sem selecionar app nem mudar foreground. |
| Snap de toque sobrepunha Home | Diagnóstico nativo: foco no primeiro app, scroll inicial 0 e posterior 122 px em 320, nos dois materiais. | Navegação por teclado mantém seu alvo visível durante a inércia e suspende snap até pointer/wheel/saída de foco; refresh/abort liberam a referência. O próximo gesto mantém a rolagem nativa. Sem timers de domínio. |

O primeiro ajuste de Escape só cobria eventos dentro do root. O teste de hover com foco no body mostrou a cobertura faltante; ela foi corrigida antes da prova final. O diagnóstico de snap permaneceu inalterado entre reprodução e validação.

## Os 44 itens pedidos

| Nº | Item | Resultado / evidência |
|---|---|---|
| 1 | Branch | codex/meridian-design-lab, conferida diretamente no checkout local. |
| 2 | HEAD auditado | ebd58cdb83278d194313c5f215dea2788b5fde05; não se voltou ao snapshot do commit principal informado. |
| 3 | Base Round 4 | 771cb98c3de077dac0b63197ff9198ca0220ee8b. |
| 4 | Commits recebidos | 11bee9e → 8d48d01 → ebd58cd, sem perda da correção R3 2b609ed. |
| 5 | Working tree | Limpa no início. Ao final, correções/evidências locais versionadas e árvore limpa; out/ permanece saída ignorada. Árvore do pai com mudanças alheias preservada. |
| 6 | Diff | Apenas experimento opt-in, teste e evidência. Não mudaram contratos, manifests, locks, adapters, paletas de produção ou CI. |
| 7 | Sidebar | Mesmos destinos e ações auditados em R3; todos os alvos visíveis compartilham orientação e nome. Início é exclusivo da Central. [Inventário final](sidebar.md). |
| 8 | Conta | Nome Conta e identidade, avatar, foco/hover/hint comum; abre a jornada de identidade existente. Alvo alcançável no rail de 844×390; menu/topbar dão acesso quando a sidebar some no mobile. |
| 9 | Space | Nome Trocar Space, atual: <nome>, glyph atual e panel:spaces. Seleção mantém revisão de impacto canônica da demonstração; estado/namespace e decisões R2/R3 preservados. |
| 10 | Seus projetos | Texto Seus projetos + na Central, folder + glyph Central e nome AX Seus projetos · abrir na Central. Usa tab:work existente; Space preservado e retorno via alternador. Nenhuma jornada nova. |
| 11 | Dock touch | Alvos nominais 44×44, gap 6 px, pan-x nativo; CDP dispatchTouchEvent nos recortes estreitos. Aceite físico permanece pendente. |
| 12 | Dock overflow | Uma região interna overflow-x:auto, wrapper sem scroll; cues none/start/end/both concordam com a posição. Rolagem horizontal/vertical da página permanece zero no gesto testado. Resize e disputa touch→Home corrigidos. |
| 13 | Estados do dock | Fixado/Aberto/Ativo/Minimizado entram nos nomes e marcadores de forma (ponto, traço, contorno). Foreground visível determina Ativo. Central e compacta recolhida não anunciam app oculto. |
| 14 | Painel compacto | 156 px em 844×390, medidos nos dois materiais. Maximizada termina na região útil; painel/taskbar reservados. Texto editável prioritário; Guardar alcançável por foco nativo com scroll. Recolher devolve >100 px. Dois headers seguem densos, mas não bloquearam o acesso. |
| 15 | Window chrome | Título 12 px, faixa/contorno/peso de foreground e controles coerentes com o dock. Borda e sombra variam por material, sem lógica paralela. Controles em paisagem têm a política existente ≥36×40; regra 44×44 aplicada ao dock. |
| 16 | Maximize/restore | Quatro bordas iguais a md-desktop-primary em 12 combinações; radius externo 0 e ausência de fullscreen. R3 e R4 exercitam floating→maximizar→restaurar→minimizar→restaurar, com posição/modo/rascunho/foco. Mobile respeita adaptação existente. |
| 17 | Foreground | foregroundWindow continua SSOT de apresentação em dock, chrome e Intelligence contextual. Notes, Files, compacta, minimizada, Central e troca de Space exercitados pelas matrizes R3/journeys. |
| 18 | Foco | Abrir/restaurar/minimizar/fechar, compacta, edição, launcher/busca/sidebar/Conta/Space/tray cobertos nos gates preservados. Focusin altera chrome/sidebar/taskbar, preservando o subtree do app e a edição nativa. Helpers de tooltip/scroll não mudam foreground. |
| 19 | Central | Home mantém aria-current=page; páginas continuam páginas, topbar preservada. Refinamentos de espaçamento/faixa operacional não criaram affordances de Desktop. |
| 20 | Central↔Desktop | Alternador comum usa presentationDestination; menu/taskbar nomeiam Área de trabalho ou Voltar à Central. Rascunhos, janelas, Space, sessão e contexto preservados. Início permanece home, inclusive após navegar a outra página. |
| 21 | Tray | Rede/bateria/horário/avisos/quick settings permanecem fixtures explicitamente de exemplo. Expansão, nomes e diálogo dentro dos seis viewports verificados; sem telemetria comprovada. |
| 22 | Intelligence | Sob demanda, deriva Space e app foreground/documento válido do estudo e usa proposta/revisão existente. Nenhum modelo, leitura real de arquivo, Memory, grant ou Action Gateway foi acrescentado. |
| 23 | Tooltips | Um hint por shell, clamp na viewport, hover/foco, Escape, saída e exclusão em dialog/repaint. Titles concorrentes removidos apenas no escopo gerenciado. Contagem, posicionamento, alvo descendente e baixo rail medidos. |
| 24 | Motion | Entry somente para janela nova; resize somente para mudança de modo. Repaint comum não reinicia animação. Reduced motion suprime entry/transições. Minimize/close permanecem imediatos. |
| 25 | Tipografia | Computados: Estudo 12, tooltip 12, título 12 e exemplo do horário 11 px. 30 amostras visíveis, contraste mínimo 4,86:1; tooltip 11,34:1 Argila / 13,51:1 Grafite. [Método/valores](contrast.json). Não é certificação integral. Sem aumento automático de fonte. |
| 26 | Argila/Grafite | Mesmos módulos, callbacks, estados e matriz. Só tokens materiais diferem; não há branching de domínio por material. |
| 27 | Responsividade | 1440×900, 1024×768, 768×600, 844×390, 390×844 e 320×568, cada um nos dois materiais. Dock cheio, maximizada+compacta, Central, tray e rail; recortes de tooltip onde o rail é visível. |
| 28 | Acessibilidade | Nomes AX para controles, current de página, estados do dock, foco/teclado, Escape, scroll e reduced motion verificados. Não houve teste com leitor de tela, toque físico ou certificação de toda a interface/contraste/zoom. |
| 29 | interactions.mjs | Responsabilidade restrita a hints, posição/overflow do dock e feedback de motion. Metadata do root delimita scroll da apresentação; não consome source/domínio nem concede autoridade. Um observer por mount, 18 listeners com signal estáveis após 24 repaints; lock/stage deixam zero targets; destroy deixa zero targets/listeners/frames, nos quatro recortes. |
| 30 | Controller | Duas chamadas refresh antes do return de lock/stage corrigem retenção; nenhuma reescrita. Capture/apply/refresh seguem pontos existentes. Repaint amplo ainda é limite do protótipo. |
| 31 | Isolamento | Busca estática sem fetch/WebSocket/EventSource/sendBeacon/storage/IndexedDB/fs/subprocess/auth/device APIs/IPC/fullscreen/endpoints de produção no renderer. XML namespace dos SVGs é referência de formato. Host/runner usam filesystem/process/loopback só como infraestrutura descartável. |
| 32 | SSOT | foregroundWindow, currentContext, navigationSections e presentationDestination existentes preservados. Não surgiu router, registry, manager de domínio ou persistência. |
| 33 | Owners | Identity/Account, Spaces, Workspace, Files/Apps, Intelligence/Memory/router, Action Gateway, Device Host, Store e Supervisor permanecem nos owners/contratos anteriores. Nenhum novo adapter ou contrato. |
| 34 | Gates | Ver tabela abaixo. Gates antigos não foram alterados para obter PASS. Build/CI/Foundation/canônico Web têm estado separado. |
| 35 | Falhas | Todas preservadas: falhas do autor, baseline independente, roteiro, Escape parcial, Home/snap e comandos incorretos. Nenhuma tentativa FAIL é transformada retroativamente em PASS. |
| 36 | Correções | Cinco bugs reproduzidos na tabela de achados; nenhum redesign, expansão, backend ou fullscreen. |
| 37 | Commits da auditoria | Código/runner: 44d2ef0cc6ae8d0c0573e754d300e316c46dff84; evidência/documentação em commit posterior, consultável no histórico local. Sem envio ao GitHub. |
| 38 | Riscos | Toque físico/leitor de tela, densidade em landscape/mobile, zoom/large text e lifecycle canônico ainda exigem aceite. Repaint amplo e fixtures continuam limites arquiteturais. Foundation/Web canônico seguem pendentes. |
| 39 | Classificação | C — aprovada para congelamento/refinamento final. O HEAD recebido exigia correções. A árvore corrigida passou; não satisfaz os gates para D. |
| 40 | Maturidade visual | Direção consistente e suficientemente estável para congelar materiais/composição/hierarquia e parar rodadas de redesign do shell; refinamento final deve responder a defeitos/aceite medidos. Não congelar todo pixel antes de aceite de dispositivos e acessibilidade. |
| 41 | Maturidade arquitetural | Boa disciplina no estudo isolado: owners/SSOT preservados e helper sem autoridade nova. Controller e source de demonstração continuam protótipo; lifecycle canônico e projeção de contratos não foram aprovados por esta prova. |
| 42 | Maturidade para integração | Insuficiente para D, merge ou produção. Faltam gates canônicos aplicáveis, adapters/grants/lifecycle reais e provas de plataforma/hardware. |
| 43 | Próxima recomendação | Congelar direção visual e registrar recortes/estados de referência. Fechar somente pendências objetivas de acessibilidade/toque/lifecycle; eventual integração deve ter plano separado, owners e critérios de aceite, antes de trocar fixtures por capacidades reais. Não iniciar Round 5. |
| 44 | Main intacta | fafed4a8916587ad35bc07c2f3baa1a60d561b1e no início e ao final; nenhum push, merge ou ativação. |

## Gates e limites

| Gate | HEAD recebido / baseline | Árvore corrigida / estágio comprovado |
|---|---|---|
| Syntax | [PASS](baseline-syntax.log), exit 0 | [PASS](verified-syntax.log), exit 0; 29 modules after correction |
| Whitespace source | [PASS](baseline-whitespace.log), exit 0 | [PASS](verified-whitespace.log), exit 0; PASS |
| Module boundaries | [PASS](baseline-boundaries.log), exit 0 | [PASS](verified-boundaries.log), exit 0; PASS |
| Canonical source graph | [PASS](baseline-source-graph.log), exit 0 | [PASS](final-source-graph.log), exit 0; 128 files, unchanged imports/inputs after scroll fix |
| Storyboard unit | [PASS](baseline-unit.log), exit 0 | [PASS](final-unit.log), exit 0; 4 checks; unaffected by final scroll change |
| Smoke Round 1 | [PASS](baseline-meridian.log), exit 0 | [PASS](final-meridian.log), exit 0; 155 checks after first corrections |
| Smoke Round 2 | [PASS](baseline-round2.log), exit 0 | [PASS](final-round2.log), exit 0; 23 checks after first corrections |
| Smoke Round 3 | [PASS](baseline-round3.log), exit 0 | [PASS](final-round3.log), exit 0; 27 checks after first corrections |
| Navigation | [PASS](baseline-navigation.log), exit 0 | [PASS](final-navigation.log), exit 0; 21 checks after first corrections |
| Smoke Round 4 | [PASS](baseline-round4.log), exit 0 | [PASS](verified-round4.log), exit 0; 81 checks after final inertia fix |
| Independent Round 3 | [PASS](baseline-independent3.log), exit 0 | [PASS](verified-independent3.log), exit 0; 287 checks after final inertia fix |
| Independent Round 4 | [FAIL](baseline-diagnostic.log), exit 1 | [PASS](verified-independent4.log), exit 0; 368 checks / 12 geometries after final fix |
| Native touch→Home diagnostic | [FAIL](dock-key-diagnostic.log), exit 1 | [PASS](dock-key-corrected3.log), exit 0; 37 checks / 18 cases, unchanged diagnostic |

Todos os logs/exit e resultados JSON foram preservados, incluindo os estágios intermediários. [Gates estruturados](gates.json). A correção final de inércia é específica do dock; depois dela foram repetidos a matriz R4 completa, o smoke R4 e a matriz independente R3. Os quatro smokes de navegação/jornadas anteriores, source graph e unit permaneceram PASS no estágio anterior, sem alteração causal de seus contratos/inputs. Não se repetiram gates pesados sem causa.

O gate de source graph canônico examina 128 inputs e não alcança arquivos Meridian alterados: [interseção vazia](build-scope.json). Build canônico **NOT RUN**; não se promove build histórico a PASS atual. Fundação completa Windows e smoke Web canônico **NOT RUN**, porque o delta não altera seus inputs. Permanecem as falhas históricas de Foundation/POSIX no Windows e o timeout ready do Web canônico; nenhuma matriz Meridian os resolve. CI, assinatura, release e USB/hardware **NOT RUN**.

A matriz journeys foi executada no HEAD recebido: **392 checks / 180 telas visitadas / 29 barreiras de confirmação / 64 geometrias**, PASS. As correções só tratam feedback visual/scroll/cleanup; transitions, consentimento, namespace, grants simulados e fields de jornadas não foram alterados. Não se repetiu a matriz pesada sem nova causa. A prova final mede lock, recovery em stage, retorno, repaint e destroy diretamente.

## Falhas preservadas e método

- Autor R4: attempt-2 falhou no roteiro de busca/calendário; attempt-3 registrou timeout de ready. Os logs continuam em ../meridian-round4/. O timeout do autor não recebe causa presumida nem confunde o timeout Web canônico.
- Baseline independente inicial: 276 checks, 221 PASS / 55 FAIL. Inclui 48 falhas de tooltip, quatro erros da instrumentação por sintaxe da IIFE, duas verificações inadequadas de Guardar no fim da rolagem e um check de exceções disparado pela própria injeção.
- Baseline resources: 166 checks, 110 PASS / 56 FAIL: 48 tooltip, quatro observer lock e quatro erros de roteiro por tentar abrir recovery sem passar por System. A origem do erro foi corrigida no runner; não no produto.
- Diagnóstico corrigido antes de alterar o produto: 172 checks, 114 PASS / 58 FAIL. São 48 tooltip, oito observações retidas lock/stage e dois resize. Sem erro de caso/uncaught, com destroy passando.
- Primeiro reparo focado: 204 checks, 194 PASS / 10 FAIL. Oito revelam Escape fora do root, dois são uma expressão mal escapada da nova asserção de projetos. Ambos foram corrigidos com causas separadas.
- Primeira matriz completa corrigida: 360 checks, 359 PASS / 1 FAIL (Home 390/Grafite). Isso desencadeou investigação; não se descartou a falha como flakiness.
- Diagnóstico de snap: 37 checks, 34 PASS / 3 FAIL; Home imediato estava correto, mas scroll posterior era 122 px. [Dados](dock-key-diagnostic/checks.json). O mesmo roteiro valida a correção final: **37 PASS / 0 FAIL**. [Prova corrigida](dock-key-corrected3/checks.json).
- Tentativa de corrigir apenas snap: 37 checks, 29 PASS / 8 FAIL; a inércia nativa continuava a sobrepor a posição. A correção final trata a intenção de scroll do alvo com foco, sem alterar foreground.
- Prova seguinte interrompida por ENOSPC: exit 1 de infraestrutura ao gravar checks.json, que ficou vazio; nenhum PASS foi inferido. Removidos apenas 200 PNGs regeneráveis desta própria saída out/, liberando 30.214.154 bytes. Logs, resultados, source, histórico e quatro capturas relevantes intermediárias preservados. [Incidente](storage-incident.json).
- Comandos auxiliares mal invocados: module-boundaries com caminho inexistente (exit 2); source_graph.py sem entrypoint/main devolveu exit 0 e nenhum check. Logs separados, sem validade de gate. Comandos corretos foram executados depois.
- Scripts de fases preservados são snapshots de diagnóstico, com imports relativos ao local original em out/. Runner reproduzível mantido em tools/meridian-preview/round4-audit-smoke.mjs. Os antigos smokes/journeys não foram enfraquecidos.

Os runners usam o Chromium descartável compartilhado. O host independente escuta só em loopback e porta efêmera, encerrado pelo próprio runner. O host existente em 4203 usado pelos smokes foi mantido; navegador do usuário não foi manipulado. Não houve contato com endpoints externos. Emulação de toque e AX do Chromium medem comportamento do navegador, sem representar aceite físico ou leitor de tela.

[Capturas finais](captures.md), [inventário do rail](sidebar.md), [manifesto de arquivos/hashes](manifest.json) e [snapshot final do source](snapshot-after.json) permitem revisar o resultado. Hashes de texto são dos bytes lidos no working tree Windows; Git pode normalizar finais de linha.
