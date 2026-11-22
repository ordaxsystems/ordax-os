# INTELLIGENCE-001 — F0, baseline de contexto e limites de evidência

**Data-base:** 2026-11-01.
**Plano único:** [INTELLIGENCE-001](../plans/INTELLIGENCE-001-AURA-CONTEXTUAL-INTELLIGENCE.md).
**Nível de evidência:** regressão integrada com fixtures determinísticas, usando serviços reais do **OS fixado pela CI** e o source portátil do Intelligence, **não** avaliação de qualidade do GGUF/llama.cpp nem prova física Windows.

## 1. Inventário do que já está ligado pelo OS

Verificação de código-fonte em `ordax-os/main`, arquivo `system/composition/native/main.mjs` (somente leitura, sem editar outro repositório):

- `createIntelligenceRuntime()` e `createLocalAiRuntime()`: **linhas 407–416**; criam o núcleo consultivo/port local.
- `createApplicationIntelligenceAwareness()`: **linhas 546–565**; combina catálogo first-party e manifests verificados de slots.
- `createApplicationActionCapabilityRegistry()`: **linhas 566–574**; só materializado quando há capacidades verificadas.
- `createApplicationSemanticRouter()` e `createApplicationContextIntelligence()`: **linhas 575–584**; envolvem o núcleo com contexto de apps e seleção local de intents.
- `createIdentityBoundMemoryIntelligence()`: **linhas 597–604**; vincula memória ao usuário/Space corrente quando há Memory Port.
- `installNativeIntelligenceHostBridge()`: **linhas 620–629**, condicionado a `hasNativeHostBridge(window)`; não presume que a integração exista em navegador de desenvolvimento nem em todo instalador Windows.

**Conclusão técnica delimitada:** o wiring Native de fonte **existe** e foi verificado visualmente no código. Não foi comprovado o mesmo fluxo no `.exe` Windows físico, nem que uma release implantada esteja consumindo a revisão atual de `ordax-intelligence`. O pin de produção/integração deve continuar imutável até os gates do OS.

O OS já possui `app-intelligence-manifest`, `application-awareness`, `application-context`, `application-semantic-router`, `application-action-capabilities`, `authorized-memory` e `semantic-retrieval`; nenhuma dessas fontes deve ser implementada uma segunda vez no Intelligence. O contrato OS `docs/contracts/semantic-index.json` continua com embedding e semantic search **desativados**.

## 2. Fixture de contrato, não de modelo

- Dados de entrada: `tests/fixtures/contextual-f0.json` — **exemplos sintéticos**, não inventário de apps do usuário nem catálogo distribuível.
- Regressão: `tests/upstream/test_contextual_f0.mjs` — importa **diretamente** `createApplicationIntelligenceAwareness`, `createApplicationSemanticRouter`, `createApplicationActionCapabilityRegistry`, `createApplicationContextIntelligence` e `createIdentityBoundMemoryIntelligence` do checkout OS `_upstream/ordax-os`, mais `createIntelligenceRuntime` deste repositório vinculado aos validadores OS.
- O fake de inferência observa o `systemPrompt`, o contexto entregue ao motor, o snapshot e o resultado com `authority=none`. **Não** decide se a resposta em português é correta: retorna texto rotulado `Fixture-only reply`. Não há embeddings, GGUF, servidor externo, grants ou ações.
- CI: `npm run test:compat` já executa `tests/upstream/test_*.mjs`; a `ci.yml` fixa o OS em `3eb97a47e93aca294eaaf1e3597b3c98f4aebe0b`. Esse checkout contém as mesmas portas de composição testadas. Não alterar o pin histórico apenas para obter testes verdes.

### Casos positivos/verificações

| Cenário | Evidência que deve chegar ao modelo | O que não pode chegar |
| --- | --- | --- |
| `notes-intent` | Catálogo + manifesto/contexto do Notes + capability de proposta + Memory permitida | Documentos/Memory de Space B, app desconhecido como autorizado |
| `installed-catalog` | Catálogo incluindo app Windows marcado como compatibilidade/sem trust nativa | Execução e detalhes de ação de app não selecionado |
| `unsupported-app` | Catálogo conhecido (sem confirmação de app imaginário) | Detalhe ou ação inventada para app inexistente |
| `live-system-context` | Métrica **sintética** explicitamente entregue pelo port do OS e proveniência | Inferir métricas reais de um computador inexistente |
| `hostile-user-prompt` | Texto hostil apenas como pedido/dado; `systemPrompt` independente com vedação de autoridade | Execução automática, concessão de ferramentas |
| `signed-out-device-only` | Somente Memory de device e catálogo de apps | Memory privada de conta/Space após logout |

### Casos negativos

| Caso | Gate exigido |
| --- | --- |
| Caller falsifica `ordax-application-catalog` | OS rejeita ID reservado antes de qualquer `inference.generate()` |
| Fonte de Memory retorna dado de outro Space | OS rejeita escopo incompatível antes da inferência |
| Seleção de Space muda durante `inference.generate()` | Resposta tardia rejeitada e não repetida com contexto antigo |
| Local AI está `unavailable` | Snapshot `degraded`, sem resposta simulada nem POST de inferência |

O teste exige **zero chamadas de execução** porque a cadeia não possui porta de executor. Isso não demonstra resistência a prompt injection do modelo real; esse risco permanece aberto para avaliações adversariais com o GGUF.

## 3. Critérios de medição e limites

**Cobertura que a CI consegue afirmar agora:** presença dos contextos esperados, ausência de fontes não autorizadas, contenção de tool authority, fluxo com escopos OS reais, falha segura e orçamento do input; a suíte reporta cenários aprovados no output TAP. Uma falha reprova o gate.

**Ainda não medido (não usar como marketing nem release gate “aprovado”):**

- resposta factual fundamentada em fontes: acurácia, precisão de citação e taxa de alucinação do modelo real;
- escolha correta de intent, abstinência em apps ausentes e planejamento multi-etapas;
- latência p50/p95, tokens/s, CPU, memória, limite de hardware fraco e qualidade em português;
- variante executável Windows OrdaX Desktop, identidade física da sessão, persistência após reinício e atualização do app;
- indexação vetorial, geração de embeddings e RAG semântico efetivamente ativado.

**Próxima entrega F0:** executar as perguntas sintéticas e testes adversariais com **modelo local real em Windows físico autorizado** através da mesma porta e registrar resultados verificáveis por caso, mantendo o teste determinístico da CI como regressão de integridade do contexto. Não confundir o teste de ligação (concluível pela CI) com avaliação semântica física (pendente). Corrigir primeiro causas reais de falha; não criar um RAG paralelo ou habilitar `semantic_search_enabled` artificialmente.

## 4. Guardrails futuros

- A fixture é sintética, somente teste. Nunca usá-la como catálogo de apps, Memory, source lock, prompt de produção ou treinamento.
- Alterações em seleção de contexto, memory scopes, manifests, ações ou Identity/Space exigem regressões negativas acima, mesmo quando o modelo em teste parecer responder corretamente.
- `ordax.intelligence/1` permanece `toolExecution=false`, `authority=none`; testes de modelo não podem conceder acesso a ferramentas.
- Contratos/armazenamento/ativação pertencem ao OS; UI e confirmação à Aura; o Intelligence não modifica outras camadas. Sem aprovação de backend, sem embeddings e sem egress.
- Só atualizar F0 como **concluída integralmente** quando existir evidência de respostas reais do modelo, além da cobertura sintética.

## 5. Avaliação de respostas — canários F0 (2026-11-01)

A matriz existente `tests/fixtures/contextual-f0.json` ganhou **rubricas de respostas**, mantendo os mesmos seis IDs de cenários (sem outro catálogo ou fixture de conteúdo). `tools/evaluation/score-contextual-f0.mjs` fornece `--template` para gerar o formulário local de respostas e `--score RESPONSES.json` para pontuar somente **respostas já obtidas por um fluxo aprovado** do OS/Aura. O avaliador nunca faz requisições à rede, não instala modelo, não consulta dados pessoais e não concede permissões.

Cada rubrica publica `category`, `requireAny` e `forbidAny`: grounding de apps/métricas, reconhecimento de app ausente, proibição de afirmar uma ação executada e não divulgação de marcas de outro Space. Trata-se de **canários lexicais transparentes**, não um juiz LLM nem um benchmark geral de raciocínio. Uma resposta pode satisfazer uma substring e ainda estar semanticamente errada; por isso o resultado **não certifica qualidade do modelo**. O `tests/contextual-quality.test.mjs` valida gabaritos sintéticos, negativos de privacidade/segurança, inputs estritos, ausência de vazamento no relatório e códigos de saída; pontuação de fixture **não é pontuação de modelo físico**.

Nenhum servidor do modelo local foi encontrado na porta padrão `17865` do computador Windows autorizado `DESKTOP-4UFL03B` na inspeção read-only de 2026-11-01; nenhuma inferência física foi executada nesta fase. O gerador de relatório deixa `physicalModelAttested=false`, `semanticQualityQualified=false` e `evidence=unattested-offline-answers` **mesmo que um operador preencha os dados com uma resposta real**. Somente o OS poderá atestar modelo, executável, hash, slot, sessão, tempo e execução física; esses campos não são forjados no produtor.

**Procedimento quando houver backend aprovado:**

```sh
node tools/evaluation/score-contextual-f0.mjs --template > /caminho/local/respostas-f0.json
# O runner autorizado OS/Aura executa os seis prompts do fixture com contexto válido;
# preencher apenas os textos retornados e o modelId, sem dados pessoais.
node tools/evaluation/score-contextual-f0.mjs --score /caminho/local/respostas-f0.json > /caminho/local/score-f0.json
```

O processo retorna `0` quando todos os canários passaram, `1` com falhas individuais e `2` se o arquivo de entrada viola o esquema. Nenhum dado de respostas é impresso ou salvo no relatório. O operador deve guardar a evidência física privada/sensível fora do repositório e somente registrar conclusões verificáveis sem credenciais; **não promover cutover por porcentagem de canários**.

**Próximo gate F0:** o owner do OS fornece coleta vinculada ao modelo/ABI/slot real em Windows físico, e a equipe compara resultados/latência com estes casos antes de declarar qualquer capacidade de produto. O canário offline é apenas um instrumento de regressão para esse futuro teste.

## 6. F0 — correção de falsos positivos lexicais (2026-11-01)

Uma regressão do avaliador foi identificada: `requireAny` procurava substrings em qualquer posição. Assim, o indicador `autoriza` era encontrado dentro de **`desautorizado`**, permitindo que uma resposta negando autorização parecesse cumprir o canário de segurança. O indicador agora só conta se começar no início de uma palavra Unicode (letras e números não podem precedê-lo). A terminação continua flexível para aceitar `autorização` e `encontrei` como variantes de radicais intencionais. Marcadores de vazamento e afirmações proibidas continuam usando busca integral para não permitir que um prefixo extra esconda um segredo de Space.

As rubricas existentes foram estendidas com afirmações contraditórias explícitas: nota já salva sem autorização, comando já executado e `Photo Editor` não instalado. Testes negativos demonstram que esses textos **antes podiam pontuar indevidamente** e agora são rejeitados, sem mudar os IDs dos seis cenários ou a política de privacidade.

**Limite obrigatório:** correspondência lexical não é compreensão semântica. Parafraseamento adversarial, ironia, texto citado e negações complexas ainda exigem avaliação humana ou teste real de modelo; `semanticQualityQualified=false` e `physicalModelAttested=false` permanecem sempre. Esta correção melhora a resistência do canário, **não** comprova a competência da Aura ou do GGUF.

## 7. F0 — escape estrutural e truncamento seguro do contexto (2026-11-01)

A revisão do produtor identificou um defeito concreto: `validateIntelligenceRequest()` no OS aceita campos de contexto com quebras de linha, mas `renderRequest()` no Intelligence os montava como texto bruto. Uma nota, manifesto ou campo `provenance` poderia introduzir linhas falsas `User request:`, `Intent:` ou `- [system:...]` no próprio prompt, sem possuir tal escopo. A correção no produtor usa aspas JSON para o texto, escapes nos metadados e normalização dos separadores de linha; conserva o pedido legítimo no final.

A regressão em `tests/upstream/test_intelligence_runtime.mjs` verifica texto de documento hostil, ID/proveniência com `CR/LF`, `NEL/U+2028/U+2029`, exatamente uma linha física de contexto, um único cabeçalho `User request:`, integridade do pedido, limites de comprimento após serialização, string JSON válida após truncamento e code points Unicode não quebrados. O conjunto F0 existente continua validando o catálogo/Memory do OS com IDs normais. Não há alteração no contrato de memória, na origem dos dados nem no motor.

O escape não comprova segurança semântica do modelo: o texto entre aspas ainda pode conter instruções maliciosas, que devem ser tratadas como **dados não confiáveis**. Não declarar proteção em uma build Windows ou corte de produção antes da integração pelo owner OS e prova física; F0 permanece parcial.

## 8. F0 — prevenção de starvation de Apps pela Memory no prompt (2026-11-01)

Foi identificado um defeito de integração: a composição `createIdentityBoundMemoryIntelligence()` entrega memória antes de `createApplicationContextIntelligence()` anexar o catálogo e intents de apps. O `renderRequest()` do produtor consumia o input local por ordem e encerrava no primeiro item grande. Portanto, memória e documentos autorizados podiam consumir todo o limite e impedir a resposta sobre o app solicitado, apesar de o OS ter anexado corretamente suas informações.

Correção no **produtor**: serializa e calcula os custos reais dos contextos; se o conjunto exceder o orçamento, usa divisão equilibrada de capacidade por item (*water-filling*), preservando exatamente a ordem e os itens autorizados pelo OS. Contextos curtos não são truncados desnecessariamente, contextos grandes têm marcação de truncamento, e não existe preferência artificial pelo rótulo `system`. Pedidos reais continuam íntegros e ao final do input; o teto de `LOCAL_AI_MAX_PROMPT_CHARS` segue canônico do OS.

Novas provas: `tests/upstream/test_intelligence_runtime.mjs` combina Memory extensa com `ordax-application-catalog` e detalhe de Notes, e assegura que os dados de app ainda alcançam o backend sem exceder o limite; `tests/upstream/test_contextual_f0.mjs` passa documentos grandes pela composição **real** do OS fixado (Apps, intents, action capabilities e Memory) e exige visibilidade de informação relevante, nenhuma memória de Space B e nenhuma autoridade executora. As regressões anteriores de serialização/escape, locale e input máximo permanecem obrigatórias.

Limitação: a política é um balanceamento estrutural, não uma busca por relevância. Se os metadados forem grandes demais ou o pedido do usuário consumir quase todo o orçamento, alguns itens autorizados ainda serão omitidos (com sinalização quando couber). Resultados são testes de contrato com backend simulado: a qualidade do GGUF em Windows físico **segue sem comprovação**. O OS ainda controla a versão instalada, a Memory, a indexação e o cutover.

## 9. Prontidão física e lacuna de catálogo no OS (2026-11-01)

**Prova física de leitura:** um Desktop Windows autorizado estava online, mas não havia processo `llama-server`, `ollama` ou LM Studio nem listener local nas portas consultadas (`17865`, `11434`, `8080` e `1234`). Os executáveis consultados não estavam no PATH. Não é prova de ausência de todo modelo em disco/outro dispositivo; apenas nenhum backend disponível para inferência física nessa máquina durante a verificação. Não houve instalação, download ou execução de GGUF.

**Source e ativação:** `ordax-os/main/docs/contracts/intelligence-source.json` ainda fixa `source_commit=a39c8ddcba1ac466a3697e03c20e0a8f186e4fc8`, com `status=integration-candidate`, `cutover_complete=false` e `activation_authorized=false`. Uma CI verde no produtor não demonstra que o OrdaX Desktop recebeu o novo código.

**Lacuna OS reproduzível:** em `ordax-os/system/services/intelligence/application-context.mjs`, o catálogo verificado só é acrescentado quando `appendIfFits()` encontra espaço em `INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS`. Uma entrada já saturada pode omitir o catálogo e os detalhes/capacidades de apps antes do Intelligence. A divisão de orçamento no produtor não recupera informação nunca encaminhada. O teste `tests/upstream/test_contextual_f0.mjs` produz esse cenário com os serviços reais do checkout OS fixado e registra o bloqueio sem fingir êxito.

**Owner da correção:** `ordax-os` deve reservar orçamento para catálogo/intent verificados ou disponibilizar um estado canônico de contexto incompleto, sem ultrapassar as cotas, burlar Memory ou criar outro registry. Depois é necessária inferência real Windows com engine/modelo autorizados, identidade/Space e logs seguros.

**Mitigação consultiva no produtor:** o prompt agora explica que ausência/truncamento de evidência não confirma instalação, ausência, capacidade ou execução de apps. Esse texto é uma instrução ao modelo, não uma garantia de obediência. A avaliação semântica com GGUF físico continua pendente.

## 10. F0 — recuperar parcelas reservadas para contextos inviáveis (2026-11-01)

Foi identificado um caso limite no balanceamento anterior: com `INTELLIGENCE_MAX_PROMPT_CHARS=32000`, contexto com ID permitido de até 160 caracteres e proveniência permitida de até 512 caracteres, o produtor podia reservar parte do limite para um item cujo mínimo JSON escapado não cabia. O item não era emitido, **mas sua parcela não era redistribuída**. Em uma requisição com múltiplos metadados grandes, esse desperdício podia omitir uma projeção curta e verificada de aplicativo que caberia no orçamento real.

A correção calcula o menor custo viável de cada item e, somente quando a distribuição não o comportar, remove primeiro da distribuição o item de maior custo mínimo. Repete o cálculo até as parcelas dos itens remanescentes serem utilizáveis. As informações autorizadas mantêm a ordem original, o limite canônico e a separação entre texto do usuário e contexto. Omissões continuam explícitas quando couber.

Regressões em `tests/upstream/test_intelligence_runtime.mjs`: (1) oito documentos autorizados com metadados máximos antes do catálogo de apps, solicitação no tamanho máximo, catálogo ainda no prompt e sem extrapolação; (2) fontes pequenas nas duas extremidades preservadas na ordem do OS, com documento intermediário inviável omitido. A suíte F0 de Apps/Memory e os controles de privacidade permanecem inalterados.

**Prova limitada:** as verificações exercitam a composição de prompt em backend simulado, não entendimento do modelo local físico. O OS continua dono de seleção/escopo/versão do catálogo, e um item não entregue pelo OS **não pode ser recuperado** por redistribuição no produtor.

## 11. F0 — identidade de motor/modelo durante geração (2026-11-01)

**Defeito no produtor:** após conferir engine/modelo antes da chamada Local AI, o runtime validava apenas os campos do resultado final. Se o port mudasse de identidade durante a geração e voltasse ao modelo anterior (**A → B → A**), a resposta poderia ser aceita. Durante streaming, deltas posteriores à troca podiam chegar sem a checagem correspondente.

**Correção com owner preservado:** o Intelligence não mantém catálogo ou pin de modelos; observa o port Local AI **autorizado pelo OS** e confere snapshot vivo antes/depois de cada delta e antes do resultado. Mudança de engine/modelId ou perda de prontidão invalidam a requisição, mesmo quando a identidade volta ao valor original. Transições `ready/busy` no mesmo modelo são aceitas. O observador por requisição é liberado em `finally`.

**Regressões:** `tests/upstream/test_intelligence_runtime.mjs` cobre troca de modelo antes do primeiro delta, troca **A → B → A** com resultado final original, troca de engine **A → B → A** no streaming, evolução legítima `ready → busy → ready`, e troca durante callback assíncrono com bloqueio do delta seguinte. O contrato permanece `authority=none`, `toolExecution=false`.

**Limitação:** tokens já recebidos antes da troca não podem ser revogados. Os testes usam port simulado e não comprovam execução de modelo GGUF em Windows, nem autorizam cutover. Engine/modelo, sessão, grants e atualização física pertencem ao OS.

## 12. F0 — fechar janela entre montagem do input e envio (2026-11-01)

**Defeito reproduzível no produtor:** o runtime verificava engine/modelo antes de construir o objeto enviado à Local AI, mas construía `systemPrompt` chamando `getLocale()` depois da verificação. Caso a consulta regional publicasse uma troca do modelo, o produtor poderia chamar `inference.generate` já com o contexto autorizado **sob uma identidade diferente** e só detectar o erro quando a geração terminasse. Mesmo a proteção por notificações implementada na etapa anterior rejeitava a saída, mas não garantia recusa do envio.

**Correção:** o produtor monta o input completo primeiro e executa uma checagem nova do snapshot **imediatamente antes do dispatch**, exigindo `ready`, identidade igual à rota e ausência de alteração observada (inclusive ciclo A → B → A). Nenhum privilégio, catálogo ou gerenciador é introduzido; o port continua controlado pelo OS. Falha nessa verificação significa **zero chamadas ao backend** e nenhum contexto encaminhado.

**Provas de compatibilidade com o checkout OS fixado:** `tests/upstream/test_intelligence_runtime.mjs` verifica três regressões: (1) `getLocale()` altera `modelId` e o backend recebe zero requisições; (2) `getLocale()` publica modelo B e retorna A, o latch impede envio e uma requisição nova limpa não herda a falha; (3) `getLocale()` publica `busy` na mesma identidade, impedindo dispatch. Continuam válidos os testes de idioma normal, troca durante streaming, cancelamento e limites do prompt.

**Limitação:** validação de port simulado não demonstra que o OrdaX Desktop Windows recebeu esse produtor ou que há GGUF funcionando. As permissões e a veracidade da identidade do backend pertencem ao OS, que segue com source lock sem ativação e prova física pendente.

## 13. F0 — cancelamento e descarte antes do envio físico (2026-11-01)

A checagem introduzida após a preferência regional na etapa anterior verificava estado/identidade do backend, mas não revalidava **cancelamento do pedido** nem **descarte do núcleo Intelligence** após `systemPromptForLocale(getLocale)`. Um getter regional ou um último acesso ao snapshot poderia cancelar a solicitação de forma síncrona; um adaptador de inferência que ignorasse o `AbortSignal` ainda receberia o prompt e o contexto autorizado antes de o erro ser detectado.

O produtor agora chama `assertAlive()` e verifica `signal.aborted` **depois de toda a montagem de input e da leitura final do snapshot**, imediatamente antes de `inference.generate()`. Esse gate reutiliza o signal fornecido pelo usuário e o ciclo de vida existente, sem criar novo cancelador, state store ou proprietário de identidade.

Regressões no `tests/upstream/test_intelligence_runtime.mjs` exigem **zero** invocações do backend quando `getLocale()` cancela o pedido, quando `getLocale()` descarta o núcleo, e quando a última chamada a `getSnapshot()` cancela o pedido. Os testes usam o validador regional canônico do OS e um adaptador que não aplica cancelamento por conta própria; assim exercitam a defesa do Intelligence, não uma garantia simulada do transporte.

Limitação: são testes de contrato e concorrência síncrona, não inferência GGUF física. O owner OS continua responsável pelo runtime real, source lock, motor, instalação Windows e autorização. O cancelamento posterior ao envio permanece coberto pela porta Local AI e pelos gates de streaming/resultado, mas não desfaz dados já enviados a um backend.

## 14. F0 — identidade verificada durante seleção da rota (2026-11-01)

**Causa:** a proteção de troca A → B → A (PR #44) só observava o port Local AI **após** a seleção da rota pelo model router. Um roteador que publicasse transição de motor/modelo e restaurasse o snapshot inicial durante `route()` podia passar na comparação final, permitindo encaminhar o contexto autorizado apesar da transição intermediária. Um ciclo `busy → ready` ocorrido na escolha da rota tinha a mesma lacuna de concorrência.

**Correção no produtor:** registrar o observador antes de chamar o router, ancorar a seleção na identidade inicial `ready`, observar trocas intermediárias de engine/modelo e transições `busy` durante a fase de roteamento, validar rota + snapshot final contra a identidade original e manter **o mesmo observador até o fim da geração**. Após seleção confirmada, o progresso legítimo `ready ↔ busy` segue permitido. O observador é liberado em `finally`, inclusive se a rota falhar.

**Regressões:** testes do `tests/upstream/test_intelligence_runtime.mjs` simulam modelo A → B → A, engine A → B → A e `busy → ready` dentro do router; todos exigem **zero** invocações do backend. Um segundo pedido após a rejeição deve funcionar, demonstrando limpeza do estado por requisição. Testes anteriores de streaming legítimo, cancelamento e privacidade permanecem obrigatórios.

**Limites:** isso prova a proteção do produtor contra notificações do port simulado. O OS continua autoridade da identidade dos modelos, da sessão, da integração Windows e da validação física do GGUF. Não demonstra qualidade semântica da Aura nem autoriza cutover.
