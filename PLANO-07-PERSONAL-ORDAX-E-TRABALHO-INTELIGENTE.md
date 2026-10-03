# Plano 07 — Personal OrdaX e trabalho inteligente evolutivo

> **Status:** EXECUÇÃO EM ANDAMENTO / FOREGROUND PROMOVIDO / AUTOMAÇÃO PÚBLICA AINDA DESABILITADA
>
> Este documento consolida a direção executável do Personal OrdaX. Ele não concede autoridade e não substitui os contratos canônicos, `PERSONAL-ORDAX.md`, `docs/ARCHITECTURE.md`, `docs/CURRENT-STATE.md`, `docs/SYSTEM-FOUNDATION.md` ou os promotion gates.

## 1. Resultado que queremos

O OrdaX deve evoluir de um sistema que responde a comandos para um sistema pessoal capaz de **entender trabalho, manter continuidade, mostrar o que está fazendo e executar ações limitadas com autoridade explícita**.

A experiência-alvo é:

```text
usuário
  -> cria ou retoma um trabalho
  -> OrdaX recupera owner + Space + projeto corretos
  -> entende o objetivo e o estado atual
  -> mostra plano/progresso na Activity
  -> pede aprovação quando uma ação real exige autoridade
  -> executa somente a ação aprovada
  -> registra resultado e evidência
  -> pode continuar depois sem perder contexto
```

Exemplo:

> “Continue o projeto da pizzaria.”

O Personal OrdaX deve localizar o Work correto do owner atual, respeitar o Space/projeto explicitamente ligado, recuperar somente o contexto permitido, mostrar o que pretende fazer e pedir aprovação para qualquer efeito sensível.

## 2. O princípio central

**Inteligência não é autoridade.**

Prompt, modelo, Profile, Memory, conteúdo de projeto e sugestões do planner podem ajudar a decidir **o que propor**, mas nunca criam permissão para executar.

A cadeia permanente é:

```text
objetivo
 -> planejamento
 -> proposta de ação sem autoridade
 -> Action Catalog canônico
 -> Action Policy / Action Review
 -> approval explícita quando necessária
 -> grant exato
 -> Action Gateway
 -> Action Executor
 -> adapter first-party verificado
 -> capability canônica
 -> receipt
 -> Activity / Result
```

Nenhum modelo recebe shell genérico, disco RAW, chaves de release ou acesso irrestrito ao sistema.

## 3. Estado real já implementado

A fundação já estabelecida inclui:

- Work owner-bound, com Activity e Results persistíveis;
- recuperação semântica de Work sem troca automática de owner/Space/Project;
- Action Proposal via Intelligence, sempre `authority=none`;
- armazenamento Native particionado por owner e corrupção fail-closed;
- composição com Identity, Spaces, Projects, Memory e Intelligence canônicos;
- app Activity first-party como superfície explícita de Work;
- mensagens comuns do Assistant não viram Work automaticamente;
- approvals persistidas e consentimento explícito;
- grants limitados por Work, approval, owner, contexto, recurso, tool, artefato e efeito;
- Action Catalog, Action Policy, Action Review, Action Gateway e Action Executor separados;
- identidade SHA-256 do artefato da tool;
- lifecycle `approved -> running -> executed` com receipt;
- replay bloqueado e retry limitado por semântica idempotente;
- primeiro side effect Native bounded (`native-file.ensure-directory`);
- revogação de authority em cancelamento, troca de owner, contexto inválido e restore sem grant vivo;
- System Foundation com Capability Registry, lifecycle graph, eventos bounded e agregação restritiva de policy;
- Background Runtime de sistema com budgets, leases, heartbeat, deadline, cancelamento, checkpoint e recovery fail-closed;
- Scheduler de sistema com timezone IANA, one-shot/fixed-interval, `maxRuns`, transactional outbox e deduplicação;
- criação idempotente de Background Run por trigger;
- dispatch Scheduler -> Background com revalidação de consumer, subject, owner, Space/project e deduplication key;
- Proactive Research local/read-only como workload `authority=none`;
- owner Native atômico para metadados de automação e adapter JS assíncrono sem estado espelho.

Importante: **fundação implementada não significa feature pública ativada**. O Personal OrdaX ainda não cria schedules/background automaticamente, Proactive Research ainda não está exposto como autonomia pública e a rota de Automation State ainda precisa ser ligada ao host Native de produção.

## 4. Fases

### Fase A — foreground seguro — **CONCLUÍDA**

Inclui Work/Activity/Result, owner isolation, Action Catalog, approvals, grants, Gateway, Executor, receipt, primeiro adapter bounded, revogação, crash-safe attempt journal e retomada explícita.

**Gate permanente:** nenhuma ação pode escapar de Work/owner/context/recurso/artefato/policy/authority autorizados.

### Fase B — planner de ações sem autoridade — **CONCLUÍDA NO FOREGROUND**

O planner usa somente entradas reais do Action Catalog e retorna proposta estruturada sem tool/grant/approval ocultos. Proposal nunca equivale a approval ou execução.

### Fase C — continuidade real de Work — **MAJORITARIAMENTE IMPLEMENTADA**

Já existem restore, recovery fail-closed, Activity/Result duráveis, export, revogação após restore, recuperação semântica e separação explícita entre Work e Memory/account sync.

Ainda precisa amadurecer:

- persistência Native do Personal sem `localStorage` como source of truth;
- migração owner-bound conservadora para o novo owner Native;
- continuidade de Work entre dispositivos como domínio separado de Memory sync.

### Fase D — background bounded — **FUNDAÇÃO DE SISTEMA IMPLEMENTADA / PERSONAL PÚBLICO DESABILITADO**

Já existem na raiz:

- lifecycle de Background;
- budgets de tempo, passos, ações e egress;
- leases/heartbeat/expiry;
- deadline e cancelamento;
- checkpoints bounded;
- recovery fail-closed;
- Scheduler durável;
- transactional outbox;
- deduplication/idempotência;
- Scheduler -> Background dispatch authority-free;
- owner Native atômico para automation metadata;
- adapter JS assíncrono sem cache espelho.

Ainda falta para habilitar no Personal:

1. ligar a rota tipada `/__ordax/native/automation-state` no `native_host_server.py` e provar GET/POST/CAS no host real;
2. compor stores Native no boot sem fallback que finja durabilidade;
3. definir policy de quais Works podem ser agendados/background;
4. projetar status de Scheduled/In Progress/Needs You na Activity;
5. revalidar owner/Space/Project/policy/authority em cada wake/resume;
6. provar reboot/cancel/revoke de ponta a ponta no runtime composto;
7. manter background público desligado até esses gates passarem.

Scheduler apenas acorda trabalho. Scheduler e Background nunca emitem grant.

### Fase E — Proactive Research e conectores — **LOCAL READ-ONLY SOURCE IMPLEMENTADO / EGRESS DESABILITADO**

Proactive Research local já pode consumir fontes explicitamente read-only e non-network como Memory autorizada, Work, Project, file metadata e system status.

Ainda não estão habilitados:

- web pública;
- email/cloud connectors;
- arbitrary file content;
- writes;
- envio/publicação;
- device control.

Conectores futuros deverão ser tipados por domínio/capability. External egress terá efeito e policy próprios, secrets ficarão fora de prompt/Memory/Activity e toda mutação continuará passando pela mesma cadeia de authority.

### Fase F — workers especialistas — **NÃO HABILITADA**

Workers futuros:

- herdam owner e escopo do Work;
- não possuem Memory paralela;
- não criam grants;
- não possuem permission system separado;
- têm budgets, concorrência e profundidade de delegação limitados;
- aparecem na Activity com atribuição;
- produzem Results com provenance;
- usam o mesmo Action Catalog/Gateway.

O Personal OrdaX permanece o orquestrador; workers são executores especializados e substituíveis.

### Fase G — execução híbrida local / Edge / cloud — **NÃO HABILITADA**

Placement futuro poderá considerar privacidade, disponibilidade, custo, latência, capacidade local e conectividade. O backend pode mudar, mas Work, Activity, Result, policy, approval e authority mantêm o mesmo significado.

Cloud nunca ganha authority local automaticamente.

## 5. Relação com Assistant, Memory, Projects e Profiles

O Personal OrdaX **não substitui** esses sistemas.

```text
Assistant
  -> conversa

Memory
  -> contexto pessoal permitido

Spaces / Projects
  -> escopo organizacional

Profiles
  -> especialização/configuração

Intelligence
  -> raciocínio

System Foundation
  -> capabilities + lifecycle + events + restrictive policy

Scheduler / Background
  -> quando e como continuar trabalho bounded, sem authority

Personal OrdaX
  -> Work + Activity + Result + orquestração

Action Gateway
  -> authority para efeitos reais
```

Apps consomem capacidades do sistema; não são o sistema.

## 6. Experiência de produto pretendida

A Activity deve responder claramente:

- qual Work está ativo;
- de quem é o Work;
- qual Space/projeto está ligado;
- o que já aconteceu;
- qual resultado foi produzido;
- qual ação está sendo proposta;
- por que uma approval é necessária;
- exatamente qual recurso será afetado;
- se a ação executou, falhou, foi revogada ou precisa de retry;
- se o Work está Scheduled, In Progress, Needs You, Paused ou Completed;
- qual budget/lease/checkpoint é relevante sem expor logs técnicos crus;
- como pausar, cancelar, retomar, desabilitar agenda ou remover o Work.

## 7. O que não será implementado como atalho

Ficam proibidos como solução rápida:

- shell genérico entregue ao modelo;
- escrita RAW genérica;
- permissão criada por prompt;
- tool inventada pelo modelo;
- grants armazenados em Memory;
- banco paralelo de tasks dentro da Activity;
- segunda identidade para agentes/workers;
- autoexecução de ações sensíveis;
- approval global “sempre permitir tudo”;
- parsing frágil de texto do modelo como comando privilegiado;
- background irrestrito;
- cache JS espelho apresentado como persistência Native;
- XHR síncrono para esconder contrato assíncrono;
- cloud computer como requisito do MVP;
- copiar arquitetura externa inteira para dentro do OrdaX.

## 8. Ordem de execução a partir do estado atual

```text
1. concluir owner Native + migração segura do estado do Personal
2. ligar e provar a rota Native de Automation State
3. compor Scheduler/Background com persistência Native real no boot
4. compor Proactive Research local como primeiro workload background read-only
5. evoluir Activity para Scheduled / In Progress / Needs You / Completed
6. provar reboot, cancelamento, revogação e recovery end-to-end
7. somente então habilitar background bounded no Personal
8. adicionar conectores tipados e egress governado
9. expandir ações first-party uma por vez
10. ativar semantic Memory/index derivado quando o backend persistente estiver pronto
11. adicionar workers especialistas bounded
12. adicionar browser/computer sandbox e placement híbrido depois
```

Cada passo deve ser pequeno, testável e reversível sem quebrar o contrato anterior.

## 9. Critérios para promoção

O Personal OrdaX só deve ser considerado pronto para automação pública quando for demonstrável que:

1. owner switching não mistura Work, Activity, Result, schedule, run ou grants;
2. Space/project switching não retargeta trabalho silenciosamente;
3. modelo/prompt/Memory/Profile não criam authority;
4. ações reais passam por policy/review, catálogo, approval/grant quando exigido, Gateway e adapter tipado;
5. artefato executado é o artefato aprovado;
6. grants são revogados quando contexto ou owner deixa de ser válido;
7. reboot/crash não ressuscita authority expirada;
8. retry de Scheduler/outbox não duplica Background Run nem efeitos;
9. Activity explica o estado real de foreground/background;
10. cancelamento impede ações futuras;
11. secrets não aparecem em prompt, Activity ou Result;
12. offline continua sendo modo suportado;
13. sistema funciona sem depender de um único modelo ou backend;
14. nenhum recurso público anuncia autonomia que ainda não existe;
15. a rota Native e os stores de produção provam durabilidade real, sem cache/fallback mascarando falha.

## 10. Definição de sucesso

A evolução estará no caminho correto quando o usuário puder dizer:

> “Continue o projeto da pizzaria e me avise amanhã se houver algo que precise de mim.”

E o OrdaX conseguir:

1. encontrar o Work correto daquele owner;
2. restaurar o Space/projeto correto sem inferência silenciosa;
3. mostrar o estado anterior;
4. raciocinar sobre o próximo passo;
5. propor somente ações disponíveis no catálogo;
6. agendar/continuar trabalho bounded sem ganhar authority;
7. pedir aprovação exatamente quando necessário;
8. executar somente o recurso aprovado;
9. registrar receipts, Activity, Result e checkpoints;
10. sobreviver a reboot/retry sem duplicar trabalho ou ressuscitar grants;
11. fazer tudo isso sem transformar inteligência em autoridade.

Esse é o núcleo do sistema inteligente e escalável: **continuidade + contexto + automação bounded + execução governada + componentes substituíveis**, em vez de um agente monolítico com acesso irrestrito.
