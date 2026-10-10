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
