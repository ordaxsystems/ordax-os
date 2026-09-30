# Personal OrdaX

Status: **IMPLEMENTAÇÃO EM EXECUÇÃO / NÃO PROMOVIDO AO MVP PÚBLICO**

Este documento na raiz é o ponto de entrada do novo sistema Personal OrdaX. O contrato detalhado continua em `docs/PERSONAL-ORDAX.md` e a autoridade legível por máquina em `docs/contracts/personal-ordax.json`.

## Objetivo

Personal OrdaX é a camada de orquestração pessoal do OrdaX OS. Ela organiza trabalho explícito do usuário, preserva contexto e resultados, mostra atividade e prepara a evolução futura para trabalho retomável, ferramentas autorizadas, workers especializados e execução híbrida sem criar uma segunda identidade, uma segunda Memory, um segundo sistema de projetos ou uma segunda camada de permissões.

```text
Usuário
  |
  v
Personal OrdaX
  |
  +-- identitySession canônica
  +-- Space selection canônica
  +-- Projects canônicos
  +-- OrdaX Memory canônica
  +-- OrdaX Intelligence canônica
  +-- grants / Action Gateway existentes
  |
  v
Work -> Activity -> Result
```

## Regras estruturais

- Work pertence exatamente ao owner ativo: dispositivo local ou conta autenticada.
- Space e Project são vínculos opcionais e explícitos; a composição não os infere silenciosamente.
- Work, Activity e Result usam uma partição separada por owner.
- Resultado de Intelligence tem `authority=none`; texto de modelo nunca vira permissão.
- A conclusão foreground publica Work concluído + Result + Activity de conclusão em uma única transição validada.
- Corrupção persistida não é apagada nem convertida silenciosamente em estado vazio.
- O store Native é device-local; ele não é Memory e não é account sync.
- Troca de owner ou invalidação do contexto pausa trabalho ativo e impede reaproveitamento indevido de resultado em voo.
- Background, execução de tools, cloud computer e specialist workers continuam desabilitados nesta fase.
- O Assistant não transforma mensagens automaticamente em Work. A entrada de Work será sempre uma ação explícita do usuário.

## Composição atual

A implementação Native passa a montar o runtime com as portas já existentes:

```text
identitySession
      +
spaceSelection
      +
projects
      +
selectedSpaceIntelligence
      +
createNativePersonalOrdaxStore(window)
      |
      v
createPersonalOrdaxRuntime(...)
```

Nenhuma dessas capacidades é duplicada dentro do Personal OrdaX.

## Ordem de execução

1. **Fundação de contratos** — Work, Activity, Action Decision e Work Result.
2. **Runtime foreground owner-bound** — lifecycle, isolamento, pausa por troca de contexto e descarte de inferência obsoleta.
3. **Persistência Native por owner** — armazenamento bounded, fallback de sessão explícito e corrupção fail-closed.
4. **Composição Native** — reutilizar identitySession, Space selection, Projects e Intelligence canônicos.
5. **Entrada explícita de Work** — implementada no app Atividade como ação deliberada; conversas comuns não são convertidas automaticamente.
6. **Activity/Result Surface** — implementada como projeção do runtime canônico, sem task store dentro do app.
7. **Approvals/Action Gateway** — lifecycle persistido e gateway de decisão owner/context/grant-bound em implementação; side effects continuam desabilitados.
8. **Background retomável** — somente depois de persistência/recovery e revogação estarem provados.
9. **Workers especializados e híbrido local/cloud** — sempre sob o mesmo owner, Memory e autoridade.

## Critério para a próxima camada

A camada atual só avança quando os testes provarem que:

- sign-out ou troca de conta não expõe Work/Result de outro owner;
- Space/Project inválido não pode ser usado para continuar trabalho;
- reinício Native restaura apenas a partição correta;
- corrupção de um owner não destrói os bytes nem bloqueia os demais;
- Work concluído nunca fica observável sem seu Result e sua Activity correspondente;
- dispose remove subscriptions e impede trabalho novo;
- nenhum adapter concreto vaza para o service runtime;
- nenhuma conversa do Assistant cria Work sem ação explícita.

## Estado desta execução

A composição Native dedicada está montada em `system/composition/native/personal-ordax.mjs` e é criada por `system/composition/native/main.mjs`. Ela cria o store Native, injeta somente as portas canônicas no runtime e participa do lifecycle com `dispose()`. O app `system/apps/activity/` é a entrada explícita de Work e projeta Work, Activity, Result e aprovação diretamente do runtime, sem persistência própria. A camada de approvals agora persiste request/resolution/decision e o Action Gateway só libera ações `read`/`write` quando um Intelligence tool grant existente corresponde exatamente a owner, Space, Project, tool, action e modo. Grant ausente mantém `approval-required`; grant inválido, expirado ou de outro contexto produz `deny`. `external-egress` e `device-control` não podem ser promovidos por um tool grant genérico e permanecem bloqueados até suas autoridades específicas existirem na composition. O gateway ainda não executa side effects. O próximo corte é ligar um emissor/registro confiável de grants existente à composição antes de habilitar qualquer execução.

O Personal OrdaX ainda não é autoridade autônoma do MVP público. O Stable/MVP continua com Intelligence consultativa até promoção explícita pelos gates do projeto.
