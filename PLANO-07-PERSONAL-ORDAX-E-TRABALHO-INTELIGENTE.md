# Plano 07 — Personal OrdaX e trabalho inteligente evolutivo

> **Status:** PLANO DE IMPLEMENTAÇÃO / EXECUÇÃO EM ANDAMENTO / NÃO PROMOVIDO AO MVP PÚBLICO
>
> Este documento consolida, em uma única direção executável, as conclusões dos relatórios de produto e arquitetura já produzidos para a evolução do OrdaX. Ele não autoriza capacidades por si só e não substitui os contratos canônicos, `PERSONAL-ORDAX.md`, `docs/ARCHITECTURE.md`, `docs/CURRENT-STATE.md` ou os promotion gates.

## 1. Resultado que queremos

O OrdaX deve evoluir de um sistema que responde a comandos para um sistema pessoal capaz de **entender trabalho, manter continuidade, mostrar o que está fazendo e executar ações limitadas com autoridade explícita**.

A experiência-alvo é simples:

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

Exemplo de produto:

> “Continue o projeto da pizzaria.”

O comportamento correto não é adivinhar. O Personal OrdaX deve localizar o Work correto do owner atual, respeitar o Space/projeto explicitamente ligado, recuperar o contexto permitido, mostrar o que pretende fazer e pedir aprovação para qualquer efeito sensível.

## 2. O princípio central

**Inteligência não é autoridade.**

Prompt, modelo, Profile, Memory, conteúdo de projeto e sugestões do planner podem ajudar a decidir **o que propor**, mas nunca criam permissão para executar.

A cadeia permanente será:

```text
objetivo
 -> planejamento
 -> proposta de ação sem autoridade
 -> Action Catalog canônico
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

## 3. Fundação já implementada nas branches de execução

A implementação atual já estabeleceu a base necessária para crescer sem criar um segundo sistema paralelo:

- Work owner-bound, com estado persistível e Activity ordenada;
- Results owner-bound com provenance e `authority=none`;
- armazenamento Native particionado por owner e corrupção fail-closed;
- composição Native usando identidade, Spaces, Projects e Intelligence canônicos;
- app Activity first-party como entrada explícita de Work;
- mensagens comuns do Assistente **não** viram Work automaticamente;
- Space e projeto não são ligados implicitamente;
- approvals persistidas e consentimento explícito;
- grants limitados por Work, approval, owner, contexto, recurso, tool, artefato e efeito;
- Action Gateway e Action Executor separados;
- identidade SHA-256 do artefato da tool;
- lifecycle `approved -> running -> executed` com receipt;
- replay bloqueado e retry limitado por semântica idempotente;
- primeiro side effect Native: garantir um diretório no `file-space` canônico;
- Action Catalog canônico, sem regras de filesystem dentro da Activity;
- revogação de authority em cancelamento, troca de owner, Space/projeto inválido e restore sem grant vivo.

Esses itens ainda devem passar pelos gates da cadeia de PRs antes de serem considerados parte promovida do produto.

## 4. O que será implementado

### Fase A — fechar o foreground seguro

Objetivo: tornar o Personal OrdaX útil para trabalho real curto sem background.

Implementar:

1. estabilizar Action Catalog e lifecycle de revogação;
2. manter uma única fonte de authority e grants;
3. melhorar a apresentação de approval, execução, falha e receipt na Activity;
4. tornar retry/recovery explícitos;
5. adicionar novas ações first-party somente quando a capability canônica tiver semântica segura e testável;
6. manter ações destrutivas fora até haver precondições, idempotência ou confirmação adequadas.

**Gate:** nenhuma ação pode escapar do Work/approval/grant/recurso/artefato autorizado.

### Fase B — planner de ações sem autoridade

Objetivo: permitir que a inteligência proponha próximos passos sem ganhar poder de execução.

Implementar um contrato estruturado de proposta que produza somente:

- intenção de ação;
- entrada para um `entryId` existente no Action Catalog;
- recurso candidato;
- explicação para o usuário;
- nenhuma credencial, grant ou chamada direta a adapter.

O planner não poderá inventar tools. Se o `entryId` não estiver no catálogo atual, a proposta será rejeitada.

**Gate:** proposta do modelo nunca é equivalente a approval.

### Fase C — continuidade real de Work

Objetivo: o usuário poder sair e voltar sem perder o trabalho.

Implementar:

- recuperação determinística do Work por owner;
- vínculo explícito e restaurável com Space/projeto;
- checkpoints de execução;
- estado de pausa/recovery após crash ou reboot;
- histórico de Activity e Results com retenção controlada;
- exportação e exclusão do histórico;
- reconciliação de grants session-only após restore;
- política clara para Work órfão quando Space/projeto deixa de existir.

Memory continuará sendo contexto do OrdaX, não o banco operacional de Work.

### Fase D — background bounded

Objetivo: permitir trabalhos demorados sem transformar o OrdaX em um agente irrestrito.

Somente depois dos gates anteriores:

- lifecycle explícito de background;
- orçamento de tempo, ações e recursos;
- cancelamento/revogação imediatos;
- pausa quando authority expira;
- Activity sempre visível;
- retomada após reboot apenas quando o estado puder ser reconciliado;
- nenhuma approval antiga reaproveitada fora de seu escopo.

Background continuará desabilitado no MVP até esses invariantes terem prova automatizada e operacional.

### Fase E — conectores e egress

Objetivo: permitir trabalho com serviços externos sem transformar rede em permissão genérica.

Implementar:

- conectores bounded por domínio/capability;
- external-egress como efeito explícito;
- segredo fora de prompt, Memory e Activity;
- grants por recurso e ação;
- receipts sem vazar tokens;
- revogação de conexão e authority;
- tratamento offline como estado normal.

Não haverá “internet livre” para o modelo como substituto de conectores governados.

### Fase F — workers especialistas

Objetivo: dividir trabalhos complexos sem criar múltiplos sistemas de identidade e permissão.

Workers futuros:

- herdam owner e escopo do Work;
- não possuem Memory própria paralela;
- não criam grants;
- não possuem sistema de permissões separado;
- têm budgets e concorrência limitados;
- aparecem na Activity com atribuição;
- produzem Results com provenance;
- usam o mesmo Action Catalog/Gateway.

O Personal OrdaX permanece o orquestrador; workers são executores especializados e substituíveis.

### Fase G — execução híbrida local / Edge / cloud

Objetivo: escolher onde processar sem mudar o contrato do trabalho.

Implementar política de placement considerando:

- privacidade;
- disponibilidade;
- custo;
- latência;
- capacidade local;
- conectividade.

O backend poderá mudar, mas Work, Activity, Result, approval e authority continuarão com o mesmo significado.

Cloud nunca ganha authority local automaticamente. Acesso a dispositivo continua dependendo de capability/grant do Device Agent/Native.

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

Personal OrdaX
  -> Work + Activity + Result + orquestração

Action Gateway
  -> authority para efeitos reais
```

Uma conversa pode ajudar o usuário a decidir criar um Work, mas não deve criar trabalho persistente ou side effect silenciosamente.

## 6. Experiência de produto pretendida

A Activity será o lugar onde o usuário entende o trabalho em andamento.

Ela deve responder claramente:

- qual Work está ativo;
- de quem é o Work;
- qual Space/projeto está ligado;
- o que já aconteceu;
- qual resultado foi produzido;
- qual ação está sendo proposta;
- por que uma approval é necessária;
- exatamente qual recurso será afetado;
- se a ação executou, falhou, foi revogada ou precisa de retry;
- como pausar, cancelar, retomar ou remover o Work.

O objetivo não é mostrar logs técnicos crus. É dar controle e confiança sem esconder eventos relevantes.

## 7. O que não será implementado como atalho

Para preservar a arquitetura, ficam proibidos como solução rápida:

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
- cloud computer como requisito do MVP;
- copiar arquitetura externa inteira para dentro do OrdaX.

## 8. Ordem de execução a partir do estado atual

```text
1. fechar CI + invariantes do Action Catalog
2. fechar revogação/recovery de authority
3. consolidar UX de proposal/approval/receipt
4. criar contrato de Action Proposal sem authority
5. integrar planner ao catálogo sem tools diretas
6. expandir ações first-party uma por vez
7. fechar continuidade/recovery durável
8. provar cancelamento/revogação em todos os boundaries
9. só então habilitar background bounded
10. depois conectores
11. depois workers especialistas
12. depois placement híbrido local/Edge/cloud
```

Cada passo deve ser pequeno, testável e reversível sem quebrar o contrato anterior.

## 9. Critérios para promoção

O Personal OrdaX só deve ser considerado pronto para promoção quando for demonstrável que:

1. owner switching não mistura Work, Activity, Result ou grants;
2. Space/project switching não retargeta trabalho silenciosamente;
3. modelo/prompt/Memory/Profile não criam authority;
4. ações reais passam pelo catálogo, approval/grant quando exigido, Gateway e adapter tipado;
5. artefato executado é o artefato aprovado;
6. grants são revogados quando contexto ou owner deixa de ser válido;
7. reboot/crash não ressuscita authority expirada;
8. retry não duplica efeitos perigosos;
9. Activity explica o estado real;
10. cancelamento impede ações futuras;
11. secrets não aparecem em prompt, Activity ou Result;
12. offline continua sendo um modo suportado;
13. o sistema funciona sem depender de um único modelo ou backend;
14. nenhum recurso público anuncia autonomia que ainda não existe.

## 10. Definição de sucesso

A evolução estará no caminho correto quando o usuário puder dizer:

> “Continue o projeto da pizzaria.”

E o OrdaX conseguir:

1. encontrar o Work correto daquele owner;
2. restaurar o Space/projeto correto sem inferência silenciosa;
3. mostrar o estado anterior;
4. raciocinar sobre o próximo passo;
5. propor apenas ações disponíveis no catálogo;
6. pedir aprovação exatamente quando necessário;
7. executar somente o recurso aprovado;
8. registrar receipt, Activity e Result;
9. pausar ou continuar depois;
10. fazer tudo isso sem transformar inteligência em autoridade.

Esse é o núcleo do sistema inteligente e escalável: **continuidade + contexto + execução governada + componentes substituíveis**, em vez de um agente monolítico com acesso irrestrito.
