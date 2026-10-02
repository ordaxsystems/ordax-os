# Personal OrdaX — plano canônico de implementação

Status: **FOREGROUND NATIVO IMPLEMENTADO / BACKGROUND E AUTONOMIA PÚBLICA DESABILITADOS**

Este arquivo na raiz é a referência curta e canônica para **o que o Personal OrdaX é, o que já foi implementado e o que será implementado a seguir**. Ele consolida as conclusões dos relatórios já produzidos para o projeto e o estado real do código. O contrato detalhado permanece em `docs/PERSONAL-ORDAX.md` e as invariantes legíveis por máquina em `docs/contracts/personal-ordax.json`.

## Direção consolidada dos relatórios

O OrdaX OS deve evoluir para um sistema pessoal inteligente e escalável, mas não para um modelo que dê autoridade irrestrita ao LLM.

A direção adotada é:

- um **Personal OrdaX persistente** como orquestrador do trabalho do usuário;
- **Work + Activity + Result** como modelo visível e retomável de execução;
- **Spaces e Projects** como escopo explícito, nunca inferido silenciosamente;
- **OrdaX Memory** como memória canônica, sem memória paralela por agente;
- **Intelligence** para raciocínio e planejamento, mas sem transformar texto de modelo em permissão;
- **Action Catalog + Approvals + Grants + Action Gateway** para qualquer efeito real;
- experiência **local-first**, com execução híbrida local/Edge/cloud somente em fases posteriores;
- **workers especializados** no futuro, herdando owner, escopo e autoridade do Personal OrdaX;
- Activity como superfície de transparência: o usuário deve conseguir ver o que está acontecendo, o que foi aprovado, o que foi executado e por quê;
- background somente depois de persistência, recovery, cancelamento e revogação estarem comprovados.

O sistema não deve depender de um único modelo, backend ou cloud computer.

## Arquitetura alvo

```text
Usuário
  |
  v
Personal OrdaX
  |
  +-- identitySession canônica
  +-- Spaces / Projects canônicos
  +-- OrdaX Memory canônica
  +-- OrdaX Intelligence canônica
  +-- Action Catalog
  +-- Approval Consent
  +-- Grants / Action Gateway
  +-- Action Executor
  |
  +--> Work
  +--> Activity
  +--> Result
  |
  v
Adapters first-party bounded
  |
  +--> capacidades locais
  +--> conectores autorizados (futuro)
  +--> workers especializados (futuro)
  +--> execução híbrida (futuro)
```

Personal OrdaX é **orquestração**, não uma segunda identidade, uma segunda Memory, um segundo sistema de Projects ou uma segunda camada de permissões.

## Invariantes que não podem ser quebradas

1. Prompt, modelo, Profile, Memory, conteúdo de Project ou texto de conversa **não criam autoridade**.
2. Work pertence exatamente ao owner ativo.
3. Space e Project são opcionais, mas qualquer vínculo é explícito.
4. Resultado de Intelligence permanece `authority=none`.
5. Side effect sensível exige approval/grant compatível e revalidação imediatamente antes do efeito.
6. Grant é preso ao Work, approval, owner, contexto, recurso, tool/action e SHA-256 do artefato aprovado.
7. Troca de owner, logout ou invalidação de contexto revoga authority ainda não consumida.
8. Corrupção persistida é fail-closed e não pode ser apagada silenciosamente.
9. Work/Activity/Result não são Memory e não são account sync.
10. Nenhuma conversa comum do Assistant cria Work ou executa ação automaticamente.
11. Não haverá shell genérico, raw disk, release keys ou broker genérico como atalho de implementação.
12. Background não será habilitado antes de recovery e revogação estarem comprovados.

## Implementado até o corte atual

### Fundação de Work

Já existem contratos e runtime para:

- `ordax.personal-work-item/1`;
- `ordax.personal-activity/1`;
- `ordax.personal-work-result/1`;
- `ordax.personal-action-decision/1`;
- store owner-partitioned e bounded;
- lifecycle foreground;
- isolamento por owner;
- pausa por troca/invalidação de contexto;
- descarte de inferência obsoleta;
- publicação atômica de Work concluído + Result + Activity.

### Persistência Native

O Personal OrdaX possui store Native device-local por owner.

- corrupção de uma partição bloqueia somente aquele owner;
- bytes corrompidos recuperáveis não são sobrescritos;
- fallback de sessão é explícito e não é chamado de persistência durável;
- Work state continua separado de Memory e de account sync.

### Activity / Work Surface

O app first-party `system/apps/activity/`:

- cria Work somente por ação explícita do usuário;
- projeta Work, Activity, Result e approvals do runtime canônico;
- não possui task/result store paralelo;
- permite pause/resume/cancel/remove conforme o estado do Work;
- não converte mensagens do Assistant automaticamente em Work;
- exporta explicitamente o histórico do owner atual para JSON em `/Downloads` no Native;
- o export usa schema próprio, remove referências de grant e não pode ser reimportado como authority.

### Authority e approvals

O fluxo já possui:

- approval persistida;
- consentimento humano explícito;
- tool grants bounded;
- Action Gateway;
- Action Executor;
- revalidação de owner/context/recurso/tool/action/artefato;
- receipt de execução;
- bloqueio de replay;
- retry explícito para adapter idempotente;
- revogação auditável.

Action Decisions agora apontam para o `approvalId` exato, permitindo repetir o mesmo tipo de ação em recursos diferentes somente através de novas approvals.

### Action Catalog

Existe `ordax.personal-action-catalog/1`.

A Activity não conhece regras internas de filesystem nem IDs privados de tool. Adapters first-party registram ações bounded; a UI envia `entryId + resourceValue`; a registration canonicaliza e valida o recurso antes de criar uma approval.

O catálogo:

- não emite grant;
- não executa adapter;
- não transforma saída de modelo em authority.

### Primeiro side effect real

O único side effect Personal OrdaX habilitado neste momento é:

```text
native-file.ensure-directory
  -> ordax-native-file-space
  -> files.directory.ensure
  -> fileSpace canônico
```

Ele é foreground, explícito e idempotente.

O caminho é:

```text
Activity
  -> solicitar approval
  -> aprovação humana
  -> grant exato
  -> clique "Executar ação aprovada"
  -> Action Gateway
  -> Action Executor
  -> adapter Native verificado
  -> receipt succeeded
  -> approval executed
  -> Activity action-finished
```

### Revogação de authority

Authority aprovada e ainda não consumida é revogada quando:

- o Work é cancelado;
- ocorre logout;
- muda o owner;
- o Space bound deixa de ser válido;
- o Project bound deixa de ser válido;
- o contexto muda de forma incompatível.

O runtime com Action Gateway deve possuir revoker; caso contrário, a composição falha fechado.

Na restauração Native, approval persistida como `approved` não pode recuperar authority de uma sessão anterior. Se o grant session-only já não existe, ela é reconciliada para `revoked`, mantendo o Work recuperável para uma nova approval.

## Estado por fase

### Fase 1 — foreground visível e autorizado — **CONCLUÍDA**

Já estão implementados e montados no Native:

- Work/Activity/Result owner-bound;
- persistência device-local particionada por owner;
- pausa por troca/invalidação de owner/Space/Project;
- Activity visível;
- approvals/denials explícitos;
- grants bounded;
- Action Gateway + Action Executor;
- primeiro adapter first-party verificado;
- receipt + bloqueio de replay;
- revogação por lifecycle;
- Action Attempt journal crash-safe;
- retomada explícita de Work pausado.

### Fase 2 — continuidade durável — **PARCIAL**

Já existe:

- durable Work/Activity/Result/Approval/Attempt por owner no Native;
- restore de estado após reconstrução do runtime;
- `started` restaurado vira `uncertain`, revoga authority e pausa;
- approval session-only sem grant vivo é reconciliada para `revoked`;
- cancelamento/revogação impede uso posterior;
- estado operacional continua separado de account sync;
- política/fluxo de export do histórico de Activity implementado no Native, por ação explícita e sem authority reimportável.

Ainda falta nesta fase:

- política real de background execution;
- lifecycle/budgets/leases de background;
- connectors com egress explícito.

### Action Proposal sem authority — **CONTRATO/PATH SOURCE IMPLEMENTADO**

O value contract `ordax.personal-action-proposal/1` e a porta Native
`proposeAvailableAction()` agora existem. A proposal é validada contra uma entrada real do Action
Catalog e contra a mesma validação de recurso da registration, mas contém somente
`workItemId + entryId + resourceValue + rationale`.

Ela fixa:
- `authority=none`;
- `executionAuthorized=false`;
- `approvalRequested=false`.

Ela não pode carregar `toolId`, `actionId`, `resourceRef`, grant, approval, decision, effect ou
artifact SHA. O catálogo descarta a referência canônica produzida durante a validação do recurso.

**Planner/model integration foreground agora está implementada.** A Activity possui uma ação
explícita para pedir uma sugestão à OrdaX Intelligence. O planner entrega ao modelo somente a
projeção sanitizada `entryId + inputKind + resourceScheme`, exige JSON estrito e passa qualquer
candidato novamente pelo Action Catalog. Tool ID, action ID, effect, artifact SHA, grant e approval
não entram no prompt de planejamento.

```text
goal do Work
  -> clique explícito "Sugerir ação"
  -> Intelligence / planner
  -> Action Proposal (authority=none)
  -> Activity mostra proposta efêmera
  -> clique explícito "Solicitar aprovação"
  -> Action Catalog revalida/canonicaliza de novo
  -> approval -> grant -> execução
```

Troca de owner ou mudança do Work durante a inferência invalida a resposta tardia. O rationale do
modelo é somente apresentação; ao converter a proposal em approval, o reason confiável continua
vindo da registration do catálogo. Não existe proposal -> approval automático nem proposal ->
execução automática.

### Ampliação de ações first-party bounded

Novas ações entram uma por vez. Cada uma precisa de:

- contrato tipado;
- recurso canônico;
- efeito declarado;
- adapter first-party;
- identidade verificável de artefato;
- semântica de retry conhecida;
- comportamento de crash/recovery conhecido;
- testes de substituição/replay;
- Activity/receipt auditáveis.

Não será criada API paralela apenas para acelerar uma feature.

### Background bounded — **NÃO HABILITADO**

Só pode avançar depois de policy explícita para:

- budgets;
- timeout;
- cancelamento;
- revogação imediata;
- recovery;
- Activity visível;
- nenhuma authority implícita;
- nenhuma execução ilimitada.

### Connectors / external egress — **NÃO HABILITADO**

External egress terá autoridade própria. Cada conector deverá declarar destino, operação, dados
enviados, owner, Space/Project, approval/grant, receipt e política de revogação.

### Workers especializados — **NÃO HABILITADO**

Workers futuros herdam owner, Space/Project, Memory, catálogo e grants do Personal OrdaX. Não
existirá worker-owned Memory ou permission system paralelo.

### Execução híbrida local / Edge / cloud — **NÃO HABILITADA**

Placement futuro poderá considerar privacidade, disponibilidade, custo, latência, necessidade de
hardware local e estado offline. Cloud nunca ganha autoridade local apenas por executar um modelo.

## Experiência alvo

A experiência final pretendida é algo como:

> "Continue o projeto da pizzaria."

O Personal OrdaX deverá conseguir:

1. identificar o owner correto;
2. recuperar o Work/Space/Project correto sem misturar contas;
3. recuperar contexto pela Memory canônica quando apropriado;
4. mostrar na Activity o que pretende fazer;
5. continuar raciocínio sem pedir permissão para operações puramente consultativas;
6. pedir approval somente quando houver um efeito que exige authority;
7. executar apenas a ação aprovada;
8. registrar receipt/resultados;
9. pausar e retomar depois de reboot;
10. continuar funcionando mesmo que o modelo ou backend de Intelligence seja trocado.

## Fora do escopo atual

Continuam desabilitados até seus gates específicos:

- background autônomo;
- external egress genérico;
- device-control genérico;
- shell genérico;
- raw disk;
- acesso a release keys;
- cloud computer como requisito de arquitetura;
- execução automática baseada apenas em texto do modelo;
- specialist workers autônomos;
- multi-agent irrestrito.

## Regra de evolução

A ordem é deliberada:

```text
Work visível
  -> Result
  -> Approval
  -> Authority
  -> primeiro efeito bounded
  -> revogação/recovery
  -> propostas sem authority
  -> mais ações bounded
  -> durable/resumable
  -> background
  -> connectors
  -> specialist workers
  -> hybrid execution
```

Nenhuma fase posterior deve enfraquecer os contratos das fases anteriores.

O objetivo não é apenas tornar o OrdaX "mais autônomo". O objetivo é torná-lo **mais capaz, retomável e escalável sem perder owner, contexto, auditabilidade e controle humano**.
