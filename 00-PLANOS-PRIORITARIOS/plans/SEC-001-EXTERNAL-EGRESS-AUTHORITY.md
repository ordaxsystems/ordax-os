# SEC-001 — External Egress Authority

- **Tipo:** SECURITY / EXECUTION CLOSURE PLAN
- **Status:** ACTIVE — E0 PASS_SOURCE / E1 NEXT
- **Prioridade:** P1 transversal
- **Criado:** 2026-10-14
- **Reauditado contra:** `main@32690a835fc337e5dae52065c5149474a98eddc7`
- **Owners existentes:** `ordax.action-gateway/1` + `ordax.action-executor/1`
- **Não cria novo broker/gateway:** SIM
- **Primeiro consumidor candidato:** `WEB-001`

## Problema confirmado

O OrdaX já possui a classe de efeito `external-egress`, mas isso **não significa que egress esteja autorizado**.

A auditoria de source confirmou simultaneamente:

1. `ordax.action-request/1` aceita `external-egress`;
2. `ordax.action-executor/1` exige decisão `allow`, approval/resource/grant exatos para efeitos sensíveis e revalida a autoridade imediatamente antes do adapter;
3. o Action Gateway atual nega `external-egress` e `device-control` antes de resolver Intelligence tool grants;
4. `docs/contracts/personal-ordax.json` declara explicitamente que Intelligence tool grants não autorizam external egress nem device control.

Portanto o gap real não é "adicionar rede ao Web Research". O gap é fechar uma **autoridade de egress explícita, revogável, limitada e revalidável** dentro dos owners atuais.

## Invariantes

```text
conteúdo/prompt/modelo != autoridade
web request != grant
tool grant != egress grant
action proposal != execução
approval UI != autorização durável
provider credential != grant do usuário
```

O Action Gateway continua sendo o único ponto de decisão. O Action Executor continua sendo o único owner genérico de execução tipada/revalidação.

## Decisão arquitetural

Não ampliar silenciosamente `ordax.intelligence-tool-grant/1` para significar acesso à Internet. Esse grant hoje representa autoridade de ação da ferramenta (`read`/`write`) e possui limites próprios.

A direção preferida é uma autoridade de egress separada semanticamente, mas consumida **pelo mesmo Action Gateway/Executor**. Nome de contrato candidato:

```text
ordax.external-egress-grant/1
```

O nome é candidato até E1 fechar o contrato; o owner não é candidato: permanece Action Gateway/Executor.

## Escopo mínimo do grant futuro

Uma autorização de egress deve ser ligada, no mínimo, a:

- grant id opaco;
- Work + approval exatos;
- owner `device|account` e owner id quando aplicável;
- Space/project opcionais, quando presentes no request;
- `toolId` + artifact SHA-256 exatos;
- `actionId` exato;
- `resourceRef` exato da operação;
- classe `external-egress`;
- destinos permitidos de forma estruturada e limitada;
- limite de requests;
- limite de bytes de egress/ingress contabilizados pelo domínio aplicável;
- teto de custo quando houver provider pago;
- deadline/TTL curto;
- origem de autorização explícita do usuário/policy aprovada;
- revogação.

Não usar wildcard irrestrito `*` como primeira implementação.

## Separação de responsabilidade

### Action Gateway

- resolve a autoridade apropriada para `external-egress`;
- confere binding exato de Work/approval/owner/context/tool/action/resource;
- confere validade/expiração/revogação e limites aplicáveis;
- produz `allow|approval-required|deny`;
- não executa HTTP/provider.

### Action Executor

- recebe somente execução já autorizada;
- revalida no Gateway imediatamente antes do adapter;
- resolve adapter tipado somente após revalidação;
- produz `ordax.action-receipt/1`;
- falha fechado antes do side effect quando a autoridade não é mais válida.

### Web Research / outros consumidores

- descrevem a intenção e projetam um `ordax.action-request/1`;
- nunca emitem grant;
- nunca transformam provider result em autoridade;
- nunca guardam provider secret em Surface/app;
- reportam usage separado de authority receipt.

## Gate E0 — auditoria de owner

**PASS_SOURCE — 2026-10-14.**

Confirmado que criar um segundo broker seria duplicação. Também confirmado que habilitar `external-egress` com o Intelligence tool grant atual violaria o contrato vigente.

## Gate E1 — contrato de egress

Fechar contrato machine-readable e testes negativos antes de alterar Gateway.

Provas obrigatórias:

- prompt/model/profile/memory/project content não pode emitir grant;
- owner/Space/project mismatch rejeitado;
- tool artifact mismatch rejeitado;
- action/resource mismatch rejeitado;
- destino fora do escopo rejeitado;
- expired/revoked grant rejeitado;
- bytes/requests/cost/deadline fora do teto rejeitados;
- grant não contém provider secret;
- grant não substitui entitlement/budget.

## Gate E2 — Action Gateway

Adicionar resolução da autoridade de egress ao Gateway existente sem alterar o comportamento de `read/write` já provado.

A mudança deve permanecer fail-closed: ausência do novo resolver/registry mantém `external-egress=deny`.

`device-control` permanece fora deste plano e continua negado.

## Gate E3 — Executor e adapter boundary

Provar que:

1. allow stale/revogado não chega ao adapter;
2. adapter id/action/effect/artifact precisam coincidir com request autorizado;
3. resultado incerto depois de entrar no adapter continua distinguido de falha pre-side-effect;
4. `ordax.action-receipt/1` registra resource/grant do efeito sensível sem transformar o receipt em autoridade reutilizável.

## Gate E4 — primeiro consumidor: WEB-001

Web Research pode ser o primeiro consumidor porque já possui:

- request provider-neutral;
- resource binding determinístico;
- source trust não confiável;
- provider router sem marca fixa;
- usage separado de authority;
- projeção para `external-egress`.

Só depois de E1-E3 verdes um provider remoto pode ser chamado.

## Gate E5 — background/autonomia

Background Runtime não herda automaticamente autorização de foreground. Qualquer egress em background precisa de policy/entitlement/budget/grant compatíveis e observabilidade de burn-rate.

Não promover sessão/one-shot grant para autonomia permanente por conveniência.

## CI

Mudanças puramente contratuais deste plano não justificam rebuild de kernel/Portable. Testes de Action Gateway/Executor/egress devem ser o gate primário; provas pesadas de boot só entram quando um path realmente consumido por boot/runtime imutável for alterado.

## Critério de conclusão

SEC-001 só fecha quando o primeiro `external-egress` real passa pela cadeia:

```text
intent
-> action request
-> explicit egress authority
-> Action Gateway allow
-> Action Executor revalidation
-> typed adapter
-> bounded side effect
-> action receipt + domain usage
```

com testes negativos de revogação/mismatch e sem bypass específico por consumidor.
