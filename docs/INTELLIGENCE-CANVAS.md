# OrdaX Intelligence — Canvas de conversa P1 (#1572)

> Escopo: **Surface de conversa somente**. Não substitui o Work Canvas de
> [#1574](https://github.com/ordaxsystems/ordax-os/pull/1574),
> nem implementa inferência/transportes da #1573/#1575.

## Fonte da verdade

- `system/apps/assistant/conversation.mjs` permanece o único dono da sessão
  de conversa, com identidade/Space/Perfil, envio, descarte, histórico limitado,
  estado de disponibilidade e proveniência do modelo. A interface só se inscreve
  no `ordax.assistant-conversation/1`.
- `system/apps/assistant/ui/result-view-model.mjs` é uma **projeção pura** desse
  snapshot; `conversation-controls.mjs` renderiza com `textContent`. Nenhuma
  persistência, Memory nova, router, executor, model adapter ou autorização.
- Repouso: símbolo, comando e status do provider. Resposta: um bloco de texto
  de resposta validada já integrada à sessão, contexto da pergunta e
  engine/model. Histórico anterior continua no mesmo snapshot da sessão,
  recolhível. Nem Markdown/HTML/URL aparentes viram rich content.
- `working` representa exclusivamente `inferencePending=true`. Não atribui
  etapas de execução a modelos. `result` representa **resposta do modelo**,
  **não** ação realizada. Após erro/descarte/troca de contexto, não promove
  resposta antiga a resultado da requisição atual. Percentuais ficam ausentes.
- O cancelamento de transporte introduzido em #1573 continua do seu owner;
  o botão chama somente `discardPendingResponse()` existente. Esta PR não
  toca streaming/SSE, backend cancellation, serviços nem contratos de inferência.
- Web não possui atualmente modelo/provedor nem seleção autenticada de Space.
  `system/adapters/web/space-selection.mjs` fornece apenas um port de estado
  `unavailable` compatível com o contrato, **sem store ou seleção fictícios**.
  A composição Web passa a montar o **mesmo** componente Assistant, exibindo
  indisponibilidade honesta sem enviar solicitações a modelos.
- Native continua consumindo sua instância real de Intelligence; não há
  segundo Assistant, segunda Activity ou Studio.

## Limites de tipos adaptativos

Neste corte apenas **texto puro** de uma resposta real do runtime entra no
Canvas. Para receitas com campos, imagens/galerias, documentos/PDF, tabelas/
gráficos, projetos e missões: exigir ports tipados, autorização/fonte validada
e, se necessário, Work/Activity/Result do Personal OrdaX. Não converter
automaticamente prosa, JSON arbitrário ou links de LLM em dados confiáveis.
Missões com eventos reais são representadas pela integração Activity de #1574.

## Evidências e testes

- `tests/test_assistant_result_canvas.mjs`: projeção em repouso, indisponível,
  resultado real, conteúdo não confiável, schema/limites/proveniência inválidos,
  envio pendente, descarte, resposta antiga, troca de escopo após runtime real,
  sem efeitos de ferramenta.
- `tests/test_web_intelligence_canvas.mjs`: estado Web sem Space/IA, método
  select negado, ligação única à composição Web e nenhuma resposta mockada.
- Workflow canônico `Intelligence Foundation` executa ambas suítes.
  Os resultados executados e o SHA exato devem ser anotados na PR.
- **Não é** E2E de conta/Space selecionado no Web, GPU/modelo físico,
  plugin ChatGPT, transporte remoto, Store, nem release USB ou deploy.

## Próximos cortes

Compor o Work Canvas read-only (P0/#1574) no painel global com consentimento e
contexto explícitos, sem iniciar Work pelo prompt; adicionar renderers por tipo
somente com dados provenientes de fontes verificadas e grants revalidados.
P2 pertence aos owners de capacidades/Runtime/Platform já descritos em
`INTELLIGENCE-HANDOFF.md`.

## Missões verificadas no Assistant Native (fatia seguinte da P1)

O Assistant Native agora recebe opcionalmente **a mesma instância** de Personal
OrdaX que alimenta Activity. O render `ui/work-strip.mjs` é somente leitura:
valida snapshots canônicos de identidade, seleção de Space e runtime Personal;
filtra owner e Space exatos a cada atualização; projeta com
`projectPersonalWorkCanvas` (P0). Não transforma prompt em Work, não cria
broker, workflow, aprovação, store, executor ou percentuais.

Exibe até três Work items recentes, cada um com até cinco eventos reais
`ordax.personal-activity/1`, estado de Work e texto de Result validado
`ordax.personal-work-result/1`. Sem evento, não apresenta etapas.
Execução incerta/revogação preserva `requires-action`; a UI não concede
ações. A Activity original mantém os botões de operações sensíveis sob grants.

O global Assistant não possui seleção de projeto. Portanto os Work items
vinculados a `projectId` são **omitidos**, não associados por prompt.
Na ausência de Personal/Identity/Space port, inclusive no Web, não há missões
fictícias nem tentativa de acessar dados de outro owner.

Cobertura: `tests/test_assistant_work_strip.mjs` com runtime Personal real
e adapter de inferência de teste, estados queued/completed, isolamento de
owner/Space, indisponibilidade e auditoria do binding Native. O gate é
`Intelligence Foundation`. CI e testes de source não provam E2E físico
com plugin, provedor remoto, revogação dinâmica ou seleção de projeto.


## Prioridade e evidências adaptativas (P1 adicional)

A projeção `ui/work-strip.mjs` continua limitado a três cartões e usa somente
o snapshot validado de Personal OrdaX. A **ordem de exibição**, sem alterar o
status real, privilegia: aprovação pendente/tentativa incerta/revogação,
depois Work ativo/pausado, falha/cancelamento, e por último resultados
concluídos. Empates usam `updatedAt` canônico; dados excedentes são
informados como quantidade remanescente na Activity, não descartados nem
recriados em outro histórico.

Cada cartão pode revelar sua **timeline de eventos reais** com sequência,
texto e `occurredAt` validado; exibe, quando houver resultado realmente
registrado, `resultId` e proveniência engine/modelo de
`ordax.personal-work-result/1`. A aparência de etapas finalizadas não prova
ações que não tenham receipts; a UI só exibe os eventos do owner Personal.
Sem URL, acesso direto a arquivos, galeria, PDF ou números extraídos de
texto arbitrário da IA. O Canvas revalida o snapshot atual da conversa antes
de montar a tela, para evitar reutilizar uma notificação anterior após troca
de identidade/Space, e preserva o foco do campo quando a Activity publica
atualizações.

Testes do runtime real incluem aprovação pendente mais antiga versus três
resultados recentes, identidade/Space, provas por evento, proveniência,
limite e overflow; a CI Intelligence Foundation executa esses cenários.
Este progresso de código/CI não equivale a E2E de ferramenta física.


## Tabela adaptativa de evidências das ações (P1)

Quando o Work corrente possui registros de `ordax.personal-action-attempt/1`,
a projeção canônica `projectPersonalWorkCanvas` fornece uma tabela de até oito
tentativas, com status **registrado** (started, succeeded, failed, uncertain),
ação, ferramenta, resumo e timestamps efetivos. A UI do Assistant renderiza
uma `<table>` semântica e recolhível apenas nesses casos; sem Action Attempts
não cria uma tabela, número, barra ou etapa fictícios. Indicadores de sucesso
refletem o receipt aceito e validado pelo estado Personal/Activity, não
confirmação externa independente. Um status `uncertain` nunca vira sucesso.

Se o owner registra `waiting-approval`, a projeção exibe uma solicitação
informativa com ação, razão e tipo de efeito; aprovação e execução continuam
**somente** na Activity, sujeitas a grants, ferramenta resolvida e confirmação
explícita do usuário. A UI mantém a distinção entre `resultId` de uma resposta
Intelligence e `attemptId` de ação.

Privacidade: não são expostos `resourceRef`, `grantRef`,
`toolArtifactSha256` nem `artifactRefs`. Um `resultId` não concede acesso
a arquivo ou URL. Todas as ligações de tentativas a owner/Work/approval,
Activity de início/fim e autoridade aprovada são verificadas pelo
`validatePersonalOrdaxRuntimeSnapshot` existente **antes** da projeção;
schema desconhecido, tentativa órfã, duplicidade e estados impossíveis falham
fechado. Os tipos de visualização seguros nesta fatia são texto consultativo,
timeline de Activity e tabela de Action Attempts; PDF, foto, galeria, receita
estruturada ou gráfico de vendas seguem sem fonte/grant tipado e não são
fabricados a partir do texto do modelo.

A prova de código inclui `tests/test_intelligence_work_canvas.mjs`,
`tests/test_assistant_work_strip.mjs` e
`tests/test_personal_ordax_first_foreground_action.mjs`, que exercita a
execução autorizada de ferramenta Native fake **apenas nos testes** e a
falha incerta depois da entrada no adapter. O workflow
`Intelligence Foundation` executa essas suítes. Nenhum destes testes implica
E2E em dispositivo/serviço real, leitura de PDF em produção ou release USB.


## Comando explícito como Work com resultado durável (P1)

O Assistant Native agora oferece **duas ações distintas**: `Enviar` preserva
a conversa efêmera e seu contexto; `Executar como análise registrada`
recebe consentimento por clique explícito e utiliza **a mesma instância**
`personalOrdax.create(goal, { spaceId, projectId: null })` seguida de
`personalOrdax.run(workItemId)`. Enter continua enviando chat, nunca
criando Work automaticamente. O botão só é oferecido quando a conversa
está pronta e o snapshot Personal/Identity/Space é compatível.

`resolveAssistantWorkScope` é o **mesmo fence** aplicado à projeção read-only:
device signed-out com Space indisponível, ou conta autenticada com Space
selecionado (ou unselected global). A solicitação global não inventa
`projectId`. O limite do objetivo de Work usa a constante já canônica
`PERSONAL_ORDAX_MAX_GOAL_CHARS`, menor que o limite do prompt do chat;
pedidos grandes continuam disponíveis somente como chat.

`run` significa exclusivamente **raciocínio foreground** pela porta
Intelligence que já existe, não ação do sistema, shell, ferramenta MCP,
fluxo autônomo, background ou garantia de completar missão real.
O estado `queued/running/completed/failed`, os eventos Activity e o texto
Result surgem apenas do runtime Personal; nenhum progresso é simulado
pelo frontend. Falha antes de iniciar o raciocínio mantém Work em queued,
sem fabricar resultado; a mensagem genérica orienta consultar Activity.
A autorização, aprovação e execução de ferramentas seguem inteiramente
na Activity e no executor existente.

A Surface Web permanece sem esse botão quando falta runtime Personal ou
owner/Space validado. Mudanças de owner/Space e estado inválido negam
novos Work; o runtime Personal mantém o fence após chamadas em voo.

Testes adicionados à suíte já conectada a `Intelligence Foundation`:
fluxo Native de Work `create→run→Activity→Result` com engine controlada
de teste, isolamento entre Spaces, owner mismatch, limite de tamanho,
estado ocupado e indisponibilidade da inferência. CI de código não prova
execução em PC real ou provedor externo.


## Visualização quantitativa adaptativa de Work autorizado (P1)

O painel Native de Intelligence inclui agora um **gráfico recolhível de
contagens por estado** quando existem pelo menos dois Work registrados
e autorizados no contexto atual. A fonte única é
`ordax.personal-runtime/1`, já verificada por
`validatePersonalOrdaxRuntimeSnapshot`; `projectAssistantWorkStrip`
projeta **todos** os itens visíveis (não apenas os três cartões da
previsualização), usando para cada item a mesma decisão canônica
`projectPersonalWorkCanvas` da Activity.

As cinco categorias são `requires-action`, `working` (inclusive Work
pausado), `result` (somente quando existe Result validado),
`failed` (falha/cancelamento) e `unavailable` (inclusive completed
sem Result verificável). As barras representam proporções do **total
de registros visíveis** e cada linha apresenta a contagem inteira,
não percentual de execução nem de conclusão da missão.
Não são números de vendas, gráficos empresariais ou sucesso de ações
externas. O snapshot é revalidado após troca de owner/Space e não inclui
itens vinculados a projeto sem seleção de projeto.

O gráfico é um `figure` com `figcaption` e texto acessível,
oculto sob `details` por padrão para preservar o campo de comando como
experiência principal. Não surge com zero ou um Work; a UI não faz
inferência de tipo por leitura de texto gerado pelo modelo e não
necessita de nova API, store, canal de inferência, grant ou executor.

`tests/test_assistant_work_strip.mjs` cobre totais maiores que o
limite de cartões, aprovação pendente, pausa, cancelamento, resultados,
resultado ausente, mudança de identidade/Space, status adulterado e
semântica do `figure`. A suíte existente `Intelligence Foundation`
é o gate de CI desta fatia. Isso é validação de código, não um
E2E físico, nem autoriza PDF/galeria/gráficos de vendas.

## Revisão explícita das missões na Activity (P1)

O Assistant Native reutiliza o `ordax.app-activation/1` já conectado à
Surface para mostrar **Revisar na Activity** apenas em cartões verificados
com `state=requires-action` e com canal de navegação disponível. Um clique
revalida Personal/Identity/Space e a presença da missão no recorte atual
antes de publicar `{ appId: activityApp.id }`, usando o ID do aplicativo
declarado no owner Activity (não uma string ou rota duplicada).

O canal é **somente intenção de navegação**, sem confirmação de que a
janela abriu; não existe `target` com ID de Work porque a Activity
ainda não implementa deep link por missão. O usuário examina a missão
na própria Activity. Isso não resolve aprovações, não concede grants,
não executa ferramentas, não confirma sucessos incertos e não expõe
referências privadas. A Surface Web sem `appActivation` não ganha
atalho fictício. O teste exerce o canal real da composição e verifica
ausência de publicação com owner/Space divergentes ou Work concluído.

## Destino por missão na Activity (integração ao SSOT da Surface)

A navegação de `Revisar na Activity` foi aprimorada de abertura genérica
do app para **Work preciso**: o Assistant emite um `target` versionado
`ordax.activity-work-target/1`, derivado somente de uma instância válida
`ordax.personal-runtime/1`. O contrato é propriedade de
`system/apps/activity/work-navigation.mjs`, importado pelo Assistant,
sem redefinição de formato, canal, store ou histórico.

A Surface **continua dona** do destino de janela via
`ordax.app-activation/1`, `getAppTarget(activityApp.id)` e
`app.launch`/workspace. A Activity agora lê esse target após cada
render e seleciona visualmente/foca **somente** se o mesmo Work ainda
existir no Personal e corresponder exatamente a owner kind/id, Space
corrente e `projectId:null`. O destino contém apenas IDs e schema,
**não** token, grant, caminho de arquivo ou detalhes de ação. Uma troca
de conta, Space, Work apagado, ID reaproveitado por outro owner ou
formato desconhecido torna o destaque inválido; nenhuma execução é
acionada e não se assume foco em outra missão. A Surface pode persistir
um destino no workspace; Activity nunca trata a presença do destino
como autorização. Destinos de projetos não são fabricados pelo Assistant
global, que não tem seleção de projeto.

A Activity continua responsável por suas aprovações e execuções.
`scrollIntoView` e foco da carta são efeitos de navegação de UI, não
um botão que autoriza ferramenta. O controle é compatível com ausência
dos ports Identity/Space (sem seleção específica) para outras
composições, como Web. Não altera modelo, inferência, streaming, Work
ou armazenamento de dados.
