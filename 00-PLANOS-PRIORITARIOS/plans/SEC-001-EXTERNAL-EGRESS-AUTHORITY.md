# SEC-001 — External Egress Authority

- **Tipo:** SECURITY / EXECUTION CLOSURE PLAN
- **Status:** ACTIVE — E0 PASS_SOURCE / E1 IMPLEMENTED_SOURCE / E2 NEXT
- **Prioridade:** P1 transversal
- **Criado:** 2026-10-14
- **Reauditado contra:** `main@32690a835fc337e5dae52065c5149474a98eddc7`
- **Owner humano:** `docs/EXTERNAL-EGRESS-AUTHORITY.md`
- **Owners de execução existentes:** `ordax.action-gateway/1` + `ordax.action-executor/1`
- **Não cria novo broker/gateway:** SIM
- **Primeiro consumidor candidato:** `WEB-001`

## Problema confirmado

O OrdaX já possui a classe de efeito `external-egress`, porém o Action Gateway atual a nega deliberadamente. `ordax.intelligence-tool-grant/1` autoriza ações de ferramenta `read/write`; ele não autoriza rede nem `device-control`.

Logo, o gap não é "ligar Internet no Web Research". O gap é uma autoridade explícita, curta, revogável e revalidável para egress, consumida pelos owners atuais.

## Invariantes

```text
conteúdo/prompt/modelo != autoridade
web request != grant
tool grant != egress grant
action proposal != execução
provider credential != grant do usuário
```

## E0 — owner audit

**PASS_SOURCE.** Confirmado que um segundo broker seria duplicação e que reutilizar Intelligence tool grant para rede mudaria silenciosamente seu significado.

## E1 — contrato + session authority

**IMPLEMENTED_SOURCE na branch `feature/external-egress-authority-foundation-20261014`.**

Criado:

- `ordax.external-egress-grant/1`;
- `ordax.external-egress-grant-issue/1`;
- registry/issuer ports;
- session authority com issue/resolve/revoke/dispose;
- TTL máximo de 5 minutos;
- exact DNS HTTPS origins, sem wildcard/IP/porta customizada;
- binding exato de Work/approval/owner/Space/project/tool artifact/action/resource;
- budgets de requests/bytes/cost/deadline;
- explicit user approval;
- anti-replay de approval;
- rejeição de campos de credencial e campos desconhecidos;
- testes focados de contrato/lifecycle;
- workflow Node path-scoped de até 5 minutos.

A fundação foi validada localmente com Node 22 antes de abrir PR. Ela **não** altera o Action Gateway e portanto não habilita rede.

## E2 — Action Gateway

Próximo gate. Integrar um `externalEgressGrantResolver`/port equivalente ao Gateway existente, com ausência fail-closed.

O Gateway deve conferir:

- grant id e efeito;
- Work + approval;
- owner/Space/project;
- tool id + artifact SHA-256;
- action id;
- resourceRef;
- expiração/revogação;
- budgets/destinations aplicáveis.

A mudança não pode afetar o comportamento já provado de `read/write`. `device-control` continua negado.

## E3 — Action Executor

Provar que allow stale/revogado falha antes do adapter, que adapter identity/action/effect/artifact precisam coincidir e que o receipt canônico continua sendo `ordax.action-receipt/1`.

## E4 — WEB-001 primeiro consumidor

Web Research já possui requests provider-neutral, resource binding determinístico, provider router, provenance/trust e usage sem authority. Depois de E2/E3 verdes, ele pode ser o primeiro consumidor remoto do novo grant.

Nenhum provider real entra antes disso.

## E5 — background/autonomia

Foreground grant não vira autorização permanente. Background egress exige policy/entitlement/budget/grant próprios e burn-rate observável.

## CI

Contratos/registry de egress não justificam kernel/Portable. Gate primário é Node focado + Foundation. CI-001 deve impedir QEMU de rodar só porque um contract/service high-level mudou.

## Conclusão

SEC-001 fecha apenas quando uma operação real cumprir:

```text
intent
-> action request
-> external egress grant explícito
-> Action Gateway allow
-> Action Executor revalidation
-> typed adapter
-> bounded side effect
-> ordax.action-receipt/1 + domain usage
```

com mismatch/revoke/expiry provados fail-closed.
