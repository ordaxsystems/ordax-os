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
7. **Approvals/Action Gateway** — lifecycle persistido, gateway owner/context/grant-bound, autoridade canônica de grants e consentimento humano explícito já conectados; side effects continuam desabilitados.
8. **Execução tipada autorizada** — contrato e serviço `ordax.action-executor/1` implementados com revalidação imediata; nenhum adapter Native real é registrado ainda.
9. **Background retomável** — somente depois de persistência/recovery e revogação estarem provados.
10. **Workers especializados e híbrido local/cloud** — sempre sob o mesmo owner, Memory e autoridade.

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

A composição Native dedicada está montada em `system/composition/native/personal-ordax.mjs` e é criada por `system/composition/native/main.mjs`. Ela cria o store Native, injeta somente as portas canônicas no runtime e participa do lifecycle com `dispose()`. O app `system/apps/activity/` é a entrada explícita de Work e projeta Work, Activity, Result e aprovação diretamente do runtime, sem persistência própria. A camada de approvals agora persiste request/resolution/decision e o Action Gateway só libera ações `read`/`write` quando um Intelligence tool grant existente corresponde exatamente a owner, Space, Project, tool, action e modo. Grant ausente mantém `approval-required`; grant inválido, expirado ou de outro contexto produz `deny`. `external-egress` e `device-control` não podem ser promovidos por um tool grant genérico e permanecem bloqueados até suas autoridades específicas existirem na composition. O gateway ainda não executa side effects. A composição Native cria uma autoridade canônica de tool grants com registry somente-leitura e issuer separado: o Personal OrdaX recebe o resolver do registry e o app Atividade recebe apenas `ordax.personal-approval-consent/1`, nunca o issuer. O botão explícito **Aprovar** só aparece quando o controller resolve a approval para uma tool/action tipada compatível; quando disponível, ele pode emitir um único grant curto e exato para `read|write` e resolver a aprovação. A composição Native principal ainda não registra uma tool Personal OrdaX, então esse preflight permanece fail-closed em vez de exibir aprovação falsa. **Negar** produz uma decisão terminal auditável sem grant. Se o contexto mudar ou a resolução falhar depois da emissão, o grant recém-criado é revogado para não deixar autoridade órfã. `external-egress` e `device-control` continuam fora desse caminho. O contrato `ordax.action-executor/1` já existe, mas não há executor concreto nem side effect. O próximo corte é registrar o primeiro adapter tool/action tipado real, revalidar grant/context imediatamente antes do efeito e persistir o receipt na Activity.

O Personal OrdaX ainda não é autoridade autônoma do MVP público. O Stable/MVP continua com Intelligence consultativa até promoção explícita pelos gates do projeto.


## Gate atual: recurso exato antes do efeito

A autorização sensível agora é vinculada também ao `resourceRef` exato e ao id da approval que
originou o grant. O Action Gateway rejeita reutilização do grant em outro recurso/aprovação. O
Action Executor revalida essa autoridade imediatamente antes de resolver o adapter e produz
`ordax.action-receipt/1` quando um adapter tipado conclui.

Ainda não há side effect habilitado na composição Native. O próximo adapter só será registrado
quando sua identidade de artefato puder ser verificada de forma real; não será usado SHA fictício,
tool genérica, shell ou atalho pelo host.

A autoridade sensível também fica presa ao SHA-256 exato do artefato da tool. A approval retém essa identidade, o grant a copia, o Action Gateway compara com a tool atualmente resolvida e o Action Executor compara novamente com o adapter imediatamente antes do efeito. Trocar a implementação mantendo apenas o mesmo `toolId/action` invalida a autorização existente.

### Primeiro adapter Native first-party

O primeiro adapter concreto é `ordax-native-file-space/files.directory.ensure`. Ele usa somente o `fileSpace` canônico já montado na Surface, não expõe shell nem broker genérico e não recebe caminho fora de `file-space:`. A operação é deliberadamente idempotente: se o diretório exato já existir, a mesma execução termina com sucesso sem repetir mutação; se existir outro tipo de entrada no alvo, falha fechado.

A identidade do adapter é o SHA-256 calculado sobre os bytes reais do próprio módulo servido pela mesma origem via Web Crypto. Essa identidade entra na tool e, pelo gate anterior, precisa coincidir com approval, grant, Action Gateway e Action Executor. A composição Native já registra essa tool para o fluxo de aprovação, mas ainda não conecta o `adapterResolver` ao Action Executor; portanto este corte continua sem habilitar side effect do Personal OrdaX.

### Lifecycle foreground da ação

A approval aprovada agora pode entrar explicitamente em execução foreground. O runtime persiste `action-started`, mantém a approval como `approved` durante a tentativa e só a transforma em `executed` quando recebe um `ordax.action-receipt/1` com status `succeeded` que coincide exatamente com Work, approval, tool, SHA-256 do artefato, action, effect, recurso e grant retidos. A mesma approval não pode ser executada novamente depois desse consumo.

Falha sem receipt verificado pausa o Work sem consumir a approval. A retomada/reexecução continua sendo explícita e foi desenhada para adapters idempotentes, começando por `files.directory.ensure`. Este corte ainda não conecta o adapter Native ao Action Executor na composição principal; o lifecycle está pronto antes de abrir o efeito.

### Primeiro side effect foreground habilitado

A composição Native agora conecta exclusivamente o adapter verificado `ordax-native-file-space/files.directory.ensure` ao Action Executor. A Activity só oferece execução depois de approval humana explícita e somente quando o adapter atual tem o mesmo SHA-256 retido pela approval. O grant também é preso ao `workItemId` exato.

A execução faz `approved -> running -> executed`, persiste `action-started/action-finished` e consome a approval apenas com receipt `succeeded` exato. Enquanto existir uma ação aprovada não consumida, o Work não pode iniciar novo raciocínio nem pedir outra approval. Cancelar o Work revoga primeiro o grant no registry e retém a approval como `revoked` para auditoria.

O escopo de side effect habilitado continua deliberadamente único: garantir um diretório dentro do `file-space` canônico. Background, egress, device-control, shell, raw disk e execução genérica continuam desabilitados.

### Action Catalog canônico

A entrada de novas ações não fica hardcoded na Activity. Adapters first-party registram descritores bounded no `ordax.personal-action-catalog/1`; a UI recebe apenas metadados públicos e um `resourceValue` humano. A própria registration converte e valida esse valor para o `resourceRef` canônico antes de criar uma approval. O catálogo não emite grant, não executa adapter e não transforma conteúdo de modelo em autoridade.

O primeiro registro é `native-file.ensure-directory`. A Activity pode solicitar approval para ele sem conhecer `file-space:`, tool IDs ou regras de filesystem. Decisions persistidas agora carregam o `approvalId` exato. Isso permite repetir o mesmo tipo de ação no mesmo Work em recursos diferentes, desde que cada tentativa tenha uma nova approval e um novo grant compatível.

Propostas estruturadas vindas do modelo continuam desabilitadas neste corte. Quando forem adicionadas, deverão entrar pelo mesmo catálogo e permanecer sem autoridade até approval explícita.

### Revogação ligada ao lifecycle

Um runtime com Action Gateway agora é inválido sem um revoker de grants. A revogação deixou de ser responsabilidade da UI/composição e passou a fazer parte do lifecycle canônico do Personal OrdaX.

Qualquer grant aprovado e ainda não consumido é revogado antes de invalidar seu contexto por troca de owner, logout, troca de Space, desaparecimento do projeto ou cancelamento explícito do Work. Isso também vale para Work já pausado após uma tentativa de execução: estar pausado não mantém authority viva. A approval permanece como `revoked` com seu `grantRef` apenas para auditoria; o registry já não resolve esse grant.

### Action Attempt journal e crash recovery

Cada side effect foreground passa a ter um `ordax.personal-action-attempt/1` persistido antes da entrada no adapter. O Attempt liga Work, approval, action, tool artifact, effect, resource e grant exatos.

O executor diferencia falha comprovadamente anterior ao adapter de falha depois de entrar no adapter. A primeira fecha o Attempt como `failed`, pausa o Work e preserva a approval para retry explícito. Depois de entrar no adapter, ausência de receipt verificável fecha como `uncertain`, revoga o grant e pausa o Work. Não existe replay automático de outcome incerto.

Se o processo cair com Attempt `started`, o restore converte esse Attempt para `uncertain` antes de expor o runtime, revoga a authority session-only e mantém o Work pausado. A Activity projeta esse estado para o usuário. Esse protocolo é pré-requisito para qualquer futura mutação não idempotente; rename/move/trash continuam desabilitados neste corte.

Decision e Action Executor também exigem o mesmo `approvalId` exato, além de Work/action/effect/grant, impedindo substituição entre approvals do mesmo tipo de ação.
