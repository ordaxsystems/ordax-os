# Auditoria independente — Meridian Round 2

**Classificação: C — aprovada para Round 3 visual.** A Round 2 amplia a experiência operacional sem conectar uma segunda arquitetura de produção. A auditoria encontrou e corrigiu regressões objetivas de contexto, lifecycle, acessibilidade e carregamento da prévia. A matriz final passou em 392 verificações, incluindo 180 telas, 29 barreiras de confirmação e 64 recortes de geometria. A base permite ao outro chat continuar UI/UX; **não é candidata a integração ou merge**. Os fixtures e as pendências canônicas descritos abaixo continuam limitando essa aprovação.

Data: 13/10/2026. Esta evidência acrescenta uma auditoria; não substitui a [Round 1](../meridian-audit-2026-10-13/relatorio.md), seu [inventário](../meridian-audit-2026-10-13/inventario.md), seus [fluxos](../meridian-audit-2026-10-13/fluxos.md) ou a [entrega do autor da Round 2](../meridian-round2/coverage.md).

## Snapshot, histórico e escopo

| Item | Evidência |
|---|---|
| Repositório / branch | ordaxsystems/ordax-os / `codex/meridian-design-lab` |
| Checkout | C:/Users/TONECOS/Documents/github/ordax-apps/tools/assistant-host/.data/os-meridian-lab |
| HEAD efetivamente auditado | `4dffe5284aaa57310a57195eb1b0a56bb3720c58` |
| Implementação Round 2 | `050539b16d07b94e2a04b655f5116c0dbe588687` |
| Base imediatamente anterior / parent da implementação | `25e0f577d5fbf4f2477c5de6d1f2ccf1321745c2` |
| Baseline histórico da primeira proposta | `69a893701f2f43dee5046f7649ec675facd02e5d`, somente referência |
| Árvore inicial | Limpa; sem alterações legítimas descartadas |
| Delta prioritário | `25e0f57..4dffe52`: 29 arquivos, 1.042 inserções e 81 exclusões, mais capturas |
| Correções desta auditoria | `ae05659fab871595f3305e9fe18a9f9343d07f98` e `15247d1d0622942e0fb45174b1f3a147b08083c3`; isolamento/estado/teclado/contraste, contexto local de projeto e host de prévia |
| Evidência documental | Commit posterior que contém este relatório; não altera o código validado |
| main local inicial e final | `fafed4a8916587ad35bc07c2f3baa1a60d561b1e` |

O delta foi revisto por controller, fonte de demonstração, selectors, storyboards, navigation/view, CSS, views, composição, runners e documentação. Inclui também a fila de aceitação de conexões do servidor estático de prévia. Ele não muda contratos, manifests, locks, serviços, adapters, source graph, build Web, workflow, paletas ou composição de produção. A revisão também percorreu código preexistente de formulários, janelas e painéis, onde as interações com os novos mapas de sessão importam.

Não houve checkout de main, reset, merge, push, force push, publicação, instalação, pairing ou operação física. Os commits legítimos 69a8937 → 25e0f57 → 050539b → 4dffe52 foram preservados. Os diretórios das duas evidências anteriores não têm diff. Não se afirma que a main remota deixou de avançar por trabalho externo.

## Owners, contratos e arquitetura

Owner deste trabalho: **Surface/apresentação experimental**, vinculado à seção Meridian de [DESKTOP-IDENTITY](../../DESKTOP-IDENTITY.md), ao plano funcional existente e ao MVP canônico. Exceção explícita solicitada pelo usuário: auditoria do estudo isolado, sem nova rodada artística ou backend.

| Responsabilidade | Referências consultadas / autoridade preservada |
|---|---|
| Primeiro uso, sessão local e energia | docs/contracts/first-run.json; system/contracts/local-session.mjs e power-actions.mjs |
| Identity/Account | identity-session.mjs, account-lifecycle.mjs, identity-actions/credentials; sessão cloud não substitui sessão local |
| Space/membership/seleção | spaces.mjs, space-selection.mjs; spaces/1 exposto à Surface continua read-only |
| Profile | profile-provisioning.mjs, profile-activation-state.mjs, profile-pack/trust e inventário de componentes |
| Store/App | app-store.mjs, app-activation.mjs; catalog authority:none, gerenciador/trust para lifecycle |
| Intelligence/Memory/ações | INTELLIGENCE-HANDOFF.md; model-router.mjs, action-executor.mjs, grants/Action Gateway existentes |
| Device/Network | device-capabilities.mjs, network-management.mjs, network-transport-v2.mjs; Device Host executa |
| Files/Notificações | recent-files.mjs, notifications.mjs; Files pertence ao owner Apps e notificações ao centro existente |
| Workspace | system/surface/workspace/presentation.mjs e lifecycle canônico |
| USB | physical-prepared-media.json é transitório; portable-usb-v2.json descreve ESP + DATA como alvo, sem autorização física |
| Update/Recovery | update-status.mjs, recovery-status.mjs e UPDATE-NOMENCLATURE.md |

Os nomes abreviados .mjs pertencem a system/contracts/. Os documentos de contexto obrigatório já consultados na auditoria anterior permanecem aplicáveis; as fontes atuais citadas foram comparadas com o delta. Não foram incorporados código externo, dependências, novas APIs ou contratos paralelos.

A composição continua: host estático loopback → main explícito do preview → fonte/roteiros editoriais injetados → controller/renderer → tokens Meridian. O único módulo compartilhado de apresentação continua sendo workspace/presentation. Os mapas de janelas, sessões e percursos são **estado transitório de demonstração**, não Window Manager, Session service ou modelo canônico. O controller ainda substitui a árvore DOM inteira: não é uma base pronta para plugar serviços reais.

## Isolamento: afirmações verificadas e exceções

Busca e leitura do código de experiência/composição não encontraram fetch, WebSocket, EventSource, sendBeacon, persistência em localStorage/sessionStorage/IndexedDB, IPC, subprocessos, filesystem, captura de câmera/microfone/USB, autenticação ou chamadas a adapters reais. Os handlers só alteram memória/DOM. URL escolhe material, apresentação, rota ou jornada; não detecta modo USB nem capacidades do host.

O servidor existente permanece em 127.0.0.1, com allowlist, sem endpoint de escrita; CSP mantém `connect-src 'none'` e `form-action 'none'`, além da política que nega câmera/microfone/geolocalização/USB. O smoke anterior repetiu negativas de paths/API, POST e ausência de tráfego externo. Não houve mudança de CSP.

**Exceções legítimas de escopo:** o host lê os assets locais; os runners usam subprocessos, Chromium descartável, HTTP loopback e escrevem logs/capturas. Isso é infraestrutura de prova, fora do renderer. Não confundir a afirmação “o preview não escreve arquivos do usuário” com “nenhum script do repositório usa filesystem”.

Todos os fixtures continuam presentes no JavaScript entregue ao navegador. Lia, Rafael, nomes de dispositivos, datas, percentuais, códigos, comunidades, versões e recibos são editoriais. Isolar a projeção e os textos digitados corrige a demonstração, mas **não protege dados reais nem comprova autorização**. Os exemplos estáticos de Studio/Editor/Internet e a conversa roteirizada ainda não são projeções integrais do Space. Esse limite impede integração direta.

## Regressões e correções objetivas

| ID / prioridade | Problema e origem | Correção / prova |
|---|---|---|
| R2-01 P1 | Expiração mantinha subject Lia e mudava para personal; rascunho privado reaparecia e texto local podia sobrescrevê-lo na reentrada. Introduzido pela combinação de cloudExpired e mapas Round 2. | Namespace expired-local separado para forms, sessões e jornadas; retorno restaura o rascunho original. Falhou antes, passou depois. |
| R2-02 P1 | Projeto criado sem conta entrava no snapshot global personal e aparecia posteriormente para Lia. Interação nova com create-project preexistente. | Projetos criados na prévia recebem subject de apresentação e são filtrados por subject/Space. Provas visitante → Lia e criação após expiração. O evento também leva o Space efetivamente apresentado, impedindo que o projeto local seja criado no antigo Space cloud do snapshot. |
| R2-03 P1 | Privacidade fictícia era global e passava de Lia para visitante; leitura/filtros/dismiss também exigiam escopo claro. | Preferências e notificações transitórias ficam na sessão correspondente; retirados handlers/valores sem consumidor da fonte. Não são grants. |
| R2-04 P1 | Jornada/aceite anterior podia ser retomado após mudança de contexto; nova pergunta podia reabrir resultado antigo. | Mudança de subject/Space invalida confirmações e reinicia revisões contextuais preservando texto; nova pergunta invalida percurso de IA. Voltar à revisão exige novo aceite. |
| R2-05 P1 | Depois de remover pacote, Voltar alcançava sucesso anterior, criando resultado contraditório e caminho para ressuscitar disponibilidade. | Resultado de lifecycle encerra histórico reversível; remoção permanece ausente. Teste de navegador e teste determinístico. |
| R2-06 P1 | Interrupção “fonte revogada” retornava ao seletor com a referência novamente marcada. | Referências revogadas no cenário ficam desmarcadas/indisponíveis, confirmação invalidada; retry não as reaproveita. Prova vermelha preservada. |
| R2-07 P2 | OOBE sem foco inicial; Escape não encerrava tela independente. | Título recebe foco ao abrir; Escape retorna da jornada fullscreen; erros/recibos têm semântica de anúncio. Teclado de jornadas exercitado. |
| R2-08 P2 | Criar documento chegava à revisão com operação “Renomear”. | Intenção criar conservada no seletor de operação. Sem escrita real ou nova jornada. |
| R2-09 P2 | Desfazer ajuste retornava à edição com o valor novo. | Guarda valor anterior da edição e o restaura no ensaio; teste antes/depois. |
| R2-10 P2 | Revisão de energia ignorava texto pendente da Central e janelas minimizadas. | Contagem inclui formulários do contexto e todas as janelas; prova focada. Não é confirmação de salvamento do app. |
| R2-11 P2 | Texto pequeno sobre subtle/accent-soft em componentes novos media 4,40/4,18 em Argila. | Dois seletores usam ink existente; cores computadas medem 8,70–11,46 em ambos materiais. Nenhuma paleta alterada. |
| R2-12 P2 | Reabrir Conta depois de um resultado podia voltar à tela terminal sem opções de sessão. | Entrada Conta abre overview; reentrada direta de login/cadastro conserva destino explícito. |
| R2-13 P2 | Retry ilimitado acumulava histórico de percurso. | Histórico reversível limitado a 64 entradas; visited permanece único. Teste com 200 transições. |
| R2-14 P2 | Montagem intermitente terminava no fallback de erro; diagnóstico capturou cinco imports recusados por TCP no host estático. | Fila de aceitação do host de prévia ampliada para 64. Uma nova matriz completa após essa mudança material passou 392/392; detalhes e falhas anteriores preservados abaixo. |

Também foi reforçada a ausência de seleção: um activeSpace que não existe na lista projetada resolve para null, sem escolher o primeiro Space; abrir app exige contexto disponível. O cenário de revogação e a escolha explícita de retorno foram exercitados.

Não foram alterados os smokes anteriores para tornar assertivas permissivas. Um erro do **novo roteiro de auditoria** tentou abrir Intelligence sem navegar à sua rota após trocar Space; o roteiro foi corrigido. A captura dessa tentativa continua preservada e não foi contabilizada como regressão do produto. O helper de teclado deste novo runner passou a aguardar dois frames após keyUp, como já faz o smoke anterior, para observar o foco depois do processamento do evento; nenhuma assertiva foi removida ou relaxada.

## Gates, logs e snapshots

[validacoes.json](validacoes.json) registra comandos, exits, hashes e fases. Logs completos locais: `out/meridian-round2-audit/`, dentro do checkout. Checks e capturas essenciais foram copiados para esta evidência; logs compactos versionados e seus hashes estão em logs/ e validacoes.json. Contagens abaixo se sobrepõem; não devem ser somadas como testes únicos.

| Gate | Estado desta auditoria | Evidência / decisão |
|---|---|---|
| Sintaxe | PASS | 20 módulos no HEAD inicial; 21 com runner novo, mais parsing do teste Node executado. |
| Whitespace | PASS | git diff --check e staged check; avisos LF/CRLF do Git preservados, sem erro. |
| Module boundaries | PASS | Baseline e após alterações. |
| JSON contracts | PASS | 138 contratos e 9 source manifests. |
| Source graph Web | PASS | Baseline e após alterações, 128 arquivos no grafo canônico. Experimento não importado. |
| Node tema/localização/workspace/seleção/identidade | PASS | 81/81; os inputs canônicos desses testes não foram modificados depois. |
| Navegação determinística Meridian | PASS | 4/4: aceite novo, remoção, trust sem salto e histórico limitado. |
| Smoke Meridian anterior completo | PASS | 155 assertivas no baseline e no snapshot final, repetidas após a alteração do host; matriz e checks originais preservados. |
| Smoke Round 2 | PASS | 23 assertivas no baseline e no snapshot final, repetidas após a alteração do host. |
| Prova focada de estado/teclado/contraste | PASS | 54 verificações em ae05659; posteriormente incluídas e ampliadas na matriz final. Não substitui matriz completa. |
| Matriz ampliada final | **PASS** | 392 PASS / 0 FAIL; 180 telas alcançadas, 29 confirmações bloqueadas antes do aceite, 64 geometrias, nenhum erro não tratado ou request externo. Snapshot 15247d1d0622942e0fb45174b1f3a147b08083c3. |
| Matrizes anteriores | **FAIL preservado** | Baseline: 346 PASS / 9 FAIL, incluindo 7 assertivas objetivas, 1 erro do roteiro e 1 timeout. Após primeiras correções: 371 PASS / 1 timeout. Os resultados antigos não foram reclassificados. |
| Diagnóstico de navegação/transporte | PASS e FAIL registrados por fase | Série limitada inicial: 42 checks/40 navegações sem reprodução. Prova posterior: 51 PASS/2 FAIL, incluindo imports recusados e leitura de foco sem sincronização. A correção material do host e a sincronização do runner antecedem a matriz final. |
| Contraste/clipping após CSS | PASS | 18 checks específicos; depois incluídos no fechamento de 54. Não certifica toda a UI. |
| Build/typecheck Web | NOT RUN | Zero diff nos inputs/composição/locks; source graph confirma exclusão do experimento. Build anterior não é apresentado como build novo. |
| Verify de bundle / repetibilidade | NOT RUN | Nenhum bundle novo gerado; hashes/builds anteriores continuam evidência histórica, não PASS desta rodada. |
| Chromium Web canônico | NOT RUN; FAIL histórico | Timeout ready anterior continua indeterminado. Sem alteração causal nos inputs, não foi repetido. |
| Foundation completa | NOT RUN; FAIL histórico no Windows | Nenhum input POSIX/Windows afetado; fcntl/sh/jq, permissões, links e bytes/caminhos continuam fora do delta. Exige ambiente compatível com CI. |
| Supply chain/workflow | N/A ao delta | Workflow/locks inalterados; nenhuma action/dependência nova. Não se inventou PASS de um gate não executado. |
| Lint dedicado | N/A | Manifest não oferece script específico aplicável. |
| Browser integrado | BLOCKED na conexão | Bootstrap expirou; uso de runner canônico descartável para UI, capturas e AX. |
| CI remoto, hardware, USB/kernel, signing/publicação | NOT RUN | Fora da autorização e do escopo; nenhum aceite físico inferido. |

### Arquivos de prova e leitura dos resultados

- [Matriz final — 392 PASS](matrix-checks.json): código 15247d1, 180 telas, 29 confirmações e 64 geometrias.
- [Smoke anterior — 155 PASS](host-meridian-proof.json) e [Round 2 — 23 PASS](host-round2-checks.json): mesmo código final.
- [Baseline reprovado](baseline-checks.json), [matriz anterior reprovada](matrix-before-host-fix.json), [fonte revogada/desfazer antes da correção](extra-before-checks.json) e [diagnóstico de transporte reprovado](transport-diagnostic-checks.json) permanecem separados.
- checks.json registra a prova focada de 54 verificações em ae05659; meridian-proof.json e round2-checks.json conservam as execuções intermediárias. Não são os resultados finais do host.
- contrast.json contém medições diagnósticas anteriores à correção; [computed-contrast.json](computed-contrast.json) contém os dois componentes corrigidos. As medições não certificam toda a interface.
- Capturas do snapshot final: [Recovery/Grafite 320](captures/final/recovery-impact-ink-320.png), [OOBE/Argila 320](captures/final/setup-review-paper-320.png), [Store/Argila 320](captures/final/store-paper-320.png) e demais arquivos em captures/final/.

### Falhas de ambiente e resultado indeterminado

A primeira execução via ferramenta foi interrompida pelo reset da conexão, sem exit capturado: não é PASS. O Chromium sob sandbox de processos falhou antes da UI por GPU/DevTools; a mesma receita fora dessa restrição passou. Foram usados perfis temporários, servidores loopback e encerramento dos processos criados pelos testes.

O timeout da matriz ampliada é **distinto** do Web canônico histórico. O diagnóstico posterior registrou a página de fallback “Não foi possível abrir o estudo” e cinco eventos Network.loadingFailed de imports com net::ERR_CONNECTION_REFUSED. Isso demonstrou falha de transporte durante o carregamento do grafo de módulos, mesmo sem exceção JavaScript capturada. A série anterior de 40 navegações sem reprodução permanece apenas uma prova parcial.

O servidor de prévia usava a pequena fila de aceitação padrão do ThreadingHTTPServer. Foi criada uma subclasse com request_queue_size=64, preservando loopback, allowlist e CSP. Após essa alteração material, uma nova execução completa passou 392/392, com todas as 64 geometrias. Os dois smokes existentes também foram repetidos no mesmo código. Essa evidência fecha a regressão observada neste host; não comprova ausência de qualquer falha futura de transporte em outros ambientes e não resolve o timeout Web canônico histórico.

Não se aumentou o timeout nem se retirou assertiva. O helper de teclado do novo runner recebeu a sincronização de dois frames já usada pelo smoke anterior, após uma verificação de foco antecipada falhar. As provas reprovadas, inclusive esse diagnóstico, permanecem nos logs e JSON versionados. O resultado final corresponde a uma execução posterior a correções identificadas, não à escolha de um resultado verde entre retries sem mudança causal.

### Paralelismo e integridade do snapshot

Sem subagentes. Processos de gates com saída em arquivo rodaram enquanto leitura estática/documentação avançavam; smokes Chromium foram sequenciais. Nenhum arquivo de produto foi editado durante o gate que o validava. Correções começaram após término/captura das provas anteriores. Logs de falhas, reruns e exits foram preservados. O host temporário de cada prova foi encerrado; não se alterou a aba/servidor 4204 do outro trabalho.

## Diagnóstico por experiência

| Área | Avanço observado | Limite / risco remanescente |
|---|---|---|
| Central | Faixa operacional torna USB, dados, rede, update e janelas acessíveis; reduz o caráter de dashboard genérico sem mudar a composição artística. | Host/sessão detalhados estão no painel. Números e datas são fictícios; estados de roteiros independentes não alimentam um estado global coerente. |
| Desktop | Mesmo material, shell, seleção e navegação; janelas/rascunhos por contexto, lock, compact/floating/expanded e minimizar/restaurar funcionam no recorte. | Array local não é workspace canônico. Arte/copy fixa de apps não representa contexto autorizado; scroll/seleção em toda combinação de repaint não foram homologados. |
| USB | Mídia versus host, ESP + DATA, capacidade compartilhada, imagem somente leitura, dados e rascunhos separados. | Não mede host/USB e não escreve mídia. Cheio/read-only/ausente são condições do roteiro. |
| OOBE | Todos os passos previstos, conta/rede opcionais, erros/retry, retorno e saída Central/Desktop; aviso honesto sobre idioma. | Completar ensaio não grava first-run. Recarregar perde estado intencionalmente. |
| Session/Lock/Power | Lock retira conteúdo da árvore, unlock conserva trabalho; logout mantém uso local; expiração separada; pendências corrigidas. | Não bloqueia computador, não criptografa mídia, não revoga credencial nem executa energia. |
| Update | Consulta, revisão, pause/resume, verify, staging, adiar, restart, health e known-good/rollback; nenhuma opção ignora trust. | Entregas A/B são identidades editoriais. Estado de update não é prova de release, dispositivo ou CI. |
| Recovery | URL direta e tela independente sem Central renderizada atrás; diagnóstico, impacto, falha, mídia ausente e orientação de reparo. | Independe visualmente da Central, mas depende dos assets/JS da prévia; não prova ambiente bootável independente. |
| Intelligence | Modelo/fontes, streaming fixo cancelável, sugestão, aprovação pontual e recibo; contexto/retry corrigidos. | Resposta fixa e ID de recibo fixo. Sem router, Memory, Action Gateway, grant ou executor reais. |
| Store | Lifecycle compartilhado com Profile; trust, erro, retenção, update/remove e ausência após remoção. | Receipt editorial não é instalado verificável. Detalhes permitem explorar remoção/update sem instalação anterior; não transportar essa affordance para adapter real. |
| Spaces | Seleção explícita, impacto, A/B/A repetido, ausência/revogação, criação como intenção. | Revogação é cenário, não enforcement. Membership/create/provisioning reais pertencem a owners distintos. |
| Perfis | Pizzaria/3D demonstrativos, Empresas editorial, Legal BR conceitual sem instalação; catálogo/lifecycle/configuração/comunidade. | Nenhum módulo ou capacidade disponível é comprovado; ativação não concede privilégios. |
| Account/Identity | Conceitos separados; visitante sem dados digitados de Lia e retorno com conservação. | Fixtures globais permanecem. Não há sessão autenticada, exportação/exclusão, sync ou recuperação reais. |
| Files | Referências/volumes e operações como revisão, conflito/read-only/cheio/ausente, lixeira/restauração. | Não é segundo Files funcional; não navega filesystem, não salva bytes nem concede sharing. |
| Settings | Tópicos pedidos, indisponível/negado/erro, revisão e desfazer corrigido. | Seletores de cenário não equivalem a hardware aplicado; idioma, áudio e rede não afetam o host. |
| Devices | Código explicitamente inválido para pairing, confirmação bilateral, escopo e expiração/recusa/revogação. | Lista/capabilities estáticas; sem câmera/mic, discovery, comando ou Device Host. |
| Notifications/Network | Filtros, origem/prioridade, dismiss/restore/DND; opt-in, membership, pending/delivered/failed/retry/moderação. | Comunicação do storyboard é texto editorial disponível no código, não mensagem privada enviada; sem ingestão automática em Memory. |

## Acessibilidade, responsividade e materiais

- Matriz: 1440×900, 1024×768, 768×600, 390×844, 320×568 e 844×390, em Argila/Grafite. Dez layouts densos prioritários nos extremos e três nos recortes intermediários: 64 combinações planejadas e concluídas na matriz final. As execuções anteriores interromperam um recorte por carregamento e continuam registradas como FAIL.
- Nos recortes concluídos: sem overflow horizontal de página/root/journey/painel e sem controles button/checkbox/combobox/textbox/progressbar sem nome na árvore AX. Rolagem vertical permanece necessária e disponível.
- 180 telas alcançadas por caminhos de botões; 29 confirmações verificadas como fechadas antes do aceite. Isso não equivale a testar cada combinação de cenário global, retorno, refresh e identidade.
- Diálogos nativos contêm Tab; abertura focaliza título; Escape fecha e fullscreen retorna. O smoke anterior cobre retorno ao campo e 32 Tabs; novos recortes cobrem journeys. Leitor de tela real, zoom 200%/400%, forced-colors e todos os modos de entrada: NOT RUN.
- Reduced motion continua no mecanismo/token preexistente, exercitado pelo smoke anterior. Sem lógica de jornada por material: o markup, estados e handlers são compartilhados.
- Contraste medido de dois textos novos foi corrigido de 4,40/4,18 em Argila para 11,46/10,88; em Grafite, 9,53/8,70. Erros usam texto e semântica de alerta, recibos status. Não é certificação de WCAG da interface inteira.
- Claro, Escuro e OrdaX USB canônicos permanecem sem diff. Meridian continua opt-in, sem persistir preferências do produto.

## Inventário, fluxos e passagem para a próxima tarefa

O [inventário atualizado](inventario.md), também em [JSON](inventario.json), compara as **196 linhas em 17 categorias** com a Round 1, preservando prioridade/horizonte e próximo critério real. Resultado de representação: **91 demonstráveis, 24 demonstráveis com lacuna, 74 esboçados, 6 não representados e 1 bloqueado por owner/contrato**. **Pronto para adapter: zero.** “Demonstrável” nunca significa release, implementação funcional ou item de MVP concluído.

Os [14 fluxos revisados](fluxos.md) registram representação atual, interrupções cobertas/faltantes, risco e próximo critério real. Não se adicionou um fluxo artificial só para aumentar cobertura.

**Próxima tarefa recomendada:** o outro chat pode iniciar a **Round 3 visual**, usando o inventário e os 14 fluxos como limites verificáveis. Priorizar clareza dos estados combinados, continuidade entre Central/Desktop e jornadas densas nos recortes estreitos; distinguir representação ausente, esboço e demonstração. Preservar as correções, o isolamento opt-in e os gates. Evolução artística pertence a essa próxima tarefa; esta auditoria não a executou nem autorizou adapters.

Antes de qualquer futura integração ainda são obrigatórios: projeções dos contratos canônicos; substituição de fixtures e controller de repaint; autorização/identity/Space fail-closed; lifecycle de workspace; coerência de estados combinados; localização; gates canônicos pendentes em ambiente adequado. Isso é um conjunto de bloqueios de integração, não autorização para construir novos owners nesta branch.

**Confirmação final:** main local preservada no SHA acima; evidências históricas preservadas; nenhum merge/push ou ação real sobre serviços, arquivos do usuário, hardware ou mídia.
